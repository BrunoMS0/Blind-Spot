// Llamadas al servidor. El cliente solo manda la foto de la partida.
import type { TurnError, TurnRequest, TurnResponse } from "../shared/api";
import type { GameState } from "../shared/types";

/** Jev no respondió (o el pedido falló). `retryable`: tiene sentido reintentar; si no, solo queda el respaldo. */
export class TurnFailed extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** fallback: el jugador eligió "usar decisión simulada" tras un fallo; decide el mock y se registra como respaldo. */
export async function requestTurn(endpoint: "enemy-turn" | "spy", state: GameState, fallback = false): Promise<TurnResponse> {
  const body: TurnRequest = { state, fallback };
  const r = await fetch(`/api/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) throw new TurnFailed("no hay conexión con el servidor", true);
  if (!r.ok) {
    const err = (await r.json().catch(() => null)) as TurnError | null;
    throw new TurnFailed(err?.error ?? `HTTP ${r.status}`, err?.retryable ?? true);
  }
  return (await r.json()) as TurnResponse;
}
