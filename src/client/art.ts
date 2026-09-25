// Pixel art original, dibujado por código a resolución nativa (16×16 por casilla). La escena lo amplía ×3 sin
// suavizar (filtro NEAREST), como un juego clásico. Los sprites se escriben como mapas de caracteres: cada letra
// es un color de la paleta y "." es transparente.
import Phaser from "phaser";
import { COMMANDERS } from "../shared/config";
import type { Level } from "../shared/level";
import type { CommanderId, ThiefId } from "../shared/types";
import { PIX, THIEF_COLOR } from "./theme";

export const PX = 16; // lado de una casilla en píxeles de arte
export const SCALE = 3; // píxeles de pantalla por píxel de arte

type Sprite = string[];
type Pal = Record<string, string>;

/** Pinta un mapa de caracteres en (ox, oy). Falla si una fila no mide 16: así un error de dibujo se ve al arrancar. */
function paint(ctx: CanvasRenderingContext2D, rows: Sprite, pal: Pal, ox = 0, oy = 0, flip = false): void {
  rows.forEach((row, y) => {
    if (row.length !== PX) throw new Error(`sprite row ${y} has ${row.length} px: "${row}"`);
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const color = pal[ch];
      if (!color) throw new Error(`no color for '${ch}'`);
      ctx.fillStyle = color;
      ctx.fillRect(ox + (flip ? PX - 1 - x : x), oy + y, 1, 1);
    });
  });
}

function texture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST); // píxeles duros al ampliar
}

// ---------------------------------------------------------------- guardias (4 direcciones × 2 pasos)

const GUARD_PAL: Pal = { k: "#15141c", n: "#16203f", N: "#2a3a6e", g: PIX.gold, s: "#e8c09a", S: "#c99a74", u: "#1f2d5a", U: "#2e4180", b: "#0e0e16", p: "#1a1d33", f: "#8a8a9a", l: "#ffe38a" };

const GUARD_DOWN: Sprite = [
  "................",
  "....kkkkkkkk....",
  "...knnnnnnnnk...",
  "...knnnggnnnk...",
  "..kNNNNNNNNNNk..",
  "...ksssssssSk...",
  "...ksskssksSk...",
  "...kssssssSSk...",
  "..kkuuuuuuuukk..",
  "..kuUuuuuuuUuk..",
  "..kuukuggukuuk..",
  "..ksskbbbbkssk..",
  "...kppppppppk...",
  "...kpppkkpppk...",
  "...kbbbk.kbbbk..",
  "................",
];
const GUARD_UP: Sprite = [
  "................",
  "....kkkkkkkk....",
  "...knnnnnnnnk...",
  "...knnnnnnnnk...",
  "..kNNNNNNNNNNk..",
  "...knnnnnnnnk...",
  "...kSSSSSSSSk...",
  "...kkSSSSSSkk...",
  "..kkuuuuuuuukk..",
  "..kuUuuuuuuUuk..",
  "..kuukuuuukuuk..",
  "..ksskbbbbkssk..",
  "...kppppppppk...",
  "...kpppkkpppk...",
  "...kbbbk.kbbbk..",
  "................",
];
const GUARD_SIDE: Sprite = [
  "................",
  ".....kkkkkk.....",
  "....knnnnnnk....",
  "....knnnnngk....",
  "....kNNNNNNNNk..",
  "....kSssssk.....",
  "....kSssksk.....",
  "....kSsssssk....",
  "....kkuuuuk.....",
  "....kuUuuuk.....",
  "....kuUuuuk.....",
  "....kgbbbbk.....",
  "....kppppk......",
  "....kppppk......",
  "....kbbbbbk.....",
  "................",
];
/** Segundo paso: cambian las piernas. */
function step(rows: Sprite, legs: [string, string]): Sprite {
  return [...rows.slice(0, 13), legs[0], legs[1], rows[15]!];
}
const LEGS_FRONT: [string, string] = ["...kpppk.kppk...", "...kbbbk..kbbk.."];
const LEGS_SIDE: [string, string] = ["....kppk.kpk....", "....kbbk.kbbk..."];

