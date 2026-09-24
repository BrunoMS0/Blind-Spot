// Los comandantes se diferencian SOLO por este texto. Todo lo demás es idéntico.
// En inglés, como todo lo que lee Jev. Cambiar una doctrina = medirla con scripts/bench.ts (fase 2).
import type { CommanderId } from "../src/shared/types";

export const DOCTRINES: Record<CommanderId, string> = {
  cauteloso:
    "Cautious commander. The vault is the priority: keep it protected and never leave it exposed. Treat noises and radio reports as likely distractions. Leave the patrol only for an intruder that a guard has actually seen.",
  impulsivo:
    "Impulsive commander. React to everything right away: every noise, every radio report and every sighting deserves a guard running to it now. Patrolling or standing still while something is happening is a failure.",
  rencoroso:
    'Vengeful commander. Trusts the radio only while `shared.radio_trust` is "high". Once the radio has lied even once, every radio report is a trap: never respond to it. Instead hunt aggressively: chase sightings, investigate noises and raise the alarm as soon as an intruder has been seen.',
};
