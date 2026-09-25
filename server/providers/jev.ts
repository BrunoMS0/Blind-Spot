// Proveedor real: Jev a través del AI Gateway de Vercel, con el SDK oficial.
//
// Política ante 429 (el plan gratuito los devuelve de forma variable):
// - Reintenta el propio SDK: respeta Retry-After y, si no viene, espera 1 s, 2 s, 4 s, 8 s, 8 s…
// - El `signal` que llega del servidor corta todo a JEV_RETRY_TOTAL_MS (el SDK no tiene tope total).
// - Si no alcanza, JevUnavailable: el jugador elige reintentar o usar la decisión simulada (respaldo).
// - Limitador: de a una llamada, y al menos JEV_MIN_INTERVAL_MS entre el inicio de dos.
// - Caché: el mismo estado con las mismas preguntas no vuelve a llamar (p. ej. al reintentar o repetir un turno).
import { APIConnectionError, APIError, APIUserAbortError, TypeSafeClient, type Fetch, type TypeSafeClientConfig } from "@typesafe-ai/sdk";
import { env } from "../env";
import type { DecisionProvider, ProviderOutput } from "./types";

const CACHE_MAX = 500;

export class JevUnavailable extends Error {
  constructor(
    message: string,
    /** false si reintentar no sirve (key inválida, pedido rechazado): solo queda el respaldo. */
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Cliente con la configuración del proyecto. Los scripts lo usan con overrides (p. ej. sin reintentos). */
export function createJevClient(overrides: Partial<TypeSafeClientConfig> = {}): TypeSafeClient {
  const apiKey = overrides.apiKey ?? env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set in .env");
  return new TypeSafeClient({
    apiKey,
    baseURL: env.JEV_BASE_URL,
    defaultModel: env.JEV_MODEL,
    timeout: 10_000, // por intento
    retry: { maxRetries: 8, backoffInitialMs: 1000, backoffMaxMs: 8000, respectRetryAfter: true },
    ...overrides,
  });
}

export function createJevProvider({ fetch = globalThis.fetch, apiKey = env.AI_GATEWAY_API_KEY, minIntervalMs = env.JEV_MIN_INTERVAL_MS } = {}): DecisionProvider {
  // Los reintentos ocurren dentro del SDK; este fetch los cuenta. Como las llamadas van de a una,
  // la diferencia del contador antes y después es exacta para cada llamada.
  let rateLimited = 0;
  const countingFetch: Fetch = async (input, init) => {
    const res = await fetch(input, init);
    if (res.status === 429) rateLimited++;
    return res;
  };
  let client: TypeSafeClient | null = null; // se crea al primer uso: en modo mock no hace falta la key
  const cache = new Map<string, ProviderOutput>();

  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  const limited = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  };

  return {
    mode: "real",
    async decide({ jevState, questions, signal }) {
      const key = JSON.stringify([jevState, questions]);
      const hit = cache.get(key);
      if (hit) return { ...hit, inputTokens: 0, rateLimited: 0, cached: true };

      client ??= createJevClient({ apiKey, fetch: countingFetch });
      return limited(async () => {
        const before = rateLimited;
        try {
          // Todas las preguntas del turno en UNA llamada: Jev lee el estado una vez y responde en paralelo.
          const result = await client!.systemOne({ state: jevState, questions }, { signal });
          const out: ProviderOutput = { answers: result.answers, model: result.model, inputTokens: result.usage.input_tokens, rateLimited: rateLimited - before };
          cache.set(key, out);
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
          return out;
        } catch (e) {
          const count = rateLimited - before;
          const status = e instanceof APIError ? e.status : undefined;
          const retryable = status === undefined || status === 408 || status === 429 || status >= 500;
          const reason = status
            ? `HTTP ${status}`
            : e instanceof APIUserAbortError
              ? "se agotó el tiempo"
              : e instanceof APIConnectionError
                ? "sin conexión con el gateway"
                : "error";
          console.warn(`[jev] no answer: ${reason}, ${count} × 429`);
          throw new JevUnavailable(`Jev no respondió (${reason}; ${count} × 429)`, retryable, { cause: e });
        }
      });
    },
  };
}

export const jevProvider = createJevProvider();
