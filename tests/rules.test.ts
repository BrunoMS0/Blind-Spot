// Pruebas de las reglas (src/shared) y del armado del turno en el servidor. npm test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { analyzeTurn } from "../src/shared/analysis";
import { GameStateSchema, TurnRequestSchema } from "../src/shared/api";
import { resolveEnemyTurn } from "../src/shared/enemy-turn";
import { LEVELS } from "../src/shared/level";
import { activateSpy, availableActions, moveThief, sendRadio, thiefAct } from "../src/shared/player-turn";
import { mulberry32, rngFor, sample } from "../src/shared/rng";
import { newGame } from "../src/shared/rules";
import type { EnemyDecisions, GameState, GuardOption } from "../src/shared/types";
import { canSee } from "../src/shared/vision";
import { buildJevTurn } from "../server/jev-state";
import { decideTurn } from "../server/turn";

const level = LEVELS.museo!;
const fresh = (): GameState => newGame(level, "cauteloso", 1);
const guard = (s: GameState, id: string) => s.guards.find((g) => g.id === id)!;
const everyone = (option: GuardOption, raiseAlarm = false): EnemyDecisions => ({
  guards: fresh().guards.map((g) => ({ guard: g.id, option, probability: 1 })),
  raiseAlarm,
});

describe("nivel", () => {
  test("museo: 20×14 con salida, bóveda y diamante", () => {
    assert.equal(level.width, 20);
    assert.equal(level.height, 14);
    assert.deepEqual(level.exit, { x: 0, y: 11 });
    assert.deepEqual(level.vaultFront, { x: 16, y: 5 });
    assert.deepEqual(Object.keys(level.zones).sort(), ["central_hall", "east_wing", "entrance", "vault", "west_gallery"]);
  });
});

describe("visión", () => {
  const s = fresh();
  const at = (x: number, y: number, facing: "north" | "east" | "south" | "west") => ({ pos: { x, y }, facing });
  test("ve dentro del cono de 4 casillas y 90°, no detrás ni más lejos", () => {
    assert.ok(canSee(level, s, at(10, 6, "west"), { x: 6, y: 6 }));
    assert.ok(canSee(level, s, at(10, 6, "west"), { x: 7, y: 4 }));
    assert.ok(!canSee(level, s, at(10, 6, "west"), { x: 12, y: 6 }));
    assert.ok(!canSee(level, s, at(10, 6, "west"), { x: 5, y: 6 }));
  });
  test("muros y pedestales tapan; la puerta de la bóveda solo cerrada", () => {
    assert.ok(!canSee(level, s, at(10, 4, "west"), { x: 7, y: 4 }), "pedestal en (8,4)");
    assert.ok(!canSee(level, s, at(6, 5, "west"), { x: 4, y: 5 }), "muro en (5,5)");
    assert.ok(!canSee(level, s, at(16, 6, "north"), { x: 16, y: 3 }));
    assert.ok(canSee(level, { vault: { progress: 2, open: true } }, at(16, 6, "north"), { x: 16, y: 3 }));
  });
});

describe("alarma", () => {
  test("cruzar un cono sube la alarma una sola vez por fase", () => {
    const s = fresh();
    s.thieves.zorro.pos = { x: 7, y: 8 };
    const r = moveThief(level, s, "zorro", { x: 7, y: 4 }); // 4 pasos, visible para Rojas en casi todos
    assert.equal(r.state.alarm, 1);
    assert.equal(r.events.filter((e) => e.type === "thief_seen").length, 1);
    assert.deepEqual(guard(r.state, "rojas").lastSighting, { thief: "zorro", pos: { x: 7, y: 4 }, turn: 1 });
    assert.equal(s.alarm, 0, "no modifica el estado que recibe");
  });
  test("raise_alarm sube 1 pero nunca de 2 a 3", () => {
    const s = fresh();
    assert.equal(resolveEnemyTurn(level, s, everyone("hold", true)).state.alarm, 1);
    s.alarm = 2;
    const r = resolveEnemyTurn(level, s, everyone("hold", true));
    assert.equal(r.state.alarm, 2);
    assert.equal(r.state.outcome.status, "playing");
  });
  test("con alarma 3 se pierde", () => {
    const s = fresh();
    s.alarm = 2;
    s.thieves.zorro.pos = { x: 7, y: 8 };
    const r = moveThief(level, s, "zorro", { x: 7, y: 6 });
    assert.deepEqual(r.state.outcome, { status: "lost", reason: "alarm" });
    assert.ok(r.events.some((e) => e.type === "game_over"));
  });
});

