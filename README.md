# Blind Spot

Juego táctico por turnos en pixel art: tu equipo entra de noche a un museo para robar el diamante. Los
guardias los controla **Jev** (TypeSafe AI): al final de cada turno tuyo, una sola llamada decide qué hace
cada guardia. El código calcula visión, caminos y distancias; Jev solo elige.

## Requisitos

- Node **20.19** o más nuevo.
- Opcional: una key del [AI Gateway de Vercel](https://vercel.com/ai-gateway) para jugar contra Jev de verdad.
  Sin key se juega igual contra el modo simulado (mock).

## Levantarlo

```bash
npm install
cp .env.example .env      # en Windows (PowerShell): Copy-Item .env.example .env
npm run dev
```

Abre <http://localhost:5173>. `npm run dev` levanta Vite (5173) y el servidor (8787) a la vez, y necesita que
exista `.env` aunque esté sin completar.

### Modos de los guardias (`JEV_MODE` en `.env`)

| Modo | Qué hace | Necesita key |
| --- | --- | --- |
| `mock` (por defecto) | Heurística local, gratis | No |
| `real` | Decide Jev a través del gateway (~$0.00006 por turno) | Sí, en `AI_GATEWAY_API_KEY` |
| `replay` | Repite respuestas grabadas en `logs/` | No |

Para `real`, completa `AI_GATEWAY_API_KEY` y comprueba la conexión con `npm run jev:ping`. Las demás variables
de `.env.example` tienen valores por defecto que sirven tal cual.

## Cómo se juega

1. Elige al comandante de seguridad: **cauteloso**, **impulsivo** o **rencoroso**. Todos usan el mismo código;
   solo cambia la doctrina que lee Jev.
2. En tu turno mueve a cada ladrón (clic en una casilla) y usa sus habilidades:
   - **Zorro** (mueve 5): *apagón*, deja una sala a oscuras hasta el final del turno enemigo (2 usos).
   - **Llave** (mueve 4): la única que puede forzar la puerta de la bóveda.
   - **Eco** (mueve 4): lanza una moneda para distraer a los guardias con el ruido.
   - **Radio pirateada** (3 usos): reporta movimiento en una sala o dala por despejada. Si la mentira se
     descubre, seguridad deja de creerle.
3. Termina el turno y mira qué decidió cada guardia, con las probabilidades de Jev.

**Ganas** si el ladrón que lleva el diamante llega a la salida. **Pierdes** si la alarma llega a 3 (cada ladrón
visto la sube), si atrapan a quien lleva el diamante o si atrapan a todo el equipo.

### Teclas

| Tecla | Acción |
| --- | --- |
| `1` `2` `3` | Elegir ladrón |
| `Esc` | Cancelar la acción |
| `Enter` | Terminar el turno |
| `R` | Repetir el turno enemigo |
| `V` | Ver la llamada completa a Jev |
| `F` | Pantalla completa |

`http://localhost:5173/?commander=impulsivo&seed=123` saltea el menú; con la misma semilla y las mismas
jugadas se repite la misma partida.

## Otros comandos

```bash
npm test            # pruebas de reglas, del turno del servidor y de la política ante 429
npm run typecheck   # TypeScript estricto en shared, cliente y servidor
npm run bench       # banco de situaciones (mock); con -- --real usa Jev (~$0.0007)
```

Arquitectura, reglas completas y flujo de un turno: [ARCHITECTURE.md](ARCHITECTURE.md).
