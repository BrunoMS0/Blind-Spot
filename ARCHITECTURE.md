# Arquitectura de Blind Spot

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
| `src/client/game-scene.ts` | Capas (con la de Jev), input, animación de eventos, repetición, visor | 0→5 |
| `src/client/ui-scene.ts` | Barra superior, panel, franja de Jev, registro, fin de partida. Se redibuja con cada cambio | 0→4 |
| `src/client/texts.ts` | Textos en español que comparten las escenas | 3 |
| `src/client/menu-scene.ts` | Selector de comandante antes de empezar | 4→5 |
| `src/client/art.ts` | Pixel art por código: sprites (mapas de caracteres) y el plano del museo | 5 |
| `src/client/theme.ts`, `widgets.ts` | Paleta y tipografías; botón, caja y cifra del marcador | 5 |
| `src/client/api.ts` | `requestTurn(endpoint, state, fallback)`; `TurnFailed` con `retryable` | 1→2 |
| `server/index.ts` | Hono: `/api/health`, `/api/enemy-turn`. Escribe el registro y suma el gasto | 0→2 |
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
3. Radio (una por turno, 3 usos) → `radio_sent`. Apagón de Zorro (2 usos) → `blackout_started`.
4. Si el ladrón con el diamante llega a la salida → `game_over` (victoria). Si no, "Terminar turno".

**Turno enemigo:**

1. El cliente manda `POST /api/enemy-turn { state }`.
2. El servidor valida con zod, carga el nivel y llama a `analyzeTurn()`.
3. `jev-state.ts` convierte el análisis y la doctrina en estado y preguntas.
4. Proveedor de `JEV_MODE` (con `fallback: true`, el mock; si se superó el tope diario, el mock con aviso).
   En modo real: **caché** por (estado, preguntas) → si ya se preguntó exactamente esto (p. ej. al reintentar),
   no se llama; si no, **limitador** (de a una llamada, `JEV_MIN_INTERVAL_MS` entre inicios) → `systemOne`.
5. **Sorteo** (`SAMPLING=sample|argmax`): la opción de cada guardia se sortea con las probabilidades de Jev,
   con un RNG sembrado por semilla + turno + guardia. `raise_alarm` no se sortea: cuenta si p ≥ 0.5.
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
- Ladrones, cada uno con una habilidad (`THIEVES[id].ability`; `abilityState()` dice si se puede usar y, si no,
  por qué, y la interfaz lo muestra siempre):
  - Zorro mueve 5. **Apagón** (2 usos por partida): corta la luz de una sala hasta el final del turno enemigo;
    ahí los guardias solo ven a `BLACKOUT_RANGE` (2) casillas. Todos se enteran: cada guardia recibe la opción
    `check_blackout` y Jev ve `shared.lights`. Un apagón a la vez.
  - Llave mueve 4 y es la única que fuerza la bóveda (2 acciones frente a la puerta).
  - Eco mueve 4 y lanza una moneda a ≤ 5 casillas para hacer ruido.
- Guardias (3, con ruta de patrulla): mueven 3 por turno (4 si persiguen). Cono de visión de 4 casillas y 90°.
- **Posiciones de salida sorteadas** (`newGame`, con la semilla: misma semilla, misma partida): los ladrones en
  casillas distintas de la entrada; cada guardia en una casilla de su sala (la de su posición en el nivel) y
  mirando hacia cualquier lado, sin ver a ningún ladrón, a 6 casillas de camino o más de ellos y sin el cono
  contra un muro; su patrulla empieza por la parada más cercana. `newFixedGame` usa las posiciones escritas en
  el nivel: la usan las pruebas y el banco, que necesitan situaciones exactas.
- **Alarma:** un ladrón visto sube la alarma 1, **como mucho una vez por ladrón y por fase** (fases: turno
  del jugador y turno enemigo), aunque lo vean varios guardias o durante varios pasos. El guardia recuerda
  dónde lo vio (`lastSighting`). Con alarma 3 se pierde.
- **`raise_alarm`:** cuenta si Jev da p ≥ 0.5 (`RAISE_ALARM_THRESHOLD`; no se sortea porque su efecto se
  acumula: sorteado, un 5-10 % por turno subía la alarma sin avistamientos). Sube la alarma 1, pero **nunca
  de 2 a 3** (`RAISE_ALARM_CAP`): solo ser visto hace perder.
- Captura: un guardia que termina su movimiento en una casilla ortogonalmente adyacente a un ladrón lo atrapa.
  Si atrapan a quien lleva el diamante, o a todo el equipo, se pierde.
- Victoria: el ladrón con el diamante llega a la salida.
- Opciones de cada guardia: `patrol`, `guard_vault` y `hold` siempre; `investigate_noise` si oyó un ruido
  (≤ 8 casillas de camino); `respond_radio` si hay un reporte de movimiento activo; `check_blackout` si hay un
  apagón; `chase` si recuerda haber visto a alguien. **Bóveda abierta:** todos los guardias lo saben al instante
  (sensor).