describe("capturas y victoria", () => {
  test("un guardia que termina al lado de un ladrón lo atrapa; si lleva el diamante, se pierde", () => {
    const s = fresh();
    s.thieves.zorro.pos = { x: 9, y: 6 }; // al lado de Rojas (10,6)
    s.thieves.zorro.hasDiamond = true;
    s.diamond = null;
    const r = resolveEnemyTurn(level, s, everyone("hold"));
    assert.deepEqual(
      r.events.filter((e) => e.type === "thief_caught"),
      [{ type: "thief_caught", thief: "zorro", guard: "rojas" }],
      "solo Rojas, que está al lado, y solo a Zorro",
    );
    assert.ok(!r.state.thieves.llave.caught && !r.state.thieves.eco.caught);
    assert.deepEqual(r.state.outcome, { status: "lost", reason: "diamond_carrier_caught" });
  });
  test("se gana cuando el ladrón con el diamante llega a la salida", () => {
    const s = fresh();
    Object.assign(s.thieves.zorro, { pos: { x: 1, y: 11 }, hasDiamond: true });
    s.diamond = null;
    assert.deepEqual(moveThief(level, s, "zorro", level.exit).state.outcome, { status: "won" });
  });
});

describe("bóveda", () => {
  test("solo Llave la fuerza, con dos acciones frente a la puerta", () => {
    const s = fresh();
    s.thieves.llave.pos = { ...level.vaultFront };
    s.thieves.zorro.pos = { x: 17, y: 5 }; // al lado de la puerta pero sin la habilidad
    assert.ok(!availableActions(level, s, "zorro").includes("force_vault"));
    const once = thiefAct(level, s, "llave", { type: "force_vault" });
    assert.equal(once.state.vault.progress, 1);
    assert.ok(!availableActions(level, once.state, "llave").includes("force_vault"), "una acción por turno");
    once.state.thieves.llave.acted = false; // turno siguiente
    const twice = thiefAct(level, once.state, "llave", { type: "force_vault" });
    assert.ok(twice.state.vault.open);
    assert.ok(twice.events.some((e) => e.type === "vault_opened"));

    twice.state.thieves.zorro.pos = { x: 17, y: 3 }; // al lado del diamante (17,2)
    const taken = thiefAct(level, twice.state, "zorro", { type: "take_diamond" });
    assert.ok(taken.state.thieves.zorro.hasDiamond);
    assert.equal(taken.state.diamond, null);
  });
});

describe("radio", () => {
  test("un guardia que acude a un reporte falso descubre el engaño", () => {
    const s = sendRadio(level, fresh(), "movement", "central_hall").state;
    const decisions = everyone("patrol");
    decisions.guards.find((d) => d.guard === "rojas")!.option = "respond_radio";
    const r = resolveEnemyTurn(level, s, decisions);
    assert.equal(r.state.radio.deceptions, 1);
    assert.equal(r.state.radio.active, null);
    assert.ok(r.events.some((e) => e.type === "deception_discovered" && e.guard === "rojas"));
  });
  test("ver a un ladrón en una zona reportada como despejada también es un engaño", () => {
    const s = sendRadio(level, fresh(), "all_clear", "central_hall").state;
    s.thieves.zorro.pos = { x: 7, y: 8 };
    const r = moveThief(level, s, "zorro", { x: 7, y: 6 });
    assert.equal(r.state.radio.deceptions, 1);
  });
  test("la infiltrada: dos usos, uno por turno, se apaga al terminar el turno enemigo", () => {
    const once = activateSpy(fresh()).state;
    assert.deepEqual(once.spy, { usesLeft: 1, activeThisTurn: true });
    assert.throws(() => activateSpy(once));
    const next = resolveEnemyTurn(level, once, everyone("hold")).state;
    assert.equal(next.spy.activeThisTurn, false);
    assert.equal(activateSpy(next).state.spy.usesLeft, 0);
  });
  test("una por turno y tres en total", () => {
    const s = sendRadio(level, fresh(), "movement", "vault").state;
    assert.throws(() => sendRadio(level, s, "movement", "vault"));
    assert.equal(s.radio.usesLeft, 2);
  });
});

