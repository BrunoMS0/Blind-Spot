// Reglas que comparten el turno del jugador y el turno enemigo: partida nueva, avistamientos, capturas,
// engaños de la radio y fin de partida. Estas funciones modifican el estado que reciben; las funciones
// públicas de player-turn.ts y enemy-turn.ts clonan antes de llamarlas.
import { ALARM_TO_LOSE, RADIO_USES, SPY_USES, THIEF_IDS } from "./config";
import { adjacent, same, zoneAt, type Level } from "./level";
import { canSee } from "./vision";
import type { CommanderId, GameEvent, GameState, GuardId, GuardState, Outcome, RadioTrust, ThiefId, ThiefState } from "./types";

export interface Result {
  state: GameState;
  events: GameEvent[];
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function newGame(level: Level, commander: CommanderId, seed: number): GameState {
  const thief = (id: ThiefId): ThiefState => ({ id, pos: { ...level.thieves[id] }, caught: false, hasDiamond: false, moved: false, acted: false });
  return {
    levelId: level.id,
    commander,
    seed,
    turn: 1,
    alarm: 0,
    alarmRaisedBy: [],
    thieves: Object.fromEntries(THIEF_IDS.map((id) => [id, thief(id)])) as Record<ThiefId, ThiefState>,
    guards: level.guards.map((g) => ({ id: g.id, pos: { ...g.start }, facing: g.facing, patrolIndex: 0, lastSighting: null, lastDecision: null })),
    vault: { progress: 0, open: false },
    diamond: { ...level.diamond },
    noises: [],
    radio: { usesLeft: RADIO_USES, usedThisTurn: false, active: null, deceptions: 0 },
    spy: { usesLeft: SPY_USES, activeThisTurn: false },
    outcome: { status: "playing" },
  };
}

export const activeThieves = (s: GameState): ThiefState[] => Object.values(s.thieves).filter((t) => !t.caught);

export function radioTrust(s: GameState): RadioTrust {
  return s.radio.deceptions === 0 ? "high" : s.radio.deceptions === 1 ? "shaken" : "lying";
}

/**
 * Qué ladrones ve cada guardia. Un ladrón visto sube la alarma como mucho una vez por fase (s.alarmRaisedBy)
 * y el guardia recuerda dónde lo vio. `seen` evita repetir thief_seen del mismo par dentro de una acción.
 */
export function checkSightings(
  level: Level,
  s: GameState,
  events: GameEvent[],
  seen: Set<string>,
  guards: GuardState[] = s.guards,
  thieves: ThiefState[] = activeThieves(s),
): void {
  for (const g of guards) {
    for (const t of thieves) {
      if (t.caught || !canSee(level, s, g, t.pos)) continue;
      g.lastSighting = { thief: t.id, pos: { ...t.pos }, turn: s.turn };
      if (!seen.has(`${g.id}:${t.id}`)) {
        seen.add(`${g.id}:${t.id}`);
        events.push({ type: "thief_seen", thief: t.id, guard: g.id, at: { ...t.pos } });
      }
      if (!s.alarmRaisedBy.includes(t.id)) {
        s.alarmRaisedBy.push(t.id);
        s.alarm++;
        events.push({ type: "alarm_raised", level: s.alarm, cause: "thief_seen" });
      }
      const report = s.radio.active;
      if (report?.kind === "all_clear" && zoneAt(level, t.pos) === report.zone) discoverDeception(s, g.id, events);
    }
  }
}

/** La radio mintió: baja la confianza y el reporte deja de estar activo. */
export function discoverDeception(s: GameState, guard: GuardId, events: GameEvent[]): void {
  const report = s.radio.active;
  if (!report) return;
  s.radio.deceptions++;
  s.radio.active = null;
  events.push({ type: "deception_discovered", guard, report, deceptions: s.radio.deceptions });
}

/** Un guardia que termina su movimiento al lado (no en diagonal) de un ladrón lo atrapa. */
export function checkCaptures(s: GameState, guard: GuardState, events: GameEvent[]): void {
  for (const t of activeThieves(s)) {
    if (!adjacent(guard.pos, t.pos)) continue;
    t.caught = true;
    events.push({ type: "thief_caught", thief: t.id, guard: guard.id });
  }
}

/** Decide si la partida terminó. Emite game_over una sola vez. */
export function updateOutcome(level: Level, s: GameState, events: GameEvent[]): void {
  if (s.outcome.status !== "playing") return;
  const carrier = Object.values(s.thieves).find((t) => t.hasDiamond);
  let outcome: Exclude<Outcome, { status: "playing" }> | null = null;
  if (s.alarm >= ALARM_TO_LOSE) outcome = { status: "lost", reason: "alarm" };
  else if (carrier?.caught) outcome = { status: "lost", reason: "diamond_carrier_caught" };
  else if (activeThieves(s).length === 0) outcome = { status: "lost", reason: "team_caught" };
  else if (carrier && same(carrier.pos, level.exit)) outcome = { status: "won" };
  if (!outcome) return;
  s.outcome = outcome;
  events.push({ type: "game_over", outcome });
}