/** La linterna en la mano, apuntando hacia donde mira: [x, y, color] sobre el sprite. */
const FLASHLIGHT: Record<"down" | "up" | "side", [number, number, string][]> = {
  down: [[2, 12, "f"], [2, 13, "l"]],
  up: [[13, 10, "f"], [13, 9, "l"]],
  side: [[10, 10, "s"], [11, 10, "f"], [12, 10, "f"], [13, 10, "l"]],
};

type Dir = "down" | "up" | "side";

function guardFrame(rows: Sprite, dir: Dir, pal: Pal): (ctx: CanvasRenderingContext2D) => void {
  return (ctx) => {
    paint(ctx, rows, pal);
    for (const [x, y, c] of FLASHLIGHT[dir]) {
      ctx.fillStyle = pal[c]!;
      ctx.fillRect(x, y, 1, 1);
    }
  };
}

// ---------------------------------------------------------------- el uniforme de cada comandante

/**
 * Los guardias visten como su comandante: otro uniforme y un rasgo que cuenta la doctrina, visto de frente, de
 * espaldas y de perfil (filas que reemplazan a las del guardia base). El retrato del menú es el de frente.
 */
const COMMANDER_LOOK: Record<CommanderId, { pal: Pal } & Record<Dir, Record<number, string>>> = {
  // veterano: banda dorada en la gorra, bigote gris y charreteras doradas
  cauteloso: {
    pal: { m: "#c9c9d1" },
    down: { 3: "...knggggggnk...", 7: "...ksmmmmsSSk...", 8: "..kkguuuuuugkk.." },
    up: { 3: "...knggggggnk...", 8: "..kkguuuuuugkk.." },
    side: { 3: "....kggggggk....", 7: "....kSssmmsk....", 8: "....kkguuuk....." },
  },
  // sin gorra y despeinado, chaqueta roja, gritando con el silbato en la boca
  impulsivo: {
    pal: { h: "#8a4a1f", u: "#a8322a", U: "#d0463a", p: "#2a1d1d" },
    down: { 1: "....khkhhkhk....", 2: "...khhhhhhhhk...", 3: "...khhhhhhhhk...", 4: "...khsssssshk...", 7: "...kssskkssSg..." },
    up: { 1: "....khkhhkhk....", 2: "...khhhhhhhhk...", 3: "...khhhhhhhhk...", 4: "...khhhhhhhhk...", 5: "...khhhhhhhhk...", 6: "...kShhhhhhSk..." },
    side: { 1: ".....khkhhk.....", 2: "....khhhhhhk....", 3: "....khhhhhhk....", 4: "....khhhsssk....", 5: "....khssssk.....", 7: "....kSssssskg..." },
  },
  // uniforme oscuro con banda roja, lentes negros, una cicatriz y la boca apretada
  rencoroso: {
    pal: { r: "#8f2d3a", K: "#0a0a10", w: "#9fd8ff", u: "#2a1f33", U: "#3e2d4d", n: "#1a1320", N: "#2b2033" },
    down: { 3: "...knnrrrrnnk...", 5: "...kssssssrSk...", 6: "...kKwKKKKKSk...", 7: "...ksskkksSSk..." },
    up: { 3: "...knnrrrrnnk..." },
    side: { 3: "....knrrrrrk....", 5: "....kSsrssk.....", 6: "....kSsKKwk.....", 7: "....kSsssksk...." },
  },
};

// ---------------------------------------------------------------- ladrones (de frente × 2 pasos)

const THIEF_BASE: Sprite = [
  "................",
  ".....kkkkkk.....",
  "....kddddddk....",
  "....kdDDDDdk....",
  "....kddddddk....",
  "....kswsswsk....",
  "....kddddddk....",
  "...kkcccccckk...",
  "..kdDddddddDdk..",
  "..kdDddddddDdk..",
  "..kddkddddkddk..",
  "..kDDkddddkDDk..",
  "...kddddddddk...",
  "...kdddkkdddk...",
  "...kkkk..kkkk...",
  "................",
];
const THIEF_LEGS: [string, string] = ["...kddk..kddk...", "...kkk....kkk..."];

