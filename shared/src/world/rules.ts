// Règles et constantes du monde multijoueur (valeurs provisoires : docs/DECISIONS.md).
import { CITY_BY_ID } from '../world.ts';
import type { LawId, ProjectId } from '../sim/modifiers.ts';
import type { NationState, Treaty, TreatyType, UnitType, World, WorldEventKind, WorldMeta } from './types.ts';

export const UNITS: Record<UnitType, {
  label: string; cost: number; upkeepPerDay: number; attack: number; defense: number; speedKmh: number; siege: number;
}> = {
  infantry: { label: 'Infanterie', cost: 2_000, upkeepPerDay: 15, attack: 1, defense: 1.5, speedKmh: 20, siege: 1 },
  armor: { label: 'Blindés', cost: 9_000, upkeepPerDay: 70, attack: 4, defense: 2.5, speedKmh: 35, siege: 1 },
  artillery: { label: 'Artillerie', cost: 6_000, upkeepPerDay: 40, attack: 3, defense: 0.8, speedKmh: 15, siege: 3 },
  navy: { label: 'Frégates', cost: 30_000, upkeepPerDay: 200, attack: 5, defense: 4, speedKmh: 40, siege: 2 },
  air: { label: 'Aviation', cost: 40_000, upkeepPerDay: 300, attack: 6, defense: 1, speedKmh: 500, siege: 1.5 },
};

/** Bâtiment nécessaire au recrutement de chaque unité. */
export const UNIT_REQUIRES = {
  infantry: 'barracks', armor: 'barracks', artillery: 'barracks', navy: 'port', air: 'airbase',
} as const satisfies Record<UnitType, string>;

