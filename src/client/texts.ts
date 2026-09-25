// Textos en español que comparten las dos escenas.
import type { Ability, AbilityBlock } from "../shared/player-turn";
import type { CommanderId, GuardOption, LossReason, RadioTrust } from "../shared/types";

/** Para el selector. La doctrina real (en inglés, la que lee Jev) vive solo en server/doctrines.ts. */
export const COMMANDER_INFO: Record<CommanderId, { name: string; blurb: string }> = {
  cauteloso: { name: "Cauteloso", blurb: "Protege la bóveda. Casi no se deja distraer por ruidos ni por la radio." },
  impulsivo: { name: "Impulsivo", blurb: "Acude a cualquier ruido o reporte. Fácil de distraer, rápido para reaccionar." },
  rencoroso: { name: "Rencoroso", blurb: "Le cree a la radio hasta que lo engaña una vez. Después, caza sin descanso." },
};

export const OPTION_LABEL: Record<GuardOption, string> = {
  patrol: "Seguir patrulla",
  investigate_noise: "Investigar ruido",
  respond_radio: "Atender la radio",
  check_blackout: "Revisar el apagón",
  chase: "Perseguir al intruso",
  guard_vault: "Vigilar la bóveda",
  hold: "Quedarse y mirar",
};

/** La habilidad de cada ladrón: nombre para su botón y su tarjeta, y para qué sirve (una línea). */
export const ABILITY: Record<Ability, { name: string; what: string }> = {
  blackout: { name: "Apagón", what: "Deja una sala a oscuras: ahí ven a 2 casillas." },
  force_vault: { name: "Forzar bóveda", what: "Frente a la puerta, 2 acciones abren la bóveda." },
  throw_coin: { name: "Lanzar moneda", what: "Hace ruido a 5 casillas o menos para distraer." },
};

/** Por qué no se puede usar la habilidad ahora (ver abilityState en player-turn.ts). */
export const ABILITY_BLOCK: Record<AbilityBlock, string> = {
  not_playing: "",
  caught: "Está atrapado.",
  acted: "Ya actuó este turno.",
  no_uses: "Ya no le quedan apagones.",
  already_dark: "Ya hay un apagón en curso.",
  far_from_vault: "Acércate a la puerta de la bóveda.",
  vault_open: "La bóveda ya está abierta.",
  no_targets: "No hay dónde lanzar la moneda.",
};

export const LOSS: Record<LossReason, string> = {
  alarm: "la alarma llegó a 3",
  diamond_carrier_caught: "atraparon a quien llevaba el diamante",
  team_caught: "atraparon a todo el equipo",
};

export const TRUST: Record<RadioTrust, { text: string; color: string }> = {
  high: { text: "Seguridad le cree a la radio.", color: "#86d38a" },
  shaken: { text: "Seguridad empieza a desconfiar de la radio.", color: "#e3b34a" },
  lying: { text: "Seguridad cree que la radio miente.", color: "#ff7a6e" },
};

export const pct = (p: number): string => `${Math.round(p * 100)} %`;
