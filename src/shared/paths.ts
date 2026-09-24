// Caminos: BFS en 4 direcciones. Las distancias que ve Jev son casillas de camino, no línea recta.
import { key, neighbors, solid, type Level } from "./level";
import type { GameState, Vec } from "./types";

export interface Explored {
  /** Por cada casilla alcanzada: distancia y casilla anterior del camino más corto. */
  cells: Map<string, { pos: Vec; dist: number; prev: string | null }>;
}

/**
 * Explora desde `from`. `occupied` son casillas con alguien encima: no se pueden atravesar.
 * `maxSteps` corta la búsqueda (alcance de movimiento).
 */
export function explore(level: Level, s: Pick<GameState, "vault">, from: Vec, occupied = new Set<string>(), maxSteps = Infinity): Explored {
  const cells: Explored["cells"] = new Map([[key(from), { pos: from, dist: 0, prev: null }]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    const d = cells.get(key(p))!.dist;
    if (d >= maxSteps) continue;
    for (const n of neighbors(p)) {
      const k = key(n);
      if (cells.has(k) || solid(level, s, n) || occupied.has(k)) continue;
      cells.set(k, { pos: n, dist: d + 1, prev: key(p) });
      queue.push(n);
    }
  }
  return { cells };
}

/** Camino desde el origen de `explored` hasta `to`, sin incluir el origen. null si no se alcanzó. */
export function pathTo(explored: Explored, to: Vec): Vec[] | null {
  let cell = explored.cells.get(key(to));
  if (!cell) return null;
  const path: Vec[] = [];
  while (cell.prev !== null) {
    path.unshift(cell.pos);
    cell = explored.cells.get(cell.prev)!;
  }
  return path;
}

/** Distancia de camino ignorando a los personajes, o null si no hay camino. */
export function pathDistance(level: Level, s: Pick<GameState, "vault">, from: Vec, to: Vec): number | null {
  return explore(level, s, from).cells.get(key(to))?.dist ?? null;
}
