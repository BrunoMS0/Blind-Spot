import Phaser from "phaser";
import { COMMANDERS, GAME_NAME } from "../shared/config";
import { CANVAS, GameScene } from "./game-scene";
import { UIScene } from "./ui-scene";

document.title = GAME_NAME;

// ?commander=impulsivo&seed=123 (el selector de comandante llega en la fase 4). La misma semilla repite la partida.
const params = new URLSearchParams(location.search);
const commander = COMMANDERS.find((c) => c === params.get("commander")) ?? "cauteloso";
const seed = Number(params.get("seed")) || Math.floor(Math.random() * 2 ** 31);

// FIT escala el canvas a la ventana conservando la proporción; las coordenadas del juego no cambian.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: CANVAS.w,
  height: CANVAS.h,
  backgroundColor: "#0d0e14",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});
game.scene.add("ui", UIScene);
game.scene.add("game", GameScene, true, { commander, seed }); // GameScene lanza UIScene encima

// Para depurar en la consola: __game.scene.getScene("game").state
if (import.meta.env.DEV) Object.assign(window, { __game: game });
