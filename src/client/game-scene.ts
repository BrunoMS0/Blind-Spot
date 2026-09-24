import Phaser from "phaser";
import { THIEVES } from "../shared/config";
import { resolveEnemyTurn } from "../shared/enemy-turn";
import { key, LEVELS, same, tileAt, zoneAt, type Level } from "../shared/level";
import { coinTargets, moveThief, reachable, sendRadio, thiefAct } from "../shared/player-turn";
import { activeThieves, clone, newGame, type Result } from "../shared/rules";
import type { CommanderId, Facing, GameEvent, GameState, ThiefAction, ThiefId, Vec } from "../shared/types";
import { visibleTiles } from "../shared/vision";
import { requestEnemyTurn } from "./api";

// Phaser solo dibuja, anima y lee input. Toda regla sale de src/shared: esta escena aplica una acción,
// anima los eventos que devuelve y se queda con el estado nuevo.
export const TILE = 40;
export const MAP = { x: 16, y: 56 };
export const TEXT = { fontFamily: "monospace", fontSize: "12px", color: "#aab0c0" };

export type Mode = "move" | "coin" | "radio_movement" | "radio_all_clear";

const COLOR = {
  floor: 0x161922,
  grid: 0x232735,
  wall: 0x3a3f52,
  door: 0x7a5a3a,
  pedestal: 0x5a5f73,
  vault: 0xc8a24a,
  exit: 0x2f6b3a,
  cone: 0xe8d27a,
  reach: 0x5b8cff,
  coin: 0xff9f6b,
  guard: 0xe8d27a,
  thief: { zorro: 0xff8a50, llave: 0x7fb8ff, eco: 0x9be38a } satisfies Record<ThiefId, number>,
};
const ROTATION: Record<Facing, number> = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };
const px = (p: Vec) => ({ x: MAP.x + p.x * TILE + TILE / 2, y: MAP.y + p.y * TILE + TILE / 2 });

export class GameScene extends Phaser.Scene {
  readonly level: Level = LEVELS.museo!;
  state!: GameState;
  selected: ThiefId = "zorro";
  mode: Mode = "move";
  busy = false;
  status = "";

  private mapGfx!: Phaser.GameObjects.Graphics;
  private hintGfx!: Phaser.GameObjects.Graphics;
  private coneGfx!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Layer;
  private sprites = new Map<string, Phaser.GameObjects.Container>();

  constructor() {
    super("game");
  }

  init(data: { commander: CommanderId; seed: number }): void {
    this.state = newGame(this.level, data.commander, data.seed);
  }

  create(): void {
    // Capas de abajo hacia arriba (ARCHITECTURE.md, "Eventos → capas"). La de info de Jev llega en la fase 3.
    const layers = { map: this.add.layer(), cones: this.add.layer(), entities: this.add.layer(), effects: this.add.layer() };
    this.effects = layers.effects;
    this.mapGfx = this.add.graphics();
    this.hintGfx = this.add.graphics();
    layers.map.add([this.mapGfx, this.hintGfx]);
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

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onTile({ x: Math.floor((p.x - MAP.x) / TILE), y: Math.floor((p.y - MAP.y) / TILE) }));
    const keys = this.input.keyboard;
    keys?.on("keydown-ONE", () => this.select("zorro"));
    keys?.on("keydown-TWO", () => this.select("llave"));
    keys?.on("keydown-THREE", () => this.select("eco"));
    keys?.on("keydown-ESC", () => this.setMode("move"));
    keys?.on("keydown-ENTER", () => void this.endTurn());

    this.scene.launch("ui");
    this.refresh();
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

  async endTurn(): Promise<void> {
    if (this.busy || this.state.outcome.status !== "playing") return;
    this.busy = true;
    this.mode = "move";
    this.setStatus("Los guardias están pensando…");
    try {
      const r = await requestEnemyTurn(this.state);
      this.setStatus("");
      const result = resolveEnemyTurn(this.level, this.state, { guards: r.guards, raiseAlarm: r.raiseAlarm.raised });
      await this.play(result.events);
      this.state = result.state;
      this.events.emit("game-events", result.events);
    } catch (e) {
      this.setStatus(`No se pudo obtener el turno enemigo (${e instanceof Error ? e.message : String(e)}). Vuelve a intentarlo.`);
    }
    if (this.state.thieves[this.selected].caught) this.selected = activeThieves(this.state)[0]?.id ?? this.selected;
    this.busy = false;
    this.refresh();
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
  }

  private setStatus(text: string): void {
    this.status = text;
    this.events.emit("changed");
  }

  // ---------------------------------------------------------------- dibujo

  /** Redibuja todo a partir del estado y avisa a la interfaz. */
  private refresh(view: GameState = this.state): void {
    this.drawMap(view);
    this.drawCones(view);
    this.drawHints();
    this.syncSprites(view);
    this.events.emit("changed");
  }

