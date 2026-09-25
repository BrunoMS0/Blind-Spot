import Phaser from "phaser";
import { ALARM_TO_LOSE, GAME_NAME, RADIO_USES, RAISE_ALARM_THRESHOLD, THIEF_IDS, THIEVES, VAULT_FORCE_ACTIONS } from "../shared/config";
import { abilityState, availableActions, canUseRadio, type Ability } from "../shared/player-turn";
import { radioTrust } from "../shared/rules";
import type { GameEvent, GuardOption, ThiefId } from "../shared/types";
import type { GuardAnswer } from "../shared/api";
import { BOARD, CANVAS, MAP, type GameScene } from "./game-scene";
import { ABILITY, ABILITY_BLOCK, COMMANDER_INFO, LOSS, OPTION_LABEL, pct, TRUST } from "./texts";
import { num, PALETTE, THIEF_COLOR, typ, ui } from "./theme";
import { box, button, stat } from "./widgets";

// Interfaz encima del tablero, con el diseño de la vista previa: el tablero a la izquierda (marcador, mapa,
// acciones) y a la derecha las intenciones de los guardias, los controles y la bitácora. Se redibuja entera
// cada vez que GameScene avisa "changed"; los botones solo llaman comandos de GameScene.
const RIGHT = { x: BOARD.x + BOARD.w + 24, w: CANVAS.w - (BOARD.x + BOARD.w + 24) - 24 };
const LOG_KEEP = 40;

export class UIScene extends Phaser.Scene {
  private board!: GameScene;
  private root!: Phaser.GameObjects.Container;
  /** Bitácora, la más reciente primero. */
  private log: string[] = [];

  constructor() {
    super("ui");
  }

  create(): void {
    this.board = this.scene.get("game") as GameScene;
    this.root = this.add.container();
    this.log = [`El equipo entra por la puerta de servicio. Comandante ${COMMANDER_INFO[this.board.state.commander].name.toLowerCase()} de turno.`];
    this.board.events.on("changed", this.render, this);
    this.board.events.on("game-events", (events: GameEvent[]) => {
      this.log = [...events.flatMap((e) => this.describe(e)).reverse(), ...this.log].slice(0, LOG_KEEP);
      this.render();
    });
    this.render();
  }

