import Phaser from "phaser";
import { ALARM_TO_LOSE, GAME_NAME, RADIO_USES, THIEF_IDS, THIEVES, VAULT_FORCE_ACTIONS } from "../shared/config";
import { availableActions, canUseRadio } from "../shared/player-turn";
import type { GameEvent, GuardOption, LossReason } from "../shared/types";
import { MAP, TEXT, TILE, type GameScene } from "./game-scene";

// Interfaz encima del tablero. Se redibuja entera cada vez que GameScene avisa "changed": es poca cosa y
// así nunca queda desincronizada. Los botones solo llaman comandos de GameScene.
const PANEL = { x: MAP.x + 20 * TILE + 16, w: 304 };
const BOTTOM = MAP.y + 14 * TILE;
const LOG_LINES = 12;

const OPTION_LABEL: Record<GuardOption, string> = {
  patrol: "patrullar",
  investigate_noise: "investigar ruido",
  respond_radio: "acudir a la radio",
  chase: "perseguir",
  guard_vault: "cuidar la bóveda",
  hold: "quedarse y mirar",
};
const LOSS: Record<LossReason, string> = {
  alarm: "la alarma llegó a 3",
  diamond_carrier_caught: "atraparon a quien llevaba el diamante",
  team_caught: "atraparon a todo el equipo",
};

export class UIScene extends Phaser.Scene {
  private board!: GameScene;
  private root!: Phaser.GameObjects.Container;
  private log: string[] = [];

  constructor() {
    super("ui");
  }

  create(): void {
    this.board = this.scene.get("game") as GameScene;
    this.root = this.add.container();
    this.board.events.on("changed", this.render, this);
    this.board.events.on("game-events", (events: GameEvent[]) => {
      this.log = [...this.log, ...events.flatMap((e) => this.describe(e))].slice(-LOG_LINES);
      this.render();
    });
    this.render();
  }