/** Cada ladrón cambia la cabeza y lleva algo propio. */
const THIEF_EXTRA: Record<ThiefId, { rows?: Record<number, string>; pixels?: [number, number, string][] }> = {
  // orejas de zorro en la capucha y la cola
  zorro: { rows: { 0: "....k......k....", 1: "....kckkkkck...." }, pixels: [[13, 11, "c"], [14, 12, "c"], [14, 13, "C"]] },
  // gorro con banda y una llave dorada en la mano
  llave: { rows: { 3: "....kcccccck...." }, pixels: [[12, 11, "o"], [13, 12, "o"], [14, 12, "o"], [14, 13, "o"]] },
  // capucha de color y una moneda en la mano
  eco: { rows: { 2: "....kcccccck....", 3: "...kcDDDDDDck...", 4: "...kcddddddck...", 5: "...kcswsswsck...", 6: "...kcddddddck..." }, pixels: [[12, 12, "y"], [13, 12, "y"]] },
};

function thiefFrame(id: ThiefId, frame: 0 | 1): (ctx: CanvasRenderingContext2D) => void {
  const color = THIEF_COLOR[id];
  const pal: Pal = { k: "#15141c", d: "#1c1a26", D: "#2e2b40", c: color, C: shade(color, 0.7), s: "#e8c09a", w: "#ffffff", o: PIX.gold, y: "#ffd35a" };
  const extra = THIEF_EXTRA[id];
  let rows = THIEF_BASE.map((r, i) => extra.rows?.[i] ?? r);
  if (frame === 1) rows = step(rows, THIEF_LEGS);
  return (ctx) => {
    paint(ctx, rows, pal);
    for (const [x, y, c] of extra.pixels ?? []) {
      ctx.fillStyle = pal[c]!;
      ctx.fillRect(x, y, 1, 1);
    }
  };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// ---------------------------------------------------------------- objetos

const DIAMOND: Sprite = [
  "................",
  "................",
  "................",
  "................",
  "......kkkk......",
  ".....kwwcck.....",
  "....kwwccCCk....",
  "....kkkkkkkk....",
  ".....kcCCCk.....",
  "......kCCk......",
  ".......kk.......",
  "................",
  "................",
  "................",
  "................",
  "................",
];
const DIAMOND_PAL: Pal = { k: "#1a2a36", w: "#ffffff", c: "#bff4ff", C: "#5fd3e0" };

/** Íconos de las habilidades, por tipo de acción (se ven en las tarjetas de los ladrones). */
const ICONS: Record<"force_vault" | "throw_coin" | "blackout", { rows: Sprite; pal: Pal }> = {
  force_vault: {
    pal: { k: "#3a2a10", g: PIX.gold },
    rows: [
      "................",
      "................",
      "................",
      "...kkkk.........",
      "..kggggk........",
      "..kgkkgk........",
      "..kggggkkkkkkk..",
      "...kkkkggggggk..",
      ".......kkgkkgk..",
      "........kgk.kk..",
      ".........k......",
      "................",
      "................",
      "................",
      "................",
      "................",
    ],
  },
  throw_coin: {
    pal: { k: "#3a2a10", y: "#ffd35a", w: "#fff3b0", g: PIX.goldDark },
    rows: [
      "................",
      "................",
      "......kkkk......",
      "....kkyyyykk....",
      "...kywwyyyyyk...",
      "...kwyyggyyyk...",
      "...kyygyygyyk...",
      "...kyygyygyyk...",
      "...kyyyggyyyk...",
      "....kkyyyykk....",
      "......kkkk......",
      "................",
      "................",
      "................",
      "................",
      "................",
    ],
  },
  // una ampolleta apagada
  blackout: {
    pal: { k: "#15141c", d: "#4a4f68", w: "#7c83a6", g: "#8a857a" },
    rows: [
      "................",
      "......kkkk......",
      ".....kddddk.....",
      "....kddwdddk....",
      "....kdwddddk....",
      "....kddddddk....",
      "....kddddddk....",
      ".....kddddk.....",
      "......kddk......",
      "......kggk......",
      "......kggk......",
      ".......kk.......",
      "................",
      "................",
      "................",
      "................",
    ],
  },
};

/** Puerta de bóveda de acero con volante; abierta, la hoja queda a un costado. */
function vaultDoor(ctx: CanvasRenderingContext2D, open: boolean): void {
  if (open) {
    ctx.fillStyle = "#3a4452";
    ctx.fillRect(0, 0, PX, PX);
    ctx.fillStyle = "#6b7688";
    ctx.fillRect(0, 0, 3, PX);
    ctx.fillStyle = "#8a96a8";
    ctx.fillRect(0, 0, 1, PX);
    return;
  }
  ctx.fillStyle = "#6b7688";
  ctx.fillRect(0, 0, PX, PX);
  ctx.fillStyle = "#8a96a8";
  ctx.fillRect(1, 1, PX - 2, 2);
  ctx.fillStyle = "#4e5868";
  ctx.fillRect(0, PX - 2, PX, 2);
  ctx.strokeStyle = "#c9d2de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(8, 8.5, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#c9d2de";
  ctx.fillRect(7, 8, 3, 1);
  ctx.fillRect(8, 7, 1, 3);
}

// ---------------------------------------------------------------- el museo (fondo fijo)

/** RNG determinista para los detalles (cuadros, motas): el museo se ve igual en cada partida. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Pinta el plano completo del nivel a resolución nativa: pisos por sala, muros con cuadros, vitrinas y salida. */
function paintMuseum(ctx: CanvasRenderingContext2D, level: Level): void {
  const r = seeded(9);
  const F = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  const tile = (x: number, y: number) => level.tiles[y]?.[x] ?? "wall";
  const centerCols = [9, 10]; // la alfombra roja del salón central
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const t = tile(x, y);
      const ox = x * PX;
      const oy = y * PX;
      const zone = level.zoneIds[y]?.[x];
      if (t !== "wall") {
        if (zone === "central_hall") {
          F(ox, oy, PX, PX, (x + y) % 2 ? "#2c3346" : "#323a50");
          if (centerCols.includes(x)) {
            F(ox, oy, PX, PX, "#5a1f2a");
            F(ox + (x === centerCols[0] ? 0 : PX - 1), oy, 1, PX, PIX.goldDark);
          }
        } else if (zone === "west_gallery" || zone === "entrance") {
          for (let py = 0; py < PX; py += 4) F(ox, oy + py, PX, 4, (py / 4 + x) % 2 ? "#3b2d29" : "#43332e");
          F(ox, oy + ((x * 3) % 4) * 4, PX, 1, "#2e221f");
        } else if (zone === "east_wing") {
          F(ox, oy, PX, PX, (x + y) % 2 ? "#26383d" : "#2b4046");
        } else if (zone === "vault") {
          F(ox, oy, PX, PX, "#3a4452");
          F(ox, oy, PX, 1, "#46505e");
          F(ox, oy, 1, PX, "#46505e");
        }
        if (r() < 0.05) F(ox + Math.floor(r() * 14), oy + Math.floor(r() * 14), 1, 1, "rgba(255,255,255,0.08)");
      }
      if (t === "wall") {
        F(ox, oy, PX, PX, "#3b3552");
        F(ox, oy, PX, 1, "#4d4668");
        if (tile(x, y + 1) !== "wall") {
          // la cara del muro que se ve desde abajo, con molduras y, a veces, un cuadro colgado
          F(ox, oy + PX - 6, PX, 6, "#25213a");
          for (let i = 0; i < PX; i += 5) F(ox + i, oy + PX - 6, 1, 6, "#1c1930");
          if (r() < 0.3 && y > 0) {
            F(ox + 4, oy + PX - 11, 8, 6, PIX.goldDark);
            F(ox + 5, oy + PX - 10, 6, 4, ["#3d6a8f", "#8f3d4a", "#4a8f5a", "#8f7a3d"][Math.floor(r() * 4)]!);
          }
        }
      }
      if (t === "door") {
        F(ox, oy, 2, PX, "#1c1930");
        F(ox + PX - 2, oy, 2, PX, "#1c1930");
      }
      if (t === "pedestal") {
        // vitrina: base de piedra y, alternando, un jarrón azul o un busto de mármol
        F(ox + 3, oy + 8, 10, 7, "#bdb8ad");
        F(ox + 3, oy + 8, 10, 1, "#e0dccf");
        F(ox + 3, oy + 14, 10, 1, "#8a857a");
        if ((x + y) % 2) {
          F(ox + 6, oy + 2, 4, 7, "#3d6a8f");
          F(ox + 5, oy + 4, 6, 3, "#4d7fa8");
          F(ox + 7, oy + 1, 2, 1, "#3d6a8f");
        } else {
          F(ox + 6, oy + 1, 4, 3, "#d8d4c8");
          F(ox + 5, oy + 4, 6, 5, "#d8d4c8");
          F(ox + 6, oy + 5, 1, 3, "#b0ab9f");
        }
      }
      if (t === "exit") {
        // salida: una flecha verde hacia afuera
        F(ox + 1, oy + 1, PX - 2, PX - 2, "#1f4a2a");
        F(ox + 3, oy + 7, 8, 2, "#6fe08a");
        F(ox + 3, oy + 5, 2, 6, "#6fe08a");
        F(ox + 2, oy + 6, 1, 4, "#6fe08a");
        F(ox + 1, oy + 7, 1, 2, "#6fe08a");
      }
    }
  }
}

