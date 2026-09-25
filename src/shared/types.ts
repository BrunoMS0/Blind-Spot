// Tipos del juego. Reglas puras: nada de Phaser, DOM ni Node.
import type { COMMANDERS, GUARD_OPTIONS, THIEF_IDS } from "./config";

export type Vec = { x: number; y: number };
export type Facing = "north" | "east" | "south" | "west";

export type ThiefId = (typeof THIEF_IDS)[number];
/** Los guardias y las zonas vienen del nivel, por eso son string. */
export type GuardId = string;
export type ZoneId = string;
export type CommanderId = (typeof COMMANDERS)[number];
export type GuardOption = (typeof GUARD_OPTIONS)[number];

// ---------------------------------------------------------------- nivel (datos)

/**
 * Un nivel tal como está en src/shared/levels/*.json. El mapa es texto para editarlo a mano.
 * Leyenda de `tiles`: `#` muro, `.` suelo, `D` puerta, `P` pedestal, `V` puerta de la bóveda,
 * `X` salida, `*` diamante.
 */
export interface LevelData {
  id: string;
  tiles: string[];
  /** Mismo tamaño que `tiles`: cada letra es la clave de una zona en `zones`. */
  zoneMap: string[];
  zones: Record<string, { id: ZoneId; /** en inglés, para Jev */ name: string; /** en español, para la UI */ label: string }>;
  thieves: Record<ThiefId, Vec>;
  guards: { id: GuardId; name: string; start: Vec; facing: Facing; patrol: Vec[] }[];
}

// ---------------------------------------------------------------- estado de la partida

export interface ThiefState {
  id: ThiefId;
  pos: Vec;
  caught: boolean;
  hasDiamond: boolean;
  /** Durante el turno del jugador: cada ladrón se mueve una vez y hace una acción. */
  moved: boolean;
  acted: boolean;
}

export interface Sighting {
  thief: ThiefId;
  pos: Vec;
  turn: number;
}

export interface GuardState {
  id: GuardId;
  pos: Vec;
  facing: Facing;
  /** Índice de la próxima parada en la ruta de patrulla del nivel. */
  patrolIndex: number;
  /** Dónde vio a un ladrón por última vez. Habilita la opción chase. */
  lastSighting: Sighting | null;
  lastDecision: GuardOption | null;
}

export interface Noise {
  pos: Vec;
  turn: number;
}

/** Un reporte de la radio pirateada. Sigue activo hasta que otro lo reemplaza o se descubre el engaño. */
export interface RadioReport {
  kind: "movement" | "all_clear";
  zone: ZoneId;
  turn: number;
}

export type LossReason = "alarm" | "diamond_carrier_caught" | "team_caught";
export type Outcome = { status: "playing" } | { status: "won" } | { status: "lost"; reason: LossReason };

/** La partida completa. Es lo que el cliente manda al servidor (validado con zod en api.ts). */
export interface GameState {
  levelId: string;
  commander: CommanderId;
  /** Semilla de la partida. El sorteo de cada guardia usa semilla + turno + guardia: misma partida, mismo sorteo. */
  seed: number;
  turn: number;
  alarm: number;
  /** Ladrones que ya subieron la alarma en la fase actual: como mucho +1 por ladrón y fase. */
  alarmRaisedBy: ThiefId[];
  thieves: Record<ThiefId, ThiefState>;
  guards: GuardState[];
  vault: { progress: number; open: boolean };
  /** Casilla del diamante, o null si lo lleva un ladrón (ThiefState.hasDiamond). */
  diamond: Vec | null;
  /** Ruidos de este turno; se borran al terminar el turno enemigo. */
  noises: Noise[];
  radio: { usesLeft: number; usedThisTurn: boolean; active: RadioReport | null; deceptions: number };
  /** El apagón de Zorro: la sala sin luz dura hasta el final del turno enemigo. */
  blackout: { usesLeft: number; zone: ZoneId | null };
  outcome: Outcome;
}

// ---------------------------------------------------------------- acciones del jugador

export type ThiefAction = { type: "force_vault" } | { type: "throw_coin"; target: Vec } | { type: "blackout"; zone: ZoneId } | { type: "take_diamond" };

// ---------------------------------------------------------------- lo que calcula el código para Jev

/** Hechos de una opción de un guardia. El servidor los convierte en una frase corta en inglés. */
export interface OptionFacts {
  target: Vec;
  zone: ZoneId;
  /** Casillas de camino, no en línea recta. */
  distance: number;
}

export interface GuardAnalysis {
  guard: GuardId;
  zone: ZoneId;
  facing: Facing;
  /** Solo las opciones que aplican a este guardia en este turno. */
  options: Partial<Record<GuardOption, OptionFacts>>;
}

/** Confianza en la radio, derivada de GameState.radio.deceptions (0, 1, 2 o más). */
export type RadioTrust = "high" | "shaken" | "lying";

export interface TurnAnalysis {
  guards: GuardAnalysis[];
  alarm: number;
  radioTrust: RadioTrust;
  activeReport: RadioReport | null;
  vaultOpen: boolean;
  /** Sala sin luz (apagón de Zorro), o null. */
  blackout: ZoneId | null;
}

// ---------------------------------------------------------------- decisiones y eventos

/** Lo que resolveEnemyTurn necesita: la opción ya sorteada de cada guardia. */
export interface GuardDecision {
  guard: GuardId;
  option: GuardOption;
  /** Probabilidad que Jev le dio a la opción sorteada. */
  probability: number;
}

export interface EnemyDecisions {
  guards: GuardDecision[];
  raiseAlarm: boolean;
}

/** Todo lo que pasa en la partida. Las reglas los emiten; Phaser los dibuja. */
export type GameEvent =
  | { type: "thief_moved"; thief: ThiefId; path: Vec[] }
  | { type: "thief_seen"; thief: ThiefId; guard: GuardId; at: Vec }
  | { type: "alarm_raised"; level: number; cause: "thief_seen" | "raise_alarm" }
  | { type: "thief_caught"; thief: ThiefId; guard: GuardId }
  | { type: "noise_made"; at: Vec; heardBy: GuardId[] }
  | { type: "radio_sent"; report: RadioReport }
  | { type: "deception_discovered"; guard: GuardId; report: RadioReport; deceptions: number }
  | { type: "blackout_started"; zone: ZoneId }
  | { type: "vault_progress"; progress: number }
  | { type: "vault_opened" }
  | { type: "diamond_taken"; thief: ThiefId }
  | { type: "guard_decided"; decision: GuardDecision }
  | { type: "guard_moved"; guard: GuardId; path: Vec[]; facing: Facing }
  | { type: "turn_ended"; turn: number }
  | { type: "game_over"; outcome: Exclude<Outcome, { status: "playing" }> };
