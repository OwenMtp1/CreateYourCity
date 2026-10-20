import { describe, expect, it } from 'vitest';
import {
  applyCityCommand, BUILDING_TYPES, checkMilestones, cityCommandSchema, MILESTONES, PARKING, simulateTick, simulateTicks, type CityState,
} from '../src/index.ts';
import { newCity, withMainRoad } from './helpers.ts';

const ok = (city: CityState, cmd: Parameters<typeof applyCityCommand>[1]) => {
  const r = applyCityCommand(city, cmd);
  if (!r.ok) throw new Error(r.reason);
};

/** Ville linéaire de 2 400 habitants (logements à l'ouest, bureaux à l'est). */
function town(): CityState {
  const city = withMainRoad(newCity());
  city.treasury = 1e8;
  for (let i = 0; i < 6; i++) ok(city, { type: 'build', building: 'tower', x: 40 + i * 35, y: 1028, rotation: 0 });
  for (let i = 0; i < 6; i++) ok(city, { type: 'build', building: 'office', x: 470 + i * 35, y: 1028, rotation: 0 });
  city.population = 2400;
  return city;
}

const lotIds = (city: CityState) => city.buildings.filter((b) => b.type === 'parking' || b.type === 'parking_garage').map((b) => b.id);

describe('parkings', () => {
  it('sans parking, la demande dépasse les places de rue et le trafic ralentit', () => {
    const city = town();
    simulateTick(city);
    const p = city.stats!.parking;
    expect(p.streetSpaces).toBeCloseTo(700 * PARKING.streetSpacesPerMeter.street, 5);
    expect(p.lotSpaces).toBe(0);
    expect(p.demand).toBeGreaterThan(p.streetSpaces);
    expect(p.coverage).toBeLessThan(1);
  });

  it('un parking gratuit augmente la demande satisfaite et la fluidité', () => {
    const without = town();
    const withLot = town();
    ok(withLot, { type: 'build', building: 'parking_garage', x: 300, y: 975, rotation: 0 });
    simulateTick(without);
    const layers = simulateTick(withLot);
    expect(withLot.stats!.parking.coverage).toBeGreaterThan(without.stats!.parking.coverage);
    expect(withLot.stats!.traffic.efficiency).toBeGreaterThan(without.stats!.traffic.efficiency);
    expect(withLot.stats!.parking.revenue).toBe(0);
    expect(layers.parkingUse?.[lotIds(withLot)[0]!]).toBeGreaterThan(0);
  });

  it('un parking payant rapporte, mais un tarif excessif le vide et coûte en attractivité', () => {
    const free = town();
    const paid = town();
    const pricey = town();
    for (const c of [free, paid, pricey]) {
      ok(c, { type: 'build', building: 'parking', x: 300, y: 974, rotation: 0 });
      ok(c, { type: 'build', building: 'parking', x: 340, y: 974, rotation: 0 });
    }
    ok(paid, { type: 'setParkingFee', id: lotIds(paid)[0]!, fee: 2 });
    for (const id of lotIds(pricey)) ok(pricey, { type: 'setParkingFee', id, fee: PARKING.maxFee });
    simulateTick(free);
    const lp = simulateTick(paid);
    simulateTick(pricey);
    expect(paid.stats!.budget.parkingFees).toBeGreaterThan(0);
    expect(paid.stats!.parking.revenue).toBeCloseTo(paid.stats!.budget.parkingFees, 6);
    // Le parking payant reste utilisé, faute de mieux (la demande dépasse l'offre gratuite).
    expect(lp.parkingUse![lotIds(paid)[0]!]).toBeGreaterThan(0);
    expect(pricey.stats!.attractiveness).toBeLessThan(free.stats!.attractiveness);
  });

  it('valide le tarif : parking existant, bornes, retour à la gratuité', () => {
    const city = town();
    ok(city, { type: 'build', building: 'parking', x: 300, y: 974, rotation: 0 });
    const id = lotIds(city)[0]!;
    const tower = city.buildings.find((b) => b.type === 'tower')!.id;
    expect(applyCityCommand(city, { type: 'setParkingFee', id: tower, fee: 2 }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'setParkingFee', id: 99_999, fee: 2 }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'setParkingFee', id, fee: -1 }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'setParkingFee', id, fee: PARKING.maxFee + 1 }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'setParkingFee', id, fee: Number.NaN }).ok).toBe(false);
    ok(city, { type: 'setParkingFee', id, fee: 3.33 });
    expect(city.buildings.find((b) => b.id === id)!.fee).toBe(3.3);
    ok(city, { type: 'setParkingFee', id, fee: 0 });
    expect(city.buildings.find((b) => b.id === id)!.fee).toBeUndefined();
    // Le schéma réseau rejette les valeurs non numériques.
    expect(cityCommandSchema.safeParse({ type: 'setParkingFee', id, fee: 'gratuit' }).success).toBe(false);
    expect(cityCommandSchema.safeParse({ type: 'setParkingFee', id: -2, fee: 1 }).success).toBe(false);
  });

  it('ville sans route ni voiture : aucune division par zéro', () => {
    const city = newCity();
    simulateTicks(city, 5);
    const p = city.stats!.parking;
    expect(p.demand).toBe(0);
    expect(p.coverage).toBe(1);
    expect(Number.isFinite(city.stats!.traffic.efficiency)).toBe(true);
  });
});

