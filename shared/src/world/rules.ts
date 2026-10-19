// Règles et constantes du monde multijoueur (valeurs provisoires : docs/DECISIONS.md).
import { CITY_BY_ID } from '../world.ts';
import type { ProjectId } from '../sim/modifiers.ts';
import type { Treaty, TreatyType, UnitType, World, WorldEventKind, WorldMeta } from './types.ts';

export const UNITS: Record<UnitType, {
  label: string; cost: number; upkeepPerDay: number; attack: number; defense: number; speedKmh: number; siege: number;
}> = {
  infantry: { label: 'Infanterie', cost: 2_000, upkeepPerDay: 15, attack: 1, defense: 1.5, speedKmh: 20, siege: 1 },
  armor: { label: 'Blindés', cost: 9_000, upkeepPerDay: 70, attack: 4, defense: 2.5, speedKmh: 35, siege: 1 },
  artillery: { label: 'Artillerie', cost: 6_000, upkeepPerDay: 40, attack: 3, defense: 0.8, speedKmh: 15, siege: 3 },
};

export const MILITARY = {
  /** Part maximale de la population mobilisable dans les armées payées par une ville. */
  mobilizationShare: 0.05,
  supplyRangeKm: 600,
  maxMoveKm: 2_500,
  /** Attrition par jour hors ravitaillement / sans solde. */
  unsuppliedAttrition: 0.03,
  unpaidAttrition: 0.01,
  unsuppliedStrength: 0.6,
  unpaidStrength: 0.7,
  /** Bonus défensif en ville. */
  defenderBonus: 1.25,
  /** Pertes par jour = combatRate × force adverse / force propre. */
  combatRate: 0.5,
  /** Fortification : base + commissariats + casernes. */
  fortBase: 20,
  fortPerPolice: 20,
  fortPerBarracks: 80,
  /** Vitesse de siège : progression/jour = siegeRate × puissance de siège / fortification. */
  siegeRate: 0.5,
  siegeAttrition: 0.02,
  /** Une armée en dessous de cet effectif total est dissoute. */
  minArmySize: 0.5,
} as const;

export const EXPANSION = {
  maxDistanceKm: 500,
  baseCost: 150_000,
  costPerKm: 400,
  maxCitiesPerPlayer: 12,
} as const;

export const MARKET = {
  initialPrice: 14,
  floor: 8,
  ceiling: 30,
  /** Ajustement relatif maximal du prix par tick. */
  adjustPerTick: 0.002,
  spread: 0.1,
  historyEveryTicks: 24,
  historyLength: 60,
} as const;

export const NATION = {
  maxTaxRate: 0.1,
  projectCost: { highway: 1_500_000, power_grid: 1_000_000, university: 800_000, national_defense: 1_200_000 } as Record<ProjectId, number>,
} as const;

export const TREATY_LABEL: Record<TreatyType, string> = {
  alliance: 'Alliance',
  non_aggression: 'Pacte de non-agression',
  defense: 'Accord de défense',
  trade: 'Accord commercial',
  intel: "Partage d'informations",
  peace: 'Traité de paix',
  city_transfer: 'Cession de ville',
};

/** Préavis de résiliation d'un pacte de non-agression (ticks). */
export const NON_AGGRESSION_NOTICE_TICKS = 144;

export function marketPrices(price: number) {
  return {
    buy: Math.min(MARKET.ceiling, price * (1 + MARKET.spread)),
    sell: Math.max(MARKET.floor * (1 - MARKET.spread), price * (1 - MARKET.spread)),
  };
}

export function distanceKm(cityA: string, cityB: string): number {
  const a = CITY_BY_ID.get(cityA);
  const b = CITY_BY_ID.get(cityB);
  if (!a || !b) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Position (lat, lon) d'une armée, interpolée le long du grand cercle si elle se déplace. */
export function armyPosition(cityId: string, movement: { toCityId: string; progressKm: number; totalKm: number } | null): [number, number] {
  const a = CITY_BY_ID.get(cityId)!;
  if (!movement || movement.totalKm <= 0) return [a.lat, a.lon];
  const b = CITY_BY_ID.get(movement.toCityId)!;
  const f = Math.min(1, movement.progressKm / movement.totalKm);
  const rad = Math.PI / 180;
  const toVec = (lat: number, lon: number) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
  const va = toVec(a.lat, a.lon);
  const vb = toVec(b.lat, b.lon);
  const dot = Math.max(-1, Math.min(1, va[0]! * vb[0]! + va[1]! * vb[1]! + va[2]! * vb[2]!));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [a.lat, a.lon];
  const s1 = Math.sin((1 - f) * omega) / Math.sin(omega);
  const s2 = Math.sin(f * omega) / Math.sin(omega);
  const v = [0, 1, 2].map((i) => s1 * va[i]! + s2 * vb[i]!);
  return [Math.asin(v[2]!) / rad, Math.atan2(v[1]!, v[0]!) / rad];
}

export function distanceLatLonKm(p: [number, number], cityId: string): number {
  const c = CITY_BY_ID.get(cityId);
  if (!c) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (c.lat - p[0]) * rad;
  const dLon = (c.lon - p[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * rad) * Math.cos(c.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// --- Relations -------------------------------------------------------------------------------

const pair = (t: { a: string; b: string }, x: string, y: string) => (t.a === x && t.b === y) || (t.a === y && t.b === x);

export function atWar(meta: WorldMeta, x: string, y: string): boolean {
  return x !== y && meta.wars.some((w) => pair(w, x, y));
}

export function activeTreaty(meta: WorldMeta, x: string, y: string, types: TreatyType[]): Treaty | undefined {
  return meta.treaties.find((t) => t.status === 'active' && types.includes(t.type) && pair(t, x, y));
}

/** Alliés militaires : mêmes joueurs, alliance ou accord de défense actifs. */
export function allied(meta: WorldMeta, x: string, y: string): boolean {
  return x === y || !!activeTreaty(meta, x, y, ['alliance', 'defense']);
}

/** Le détail économique et militaire d'un joueur est visible par lui-même et ses partenaires. */
export function detailVisible(meta: WorldMeta, viewer: string, owner: string): boolean {
  return viewer === owner || !!activeTreaty(meta, viewer, owner, ['alliance', 'intel']);
}

export function citiesOf(world: World, playerId: string): string[] {
  return [...world.cities.values()].filter((c) => c.ownerId === playerId).map((c) => c.cityId).sort();
}

/** Électeurs d'un pays : joueurs possédant au moins une ville dans ce pays. */
export function eligibleVoters(world: World, countryId: string): string[] {
  const set = new Set<string>();
  for (const c of world.cities.values()) if (c.countryId === countryId) set.add(c.ownerId);
  return [...set].sort();
}

export function playerName(meta: WorldMeta, id: string): string {
  return meta.players[id]?.name ?? 'Joueur inconnu';
}

export function cityName(cityId: string): string {
  return CITY_BY_ID.get(cityId)?.name ?? cityId;
}

export function nextId(meta: WorldMeta): number {
  return meta.nextId++;
}

export function pushEvent(world: World, kind: WorldEventKind, text: string, players: string[] = [], isPrivate = false) {
  const meta = world.meta;
  meta.events.push({ id: nextId(meta), tick: world.tick, kind, text, players, ...(isPrivate ? { private: true } : {}) });
  if (meta.events.length > 200) meta.events.splice(0, meta.events.length - 200);
}
