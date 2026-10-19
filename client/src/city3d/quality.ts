// Qualité graphique choisie par le joueur (préférence locale du navigateur).
export type Quality = 'high' | 'low';
const KEY = 'cyc.quality';

export function getQuality(): Quality {
  try {
    return localStorage.getItem(KEY) === 'low' ? 'low' : 'high';
  } catch {
    return 'high';
  }
}

export function setQuality(q: Quality) {
  try { localStorage.setItem(KEY, q); } catch { /* préférence non mémorisée */ }
}
