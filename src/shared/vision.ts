// Visión: cono de VISION_RANGE casillas y VISION_ANGLE_DEG de apertura, con línea de vista. En la sala del
// apagón de Zorro solo se ve hasta BLACKOUT_RANGE.
import { BLACKOUT_RANGE, VISION_ANGLE_DEG, VISION_RANGE } from "./config";
import { DIRS, solid, zoneAt, type Level } from "./level";
import type { Facing, GameState, Vec } from "./types";

type Viewer = { pos: Vec; facing: Facing };
type Seen = Pick<GameState, "vault" | "blackout">;
const HALF_ANGLE_COS = Math.cos(((VISION_ANGLE_DEG / 2) * Math.PI) / 180);

export function canSee(level: Level, s: Seen, viewer: Viewer, target: Vec): boolean {
  const dx = target.x - viewer.pos.x;
  const dy = target.y - viewer.pos.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > VISION_RANGE) return false;
  if (s.blackout.zone && d > BLACKOUT_RANGE && zoneAt(level, target) === s.blackout.zone) return false; // a oscuras
  const f = DIRS[viewer.facing];
  if ((dx * f.x + dy * f.y) / d < HALF_ANGLE_COS - 1e-9) return false; // fuera del cono (45° incluidos)
  return lineOfSight(level, s, viewer.pos, target);
}

/** Bresenham: ninguna casilla intermedia entre a y b puede ser sólida. */
export function lineOfSight(level: Level, s: Pick<GameState, "vault">, a: Vec, b: Vec): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  let { x, y } = a;
  while (true) {
    if (x === b.x && y === b.y) return true;
    if (!(x === a.x && y === a.y) && solid(level, s, { x, y })) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Casillas no sólidas que ve un guardia. Es lo que dibuja la capa de conos. */
export function visibleTiles(level: Level, s: Seen, viewer: Viewer): Vec[] {
  const out: Vec[] = [];
  for (let y = viewer.pos.y - VISION_RANGE; y <= viewer.pos.y + VISION_RANGE; y++) {
    for (let x = viewer.pos.x - VISION_RANGE; x <= viewer.pos.x + VISION_RANGE; x++) {
      if (!solid(level, s, { x, y }) && canSee(level, s, viewer, { x, y })) out.push({ x, y });
    }
  }
  return out;
}
