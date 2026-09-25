import Phaser from "phaser";
import { resolveEnemyTurn } from "../shared/enemy-turn";
import { key, LEVELS, same, zoneAt, type Level } from "../shared/level";
import { coinTargets, moveThief, reachable, sendRadio, thiefAct } from "../shared/player-turn";
import { activeThieves, clone, newGame, type Result } from "../shared/rules";
import type { CommanderId, Facing, GameEvent, GameState, GuardId, GuardOption, ThiefAction, ThiefId, Vec } from "../shared/types";
import { canSee, visibleTiles } from "../shared/vision";
import type { TurnResponse } from "../shared/api";
import { requestTurn, TurnFailed } from "./api";
import { makeArt, PX, SCALE } from "./art";
import { OPTION_LABEL, pct } from "./texts";
import { num, PALETTE, ui } from "./theme";
import { box } from "./widgets";

// Phaser solo dibuja, anima y lee input. Toda regla sale de src/shared: esta escena aplica una acción,
// anima los eventos que devuelve y se queda con el estado nuevo.

/** Canvas 16:9: en pantalla completa llena la pantalla; en ventana, Phaser lo escala conservando la proporción. */
export const CANVAS = { w: 1600, h: 900 };
/** Una casilla: 16 px de arte ampliados ×3. */
export const TILE = PX * SCALE;
/** La caja del tablero (marcador, mapa y acciones) y el mapa dentro. El diseño es para niveles de 20×14. */
export const BOARD = { x: 24, y: 70, w: 984, h: 818 };
export const MAP = { x: BOARD.x + 12, y: BOARD.y + 66, w: 20 * TILE, h: 14 * TILE };

export type Mode = "move" | "coin" | "blackout" | "radio_movement" | "radio_all_clear";

const px = (p: Vec) => ({ x: MAP.x + p.x * TILE + TILE / 2, y: MAP.y + p.y * TILE + TILE / 2 });
/** Altura de la etiqueta de papel sobre la cabeza del guardia. */
const CHIP_Y = -TILE * 0.7;
/** Textura del guardia según hacia dónde mira (el lado oeste es el este espejado). */
const guardLook = (f: Facing): { dir: string; flip: boolean } => (f === "north" ? { dir: "up", flip: false } : f === "south" ? { dir: "down", flip: false } : { dir: "side", flip: f === "west" });

export class GameScene extends Phaser.Scene {
  readonly level: Level = LEVELS.museo!;
  state!: GameState;
  selected: ThiefId = "zorro";
  mode: Mode = "move";
  busy = false;
  status = "";
  /** El último turno enemigo falló: la interfaz ofrece reintentar o usar el respaldo. */
  failed: TurnFailed | null = null;
  /** Quién decidió el último turno enemigo (modo, respaldo, caché, latencia). */
  lastMeta: TurnResponse["meta"] | null = null;
  /** Lo último que decidió Jev: la llamada del último turno enemigo. */
  jev: { turn: number; response: TurnResponse } | null = null;
  /** Llamadas que llegaron a un proveedor (sin contar las que salieron de la caché). */
  calls = 0;
  /** Para repetir el turno enemigo: el estado de antes y sus eventos. */
  lastEnemyTurn: { before: GameState; events: GameEvent[] } | null = null;

  private chips = new Map<GuardId, Phaser.GameObjects.Container>();
  private sprites = new Map<string, Phaser.GameObjects.Container>();
  private darkness!: Phaser.GameObjects.RenderTexture;
  private brush!: Phaser.GameObjects.Image;
  private coneGfx!: Phaser.GameObjects.Graphics;
  private hintGfx!: Phaser.GameObjects.Graphics;
  /** Salas resaltadas mientras el jugador elige una (apagón o radio). */
  private pickGfx!: Phaser.GameObjects.Graphics;
  /** La sala bajo el mouse en ese modo (la interfaz la nombra en el cartel). */
  hoverZone: string | null = null;
  private noiseLayer!: Phaser.GameObjects.Container;
  private vaultDoor!: Phaser.GameObjects.Image;
  private coinSparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private vaultSparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private effects!: Phaser.GameObjects.Layer;

