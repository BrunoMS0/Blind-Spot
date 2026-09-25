// Textos en español que comparten las dos escenas.
import type { CommanderId, GuardOption, LossReason, RadioTrust } from "../shared/types";

/** Para el selector. La doctrina real (en inglés, la que lee Jev) vive solo en server/doctrines.ts. */
export const COMMANDER_INFO: Record<CommanderId, { name: string; blurb: string }> = {
  cauteloso: { name: "Cauteloso", blurb: "Protege la bóveda. Casi no se deja distraer por ruidos ni por la radio." },
  impulsivo: { name: "Impulsivo", blurb: "Acude a cualquier ruido o reporte. Fácil de distraer, rápido para reaccionar." },
  rencoroso: { name: "Rencoroso", blurb: "Le cree a la radio hasta que lo engaña una vez. Después, caza sin descanso." },
};

export const OPTION_LABEL: Record<GuardOption, string> = {
  patrol: "patrullar",
  investigate_noise: "investigar ruido",
  respond_radio: "acudir a la radio",
  chase: "perseguir",
  guard_vault: "cuidar la bóveda",
  hold: "quedarse y mirar",
};

export const LOSS: Record<LossReason, string> = {
  alarm: "la alarma llegó a 3",
  diamond_carrier_caught: "atraparon a quien llevaba el diamante",
  team_caught: "atraparon a todo el equipo",
};

export const TRUST: Record<RadioTrust, { text: string; color: string }> = {
  high: { text: "alta", color: "#7fd48a" },
  shaken: { text: "dudosa tras un engaño", color: "#e8d27a" },
  lying: { text: "creen que la radio miente", color: "#ff8080" },
};

/** Color de una probabilidad. Naranja = el sorteo eligió algo poco probable (una sorpresa). */
export const probColor = (p: number): string => (p >= 0.5 ? "#c9a3ff" : p >= 0.2 ? "#b8b2d8" : "#ffb070");

export const pct = (p: number): string => `${Math.round(p * 100)} %`;
