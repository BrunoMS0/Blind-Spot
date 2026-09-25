// Banco de situaciones fijas con la conducta esperada: ¿funcionan las doctrinas y el estado que ve Jev?
//   npm run bench                  mock (gratis). El mock no lee la doctrina: es la línea base "solo código".
//   npm run bench -- --real        Jev real (~11 llamadas, ~$0.0006; respeta el tope diario)
//   npm run bench -- --real --save v1   además guarda logs/bench-v1.json para comparar versiones
// Todo cambio en server/jev-state.ts o server/doctrines.ts se mide aquí antes de darlo por bueno.
// Agregar situaciones al final; no cambiar las existentes (así las versiones siguen siendo comparables).
import { mkdirSync, writeFileSync } from "node:fs";
import { analyzeTurn } from "../src/shared/analysis";
import { LEVELS } from "../src/shared/level";
import { newFixedGame } from "../src/shared/rules";
import type { CommanderId, GameState, GuardOption } from "../src/shared/types";
import { withinBudget } from "../server/budget";
import { buildJevTurn } from "../server/jev-state";
import { jevProvider } from "../server/providers/jev";
import { mockProvider } from "../server/providers/mock";

type Expect = { guard: string; top: GuardOption } | { guard: string; notTop: GuardOption } | { alarm: "yes" | "no" };
type Situation = { name: string; commander: CommanderId; setup: (s: GameState) => void; expect: Expect };

const level = LEVELS.museo!;
const noise = (s: GameState) => void (s.noises = [{ pos: { x: 7, y: 6 }, turn: 1 }]); // a 3 casillas de Rojas
const report = (s: GameState) => void (s.radio.active = { kind: "movement", zone: "west_gallery", turn: 1 });
const deceived = (s: GameState) => void (s.radio.deceptions = 1);
const blackout = (s: GameState) => void (s.blackout.zone = "central_hall");
const sighting = (s: GameState) => {
  s.turn = 2;
  s.guards.find((g) => g.id === "rojas")!.lastSighting = { thief: "zorro", pos: { x: 7, y: 9 }, turn: 1 };
};

// Los pares cambian SOLO el comandante (mismo estado, mismo guardia), así miden la doctrina y nada más.
// El mock no lee la doctrina: en cada par acierta a lo sumo uno.
const SITUATIONS: Situation[] = [
  { name: "impulsivo, Rojas a 3 casillas de un ruido", commander: "impulsivo", setup: noise, expect: { guard: "rojas", top: "investigate_noise" } },
  { name: "cauteloso, el mismo ruido", commander: "cauteloso", setup: noise, expect: { guard: "rojas", notTop: "investigate_noise" } },
  { name: "impulsivo, reporte de radio a 10 casillas de Rojas", commander: "impulsivo", setup: report, expect: { guard: "rojas", top: "respond_radio" } },
  { name: "cauteloso, el mismo reporte", commander: "cauteloso", setup: report, expect: { guard: "rojas", notTop: "respond_radio" } },
  { name: "rencoroso sin engaños, reporte en la zona de Soto", commander: "rencoroso", setup: report, expect: { guard: "soto", top: "respond_radio" } },
  { name: "rencoroso tras un engaño, el mismo reporte", commander: "rencoroso", setup: (s) => (report(s), deceived(s)), expect: { guard: "soto", notTop: "respond_radio" } },
  { name: "impulsivo tras un engaño, el mismo reporte", commander: "impulsivo", setup: (s) => (report(s), deceived(s)), expect: { guard: "soto", top: "respond_radio" } },
  { name: "cauteloso, bóveda abierta", commander: "cauteloso", setup: (s) => void (s.vault = { progress: 2, open: true }), expect: { guard: "vega", top: "guard_vault" } },
  { name: "cauteloso, Rojas vio a un intruso el turno pasado", commander: "cauteloso", setup: sighting, expect: { guard: "rojas", top: "chase" } },
  { name: "rencoroso tras un engaño y un avistamiento", commander: "rencoroso", setup: (s) => (deceived(s), sighting(s)), expect: { alarm: "yes" } },
  { name: "cauteloso sin ninguna evidencia", commander: "cauteloso", setup: () => {}, expect: { alarm: "no" } },
  // v3: el apagón de Zorro (Soto está en la galería oeste, al lado del salón a oscuras)
  { name: "impulsivo, apagón en el salón central", commander: "impulsivo", setup: blackout, expect: { guard: "soto", top: "check_blackout" } },
  { name: "cauteloso, el mismo apagón", commander: "cauteloso", setup: blackout, expect: { guard: "soto", notTop: "check_blackout" } },
];

const real = process.argv.includes("--real");
const saveIndex = process.argv.indexOf("--save");
const saveAs = saveIndex >= 0 ? process.argv[saveIndex + 1] : undefined;
if (real && !withinBudget()) throw new Error("daily Jev budget reached");
const provider = real ? jevProvider : mockProvider;

const rows = [];
for (const sit of SITUATIONS) {
  const s = newFixedGame(level, sit.commander, 1); // posiciones del nivel: situaciones exactas y comparables
  sit.setup(s);
  const analysis = analyzeTurn(level, s);
  const { jevState, questions } = buildJevTurn(level, s, analysis);
  const out = await provider.decide({ jevState, questions, analysis, signal: AbortSignal.timeout(30_000) });

  let got: string;
  let ok: boolean;
  if ("alarm" in sit.expect) {
    const p = out.answers.raise_alarm.noul;
    got = `raise_alarm ${p.toFixed(2)}`;
    ok = sit.expect.alarm === "yes" ? p >= 0.5 : p < 0.5;
  } else {
    const a = out.answers[`${sit.expect.guard}_plan`]!;
    const probs = a.probabilities as Partial<Record<GuardOption, number>>;
    const top = a.choice;
    got = `${top} ${(probs[top] ?? 0).toFixed(2)}`;
    ok = "top" in sit.expect ? top === sit.expect.top : top !== sit.expect.notTop;
    const target = "top" in sit.expect ? sit.expect.top : sit.expect.notTop;
    got += ` · p(${target})=${(probs[target] ?? 0).toFixed(2)}`;
  }
  const expected = "alarm" in sit.expect ? `alarm ${sit.expect.alarm}` : "top" in sit.expect ? `${sit.expect.guard}: ${sit.expect.top}` : `${sit.expect.guard}: no ${sit.expect.notTop}`;
  rows.push({ situation: sit.name, expected, got, ok: ok ? "✓" : "✗", tokens: out.inputTokens, "429": out.rateLimited ?? 0 });
}

console.table(rows);
console.log(`${provider.mode}: ${rows.filter((r) => r.ok === "✓").length}/${rows.length} as expected${real ? "" : " (mock ignores doctrine: this is the code-only baseline)"}`);
if (saveAs && !saveAs.startsWith("--")) {
  mkdirSync("logs", { recursive: true });
  writeFileSync(`logs/bench-${saveAs}.json`, JSON.stringify({ mode: provider.mode, ts: new Date().toISOString(), rows }, null, 2));
  console.log(`saved logs/bench-${saveAs}.json`);
}
