// Única fuente de verdad para el nombre del juego y las constantes de reglas.
// El mapa, las zonas y las rutas de los guardias NO están aquí: son datos del nivel (LevelData).
export const GAME_NAME = "El golpe";

export const SERVER_PORT = 8787;

export const THIEF_IDS = ["zorro", "llave", "eco"] as const;

export const THIEVES = {
  zorro: { name: "Zorro", move: 5, ability: null },
  llave: { name: "Llave", move: 4, ability: "force_vault" },
  eco: { name: "Eco", move: 4, ability: "throw_coin" },
} as const;

export const GUARD_MOVE = 3;
export const GUARD_CHASE_MOVE = 4;
/** Cono de visión: alcance en casillas y apertura total. Muros y pedestales lo bloquean. */
export const VISION_RANGE = 4;
export const VISION_ANGLE_DEG = 90;
/** Un guardia oye un ruido si está a esta distancia o menos, medida en casillas de camino. */
export const HEARING_RANGE = 8;
export const COIN_RANGE = 5;
export const VAULT_FORCE_ACTIONS = 2;

export const ALARM_TO_LOSE = 3;
/** raise_alarm sube la alarma como mucho hasta aquí: solo ser visto hace perder. */
export const RAISE_ALARM_CAP = ALARM_TO_LOSE - 1;

export const RADIO_USES = 3;
export const SPY_USES = 2;

/** Todo lo que un guardia puede elegir. Cada turno solo se le ofrecen las que aplican. */
export const GUARD_OPTIONS = ["patrol", "investigate_noise", "respond_radio", "chase", "guard_vault", "hold"] as const;

/** Los comandantes solo difieren en el texto de su doctrina (server/doctrines.ts, fase 2). */
export const COMMANDERS = ["cauteloso", "impulsivo", "rencoroso"] as const;
