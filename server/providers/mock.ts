// Proveedor mock: una heurística local con la forma exacta de una respuesta de Jev.
// No lee el estado en inglés ni la doctrina: los tres comandantes juegan igual. Es la línea base
// "solo código"; la diferencia que se vea con Jev real es mérito de Jev.
import type { ChoiceResponse, NoulResponse } from "@typesafe-ai/sdk";
import type { GuardOption, OptionFacts, TurnAnalysis } from "../../src/shared/types";
import type { DecisionProvider, TurnAnswers } from "./types";

/** Preferencia de cada opción (más alto = más probable). */
function preference(option: GuardOption, f: OptionFacts, analysis: TurnAnalysis): number {
  switch (option) {
    case "chase":
      return 3 - f.distance / 10;
    case "investigate_noise":
      return 2 - f.distance / 8;
    case "respond_radio":
      return { high: 1.6, shaken: 0.6, lying: -1 }[analysis.radioTrust] - f.distance / 15;
    case "guard_vault":
      return analysis.vaultOpen ? 3.5 : 0.2 - f.distance / 20;
    case "patrol":
      return 1;
    case "hold":
      return 0;
  }
}

/** ponytail: 1 - entropía normalizada. TypeSafe no publica su fórmula de confianza; esto solo la imita. */
function confidence(probs: number[]): number {
  if (probs.length < 2) return 1;
  const h = -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0);
  return 1 - h / Math.log(probs.length);
}

export const mockProvider: DecisionProvider = {
  mode: "mock",
  async decide({ analysis }) {
    const answers: Record<string, ChoiceResponse | NoulResponse> = {};
    for (const g of analysis.guards) {
      const offered = Object.keys(g.options) as GuardOption[];
      const scores = offered.map((o) => preference(o, g.options[o]!, analysis));
      const exp = scores.map((x) => Math.exp(x - Math.max(...scores)));
      const total = exp.reduce((a, b) => a + b, 0);
      const probs = exp.map((e) => Math.round((e / total) * 100) / 100);
      answers[`${g.guard}_plan`] = {
        type: "choice",
        choice: offered[probs.indexOf(Math.max(...probs))]!,
        probabilities: Object.fromEntries(offered.map((o, i) => [o, probs[i]!])),
        confidence: confidence(probs),
      };
    }
    const someoneSawAThief = analysis.guards.some((g) => g.options.chase);
    answers.raise_alarm = { type: "noul", noul: someoneSawAThief ? 0.6 : 0.03 };
    return { answers: answers as TurnAnswers, model: null, inputTokens: 0 };
  },
};