  private keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.root.add(o);
    return o;
  }

  private text(x: number, y: number, str: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.keep(this.add.text(x, y, str, style));
  }

  private render(): void {
    this.root.removeAll(true);
    this.drawHeader();
    this.drawBoardFrame();
    this.drawIntentions();
    this.drawRadio();
    this.drawTurn();
    this.drawLog();
    this.drawOverlays();
  }

  // ---------------------------------------------------------------- encabezado

  private drawHeader(): void {
    const b = this.board;
    // "Blind Spot" a máquina, con "Spot" en dorado (como "El golpe" en la vista previa).
    const [first, ...rest] = GAME_NAME.split(" ");
    const t1 = this.text(BOARD.x, 12, `${first} `, typ(44));
    this.text(BOARD.x + t1.width, 12, rest.join(" "), typ(44, PALETTE.gold));

    const fs = this.keep(button(this, 0, 16, this.scale.isFullscreen ? "Salir de pantalla completa" : "Pantalla completa", () => b.toggleFullscreen(), { key: "F", size: 14 }));
    fs.setX(CANVAS.w - 24 - fs.width);
    const reset = this.keep(button(this, 0, 16, "Reiniciar golpe", () => location.assign(location.pathname), { size: 14 }));
    reset.setX(fs.x - 10 - reset.width);
    const cmd = this.text(0, 24, `Comandante ${COMMANDER_INFO[b.state.commander].name.toLowerCase()}`, ui(15, PALETTE.muted, "500"));
    cmd.setX(reset.x - 18 - cmd.width);
  }

  // ---------------------------------------------------------------- tablero: marcador y acciones

  private drawBoardFrame(): void {
    const b = this.board;
    const s = b.state;
    // La caja del tablero la dibuja GameScene detrás del mapa; aquí van el marcador y las acciones.
    const hudY = BOARD.y + 10;
    const col = (BOARD.w - 24) / 4;
    const x0 = BOARD.x + 12;
    this.keep(stat(this, x0, hudY, String(s.turn), "turno"));
    const alarm = this.keep(stat(this, x0 + col, hudY, "", "alarma"));
    const pips = this.add.graphics();
    for (let i = 0; i < ALARM_TO_LOSE; i++) {
      pips.lineStyle(2, num(PALETTE.red), 1).strokeCircle(20 + i * 22, 15, 7);
      if (i < s.alarm) pips.fillStyle(num(PALETTE.red), 1).fillCircle(20 + i * 22, 15, 7);
    }
    alarm.add(pips);
    this.keep(stat(this, x0 + col * 2, hudY, String(s.radio.usesLeft), "usos de radio"));
    this.keep(stat(this, x0 + col * 3, hudY, String(b.calls), "llamadas a Jev"));

    // Debajo del mapa: una tarjeta por ladrón (clic o 1·2·3 para elegirlo) y, a la derecha, sus acciones.
    const y = MAP.y + MAP.h + 8;
    const cardW = 210;
    const cardH = 62;
    THIEF_IDS.forEach((id, i) => this.thiefCard(id, i, MAP.x + i * (cardW + 10), y, cardW, cardH));

    // La habilidad del elegido siempre está a la vista: activa, o apagada con el motivo debajo.
    const ax = MAP.x + 3 * (cardW + 10) + 6;
    const { action, blocked } = abilityState(b.level, s, b.selected);
    const pressed = (action === "throw_coin" && b.mode === "coin") || (action === "blackout" && b.mode === "blackout");
    const use = action === "force_vault" ? () => b.act("force_vault") : () => b.setMode(action === "throw_coin" ? "coin" : "blackout");
    let x = ax;
    x += this.keep(button(this, x, y, this.abilityLabel(action), use, { size: 14, pressed, enabled: !b.busy && blocked === null })).width + 8;
    if (!b.busy && availableActions(b.level, s, b.selected).includes("take_diamond")) this.keep(button(this, x, y, "Tomar el diamante", () => b.act("take_diamond"), { size: 14, variant: "gold" }));
    const line = b.busy || blocked === "not_playing" ? "" : (this.hint() ?? (blocked ? ABILITY_BLOCK[blocked] : ABILITY[action].what));
    this.text(ax, y + 40, line, { ...ui(12, blocked && !this.hint() ? PALETTE.gold : PALETTE.muted), wordWrap: { width: MAP.x + MAP.w - ax } });
  }

  private abilityLabel(action: Ability): string {
    const s = this.board.state;
    if (action === "force_vault") return `${ABILITY.force_vault.name} ${s.vault.progress}/${VAULT_FORCE_ACTIONS}`;
    if (action === "blackout") return `${ABILITY.blackout.name} (${s.blackout.usesLeft} ${s.blackout.usesLeft === 1 ? "uso" : "usos"})`;
    return ABILITY[action].name;
  }

  /** Tarjeta de un ladrón: retrato, nombre en su color, su habilidad y qué le queda por hacer este turno. */
  private thiefCard(id: ThiefId, i: number, x: number, y: number, w: number, h: number): void {
    const b = this.board;
    const t = b.state.thieves[id];
    const selected = id === b.selected && !t.caught;
    const color = THIEF_COLOR[id];
    const g = this.keep(this.add.graphics());
    g.fillStyle(num(selected ? color : PALETTE.bg), selected ? 0.14 : 1).fillRoundedRect(x, y, w, h, 6);
    g.lineStyle(2, num(selected ? color : PALETTE.line), 1).strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 6);
    this.keep(this.add.image(x + 28, y + h / 2, `thief-${id}-0`).setScale(2.5).setAlpha(t.caught ? 0.3 : 1));
    this.text(x + 54, y + 5, THIEVES[id].name, typ(20, t.caught ? PALETTE.muted : color));
    this.text(x + w - 10, y + 7, String(i + 1), ui(12, PALETTE.muted, "700")).setOrigin(1, 0);
    const action = THIEVES[id].ability;
    this.keep(this.add.image(x + 62, y + 36, `icon-${action}`).setScale(1.25));
    this.text(x + 74, y + 29, this.abilityLabel(action), ui(12, PALETTE.muted, "500"));
    const status = t.caught ? "Atrapado" : t.moved && t.acted ? "Listo por este turno" : t.moved ? "Ya movió, puede actuar" : t.acted ? "Ya actuó, puede mover" : "Puede mover y actuar";
    this.text(x + 54, y + 44, status, ui(12, t.caught ? PALETTE.red : t.moved && t.acted ? PALETTE.muted : PALETTE.ink));
    if (t.hasDiamond) this.keep(this.add.image(x + w - 16, y + h - 18, "diamond-0").setScale(2));
    if (!t.caught) this.keep(this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true })).on("pointerup", () => b.select(id));
  }

  /** Qué tocar en el mapa en el modo activo (null si solo se está moviendo). */
  private hint(): string | null {
    const mode = this.board.mode;
    if (mode === "coin") return "Toca una casilla dorada del mapa. Esc cancela.";
    if (mode === "blackout") return "Toca en el mapa la sala que quieres dejar a oscuras. Esc cancela.";
    if (mode !== "move") return "Toca en el mapa la sala del reporte. Esc cancela.";
    return null;
  }

  /** El cartel sobre el mapa mientras se elige dónde usar algo. */
  private mapPrompt(): string | null {
    const b = this.board;
    const zone = b.hoverZone ? b.level.zones[b.hoverZone]?.label : null;
    const then = zone ? `  →  ${zone}` : "   (Esc cancela)";
    if (b.mode === "coin") return "Moneda: toca una casilla dorada para lanzarla   (Esc cancela)";
    if (b.mode === "blackout") return `Apagón: toca la sala que quieres dejar a oscuras${then}`;
    if (b.mode === "radio_movement") return `Radio: toca la sala donde reportar movimiento sospechoso${then}`;
    if (b.mode === "radio_all_clear") return `Radio: toca la sala que quieres dar por despejada${then}`;
    return null;
  }

  /** El objetivo del golpe según cómo va. */
  private objective(): string {
    const s = this.board.state;
    const goal = !s.vault.open
      ? "Objetivo: llevar a Llave frente a la puerta de la bóveda y forzarla (2 acciones)."
      : s.diamond
        ? "Objetivo: la bóveda está abierta; entra y toma el diamante."
        : "Objetivo: lleva el diamante a la salida verde de la entrada.";
    return goal;
  }

  // ---------------------------------------------------------------- intenciones de los guardias (Jev)

  private drawIntentions(): void {
    const b = this.board;
    const j = b.jev;
    const top = BOARD.y;
    const h = 480;
    this.keep(box(this, RIGHT.x, top, RIGHT.w, h));
    const x = RIGHT.x + 14;
    const w = RIGHT.w - 28;
    this.text(x, top + 12, "Lo que decidieron", typ(24));
    const viewer = this.keep(button(this, 0, top + 12, "Llamada", () => b.toggleViewer(), { key: "V", size: 12 }));
    viewer.setX(RIGHT.x + RIGHT.w - 14 - viewer.width);
    const replay = this.keep(button(this, 0, top + 12, "Repetir turno", () => void b.replayEnemyTurn(), { key: "R", size: 12, enabled: !b.busy && b.lastEnemyTurn !== null }));
    replay.setX(viewer.x - 8 - replay.width);
    const sub = j ? `Resultado de la llamada a Jev del turno ${j.turn}. ${this.who()}` : "Todavía no decidieron nada. Termina el turno para ver qué eligió cada guardia y con qué probabilidad.";
    const subText = this.text(x, top + 50, sub, { ...ui(14, PALETTE.muted), wordWrap: { width: w } });
    let y = top + 58 + subText.height;
    if (!j) return;
    for (const g of j.response.guards) y = this.guardCard(g, x, y, w) + 6;
    this.alarmRow(j.response.raiseAlarm, x, top + h - 48, w);
  }

  private who(): string {
    const m = this.board.lastMeta;
    if (!m) return "";
    if (m.source === "respaldo") return "Fue una decisión simulada (respaldo).";
    if (m.cached) return "Salió de la caché: no hubo llamada nueva.";
    return m.mode === "real" ? `Una sola solicitud decidió a los tres guardias (${m.latencyMs} ms).` : m.mode === "replay" ? "Respuesta grabada (replay)." : "Decidió el simulador (mock).";
  }

  /** Tarjeta de un guardia: nombre, zona y las barras de todas las opciones que se le ofrecieron. */
  private guardCard(g: GuardAnswer, x: number, y: number, w: number): number {
    const b = this.board;
    const guard = b.state.guards.find((s) => s.id === g.guard)!;
    const rows = (Object.entries(g.probabilities) as [GuardOption, number][]).sort((a, c) => c[1] - a[1]);
    const h = 28 + rows.length * 16 + 6;
    this.keep(box(this, x, y, w, h, PALETTE.bg));
    const name = b.level.guards.find((l) => l.id === g.guard)?.name ?? g.guard;
    this.text(x + 10, y + 5, name, typ(17));
    this.text(x + w - 10, y + 8, b.level.zones[b.level.zoneIds[guard.pos.y]?.[guard.pos.x] ?? ""]?.label ?? "", ui(12, PALETTE.muted)).setOrigin(1, 0);
    const bars = this.keep(this.add.graphics());
    const labelW = 190;
    const trackX = x + 10 + labelW;
    const trackW = w - 20 - labelW - 48;
    rows.forEach(([option, p], i) => {
      const ry = y + 29 + i * 16;
      const pick = option === g.option;
      this.text(x + 10, ry, OPTION_LABEL[option], ui(13, PALETTE.ink, pick ? "700" : "400"));
      bars.fillStyle(num(PALETTE.bar), 1).fillRect(trackX, ry + 3, trackW, 10);
      bars.fillStyle(num(pick ? PALETTE.gold : PALETTE.muted), 1).fillRect(trackX, ry + 3, trackW * p, 10);
      this.text(x + w - 10, ry, pct(p), ui(13, PALETTE.ink, pick ? "700" : "400")).setOrigin(1, 0);
    });
    return y + h;
  }

  /** raise_alarm frente al umbral: solo cuenta si la barra pasa la marca. */
  private alarmRow(r: { probability: number; raised: boolean }, x: number, y: number, w: number): void {
    const verdict = r.raised ? "la dieron" : "no la dieron";
    this.text(x, y, "Dar la alarma general", ui(14, PALETTE.ink, "500"));
    this.text(x + w, y, `${pct(r.probability)}, ${verdict}`, ui(14, r.probability >= RAISE_ALARM_THRESHOLD ? PALETTE.red : PALETTE.muted, "500")).setOrigin(1, 0);
    const g = this.keep(this.add.graphics());
    g.fillStyle(num(PALETTE.bar), 1).fillRect(x, y + 24, w, 10);
    g.fillStyle(num(PALETTE.red), 1).fillRect(x, y + 24, w * r.probability, 10);
    g.fillStyle(num(PALETTE.ink), 1).fillRect(x + w * RAISE_ALARM_THRESHOLD - 1, y + 20, 2, 18);
    this.text(x + w * RAISE_ALARM_THRESHOLD + 5, y + 20, "umbral", ui(11, PALETTE.muted));
  }

  // ---------------------------------------------------------------- radio pirateada

  /**
   * La radio: un reporte falso mueve a los guardias, pero si van y no encuentran a nadie dejan de creer. Por eso
   * el panel muestra la confianza de seguridad en la radio en tres niveles y el reporte que está en el aire.
   */
  private drawRadio(): void {
    const b = this.board;
    const s = b.state;
    const top = BOARD.y + 492;
    const h = 176;
    this.keep(box(this, RIGHT.x, top, RIGHT.w, h));
    const x = RIGHT.x + 14;
    const w = RIGHT.w - 28;

    this.text(x, top + 10, "Radio pirateada", typ(22));
    const pips = this.keep(this.add.graphics());
    for (let i = 0; i < RADIO_USES; i++) {
      const px = x + 200 + i * 16; // junto al título
      pips.lineStyle(2, num(PALETTE.cyan), 1).strokeRect(px, top + 16, 10, 14);
      if (i < s.radio.usesLeft) pips.fillStyle(num(PALETTE.cyan), 1).fillRect(px, top + 16, 10, 14);
    }
    this.text(x + w, top + 15, `${s.radio.usesLeft} de ${RADIO_USES}, una por turno`, ui(12, PALETTE.muted)).setOrigin(1, 0);
    this.text(x, top + 42, "Mándale a seguridad un reporte falso para moverlos. Si van y no encuentran a nadie, empiezan a desconfiar.", { ...ui(13, PALETTE.muted), wordWrap: { width: w } });

    const radioOk = canUseRadio(s) && !b.busy;
    const mv = this.keep(button(this, x, top + 82, "Reportar movimiento en…", () => b.setMode("radio_movement"), { size: 14, enabled: radioOk, pressed: b.mode === "radio_movement" }));
    this.keep(button(this, x + mv.width + 8, top + 82, "Dar por despejada…", () => b.setMode("radio_all_clear"), { size: 14, enabled: radioOk, pressed: b.mode === "radio_all_clear" }));

    // La confianza, en tres escalones: el actual encendido con su color.
    this.text(x, top + 126, "Confianza", ui(13, PALETTE.ink, "500"));
    const levels = ["high", "shaken", "lying"] as const;
    const label = { high: "Le creen", shaken: "Dudan", lying: "No le creen" };
    const current = radioTrust(s);
    const segW = (w - 84) / 3;
    const seg = this.keep(this.add.graphics());
    levels.forEach((lvl, i) => {
      const sx = x + 84 + i * segW;
      const on = lvl === current;
      seg.fillStyle(num(on ? TRUST[lvl].color : PALETTE.bg), 1).fillRect(sx, top + 122, segW - 4, 24);
      seg.lineStyle(1, num(on ? TRUST[lvl].color : PALETTE.line), 1).strokeRect(sx, top + 122, segW - 4, 24);
      this.text(sx + (segW - 4) / 2, top + 126, label[lvl], ui(13, on ? "#1d1c22" : PALETTE.muted, on ? "700" : "400")).setOrigin(0.5, 0);
    });

    const r = s.radio.active;
    const report = r ? `Reporte en el aire: "${r.kind === "movement" ? "movimiento sospechoso" : "todo despejado"} en ${b.level.zones[r.zone]?.label.toLowerCase()}".` : "Sin reporte en el aire.";
    this.text(x, top + 154, report, ui(13, r ? (r.kind === "movement" ? PALETTE.cyan : PALETTE.ok) : PALETTE.muted, r ? "500" : "400"));
  }

  // ---------------------------------------------------------------- fin de turno

  private drawTurn(): void {
    const b = this.board;
    const s = b.state;
    const top = BOARD.y + 680;
    const h = 56;
    this.keep(box(this, RIGHT.x, top, RIGHT.w, h));
    const x = RIGHT.x + 14;
    const end = this.keep(button(this, 0, top + 11, "Terminar turno", () => void b.endTurn(), { variant: "primary", key: "Enter", size: 15, enabled: !b.busy && s.outcome.status === "playing" }));
    end.setX(RIGHT.x + RIGHT.w - 14 - end.width);
    const width = end.x - x - 12;
    // A la izquierda: un fallo de Jev con sus salidas, un aviso del servidor o el objetivo del golpe.
    if (b.failed && !b.busy) {
      this.text(x, top + 6, b.status, { ...ui(11, PALETTE.red), wordWrap: { width } });
      const rw = b.failed.retryable ? this.keep(button(this, x, top + 30, "Reintentar", () => void b.endTurn(), { size: 11 })).width + 6 : 0;
      this.keep(button(this, x + rw, top + 30, "Usar decisión simulada", () => void b.endTurn(true), { size: 11 }));
    } else {
      const note = !b.busy && b.status ? b.status : s.outcome.status === "playing" ? this.objective() : "";
      this.text(x, top + 10, note, { ...ui(13, PALETTE.gold), wordWrap: { width } });
    }
  }

  private drawLog(): void {
    const top = BOARD.y + 748;
    const h = BOARD.y + BOARD.h - top;
    this.keep(box(this, RIGHT.x, top, RIGHT.w, h));
    this.text(RIGHT.x + 14, top + 8, "Bitácora", typ(18, PALETTE.muted));
    const g = this.keep(this.add.graphics());
    let y = top + 34;
    for (const line of this.log) {
      const t = this.text(RIGHT.x + 14, y, line, { ...ui(13, PALETTE.muted), wordWrap: { width: RIGHT.w - 28 } });
      y += t.height + 3;
      if (y > top + h - 8) {
        t.destroy();
        break;
      }
      for (let dx = 0; dx < RIGHT.w - 28; dx += 6) g.fillStyle(num(PALETTE.line), 1).fillRect(RIGHT.x + 14 + dx, y - 2, 3, 1);
    }
  }

  // ---------------------------------------------------------------- sobre el mapa: "decidiendo" y fin de partida

  private drawOverlays(): void {
    const b = this.board;
    const s = b.state;
    if (b.busy && b.status) {
      const t = this.text(MAP.x + MAP.w / 2, MAP.y + 14, b.status, ui(14, "#ffffff", "500")).setOrigin(0.5, 0);
      const pill = this.add.graphics().fillStyle(0x0c0b12, 0.85).fillRoundedRect(t.x - t.width / 2 - 14, t.y - 6, t.width + 28, t.height + 12, 14);
      this.root.addAt(pill, this.root.getIndex(t));
    }
    // Eligiendo en el mapa (sala o casilla): un cartel dice qué tocar, y nombra la sala bajo el mouse.
    const ask = b.busy || s.outcome.status !== "playing" ? null : this.mapPrompt();
    if (ask) {
      const t = this.text(MAP.x + MAP.w / 2, MAP.y + 14, ask, ui(15, "#ffffff", "500")).setOrigin(0.5, 0);
      const pill = this.add.graphics().fillStyle(0x0c0b12, 0.92).fillRoundedRect(t.x - t.width / 2 - 16, t.y - 7, t.width + 32, t.height + 14, 8);
      pill.lineStyle(2, num(PALETTE.gold), 1).strokeRoundedRect(t.x - t.width / 2 - 16, t.y - 7, t.width + 32, t.height + 14, 8);
      this.root.addAt(pill, this.root.getIndex(t));
    }
    const outcome = s.outcome;
    if (outcome.status === "playing") return;
    const won = outcome.status === "won";
    const cx = MAP.x + MAP.w / 2;
    const cy = MAP.y + MAP.h / 2;
    this.keep(this.add.rectangle(MAP.x, MAP.y, MAP.w, MAP.h, 0x0c0b12, 0.72).setOrigin(0));
    this.text(cx, cy - 50, won ? "Golpe perfecto" : "Golpe fallido", typ(52, "#ffffff")).setOrigin(0.5);
    const reason = won ? "Salieron con el diamante mientras los guardias todavía buscaban." : `Perdiste porque ${LOSS[outcome.reason]}.`;
    this.text(cx, cy + 8, `${reason} Llamadas a Jev usadas: ${b.calls}.`, { ...ui(17, "#ffffff"), align: "center", wordWrap: { width: 520 } }).setOrigin(0.5);
    const again = this.keep(button(this, 0, cy + 52, "Intentar de nuevo", () => location.assign(location.pathname), { variant: "gold", size: 16 }));
    again.setX(cx - again.width / 2);
  }

  /** Una frase por evento para la bitácora (los pasos de movimiento no se anotan). */
  private describe(e: GameEvent): string[] {
    const level = this.board.level;
    const guard = (id: string) => level.guards.find((g) => g.id === id)?.name ?? id;
    const thief = (id: keyof typeof THIEVES) => THIEVES[id].name;
    switch (e.type) {
      case "guard_decided":
        return [`${guard(e.decision.guard)} → ${OPTION_LABEL[e.decision.option].toLowerCase()} (${pct(e.decision.probability)}).`];
      case "thief_seen":
        return [`${guard(e.guard)} vio a ${thief(e.thief)}.`];
      case "alarm_raised":
        return [e.cause === "raise_alarm" ? "Seguridad dio la alarma general." : `La alarma sube a ${e.level} de ${ALARM_TO_LOSE}.`];
      case "thief_caught":
        return [`${guard(e.guard)} atrapó a ${thief(e.thief)}.`];
      case "noise_made":
        return [`Eco lanzó una moneda. ${e.heardBy.length ? `La oyó ${e.heardBy.map(guard).join(" y ")}.` : "Nadie la oyó."}`];
      case "radio_sent":
        return [`Radio: "${e.report.kind === "movement" ? "Movimiento sospechoso en" : "Todo despejado en"} ${level.zones[e.report.zone]?.label.toLowerCase()}".`];
      case "blackout_started":
        return [`Zorro cortó la luz en ${level.zones[e.zone]?.label.toLowerCase()}. Ahí los guardias apenas ven.`];
      case "deception_discovered":
        return [`${guard(e.guard)} no encontró a nadie. Seguridad empieza a desconfiar de la radio.`];
      case "vault_progress":
        return e.progress < VAULT_FORCE_ACTIONS ? ["Llave trabaja en la cerradura: falta una acción más."] : [];
      case "vault_opened":
        return ["Llave abrió la bóveda. Cualquier guardia que la vea lo notará."];
      case "diamond_taken":
        return [`${thief(e.thief)} tomó el diamante. Ahora hay que llegar a la salida.`];
      case "turn_ended":
        return [`Fin del turno ${e.turn}.`];
      case "game_over":
        return [e.outcome.status === "won" ? "¡Golpe exitoso!" : "El golpe fracasó."];
      case "thief_moved":
      case "guard_moved":
        return [];
    }
  }
}
