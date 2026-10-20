import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, INDEPENDENCE, summarizeCity, type CityState } from '../src/index.ts';
import { applyWorldAction, cityModifiers, createWorldMeta, stepWorld, type World, type WorldAction } from '../src/world/index.ts';
import { changeOwner } from '../src/world/military.ts';
import { eligibleVoters } from '../src/world/rules.ts';
import { WORLD_CITIES } from '../src/world.ts';

const id = (name: string) => WORLD_CITIES.find((x) => x.name === name)!.id;
const PARIS = id('Paris');
const LYON = id('Lyon');
const FRANCE = WORLD_CITIES.find((c) => c.id === PARIS)!.countryId;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  return { tick: 0, cities: new Map(), meta };
}

/** Ville peuplée : route, logements, commerces, et éventuellement une usine (sans centrale ni château d'eau). */
function developed(w: World, cityId: string, owner: string, opts: { factory?: boolean; utilities?: boolean } = {}): CityState {
  const wc = WORLD_CITIES.find((c) => c.id === cityId)!;
  const city = createCityState({ cityId, countryId: wc.countryId, ownerId: owner, ownerName: w.meta.players[owner]!.name, tick: w.tick });
  city.treasury = 5_000_000;
  w.cities.set(cityId, city);
  const cmd = (c: Parameters<typeof applyCityCommand>[1]) => {
    const r = applyCityCommand(city, c);
    if (!r.ok) throw new Error(r.reason);
  };
  cmd({ type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 180, y2: 1000 });
  for (let i = 0; i < 4; i++) cmd({ type: 'build', building: 'apartment', x: 20 + i * 35, y: 1022, rotation: 0 });
  cmd({ type: 'build', building: 'shop', x: 30, y: 985, rotation: 0 });
  cmd({ type: 'build', building: 'office', x: 140, y: 975, rotation: 0 });
  if (opts.factory) cmd({ type: 'build', building: 'factory', x: 80, y: 975, rotation: 0 });
  if (opts.utilities) {
    cmd({ type: 'build', building: 'power_plant', x: 80, y: 970, rotation: 0 });
    cmd({ type: 'build', building: 'water_tower', x: 170, y: 985, rotation: 0 });
  }
  city.population = 480;
  return city;
}

const act = (w: World, player: string, action: WorldAction) => {
  const r = applyWorldAction(w, player, action);
  if (!r.ok) throw new Error(r.error);
};
const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) stepWorld(w); };

