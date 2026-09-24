import { defineConfig } from "vite";
import { SERVER_PORT } from "./src/shared/config.ts";

// Vite sirve el cliente y redirige /api al servidor Hono (npm run dev levanta los dos).
export default defineConfig({
  server: {
    proxy: { "/api": `http://localhost:${process.env.PORT ?? SERVER_PORT}` },
  },
});
