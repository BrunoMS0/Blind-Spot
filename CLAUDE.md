# El golpe — guía para Claude

Juego táctico por turnos de robo nocturno a un museo: el jugador mueve a los ladrones y Jev (TypeSafe AI)
decide qué hacen los guardias. Proyecto para aprender a usar bien Jev: **la claridad del código importa más
que las features.** Reglas, módulos, flujo de un turno y eventos están en `ARCHITECTURE.md`.

## Stack (decidido, no cambiar)

- Node ≥ 20.19, TypeScript strict en todo el proyecto.
- Cliente: Vite + **Phaser 3** (fijado en `^3.90`; el `latest` de npm ya es Phaser 4, no actualizar).
- Servidor: Hono sobre `@hono/node-server`, ejecutado con `tsx` en desarrollo.
- Jev: SDK oficial `@typesafe-ai/sdk` apuntando al AI Gateway de Vercel
  (`baseURL: "https://ai-gateway.vercel.sh/typesafe"`, key `AI_GATEWAY_API_KEY` en `.env`).
  **No usar el AI SDK de Vercel.**
- zod para validar la foto de la partida y el entorno.

## Jev y el skill de TypeSafe

- Antes de escribir código que use Jev, cargar el skill `typesafe:typesafe-ai` y leer la documentación en
  vivo (`https://docs.typesafe.ai/llms.txt`; agregar `.md` a las rutas). Verificar la API contra
  `node_modules/@typesafe-ai/sdk/dist/index.d.mts`. No inventar métodos ni parámetros.
- API verificada (SDK 0.6.0): `new TypeSafeClient({ apiKey, baseURL, defaultModel, timeout, retry })`,
  `client.systemOne({ state, questions, model? }, { signal, timeout, retry })`, helpers `choice()`,
  `noul()` y `score()`, error `RateLimitError` con `retryAfterMs`. La respuesta trae `model`, `answers` y
  `usage.input_tokens`.
- Modelo en `JEV_MODEL`. La documentación lista `jev-1.13.0` (alias `jev-latest`), pero el gateway de Vercel
  solo lista `jev` y responde `model: "jev"`, sin versión (verificado con `jev:ping` el 2026-09-24). No se
  puede fijar: registrar el modelo pedido y `response.model` en cada decisión, y fijarlo si algún día se puede.
- Estado, instrucciones y criterios **en inglés**; la interfaz, en español.
- Precio: $0.042 por millón de tokens de entrada (los de salida no se cobran).

## Principio: Jev decide, el código calcula

- Visión, caminos, distancias, quién oye qué y la confianza en la radio se calculan en `src/shared`.
- A Jev le llegan conclusiones cortas por opción, nunca la cuadrícula. Solo las opciones que aplican.
- Un turno enemigo = **una** llamada: `<guardia>_plan` (Choice) por guardia y `raise_alarm` (Noul). Cada
  pregunta de guardia cita su parte del estado (`guards.<id>`).
- La opción se **sortea** con las probabilidades de Jev (`SAMPLING=sample|argmax`), no se toma la más probable.
- Los comandantes difieren **solo** en el texto de su doctrina. El mock no lee la doctrina: es la línea base
  "solo código".

## Política ante 429 (plan gratuito del gateway)

Medido en BomberJev: el plan gratuito devuelve 429 de forma variable, incluso a 30 llamadas por minuto.
(En El golpe, 2026-09-24: 0 × 429 en 35 llamadas espaciadas 2 s.) Todo vive en `server/providers/jev.ts`:

- Reintentos del propio SDK: respeta `Retry-After`, si no espera 1·2·4·8·8… s; tope total
  `JEV_RETRY_TOTAL_MS` con un `AbortSignal` (el SDK no tiene tope total). La interfaz muestra "pensando".
- Si aun así falla: `JevUnavailable` → 503 con `retryable`, y el jugador elige **Reintentar** o **Usar
  decisión simulada** (mock, registrada como `source: "respaldo"`). Las métricas excluyen las de respaldo.
  No agregar respaldos automáticos: el jugador decide.
