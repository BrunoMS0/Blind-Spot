// Turno del jugador: mover ladrones, sus acciones y la radio. Cada función pública devuelve estado nuevo y
// eventos, y nunca modifica el estado que recibe. Las funciones de consulta (reachable, availableActions…)
// son las que usa la interfaz para saber qué se puede hacer.
import { COIN_RANGE, THIEVES, VAULT_FORCE_ACTIONS } from "./config";
import { heardBy } from "./analysis";
import { adjacent, key, same, solid, type Level } from "./level";
import { explore, pathTo } from "./paths";
import { activeThieves, checkSightings, clone, updateOutcome, type Result } from "./rules";
import { lineOfSight } from "./vision";
import type { GameEvent, GameState, RadioReport, ThiefAction, ThiefId, Vec, ZoneId } from "./types";

const playing = (s: GameState) => s.outcome.status === "playing";

/** Destinos posibles de un ladrón este turno, con su camino. Vacío si ya se movió. */
export function reachable(level: Level, s: GameState, id: ThiefId): Map<string, Vec[]> {
  const t = s.thieves[id];
  if (!playing(s) || t.caught || t.moved) return new Map();
  const occupied = new Set([...s.guards.map((g) => key(g.pos)), ...activeThieves(s).filter((o) => o.id !== id).map((o) => key(o.pos))]);
  const explored = explore(level, s, t.pos, occupied, THIEVES[id].move);
  const out = new Map<string, Vec[]>();
  for (const [k, cell] of explored.cells) if (cell.dist > 0) out.set(k, pathTo(explored, cell.pos)!);
  return out;
}

export function moveThief(level: Level, state: GameState, id: ThiefId, dest: Vec): Result {
  const path = reachable(level, state, id).get(key(dest));
  if (!path) throw new Error(`illegal move: ${id} to ${key(dest)}`);
  const s = clone(state);
  const events: GameEvent[] = [];
  const seen = new Set<string>();
  const t = s.thieves[id];
  // Paso a paso: si cruza un cono, lo ven en ese paso.
  for (const step of path) {
    t.pos = { ...step };
    events.push({ type: "thief_moved", thief: id, path: [{ ...step }] });
    checkSightings(level, s, events, seen, s.guards, [t]);
  }
  t.moved = true;
  updateOutcome(level, s, events);
  return { state: s, events };
}

/** Casillas a las que Eco puede lanzar la moneda: a COIN_RANGE o menos, sin muros en medio. */
export function coinTargets(level: Level, s: GameState, id: ThiefId): Vec[] {
  const from = s.thieves[id].pos;
  const out: Vec[] = [];
  for (let y = from.y - COIN_RANGE; y <= from.y + COIN_RANGE; y++) {
    for (let x = from.x - COIN_RANGE; x <= from.x + COIN_RANGE; x++) {
      const p = { x, y };
      const d = Math.hypot(x - from.x, y - from.y);
      if (d > 0 && d <= COIN_RANGE && !solid(level, s, p) && lineOfSight(level, s, from, p)) out.push(p);
    }
  }
  return out;
}

export function availableActions(level: Level, s: GameState, id: ThiefId): ThiefAction["type"][] {
  const t = s.thieves[id];
  if (!playing(s) || t.caught || t.acted) return [];
  const out: ThiefAction["type"][] = [];
  const ability = THIEVES[id].ability;
  if (ability === "force_vault" && !s.vault.open && adjacent(t.pos, level.vaultDoor)) out.push("force_vault");
  if (ability === "throw_coin" && coinTargets(level, s, id).length > 0) out.push("throw_coin");
  if (s.diamond && (same(t.pos, s.diamond) || adjacent(t.pos, s.diamond))) out.push("take_diamond");
  return out;
}

export function thiefAct(level: Level, state: GameState, id: ThiefId, action: ThiefAction): Result {
  if (!availableActions(level, state, id).includes(action.type)) throw new Error(`illegal action: ${id} ${action.type}`);
  const s = clone(state);
  const events: GameEvent[] = [];
  const t = s.thieves[id];
  switch (action.type) {
    case "force_vault":
      s.vault.progress++;
      events.push({ type: "vault_progress", progress: s.vault.progress });
      if (s.vault.progress >= VAULT_FORCE_ACTIONS) {
        s.vault.open = true;
        events.push({ type: "vault_opened" });
        checkSightings(level, s, events, new Set()); // la puerta abierta ya no tapa la vista
      }
      break;
    case "throw_coin":
      if (!coinTargets(level, state, id).some((p) => same(p, action.target))) throw new Error(`illegal coin target ${key(action.target)}`);
      s.noises.push({ pos: { ...action.target }, turn: s.turn });
      events.push({ type: "noise_made", at: { ...action.target }, heardBy: heardBy(level, s, action.target) });
      break;
    case "take_diamond":
      t.hasDiamond = true;
      s.diamond = null;
      events.push({ type: "diamond_taken", thief: id });
      break;
  }
  t.acted = true;
  updateOutcome(level, s, events);
  return { state: s, events };
}

/** La infiltrada: 2 usos en la partida; dura el turno en que se activa. */
export function canUseSpy(s: GameState): boolean {
  return playing(s) && s.spy.usesLeft > 0 && !s.spy.activeThisTurn;
}

export function activateSpy(state: GameState): Result {
  if (!canUseSpy(state)) throw new Error("illegal: the spy is not available");
  const s = clone(state);
  s.spy.usesLeft--;
  s.spy.activeThisTurn = true;
  return { state: s, events: [] };
}

export function canUseRadio(s: GameState): boolean {
  return playing(s) && s.radio.usesLeft > 0 && !s.radio.usedThisTurn;
}

export function sendRadio(level: Level, state: GameState, kind: RadioReport["kind"], zone: ZoneId): Result {
  if (!canUseRadio(state) || !level.zones[zone]) throw new Error(`illegal radio report: ${kind} ${zone}`);
  const s = clone(state);
  const report: RadioReport = { kind, zone, turn: s.turn };
  s.radio.active = report;
  s.radio.usesLeft--;
  s.radio.usedThisTurn = true;
  return { state: s, events: [{ type: "radio_sent", report }] };
}
