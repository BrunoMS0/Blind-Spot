// Variables de entorno validadas una sola vez al arrancar. Ver .env.example.
import { z } from "zod";
import { PROVIDER_MODES } from "../src/shared/api";
import { SERVER_PORT } from "../src/shared/config";

const EnvSchema = z.object({
  AI_GATEWAY_API_KEY: z.string().optional(),
  JEV_BASE_URL: z.url().default("https://ai-gateway.vercel.sh/typesafe"),
  // El gateway de Vercel solo acepta "jev", sin versión (verificado con jev:ping el 2026-09-24).
  // Si algún día permite fijarla (p. ej. jev-1.13.0), ponerla aquí. Cada decisión registra el modelo.
  JEV_MODEL: z.string().min(1).default("jev"),
  JEV_MODE: z.enum(PROVIDER_MODES).default("mock"),
  JEV_REPLAY_FILE: z.string().optional(),
  JEV_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(1),
  /** Intervalo mínimo entre el inicio de dos llamadas a Jev. */
  JEV_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(2000),
  /** Tope total de una decisión con sus reintentos ante 429 antes de ofrecer reintentar o el respaldo. */
  JEV_RETRY_TOTAL_MS: z.coerce.number().int().positive().default(30_000),
  SAMPLING: z.enum(["sample", "argmax"]).default("sample"),
  PORT: z.coerce.number().int().positive().default(SERVER_PORT),
});

// Las cadenas vacías del .env cuentan como "no definida".
export const env = EnvSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));

if (env.JEV_MODE === "real" && !env.AI_GATEWAY_API_KEY) throw new Error("JEV_MODE=real needs AI_GATEWAY_API_KEY in .env");

/** Precio de Jev: solo se cobran los tokens de entrada ($0.042 por millón, docs.typesafe.ai/models). */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