describe('paliers', () => {
  it("attribue chaque palier une seule fois, à l'ordre de franchissement", () => {
    const city = town();
    city.population = 0;
    city.treasury = 0;
    expect(checkMilestones(city)).toEqual([]);
    city.population = 1_200;
    expect(checkMilestones(city)).toEqual(['pop-100', 'pop-500', 'pop-1000']);
    expect(checkMilestones(city)).toEqual([]);
    city.treasury = 2_500_000;
    expect(checkMilestones(city)).toEqual(['treasury-1000000', 'treasury-2000000']);
    // Redescendre ne retire rien.
    city.population = 10;
    city.treasury = 0;
    expect(checkMilestones(city)).toEqual([]);
    expect(city.milestones!.map((m) => m.id)).toEqual(['pop-100', 'pop-500', 'pop-1000', 'treasury-1000000', 'treasury-2000000']);
  });

  it('les identifiants sont uniques', () => {
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length);
  });

  it('la simulation enregistre les paliers', () => {
    const city = town();
    simulateTicks(city, 3);
    expect(city.milestones?.some((m) => m.id === 'pop-1000')).toBe(true);
  });
});

describe('robustesse', () => {
  it('aucune valeur non finie après des constructions et tarifs aléatoires', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const city = withMainRoad(newCity());
    city.treasury = 1e9;
    for (let x = 100; x <= 700; x += 150) {
      applyCityCommand(city, { type: 'buildRoad', road: rnd() > 0.5 ? 'avenue' : 'street', x1: x, y1: 1000, x2: x, y2: 700 });
    }
    for (let i = 0; i < 400; i++) {
      const type = BUILDING_TYPES[Math.floor(rnd() * BUILDING_TYPES.length)]!;
      applyCityCommand(city, { type: 'build', building: type, x: 20 + rnd() * 760, y: 680 + rnd() * 360, rotation: rnd() > 0.5 ? 90 : 0 });
      if (i % 25 === 0) {
        for (const b of city.buildings) {
          if (b.type === 'parking' || b.type === 'parking_garage') applyCityCommand(city, { type: 'setParkingFee', id: b.id, fee: rnd() * PARKING.maxFee });
        }
        simulateTick(city);
      }
    }
    for (let i = 0; i < 300; i++) simulateTick(city);
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number') expect(Number.isFinite(v), path).toBe(true);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(city.stats, 'stats');
    walk({ treasury: city.treasury, population: city.population }, 'city');
    expect(city.buildings.some((b) => b.type === 'parking' || b.type === 'parking_garage')).toBe(true);
  });
});
