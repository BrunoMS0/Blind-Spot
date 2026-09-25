// Pruebas del proveedor real y del servidor sin tocar el gateway: un fetch falso simula los 429.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { choice, noul } from "@typesafe-ai/sdk";
import { LEVELS } from "../src/shared/level";
import { newGame } from "../src/shared/rules";
import { BadRequest, decideTurn } from "../server/turn";
import { createJevProvider, JevUnavailable } from "../server/providers/jev";
import type { ProviderInput } from "../server/providers/types";

const OK_BODY = {
  model: "jev",
  answers: {
    vega_plan: { type: "choice", choice: "patrol", probabilities: { patrol: 0.7, hold: 0.3 }, confidence: 0.4 },
    raise_alarm: { type: "noul", noul: 0.1 },
  },
  usage: { input_tokens: 120, output_tokens: 5 },
};

/** Responde con los códigos dados, en orden; el último se repite. */
function fakeGateway(statuses: number[]) {
  const calls: number[] = [];
  const fetch = async () => {
    const status = statuses[Math.min(calls.length, statuses.length - 1)]!;
    calls.push(status);
    return status === 200
      ? new Response(JSON.stringify(OK_BODY), { status, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "rate limited" }), { status, headers: { "content-type": "application/json", "retry-after-ms": "20" } });
  };
  return { fetch, calls };
}

const input = (timeoutMs: number): ProviderInput => ({
  jevState: { shared: { note: "test" } },
  questions: { vega_plan: choice("Which option?", { patrol: "patrol", hold: "hold" }), raise_alarm: noul("Raise the alarm?") },
  analysis: { guards: [], alarm: 0, radioTrust: "high", activeReport: null, vaultOpen: false, blackout: null },
  signal: AbortSignal.timeout(timeoutMs),
});

describe("proveedor real ante 429", () => {
  test("reintenta respetando Retry-After y cuenta los 429", async () => {
    const gw = fakeGateway([429, 429, 200]);
    const out = await createJevProvider({ fetch: gw.fetch, apiKey: "test", minIntervalMs: 0 }).decide(input(5000));
    assert.deepEqual(gw.calls, [429, 429, 200]);
    assert.equal(out.rateLimited, 2);
    assert.equal(out.inputTokens, 120);
  });
  test("si el tope total se acaba, JevUnavailable reintentable", async () => {
    const gw = fakeGateway([429]);
    await assert.rejects(createJevProvider({ fetch: gw.fetch, apiKey: "test", minIntervalMs: 0 }).decide(input(300)), (e) => {
      assert.ok(e instanceof JevUnavailable && e.retryable, String(e));
      assert.match(e.message, /429/);
      return true;
    });
    assert.ok(gw.calls.length >= 3, `solo ${gw.calls.length} intentos`);
  });
  test("una key inválida no es reintentable", async () => {
    const gw = fakeGateway([401]);
    await assert.rejects(createJevProvider({ fetch: gw.fetch, apiKey: "bad", minIntervalMs: 0 }).decide(input(2000)), (e) => e instanceof JevUnavailable && !e.retryable);
    assert.equal(gw.calls.length, 1);
  });
  test("el mismo estado con las mismas preguntas sale de la caché, sin llamar", async () => {
    const gw = fakeGateway([200]);
    const provider = createJevProvider({ fetch: gw.fetch, apiKey: "test", minIntervalMs: 0 });
    await provider.decide(input(2000));
    const again = await provider.decide(input(2000));
    assert.equal(gw.calls.length, 1);
    assert.equal(again.cached, true);
    assert.equal(again.inputTokens, 0);
  });
  test("el limitador espacia el inicio de dos llamadas", async () => {
    const gw = fakeGateway([200]);
    const provider = createJevProvider({ fetch: gw.fetch, apiKey: "test", minIntervalMs: 150 });
    const other = { ...input(2000), jevState: { shared: { note: "other" } } };
    const t0 = performance.now();
    await Promise.all([provider.decide(input(2000)), provider.decide(other)]);
    assert.ok(performance.now() - t0 >= 140, "la segunda esperó el intervalo");
  });
});

describe("servidor", () => {
  const level = LEVELS.museo!;
  test("el respaldo lo decide el mock y queda marcado como respaldo", async () => {
    const { response, record } = await decideTurn({ state: newGame(level, "impulsivo", 3), fallback: true });
    assert.equal(response.meta.source, "respaldo");
    assert.equal(record.source, "respaldo");
    assert.equal(record.mode, "mock");
    assert.equal(record.costUsd, 0);
  });
  test("raise_alarm cuenta solo desde 50 %: sin evidencia no, con un avistamiento sí (mock: 0.03 / 0.6)", async () => {
    const quiet = newGame(level, "cauteloso", 3);
    assert.equal((await decideTurn({ state: quiet, fallback: false })).response.raiseAlarm.raised, false);
    const seen = newGame(level, "cauteloso", 3);
    seen.guards[1]!.lastSighting = { thief: "zorro", pos: { x: 7, y: 9 }, turn: 1 };
    assert.equal((await decideTurn({ state: seen, fallback: false })).response.raiseAlarm.raised, true);
  });
  test("una foto que no corresponde al nivel se rechaza", async () => {
    const s = newGame(level, "cauteloso", 3);
    s.guards = s.guards.slice(1); // falta un guardia
    await assert.rejects(decideTurn({ state: s, fallback: false }), BadRequest);
  });
});
