// Répartition des actifs entre les sites d'emploi. Par défaut, les actifs remplissent les postes vacants
// proportionnellement aux vacances. Un déplacement manuel fixe un effectif sur un site ; le reste reste automatique.

export interface StaffingSite { id: number; jobs: number }

export interface SiteStaffing {
  /** Actifs qui travaillent sur chaque site. */
  employed: Map<number, number>;
  /** Part des postes pourvus (0..1) de chaque site. */
  staffing: Map<number, number>;
}

export function assignWorkers(sites: StaffingSite[], workforce: number, assignments: Record<number, number> | undefined): SiteStaffing {
  // Effectifs fixés à la main, bornés par les postes du site.
  const pinned = new Map<number, number>();
  for (const s of sites) {
    const p = Math.min(assignments?.[s.id] ?? 0, s.jobs);
    if (p > 0) pinned.set(s.id, p);
  }
  let pinnedTotal = [...pinned.values()].reduce((a, b) => a + b, 0);
  if (pinnedTotal > workforce && pinnedTotal > 0) {
    const k = workforce / pinnedTotal;
    for (const [id, p] of pinned) pinned.set(id, p * k);
    pinnedTotal = workforce;
  }
  // Les actifs restants remplissent les postes vacants, au prorata des vacances.
  const free = Math.max(0, workforce - pinnedTotal);
  const vacancies = sites.map((s) => ({ id: s.id, jobs: s.jobs, v: Math.max(0, s.jobs - (pinned.get(s.id) ?? 0)) }));
  const totalVacancies = vacancies.reduce((a, s) => a + s.v, 0);
  const fill = Math.min(free, totalVacancies);
  const employed = new Map<number, number>();
  const staffing = new Map<number, number>();
  for (const s of vacancies) {
    const e = (pinned.get(s.id) ?? 0) + (totalVacancies > 0 ? (fill * s.v) / totalVacancies : 0);
    employed.set(s.id, e);
    staffing.set(s.id, s.jobs > 0 ? e / s.jobs : 0);
  }
  return { employed, staffing };
}