  private drawMap(view: GameState): void {
    const g = this.mapGfx.clear();
    for (let y = 0; y < this.level.height; y++) {
      for (let x = 0; x < this.level.width; x++) {
        const t = tileAt(this.level, { x, y });
        const X = MAP.x + x * TILE;
        const Y = MAP.y + y * TILE;
        g.fillStyle(t === "wall" ? COLOR.wall : t === "exit" ? COLOR.exit : COLOR.floor).fillRect(X, Y, TILE, TILE);
        if (t !== "wall") g.lineStyle(1, COLOR.grid).strokeRect(X, Y, TILE, TILE);
        if (t === "pedestal") g.fillStyle(COLOR.pedestal).fillRect(X + 6, Y + 6, TILE - 12, TILE - 12);
        if (t === "door") g.fillStyle(COLOR.door).fillRect(X + TILE / 2 - 3, Y + 4, 6, TILE - 8);
        if (t === "vault_door") {
          if (view.vault.open) g.lineStyle(2, COLOR.vault).strokeRect(X + 3, Y + 3, TILE - 6, TILE - 6);
          else g.fillStyle(COLOR.vault).fillRect(X + 2, Y + 2, TILE - 4, TILE - 4);
        }
      }
    }
  }

  private drawCones(view: GameState): void {
    const g = this.coneGfx.clear().fillStyle(COLOR.cone, 0.16);
    for (const guard of view.guards) for (const t of visibleTiles(this.level, view, guard)) g.fillRect(MAP.x + t.x * TILE, MAP.y + t.y * TILE, TILE, TILE);
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
    }
  }

  // ---------------------------------------------------------------- animación de eventos

  /** Anima los eventos en orden sobre una copia del estado que se va actualizando. */
  private async play(events: GameEvent[]): Promise<void> {
    const view = clone(this.state);
    const guardPos = (id: string) => view.guards.find((g) => g.id === id)!.pos;
    for (const e of events) {
      switch (e.type) {
        case "thief_moved":
          for (const p of e.path) {
            view.thieves[e.thief].pos = p;
            await this.tweenTo(this.sprites.get(e.thief)!, p, 110);
          }
          break;
        case "guard_moved": {
          const g = view.guards.find((x) => x.id === e.guard)!;
          g.facing = e.facing;
          (this.sprites.get(g.id)!.getByName("body") as Phaser.GameObjects.Container).setRotation(ROTATION[e.facing]);
          for (const p of e.path) {
            g.pos = p;
            await this.tweenTo(this.sprites.get(g.id)!, p, 140);
          }
          if (!e.path.length) await this.wait(150);
          this.drawCones(view);
          break;
        }
        case "thief_seen":
          await this.float(guardPos(e.guard), "!", "#ff5a5a", 22);
          break;
        case "alarm_raised":
          this.cameras.main.flash(250, 140, 20, 20);
          await this.wait(250);
          break;
        case "thief_caught":
          view.thieves[e.thief].caught = true;
          this.syncSprites(view);
          await this.float(view.thieves[e.thief].pos, "¡atrapado!", "#ff5a5a");
          break;
        case "noise_made":
          await this.ring(e.at);
          break;
        case "radio_sent":
          await this.float(this.level.zones[e.report.zone]!.center, e.report.kind === "movement" ? "radio: movimiento" : "radio: despejado", "#c9a3ff");
          break;
        case "deception_discovered":
          await this.float(guardPos(e.guard), "¡la radio mintió!", "#c9a3ff");
          break;
        case "vault_progress":
          await this.float(this.level.vaultDoor, `forzando ${e.progress}/2`, "#c8a24a");
          break;
        case "vault_opened":
          view.vault.open = true;
          this.drawMap(view);
          this.drawCones(view);
          await this.float(this.level.vaultDoor, "¡abierta!", "#c8a24a");
          break;
        case "diamond_taken":
          view.diamond = null;
          view.thieves[e.thief].hasDiamond = true;
          this.syncSprites(view);
          break;
        case "guard_decided":
        case "turn_ended":
        case "game_over":
          break;
      }
    }
  }

  private tweenTo(target: Phaser.GameObjects.Container, p: Vec, duration: number): Promise<void> {
    return new Promise((resolve) => this.tweens.add({ targets: target, ...px(p), duration, onComplete: () => resolve() }));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private float(at: Vec, text: string, color: string, size = 12): Promise<void> {
    const t = this.add.text(px(at).x, px(at).y - TILE * 0.5, text, { ...TEXT, fontSize: `${size}px`, color, fontStyle: "bold", backgroundColor: "#0d0e14" }).setOrigin(0.5, 1);
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
