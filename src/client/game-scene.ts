import Phaser from "phaser";
import { THIEVES, VISION_ANGLE_DEG, VISION_RANGE } from "../shared/config";

// ponytail: wireframe de la fase 0, con zonas y posiciones a mano. En la fase 1 todo sale del nivel
// (src/shared/levels) y de GameState; lo que se queda es la estructura de capas.
export const TILE = 40;
export const MAP = { x: 16, y: 56, cols: 20, rows: 14 };
export const LINE = 0x5a6072;
export const TEXT = { fontFamily: "monospace", fontSize: "12px", color: "#aab0c0" };

const ZONES = [
  { label: "Galería oeste", x: 0, y: 0, w: 6, h: 9 },
  { label: "Entrada", x: 0, y: 9, w: 6, h: 5 },
  { label: "Salón central", x: 6, y: 0, w: 8, h: 14 },
  { label: "Bóveda", x: 14, y: 0, w: 6, h: 5 },
  { label: "Ala este", x: 14, y: 5, w: 6, h: 9 },
];
const GUARDS = [
  { name: "Vega", x: 16, y: 9, facing: 270 },
  { name: "Rojas", x: 10, y: 4, facing: 180 },
  { name: "Soto", x: 3, y: 3, facing: 90 },
];

const cx = (tx: number) => MAP.x + tx * TILE + TILE / 2;
const cy = (ty: number) => MAP.y + ty * TILE + TILE / 2;

export class GameScene extends Phaser.Scene {
  constructor() {
    super("game");
  }

  create(): void {
    // Capas de abajo hacia arriba (ver ARCHITECTURE.md, "Eventos → capas").
    const layers = {
      map: this.add.layer(),
      cones: this.add.layer(),
      entities: this.add.layer(),
      effects: this.add.layer(),
      jev: this.add.layer(),
    };

    // mapa: cuadrícula 20×14, zonas, salida y puerta de la bóveda
    const grid = this.add.graphics().lineStyle(1, LINE, 0.25);
    for (let c = 0; c <= MAP.cols; c++) grid.lineBetween(MAP.x + c * TILE, MAP.y, MAP.x + c * TILE, MAP.y + MAP.rows * TILE);
    for (let r = 0; r <= MAP.rows; r++) grid.lineBetween(MAP.x, MAP.y + r * TILE, MAP.x + MAP.cols * TILE, MAP.y + r * TILE);
    grid.lineStyle(2, LINE, 1);
    for (const z of ZONES) grid.strokeRect(MAP.x + z.x * TILE, MAP.y + z.y * TILE, z.w * TILE, z.h * TILE);
    grid.lineStyle(4, 0xc8a24a, 1).lineBetween(MAP.x + 16 * TILE, MAP.y + 5 * TILE, MAP.x + 18 * TILE, MAP.y + 5 * TILE);
    grid.fillStyle(LINE, 0.6).fillRect(MAP.x + 12 * TILE, MAP.y + 6 * TILE, TILE, TILE).fillRect(MAP.x + 8 * TILE, MAP.y + 9 * TILE, TILE, TILE);
    layers.map.add([
      grid,
      ...ZONES.map((z) => this.add.text(MAP.x + z.x * TILE + 6, MAP.y + z.y * TILE + 4, z.label.toUpperCase(), TEXT)),
      this.add.text(MAP.x + 6, MAP.y + 13 * TILE + 12, "◀ SALIDA", { ...TEXT, color: "#7fd48a" }),
      this.add.text(MAP.x + 16 * TILE, MAP.y + 5 * TILE + 4, "puerta bóveda (cerrada)", { ...TEXT, color: "#c8a24a" }),
      this.add.text(MAP.x + 12 * TILE + 2, MAP.y + 7 * TILE + 2, "pedestal", TEXT),
    ]);

    // conos: 4 casillas, 90°, hacia donde mira cada guardia (sin línea de vista todavía)
    const cones = this.add.graphics().fillStyle(0xe8d27a, 0.12).lineStyle(1, 0xe8d27a, 0.6);
    for (const g of GUARDS) {
      const half = Phaser.Math.DegToRad(VISION_ANGLE_DEG / 2);
      const facing = Phaser.Math.DegToRad(g.facing);
      cones.slice(cx(g.x), cy(g.y), VISION_RANGE * TILE, facing - half, facing + half).fillPath().strokePath();
    }
    layers.cones.add(cones);

    // entidades: ladrones (círculos), guardias (cuadrados), diamante
    Object.values(THIEVES).forEach((t, i) => {
      layers.entities.add([
        this.add.circle(cx(1 + i), cy(12), TILE * 0.35).setStrokeStyle(2, 0x7fb8ff),
        this.add.text(cx(1 + i), cy(12), t.name[0]!, { ...TEXT, fontSize: "14px", color: "#7fb8ff" }).setOrigin(0.5),
      ]);
    });
    for (const g of GUARDS) {
      layers.entities.add([
        this.add.rectangle(cx(g.x), cy(g.y), TILE * 0.7, TILE * 0.7).setStrokeStyle(2, 0xe8d27a),
        this.add.text(cx(g.x), cy(g.y) + TILE * 0.55, g.name, TEXT).setOrigin(0.5, 0),
      ]);
    }
    layers.entities.add(this.add.text(cx(17), cy(2), "◆", { ...TEXT, fontSize: "22px", color: "#9fe8ff" }).setOrigin(0.5));

    // efectos: el ruido de una moneda
    layers.effects.add([
      this.add.circle(cx(8), cy(11), TILE * 1.2).setStrokeStyle(1, 0xff9f6b),
      this.add.text(cx(8), cy(11), "moneda", { ...TEXT, color: "#ff9f6b" }).setOrigin(0.5),
    ]);

    // info de Jev (fase 3): la opción sorteada de cada guardia y su probabilidad
    for (const g of GUARDS) {
      layers.jev.add(this.add.text(cx(g.x), cy(g.y) - TILE * 0.6, "[opción · %]", { ...TEXT, color: "#c9a3ff", backgroundColor: "#1a1726" }).setOrigin(0.5, 1));
    }

    this.add.text(MAP.x + MAP.cols * TILE - 4, MAP.y - 6, `WIREFRAME · fase 0 · capas: mapa · conos · entidades · efectos · jev`, { ...TEXT, color: "#6b7085" }).setOrigin(1, 1);
    this.scene.launch("ui");
  }
}
