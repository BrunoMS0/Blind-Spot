// Turno enemigo: ejecuta la opción ya sorteada de cada guardia. Jev solo eligió la opción; las reglas deciden
// el camino, lo que ve cada guardia en cada paso, las capturas y los engaños de la radio.
import { GUARD_CHASE_MOVE, GUARD_MOVE, RAISE_ALARM_CAP, SIGHTING_TURNS } from "./config";
import { analyzeTurn, patrolTarget } from "./analysis";
import { adjacent, DIRS, key, same, zoneAt, type Level } from "./level";
import { explore, pathTo } from "./paths";
import { activeThieves, checkCaptures, checkSightings, clone, discoverDeception, updateOutcome, type Result } from "./rules";
import { canSee } from "./vision";
import type { EnemyDecisions, Facing, GameEvent, GameState, GuardDecision, GuardState, Vec } from "./types";

export function resolveEnemyTurn(level: Level, state: GameState, decisions: EnemyDecisions): Result {
  const s = clone(state);
  const events: GameEvent[] = [];
  const seen = new Set<string>();
  const analysis = analyzeTurn(level, state); // el mismo análisis con el que decidió el servidor
  s.alarmRaisedBy = []; // empieza la fase enemiga

  for (const g of s.guards) {
    if (s.outcome.status !== "playing") break;
    const asked = decisions.guards.find((d) => d.guard === g.id);
    const facts = asked ? analysis.guards.find((a) => a.guard === g.id)?.options[asked.option] : undefined;
    // Una opción que no se le ofreció a este guardia no se ejecuta: se queda en su lugar.
    const decision: GuardDecision = asked && facts ? asked : { guard: g.id, option: "hold", probability: asked?.probability ?? 1 };
    events.push({ type: "guard_decided", decision });
    g.lastDecision = decision.option;
    const patrol = patrolTarget(level, g); // antes de moverse: la parada hacia la que va

    if (decision.option === "hold" || !facts) {
      lookAround(level, s, g, events, seen);
    } else {
      walk(level, s, g, facts.target, decision.option === "chase" ? GUARD_CHASE_MOVE : GUARD_MOVE, events, seen);
    }

    if (decision.option === "patrol" && same(g.pos, patrol.target)) g.patrolIndex = patrol.next;
    if (decision.option === "guard_vault" && same(g.pos, level.vaultFront)) turn(g, facingOf(g.pos, level.vaultDoor), events);
    if (decision.option === "chase" && facts) {
      const arrived = same(g.pos, facts.target) || adjacent(g.pos, facts.target);
      if (arrived && g.lastSighting && same(g.lastSighting.pos, facts.target) && !seesSomeone(level, s, g)) g.lastSighting = null;
    }
    if (decision.option === "respond_radio") {
      const report = s.radio.active;
      if (report?.kind === "movement" && zoneAt(level, g.pos) === report.zone) {
        if (seesSomeone(level, s, g)) s.radio.active = null; // el reporte era cierto
        else discoverDeception(s, g.id, events);
      }
    }

    checkCaptures(s, g, events);
    updateOutcome(level, s, events);
  }

  if (s.outcome.status === "playing" && decisions.raiseAlarm && s.alarm < RAISE_ALARM_CAP) {
    s.alarm++;
    events.push({ type: "alarm_raised", level: s.alarm, cause: "raise_alarm" });
  }
  checkSightings(level, s, events, seen); // al final del turno enemigo
  updateOutcome(level, s, events);

  // Prepara el turno siguiente del jugador.
  events.push({ type: "turn_ended", turn: s.turn });
  s.turn++;
  s.alarmRaisedBy = [];
  s.noises = [];
  s.radio.usedThisTurn = false;
  s.spy.activeThisTurn = false;
  for (const t of Object.values(s.thieves)) Object.assign(t, { moved: false, acted: false });
  for (const g of s.guards) if (g.lastSighting && s.turn - g.lastSighting.turn > SIGHTING_TURNS) g.lastSighting = null;
  return { state: s, events };
}

function facingOf(from: Vec, to: Vec): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function seesSomeone(level: Level, s: GameState, g: GuardState): boolean {
  return activeThieves(s).some((t) => canSee(level, s, g, t.pos));
}

/** Gira sin moverse. */
function turn(g: GuardState, facing: Facing, events: GameEvent[]): void {
  if (g.facing === facing) return;
  g.facing = facing;
  events.push({ type: "guard_moved", guard: g.id, path: [], facing });
}

/** Camina hasta `steps` casillas hacia `target`, mirando hacia donde camina y revisando la visión en cada paso. */
function walk(level: Level, s: GameState, g: GuardState, target: Vec, steps: number, events: GameEvent[], seen: Set<string>): void {
  const occupied = () => new Set([...s.guards.filter((o) => o !== g).map((o) => key(o.pos)), ...activeThieves(s).map((t) => key(t.pos))]);
  const blocked = occupied();
  blocked.delete(key(target)); // se puede ir hacia una casilla ocupada (perseguir): se frena al lado
  const path = pathTo(explore(level, s, g.pos, blocked), target) ?? [];
  let walked = 0;
  for (const step of path.slice(0, steps)) {
    if (occupied().has(key(step))) break;
    g.facing = facingOf(g.pos, step);
    g.pos = { ...step };
    walked++;
    events.push({ type: "guard_moved", guard: g.id, path: [{ ...step }], facing: g.facing });
    checkSightings(level, s, events, seen, [g]);
  }
  if (walked === 0 && path[0]) turn(g, facingOf(g.pos, path[0]), events); // bloqueado: mira hacia allá
}

/** hold: se queda y mira en las cuatro direcciones; termina mirando al primer ladrón que vio, si vio. */
function lookAround(level: Level, s: GameState, g: GuardState, events: GameEvent[], seen: Set<string>): void {
  const original = g.facing;
  let final: Facing | null = null;
  for (const f of [original, ...(Object.keys(DIRS) as Facing[]).filter((d) => d !== original)]) {
    g.facing = f;
    checkSightings(level, s, events, seen, [g]);
    if (!final && seesSomeone(level, s, g)) final = f;
  }
  g.facing = final ?? original;
  events.push({ type: "guard_moved", guard: g.id, path: [], facing: g.facing });
}