- Limitador: de a una llamada y `JEV_MIN_INTERVAL_MS` entre inicios. Por eso el conteo de 429 por llamada
  (`rateLimited`, contado en un `fetch` envoltorio) es exacto.
- Caché por (estado, preguntas): la infiltrada y el turno enemigo no repiten una llamada idéntica.
- Tope diario `JEV_DAILY_BUDGET_USD`; al superarlo, decide el mock y se avisa en `meta.note`.
- Las pruebas de 429 usan un `fetch` falso (`tests/jev.test.ts`): no tocan el gateway.

## Reglas operativas

- `src/shared` es puro (sin Phaser, DOM ni Node; lo impone su tsconfig). Las reglas emiten eventos tipados y
  nunca dibujan. Phaser solo dibuja, anima y lee input.
- Los endpoints solo aceptan `TurnRequest` validado con zod. Nada de texto libre hacia Jev.
- `GameStateSchema` usa `satisfies z.ZodType<GameState>`: si cambias `GameState`, typecheck obliga a
  actualizar el esquema.
- Registro JSONL en `logs/decisions-YYYY-MM-DD.jsonl` (`DecisionRecord`). El modo replay lee esos archivos.
- Todo cambio en el estado para Jev, las preguntas o las doctrinas se mide con `npm run bench -- --real --save
  vN` y se compara con la versión anterior (`logs/bench-v*.json`) antes de darlo por bueno. Los pares del banco
  cambian solo el comandante; agregar situaciones al final, no cambiar las existentes.
  Historial: v1 9/11; v2 11/11 (rencoroso atado a `shared.radio_trust`, `shared.sightings`). Mock: 7/11.
- Reutilizar de `../BomberJev` lo que sirva (proveedores, budget, decision-log, rate-probe) en vez de reescribirlo.
- Arte y personajes originales.

## Fases (no mezclarlas)

1. Reglas en `src/shared` con pruebas; juego jugable en Phaser con arte simple y el proveedor mock.
2. Jev real: `/api/enemy-turn` y `/api/spy`, 429, limitador, registro, replay, `npm run jev:ping`, `bench.ts`.
3. Jev visible: etiqueta por guardia, panel de barras, infiltrada en vivo, confianza en la radio, visor de la
   llamada completa, repetición del turno enemigo.
4. Pulido: estilo noir, luz 2D desde las linternas, partículas, tweens, selector de comandante.

Estado: fases 0 a 3 hechas (Jev visible: etiquetas, franja de barras, infiltrada, confianza, visor, repetición). Siguiente: fase 4.

## Comandos

- `npm run dev`: Vite (5173) + servidor (8787); Vite redirige `/api`. Requiere `.env` (ver `.env.example`).
- `npm run typecheck`: tres proyectos: shared (puro), client (DOM), server/scripts (Node).
- `npm run jev:ping`: lista los modelos y hace una llamada real a Jev, sin reintentos (~$0.00002).
- `npm test`: pruebas de reglas, del turno del servidor y de 429 (`node:test` vía tsx, sin tocar el gateway).
- `npm run bench` (mock) / `npm run bench -- --real [--save vN]` (~11 llamadas, ~$0.0007).
- Modo: `JEV_MODE=mock|real|replay` en `.env` (o `JEV_MODE=real npm run dev` para una sola vez).
- Partida: `http://localhost:5173/?commander=impulsivo&seed=123` (misma semilla = misma partida).
  Teclas: 1·2·3 ladrón, Esc cancela, Enter termina el turno, I infiltrada, R repite el turno enemigo, V visor
  de la llamada. Depurar: `__game.scene.getScene("game").state`.
- Probar en Chrome: si la ventana queda tapada, Chrome la marca `hidden`, `requestAnimationFrame` se detiene
  y las animaciones de Phaser no terminan. Traerla al frente o probar con Chrome headless.

## Git

Nunca hacer commit ni push sin pedirlo explícitamente. `.env` y `logs/` están en `.gitignore`.
