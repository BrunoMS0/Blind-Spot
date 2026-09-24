# Arquitectura de El golpe

Juego táctico por turnos: el jugador controla a tres ladrones y Jev (TypeSafe AI) controla a los guardias.
El nombre del juego vive solo en `GAME_NAME` (`src/shared/config.ts`).

## Principio central: Jev decide, el código calcula

Jev no cuenta, no mide distancias, no razona sobre el espacio y no recuerda nada entre llamadas. Por eso:

- El **código** calcula la visión (conos con línea de vista), los caminos, las distancias, qué guardia oye
  qué ruido y la confianza en la radio (`src/shared/analysis.ts`).
- A **Jev** le llegan conclusiones cortas en inglés por cada opción disponible, nunca la cuadrícula. Solo se
  ofrecen las opciones que aplican a ese guardia en ese turno. Jev elige; el código ejecuta.
- La doctrina del comandante es **solo texto**. Cauteloso, impulsivo y rencoroso comparten todo el código.

Estado que ve Jev (ejemplo; lo arma `server/jev-state.ts`):

```jsonc
{
  "shared": {
    "commander_doctrine": "…",
    "alarm_level": "1 of 3",
    "radio_trust": "shaken after a false report",
    "radio_report": "movement in the west gallery",
    "noises_this_turn": ["a coin in the central hall"],
    "sightings": ["Rojas saw an intruder in the central hall last turn"]
  },
  "guards": {
    "vega": {
      "position": "east wing", "facing": "north",
      "options": {
        "patrol": "next stop: vault entrance, 3 tiles",
        "investigate_noise": "coin heard in the central hall, 6 tiles west",
        "guard_vault": "THE VAULT DOOR IS OPEN, 2 tiles away",
        "hold": "stay here and look around"
      },
      "last_decision": "followed a radio report"
    }
  }
}
```

Preguntas, todas en **una** llamada: `vega_plan`, `rojas_plan`, … (Choice con las opciones de ese guardia) y
`raise_alarm` (Noul). Cada `<guardia>_plan` cita su parte del estado con backticks (`guards.vega`) para que
un guardia no use la información de otro.

## Módulos

| Ruta | Qué hace | Fase |
| --- | --- | --- |
| `src/shared/config.ts` | `GAME_NAME` y constantes de reglas | 0 |
| `src/shared/types.ts` | Estado, nivel, acciones, análisis, decisiones y eventos | 0 |
| `src/shared/api.ts` | Contrato HTTP; `GameStateSchema` (zod) atado al tipo con `satisfies` | 0 |
| `src/shared/levels/*.json` | Niveles como datos: mapa en texto, zonas, rutas, posiciones iniciales | 1 |
| `src/shared/level.ts` | Carga (validada con zod) y consulta del mapa: casilla, zona, `solid()` | 1 |
| `src/shared/paths.ts` | Caminos BFS y distancias de camino | 1 |
| `src/shared/vision.ts` | Cono de 4 casillas y 90°, bloqueado por muros y pedestales | 1 |
| `src/shared/rules.ts` | Partida nueva, avistamientos, capturas, engaños y fin de partida (comunes a ambos turnos) | 1 |
| `src/shared/player-turn.ts` | Movimiento y acciones de los ladrones, radio; consultas para la interfaz | 1 |
| `src/shared/analysis.ts` | `analyzeTurn()` → `TurnAnalysis`: opciones y hechos de cada guardia | 1 |
| `src/shared/enemy-turn.ts` | `resolveEnemyTurn(level, state, decisions)` → `{ state, events }` | 1 |
| `src/shared/rng.ts` | RNG con semilla (mulberry32) y sorteo de opciones según probabilidades | 1 |
| `src/client/game-scene.ts` | Capas, input del mapa, animación de eventos. Comandos que usa la interfaz | 0→4 |
| `src/client/ui-scene.ts` | Barra superior, panel, registro, fin de partida. Se redibuja con cada cambio | 0→4 |
| `src/client/api.ts` | `requestTurn(endpoint, state, fallback)`; `TurnFailed` con `retryable` | 1→2 |
| `server/index.ts` | Hono: `/api/health`, `/api/enemy-turn`, `/api/spy`. Escribe el registro y suma el gasto | 0→2 |
| `server/turn.ts` | Un pedido: valida contra el nivel, analiza, arma preguntas, elige proveedor, sortea. Devuelve respuesta y registro | 1→2 |
| `server/jev-state.ts` | `TurnAnalysis` + doctrina → estado en inglés + preguntas | 1 |
| `server/doctrines.ts` | El texto de las tres doctrinas (medido con `bench.ts`) | 1→2 |
| `server/env.ts` | Variables de entorno validadas con zod (ver `.env.example`) | 2 |
| `server/providers/mock.ts` | Heurística sin doctrina: la línea base "solo código" | 1 |
| `server/providers/jev.ts` | Jev real: reintentos ante 429, tope total, limitador, caché, conteo de 429 | 2 |
| `server/providers/replay.ts` | Respuestas grabadas para situaciones idénticas; si no hay, mock con aviso | 2 |
| `server/budget.ts`, `decision-log.ts` | Tope diario (se recupera del JSONL al reiniciar) y registro JSONL | 2 |
| `scripts/jev-ping.ts`, `bench.ts` | Verificar la conexión; banco de situaciones con conducta esperada | 0→2 |
| `tests/` | Reglas, análisis, sorteo, contrato zod, 20 turnos con el mock, 429 con un fetch falso | 1→2 |

