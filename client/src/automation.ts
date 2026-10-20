// Accès aux scènes 3D pour l'automatisation (bande-annonce, tests visuels) : window.__cyc.
// En production, seulement en mode capture (le serveur reste seul juge : rien n'est contournable).
export function expose(name: 'globe' | 'city' | 'state' | 'setState' | 'rules', value: unknown) {
  if (!import.meta.env.DEV && !captureMode()) return;
  const w = window as unknown as { __cyc?: Record<string, unknown> };
  (w.__cyc ??= {})[name] = value;
}

/** Mode capture (bande-annonce) : le tampon d'image est conservé pour être relu après le rendu. */
export function captureMode(): boolean {
  try { return localStorage.getItem('cyc.capture') === '1'; } catch { return false; }
}
