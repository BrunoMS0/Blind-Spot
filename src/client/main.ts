import Phaser from "phaser";
import { COMMANDERS, GAME_NAME } from "../shared/config";
import { CANVAS, GameScene } from "./game-scene";
import { MenuScene } from "./menu-scene";
import { PALETTE } from "./theme";
import { UIScene } from "./ui-scene";

document.title = GAME_NAME;

// Sin parámetros se muestra el selector de comandante. ?commander=impulsivo&seed=123 lo saltea
// (útil para repetir una partida: la misma semilla y las mismas jugadas dan la misma partida).
const params = new URLSearchParams(location.search);
const commander = COMMANDERS.find((c) => c === params.get("commander"));
const seed = Number(params.get("seed")) || Math.floor(Math.random() * 2 ** 31);

// Phaser dibuja el texto con la fuente que haya en ese momento: espera a las de Google Fonts (con un tope,
// por si no hay conexión; entonces usa las de respaldo del tema).
const fonts = Promise.all([document.fonts.load("40px 'Special Elite'"), document.fonts.load("16px 'IBM Plex Sans'"), document.fonts.load("500 16px 'IBM Plex Sans'"), document.fonts.load("700 16px 'IBM Plex Sans'")]);
void Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]).then(start);

function start(): void {
  // FIT escala el canvas 16:9 a la ventana conservando la proporción; en pantalla completa la llena.
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: CANVAS.w,
    height: CANVAS.h,
    backgroundColor: PALETTE.bg,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
  game.scene.add("ui", UIScene);
  game.scene.add("game", GameScene, commander !== undefined, { commander, seed }); // GameScene lanza UIScene encima
  game.scene.add("menu", MenuScene, commander === undefined, { seed });
  // Al entrar o salir de pantalla completa, la interfaz actualiza el texto de su botón.
  game.scale.on("enterfullscreen", () => game.scene.getScene("game").events.emit("changed"));
  game.scale.on("leavefullscreen", () => game.scene.getScene("game").events.emit("changed"));

  // Para depurar en la consola: __game.scene.getScene("game").state
  if (import.meta.env.DEV) Object.assign(window, { __game: game });
}
