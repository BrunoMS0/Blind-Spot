// Lo que el código calcula para Jev: qué opciones tiene cada guardia este turno y los hechos de cada una
// (destino, zona, distancia de camino). Jev nunca ve esto directamente: el servidor lo convierte en frases.
// resolveEnemyTurn vuelve a llamar a analyzeTurn con el mismo estado, así cliente y servidor coinciden.
import { GUARD_OPTIONS, HEARING_RANGE, SIGHTING_TURNS } from "./config";
import { key, same, zoneAt, type Level } from "./level";
import { explore } from "./paths";
import { radioTrust } from "./rules";
import type { GameState, GuardAnalysis, GuardId, GuardOption, GuardState, OptionFacts, TurnAnalysis, Vec } from "./types";

export function analyzeTurn(level: Level, s: GameState): TurnAnalysis {
  return {
    guards: s.guards.map((g) => analyzeGuard(level, s, g)),
    alarm: s.alarm,
    radioTrust: radioTrust(s),
    activeReport: s.radio.active,
    vaultOpen: s.vault.open,
    blackout: s.blackout.zone,
  };
}

function analyzeGuard(level: Level, s: GameState, g: GuardState): GuardAnalysis {
  const dist = explore(level, s, g.pos).cells;
  const facts = (target: Vec): OptionFacts | undefined => {
    const d = dist.get(key(target))?.dist;
    const zone = zoneAt(level, target);
    return d === undefined || zone === null ? undefined : { target, zone, distance: d };
  };

  const candidates: Record<GuardOption, OptionFacts | undefined> = {
    patrol: facts(patrolTarget(level, g).target),
    investigate_noise: s.noises
      .map((n) => facts(n.pos))
      .filter((f) => f !== undefined && f.distance <= HEARING_RANGE)
      .sort((a, b) => a!.distance - b!.distance)[0],
    respond_radio: s.radio.active?.kind === "movement" && level.zones[s.radio.active.zone] ? facts(level.zones[s.radio.active.zone]!.center) : undefined,
    // Todos se enteran del apagón (se cortó la luz): cualquiera puede ir a revisar la sala.
    check_blackout: s.blackout.zone && level.zones[s.blackout.zone] ? facts(level.zones[s.blackout.zone]!.center) : undefined,
    chase: g.lastSighting && s.turn - g.lastSighting.turn <= SIGHTING_TURNS ? facts(g.lastSighting.pos) : undefined,
    guard_vault: facts(level.vaultFront),
    hold: facts(g.pos),
  };
  // Solo las que aplican, siempre en el orden de GUARD_OPTIONS.
  const options: GuardAnalysis["options"] = {};
  for (const o of GUARD_OPTIONS) if (candidates[o]) options[o] = candidates[o];
  return { guard: g.id, zone: zoneAt(level, g.pos) ?? "unknown", facing: g.facing, options };
}

/** Próxima parada de la ruta (si ya está parado en ella, la siguiente) y el índice de la que sigue. */
export function patrolTarget(level: Level, g: GuardState): { target: Vec; next: number } {
  const route = level.guards.find((x) => x.id === g.id)?.patrol ?? [g.pos];
  let index = g.patrolIndex % route.length;
  if (same(route[index]!, g.pos)) index = (index + 1) % route.length;
  return { target: route[index]!, next: (index + 1) % route.length };
}

/** Guardias que oyen un ruido en `at`: a HEARING_RANGE casillas de camino o menos. */
export function heardBy(level: Level, s: GameState, at: Vec): GuardId[] {
  return s.guards.filter((g) => explore(level, s, g.pos, undefined, HEARING_RANGE).cells.has(key(at))).map((g) => g.id);
}
