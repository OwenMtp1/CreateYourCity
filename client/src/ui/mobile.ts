// Détection du mode mobile : petit écran ou écran tactile de taille tablette.
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 760px), (pointer: coarse) and (max-width: 1100px)';

function media(): MediaQueryList | null {
  try { return window.matchMedia(QUERY); } catch { return null; }
}

export function isMobile(): boolean {
  return media()?.matches ?? false;
}

/** Vrai sur téléphone (et tablette tactile) ; suit la rotation de l'écran. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = media();
      m?.addEventListener('change', cb);
      return () => m?.removeEventListener('change', cb);
    },
    isMobile,
  );
}

/** Montants courts pour la barre d'état mobile : 1,9 M, 23,4 k. */
export function fmtShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e4) return `${sign}${(a / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`;
  return `${sign}${Math.round(a).toLocaleString('fr-FR')}`;
}