/** Genera todas las texturas del juego (una sola vez). */
export function makeArt(scene: Phaser.Scene, level: Level): void {
  // Guardias: por comandante, 3 direcciones × 2 pasos. `guard-<comandante>-down-0` es también su retrato.
  const frames: [Dir, Sprite, [string, string]][] = [
    ["down", GUARD_DOWN, LEGS_FRONT],
    ["up", GUARD_UP, LEGS_FRONT],
    ["side", GUARD_SIDE, LEGS_SIDE],
  ];
  for (const id of COMMANDERS) {
    const look = COMMANDER_LOOK[id];
    const pal = { ...GUARD_PAL, ...look.pal };
    for (const [dir, base, legs] of frames) {
      const rows = base.map((r, i) => look[dir][i] ?? r);
      texture(scene, `guard-${id}-${dir}-0`, PX, PX, guardFrame(rows, dir, pal));
      texture(scene, `guard-${id}-${dir}-1`, PX, PX, guardFrame(step(rows, legs), dir, pal));
    }
  }
  for (const id of ["zorro", "llave", "eco"] as const) {
    texture(scene, `thief-${id}-0`, PX, PX, thiefFrame(id, 0));
    texture(scene, `thief-${id}-1`, PX, PX, thiefFrame(id, 1));
  }  texture(scene, "diamond-0", PX, PX, (ctx) => paint(ctx, DIAMOND, DIAMOND_PAL));
  texture(scene, "diamond-1", PX, PX, (ctx) => {
    paint(ctx, DIAMOND, DIAMOND_PAL);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(11, 3, 1, 1); // destello
    ctx.fillRect(12, 4, 1, 1);
  });
  for (const [action, icon] of Object.entries(ICONS)) texture(scene, `icon-${action}`, PX, PX, (ctx) => paint(ctx, icon.rows, icon.pal));
  texture(scene, "vault-closed", PX, PX, (ctx) => vaultDoor(ctx, false));
  texture(scene, "vault-open", PX, PX, (ctx) => vaultDoor(ctx, true));
  texture(scene, "museum", level.width * PX, level.height * PX, (ctx) => paintMuseum(ctx, level));
  texture(scene, "pixel", 1, 1, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
  });
  texture(scene, "spark", 2, 2, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 2, 2);
  });
}
