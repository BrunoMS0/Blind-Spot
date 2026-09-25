// Convierte el análisis del código en lo único que ve Jev: un estado corto en inglés y las preguntas.
// Nunca coordenadas ni cuadrícula: zonas, distancias de camino ya calculadas y conclusiones por opción.
import { choice, noul, type JsonValue } from "@typesafe-ai/sdk";
import { ALARM_TO_LOSE, SIGHTING_TURNS } from "../src/shared/config";
import { zoneAt, type Level } from "../src/shared/level";
import type { GameState, GuardAnalysis, GuardOption, OptionFacts, TurnAnalysis, Vec } from "../src/shared/types";
import { DOCTRINES } from "./doctrines";
import type { ProviderInput, TurnQuestions } from "./providers/types";

/** Lo que significa cada opción. Es fijo; lo que cambia cada turno va en `guards.<id>.options`. */
const OPTION_MEANING: Record<GuardOption, string> = {
  patrol: "continue the patrol route",
  investigate_noise: "walk to the noise this guard heard",
  respond_radio: "go to the zone named in the radio report",
  check_blackout: "go to the room where the lights went out",
  chase: "go after the intruder this guard saw",
  guard_vault: "go to the vault door and protect it",
  hold: "stay in place and look around",
};

const LAST_DECISION: Record<GuardOption, string> = {
  patrol: "continued the patrol",
  investigate_noise: "went to check a noise",
  respond_radio: "followed a radio report",
  check_blackout: "went to check the blackout",
  chase: "chased an intruder",
  guard_vault: "went to guard the vault",
  hold: "held position and looked around",
};

const RADIO_TRUST = { high: "high", shaken: "shaken after a false report", lying: "the radio has been lying" } as const;

export function buildJevTurn(level: Level, s: GameState, analysis: TurnAnalysis): Pick<ProviderInput, "jevState" | "questions"> {
  const zone = (id: string) => level.zones[id]?.name ?? id;
  const report = s.radio.active;

  const shared: { [key: string]: JsonValue } = {
    commander_doctrine: DOCTRINES[s.commander],
    alarm_level: `${s.alarm} of ${ALARM_TO_LOSE}`,
    radio_trust: RADIO_TRUST[analysis.radioTrust],
    radio_report: report ? (report.kind === "movement" ? `movement in the ${zone(report.zone)}` : `all clear in the ${zone(report.zone)}`) : "none",
    noises_this_turn: s.noises.length ? s.noises.map((n) => `a coin in the ${zone(zoneAt(level, n.pos) ?? "")}`) : "none",
    sightings: sightings(level, s),
    lights: s.blackout.zone ? `OUT in the ${zone(s.blackout.zone)}: nobody can see far in there` : "on everywhere",
  };

  const guards: { [id: string]: JsonValue } = {};
  const questions = {} as TurnQuestions;
  for (const a of analysis.guards) {
    const g = s.guards.find((x) => x.id === a.guard)!;
    const name = level.guards.find((x) => x.id === a.guard)?.name ?? a.guard;
    const offered = Object.keys(a.options) as GuardOption[];
    guards[a.guard] = {
      name,
      position: zone(a.zone),
      facing: a.facing,
      options: Object.fromEntries(offered.map((o) => [o, describe(level, s, g.pos, a, o, a.options[o]!)])),
      last_decision: g.lastDecision ? LAST_DECISION[g.lastDecision] : "none yet (first turn)",
    };
    questions[`${a.guard}_plan`] = choice(
      `You decide for guard ${name} only. This guard's situation and available options are in \`guards.${a.guard}\`; ignore the other guards. ` +
        "Follow the commander's doctrine in `shared.commander_doctrine` and weigh the rest of `shared` (alarm, radio trust, radio report, noises). " +
        `Which option should guard ${name} take this turn?`,
      Object.fromEntries(offered.map((o) => [o, OPTION_MEANING[o]])),
    );
  }
  questions.raise_alarm = noul(
    "Following the commander's doctrine (`shared.commander_doctrine`) and what the guards know (`shared` and `guards`), should the general alarm be raised this turn?",
  );

  return { jevState: { shared, guards }, questions };
}

/** Quién vio a un intruso y cuándo: la evidencia que necesita raise_alarm, en el estado compartido. */
function sightings(level: Level, s: GameState): JsonValue {
  const seen = s.guards.flatMap((g) => {
    const sight = g.lastSighting;
    if (!sight || s.turn - sight.turn > SIGHTING_TURNS) return [];
    const name = level.guards.find((x) => x.id === g.id)?.name ?? g.id;
    const where = level.zones[zoneAt(level, sight.pos) ?? ""]?.name ?? "museum";
    return [`${name} saw an intruder in the ${where} ${ago(s.turn - sight.turn)}`];
  });
  return seen.length ? seen : "none";
}

const ago = (turns: number) => (turns === 0 ? "this turn" : turns === 1 ? "last turn" : `${turns} turns ago`);

/** Una frase corta por opción: la conclusión del código, no los datos crudos. */
function describe(level: Level, s: GameState, from: Vec, a: GuardAnalysis, option: GuardOption, f: OptionFacts): string {
  const where = level.zones[f.zone]?.name ?? f.zone;
  const away = f.distance === 0 ? "right here" : `${f.distance} tiles ${direction(from, f.target)}`;
  switch (option) {
    case "patrol":
      return `next patrol stop: ${where}, ${away}`;
    case "investigate_noise":
      return `heard a coin drop in the ${where}, ${away}`;
    case "respond_radio":
      return `radio reports movement in the ${where}, ${away}`;
    case "check_blackout":
      return `the lights went out in the ${where}, ${away}`;
    case "chase":
      return `saw an intruder in the ${where} ${ago(s.turn - (s.guards.find((g) => g.id === a.guard)?.lastSighting?.turn ?? s.turn))}, ${away}`;
    case "guard_vault":
      return s.vault.open ? `THE VAULT DOOR IS OPEN, ${away}` : `vault door closed and locked, ${away}`;
    case "hold":
      return "stay here and look around";
  }
}

function direction(from: Vec, to: Vec): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}
