// Contrato común de los tres proveedores (mock, jev, replay; se elige con JEV_MODE).
// Preguntas y respuestas usan los tipos del SDK oficial: el mock y el replay devuelven exactamente
// la forma de una respuesta real de Jev.
import type { ChoiceQuestion, EntryType, JsonValue, NoulQuestion, SystemOneResult } from "@typesafe-ai/sdk";
import type { DecisionSource, ProviderMode } from "../../src/shared/api";
import type { CommanderId, GuardId, GuardOption, TurnAnalysis } from "../../src/shared/types";

/** Un turno enemigo = UNA llamada: una Choice `<guardia>_plan` por guardia y raise_alarm. */
export type TurnQuestions = {
  [plan: `${string}_plan`]: ChoiceQuestion<Partial<Record<GuardOption, EntryType>>>;
  raise_alarm: NoulQuestion;
};

export type TurnAnswers = SystemOneResult<TurnQuestions>["answers"];

export interface ProviderInput {
  /** Conclusiones cortas en inglés, nunca la cuadrícula. */
  jevState: { [key: string]: JsonValue };
  questions: TurnQuestions;
  /** Los hechos calculados por el código: el mock decide con esto; jev y replay lo ignoran. */
  analysis: TurnAnalysis;
  signal: AbortSignal;
}

export interface ProviderOutput {
  answers: TurnAnswers;
  /** Modelo que respondió (response.model), o null si no hubo modelo. */
  model: string | null;
  inputTokens: number;
  /** Se reutilizó una respuesta anterior con el mismo estado y preguntas: no hubo llamada ni costo. */
  cached?: boolean;
  /** Cuántos 429 devolvió el gateway antes de responder. */
  rateLimited?: number;
}

export interface DecisionProvider {
  readonly mode: ProviderMode;
  decide(input: ProviderInput): Promise<ProviderOutput>;
}

/** Una línea del JSONL en logs/. El modo replay las lee de vuelta. */
export interface DecisionRecord {
  ts: string;
  endpoint: "enemy-turn" | "spy";
  /** El proveedor que respondió de verdad (p. ej. "mock" si se agotó el tope diario). */
  mode: ProviderMode;
  source: DecisionSource;
  requestedModel: string;
  model: string | null;
  seed: number;
  turn: number;
  commander: CommanderId;
  jevState: ProviderInput["jevState"];
  questions: TurnQuestions;
  answers: TurnAnswers;
  chosen: Record<GuardId, GuardOption>;
  raiseAlarm: boolean;
  latencyMs: number;
  inputTokens: number;
  costUsd: number;
  cached: boolean;
  rateLimited: number;
  note?: string;
}
