import Phaser from "phaser";
import { ALARM_TO_LOSE, GAME_NAME, RADIO_USES, SPY_USES, THIEF_IDS, THIEVES, VAULT_FORCE_ACTIONS } from "../shared/config";
import { availableActions, canUseRadio, canUseSpy } from "../shared/player-turn";
import { radioTrust } from "../shared/rules";
import type { GameEvent, GuardOption } from "../shared/types";
import { CANVAS, MAP, STRIP, TEXT, TILE, type GameScene } from "./game-scene";
import { LOSS, OPTION_LABEL, pct, probColor, TRUST } from "./texts";

// Interfaz encima del tablero. Se redibuja entera cada vez que GameScene avisa "changed": es poca cosa y
// así nunca queda desincronizada. Los botones solo llaman comandos de GameScene.
const PANEL = { x: MAP.x + 20 * TILE + 16, w: 304 };
const LOG_LINES = 16;

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

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

  // ---------------------------------------------------------------- piezas

  private keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.root.add(o);
    return o;
  }

  private text(x: number, y: number, str: string, style: TextStyle = {}): Phaser.GameObjects.Text {
    return this.keep(this.add.text(x, y, str, { ...TEXT, ...style }));
  }

  private button(x: number, y: number, label: string, onClick: () => void, enabled = true, active = false): Phaser.GameObjects.Text {
    const t = this.text(x, y, ` ${label} `, { color: enabled ? "#e8e4d8" : "#5d6378", backgroundColor: active ? "#4a3f7a" : "#2a2e3d" }).setPadding(4);
    if (enabled) t.setInteractive({ useHandCursor: true }).on("pointerdown", onClick);
    return t;
  }

  // ---------------------------------------------------------------- dibujo

  private render(): void {
    this.root.removeAll(true);
    this.drawTopBar();
    this.drawPanel();
    this.drawJevStrip();
    this.drawGameOver();
  }

  private drawTopBar(): void {
    const s = this.board.state;
    this.text(MAP.x, 18, `${GAME_NAME.toUpperCase()}   Turno ${s.turn}   Alarma`, { fontSize: "14px", color: "#e8e4d8" });
    const g = this.keep(this.add.graphics());
    for (let i = 0; i < ALARM_TO_LOSE; i++) {
      g.lineStyle(2, 0xd05a5a).strokeRect(MAP.x + 300 + i * 22, 18, 16, 16);
      if (i < s.alarm) g.fillStyle(0xd05a5a).fillRect(MAP.x + 303 + i * 22, 21, 10, 10);
    }
    this.text(MAP.x + 372, 18, `Comandante: ${s.commander}`, { fontSize: "14px", color: "#e8e4d8" });
  }

  private drawPanel(): void {
    const b = this.board;
    const s = b.state;
    let y = MAP.y;
    const section = (title: string) => {
      this.text(PANEL.x, y, title, { color: "#e8e4d8" });
      y += 20;
    };

    section("Equipo (1 · 2 · 3)");
    for (const id of THIEF_IDS) {
      const t = s.thieves[id];
      const flags = t.caught ? "atrapado" : [t.moved && "movió", t.acted && "actuó", t.hasDiamond && "◆ diamante"].filter(Boolean).join(" · ");
      const row = this.text(PANEL.x, y, `${id === b.selected ? "▶" : " "} ${THIEVES[id].name.padEnd(6)} mueve ${THIEVES[id].move}  ${flags}`, { color: t.caught ? "#5d6378" : "#aab0c0" });
      if (!t.caught) row.setInteractive({ useHandCursor: true }).on("pointerdown", () => b.select(id));
      y += 18;
    }
    y += 8;

    section(`Acciones de ${THIEVES[b.selected].name}`);
    const actions = b.busy ? [] : availableActions(b.level, s, b.selected);
    let x = PANEL.x;
    if (actions.includes("force_vault")) x += this.button(x, y, `Forzar bóveda (${s.vault.progress}/${VAULT_FORCE_ACTIONS})`, () => b.act("force_vault")).width + 8;
    if (actions.includes("throw_coin")) x += this.button(x, y, "Lanzar moneda", () => b.setMode("coin"), true, b.mode === "coin").width + 8;
    if (actions.includes("take_diamond")) x += this.button(x, y, "Tomar diamante", () => b.act("take_diamond")).width + 8;
    if (!actions.length) this.text(PANEL.x, y + 4, "Sin acciones disponibles aquí.");
    y += 30;
    this.text(PANEL.x, y, this.hint(), { color: "#7d8398", wordWrap: { width: PANEL.w } });
    y += 34;

    section(`Radio pirateada · ${s.radio.usesLeft}/${RADIO_USES} (una por turno)`);
    const radioOk = canUseRadio(s) && !b.busy;
    const w = this.button(PANEL.x, y, "Movimiento en…", () => b.setMode("radio_movement"), radioOk, b.mode === "radio_movement").width;
    this.button(PANEL.x + w + 8, y, "Todo despejado en…", () => b.setMode("radio_all_clear"), radioOk, b.mode === "radio_all_clear");
    y += 30;
    const trust = TRUST[radioTrust(s)];
    this.text(PANEL.x, y, "Confianza en la radio:");
    this.text(PANEL.x + 160, y, trust.text, { color: trust.color });
    y += 18;
    const r = s.radio.active;
    this.text(PANEL.x, y, r ? `Activo: "${r.kind === "movement" ? "movimiento" : "todo despejado"} en ${b.level.zones[r.zone]?.label}"` : "Sin reporte activo.");
    y += 28;

    section(`Infiltrada · ${s.spy.usesLeft}/${SPY_USES}`);
    if (s.spy.activeThisTurn) this.text(PANEL.x, y + 4, "Activa este turno: probabilidades en vivo abajo.", { color: "#c9a3ff" });
    else this.button(PANEL.x, y, "Activar este turno (I)", () => b.useSpy(), canUseSpy(s) && !b.busy);
    y += 36;

    this.text(PANEL.x, y, b.status, { color: b.failed ? "#ff8080" : "#c9a3ff", wordWrap: { width: PANEL.w } });
    y += 34;
    if (b.failed && !b.busy) {
      const rw = b.failed.retryable ? this.button(PANEL.x, y, "Reintentar", () => void b.endTurn()).width + 8 : 0;
      this.button(PANEL.x + rw, y, "Usar decisión simulada", () => void b.endTurn(true));
      y += 30;
    }

    section("Registro");
    this.text(PANEL.x, y, this.log.slice(-Math.floor((CANVAS.h - 50 - y) / 15)).join("\n"), { fontSize: "11px", lineSpacing: 2 });
    this.button(PANEL.x, CANVAS.h - 38, "Terminar turno ▶  (Enter)", () => void b.endTurn(), !b.busy && s.outcome.status === "playing");
  }

  /** La franja de Jev: por guardia, las barras de todas sus opciones. Decisión del turno o predicción en vivo. */
  private drawJevStrip(): void {
    const b = this.board;
    const j = b.jev;
    const g = this.keep(this.add.graphics());
    g.lineStyle(1, 0x3a3f52).strokeRect(STRIP.x, STRIP.y, STRIP.w, STRIP.h);
    const top = STRIP.y + 6;

    this.button(STRIP.x + STRIP.w - 196, top - 3, "Repetir (R)", () => void b.replayEnemyTurn(), !b.busy && b.lastEnemyTurn !== null);
    this.button(STRIP.x + STRIP.w - 92, top - 3, "Llamada (V)", () => b.toggleViewer());

    const spyActive = b.state.spy.activeThisTurn;
    if (!j || (spyActive && j.kind !== "spy")) {
      const msg = spyActive ? `INFILTRADA · ${b.spyStatus === "error" ? `sin señal: ${b.spyError}` : "consultando…"}` : "Jev todavía no decidió. Termina el turno (Enter) o activa la infiltrada (I) para ver sus probabilidades.";
      this.text(STRIP.x + 8, top, msg, { color: "#7d8398" });
      return;
    }

    const m = j.response.meta;
    const spyNote = b.spyStatus === "loading" ? "consultando…" : b.spyStatus === "error" ? `sin señal: ${b.spyError}` : "al día";
    const who = m.source === "respaldo" ? "respaldo (simulada)" : `${m.mode}${m.cached ? " (caché)" : ""} · ${m.latencyMs} ms`;
    const alarm = `alarma ${pct(j.response.raiseAlarm.probability)}${j.kind === "decision" && j.response.raiseAlarm.raised ? " → la dieron" : ""}`;
    this.text(STRIP.x + 8, top, j.kind === "spy" ? `INFILTRADA · predicción en vivo · ${spyNote} · ${alarm}` : `JEV · decisión del turno ${j.turn} · ${who} · ${alarm}`, {
      color: j.kind === "spy" ? "#c9a3ff" : "#e8e4d8",
    });

    const cardW = STRIP.w / j.response.guards.length;
    j.response.guards.forEach((guard, i) => {
      const x = STRIP.x + 8 + i * cardW;
      let y = top + 24;
      const name = b.level.guards.find((x) => x.id === guard.guard)?.name ?? guard.guard;
      if (j.kind === "spy") this.text(x, y, `${name} (predicción)`, { color: "#e8d27a" });
      else this.text(x, y, `${name} → ${OPTION_LABEL[guard.option]}`, { color: probColor(guard.probability), fontStyle: "bold" });
      y += 18;
      // El sorteo de la predicción no se muestra: con la misma semilla, delataría lo que va a pasar.
      const rows = (Object.entries(guard.probabilities) as [GuardOption, number][]).sort((a, c) => c[1] - a[1]);
      for (const [option, p] of rows) {
        const chosen = j.kind === "decision" && option === guard.option;
        this.text(x, y, `${chosen ? "▶" : " "}${OPTION_LABEL[option]}`, { fontSize: "11px", color: chosen ? "#e8e4d8" : "#aab0c0" });
        g.fillStyle(0x2a2e3d).fillRect(x + 118, y + 2, 96, 10);
        g.fillStyle(chosen ? 0xc9a3ff : 0x6b5f9a).fillRect(x + 118, y + 2, Math.max(1, 96 * p), 10);
        this.text(x + 220, y, pct(p), { fontSize: "11px" });
        y += 15;
      }
    });
  }

  private drawGameOver(): void {
    const s = this.board.state;
    const outcome = s.outcome;
    if (outcome.status === "playing") return;
    const won = outcome.status === "won";
    this.keep(this.add.rectangle(MAP.x + 400, MAP.y + 280, 440, 150, 0x0d0e14, 0.95).setStrokeStyle(2, won ? 0x7fd48a : 0xd05a5a));
    this.text(MAP.x + 400, MAP.y + 250, outcome.status === "won" ? "¡Escaparon con el diamante!" : `Perdiste: ${LOSS[outcome.reason]}`, { fontSize: "18px", color: won ? "#7fd48a" : "#ff8080" }).setOrigin(0.5);
    this.button(MAP.x + 400, MAP.y + 305, "Nueva partida", () => location.assign(`?commander=${s.commander}`)).setOrigin(0.5);
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
        return [`${guard(e.decision.guard)}: ${OPTION_LABEL[e.decision.option]} (${pct(e.decision.probability)})`];
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
      case "turn_ended": {
        const m = this.board.lastMeta;
        const who = !m ? "" : m.source === "respaldo" ? " · respaldo" : ` · ${m.mode}${m.cached ? " (caché)" : ""} ${m.latencyMs} ms`;
        return [`── fin del turno ${e.turn}${who} ──`];
      }
      case "game_over":
        return [e.outcome.status === "won" ? "¡Victoria!" : `Derrota: ${LOSS[e.outcome.reason]}`];
      case "thief_moved":
      case "guard_moved":
        return [];
    }
  }
}
