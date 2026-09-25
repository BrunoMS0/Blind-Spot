// Contrato HTTP entre cliente y servidor. /api/enemy-turn y /api/spy usan el mismo pedido y la misma respuesta.
// El pedido es solo la foto de la partida, validada con zod: no hay forma de mandarle texto libre a Jev.
import { z } from "zod";
import { COMMANDERS, GUARD_OPTIONS, THIEF_IDS } from "./config";
import type { EnemyDecisions, GameState, GuardDecision, GuardOption } from "./types";

export const PROVIDER_MODES = ["mock", "real", "replay"] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];
/** "respaldo" = decisión simulada tras fallar Jev. Las métricas la excluyen. */
export type DecisionSource = "jev" | "respaldo";

const int = z.number().int();
const nat = int.nonnegative();
const vec = z.object({ x: nat, y: nat });
const thiefId = z.enum(THIEF_IDS);
const guardOption = z.enum(GUARD_OPTIONS);
const radioReport = z.object({ kind: z.enum(["movement", "all_clear"]), zone: z.string().max(40), turn: nat });

const thief = z.object({ id: thiefId, pos: vec, caught: z.boolean(), hasDiamond: z.boolean(), moved: z.boolean(), acted: z.boolean() });

const guard = z.object({
  id: z.string().max(40),
  pos: vec,
  facing: z.enum(["north", "east", "south", "west"]),
  patrolIndex: nat,
  lastSighting: z.object({ thief: thiefId, pos: vec, turn: nat }).nullable(),
  lastDecision: guardOption.nullable(),
});

// `satisfies` hace que typecheck falle si el esquema y el tipo GameState dejan de coincidir.
export const GameStateSchema = z.object({
  levelId: z.string().max(40),
  commander: z.enum(COMMANDERS),
  seed: int,
  turn: nat,
  alarm: nat,
  alarmRaisedBy: z.array(thiefId).max(THIEF_IDS.length),
  thieves: z.record(thiefId, thief),
  guards: z.array(guard).max(8),
  vault: z.object({ progress: nat, open: z.boolean() }),
  diamond: vec.nullable(),
  noises: z.array(z.object({ pos: vec, turn: nat })).max(8),
  radio: z.object({ usesLeft: nat, usedThisTurn: z.boolean(), active: radioReport.nullable(), deceptions: nat }),
  spy: z.object({ usesLeft: nat, activeThisTurn: z.boolean() }),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("playing") }),
    z.object({ status: z.literal("won") }),
    z.object({ status: z.literal("lost"), reason: z.enum(["alarm", "diamond_carrier_caught", "team_caught"]) }),
  ]),
}) satisfies z.ZodType<GameState>;

export const TurnRequestSchema = z.object({
  state: GameStateSchema,
  /** El jugador eligió "usar decisión simulada" tras fallar Jev: responde el mock y se registra como respaldo. */
  fallback: z.boolean().default(false),
});
export type TurnRequest = z.input<typeof TurnRequestSchema>;

export interface GuardAnswer extends GuardDecision {
  /** Probabilidad de cada opción ofrecida (las no ofrecidas no aparecen). */
  probabilities: Partial<Record<GuardOption, number>>;
}

export interface TurnResponse {
  guards: GuardAnswer[];
  raiseAlarm: { probability: number; raised: EnemyDecisions["raiseAlarm"] };
  meta: {
    mode: ProviderMode;
    source: DecisionSource;
    /** Modelo que respondió según Jev (response.model), o null en mock. */
    model: string | null;
    latencyMs: number;
    /** Se reutilizó una respuesta anterior con el mismo estado: no hubo llamada. */
    cached: boolean;
    /** Aviso para el jugador, p. ej. tope diario alcanzado o replay sin grabación para esta situación. */
    note?: string;
  };
  /** La llamada completa, tal como la vio Jev, para el visor. El cliente solo la muestra. */
  call: { state: unknown; questions: unknown; answers: unknown };
}

/** Jev no respondió tras ~30 s de reintentos: el cliente ofrece reintentar o usar el respaldo. */
export interface TurnError {
  error: string;
  retryable: boolean;
}