describe('dictature indépendante', () => {
  it('quitte le pays : plus électeur, dirigeant destitué, membres prévenus, ville signalée', () => {
    const w = world();
    developed(w, PARIS, 'alice');
    developed(w, LYON, 'bob');
    act(w, 'alice', { type: 'runForLeader', countryId: FRANCE, run: true });
    act(w, 'alice', { type: 'vote', countryId: FRANCE, candidateId: 'alice' });
    act(w, 'bob', { type: 'vote', countryId: FRANCE, candidateId: 'alice' });
    expect(w.meta.nations[FRANCE]!.leaderId).toBe('alice');

    act(w, 'alice', { type: 'secede', cityId: PARIS });
    const paris = w.cities.get(PARIS)!;
    expect(paris.independentSince).toBe(0);
    expect(eligibleVoters(w, FRANCE)).toEqual(['bob']);
    expect(w.meta.nations[FRANCE]!.leaderId).toBeNull();
    const ev = w.meta.events.find((e) => e.kind === 'independence')!;
    expect(ev.text).toMatch(/dictature indépendante/);
    expect(ev.players).toEqual(expect.arrayContaining(['alice', 'bob']));
    expect(summarizeCity(paris).independent).toBe(true);
    expect(applyWorldAction(w, 'alice', { type: 'secede', cityId: PARIS }).ok).toBe(false);
  });

  it("n'est plus soumise à l'impôt, aux lois ni aux projets du pays", () => {
    const w = world();
    developed(w, PARIS, 'alice');
    developed(w, LYON, 'bob');
    w.meta.nations[FRANCE] = {
      countryId: FRANCE, leaderId: 'bob', electedAtTick: 0, candidates: ['bob'], votes: {}, impeach: [], taxRate: 0.08, tariff: 0.2, treasury: 1e6,
      laws: { minimum_wage: true }, projects: { highway: true },
    };
    act(w, 'alice', { type: 'secede', cityId: PARIS });
    const m = cityModifiers(w, PARIS);
    expect(m.isolated).toBe(true);
    expect(m.nationalTaxRate).toBe(0);
    expect(m.tariffRate).toBe(0);
    expect(m.laws).toEqual({});
    expect(m.projects).toEqual({});
    steps(w, 3);
    expect(w.cities.get(PARIS)!.stats!.budget.nationalTax).toBe(0);
    expect(w.cities.get(LYON)!.stats!.budget.nationalTax).toBeGreaterThan(0);
    // Plus de subvention possible.
    expect(applyWorldAction(w, 'bob', { type: 'nationalGrant', countryId: FRANCE, toCityId: PARIS, amount: 1000 }).ok).toBe(false);
  });

  it('sans réseau régional : coupures (non facturées) et habitants mécontents', () => {
    const w = world();
    const free = developed(w, LYON, 'bob');
    const dict = developed(w, PARIS, 'alice');
    act(w, 'alice', { type: 'secede', cityId: PARIS });
    steps(w, 144 * 3);
    expect(free.stats!.budget.utilityImports).toBeGreaterThan(0);
    expect(dict.stats!.budget.utilityImports).toBe(0);
    expect(dict.stats!.isolation!.powerCover).toBeLessThan(0.5);
    expect(dict.stats!.attractiveness).toBeLessThan(free.stats!.attractiveness);
  });

  it("aucune importation : les commerces d'une dictature ne vendent que la production locale", () => {
    const w = world();
    const free = developed(w, LYON, 'bob', { utilities: true });
    const dict = developed(w, PARIS, 'alice', { utilities: true });
    act(w, 'alice', { type: 'secede', cityId: PARIS });
    steps(w, 144 * 3);
    expect(dict.stats!.isolation!.powerCover).toBe(1);
    expect(free.stats!.goods.imported).toBeGreaterThan(0);
    expect(dict.stats!.goods.imported).toBe(0);
    expect(dict.stats!.goods.sold).toBe(0);
    expect(dict.stats!.isolation!.lostSales).toBeGreaterThan(0);
  });

  it("une usine de dictature ne peut pas exporter son surplus", () => {
    const w = world();
    const wc = WORLD_CITIES.find((c) => c.id === PARIS)!;
    const dict = createCityState({ cityId: PARIS, countryId: wc.countryId, ownerId: 'alice', ownerName: 'Alice', tick: 0 });
    dict.treasury = 5_000_000;
    w.cities.set(PARIS, dict);
    for (const c of [
      { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 180, y2: 1000 },
      { type: 'build', building: 'factory', x: 80, y: 975, rotation: 0 },
      { type: 'build', building: 'power_plant', x: 40, y: 1030, rotation: 0 },
      { type: 'build', building: 'water_tower', x: 100, y: 1018, rotation: 0 },
      { type: 'build', building: 'apartment', x: 140, y: 1022, rotation: 0 },
    ] as Parameters<typeof applyCityCommand>[1][]) {
      const r = applyCityCommand(dict, c);
      if (!r.ok) throw new Error(r.reason);
    }
    dict.population = 120;
    act(w, 'alice', { type: 'secede', cityId: PARIS });
    steps(w, 144);
    expect(dict.stats!.goods.produced).toBeGreaterThan(0);
    expect(dict.stats!.goods.exported).toBe(0);
    expect(dict.stats!.isolation!.unsoldGoods).toBeGreaterThan(0);
  });

  it('contrats annulés à la sécession et interdits ensuite', () => {
    const w = world();
    developed(w, PARIS, 'alice', { factory: true });
    developed(w, LYON, 'bob');
    act(w, 'alice', { type: 'proposeContract', myCityId: PARIS, otherCityId: LYON, direction: 'sell', qtyPerDay: 50, pricePerUnit: 15, days: 10 });
    act(w, 'bob', { type: 'respondContract', contractId: w.meta.contracts[0]!.id, accept: true });
    expect(w.meta.contracts).toHaveLength(1);
    act(w, 'alice', { type: 'secede', cityId: PARIS });
    expect(w.meta.contracts).toHaveLength(0);
    const r = applyWorldAction(w, 'bob', { type: 'proposeContract', myCityId: LYON, otherCityId: PARIS, direction: 'buy', qtyPerDay: 50, pricePerUnit: 15, days: 10 });
    expect(r.ok).toBe(false);
  });

  it('réintégration après un jour de jeu, puis délai avant une nouvelle sécession', () => {
    const w = world();
    developed(w, PARIS, 'alice');
    act(w, 'alice', { type: 'secede', cityId: PARIS });
    expect(applyWorldAction(w, 'alice', { type: 'rejoinCountry', cityId: PARIS }).ok).toBe(false);
    steps(w, INDEPENDENCE.cooldownTicks);
    act(w, 'alice', { type: 'rejoinCountry', cityId: PARIS });
    expect(w.cities.get(PARIS)!.independentSince).toBeUndefined();
    expect(eligibleVoters(w, FRANCE)).toEqual(['alice']);
    expect(cityModifiers(w, PARIS).isolated).toBeFalsy();
    expect(applyWorldAction(w, 'alice', { type: 'secede', cityId: PARIS }).ok).toBe(false);
  });

  it('une dictature conquise réintègre son pays', () => {
    const w = world();
    const paris = developed(w, PARIS, 'alice');
    act(w, 'alice', { type: 'secede', cityId: PARIS });
    changeOwner(w, paris, 'bob');
    expect(paris.independentSince).toBeUndefined();
    expect(eligibleVoters(w, FRANCE)).toEqual(['bob']);
  });
});
