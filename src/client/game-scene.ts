import Phaser from "phaser";
import { THIEVES, VISION_RANGE } from "../shared/config";
import { resolveEnemyTurn } from "../shared/enemy-turn";
import { key, LEVELS, same, tileAt, zoneAt, type Level } from "../shared/level";
import { activateSpy, canUseSpy, coinTargets, moveThief, reachable, sendRadio, thiefAct } from "../shared/player-turn";
import { activeThieves, clone, newGame, type Result } from "../shared/rules";
import type { CommanderId, Facing, GameEvent, GameState, GuardDecision, GuardId, ThiefAction, ThiefId, Vec } from "../shared/types";
import { visibleTiles } from "../shared/vision";
import type { TurnResponse } from "../shared/api";
import { requestTurn, TurnFailed } from "./api";
import { OPTION_LABEL, pct, probColor } from "./texts";

// Phaser solo dibuja, anima y lee input. Toda regla sale de src/shared: esta escena aplica una acción,
// anima los eventos que devuelve y se queda con el estado nuevo.
export const TILE = 40;
export const MAP = { x: 16, y: 56 };
/** Franja de Jev bajo el mapa: las barras de probabilidad de cada guardia (la dibuja UIScene). */
export const STRIP = { x: MAP.x, y: MAP.y + 14 * TILE + 12, w: 20 * TILE, h: 140 };
export const CANVAS = { w: 1152, h: STRIP.y + STRIP.h + 12 };
export const TEXT = { fontFamily: "monospace", fontSize: "12px", color: "#aab0c0" };
/** La infiltrada espera a que el jugador deje de tocar cosas antes de consultar (cada consulta es una llamada). */
const SPY_DEBOUNCE_MS = 700;

export type Mode = "move" | "coin" | "radio_movement" | "radio_all_clear";

