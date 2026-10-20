// Paliers d'une ville (population, trésorerie, réussites) : règles fixes vérifiées à chaque tick.
// Un palier n'est attribué qu'une fois ; le client en fait une notification.
import type { CityState } from '../types.ts';

export type MilestoneKind = 'population' | 'treasury' | 'achievement';

export interface MilestoneDef {
  id: string;
  kind: MilestoneKind;
  icon: string;
  title: string;
  detail: string;
  reached: (city: CityState) => boolean;
}

const POPULATION_STEPS: [number, string][] = [
  [100, 'Hameau'], [500, 'Village'], [1_000, 'Bourg'], [2_500, 'Petite ville'], [5_000, 'Ville'],
  [10_000, 'Ville moyenne'], [25_000, 'Grande ville'], [50_000, 'Cité régionale'], [100_000, 'Métropole'],
  [250_000, 'Grande métropole'], [500_000, 'Capitale économique'], [1_000_000, 'Mégapole'],
];
const TREASURY_STEPS = [1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];
const fmt = (v: number) => v.toLocaleString('fr-FR');

export const MILESTONES: MilestoneDef[] = [
  ...POPULATION_STEPS.map(([n, name]): MilestoneDef => ({
    id: `pop-${n}`, kind: 'population', icon: '👥', title: `${name} : ${fmt(n)} habitants`,
    detail: `Votre ville a dépassé ${fmt(n)} habitants.`, reached: (c) => c.population >= n,
  })),
  ...TREASURY_STEPS.map((n): MilestoneDef => ({
    id: `treasury-${n}`, kind: 'treasury', icon: '💰', title: `Trésor de ${fmt(n / 1_000_000)} M cr`,
    detail: `La trésorerie municipale dépasse ${fmt(n)} cr.`, reached: (c) => c.treasury >= n,
  })),
  {
    id: 'full-employment', kind: 'achievement', icon: '💼', title: 'Plein emploi',
    detail: "Moins de 3 % de chômage avec plus de 1 000 habitants.",
    reached: (c) => c.population >= 1_000 && (c.stats?.unemploymentRate ?? 1) < 0.03,
  },
  {
    id: 'attractive', kind: 'achievement', icon: '⭐', title: 'Ville attractive',
    detail: 'Attractivité de 80 % ou plus avec plus de 500 habitants.',
    reached: (c) => c.population >= 500 && (c.stats?.attractiveness ?? 0) >= 0.8,
  },
  {
    id: 'transit-city', kind: 'achievement', icon: '🚇', title: 'Ville des transports en commun',
    detail: "30 % des déplacements en transports en commun avec plus de 2 000 habitants.",
    reached: (c) => c.population >= 2_000 && (c.stats?.transit.share ?? 0) >= 0.3,
  },
  {
    id: 'parking-ok', kind: 'achievement', icon: '🅿️', title: 'Stationnement maîtrisé',
    detail: 'Toute la demande de stationnement est satisfaite avec plus de 2 000 habitants.',
    reached: (c) => c.population >= 2_000 && (c.stats?.parking?.coverage ?? 0) >= 0.999,
  },
  {
    id: 'debt-free', kind: 'achievement', icon: '🏦', title: 'Sans dette',
    detail: 'Dette remboursée avec plus de 5 000 habitants.',
    reached: (c) => c.population >= 5_000 && c.debt <= 0,
  },
];

export const MILESTONE_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

/** Ajoute les paliers nouvellement atteints ; renvoie leurs identifiants. */
export function checkMilestones(city: CityState): string[] {
  const done = new Set((city.milestones ?? []).map((m) => m.id));
  const fresh: string[] = [];
  for (const m of MILESTONES) {
    if (done.has(m.id) || !m.reached(city)) continue;
    (city.milestones ??= []).push({ id: m.id, tick: city.tick });
    fresh.push(m.id);
  }
  return fresh;
}
