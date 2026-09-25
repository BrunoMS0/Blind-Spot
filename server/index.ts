// App de Hono: solo HTTP. Las decisiones viven en turn.ts.
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { TurnRequestSchema, type TurnError } from "../src/shared/api";
import { GAME_NAME } from "../src/shared/config";
import { recordSpend, spentToday } from "./budget";
import { appendDecision } from "./decision-log";
import { env } from "./env";
import { JevUnavailable } from "./providers/jev";
import { BadRequest, decideTurn } from "./turn";

const app = new Hono().basePath("/api");

// jevKey: solo si la key está cargada, nunca su valor.
app.get("/health", (c) =>
  c.json({
    ok: true,
    game: GAME_NAME,
    jevKey: Boolean(env.AI_GATEWAY_API_KEY),
    mode: env.JEV_MODE,
    model: env.JEV_MODEL,
    budget: { spentTodayUsd: spentToday(), dailyLimitUsd: env.JEV_DAILY_BUDGET_USD },
  }),
);

// Solo acepta la foto de la partida validada: no hay forma de mandarle texto libre a Jev.
app.post("/enemy-turn", bodyLimit({ maxSize: 64 * 1024 }), async (c: Context) => {
  const parsed = TurnRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error), retryable: false } satisfies TurnError, 400);
  try {
    const { response, record } = await decideTurn(parsed.data);
    appendDecision(record);
    recordSpend(record.costUsd);
    return c.json(response);
  } catch (e) {
    if (e instanceof BadRequest) return c.json({ error: e.message, retryable: false } satisfies TurnError, 400);
    if (e instanceof JevUnavailable) return c.json({ error: e.message, retryable: e.retryable } satisfies TurnError, 503);
    console.error("[enemy-turn]", e);
    return c.json({ error: "internal error", retryable: true } satisfies TurnError, 500);
  }
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[${GAME_NAME}] server on http://localhost:${info.port}  mode=${env.JEV_MODE}  model=${env.JEV_MODEL}  minInterval=${env.JEV_MIN_INTERVAL_MS}ms`);
});
