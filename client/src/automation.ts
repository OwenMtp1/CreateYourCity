// Accès aux scènes 3D pour l'automatisation (bande-annonce, tests visuels) : window.__cyc.
export function expose(name: 'globe' | 'city' | 'state' | 'setState', value: unknown) {
  const w = window as unknown as { __cyc?: Record<string, unknown> };
  (w.__cyc ??= {})[name] = value;
}

/** Mode capture (bande-annonce) : le tampon d'image est conservé pour être relu après le rendu. */
export function captureMode(): boolean {
  try { return localStorage.getItem('cyc.capture') === '1'; } catch { return false; }
}
