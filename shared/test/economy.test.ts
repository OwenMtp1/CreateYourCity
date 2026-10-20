import { describe, expect, it } from 'vitest';
import {
  adviseCity, applyCityCommand, BUILDINGS, COMMERCE, ECONOMY, simulateTick, simulateTicks, type BuildingType, type CityState,
} from '../src/index.ts';
import { newCity } from './helpers.ts';

const ok = (city: CityState, cmd: Parameters<typeof applyCityCommand>[1]) => {
  const r = applyCityCommand(city, cmd);
  if (!r.ok) throw new Error(r.reason);
};
const build = (city: CityState, building: BuildingType, x: number, y: number) => ok(city, { type: 'build', building, x, y, rotation: 0 });
const idOf = (city: CityState, type: BuildingType, nth = 0) => city.buildings.filter((b) => b.type === type)[nth]!.id;

/** Avenue de 1,4 km depuis l'accès régional, immeubles au sud près de l'entrée, emplois pour tous. */
function town(): CityState {
  const city = newCity();
  city.treasury = 1e9;
  ok(city, { type: 'buildRoad', road: 'avenue', x1: 0, y1: 1000, x2: 700, y2: 1000 });
  ok(city, { type: 'buildRoad', road: 'avenue', x1: 700, y1: 1000, x2: 1400, y2: 1000 });
  for (let i = 0; i < 10; i++) build(city, 'apartment', 40 + i * 32, 1028);
  for (const x of [520, 560, 600, 640]) build(city, 'office', x, 1028);
  city.population = 1000;
  return city;
}

/** Laisse la population s'installer, puis renvoie les couches du dernier tick. */
const settle = (city: CityState, days = 5) => {
  simulateTicks(city, days * 144);
  return simulateTick(city);
};

describe('circuit des biens', () => {
  it('un commerce vend aux habitants de son quartier, pas à ceux qui sont trop loin', () => {
    const city = town();
    build(city, 'shop', 120, 978);
    build(city, 'shop', 1300, 978); // à 1 km des logements
    const layers = settle(city);
    const near = layers.economy![idOf(city, 'shop', 0)]!;
    const far = layers.economy![idOf(city, 'shop', 1)]!;
    expect(near.sold).toBeGreaterThan(0);
    expect(near.customers).toBeGreaterThan(0);
    expect(far.sold).toBe(0);
    expect(far.profit).toBeLessThan(0);
  });

  it('une usine voisine livre les commerces : achats moins chers, commerce rentable, moins d\'importations', () => {
    const alone = town();
    const withFactory = town();
    for (const c of [alone, withFactory]) { build(c, 'shop', 120, 978); build(c, 'shop', 260, 978); }
    build(withFactory, 'factory', 420, 970);
    const la = settle(alone);
    const lf = settle(withFactory);
    const shopA = la.economy![idOf(alone, 'shop')]!;
    const shopF = lf.economy![idOf(withFactory, 'shop')]!;
    expect(shopA.imported).toBeGreaterThan(0);
    expect(shopF.local).toBeGreaterThan(0);
    expect(shopF.imported).toBeLessThan(shopA.imported!);
    expect(shopF.unitCost).toBeLessThan(shopA.unitCost!);
    expect(shopF.profit).toBeGreaterThan(shopA.profit);
    expect(withFactory.stats!.goods.localSupplied).toBeGreaterThan(0);
    expect(lf.supply!.some((l) => l.from === idOf(withFactory, 'factory'))).toBe(true);
    // L'usine vend d'abord à la ville, le reste est exporté.
    const factory = lf.economy![idOf(withFactory, 'factory')]!;
    expect(factory.shipped).toBeGreaterThan(0);
    expect(factory.shipped! + factory.exported!).toBeCloseTo(factory.produced!, 0);
  });

  it('plus l\'usine est loin, plus la livraison coûte cher', () => {
    const near = town();
    const far = town();
    for (const c of [near, far]) build(c, 'shop', 120, 978);
    build(near, 'factory', 300, 970);
    build(far, 'factory', 1300, 970);
    const ln = settle(near);
    const lf = settle(far);
    expect(ln.supply![0]!.distance).toBeLessThan(lf.supply![0]!.distance);
    expect(ln.economy![idOf(near, 'shop')]!.unitCost).toBeLessThan(lf.economy![idOf(far, 'shop')]!.unitCost!);
    expect(ln.economy![idOf(near, 'shop')]!.unitCost).toBeGreaterThan(ECONOMY.localWholesalePrice);
  });

  it('les conseillers signalent les importations et les habitants sans commerce', () => {
    const city = town();
    build(city, 'shop', 120, 978);
    const layers = settle(city);
    const ids = adviseCity(city, layers).map((a) => a.id);
    expect(ids).toContain('goods');
    const empty = town();
    const l2 = settle(empty);
    expect(adviseCity(empty, l2).map((a) => a.id)).toContain('shops');
  });
});

describe('effets de voisinage', () => {
  it('un bureau à portée d\'une école gagne plus', () => {
    const plain = town();
    const school = town();
    build(school, 'school', 580, 975);
    const lp = settle(plain);
    const ls = settle(school);
    const office = idOf(plain, 'office');
    expect(lp.economy![office]!.educated).toBe(false);
    expect(ls.economy![idOf(school, 'office')]!.educated).toBe(true);
    expect(ls.economy![idOf(school, 'office')]!.revenue).toBeGreaterThan(lp.economy![office]!.revenue * (1 + COMMERCE.educatedOfficeBonus * 0.9));
  });

  it('un parc fait monter l\'impôt des logements voisins', () => {
    const plain = town();
    const park = town();
    build(park, 'park', 190, 970);
    const lp = settle(plain);
    const lk = settle(park);
    const home = idOf(plain, 'apartment', 3);
    expect(lk.economy![idOf(park, 'apartment', 3)]!.landValue).toBeGreaterThan(0);
    expect(lp.economy![home]!.landValue).toBe(0);
    // À habitants comparables, l'impôt par habitant est plus élevé.
    const perResident = (c: CityState) => c.stats!.budget.residentialTax / Math.max(1, c.stats!.employed);
    expect(perResident(park)).toBeGreaterThan(perResident(plain));
  });

  it('un service public peu utilisé coûte moins que son entretien maximal', () => {
    const city = town();
    build(city, 'clinic', 1300, 975); // loin de tout logement : aucun patient
    const layers = settle(city);
    const clinic = layers.economy![idOf(city, 'clinic')]!;
    expect(clinic.use).toBe(0);
    expect(clinic.publicCost).toBeCloseTo(BUILDINGS.clinic.upkeepPerDay * COMMERCE.serviceFixedUpkeepShare, 5);
  });

  it('une tour consomme plus de réseaux par logement qu\'un immeuble', () => {
    const t = BUILDINGS.tower, a = BUILDINGS.apartment;
    expect(t.powerMW / t.housing).toBeGreaterThan(a.powerMW / a.housing);
    expect(t.waterM3PerDay / t.housing).toBeGreaterThan(a.waterM3PerDay / a.housing);
  });
});

describe('équilibre', () => {
  it('une ville équilibrée (logements, commerces, usine, bureaux, école, parc) est bénéficiaire', () => {
    const city = town();
    build(city, 'shop', 120, 978);
    build(city, 'shop', 260, 978);
    build(city, 'factory', 420, 970);
    build(city, 'school', 700, 975);
    build(city, 'park', 190, 970);
    settle(city, 30);
    expect(city.stats!.budget.net).toBeGreaterThan(0);
    expect(city.stats!.unemploymentRate).toBeLessThan(0.2);
  });
});
