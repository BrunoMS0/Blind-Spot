// Tokens visuales de Blind Spot: estilo de juego clásico (pixel art) con la interfaz de un expediente del
// golpe: letra de máquina de escribir para títulos y cifras, sans sobria para leer, dorado como acento.
import type { ThiefId } from "../shared/types";

export const PALETTE = {
  bg: "#121118", // fondo y relleno de botones
  panel: "#1b1a22",
  ink: "#ecebf2",
  muted: "#a3a1b0",
  line: "#302e3b",
  bar: "#282633",
  gold: "#e3b34a", // acento: la opción elegida, el botín, el objetivo
  cyan: "#5fd3e0", // radio: reporte de "movimiento"
  red: "#ff7a6e", // alarma, peligro
  ok: "#86d38a", // salida, radio "todo despejado"
  thief: "#ff9a55", // modo activo del jugador (p. ej. apuntando la moneda)
} as const;

/** Colores del pixel art (el museo y los objetos). */
export const PIX = { gold: "#e3b34a", goldDark: "#a8791a" } as const;

export const THIEF_COLOR: Record<ThiefId, string> = { zorro: "#e8742a", llave: "#2bb3a3", eco: "#a36ae0" };

export const FONT = {
  /** Máquina de escribir: títulos, cifras del marcador y carteles. */
  typ: "'Special Elite', 'Courier New', monospace",
  ui: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
};

export const num = (color: string): number => parseInt(color.slice(1), 16);

/** Estilo de texto de la interfaz. `weight` va en el font de canvas ("500 15px IBM Plex Sans"). */
export const ui = (size: number, color: string = PALETTE.ink, weight: "400" | "500" | "700" = "400") => ({
  fontFamily: FONT.ui,
  fontSize: `${size}px`,
  color,
  fontStyle: weight === "400" ? "normal" : weight,
});

export const typ = (size: number, color: string = PALETTE.ink) => ({ fontFamily: FONT.typ, fontSize: `${size}px`, color });