  constructor() {
    super("game");
  }

  init(data: { commander: CommanderId; seed: number }): void {
    this.state = newGame(this.level, data.commander, data.seed);
  }

  create(): void {
    makeArt(this, this.level);
    // La caja del tablero va detrás de todo (UIScene está encima y taparía el mapa).
    box(this, BOARD.x, BOARD.y, BOARD.w, BOARD.h);
    // Capas de abajo hacia arriba (ARCHITECTURE.md, "Eventos → capas").
    const layers = {
      map: this.add.layer(),
      light: this.add.layer(),
      cones: this.add.layer(),
      entities: this.add.layer(),
      effects: this.add.layer(),
      jev: this.add.layer(),
    };
    this.effects = layers.effects;

    // El museo es una sola imagen de 320×224 ampliada ×3; la puerta de la bóveda cambia, así que va aparte.
    const door = px(this.level.vaultDoor);
    this.vaultDoor = this.add.image(door.x, door.y, "vault-closed").setScale(SCALE);
    layers.map.add([this.add.image(MAP.x, MAP.y, "museum").setOrigin(0).setScale(SCALE), this.vaultDoor]);

    // Noche: una capa oscura; las linternas la borran en las casillas que ve cada guardia (ver drawVision).
    this.darkness = this.add.renderTexture(MAP.x, MAP.y, MAP.w, MAP.h).setOrigin(0);
    this.brush = this.make.image({ key: "pixel", add: false }).setOrigin(0).setDisplaySize(TILE, TILE);
    layers.light.add(this.darkness);

    this.coneGfx = this.add.graphics();
    this.hintGfx = this.add.graphics();
    this.pickGfx = this.add.graphics();
    this.noiseLayer = this.add.container();
    layers.cones.add([this.coneGfx, this.hintGfx, this.noiseLayer]); // (un Layer no puede ir dentro de otro)
    layers.effects.add(this.pickGfx); // encima de la oscuridad: la sala elegible tiene que verse

    this.buildCharacters(layers.entities, layers.jev);

    const sparks = (tint: number[], speed: number) =>
      this.add.particles(0, 0, "spark", { speed: { min: speed / 3, max: speed }, lifespan: 600, scale: { start: SCALE, end: 0 }, tint, emitting: false });
    this.coinSparks = sparks([num(PALETTE.gold), 0xffe9a8], 150);
    this.vaultSparks = sparks([num(PALETTE.gold), 0xfff3cc, 0xffffff], 230);
    layers.effects.add([this.coinSparks, this.vaultSparks]);

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onTile({ x: Math.floor((p.x - MAP.x) / TILE), y: Math.floor((p.y - MAP.y) / TILE) }));
    // Eligiendo una sala: la que está bajo el mouse se ilumina.
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.pickingZone()) return;
      const zone = zoneAt(this.level, { x: Math.floor((p.x - MAP.x) / TILE), y: Math.floor((p.y - MAP.y) / TILE) });
      if (zone === this.hoverZone) return;
      this.hoverZone = zone;
      this.drawPick();
      this.events.emit("changed");
    });
    const keys = this.input.keyboard;
    keys?.on("keydown-ONE", () => this.select("zorro"));
    keys?.on("keydown-TWO", () => this.select("llave"));
    keys?.on("keydown-THREE", () => this.select("eco"));
    keys?.on("keydown-ESC", () => this.setMode("move"));
    keys?.on("keydown-ENTER", () => void this.endTurn());
    keys?.on("keydown-R", () => void this.replayEnemyTurn());
    keys?.on("keydown-V", () => this.toggleViewer());
    keys?.on("keydown-F", () => this.toggleFullscreen());

    // Nombres de las zonas sobre el plano, en el centro de cada una.
    for (const [id, z] of Object.entries(this.level.zones)) {
      const cells = this.level.zoneIds.flatMap((row, y) => row.flatMap((zid, x) => (zid === id ? [{ x, y }] : [])));
      const top = Math.min(...cells.map((c) => c.y));
      const xs = cells.filter((c) => c.y === top).map((c) => c.x);
      const label = this.add.text(MAP.x + ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * TILE, MAP.y + top * TILE + 12, z.label.toUpperCase(), { ...ui(12, "rgba(255,255,255,0.55)", "500"), letterSpacing: 1 });
      layers.map.add(label.setOrigin(0.5, 0));
    }

    // Leyenda de las casillas de ayuda, sobre el muro inferior del plano.
    layers.map.add(this.add.text(MAP.x + 14, MAP.y + (this.level.height - 1) * TILE + 15, "Casillas blancas: puedes ir sin que te vean.   Rojas: el camino cruza la vista de un guardia.", ui(12, "rgba(255,255,255,0.6)", "500")));

    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.scene.launch("ui");
    this.scene.bringToTop("ui"); // la interfaz va encima del tablero
    this.refresh();
  }

  private buildCharacters(entities: Phaser.GameObjects.Layer, jevLayer: Phaser.GameObjects.Layer): void {
    const shadow = () => this.add.rectangle(0, 5 * SCALE, 10 * SCALE, 2 * SCALE, 0x000000, 0.35);
    // El diamante destella cada tanto.
    const gem = this.add.image(0, 0, "diamond-0").setScale(SCALE);
    this.time.addEvent({ delay: 400, loop: true, callback: () => gem.setTexture(gem.texture.key === "diamond-0" ? "diamond-1" : "diamond-0") });
    this.sprites.set("diamond", this.add.container(0, 0, [gem]));

    for (const t of Object.values(this.state.thieves)) {
      // Selección: un recuadro punteado blanco, como en la guía.
      const sel = this.add.graphics().setName("sel");
      sel.lineStyle(2, 0xffffff, 1);
      for (let i = -TILE / 2; i < TILE / 2; i += 8) {
        sel.lineBetween(i, -TILE / 2 + 1, i + 4, -TILE / 2 + 1).lineBetween(i, TILE / 2 - 1, i + 4, TILE / 2 - 1);
        sel.lineBetween(-TILE / 2 + 1, i, -TILE / 2 + 1, i + 4).lineBetween(TILE / 2 - 1, i, TILE / 2 - 1, i + 4);
      }
      const body = this.add.image(0, 0, `thief-${t.id}-0`).setScale(SCALE).setName("body");
      const loot = this.add.image(TILE * 0.32, -TILE * 0.34, "diamond-0").setScale(1.5).setName("loot");
      this.sprites.set(t.id, this.add.container(0, 0, [shadow(), body, loot, sel]));
    }

    for (const g of this.state.guards) {
      const body = this.add.image(0, 0, `guard-${this.state.commander}-down-0`).setScale(SCALE).setName("body"); // visten como su comandante
      this.sprites.set(g.id, this.add.container(0, 0, [shadow(), body]));
      // Etiqueta de papel sobre el guardia: lo que eligió en el último turno. El contenedor
      // sigue al guardia; la etiqueta de adentro sube lo necesario para no tapar a otra (ver stackChips).
      const tag = this.add.container(0, CHIP_Y, [this.add.graphics(), this.add.text(0, 0, "", ui(13, "#1d1c22", "700")).setOrigin(0.5)]);
      const chip = this.add.container(0, 0, [tag]).setVisible(false);
      this.chips.set(g.id, chip);
      jevLayer.add(chip);
    }
    entities.add([...this.sprites.values()]);
  }

  // ---------------------------------------------------------------- comandos (los usa la interfaz)

  select(id: ThiefId): void {
    if (this.busy || this.state.thieves[id].caught) return;
    this.selected = id;
    this.mode = "move";
    this.refresh();
  }

  setMode(mode: Mode): void {
    if (this.busy) return;
    this.mode = this.mode === mode ? "move" : mode;
    this.refresh();
  }

  act(type: Exclude<ThiefAction["type"], "throw_coin" | "blackout">): void {
    if (this.busy) return;
    void this.apply(thiefAct(this.level, this.state, this.selected, { type }));
  }

  toggleFullscreen(): void {
    this.scale.toggleFullscreen();
  }

  /**
   * Pide el turno enemigo y lo resuelve. Mientras el servidor reintenta ante 429 (hasta ~30 s) se muestra
   * "pensando". Si falla, `failed` queda puesto y la interfaz ofrece reintentar o `endTurn(true)` (respaldo).
   */
  async endTurn(fallback = false): Promise<void> {
    if (this.busy || this.state.outcome.status !== "playing") return;
    this.busy = true;
    this.mode = "move";
    this.failed = null;
    this.setStatus(fallback ? "Decisión simulada…" : "Los guardias están decidiendo…");
    try {
      const r = await requestTurn(this.state, fallback);
      if (!r.meta.cached) this.calls++;
      this.lastMeta = r.meta;
      this.jev = { turn: this.state.turn, response: r };
      this.setStatus(r.meta.note ?? "");
      const result = resolveEnemyTurn(this.level, this.state, { guards: r.guards, raiseAlarm: r.raiseAlarm.raised });
      this.lastEnemyTurn = { before: this.state, events: result.events };
      await this.play(result.events);
      this.state = result.state;
      this.events.emit("game-events", result.events);
    } catch (e) {
      this.failed = e instanceof TurnFailed ? e : new TurnFailed(String(e), true);
      this.setStatus(`${this.failed.message}. Puedes reintentar o usar una decisión simulada.`);
    }
    if (this.state.thieves[this.selected].caught) this.selected = activeThieves(this.state)[0]?.id ?? this.selected;
    this.busy = false;
    this.refresh();
  }

  /** Vuelve a animar el último turno enemigo desde el estado de antes; al terminar, vuelve al estado actual. */
  async replayEnemyTurn(): Promise<void> {
    if (this.busy || !this.lastEnemyTurn) return;
    this.busy = true;
    this.hintGfx.clear();
    this.setStatus("Repitiendo el turno de seguridad…");
    await this.play(this.lastEnemyTurn.events, this.lastEnemyTurn.before);
    this.busy = false;
    this.setStatus("");
    this.refresh();
  }

  // ---------------------------------------------------------------- visor de la llamada completa

  toggleViewer(): void {
    const el = document.getElementById("call-viewer")!;
    el.hidden = !el.hidden;
    this.updateViewer();
  }

  private updateViewer(): void {
    const el = document.getElementById("call-viewer");
    if (!el || el.hidden) return;
    const j = this.jev;
    if (!j) {
      el.textContent = "Todavía no hay ninguna llamada a Jev. Termina el turno. (V cierra)";
      return;
    }
    const m = j.response.meta;
    const who = m.source === "respaldo" ? "respaldo" : `${m.mode}${m.cached ? ", de caché" : ""}`;
    const head = `Turno de seguridad ${j.turn} (${who}, ${m.latencyMs} ms, modelo ${m.model ?? "ninguno"}). V cierra.`;
    const { state, questions, answers } = j.response.call;
    el.textContent = [head, "Estado que ve Jev", JSON.stringify(state, null, 2), "Preguntas", JSON.stringify(questions, null, 2), "Respuestas", JSON.stringify(answers, null, 2)].join("\n\n");
  }

  // ---------------------------------------------------------------- input del mapa

  private onTile(t: Vec): void {
    if (this.busy || this.state.outcome.status !== "playing" || !zoneAt(this.level, t)) return;
    const { level, state, selected } = this;
    if (this.mode === "radio_movement" || this.mode === "radio_all_clear") {
      const kind = this.mode === "radio_movement" ? "movement" : "all_clear";
      this.mode = "move";
      void this.apply(sendRadio(level, state, kind, zoneAt(level, t)!));
      return;
    }
    if (this.mode === "coin") {
      this.mode = "move";
      if (coinTargets(level, state, selected).some((p) => same(p, t))) void this.apply(thiefAct(level, state, selected, { type: "throw_coin", target: t }));
      else this.refresh();
      return;
    }
    if (this.mode === "blackout") {
      this.mode = "move";
      void this.apply(thiefAct(level, state, selected, { type: "blackout", zone: zoneAt(level, t)! }));
      return;
    }
    const thief = activeThieves(state).find((th) => same(th.pos, t));
    if (thief) this.select(thief.id);
    else if (reachable(level, state, selected).has(key(t))) void this.apply(moveThief(level, state, selected, t));
  }

  private async apply(result: Result): Promise<void> {
    this.busy = true;
    this.hintGfx.clear();
    await this.play(result.events);
    this.state = result.state;
    this.busy = false;
    this.events.emit("game-events", result.events);
    this.refresh();
  }

  private setStatus(text: string): void {
    this.status = text;
    this.events.emit("changed");
  }

  // ---------------------------------------------------------------- dibujo

  /** Redibuja todo a partir del estado y avisa a la interfaz. */
  private refresh(view: GameState = this.state): void {
    this.vaultDoor.setTexture(view.vault.open ? "vault-open" : "vault-closed").setPosition(px(this.level.vaultDoor).x, px(this.level.vaultDoor).y);
    this.drawVision(view);
    this.drawHints();
    this.drawPick();
    this.drawNoises(view);
    this.syncSprites(view);
    this.drawChips();
    this.updateViewer();
    this.events.emit("changed");
  }

  /**
   * La noche y las linternas. Cada linterna ilumina exactamente las casillas que ve su guardia (visibleTiles):
   * lo iluminado es lo que las reglas consideran visible. Encima, el tinte amarillo de los conos.
   */
  private drawVision(view: GameState): void {
    const rt = this.darkness.clear().fill(0x080614, 0.42);
    const cones = this.coneGfx.clear();
    // Apagón: la sala queda bastante más oscura; lo poco que ven los guardias ahí (2 casillas) se ilumina encima.
    if (view.blackout.zone) {
      cones.fillStyle(0x000000, 0.45);
      this.level.zoneIds.forEach((row, y) => row.forEach((z, x) => z === view.blackout.zone && cones.fillRect(MAP.x + x * TILE, MAP.y + y * TILE, TILE, TILE)));
    }
    cones.fillStyle(0xffe282, 0.22);
    for (const guard of view.guards) {
      for (const t of visibleTiles(this.level, view, guard)) {
        rt.erase(this.brush, t.x * TILE, t.y * TILE);
        cones.fillRect(MAP.x + t.x * TILE, MAP.y + t.y * TILE, TILE, TILE);
      }
    }
    // El reporte de radio activo: el contorno punteado de la zona (cian = movimiento, verde = despejado).
    const r = view.radio.active;
    if (r) this.outlineZone(this.coneGfx, r.zone, r.kind === "movement" ? PALETTE.cyan : PALETTE.ok);
  }

  /** ¿El jugador está eligiendo una sala (apagón o radio)? */
  pickingZone(): boolean {
    return !this.busy && (this.mode === "blackout" || this.mode === "radio_movement" || this.mode === "radio_all_clear");
  }

  /** Eligiendo sala: todas con un contorno tenue y la que está bajo el mouse, iluminada con su nombre en el cartel. */
  private drawPick(): void {
    const g = this.pickGfx.clear();
    if (!this.pickingZone()) {
      this.hoverZone = null;
      return;
    }
    const color = this.mode === "blackout" ? "#c9c9d1" : this.mode === "radio_movement" ? PALETTE.cyan : PALETTE.ok;
    for (const zone of Object.keys(this.level.zones)) if (zone !== this.hoverZone) this.outlineZone(g, zone, color, 0.35);
    if (!this.hoverZone) return;
    g.fillStyle(num(color), 0.16);
    this.level.zoneIds.forEach((row, y) => row.forEach((z, x) => z === this.hoverZone && g.fillRect(MAP.x + x * TILE, MAP.y + y * TILE, TILE, TILE)));
    this.outlineZone(g, this.hoverZone, color, 1);
  }

  private outlineZone(gfx: Phaser.GameObjects.Graphics, zone: string, color: string, alpha = 0.9): void {
    const g = gfx.lineStyle(2, num(color), alpha);
    const inZone = (x: number, y: number) => this.level.zoneIds[y]?.[x] === zone;
    const dash = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      for (let d = 0; d < len; d += 9) {
        const k1 = d / len;
        const k2 = Math.min(1, (d + 5) / len);
        g.lineBetween(x1 + (x2 - x1) * k1, y1 + (y2 - y1) * k1, x1 + (x2 - x1) * k2, y1 + (y2 - y1) * k2);
      }
    };
    for (let y = 0; y < this.level.height; y++) {
      for (let x = 0; x < this.level.width; x++) {
        if (!inZone(x, y)) continue;
        const X = MAP.x + x * TILE;
        const Y = MAP.y + y * TILE;
        if (!inZone(x, y - 1)) dash(X, Y + 1, X + TILE, Y + 1);
        if (!inZone(x, y + 1)) dash(X, Y + TILE - 1, X + TILE, Y + TILE - 1);
        if (!inZone(x - 1, y)) dash(X + 1, Y, X + 1, Y + TILE);
        if (!inZone(x + 1, y)) dash(X + TILE - 1, Y, X + TILE - 1, Y + TILE);
      }
    }
  }

  /**
   * Casillas a las que puede ir el ladrón: blancas, o rojas si el camino pasa por la vista de un guardia.
   * Con la moneda, recuadros dorados donde puede caer.
   */
  private drawHints(): void {
    const g = this.hintGfx.clear();
    if (this.busy || this.state.outcome.status !== "playing") return;
    const s = this.state;
    if (this.mode === "coin") {
      g.lineStyle(2, num(PALETTE.gold), 0.75);
      for (const t of coinTargets(this.level, s, this.selected)) g.strokeRect(MAP.x + t.x * TILE + 4, MAP.y + t.y * TILE + 4, TILE - 8, TILE - 8);
      return;
    }
    if (this.mode !== "move") return;
    for (const path of reachable(this.level, s, this.selected).values()) {
      const t = path.at(-1)!;
      const risky = path.some((p) => s.guards.some((guard) => canSee(this.level, s, guard, p)));
      const color = risky ? 0xff5a50 : 0xffffff;
      g.fillStyle(color, risky ? 0.3 : 0.16).fillRect(MAP.x + t.x * TILE + 3, MAP.y + t.y * TILE + 3, TILE - 6, TILE - 6);
      g.lineStyle(2, color, risky ? 0.7 : 0.45).strokeRect(MAP.x + t.x * TILE + 4, MAP.y + t.y * TILE + 4, TILE - 8, TILE - 8);
    }
  }

  /** La moneda en el piso y la onda del ruido, mientras dure el turno. */
  private drawNoises(view: GameState): void {
    // Primero se detienen sus tweens infinitos: un tween vivo sobre un objeto destruido rompe el bucle del juego.
    this.tweens.killTweensOf(this.noiseLayer.list);
    this.noiseLayer.removeAll(true);
    for (const n of view.noises) {
      const c = px(n.pos);
      const ring = this.add.circle(c.x, c.y, 8).setStrokeStyle(2, 0xffdc78);
      this.tweens.add({ targets: ring, radius: TILE * 0.9, alpha: 0, duration: 1200, repeat: -1 });
      this.noiseLayer.add([ring, this.add.rectangle(c.x, c.y, 3 * SCALE, 3 * SCALE, 0xffd35a)]);
    }
  }

  private syncSprites(view: GameState): void {
    const diamond = this.sprites.get("diamond")!;
    diamond.setVisible(view.diamond !== null);
    if (view.diamond) diamond.setPosition(px(view.diamond).x, px(view.diamond).y);
    for (const t of Object.values(view.thieves)) {
      const c = this.sprites.get(t.id)!.setPosition(px(t.pos).x, px(t.pos).y).setVisible(!t.caught);
      c.setAlpha(t.moved && t.acted ? 0.55 : 1); // ya hizo todo este turno
      (c.getByName("sel") as Phaser.GameObjects.Graphics).setVisible(t.id === this.selected && view.outcome.status === "playing");
      (c.getByName("loot") as Phaser.GameObjects.Image).setVisible(t.hasDiamond);
    }
    for (const g of view.guards) {
      const c = this.sprites.get(g.id)!.setPosition(px(g.pos).x, px(g.pos).y);
      this.face(g.id, g.facing, 0);
      this.chips.get(g.id)!.setPosition(c.x, c.y);
    }
  }

  private face(guard: GuardId, facing: Facing, frame: 0 | 1): void {
    const { dir, flip } = guardLook(facing);
    (this.sprites.get(guard)!.getByName("body") as Phaser.GameObjects.Image).setTexture(`guard-${this.state.commander}-${dir}-${frame}`).setFlipX(flip);
  }

  /** Etiquetas de papel: lo que eligió cada guardia en el último turno. */
  private drawChips(): void {
    for (const g of this.state.guards) {
      const answer = this.jev?.response.guards.find((a) => a.guard === g.id);
      this.setChip(g.id, answer ? { option: answer.option, probability: answer.probability } : null);
    }
    this.stackChips();
  }

  /** Si dos etiquetas se tocan, la de más arriba en el mapa se queda y la otra sube hasta quedar libre. */
  private stackChips(): void {
    const placed: Phaser.Geom.Rectangle[] = [];
    const visible = [...this.chips.values()].filter((c) => c.visible).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const c of visible) {
      const tag = c.list[0] as Phaser.GameObjects.Container;
      const text = tag.list[1] as Phaser.GameObjects.Text;
      const w = text.width + 14;
      const h = text.height + 6;
      let y = CHIP_Y;
      const rect = () => new Phaser.Geom.Rectangle(c.x - w / 2, c.y + y - h / 2, w, h);
      while (placed.some((r) => Phaser.Geom.Rectangle.Overlaps(r, rect()))) y -= h + 2;
      tag.setY(y);
      placed.push(rect());
    }
  }

  private setChip(guard: GuardId, d: { option: GuardOption; probability: number } | null, pop = false): void {
    const c = this.chips.get(guard)!;
    c.setVisible(d !== null);
    if (!d) return;
    const tag = c.list[0] as Phaser.GameObjects.Container;
    const [bg, text] = tag.list as [Phaser.GameObjects.Graphics, Phaser.GameObjects.Text];
    const name = this.level.guards.find((x) => x.id === guard)?.name ?? guard;
    text.setText(`${name}: ${OPTION_LABEL[d.option]} ${pct(d.probability)}`);
    const w = text.width + 12;
    const h = text.height + 4;
    bg.clear().fillStyle(0xfff3c4, 1).fillRect(-w / 2, -h / 2, w, h);
    bg.lineStyle(1, 0x1d1c22, 1).strokeRect(-w / 2, -h / 2, w, h);
    if (pop) {
      c.setScale(0.6);
      this.tweens.add({ targets: c, scale: 1, duration: 180, ease: "Back.easeOut" });
    }
  }

  // ---------------------------------------------------------------- animación de eventos

  /**
   * Anima los eventos en orden sobre una copia del estado que se va actualizando. `from` es el estado del que
   * parten (el actual, o el de antes del turno enemigo para la repetición).
   */
  private async play(events: GameEvent[], from: GameState = this.state): Promise<void> {
    const view = clone(from);
    if (from !== this.state) {
      this.vaultDoor.setTexture(view.vault.open ? "vault-open" : "vault-closed");
      this.drawVision(view);
      this.drawNoises(view);
      this.syncSprites(view);
    }
    const guardPos = (id: string) => view.guards.find((g) => g.id === id)!.pos;
    let stepFrame: 0 | 1 = 0;
    for (const e of events) {
      switch (e.type) {
        case "thief_moved": {
          const body = this.sprites.get(e.thief)!.getByName("body") as Phaser.GameObjects.Image;
          for (const p of e.path) {
            view.thieves[e.thief].pos = p;
            stepFrame = stepFrame ? 0 : 1;
            body.setTexture(`thief-${e.thief}-${stepFrame}`);
            await this.tweenTo([this.sprites.get(e.thief)!], p, 110);
          }
          body.setTexture(`thief-${e.thief}-0`);
          break;
        }
        case "guard_moved": {
          const g = view.guards.find((x) => x.id === e.guard)!;
          g.facing = e.facing;
          this.face(g.id, e.facing, 0);
          for (const p of e.path) {
            g.pos = p;
            stepFrame = stepFrame ? 0 : 1;
            this.face(g.id, e.facing, stepFrame);
            await this.tweenTo([this.sprites.get(g.id)!, this.chips.get(g.id)!], p, 150);
            this.drawVision(view); // la linterna barre mientras camina
          }
          this.face(g.id, e.facing, 0);
          if (!e.path.length) await this.wait(150);
          this.drawVision(view);
          break;
        }
        case "thief_seen":
          await this.float(guardPos(e.guard), "!", PALETTE.red, 26);
          break;
        case "alarm_raised":
          this.cameras.main.flash(250, 140, 30, 30);
          this.cameras.main.shake(180, 0.004);
          await this.wait(250);
          break;
        case "thief_caught": {
          view.thieves[e.thief].caught = true;
          await this.float(view.thieves[e.thief].pos, "¡Atrapado!", PALETTE.red);
          this.syncSprites(view);
          break;
        }
        case "noise_made":
          await this.throwCoin(view.thieves.eco.pos, e.at);
          this.coinSparks.explode(14, px(e.at).x, px(e.at).y);
          view.noises.push({ pos: e.at, turn: view.turn });
          this.drawNoises(view);
          break;
        case "radio_sent":
          view.radio.active = e.report;
          this.drawVision(view);
          await this.float(this.level.zones[e.report.zone]!.center, e.report.kind === "movement" ? "Radio: movimiento sospechoso" : "Radio: todo despejado", PALETTE.cyan);
          break;
        case "blackout_started":
          // Un parpadeo y la sala se apaga.
          this.cameras.main.flash(120, 0, 0, 0);
          view.blackout.zone = e.zone;
          this.drawVision(view);
          await this.float(this.level.zones[e.zone]!.center, "¡Apagón!", PALETTE.muted);
          break;
        case "deception_discovered":
          await this.float(guardPos(e.guard), "¡La radio mintió!", PALETTE.cyan);
          break;
        case "vault_progress": {
          const door = px(this.level.vaultDoor);
          this.vaultSparks.explode(14, door.x, door.y + TILE / 2);
          this.cameras.main.shake(120, 0.003);
          await this.float(this.level.vaultDoor, `Forzando ${e.progress}/2`, PALETTE.gold);
          break;
        }
        case "vault_opened": {
          const door = px(this.level.vaultDoor);
          this.vaultSparks.explode(36, door.x, door.y);
          view.vault.open = true;
          this.vaultDoor.setTexture("vault-open");
          this.drawVision(view);
          await this.float(this.level.vaultDoor, "¡Abierta!", PALETTE.gold);
          break;
        }
        case "diamond_taken": {
          const thief = view.thieves[e.thief];
          await this.tweenTo([this.sprites.get("diamond")!], thief.pos, 250);
          view.diamond = null;
          thief.hasDiamond = true;
          this.syncSprites(view);
          break;
        }
        case "guard_decided":
          this.setChip(e.decision.guard, { option: e.decision.option, probability: e.decision.probability }, true);
          this.stackChips();
          await this.wait(220);
          break;
        case "turn_ended":
        case "game_over":
          break;
      }
    }
  }

  private tweenTo(targets: Phaser.GameObjects.Container[], p: Vec, duration: number): Promise<void> {
    return new Promise((resolve) => this.tweens.add({ targets, ...px(p), duration, onComplete: () => resolve() }));
  }

  /** La moneda vuela en arco desde Eco hasta donde cae. */
  private throwCoin(from: Vec, to: Vec): Promise<void> {
    const a = px(from);
    const b = px(to);
    const coin = this.add.rectangle(a.x, a.y, 3 * SCALE, 3 * SCALE, 0xffd35a);
    this.effects.add(coin);
    return new Promise((resolve) =>
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 380,
        onUpdate: (tw) => {
          const k = tw.getValue() ?? 0;
          coin.setPosition(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k - Math.sin(Math.PI * k) * TILE * 1.5);
        },
        onComplete: () => (coin.destroy(), resolve()),
      }),
    );
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private float(at: Vec, text: string, color: string, size = 14): Promise<void> {
    const t = this.add.text(px(at).x, px(at).y - TILE * 0.7, text, { ...ui(size, color, "700"), backgroundColor: "#0c0b12", padding: { x: 5, y: 2 } }).setOrigin(0.5, 1);
    this.effects.add(t);
    this.tweens.add({ targets: t, y: t.y - 18, alpha: 0, delay: 500, duration: 500, onComplete: () => t.destroy() });
    return this.wait(420);
  }
}
