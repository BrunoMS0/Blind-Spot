// Piezas de interfaz dibujadas en Phaser, en el estilo de la guía: cajas y botones planos con borde de 2 px,
// esquinas apenas redondeadas, dorado para lo importante. Las usan UIScene y MenuScene.
import Phaser from "phaser";
import { num, PALETTE, typ, ui } from "./theme";

type Variant = "default" | "primary" | "gold";

const VARIANT: Record<Variant, { fill: string; edge: string; text: string; weight: "500" | "700" }> = {
  default: { fill: PALETTE.bg, edge: PALETTE.line, text: PALETTE.ink, weight: "500" },
  primary: { fill: PALETTE.ink, edge: PALETTE.ink, text: PALETTE.bg, weight: "700" },
  gold: { fill: PALETTE.gold, edge: PALETTE.gold, text: "#1d1c22", weight: "700" },
};

export interface ButtonOptions {
  variant?: Variant;
  /** Atajo de teclado, se muestra entre paréntesis y apagado. */
  key?: string;
  enabled?: boolean;
  /** Botón "presionado" (un modo activo, como apuntar la moneda): se pinta en naranja. */
  pressed?: boolean;
  size?: number;
  width?: number;
}

/** Botón plano. Al pasar el mouse el borde se enciende; presionado se hunde; deshabilitado queda a media luz. */
export function button(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, o: ButtonOptions = {}): Phaser.GameObjects.Container {
  const v = o.pressed ? { fill: PALETTE.thief, edge: PALETTE.thief, text: "#1d1c22", weight: "700" as const } : VARIANT[o.variant ?? "default"];
  const enabled = o.enabled ?? true;
  const size = o.size ?? 15;
  const h = Math.round(size * 2.3);
  const text = scene.add.text(0, h / 2, o.key ? `${label}  (${o.key})` : label, ui(size, v.text, v.weight)).setOrigin(0.5);
  const w = o.width ?? Math.round(text.width + size * 1.6);
  text.setX(w / 2);
  const bg = scene.add.graphics();
  const draw = (hover: boolean) => {
    bg.clear().fillStyle(num(v.fill), 1).fillRoundedRect(0, 0, w, h, 5);
    bg.lineStyle(2, num(hover && o.variant !== "primary" && o.variant !== "gold" ? PALETTE.ink : v.edge), 1).strokeRoundedRect(1, 1, w - 2, h - 2, 5);
  };
  draw(false);
  const hit = scene.add.zone(0, 0, w, h).setOrigin(0);
  const c = scene.add.container(x, y, [bg, text, hit]).setSize(w, h).setAlpha(enabled ? 1 : 0.45);
  if (enabled) {
    hit.setInteractive({ useHandCursor: true });
    hit.on("pointerover", () => draw(true));
    hit.on("pointerout", () => (draw(false), c.setY(y)));
    hit.on("pointerdown", () => c.setY(y + 1));
    hit.on("pointerup", () => (c.setY(y), onClick()));
  }
  return c;
}

/** Caja del expediente: fondo de panel y borde de 2 px. */
export function box(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill: string = PALETTE.panel): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(num(fill), 1).fillRoundedRect(x, y, w, h, 6);
  g.lineStyle(2, num(PALETTE.line), 1).strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 6);
  return g;
}

/** Una cifra del marcador: el valor grande a máquina y la etiqueta chica debajo, con una raya a la izquierda. */
export function stat(scene: Phaser.Scene, x: number, y: number, value: string, label: string): Phaser.GameObjects.Container {
  const rule = scene.add.graphics().fillStyle(num(PALETTE.line), 1).fillRect(0, 2, 3, 44);
  return scene.add.container(x, y, [rule, scene.add.text(12, 0, value, typ(26)), scene.add.text(12, 30, label, ui(13, PALETTE.muted))]);
}
