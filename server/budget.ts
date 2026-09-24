// Tope de gasto diario. El gasto se estima con los tokens de entrada (Jev no cobra los de salida).
// Al arrancar se suma lo ya gastado hoy leyendo el JSONL del día, así reiniciar no resetea el tope.
import { readDecisions, todayLogPath } from "./decision-log";
import { env, USD_PER_INPUT_TOKEN } from "./env";

// ponytail: contador en memoria por proceso. Si el servidor y un script (bench, rate-probe) corren a la vez,
// cada uno solo ve su propio gasto desde que arrancó. Releer el JSONL en cada llamada si eso importa.
let day = todayLogPath();
let spentUsd = readDecisions(day).reduce((sum, r) => sum + r.costUsd, 0);
let warned = false;

function rollDay(): void {
  const today = todayLogPath();
  if (today === day) return;
  day = today;
  spentUsd = 0;
  warned = false;
}

export const costOf = (inputTokens: number): number => inputTokens * USD_PER_INPUT_TOKEN;

/** true si todavía se puede llamar a Jev hoy. La primera vez que se supera el tope, avisa en consola. */
export function withinBudget(): boolean {
  rollDay();
  if (spentUsd < env.JEV_DAILY_BUDGET_USD) return true;
  if (!warned) {
    warned = true;
    console.warn(`[budget] Daily Jev budget reached ($${spentUsd.toFixed(4)} of $${env.JEV_DAILY_BUDGET_USD}). Using mock until tomorrow.`);
  }
  return false;
}

export function recordSpend(usd: number): void {
  rollDay();
  spentUsd += usd;
}

export function spentToday(): number {
  rollDay();
  return spentUsd;
}