  private render(): void {
    this.root.removeAll(true);
    const b = this.board;
    const s = b.state;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.root.add(o), o);
    const text = (x: number, y: number, str: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}) => add(this.add.text(x, y, str, { ...TEXT, ...style }));
    const button = (x: number, y: number, label: string, onClick: () => void, enabled = true, active = false) => {
      const t = text(x, y, ` ${label} `, { color: enabled ? "#e8e4d8" : "#5d6378", backgroundColor: active ? "#4a3f7a" : "#2a2e3d" }).setPadding(4);
      if (enabled) t.setInteractive({ useHandCursor: true }).on("pointerdown", onClick);
      return t;
    };

    // barra superior
    text(MAP.x, 18, `${GAME_NAME.toUpperCase()}   Turno ${s.turn}   Alarma`, { fontSize: "14px", color: "#e8e4d8" });
    const alarm = add(this.add.graphics());
    for (let i = 0; i < ALARM_TO_LOSE; i++) {
      alarm.lineStyle(2, 0xd05a5a).strokeRect(MAP.x + 300 + i * 22, 18, 16, 16);
      if (i < s.alarm) alarm.fillStyle(0xd05a5a).fillRect(MAP.x + 303 + i * 22, 21, 10, 10);
    }
    text(MAP.x + 372, 18, `Comandante: ${s.commander}`, { fontSize: "14px", color: "#e8e4d8" });

    // equipo
    let y = MAP.y;
    const section = (title: string) => {
      text(PANEL.x, y, title, { color: "#e8e4d8" });
      y += 20;
    };
    section("Equipo (1 · 2 · 3)");
    for (const id of THIEF_IDS) {
      const t = s.thieves[id];
      const flags = t.caught ? "atrapado" : [t.moved && "movió", t.acted && "actuó", t.hasDiamond && "◆ diamante"].filter(Boolean).join(" · ");
      const row = text(PANEL.x, y, `${id === b.selected ? "▶" : " "} ${THIEVES[id].name.padEnd(6)} mueve ${THIEVES[id].move}  ${flags}`, { color: t.caught ? "#5d6378" : "#aab0c0" });
      if (!t.caught) row.setInteractive({ useHandCursor: true }).on("pointerdown", () => b.select(id));
      y += 18;
    }
    y += 8;

    // acciones del ladrón seleccionado
    section(`Acciones de ${THIEVES[b.selected].name}`);
    const actions = b.busy ? [] : availableActions(b.level, s, b.selected);
    let x = PANEL.x;
    if (actions.includes("force_vault")) x += button(x, y, `Forzar bóveda (${s.vault.progress}/${VAULT_FORCE_ACTIONS})`, () => b.act("force_vault")).width + 8;
    if (actions.includes("throw_coin")) x += button(x, y, "Lanzar moneda", () => b.setMode("coin"), true, b.mode === "coin").width + 8;
    if (actions.includes("take_diamond")) x += button(x, y, "Tomar diamante", () => b.act("take_diamond")).width + 8;
    if (!actions.length) text(PANEL.x, y + 4, "Sin acciones disponibles aquí.");
    y += 30;
    text(PANEL.x, y, this.hint(), { color: "#7d8398", wordWrap: { width: PANEL.w } });
    y += 34;

    // radio
    section(`Radio pirateada · ${s.radio.usesLeft}/${RADIO_USES} (una por turno)`);
    const radioOk = canUseRadio(s) && !b.busy;
    const w = button(PANEL.x, y, "Movimiento en…", () => b.setMode("radio_movement"), radioOk, b.mode === "radio_movement").width;
    button(PANEL.x + w + 8, y, "Todo despejado en…", () => b.setMode("radio_all_clear"), radioOk, b.mode === "radio_all_clear");
    y += 30;
    const r = s.radio.active;
    text(PANEL.x, y, r ? `Activo: "${r.kind === "movement" ? "movimiento" : "todo despejado"} en ${b.level.zones[r.zone]?.label}"` : "Sin reporte activo.");
    y += 24;

    // estado, registro y fin de turno
    text(PANEL.x, y, b.status, { color: "#c9a3ff", wordWrap: { width: PANEL.w } });
    y += 34;
    section("Registro");
    text(PANEL.x, y, this.log.join("\n"), { fontSize: "11px", lineSpacing: 2 });
    button(PANEL.x, BOTTOM - 26, "Terminar turno ▶  (Enter)", () => void b.endTurn(), !b.busy && s.outcome.status === "playing");

    const outcome = s.outcome;
    if (outcome.status !== "playing") {
      const won = outcome.status === "won";
      add(this.add.rectangle(MAP.x + 400, MAP.y + 280, 440, 150, 0x0d0e14, 0.95).setStrokeStyle(2, won ? 0x7fd48a : 0xd05a5a));
      text(MAP.x + 400, MAP.y + 250, outcome.status === "won" ? "¡Escaparon con el diamante!" : `Perdiste: ${LOSS[outcome.reason]}`, { fontSize: "18px", color: won ? "#7fd48a" : "#ff8080" }).setOrigin(0.5);
      button(MAP.x + 400, MAP.y + 305, "Nueva partida", () => location.assign(`?commander=${s.commander}`)).setOrigin(0.5);
    }
  }

  private hint(): string {
    const b = this.board;
    if (b.busy || b.state.outcome.status !== "playing") return "";
    if (b.mode === "coin") return "Clic en una casilla naranja para lanzar la moneda (Esc cancela).";
    if (b.mode !== "move") return "Clic en cualquier casilla de la zona a reportar (Esc cancela).";
    return b.state.thieves[b.selected].moved ? "Ya se movió este turno." : "Clic en una casilla azul para moverte.";
  }

  /** Una línea corta por evento (los pasos de movimiento no se anotan). */
  private describe(e: GameEvent): string[] {
    const guard = (id: string) => this.board.level.guards.find((g) => g.id === id)?.name ?? id;
    const thief = (id: keyof typeof THIEVES) => THIEVES[id].name;
    switch (e.type) {
      case "guard_decided":
        return [`${guard(e.decision.guard)}: ${OPTION_LABEL[e.decision.option]} (${Math.round(e.decision.probability * 100)} %)`];
      case "thief_seen":
        return [`${guard(e.guard)} vio a ${thief(e.thief)}`];
      case "alarm_raised":
        return [`Alarma ${e.level}/${ALARM_TO_LOSE}${e.cause === "raise_alarm" ? " (dieron la alarma)" : ""}`];
      case "thief_caught":
        return [`${guard(e.guard)} atrapó a ${thief(e.thief)}`];
      case "noise_made":
        return [`Moneda: la ${e.heardBy.length ? `oye ${e.heardBy.map(guard).join(", ")}` : "oye nadie"}`];
      case "radio_sent":
        return [`Radio: ${e.report.kind === "movement" ? "movimiento" : "despejado"} en ${this.board.level.zones[e.report.zone]?.label}`];
      case "deception_discovered":
        return [`${guard(e.guard)} descubrió el engaño (${e.deceptions})`];
      case "vault_progress":
        return [`Llave fuerza la bóveda (${e.progress}/${VAULT_FORCE_ACTIONS})`];
      case "vault_opened":
        return ["¡La bóveda está abierta!"];
      case "diamond_taken":
        return [`${thief(e.thief)} tomó el diamante`];
      case "turn_ended":
        return [`── fin del turno ${e.turn} ──`];
      case "game_over":
        return [e.outcome.status === "won" ? "¡Victoria!" : `Derrota: ${LOSS[e.outcome.reason]}`];
      case "thief_moved":
      case "guard_moved":
        return [];
    }
  }
}
