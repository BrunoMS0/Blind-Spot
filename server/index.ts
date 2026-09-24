// App de Hono: solo HTTP. El turno enemigo vive en turn.ts. /api/spy y Jev real llegan en la fase 2.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { TurnRequestSchema, type TurnError } from "../src/shared/api";
import { GAME_NAME, SERVER_PORT } from "../src/shared/config";
import { BadRequest, decideTurn } from "./turn";

const app = new Hono().basePath("/api");

// jevKey: solo si la key está cargada, nunca su valor.
app.get("/health", (c) => c.json({ ok: true, game: GAME_NAME, jevKey: Boolean(process.env.AI_GATEWAY_API_KEY) }));

// Solo acepta la foto de la partida validada: no hay forma de mandarle texto libre a Jev.
app.post("/enemy-turn", bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
  const parsed = TurnRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error), retryable: false } satisfies TurnError, 400);
  try {
    return c.json(await decideTurn(parsed.data));
  } catch (e) {
    if (e instanceof BadRequest) return c.json({ error: e.message, retryable: false } satisfies TurnError, 400);
    console.error("[enemy-turn]", e);
    return c.json({ error: "internal error", retryable: true } satisfies TurnError, 500);
  }
});

const port = Number(process.env.PORT ?? SERVER_PORT);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[${GAME_NAME}] server on http://localhost:${info.port}`);
});
