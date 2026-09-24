import Phaser from "phaser";
import { ALARM_TO_LOSE, GAME_NAME, RADIO_USES, SPY_USES } from "../shared/config";
import { LINE, MAP, TEXT, TILE } from "./game-scene";

// ponytail: wireframe de la fase 0. Solo "Terminar turno" hace algo (un ida y vuelta al servidor);
// el resto muestra dónde va cada control.
const PANEL = { x: MAP.x + MAP.cols * TILE + 16, w: 304 };

export class UIScene extends Phaser.Scene {
  constructor() {
    super("ui");
  }

  create(): void {
    // barra superior
    this.add.text(MAP.x, 18, `${GAME_NAME.toUpperCase()}   Turno 1   Alarma`, { ...TEXT, fontSize: "14px", color: "#e8e4d8" });
    const alarm = this.add.graphics().lineStyle(2, 0xd05a5a);
    for (let i = 0; i < ALARM_TO_LOSE; i++) alarm.strokeRect(MAP.x + 300 + i * 22, 18, 16, 16);
    this.add.text(MAP.x + 372, 18, `0/${ALARM_TO_LOSE}   Comandante: cauteloso`, { ...TEXT, fontSize: "14px", color: "#e8e4d8" });
    const server = this.add.text(PANEL.x + PANEL.w, 18, "servidor …", TEXT).setOrigin(1, 0);
    health().then((h) => server.setText(h.ok ? `servidor ok · key ${h.jevKey ? "cargada" : "FALTA"}` : `servidor: ${h.error}`));

    // panel lateral
    let y = MAP.y;
    const box = (title: string, h: number): number => {
      this.add.graphics().lineStyle(1, LINE).strokeRect(PANEL.x, y, PANEL.w, h);
      this.add.text(PANEL.x + 8, y + 6, title, { ...TEXT, color: "#e8e4d8" });
      const top = y + 26;
      y += h + 10;
      return top;
    };
    const button = (x: number, top: number, label: string) =>
      this.add.text(x, top, ` ${label} `, { ...TEXT, color: "#e8e4d8", backgroundColor: "#2a2e3d" }).setPadding(4);

    let top = box("Ladrón seleccionado: Zorro", 70);
    this.add.text(PANEL.x + 8, top, "mueve 5 · acción: —", TEXT);
    button(PANEL.x + 8, top + 18, "Mover");
    button(PANEL.x + 72, top + 18, "Acción");

    top = box(`Radio pirateada · ${RADIO_USES}/${RADIO_USES}`, 84);
    button(PANEL.x + 8, top, "Movimiento en…");
    button(PANEL.x + 150, top, "Todo despejado en…");
    this.add.text(PANEL.x + 8, top + 32, "Confianza de los guardias: alta", TEXT);

    top = box(`Infiltrada · ${SPY_USES}/${SPY_USES}`, 56);
    button(PANEL.x + 8, top, "Activar");

    top = box("Jev · Vega (probabilidades)", 138);
    const bars = this.add.graphics();
    ["patrol", "investigate_noise", "guard_vault", "hold"].forEach((option, i) => {
      this.add.text(PANEL.x + 8, top + i * 24, option, TEXT);
      bars.lineStyle(1, 0xc9a3ff).strokeRect(PANEL.x + 150, top + i * 24 + 2, 110, 12);
      this.add.text(PANEL.x + 266, top + i * 24, "—%", TEXT);
    });

    const status = this.add.text(PANEL.x, y + 4, "", { ...TEXT, color: "#c9a3ff", wordWrap: { width: PANEL.w } });
    const endTurn = button(PANEL.x, MAP.y + MAP.rows * TILE - 28, "Terminar turno ▶").setInteractive({ useHandCursor: true });
    endTurn.on("pointerdown", async () => {
      status.setText("Los guardias están pensando…");
      const t0 = performance.now();
      const h = await health();
      status.setText(h.ok ? `El servidor respondió en ${Math.round(performance.now() - t0)} ms. (En la fase 1 aquí juega el turno enemigo con el mock.)` : `Error: ${h.error}`);
    });
  }
}

type Health = { ok: true; jevKey: boolean } | { ok: false; error: string };

async function health(): Promise<Health> {
  try {
    const r = await fetch("/api/health");
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return (await r.json()) as Health;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
