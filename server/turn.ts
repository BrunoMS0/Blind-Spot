// Un pedido de decisión (turno enemigo o infiltrada): foto de la partida → análisis → estado y preguntas para
// Jev → proveedor → sorteo. Devuelve la respuesta y el registro; escribirlo y sumar el gasto es cosa de
// index.ts, así esto se puede probar sin tocar el disco.
import type { z } from "zod";
import { analyzeTurn } from "../src/shared/analysis";
import type { DecisionSource, TurnRequestSchema, TurnResponse } from "../src/shared/api";
import { LEVELS } from "../src/shared/level";
import { rngFor, sample } from "../src/shared/rng";
import type { GameState, GuardOption } from "../src/shared/types";
import { costOf, withinBudget } from "./budget";
import { env } from "./env";
import { buildJevTurn } from "./jev-state";
import { jevProvider } from "./providers/jev";
import { mockProvider } from "./providers/mock";
import { NoRecording, replayProvider } from "./providers/replay";
import type { DecisionProvider, DecisionRecord, ProviderOutput } from "./providers/types";

const PROVIDERS = { mock: mockProvider, real: jevProvider, replay: replayProvider } as const;

export class BadRequest extends Error {}

/** zod valida la forma; esto valida que la foto corresponda al nivel (guardias y zonas que existen). */
function checkAgainstLevel(s: GameState) {
  const level = LEVELS[s.levelId];
  if (!level) throw new BadRequest(`unknown level ${s.levelId}`);
  if (s.guards.map((g) => g.id).join() !== level.guards.map((g) => g.id).join()) throw new BadRequest("guards do not match the level");
  if (s.radio.active && !level.zones[s.radio.active.zone]) throw new BadRequest(`unknown zone ${s.radio.active.zone}`);
  return level;
}

export async function decideTurn(
  endpoint: DecisionRecord["endpoint"],
  req: z.output<typeof TurnRequestSchema>,
  signal: AbortSignal = AbortSignal.timeout(env.JEV_RETRY_TOTAL_MS),
): Promise<{ response: TurnResponse; record: DecisionRecord }> {
  const s = req.state;
  const level = checkAgainstLevel(s);
  // La infiltrada cuesta llamadas: solo responde si el jugador la activó este turno.
  if (endpoint === "spy" && !s.spy.activeThisTurn) throw new BadRequest("the spy is not active this turn");

  const analysis = analyzeTurn(level, s);
  const { jevState, questions } = buildJevTurn(level, s, analysis);
  const input = { jevState, questions, analysis, signal };

  let provider: DecisionProvider = PROVIDERS[env.JEV_MODE];
  let source: DecisionSource = "jev";
  let note: string | undefined;
  if (req.fallback) {
    provider = mockProvider;
    source = "respaldo";
  } else if (provider.mode === "real" && !withinBudget()) {
    provider = mockProvider;
    note = "tope diario de Jev alcanzado: decide el mock";
  }

  const started = performance.now();
  let out: ProviderOutput;
  try {
    out = await provider.decide(input); // JevUnavailable sube hasta index.ts → 503
  } catch (e) {
    if (!(e instanceof NoRecording)) throw e;
    note = e.message;
    provider = mockProvider;
    out = await mockProvider.decide(input);
  }
  const latencyMs = Math.round(performance.now() - started);

  // Se sortea con las probabilidades de Jev: un 30 % pasa 3 de cada 10 veces. Semilla + turno + guardia.
  const guards = analysis.guards.map((g) => {
    const answer = out.answers[`${g.guard}_plan`];
    if (!answer) throw new Error(`provider did not answer ${g.guard}_plan`);
    const option = env.SAMPLING === "argmax" ? answer.choice : sample(answer.probabilities, rngFor(s.seed, s.turn, g.guard));
    return { guard: g.guard, option, probability: answer.probabilities[option] ?? 0, probabilities: answer.probabilities };
  });
  const p = out.answers.raise_alarm.noul;
  const raised = env.SAMPLING === "argmax" ? p >= 0.5 : rngFor(s.seed, s.turn, "raise_alarm")() < p;
  const cached = out.cached ?? false;

  const response: TurnResponse = {
    guards,
    raiseAlarm: { probability: p, raised },
    meta: { mode: provider.mode, source, model: out.model, latencyMs, cached, ...(note && { note }) },
  };
  const record: DecisionRecord = {
    ts: new Date().toISOString(),
    endpoint,
    mode: provider.mode,
    source,
    requestedModel: env.JEV_MODEL,
    model: out.model,
    seed: s.seed,
    turn: s.turn,
    commander: s.commander,
    jevState,
    questions,
    answers: out.answers,
    chosen: Object.fromEntries(guards.map((g) => [g.guard, g.option])) as Record<string, GuardOption>,
    raiseAlarm: raised,
    latencyMs,
    inputTokens: out.inputTokens,
    costUsd: provider.mode === "real" && !cached ? costOf(out.inputTokens) : 0,
    cached,
    rateLimited: out.rateLimited ?? 0,
    ...(note && { note }),
  };
  return { response, record };
}