`src/shared` es puro: su tsconfig no tiene DOM ni tipos de Node, así que `npm run typecheck` falla si una regla
toca `window` o `process`. Las reglas nunca dibujan: devuelven estado nuevo y eventos.

## Flujo de un turno, de punta a punta

**Turno del jugador** (cliente, reglas en `player-turn.ts`):

1. Cada ladrón se mueve una vez (camino BFS dentro de su alcance) y hace una acción. La visión se revisa en
   cada paso: `thief_moved`, `thief_seen`, `alarm_raised`.
2. Acciones: `force_vault` (Llave, frente a la puerta) → `vault_progress` / `vault_opened`; `throw_coin`
   (Eco, ≤ 5 casillas) → `noise_made` con los guardias que lo oyen; `take_diamond` → `diamond_taken`.
3. Radio (una por turno, 3 usos) → `radio_sent`. Infiltrada (2 usos): mientras dura el turno, cada cambio
   pide `/api/spy` con debounce; si el estado no cambió, el servidor reutiliza la respuesta.
4. Si el ladrón con el diamante llega a la salida → `game_over` (victoria). Si no, "Terminar turno".

**Turno enemigo:**

1. El cliente manda `POST /api/enemy-turn { state }`.
2. El servidor valida con zod, carga el nivel y llama a `analyzeTurn()`.
3. `jev-state.ts` convierte el análisis y la doctrina en estado y preguntas.
4. Proveedor de `JEV_MODE` (con `fallback: true`, el mock; si se superó el tope diario, el mock con aviso).
   En modo real: **caché** por (estado, preguntas) → si la infiltrada ya preguntó exactamente esto, no se
   llama; si no, **limitador** (de a una llamada, `JEV_MIN_INTERVAL_MS` entre inicios) → `systemOne`.
5. **Sorteo** (`SAMPLING=sample|argmax`): la opción de cada guardia se sortea con las probabilidades de Jev,
   con un RNG sembrado por semilla + turno + guardia. `raise_alarm` se sortea como sí/no con su probabilidad.
   Como la semilla es la misma, la infiltrada y el turno enemigo sortean igual con la misma respuesta.
6. Respuesta `TurnResponse` (probabilidades, opción sorteada y `raise_alarm` por guardia; `meta` con modo,
   respaldo, caché, latencia y avisos) y una línea en `logs/decisions-YYYY-MM-DD.jsonl` (`DecisionRecord`).
7. El cliente llama a `resolveEnemyTurn()`: `guard_decided`, `guard_moved` (visión revisada en cada paso),
   `thief_seen`, `alarm_raised`, `thief_caught`, `deception_discovered`, `turn_ended`, `game_over`.
8. La escena anima los eventos en orden.

**Si Jev falla** (429): el SDK reintenta respetando `Retry-After` y, si no viene, espera 1, 2, 4, 8, 8… s. Un
`AbortSignal` corta todo a `JEV_RETRY_TOTAL_MS` (~30 s) mientras la interfaz muestra "Los guardias están
pensando…". Si aun así falla, el servidor responde 503 (`TurnError` con `retryable`) y el jugador elige
**Reintentar** (si tiene sentido) o **Usar decisión simulada**, que reenvía con `fallback: true`: responde el
mock y se registra con `source: "respaldo"`. Cada decisión registra cuántos 429 hubo (`rateLimited`).

