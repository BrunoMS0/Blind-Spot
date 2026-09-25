// Reglas que comparten el turno del jugador y el turno enemigo: partida nueva, avistamientos, capturas,
// engaños de la radio y fin de partida. Estas funciones modifican el estado que reciben; las funciones
// públicas de player-turn.ts y enemy-turn.ts clonan antes de llamarlas.
import { ALARM_TO_LOSE, BLACKOUT_USES, RADIO_USES, THIEF_IDS } from "./config";
import { adjacent, DIRS, key, same, tileAt, zoneAt, type Level } from "./level";
import { explore } from "./paths";
import { rngFor } from "./rng";
import { canSee, visibleTiles } from "./vision";
import type { CommanderId, Facing, GameEvent, GameState, GuardId, GuardState, Outcome, RadioTrust, ThiefId, ThiefState, Vec } from "./types";

export interface Result {
  state: GameState;
  events: GameEvent[];
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * Partida nueva con posiciones de salida sorteadas: cada ladrón en una casilla de la entrada y cada guardia en
 * una de su sala, mirando hacia cualquier lado. El sorteo usa la semilla: misma semilla, misma partida.
 */
export function newGame(level: Level, commander: CommanderId, seed: number): GameState {
  const s = newFixedGame(level, commander, seed);
  shuffleStart(level, s);
  return s;
}

/** Partida con las posiciones escritas en el nivel. La usan las pruebas y el banco, que necesitan situaciones exactas. */
export function newFixedGame(level: Level, commander: CommanderId, seed: number): GameState {
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
    blackout: { usesLeft: BLACKOUT_USES, zone: null },
    outcome: { status: "playing" },
  };
}

/** Un guardia no empieza a menos de estas casillas de camino de un ladrón. */
export const MIN_START_DISTANCE = 6;
/** Ni mirando a un muro: su cono tiene que cubrir al menos estas casillas. */
const MIN_START_VIEW = 4;

/**
 * Sortea las posiciones de salida. La sala de cada uno es la de su posición escrita en el nivel. Un guardia no
 * puede empezar viendo a un ladrón, ni cerca de uno, ni con el cono contra un muro; si ninguna casilla de su
 * sala cumple, se queda en la del nivel. Su patrulla empieza por la parada más cercana.
 */
function shuffleStart(level: Level, s: GameState): void {
  const rng = rngFor(s.seed, 0, "start");
  const shuffled = <T>(xs: T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const floorIn = (zone: string | null): Vec[] =>
    level.zoneIds.flatMap((row, y) => row.flatMap((z, x) => (z === zone && tileAt(level, { x, y }) === "floor" && !same({ x, y }, level.diamond) ? [{ x, y }] : [])));

  const thieves = Object.values(s.thieves);
  const spots = shuffled(floorIn(zoneAt(level, level.thieves.zorro)));
  for (const t of thieves) t.pos = spots.pop() ?? t.pos;

  const taken = new Set(thieves.map((t) => key(t.pos)));
  for (const g of s.guards) {
    const home = level.guards.find((x) => x.id === g.id)!;
    const facings = Object.keys(DIRS) as Facing[];
    const ok = (pos: Vec, facing: Facing) => {
      if (taken.has(key(pos))) return false;
      const viewer = { pos, facing };
      if (thieves.some((t) => canSee(level, s, viewer, t.pos))) return false;
      if (visibleTiles(level, s, viewer).length < MIN_START_VIEW) return false;
      const dist = explore(level, s, pos).cells;
      return thieves.every((t) => (dist.get(key(t.pos))?.dist ?? Infinity) >= MIN_START_DISTANCE);
    };
    const spot = shuffled(floorIn(zoneAt(level, home.start)))
      .flatMap((pos) => shuffled(facings).map((facing) => ({ pos, facing })))
      .find((c) => ok(c.pos, c.facing));
    if (spot) Object.assign(g, { pos: spot.pos, facing: spot.facing });
    taken.add(key(g.pos));
    const dist = explore(level, s, g.pos).cells;
    const stops = home.patrol.map((p) => dist.get(key(p))?.dist ?? Infinity);
    g.patrolIndex = stops.indexOf(Math.min(...stops));
  }
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
