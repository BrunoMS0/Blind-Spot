import Phaser from "phaser";
import { COMMANDERS, GAME_NAME } from "../shared/config";
import { LEVELS } from "../shared/level";
import type { CommanderId } from "../shared/types";
import { makeArt, SCALE } from "./art";
import { CANVAS } from "./game-scene";
import { COMMANDER_INFO } from "./texts";
import { PALETTE, typ, ui } from "./theme";
import { box, button } from "./widgets";

// Selector de comandante antes de empezar, con el tono de la vista previa: título a máquina, un párrafo que
// cuenta el golpe y tres fichas de comandante con su guardia en pixel art.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super("menu");
  }

  create(data: { seed: number }): void {
    makeArt(this, LEVELS.museo!);
    const cx = CANVAS.w / 2;
    const [first, ...rest] = GAME_NAME.split(" ");
    const t1 = this.add.text(0, 110, `${first} `, typ(110));
    const t2 = this.add.text(0, 110, rest.join(" "), typ(110, PALETTE.gold));
    t1.setX(cx - (t1.width + t2.width) / 2);
    t2.setX(t1.x + t1.width);
    this.add
      .text(cx, 290, "Tu equipo entra al museo de noche para robar el diamante. Los guardias los controla Jev: al final de tu turno, una sola llamada decide qué hace cada uno. Zorro puede dejar salas a oscuras, Eco los distrae con monedas y tu radio pirateada puede hacerles creer cosas que no son ciertas.", {
        ...ui(19, PALETTE.muted),
        align: "center",
        wordWrap: { width: 900 },
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0);
    this.add.text(cx, 440, "¿Quién está a cargo de la seguridad esta noche?", typ(28)).setOrigin(0.5);
    COMMANDERS.forEach((id, i) => this.card(cx - 520 + i * 360, 500, id, data.seed));
    this.add.text(cx, CANVAS.h - 44, "Mueve con clic, 1·2·3 elige ladrón, Enter termina el turno, F pantalla completa.", ui(15, PALETTE.muted)).setOrigin(0.5);
  }

  private card(x: number, y: number, id: CommanderId, seed: number): void {
    const info = COMMANDER_INFO[id];
    const w = 320;
    const h = 300;
    box(this, x, y, w, h);
    this.add.image(x + w / 2, y + 62, `guard-${id}-down-0`).setScale(SCALE + 2); // sus guardias visten así
    this.add.text(x + w / 2, y + 118, info.name, typ(30)).setOrigin(0.5, 0);
    this.add.text(x + w / 2, y + 162, info.blurb, { ...ui(16, PALETTE.muted), align: "center", wordWrap: { width: w - 40 } }).setOrigin(0.5, 0);
    const start = () => {
      this.cameras.main.fadeOut(250, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("game", { commander: id, seed }));
    };
    const pick = button(this, 0, y + h - 60, `Jugar contra el ${info.name.toLowerCase()}`, start, { variant: "primary", size: 15 });
    pick.setX(x + (w - pick.width) / 2);
  }
}
