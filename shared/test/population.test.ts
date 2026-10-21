import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, POPULATION_POLICY, simulateTick, TICKS_PER_DAY, type CityState } from '../src/index.ts';
import { applyWorldAction, createWorldMeta, type World } from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const PARIS = WORLD_CITIES.find((c) => c.name === 'Paris')!.id;
const LYON = WORLD_CITIES.find((c) => c.name === 'Lyon')!.id;
const FRANCE = WORLD_CITIES.find((c) => c.id === PARIS)!.countryId;

/** Ville avec beaucoup de logements, peu d'emplois et une population nombreuse. */
function town(cityId: string, owner: string, name: string, population: number): CityState {
  const c = createCityState({ cityId, countryId: FRANCE, ownerId: owner, ownerName: name, tick: 0 });
  c.treasury = 5_000_000;
  const cmd = (x: Parameters<typeof applyCityCommand>[1]) => {
    const r = applyCityCommand(c, x);
    if (!r.ok) throw new Error(r.reason);
  };
  cmd({ type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 180, y2: 1000 });
  for (let i = 0; i < 4; i++) cmd({ type: 'build', building: 'apartment', x: 20 + i * 35, y: 1022, rotation: 0 });
  c.population = population;
  return c;
}

describe('gestion des habitants', () => {
  it("une campagne pour l'emploi augmente les actifs qui se présentent", () => {
    const c = town(PARIS, 'a', 'A', 300);
    simulateTick(c);
    const workforceWithout = c.stats!.workforce;
    c.treasury = 5_000_000;
    expect(applyCityCommand(c, { type: 'campaign', kind: 'jobs' }).ok).toBe(true);
    simulateTick(c);
    expect(c.stats!.workforce).toBeGreaterThan(workforceWithout);
  });

  it("une campagne d'attractivité relève la population visée", () => {
    const c = town(PARIS, 'a', 'A', 100);
    simulateTick(c);
    const target = c.stats!.targetPopulation;
    expect(applyCityCommand(c, { type: 'campaign', kind: 'attract' }).ok).toBe(true);
    simulateTick(c);
    expect(c.stats!.targetPopulation).toBeGreaterThan(target);
  });

  it('une campagne coûte son montant et ne se cumule pas avec la même', () => {
    const c = town(PARIS, 'a', 'A', 100);
    const t = c.treasury;
    expect(applyCityCommand(c, { type: 'campaign', kind: 'jobs' }).ok).toBe(true);
    expect(c.treasury).toBe(t - POPULATION_POLICY.campaignCost.jobs);
    expect(applyCityCommand(c, { type: 'campaign', kind: 'jobs' }).ok).toBe(false);
    expect(applyCityCommand(c, { type: 'campaign', kind: 'attract' }).ok).toBe(true);
  });

  it('une campagne se termine après sa durée', () => {
    const c = town(PARIS, 'a', 'A', 100);
    applyCityCommand(c, { type: 'campaign', kind: 'jobs' });
    c.tick += POPULATION_POLICY.campaignDays * TICKS_PER_DAY;
    expect(applyCityCommand(c, { type: 'campaign', kind: 'jobs' }).ok).toBe(true);
  });

  it("une campagne sans fonds est refusée", () => {
    const c = town(PARIS, 'a', 'A', 100);
    c.treasury = 1000;
    expect(applyCityCommand(c, { type: 'campaign', kind: 'attract' }).ok).toBe(false);
  });

  describe('transfert entre villes', () => {
    function world(): World {
      const meta = createWorldMeta();
      meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
      return { tick: 0, cities: new Map(), meta };
    }

    it("déplace des habitants entre deux villes de la même main, contre un coût de trajet", () => {
      const w = world();
      const a = town(PARIS, 'alice', 'Alice', 200);
      const b = town(LYON, 'alice', 'Alice', 10);
      w.cities.set(PARIS, a);
      w.cities.set(LYON, b);
      simulateTick(a);
      simulateTick(b);
      const [pa, pb, treasury] = [a.population, b.population, a.treasury];
      const r = applyWorldAction(w, 'alice', { type: 'transferResidents', fromCityId: PARIS, toCityId: LYON, count: 50 });
      expect(r.ok).toBe(true);
      expect(a.population).toBeCloseTo(pa - 50, 5);
      expect(b.population).toBeCloseTo(pb + 50, 5);
      expect(a.treasury).toBeLessThan(treasury);
    });

    it("refuse de dépasser les logements libres ou la population disponible", () => {
      const w = world();
      const a = town(PARIS, 'alice', 'Alice', 200);
      const b = town(LYON, 'alice', 'Alice', 10);
      w.cities.set(PARIS, a);
      w.cities.set(LYON, b);
      simulateTick(b);
      const tooMany = applyWorldAction(w, 'alice', { type: 'transferResidents', fromCityId: PARIS, toCityId: LYON, count: 500 });
      expect(tooMany.ok).toBe(false);
    });

    it("refuse une ville qui n'appartient pas au joueur", () => {
      const w = world();
      const a = town(PARIS, 'alice', 'Alice', 200);
      const b = town(LYON, 'bob', 'Bob', 10);
      w.cities.set(PARIS, a);
      w.cities.set(LYON, b);
      expect(applyWorldAction(w, 'alice', { type: 'transferResidents', fromCityId: PARIS, toCityId: LYON, count: 10 }).ok).toBe(false);
    });
  });
});
