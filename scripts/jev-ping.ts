// Verifica la conexión con Jev: lista los modelos del gateway y hace UNA llamada real.
// Sin reintentos a propósito: si el gateway devuelve 429, se ve aquí en vez de quedar oculto.
//   npm run jev:ping
// ponytail: crea su propio cliente; en la fase 2 usará el de server/providers/jev.ts.
import { choice, noul, RateLimitError, TypeSafeClient } from "@typesafe-ai/sdk";

const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const model = process.env.JEV_MODEL || "jev";
if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set in .env");

const client = new TypeSafeClient({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: "https://ai-gateway.vercel.sh/typesafe",
  defaultModel: model,
  retry: { maxRetries: 0 },
});

try {
  const models = await client.models.list();
  console.log("models:", models.map((m) => m.name));

  const started = performance.now();
  const result = await client.systemOne({
    state: { guard: "Vega", position: "east wing", options: { guard_vault: "THE VAULT DOOR IS OPEN, 2 tiles away", hold: "stay here and look around" } },
    questions: {
      vega_plan: choice("As guard Vega (`guard`), which option do you take?", { guard_vault: "go to the vault", hold: "stay here" }),
      vault_open: noul("Is the vault door open?"),
    },
  });
  console.log({
    requestedModel: model,
    answeredModel: result.model,
    latencyMs: Math.round(performance.now() - started),
    vega_plan: result.answers.vega_plan.probabilities,
    vault_open: result.answers.vault_open.noul,
    usage: result.usage,
    costUsd: result.usage.input_tokens * USD_PER_INPUT_TOKEN,
  });
} catch (e) {
  if (e instanceof RateLimitError) {
    console.error(`429 from gateway (retryAfterMs=${e.retryAfterMs ?? "none"})`);
    process.exit(1);
  }
  throw e;
}