// Paleta noir: azules casi negros, luz cálida de linterna, pocos colores saturados.
const COLOR = {
  floor: 0x12141c,
  grid: 0x1a1d28,
  wall: 0x262a36,
  wallEdge: 0x454b60,
  door: 0x5a4630,
  pedestal: 0x2f3445,
  vitrine: 0x4a5068,
  vault: 0xb8913e,
  exit: 0x1f4a2c,
  cone: 0xf3e2a0,
  reach: 0x5b8cff,
  coin: 0xffc86b,
  guard: 0xe8d27a,
  thief: { zorro: 0xe8845a, llave: 0x7fa8e0, eco: 0x8fcf86 } satisfies Record<ThiefId, number>,
};
/** Oscuridad sobre el museo; las linternas la "borran" en las casillas que ve cada guardia. */
const DARKNESS = 0.52;
const ROTATION: Record<Facing, number> = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };
const px = (p: Vec) => ({ x: MAP.x + p.x * TILE + TILE / 2, y: MAP.y + p.y * TILE + TILE / 2 });
/** El ángulo equivalente a `target` más cercano a `current`: así el guardia gira por el lado corto. */
const nearestAngle = (current: number, target: number) => current + Phaser.Math.Angle.Wrap(target - current);

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
  /** Lo último que dijo Jev: la decisión del turno enemigo o la predicción en vivo de la infiltrada. */
  jev: { kind: "decision" | "spy"; turn: number; response: TurnResponse } | null = null;
  spyStatus: "idle" | "loading" | "ok" | "error" = "idle";
  spyError = "";
  /** Para repetir el turno enemigo: el estado de antes y sus eventos. */
  lastEnemyTurn: { before: GameState; events: GameEvent[] } | null = null;

  private spySeq = 0;
  private spyKey = "";
  private spyTimer: Phaser.Time.TimerEvent | null = null;
  private jevLabels = new Map<GuardId, Phaser.GameObjects.Container>();
  private mapGfx!: Phaser.GameObjects.Graphics;
  private hintGfx!: Phaser.GameObjects.Graphics;
  private coneGfx!: Phaser.GameObjects.Graphics;
  private darkness!: Phaser.GameObjects.RenderTexture;
  private lightBrush!: Phaser.GameObjects.Image;
  private vaultDoor!: Phaser.GameObjects.Rectangle;
  private coinSparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private vaultSparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private effects!: Phaser.GameObjects.Layer;
  private sprites = new Map<string, Phaser.GameObjects.Container>();

  constructor() {
    super("game");
  }

  init(data: { commander: CommanderId; seed: number }): void {
    this.state = newGame(this.level, data.commander, data.seed);
  }

  create(): void {
    this.makeTextures();
    // Capas de abajo hacia arriba (ARCHITECTURE.md, "Eventos → capas"). La luz va entre entidades y efectos:
    // oscurece el museo y los personajes, pero no los efectos ni las etiquetas de Jev.
    const layers = {
      map: this.add.layer(),
      cones: this.add.layer(),
      entities: this.add.layer(),
      light: this.add.layer(),
      effects: this.add.layer(),
      jev: this.add.layer(),
    };
    this.effects = layers.effects;
    this.mapGfx = this.add.graphics();
    this.hintGfx = this.add.graphics();
    const door = px(this.level.vaultDoor);
    this.vaultDoor = this.add.rectangle(door.x, door.y, TILE - 4, TILE - 4, COLOR.vault);
    layers.map.add([this.mapGfx, this.vaultDoor]);
    layers.effects.add(this.hintGfx); // las casillas de ayuda van sobre la oscuridad: tienen que leerse siempre
    for (const [id, z] of Object.entries(this.level.zones)) {
      // La etiqueta va en la primera casilla de suelo de la zona (en orden de lectura), nunca en un muro o puerta.
      const first = this.level.zoneIds.flatMap((row, y) => row.flatMap((zid, x) => (zid === id && tileAt(this.level, { x, y }) === "floor" ? [{ x, y }] : [])))[0]!;
      layers.map.add(this.add.text(MAP.x + first.x * TILE + 4, MAP.y + first.y * TILE + 3, z.label.toUpperCase(), { ...TEXT, fontSize: "10px", color: "#5d6378" }));
    }
    this.coneGfx = this.add.graphics();
    layers.cones.add(this.coneGfx);

    const diamond = this.add.container(0, 0, [this.add.text(0, 0, "◆", { ...TEXT, fontSize: "24px", color: "#9fe8ff" }).setOrigin(0.5)]);
    this.sprites.set("diamond", diamond);
    for (const t of Object.values(this.state.thieves)) {
      const c = this.add.container(0, 0, [
        this.add.circle(0, 0, TILE * 0.42).setStrokeStyle(2, 0xffffff).setName("ring"),
        this.add.circle(0, 0, TILE * 0.32, COLOR.thief[t.id]),
        this.add.text(0, 0, THIEVES[t.id].name[0]!, { ...TEXT, fontSize: "15px", color: "#10121a", fontStyle: "bold" }).setOrigin(0.5),
        this.add.text(TILE * 0.3, -TILE * 0.3, "◆", { ...TEXT, fontSize: "14px", color: "#9fe8ff" }).setOrigin(0.5).setName("loot"),
      ]);
      this.sprites.set(t.id, c);
    }
    for (const g of this.state.guards) {
      const name = this.level.guards.find((x) => x.id === g.id)?.name ?? g.id;
      const body = this.add.container(0, 0, [
        this.add.rectangle(0, 0, TILE * 0.62, TILE * 0.62, 0x2a2616).setStrokeStyle(2, COLOR.guard),
        this.add.triangle(TILE * 0.42, 0, 0, -6, 0, 6, 9, 0, COLOR.guard),
      ]).setName("body");
      this.sprites.set(g.id, this.add.container(0, 0, [body, this.add.text(0, TILE * 0.36, name, { ...TEXT, fontSize: "10px", color: "#e8d27a" }).setOrigin(0.5, 0)]));
    }
    layers.entities.add([...this.sprites.values()]);

    // Info de Jev: una etiqueta por guardia con la opción elegida y su probabilidad. Va en su propia capa
    // (encima de todo) y se mueve junto con el guardia.
    for (const [i, g] of this.state.guards.entries()) {
      // Escalonadas por guardia: si se amontonan (p. ej. todos en la bóveda), no se tapan entre sí.
      const label = this.add.text(0, -TILE * 0.5 - i * 13, "", { ...TEXT, fontSize: "11px", fontStyle: "bold", backgroundColor: "#141221" }).setOrigin(0.5, 1).setPadding(3, 1);
      const c = this.add.container(0, 0, [label]).setVisible(false);
      this.jevLabels.set(g.id, c);
      layers.jev.add(c);
    }

    // Iluminación 2D: una capa de oscuridad que las linternas borran (ver drawVision) y una viñeta.
    const size = { w: this.level.width * TILE, h: this.level.height * TILE };
    this.darkness = this.add.renderTexture(MAP.x, MAP.y, size.w, size.h).setOrigin(0);
    this.lightBrush = this.make.image({ key: "light", add: false });
    layers.light.add([this.darkness, this.add.image(MAP.x, MAP.y, "vignette").setOrigin(0).setDisplaySize(size.w, size.h)]);

    // Partículas: chispas doradas para la moneda, chispas de bronce para la cerradura de la bóveda.
    const sparks = (tint: number[], speed: number) =>
      this.add.particles(0, 0, "spark", { speed: { min: speed / 3, max: speed }, lifespan: 550, scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 }, tint, blendMode: "ADD", emitting: false });
    this.coinSparks = sparks([0xffd27a, 0xffb040], 140);
    this.vaultSparks = sparks([0xffe6a0, 0xb8913e, 0xffffff], 220);
    layers.effects.add([this.coinSparks, this.vaultSparks]);

    // El anillo del ladrón seleccionado late suave.
    for (const t of Object.values(this.state.thieves)) {
      this.tweens.add({ targets: this.sprites.get(t.id)!.getByName("ring"), alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    this.cameras.main.fadeIn(400, 0, 0, 0);

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onTile({ x: Math.floor((p.x - MAP.x) / TILE), y: Math.floor((p.y - MAP.y) / TILE) }));
    const keys = this.input.keyboard;
    keys?.on("keydown-ONE", () => this.select("zorro"));
    keys?.on("keydown-TWO", () => this.select("llave"));
    keys?.on("keydown-THREE", () => this.select("eco"));
    keys?.on("keydown-ESC", () => this.setMode("move"));
    keys?.on("keydown-ENTER", () => void this.endTurn());
    keys?.on("keydown-I", () => this.useSpy());
    keys?.on("keydown-R", () => void this.replayEnemyTurn());
    keys?.on("keydown-V", () => this.toggleViewer());

    this.scene.launch("ui");
    this.refresh();
  }

  /** Texturas generadas por código: luz (degradado radial), viñeta y chispa. Sin archivos de arte. */
  private makeTextures(): void {
    const canvas = (key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const tex = this.textures.createCanvas(key, w, h)!;
      paint(tex.getContext());
      tex.refresh();
    };
    canvas("light", 128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
    canvas("vignette", 400, 280, (ctx) => {
      const g = ctx.createRadialGradient(200, 140, 90, 200, 140, 250);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 400, 280);
    });
    canvas("spark", 8, 8, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(4, 4, 3, 0, Math.PI * 2);
      ctx.fill();
    });
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

  act(type: Exclude<ThiefAction["type"], "throw_coin">): void {
    if (this.busy) return;
    void this.apply(thiefAct(this.level, this.state, this.selected, { type }));
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
    this.setStatus(fallback ? "Decisión simulada…" : "Los guardias están pensando…");
    try {
      const r = await requestTurn("enemy-turn", this.state, fallback);
      this.lastMeta = r.meta;
      this.jev = { kind: "decision", turn: this.state.turn, response: r };
      this.cancelSpy();
      this.setStatus(r.meta.note ?? "");
      const result = resolveEnemyTurn(this.level, this.state, { guards: r.guards, raiseAlarm: r.raiseAlarm.raised });
      this.lastEnemyTurn = { before: this.state, events: result.events };
      await this.play(result.events);
      this.state = result.state;
      this.events.emit("game-events", result.events);
    } catch (e) {
      this.failed = e instanceof TurnFailed ? e : new TurnFailed(String(e), true);
      this.setStatus(`${this.failed.message}. ¿Reintentar o usar una decisión simulada?`);
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
    this.setStatus("Repetición del turno enemigo…");
    await this.play(this.lastEnemyTurn.events, this.lastEnemyTurn.before);
    this.busy = false;
    this.setStatus("");
    this.refresh();
  }

  // ---------------------------------------------------------------- infiltrada

  /** Activa la infiltrada (gasta un uso) y consulta ya; después se actualiza sola con cada cambio. */
  useSpy(): void {
    if (this.busy || !canUseSpy(this.state)) return;
    this.state = activateSpy(this.state).state;
    this.refresh();
    void this.querySpy();
  }

  /** Agrupa cambios seguidos en una sola consulta (debounce). */
  private scheduleSpy(): void {
    if (!this.state.spy.activeThisTurn) return;
    this.spyTimer?.remove();
    this.spyTimer = this.time.delayedCall(SPY_DEBOUNCE_MS, () => void this.querySpy());
    this.spyStatus = "loading"; // la espera del debounce también cuenta: hay una actualización en camino
    this.events.emit("changed");
  }

  private cancelSpy(): void {
    this.spyTimer?.remove();
    this.spySeq++; // una respuesta que llegue tarde se descarta
    this.spyStatus = "idle";
  }

  /**
   * Cada consulta es una llamada a Jev. Si el estado no cambió desde la última, no se pregunta de nuevo; y si
   * el turno termina sin cambios, el servidor responde el turno enemigo con esta misma respuesta (caché).
   */
  private async querySpy(): Promise<void> {
    const snapshot = JSON.stringify(this.state);
    if (snapshot === this.spyKey && this.jev?.kind === "spy") {
      this.spyStatus = "ok";
      this.events.emit("changed");
      return;
    }
    const seq = ++this.spySeq;
    this.spyStatus = "loading";
    this.events.emit("changed");
    try {
      const r = await requestTurn("spy", this.state);
      if (seq !== this.spySeq) return;
      this.spyKey = snapshot;
      this.jev = { kind: "spy", turn: this.state.turn, response: r };
      this.spyStatus = "ok";
    } catch (e) {
      if (seq !== this.spySeq) return;
      this.spyStatus = "error";
      this.spyError = e instanceof Error ? e.message : String(e);
    }
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
      el.textContent = "Todavía no hay ninguna llamada a Jev. (V cierra)";
      return;
    }
    const m = j.response.meta;
    const head = `${j.kind === "spy" ? "INFILTRADA" : "TURNO ENEMIGO"} · turno ${j.turn} · ${m.mode}${m.source === "respaldo" ? " (respaldo)" : ""}${m.cached ? " (caché)" : ""} · ${m.latencyMs} ms · modelo ${m.model ?? "—"}   (V cierra)`;
    const { state, questions, answers } = j.response.call;
    el.textContent = [head, "── estado que ve Jev ──", JSON.stringify(state, null, 2), "── preguntas ──", JSON.stringify(questions, null, 2), "── respuestas ──", JSON.stringify(answers, null, 2)].join("\n\n");
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
    this.scheduleSpy(); // con la infiltrada activa, cada cambio del jugador actualiza la predicción
  }

  private setStatus(text: string): void {
    this.status = text;
    this.events.emit("changed");
  }

  // ---------------------------------------------------------------- dibujo

  /** Redibuja todo a partir del estado y avisa a la interfaz. */
  private refresh(view: GameState = this.state): void {
    this.drawMap(view);
    this.drawVision(view);
    this.drawHints();
    this.syncSprites(view);
    this.updateViewer();
    this.events.emit("changed");
  }

  private drawMap(view: GameState): void {
    const g = this.mapGfx.clear();
    for (let y = 0; y < this.level.height; y++) {
      for (let x = 0; x < this.level.width; x++) {
        const t = tileAt(this.level, { x, y });
        const X = MAP.x + x * TILE;
        const Y = MAP.y + y * TILE;
        if (t === "wall") {
          g.fillStyle(COLOR.wall).fillRect(X, Y, TILE, TILE);
          if (tileAt(this.level, { x, y: y + 1 }) !== "wall") g.fillStyle(COLOR.wallEdge).fillRect(X, Y + TILE - 4, TILE, 4); // canto iluminado
          continue;
        }
        g.fillStyle(t === "exit" ? COLOR.exit : COLOR.floor).fillRect(X, Y, TILE, TILE);
        g.lineStyle(1, COLOR.grid).strokeRect(X, Y, TILE, TILE);
        if (t === "pedestal") {
          // Una vitrina: base oscura y el objeto expuesto.
          g.fillStyle(COLOR.pedestal).fillRect(X + 5, Y + 5, TILE - 10, TILE - 10);
          g.fillStyle(COLOR.vitrine).fillRect(X + 13, Y + 13, TILE - 26, TILE - 26);
        }
        if (t === "door") g.fillStyle(COLOR.door).fillRect(X + TILE / 2 - 3, Y + 4, 6, TILE - 8);
        if (t === "vault_door" && view.vault.open) g.lineStyle(2, COLOR.vault).strokeRect(X + 3, Y + 3, TILE - 6, TILE - 6);
      }
    }
  }

  /**
   * Conos y luz. La luz de cada linterna son exactamente las casillas que ve el guardia (visibleTiles), así lo
   * que se ve iluminado es lo que las reglas consideran visible. Los ladrones llevan un resplandor propio para
   * que el jugador siempre vea a su equipo.
   */
  private drawVision(view: GameState): void {
    const cones = this.coneGfx.clear().fillStyle(COLOR.cone, 0.07);
    const rt = this.darkness.clear().fill(0x04050a, DARKNESS);
    const light = (p: Vec, size: number, alpha: number) => {
      this.lightBrush.setDisplaySize(size, size).setAlpha(alpha);
      rt.erase(this.lightBrush, p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
    };
    for (const guard of view.guards) {
      light(guard.pos, TILE * 2.2, 0.6);
      for (const t of visibleTiles(this.level, view, guard)) {
        cones.fillRect(MAP.x + t.x * TILE, MAP.y + t.y * TILE, TILE, TILE);
        light(t, TILE * 2.4, 0.95 * (1 - Math.hypot(t.x - guard.pos.x, t.y - guard.pos.y) / (VISION_RANGE + 1.5)));
      }
    }
    for (const t of Object.values(view.thieves)) if (!t.caught) light(t.pos, TILE * 2.6, 0.7);
    light(this.level.exit, TILE * 2, 0.4);
    if (view.diamond) light(view.diamond, TILE * 1.6, 0.45); // el diamante brilla en la bóveda oscura
  }

  /** Casillas válidas para lo que el jugador está haciendo: azules para moverse, naranjas para la moneda. */
  private drawHints(): void {
    const g = this.hintGfx.clear();
    if (this.busy || this.state.outcome.status !== "playing") return;
    const tiles =
      this.mode === "move"
        ? [...reachable(this.level, this.state, this.selected).values()].map((path) => path.at(-1)!)
        : this.mode === "coin"
          ? coinTargets(this.level, this.state, this.selected)
          : [];
    g.fillStyle(this.mode === "coin" ? COLOR.coin : COLOR.reach, 0.28);
    for (const t of tiles) g.fillRect(MAP.x + t.x * TILE + 2, MAP.y + t.y * TILE + 2, TILE - 4, TILE - 4);
  }

  private syncSprites(view: GameState): void {
    this.vaultDoor.setVisible(!view.vault.open).setScale(1).setAlpha(1);
    const diamond = this.sprites.get("diamond")!;
    diamond.setVisible(view.diamond !== null);
    if (view.diamond) diamond.setPosition(px(view.diamond).x, px(view.diamond).y);
    for (const t of Object.values(view.thieves)) {
      const c = this.sprites.get(t.id)!.setPosition(px(t.pos).x, px(t.pos).y).setAlpha(t.caught ? 0.2 : 1);
      (c.getByName("ring") as Phaser.GameObjects.Arc).setVisible(t.id === this.selected && !t.caught);
      (c.getByName("loot") as Phaser.GameObjects.Text).setVisible(t.hasDiamond);
    }
    for (const g of view.guards) {
      const c = this.sprites.get(g.id)!.setPosition(px(g.pos).x, px(g.pos).y);
      (c.getByName("body") as Phaser.GameObjects.Container).setRotation(ROTATION[g.facing]);
      this.jevLabels.get(g.id)!.setPosition(px(g.pos).x, px(g.pos).y);
    }
  }

  /** Etiqueta sobre el guardia: la opción elegida y su probabilidad (naranja si era poco probable). */
  private setLabel(guard: GuardId, d: GuardDecision | null): void {
    const c = this.jevLabels.get(guard)!;
    c.setVisible(d !== null);
    if (!d) return;
    (c.list[0] as Phaser.GameObjects.Text).setText(`${OPTION_LABEL[d.option]} ${pct(d.probability)}`).setColor(probColor(d.probability));
    c.setScale(0.5);
    this.tweens.add({ targets: c, scale: 1, duration: 220, ease: "Back.easeOut" });
  }

  // ---------------------------------------------------------------- animación de eventos

  /**
   * Anima los eventos en orden sobre una copia del estado que se va actualizando. `from` es el estado del que
   * parten (el actual, o el de antes del turno enemigo para la repetición).
   */
  private async play(events: GameEvent[], from: GameState = this.state): Promise<void> {
    const view = clone(from);
    if (from !== this.state) {
      this.drawMap(view);
      this.drawVision(view);
      this.syncSprites(view);
      for (const g of view.guards) this.setLabel(g.id, null);
    }
    const guardPos = (id: string) => view.guards.find((g) => g.id === id)!.pos;
    for (const e of events) {
      switch (e.type) {
        case "thief_moved":
          for (const p of e.path) {
            view.thieves[e.thief].pos = p;
            await this.tweenTo([this.sprites.get(e.thief)!], p, 110);
            this.drawVision(view); // su resplandor lo acompaña
          }
          break;
        case "guard_moved": {
          const g = view.guards.find((x) => x.id === e.guard)!;
          const body = this.sprites.get(g.id)!.getByName("body") as Phaser.GameObjects.Container;
          g.facing = e.facing;
          this.tweens.add({ targets: body, rotation: nearestAngle(body.rotation, ROTATION[e.facing]), duration: 120 });
          for (const p of e.path) {
            g.pos = p;
            await this.tweenTo([this.sprites.get(g.id)!, this.jevLabels.get(g.id)!], p, 140);
            this.drawVision(view); // la linterna barre mientras camina
          }
          if (!e.path.length) await this.wait(150);
          this.drawVision(view);
          break;
        }
        case "thief_seen":
          await this.float(guardPos(e.guard), "!", "#ff5a5a", 22);
          break;
        case "alarm_raised":
          this.cameras.main.flash(250, 140, 20, 20);
          this.cameras.main.shake(200, 0.004);
          await this.wait(250);
          break;
        case "thief_caught": {
          view.thieves[e.thief].caught = true;
          const sprite = this.sprites.get(e.thief)!;
          this.tweens.add({ targets: sprite, scale: 0.6, alpha: 0.2, duration: 300, onComplete: () => sprite.setScale(1) });
          await this.float(view.thieves[e.thief].pos, "¡atrapado!", "#ff5a5a");
          this.drawVision(view);
          break;
        }
        case "noise_made":
          await this.throwCoin(view.thieves.eco.pos, e.at);
          this.coinSparks.explode(16, px(e.at).x, px(e.at).y);
          await this.ring(e.at);
          break;
        case "radio_sent":
          await this.float(this.level.zones[e.report.zone]!.center, e.report.kind === "movement" ? "radio: movimiento" : "radio: despejado", "#c9a3ff");
          break;
        case "deception_discovered":
          await this.float(guardPos(e.guard), "¡la radio mintió!", "#c9a3ff");
          break;
        case "vault_progress": {
          const door = px(this.level.vaultDoor);
          this.vaultSparks.explode(14, door.x, door.y + TILE / 2);
          this.cameras.main.shake(120, 0.003);
          await this.float(this.level.vaultDoor, `forzando ${e.progress}/2`, "#c8a24a");
          break;
        }
        case "vault_opened": {
          const door = px(this.level.vaultDoor);
          this.vaultSparks.explode(40, door.x, door.y);
          // La puerta se desliza hacia un costado antes de que el mapa la dibuje abierta.
          await new Promise<void>((resolve) => this.tweens.add({ targets: this.vaultDoor, scaleX: 0.1, x: door.x + TILE * 0.45, duration: 450, ease: "Cubic.easeIn", onComplete: () => resolve() }));
          this.vaultDoor.setPosition(door.x, door.y);
          view.vault.open = true;
          this.drawMap(view);
          this.drawVision(view);
          this.syncSprites(view);
          await this.float(this.level.vaultDoor, "¡abierta!", "#c8a24a");
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
          this.setLabel(e.decision.guard, e.decision);
          await this.wait(250);
          break;
        case "turn_ended":
        case "game_over":
          break;
      }
    }
  }

  private tweenTo(targets: Phaser.GameObjects.Container[], p: Vec, duration: number): Promise<void> {
    return new Promise((resolve) => this.tweens.add({ targets, ...px(p), duration, ease: "Sine.easeInOut", onComplete: () => resolve() }));
  }

  /** La moneda vuela en arco desde Eco hasta donde cae. */
  private throwCoin(from: Vec, to: Vec): Promise<void> {
    const a = px(from);
    const b = px(to);
    const coin = this.add.circle(a.x, a.y, 5, COLOR.coin);
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

  private float(at: Vec, text: string, color: string, size = 12): Promise<void> {
    const t = this.add.text(px(at).x, px(at).y - TILE * 0.95, text, { ...TEXT, fontSize: `${size}px`, color, fontStyle: "bold", backgroundColor: "#0d0e14" }).setOrigin(0.5, 1);
    this.effects.add(t);
    this.tweens.add({ targets: t, y: t.y - 18, alpha: 0, delay: 500, duration: 500, onComplete: () => t.destroy() });
    return this.wait(420);
  }

  private ring(at: Vec): Promise<void> {
    const c = this.add.circle(px(at).x, px(at).y, 6).setStrokeStyle(2, COLOR.coin);
    this.effects.add(c);
    return new Promise((resolve) =>
      this.tweens.add({ targets: c, radius: TILE * 2.5, alpha: 0, duration: 600, onComplete: () => (c.destroy(), resolve()) }),
    );
  }
}