describe("análisis: solo las opciones que aplican", () => {
  test("al empezar: patrullar, bóveda o quedarse", () => {
    for (const g of analyzeTurn(level, fresh()).guards) assert.deepEqual(Object.keys(g.options), ["patrol", "guard_vault", "hold"]);
  });
  test("ruido, radio y avistamiento agregan sus opciones", () => {
    const s = sendRadio(level, fresh(), "movement", "west_gallery").state;
    s.noises = [{ pos: { x: 7, y: 6 }, turn: 1 }];
    guard(s, "soto").lastSighting = { thief: "eco", pos: { x: 2, y: 5 }, turn: 1 };
    const a = Object.fromEntries(analyzeTurn(level, s).guards.map((g) => [g.guard, Object.keys(g.options)]));
    assert.ok(a.rojas!.includes("investigate_noise"), "Rojas está a 3 casillas");
    assert.ok(!a.vega!.includes("investigate_noise"), "Vega está a más de 8 casillas de camino");
    assert.ok(a.soto!.includes("chase") && !a.rojas!.includes("chase"));
    assert.ok(Object.values(a).every((opts) => opts.includes("respond_radio")));
  });
});

describe("sorteo", () => {
  test("una opción con 30 % sale ~3 de cada 10 veces", () => {
    const rng = mulberry32(42);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) if (sample({ a: 0.3, b: 0.7 }, rng) === "a") hits++;
    assert.ok(Math.abs(hits - 3000) < 150, `salió ${hits} de 10000`);
  });
  test("mismo (semilla, turno, guardia) → mismo sorteo", () => {
    assert.equal(rngFor(7, 3, "vega")(), rngFor(7, 3, "vega")());
    assert.notEqual(rngFor(7, 3, "vega")(), rngFor(7, 3, "rojas")());
  });
  test("misma partida y mismas decisiones → mismo resultado", () => {
    const s = fresh();
    const before = JSON.stringify(s);
    assert.deepEqual(resolveEnemyTurn(level, s, everyone("patrol")), resolveEnemyTurn(level, s, everyone("patrol")));
    assert.equal(JSON.stringify(s), before);
  });
});

describe("servidor", () => {
  test("la foto de una partida nueva pasa la validación de zod", () => {
    assert.equal(TurnRequestSchema.parse({ state: fresh() }).fallback, false);
  });
  test("cada pregunta de guardia ofrece exactamente sus opciones y el estado no trae coordenadas", () => {
    const s = fresh();
    s.noises = [{ pos: { x: 7, y: 6 }, turn: 1 }];
    const { jevState, questions } = buildJevTurn(level, s, analyzeTurn(level, s));
    assert.deepEqual(Object.keys(questions), ["vega_plan", "rojas_plan", "soto_plan", "raise_alarm"]);
    const guards = jevState.guards as Record<string, { options: Record<string, string> }>;
    for (const id of ["vega", "rojas", "soto"]) assert.deepEqual(Object.keys(questions[`${id}_plan`]!.criteria), Object.keys(guards[id]!.options));
    assert.ok(!JSON.stringify(jevState).includes('"x"'));
  });
  test("20 turnos con el mock: siempre opciones ofrecidas y estado válido", async () => {
    let s = fresh();
    for (let i = 0; i < 20 && s.outcome.status === "playing"; i++) {
      const offered = Object.fromEntries(analyzeTurn(level, s).guards.map((g) => [g.guard, Object.keys(g.options)]));
      const { response: r } = await decideTurn("enemy-turn", { state: s, fallback: false });
      for (const g of r.guards) assert.ok(offered[g.guard]!.includes(g.option), `${g.guard}: ${g.option}`);
      s = resolveEnemyTurn(level, s, { guards: r.guards, raiseAlarm: r.raiseAlarm.raised }).state;
      GameStateSchema.parse(s);
    }
  });
});
