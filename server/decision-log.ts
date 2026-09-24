// Registro: una línea JSON por pedido (enemy-turn o spy, en cualquier modo) en logs/decisions-YYYY-MM-DD.jsonl.
// Sirve para auditar, para sumar el gasto del día (budget.ts) y para el modo replay.
// Las métricas deben filtrar mode === "real" && source === "jev" (sin respaldos).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionRecord } from "./providers/types";

export const LOG_DIR = "logs";

export function todayLogPath(now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return join(LOG_DIR, `decisions-${day}.jsonl`);
}

export function appendDecision(record: DecisionRecord): void {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(todayLogPath(), JSON.stringify(record) + "\n");
}

export function readDecisions(path: string): DecisionRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DecisionRecord);
}
