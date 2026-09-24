// RNG con semilla y sorteo de opciones. Las reglas no usan azar: el único azar del juego es el sorteo de
// las decisiones de Jev, y usa semilla + turno + guardia. Misma partida y mismas probabilidades = mismo sorteo.

/** mulberry32: rápido, suficiente para un juego, reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un RNG propio para cada (partida, turno, sal): el orden en que se sortea no cambia los resultados. */
export function rngFor(seed: number, turn: number, salt: string): () => number {
  let h = 2166136261; // FNV-1a sobre la sal
  for (const ch of `${turn}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return mulberry32(seed ^ h);
}

/** Sortea una clave según su probabilidad: un 30 % sale 3 de cada 10 veces. */
export function sample<K extends string>(probabilities: Readonly<Partial<Record<K, number>>>, rng: () => number): K {
  const entries = Object.entries(probabilities) as [K, number][];
  const total = entries.reduce((sum, [, p]) => sum + p, 0);
  let r = rng() * total;
  for (const [k, p] of entries) {
    r -= p;
    if (r < 0) return k;
  }
  return entries[entries.length - 1]![0]; // redondeo: la última
}
