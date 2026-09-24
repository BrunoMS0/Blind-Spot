// Llamadas al servidor. El cliente solo manda la foto de la partida.
import type { TurnError, TurnRequest, TurnResponse } from "../shared/api";
import type { GameState } from "../shared/types";

export async function requestEnemyTurn(state: GameState): Promise<TurnResponse> {
  const body: TurnRequest = { state };
  const r = await fetch("/api/enemy-turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const err = (await r.json().catch(() => null)) as TurnError | null;
    throw new Error(err?.error ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as TurnResponse;
}
