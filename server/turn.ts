// Un turno enemigo del lado del servidor: foto de la partida → análisis → estado y preguntas para Jev →
// proveedor → sorteo. Fase 1: solo el mock. En la fase 2 se suman jev/replay, 429, limitador, caché y registro.
import { analyzeTurn } from "../src/shared/analysis";
import type { TurnRequestSchema, TurnResponse } from "../src/shared/api";
import { LEVELS } from "../src/shared/level";
import { rngFor, sample } from "../src/shared/rng";
import type { GameState } from "../src/shared/types";
import type { z } from "zod";
import { buildJevTurn } from "./jev-state";
import { mockProvider } from "./providers/mock";

/** sample (por defecto): se sortea según las probabilidades de Jev. argmax: siempre la más probable. */
const SAMPLING = process.env.SAMPLING === "argmax" ? "argmax" : "sample";

export class BadRequest extends Error {}

/** zod valida la forma; esto valida que la foto corresponda al nivel (guardias y zonas que existen). */
function checkAgainstLevel(s: GameState) {
  const level = LEVELS[s.levelId];
  if (!level) throw new BadRequest(`unknown level ${s.levelId}`);
  if (s.guards.map((g) => g.id).join() !== level.guards.map((g) => g.id).join()) throw new BadRequest("guards do not match the level");
  if (s.radio.active && !level.zones[s.radio.active.zone]) throw new BadRequest(`unknown zone ${s.radio.active.zone}`);
  return level;
}

export async function decideTurn(req: z.output<typeof TurnRequestSchema>): Promise<TurnResponse> {
  const s = req.state;
  const level = checkAgainstLevel(s);
  const analysis = analyzeTurn(level, s);
  const { jevState, questions } = buildJevTurn(level, s, analysis);

  const started = performance.now();
  const out = await mockProvider.decide({ jevState, questions, analysis, signal: AbortSignal.timeout(30_000) });
  const latencyMs = Math.round(performance.now() - started);

  const guards = analysis.guards.map((g) => {
    const answer = out.answers[`${g.guard}_plan`];
    if (!answer) throw new Error(`provider did not answer ${g.guard}_plan`);
    const option = SAMPLING === "argmax" ? answer.choice : sample(answer.probabilities, rngFor(s.seed, s.turn, g.guard));
    return { guard: g.guard, option, probability: answer.probabilities[option] ?? 0, probabilities: answer.probabilities };
  });
  const p = out.answers.raise_alarm.noul;
  const raised = SAMPLING === "argmax" ? p >= 0.5 : rngFor(s.seed, s.turn, "raise_alarm")() < p;

  return {
    guards,
    raiseAlarm: { probability: p, raised },
    meta: { mode: mockProvider.mode, source: req.fallback ? "respaldo" : "jev", model: out.model, latencyMs, cached: false },
  };
}
