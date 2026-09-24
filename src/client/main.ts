import Phaser from "phaser";
import { GAME_NAME } from "../shared/config";
import { GameScene } from "./game-scene";
import { UIScene } from "./ui-scene";

document.title = GAME_NAME;

// GameScene dibuja el tablero por capas y lanza UIScene, que va encima con la interfaz.
// FIT escala el canvas a la ventana conservando la proporción; las coordenadas del juego no cambian.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1152,
  height: 632,
  backgroundColor: "#0d0e14",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene, UIScene],
});
