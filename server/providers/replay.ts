// Proveedor replay: reproduce respuestas reales de Jev grabadas en logs/*.jsonl, sin llamar a nadie.
// Solo para situaciones idénticas (mismo estado para Jev y mismas preguntas): con la misma semilla y las
// mismas jugadas se repite una partida entera. Si la situación no está grabada, lanza NoRecording y el
// servidor usa el mock para ese turno (y lo anota). Si cambian las preguntas o una doctrina, las grabaciones
// viejas dejan de coincidir.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LOG_DIR, readDecisions } from "../decision-log";
import { env } from "../env";
import type { DecisionProvider, DecisionRecord } from "./types";

export class NoRecording extends Error {}

let recordings: Map<string, DecisionRecord> | null = null;

function load(): Map<string, DecisionRecord> {
  const files = env.JEV_REPLAY_FILE
    ? [env.JEV_REPLAY_FILE]
    : existsSync(LOG_DIR)
      ? readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => join(LOG_DIR, f))
      : [];
  const map = new Map<string, DecisionRecord>();
  for (const r of files.flatMap(readDecisions)) {
    if (r.mode === "real" && r.source === "jev") map.set(JSON.stringify([r.jevState, r.questions]), r);
  }
  console.log(`[replay] ${map.size} recorded Jev answers from ${files.length} file(s)`);
  return map;
}

export const replayProvider: DecisionProvider = {
  mode: "replay",
  async decide({ jevState, questions }) {
    recordings ??= load();
    const r = recordings.get(JSON.stringify([jevState, questions]));
    if (!r) throw new NoRecording("replay: no recorded Jev answer for this situation, using mock");
    return { answers: r.answers, model: r.model, inputTokens: 0 };
  },
};
