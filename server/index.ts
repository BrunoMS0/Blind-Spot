// App de Hono: solo HTTP. /api/enemy-turn (con el mock) llega en la fase 1; /api/spy y Jev real, en la 2.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { GAME_NAME, SERVER_PORT } from "../src/shared/config";

const app = new Hono().basePath("/api");

// jevKey: solo si la key está cargada, nunca su valor.
app.get("/health", (c) => c.json({ ok: true, game: GAME_NAME, jevKey: Boolean(process.env.AI_GATEWAY_API_KEY) }));

const port = Number(process.env.PORT ?? SERVER_PORT);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[${GAME_NAME}] server on http://localhost:${info.port}`);
});