- Radio pirateada (3 usos, una por turno): "movimiento en <zona>" o "todo despejado en <zona>". El reporte
  sigue activo hasta que otro lo reemplaza o se descubre el engaño. **Engaños:** un guardia que eligió
  `respond_radio` termina su movimiento en la zona reportada y no ve a nadie; o un guardia ve a un ladrón en
  una zona reportada como despejada. Confianza: 0 engaños → `high`, 1 → `shaken`, 2 o más → `lying`.
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
| `vault_progress`, `vault_opened` | efectos: chispas y sacudida; mapa: la puerta queda abierta |
| `diamond_taken` | entidades: el diamante pasa al ladrón |
| `guard_decided` | info de Jev: etiqueta sobre el guardia con la opción y su probabilidad |
| `turn_ended`, `game_over` | interfaz: turno, pantalla final |

## Estilo: pixel art de juego clásico (fase 5)

La guía visual es la vista previa en HTML que armó el usuario: pixel art, letra de máquina de escribir, colores
apagados con dorado de acento. La fase 4 (noir y neón, degradados, esquinas redondeadas) se descartó por verse
demasiado moderna.

- **Pixel art** (`src/client/art.ts`): todo se dibuja por código a 16×16 por casilla y se amplía ×3 con filtro
  NEAREST. Los sprites son mapas de caracteres (una letra por color); una fila que no mida 16 falla al arrancar.
  Guardias en 4 direcciones (el oeste es el este espejado) con 2 pasos, vestidos como su comandante
  (`COMMANDER_LOOK`: el cauteloso es un veterano con bigote y charreteras, el impulsivo va sin gorra con chaqueta
  roja y silbato, el rencoroso de oscuro con lentes negros y una cicatriz); el retrato del menú es el mismo
  sprite de frente. Ladrones de frente con 2 pasos y un accesorio propio (orejas de zorro, llave, capucha con
  moneda). El museo es una sola imagen de 320×224:
  madera en la entrada y la galería, damero con alfombra roja en el salón, damero verde en el ala este, acero
  en la bóveda, muros con cuadros, vitrinas con jarrones y bustos, flecha de salida.
- **Luz**: una capa de oscuridad por debajo de los personajes; cada linterna la borra en las casillas exactas de
  `visibleTiles()` (luz por casillas, bordes duros) y encima va el tinte amarillo del cono.
- **Ayudas en el mapa**: casillas blancas a las que se puede ir, rojas si el camino cruza la vista de un
  guardia; recuadros dorados para la moneda; contorno punteado de la zona reportada por radio (cian =
  movimiento, verde = despejado); la moneda en el piso con su onda mientras dura el turno.
- **Etiquetas de papel** sobre los guardias con la decisión del último turno. Si dos se tocan, una sube
  (`stackChips`).
- **Elegir una sala** (apagón o radio): un cartel sobre el mapa dice qué tocar, todas las salas se contornean y
  la que está bajo el mouse se ilumina con su nombre en el cartel (`drawPick`, `mapPrompt`).
- **Interfaz** (`widgets.ts`, `theme.ts`): *Special Elite* para títulos y cifras, *IBM Plex Sans* para leer.
  Botones planos con borde de 2 px (tinta = principal, dorado = tomar el diamante, naranja = modo activo).
  Marcador de turno, alarma, usos de radio y llamadas a Jev. Columna derecha: lo que decidieron (tarjetas por
  guardia con barras, dorado = elegida, y la alarma frente a su umbral), el panel de la radio (usos,
  para qué sirve, confianza en tres escalones y reporte en el aire), el objetivo con "Terminar turno" y la
  bitácora con la entrada más reciente arriba.
- **Pantalla**: canvas 16:9 (1600×900) escalado con FIT; tecla F o botón para pantalla completa.
- **Cuidado con los tweens infinitos** (la onda del ruido): antes de destruir sus objetos hay que detenerlos
  (`killTweensOf`); un tween vivo sobre un objeto destruido rompe el bucle del juego.
- **Selector de comandante** (`MenuScene`) al entrar sin parámetros; `?commander=…&seed=…` lo saltea.

## Jev visible (fase 3)

- **Etiqueta** sobre cada guardia (capa de Jev, se mueve con él): opción sorteada y probabilidad. Naranja si
  era poco probable (< 20 %): así se ve que el sorteo no toma siempre la más probable.
- **Barras de Jev** (columna derecha): por guardia, las barras de todas las opciones ofrecidas, la elegida
  marcada, y la probabilidad de `raise_alarm` frente al umbral.
- **Infiltrada: quitada.** Mostraba en vivo las probabilidades antes de terminar el turno (`/api/spy`). En la
  práctica no aportaba una decisión clara al jugador y se quitó por decisión del usuario; su espacio pasó al
  panel de la radio. Los registros viejos pueden tener `endpoint: "spy"`.
- **Confianza en la radio** en el panel de la radio: le creen / dudan / no le creen (de `radioTrust()`).
- **Visor de la llamada** (tecla V): un `<pre>` HTML sobre el juego con el estado, las preguntas y las
  respuestas de la última llamada (`TurnResponse.call`). Texto largo: mejor HTML que Phaser.
- **Repetición** (tecla R): vuelve a animar los eventos del último turno enemigo desde el estado de antes.

## Determinismo y repetición

Misma semilla + mismas decisiones = misma partida: las reglas no usan azar propio y el sorteo usa
semilla + turno + guardia. La repetición del turno enemigo (fase 3) vuelve a resolver el estado anterior con
las mismas decisiones y anima los eventos otra vez.
