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

- Reintentos del propio SDK: `respectRetryAfter`, espera creciente, y un tope total de ~30 s con
  `AbortSignal.timeout` (el SDK no tiene tope total). Mientras tanto, la interfaz muestra "Los guardias están
  pensando…".
- Si aun así falla: 503 y el jugador elige **Reintentar** o **Usar decisión simulada** (mock, registrada como
  `source: "respaldo"`). Las métricas excluyen las de respaldo.
- Limitador: intervalo mínimo entre llamadas (`JEV_MIN_INTERVAL_MS`).
- Caché por (estado, preguntas): la infiltrada y el turno enemigo no repiten una llamada idéntica.
- Tope diario `JEV_DAILY_BUDGET_USD`; al superarlo, pasa a mock y lo avisa.

## Reglas operativas

- `src/shared` es puro (sin Phaser, DOM ni Node; lo impone su tsconfig). Las reglas emiten eventos tipados y
  nunca dibujan. Phaser solo dibuja, anima y lee input.
- Los endpoints solo aceptan `TurnRequest` validado con zod. Nada de texto libre hacia Jev.
- `GameStateSchema` usa `satisfies z.ZodType<GameState>`: si cambias `GameState`, typecheck obliga a
  actualizar el esquema.
- Registro JSONL en `logs/decisions-YYYY-MM-DD.jsonl` (`DecisionRecord`). El modo replay lee esos archivos.
- Todo cambio en el estado para Jev, las preguntas o las doctrinas se mide con `bench.ts` antes de darlo por bueno.
- Reutilizar de `../BomberJev` lo que sirva (proveedores, budget, decision-log, rate-probe) en vez de reescribirlo.
- Arte y personajes originales.

## Fases (no mezclarlas)

1. Reglas en `src/shared` con pruebas; juego jugable en Phaser con arte simple y el proveedor mock.
2. Jev real: `/api/enemy-turn` y `/api/spy`, 429, limitador, registro, replay, `npm run jev:ping`, `bench.ts`.
3. Jev visible: etiqueta por guardia, panel de barras, infiltrada en vivo, confianza en la radio, visor de la
   llamada completa, repetición del turno enemigo.
4. Pulido: estilo noir, luz 2D desde las linternas, partículas, tweens, selector de comandante.

Estado: fases 0 y 1 hechas (reglas con pruebas, juego jugable con el mock). Siguiente: fase 2.

## Comandos

- `npm run dev`: Vite (5173) + servidor (8787); Vite redirige `/api`. Requiere `.env` (ver `.env.example`).
- `npm run typecheck`: tres proyectos: shared (puro), client (DOM), server/scripts (Node).
- `npm run jev:ping`: lista los modelos y hace una llamada real a Jev, sin reintentos (~$0.00002).
- `npm test`: pruebas de reglas y del turno del servidor (`node:test` vía tsx, sin dependencias extra).
- Partida: `http://localhost:5173/?commander=impulsivo&seed=123` (misma semilla = misma partida).
  Teclas: 1·2·3 ladrón, Esc cancela, Enter termina el turno. Depurar: `__game.scene.getScene("game").state`.
- Probar en Chrome: si la ventana queda tapada, Chrome la marca `hidden`, `requestAnimationFrame` se detiene
  y las animaciones de Phaser no terminan. Traerla al frente o probar con Chrome headless.

## Git

Nunca hacer commit ni push sin pedirlo explícitamente. `.env` y `logs/` están en `.gitignore`.
