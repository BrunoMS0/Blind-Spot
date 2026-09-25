import Phaser from "phaser";
import { COMMANDERS, GAME_NAME } from "../shared/config";
import type { CommanderId } from "../shared/types";
import { CANVAS, TEXT } from "./game-scene";
import { COMMANDER_INFO } from "./texts";

// Selector de comandante antes de empezar. Elegir uno arranca GameScene con esa doctrina.
export class MenuScene extends Phaser.Scene {
  constructor() {
    super("menu");
  }

  create(data: { seed: number }): void {
    const cx = CANVAS.w / 2;
    this.add.text(cx, 120, GAME_NAME, { fontFamily: "Georgia, serif", fontSize: "64px", fontStyle: "italic", color: "#e8e4d8" }).setOrigin(0.5);
    this.add.text(cx, 180, "Un museo de noche. Tres ladrones. Un diamante.", { fontFamily: "Georgia, serif", fontSize: "18px", color: "#8a8fa3" }).setOrigin(0.5);
    this.add.text(cx, 250, "¿Quién comanda a los guardias esta noche?", { ...TEXT, fontSize: "14px", color: "#c9a3ff" }).setOrigin(0.5);

    COMMANDERS.forEach((id, i) => this.card(cx + (i - 1) * 330, 400, id, data.seed));

    this.add.text(cx, CANVAS.h - 40, "Los guardias los decide Jev (TypeSafe AI). Los comandantes solo difieren en su doctrina.", { ...TEXT, color: "#5d6378" }).setOrigin(0.5);
  }

  private card(x: number, y: number, id: CommanderId, seed: number): void {
    const info = COMMANDER_INFO[id];
    const box = this.add.rectangle(0, 0, 300, 190, 0x12141c).setStrokeStyle(1, 0x3a3f52);
    const c = this.add.container(x, y, [
      box,
      this.add.text(0, -58, info.name, { fontFamily: "Georgia, serif", fontSize: "28px", color: "#e8d27a" }).setOrigin(0.5),
      this.add.text(0, 10, info.blurb, { ...TEXT, fontSize: "13px", color: "#aab0c0", align: "center", wordWrap: { width: 250 } }).setOrigin(0.5),
      this.add.text(0, 70, "elegir", { ...TEXT, color: "#5d6378" }).setOrigin(0.5),
    ]);
    box.setInteractive({ useHandCursor: true });
    box.on("pointerover", () => {
      box.setStrokeStyle(2, 0xe8d27a);
      this.tweens.add({ targets: c, scale: 1.04, duration: 120 });
    });
    box.on("pointerout", () => {
      box.setStrokeStyle(1, 0x3a3f52);
      this.tweens.add({ targets: c, scale: 1, duration: 120 });
    });
    box.on("pointerdown", () => {
      this.cameras.main.fadeOut(250, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("game", { commander: id, seed }));
    });
  }
}
