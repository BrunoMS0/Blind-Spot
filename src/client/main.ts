import Phaser from "phaser";
import { COMMANDERS, GAME_NAME } from "../shared/config";
import { CANVAS, GameScene } from "./game-scene";
import { MenuScene } from "./menu-scene";
import { UIScene } from "./ui-scene";

document.title = GAME_NAME;

// Sin parámetros se muestra el selector de comandante. ?commander=impulsivo&seed=123 lo saltea
// (útil para repetir una partida: la misma semilla y las mismas jugadas dan la misma partida).
const params = new URLSearchParams(location.search);
const commander = COMMANDERS.find((c) => c === params.get("commander"));
const seed = Number(params.get("seed")) || Math.floor(Math.random() * 2 ** 31);

// FIT escala el canvas a la ventana conservando la proporción; las coordenadas del juego no cambian.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: CANVAS.w,
  height: CANVAS.h,
  backgroundColor: "#07080d",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});
game.scene.add("ui", UIScene);
game.scene.add("game", GameScene, commander !== undefined, { commander, seed }); // GameScene lanza UIScene encima
game.scene.add("menu", MenuScene, commander === undefined, { seed });

// Para depurar en la consola: __game.scene.getScene("game").state
if (import.meta.env.DEV) Object.assign(window, { __game: game });