export const MILITARY = {
  /** Part maximale de la population mobilisable dans les armées payées par une ville. */
  mobilizationShare: 0.05,
  supplyRangeKm: 600,
  /** Portée de ravitaillement depuis une ville dotée d'une gare. */
  railSupplyRangeKm: 1_000,
  /** Vitesse multipliée entre deux gares amies (unités terrestres seulement). */
  railSpeedFactor: 3,
  maxMoveKm: 2_500,
  maxAirMoveKm: 1_500,
  /** Distance d'engagement entre armées ennemies hors des villes. */
  engageKm: 30,
  retreatSpeedFactor: 0.5,
  /** Attrition par jour hors ravitaillement / sans solde. */
  unsuppliedAttrition: 0.03,
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

/**
 * Annexion par la force : le joueur envoie des soldats (unités terrestres) stationnés dans une de ses villes.
 * Le trajet coûte des soldats ; la défense de la cible n'est connue qu'au moment de l'attaque.
 */
export const ANNEXATION = {
  /** Soldats qui doivent arriver pour tenir une ville. */
  baseTroops: 30,
  /** Un soldat perdu en route tous les 4 km. */
  troopsPerKm: 0.25,
  /** Défense d'une ville de joueur, en soldats : garnison (×1,5) et fortifications (×0,5). */
  perDefender: 1.5,
  perFortification: 0.5,
  /** Pertes à l'arrivée : prise d'une ville libre ; part de la défense que coûte une victoire. */
  lossesNeutral: 0.05,
  battleCost: 0.6,
  /** Part de la garnison tombée en repoussant un assaut, par soldat assaillant rapporté à la défense. */
  defenderAttrition: 0.3,
} as const;

/** Soldats perdus en route sur `km` kilomètres. */
export function travelLosses(km: number): number {
  return Math.ceil(ANNEXATION.troopsPerKm * km);
}

/** Minimum de soldats à envoyer pour qu'assez arrivent tenir une ville libre. */
export function annexationTroops(km: number): number {
  return ANNEXATION.baseTroops + travelLosses(km);
}

/** Portée d'une annexion par la force : illimitée depuis une ville dotée d'un port ou d'une base aérienne. */
export function annexationRangeKm(from: { buildings: { type: string }[] } | undefined): number {
  return hasBuilding(from, 'port') || hasBuilding(from, 'airbase') ? Infinity : EXPANSION.maxDistanceKm;
}

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

/** Transport des marchandises sous contrat : coût par unité et par 1 000 km. */
export const TRANSPORT = { costPer1000Km: 1, logisticsDiscount: 0.5 } as const;

/** Effet des infrastructures logistiques sur les prix du marché commun. */
export const LOGISTICS = {
  port: { sell: 1.1, buy: 0.95 },
  train_station: { sell: 1.05, buy: 0.97 },
} as const;

export const ORGANIZATION = { maxMembers: 20, maxPerPlayer: 5 } as const;

export const NATION = {
  maxTaxRate: 0.1,
  /** Budget accordé à la nation lors de son premier vote de la partie, par ville administrée. */
  startingBudgetPerCity: 100_000,
  maxTariff: 0.5,
  /** Coût de réalisation unique d'un grand projet. */
  projectCost: {
    highway: 1_500_000, power_grid: 1_000_000, university: 800_000, national_defense: 1_200_000,
    trade_fair: 300_000, national_health: 900_000, data_network: 500_000, national_park: 400_000, international_airport: 1_000_000,
  } as Record<ProjectId, number>,
  /**
   * Entretien quotidien pris en charge par le budget national tant que la mesure est en vigueur.
   * Les villes ne paient rien de plus : c'est la nation qui absorbe le coût.
   */
  measureUpkeepPerDay: {
    education: 15_000, emergency: 20_000,
    trade_fair: 10_000, national_health: 30_000, data_network: 20_000, national_park: 5_000, international_airport: 25_000,
  } as Partial<Record<LawId | ProjectId, number>>,
} as const;

/** Entretien quotidien total des lois et projets en vigueur d'un pays. */
export function measuresUpkeep(nation: NationState | undefined): number {
  if (!nation) return 0;
  const active = [...Object.entries(nation.laws), ...Object.entries(nation.projects)].filter(([, on]) => on).map(([id]) => id);
  return active.reduce((sum, id) => sum + (NATION.measureUpkeepPerDay[id as LawId | ProjectId] ?? 0), 0);
}

/**
 * Lois et projets qui produisent leurs effets. Un budget national en déficit suspend les mesures :
 * elles reprennent dès que la trésorerie repasse au-dessus de zéro.
 */
export function fundedMeasures(nation: NationState | undefined): { laws: Partial<Record<LawId, boolean>>; projects: Partial<Record<ProjectId, boolean>> } {
  if (!nation || nation.treasury < 0) return { laws: {}, projects: {} };
  return { laws: nation.laws, projects: nation.projects };
}

/** Deux villes jumelées : échanges entre elles moins chers, et chaque joueur peut consulter l'historique de l'autre. */
export function twinned(meta: WorldMeta, cityA: string, cityB: string): boolean {
  return meta.treaties.some((t) => t.type === 'twin' && t.status === 'active' && !!t.cities &&
    ((t.cities.a === cityA && t.cities.b === cityB) || (t.cities.a === cityB && t.cities.b === cityA)));
}

export const TREATY_LABEL: Record<TreatyType, string> = {
  twin: 'Jumelage de villes',
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

export function sharedOrganization(meta: Pick<WorldMeta, 'organizations'>, x: string, y: string, kind: 'military' | 'trade'): boolean {
  return (meta.organizations ?? []).some((o) => o.kind === kind && o.members.includes(x) && o.members.includes(y));
}

/** Alliés militaires : mêmes joueurs, alliance ou accord de défense actifs, organisation militaire commune. */
export function allied(meta: WorldMeta, x: string, y: string): boolean {
  return x === y || !!activeTreaty(meta, x, y, ['alliance', 'defense']) || sharedOrganization(meta, x, y, 'military');
}

/** Libre-échange : accord commercial ou union commerciale commune (pas de droits de douane). */
export function freeTrade(meta: WorldMeta, x: string, y: string): boolean {
  return x === y || !!activeTreaty(meta, x, y, ['trade']) || sharedOrganization(meta, x, y, 'trade');
}

/** Le détail économique et militaire d'un joueur est visible par lui-même et ses partenaires. */
export function detailVisible(meta: WorldMeta, viewer: string, owner: string): boolean {
  return viewer === owner || !!activeTreaty(meta, viewer, owner, ['alliance', 'intel']) || sharedOrganization(meta, viewer, owner, 'military');
}

export function hasBuilding(city: { buildings: { type: string }[] } | undefined, type: string): boolean {
  return !!city && city.buildings.some((b) => b.type === type);
}

export function citiesOf(world: World, playerId: string): string[] {
  return [...world.cities.values()].filter((c) => c.ownerId === playerId).map((c) => c.cityId).sort();
}

/** Électeurs d'un pays : joueurs possédant au moins une ville du pays qui n'a pas fait sécession. */
export function eligibleVoters(world: World, countryId: string): string[] {
  const set = new Set<string>();
  for (const c of world.cities.values()) if (c.countryId === countryId && c.independentSince === undefined) set.add(c.ownerId);
  return [...set].sort();
}

/** Dictature indépendante : ville sortie de son pays (ni impôt, ni lois, ni échanges extérieurs). */
export function isIndependent(city: { independentSince?: number } | undefined): boolean {
  return city?.independentSince !== undefined;
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
