// Carga y consulta de niveles. Los niveles son datos (levels/*.json) validados con zod al cargarse,
// así un error al editar el mapa a mano falla al arrancar y no a mitad de partida.
import { z } from "zod";
import museo from "./levels/museo.json";
import type { Facing, GameState, LevelData, Vec, ZoneId } from "./types";

export type Tile = "floor" | "wall" | "door" | "pedestal" | "vault_door" | "exit";
const TILE_CHARS: Record<string, Tile> = { "#": "wall", ".": "floor", D: "door", P: "pedestal", V: "vault_door", X: "exit", "*": "floor" };

export interface Level {
  id: string;
  width: number;
  height: number;
  /** [y][x] */
  tiles: Tile[][];
  /** [y][x]; null en los muros. */
  zoneIds: (ZoneId | null)[][];
  zones: Record<ZoneId, { name: string; label: string; /** casilla transitable más cercana al centro */ center: Vec }>;
  exit: Vec;
  vaultDoor: Vec;
  /** La casilla frente a la puerta de la bóveda, del lado de afuera: adonde va guard_vault y donde fuerza Llave. */
  vaultFront: Vec;
  diamond: Vec;
  thieves: LevelData["thieves"];
  guards: LevelData["guards"];
}

export const DIRS: Record<Facing, Vec> = { north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 }, west: { x: -1, y: 0 } };
export const key = (p: Vec) => `${p.x},${p.y}`;
export const same = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;
export const neighbors = (p: Vec): Vec[] => Object.values(DIRS).map((d) => ({ x: p.x + d.x, y: p.y + d.y }));
export const adjacent = (a: Vec, b: Vec) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

export function tileAt(level: Level, p: Vec): Tile {
  return level.tiles[p.y]?.[p.x] ?? "wall";
}

export function zoneAt(level: Level, p: Vec): ZoneId | null {
  return level.zoneIds[p.y]?.[p.x] ?? null;
}

/** Muros, pedestales y la puerta de la bóveda cerrada bloquean el paso y la visión. Las puertas no. */
export function solid(level: Level, s: Pick<GameState, "vault">, p: Vec): boolean {
  const t = tileAt(level, p);
  return t === "wall" || t === "pedestal" || (t === "vault_door" && !s.vault.open);
}

// ---------------------------------------------------------------- carga

const vec = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });
const LevelSchema = z.object({
  id: z.string(),
  tiles: z.array(z.string()).min(1),
  zoneMap: z.array(z.string()).min(1),
  zones: z.record(z.string(), z.object({ id: z.string(), name: z.string(), label: z.string() })),
  thieves: z.object({ zorro: vec, llave: vec, eco: vec }),
  guards: z.array(z.object({ id: z.string(), name: z.string(), start: vec, facing: z.enum(["north", "east", "south", "west"]), patrol: z.array(vec).min(1) })),
}) satisfies z.ZodType<LevelData>;

export function parseLevel(raw: unknown): Level {
  const data = LevelSchema.parse(raw);
  const fail = (msg: string): never => {
    throw new Error(`level ${data.id}: ${msg}`);
  };
  const tiles = data.tiles.map((row, y) => [...row].map((ch, x) => TILE_CHARS[ch] ?? fail(`unknown tile '${ch}' at ${x},${y}`)));
  const width = tiles[0]!.length;
  const height = tiles.length;
  if (tiles.some((r) => r.length !== width)) fail("rows of different width");
  if (data.zoneMap.length !== height || data.zoneMap.some((r) => r.length !== width)) fail("zoneMap must match tiles");

  const zoneIds = data.zoneMap.map((row, y) =>
    [...row].map((ch, x) => {
      if (tiles[y]![x] === "wall") return ch === "#" ? null : fail(`wall with zone at ${x},${y}`);
      return data.zones[ch]?.id ?? fail(`no zone for '${ch}' at ${x},${y}`);
    }),
  );

  const find = (ch: string): Vec => {
    const found = data.tiles.flatMap((row, y) => [...row].flatMap((c, x) => (c === ch ? [{ x, y }] : [])));
    return found.length === 1 ? found[0]! : fail(`needs exactly one '${ch}', found ${found.length}`);
  };
  const exit = find("X");
  const vaultDoor = find("V");
  const diamond = find("*");

  const walkable = (p: Vec) => ["floor", "door", "exit"].includes(tiles[p.y]?.[p.x] ?? "wall");
  const zoneOf = (p: Vec) => zoneIds[p.y]?.[p.x] ?? null;
  const vaultFront = neighbors(vaultDoor).find((p) => walkable(p) && zoneOf(p) !== zoneOf(diamond)) ?? fail("vault door needs a walkable tile outside the vault");

  const zones: Level["zones"] = {};
  for (const z of Object.values(data.zones)) {
    const cells = zoneIds.flatMap((row, y) => row.flatMap((id, x) => (id === z.id && walkable({ x, y }) ? [{ x, y }] : [])));
    if (!cells.length) fail(`zone ${z.id} has no walkable tiles`);
    const cx = cells.reduce((sum, p) => sum + p.x, 0) / cells.length;
    const cy = cells.reduce((sum, p) => sum + p.y, 0) / cells.length;
    const center = cells.reduce((best, p) => (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? p : best));
    zones[z.id] = { name: z.name, label: z.label, center };
  }

  for (const [id, p] of Object.entries(data.thieves)) if (!walkable(p)) fail(`thief ${id} starts on a blocked tile`);
  for (const g of data.guards) {
    if (!walkable(g.start)) fail(`guard ${g.id} starts on a blocked tile`);
    if (g.patrol.some((p) => !walkable(p))) fail(`guard ${g.id} has a patrol stop on a blocked tile`);
  }

  return { id: data.id, width, height, tiles, zoneIds, zones, exit, vaultDoor, vaultFront, diamond, thieves: data.thieves, guards: data.guards };
}

export const LEVELS: Record<string, Level> = { museo: parseLevel(museo) };
