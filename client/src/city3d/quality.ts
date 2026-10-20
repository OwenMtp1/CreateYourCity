// Qualité graphique choisie par le joueur (préférence locale du navigateur).
// Sans préférence enregistrée, les téléphones démarrent en mode économique (batterie, chauffe).
import { isMobile } from '../ui/mobile.ts';

export type Quality = 'high' | 'low';
const KEY = 'cyc.quality';

export function getQuality(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'low' || saved === 'high') return saved;
  } catch { /* stockage indisponible */ }
  return isMobile() ? 'low' : 'high';
}

export function setQuality(q: Quality) {
  try { localStorage.setItem(KEY, q); } catch { /* préférence non mémorisée */ }
}