**Replay** (`JEV_MODE=replay`): reproduce las respuestas grabadas de Jev para situaciones idénticas. Con la
misma semilla y las mismas jugadas se repite una partida entera sin llamar a Jev (verificado: 13 turnos
idénticos). Una situación sin grabación la decide el mock y lo avisa en `meta.note`.

## Reglas del juego (primer nivel)

- Mapa de 20×14. Zonas: entrada (con la salida), galería oeste, salón central, ala este y bóveda.
  Muros y pedestales bloquean el paso y la visión. Las puertas se atraviesan y no bloquean la visión.
  La puerta de la bóveda empieza cerrada y bloquea las dos cosas hasta abrirse.
- Ladrones: Zorro mueve 5; Llave mueve 4 y es la única que fuerza la bóveda (2 acciones frente a la puerta);
  Eco mueve 4 y lanza una moneda a ≤ 5 casillas para hacer ruido.
- Guardias (3, con ruta de patrulla): mueven 3 por turno (4 si persiguen). Cono de visión de 4 casillas y 90°.
- **Alarma:** un ladrón visto sube la alarma 1, **como mucho una vez por ladrón y por fase** (fases: turno
  del jugador y turno enemigo), aunque lo vean varios guardias o durante varios pasos. El guardia recuerda
  dónde lo vio (`lastSighting`). Con alarma 3 se pierde.
- **`raise_alarm`:** se sortea. Un "sí" sube la alarma 1, pero **nunca de 2 a 3** (`RAISE_ALARM_CAP`): solo
  ser visto hace perder.
- Captura: un guardia que termina su movimiento en una casilla ortogonalmente adyacente a un ladrón lo atrapa.
  Si atrapan a quien lleva el diamante, o a todo el equipo, se pierde.
- Victoria: el ladrón con el diamante llega a la salida.
- Opciones de cada guardia: `patrol`, `guard_vault` y `hold` siempre; `investigate_noise` si oyó un ruido
  (≤ 8 casillas de camino); `respond_radio` si hay un reporte de movimiento activo; `chase` si recuerda
  haber visto a alguien. **Bóveda abierta:** todos los guardias lo saben al instante (sensor).
- Radio pirateada (3 usos, una por turno): "movimiento en <zona>" o "todo despejado en <zona>". El reporte
  sigue activo hasta que otro lo reemplaza o se descubre el engaño. **Engaños:** un guardia que eligió
  `respond_radio` termina su movimiento en la zona reportada y no ve a nadie; o un guardia ve a un ladrón en
  una zona reportada como despejada. Confianza: 0 engaños → `high`, 1 → `shaken`, 2 o más → `lying`.
- Infiltrada (2 usos): durante ese turno muestra las probabilidades de cada guardia, actualizadas en vivo.
- Comandantes: cauteloso (protege la bóveda, casi no se distrae), impulsivo (acude a cualquier ruido o
  reporte), rencoroso (tras un engaño deja de creerle a la radio y se vuelve más agresivo).

## Eventos → capas

`GameScene` dibuja en capas, de abajo hacia arriba. `UIScene` va encima con la interfaz.

| Evento | Capa / efecto |
| --- | --- |
| `thief_moved` | entidades: tween casilla por casilla |
| `guard_moved` | entidades: tween casilla por casilla; conos: siguen al guardia |
| `thief_seen` | conos: destello del cono; entidades: "!" sobre el guardia |
| `alarm_raised` | interfaz: medidor de alarma; efectos: parpadeo rojo |
| `thief_caught` | entidades: el ladrón sale del tablero |
| `noise_made` | efectos: onda en la casilla; "?" sobre los guardias que la oyen |
| `radio_sent`, `deception_discovered` | interfaz: reporte activo e indicador de confianza en la radio |
| `vault_progress`, `vault_opened` | mapa: la puerta de la bóveda; efectos: chispas (fase 4) |
| `diamond_taken` | entidades: el diamante pasa al ladrón |
| `guard_decided` | info de Jev (fase 3): etiqueta con la opción y su probabilidad |
| `turn_ended`, `game_over` | interfaz: turno, pantalla final |

## Determinismo y repetición

Misma semilla + mismas decisiones = misma partida: las reglas no usan azar propio y el sorteo usa
semilla + turno + guardia. La repetición del turno enemigo (fase 3) vuelve a resolver el estado anterior con
las mismas decisiones y anima los eventos otra vez.
