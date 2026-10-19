import { describe, expect, it } from 'vitest';
import {
  adviseCity, analyzeLayout, applyCityCommand, createCityState, curvePoints, roundaboutPoints, simulateTick, simulateTicks,
  TICKS_PER_DAY, waterNearby, type CityState,
} from '../src/index.ts';
import { applyWorldAction, armySize, cityModifiers, createWorldMeta, stepWorld, type World, type WorldAction } from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';
import { newCity, withMainRoad } from './helpers.ts';

const ok = (city: CityState, cmd: Parameters<typeof applyCityCommand>[1]) => {
  const r = applyCityCommand(city, cmd);
  if (!r.ok) throw new Error(r.reason);
};

describe('routes courbes et ronds-points', () => {
  it('construit une courbe en plusieurs tronçons, atomiquement', () => {
    const city = withMainRoad(newCity());
    const before = city.roads.length;
    ok(city, { type: 'buildRoadPath', road: 'street', points: curvePoints({ x: 700, y: 1000 }, { x: 800, y: 1000 }, { x: 800, y: 900 }) });
    expect(city.roads.length).toBeGreaterThan(before + 3);
    expect(analyzeLayout(city).roadConnected.get(city.roads.at(-1)!.id)).toBe(true);
    // Un tracé dont un tronçon est invalide n'est pas construit du tout.
    ok(city, { type: 'build', building: 'house', x: 300, y: 1018, rotation: 0 });
    const n = city.roads.length;
    const r = applyCityCommand(city, { type: 'buildRoadPath', road: 'street', points: [{ x: 250, y: 1060 }, { x: 300, y: 1060 }, { x: 300, y: 1000 }] });
    expect(r.ok).toBe(false);
    expect(city.roads.length).toBe(n);
  });

  it('construit un rond-point fermé', () => {
    const city = withMainRoad(newCity());
    ok(city, { type: 'buildRoadPath', road: 'street', points: roundaboutPoints({ x: 735, y: 1000 }, 35) });
    expect(city.roads.length).toBe(13);
  });
});

/** Ville linéaire : logements à l'ouest, emplois à l'est, reliés par une seule rue. */
function commuterTown(): CityState {
  const city = withMainRoad(newCity());
  city.treasury = 1e8;
  for (let i = 0; i < 6; i++) ok(city, { type: 'build', building: 'tower', x: 40 + i * 35, y: 1028, rotation: 0 });
  for (let i = 0; i < 6; i++) ok(city, { type: 'build', building: 'office', x: 470 + i * 35, y: 1028, rotation: 0 });
  city.population = 2400;
  return city;
}

describe('trafic par itinéraires et transports en commun', () => {
  it('les trajets domicile-travail chargent les tronçons empruntés', () => {
    const city = commuterTown();
    const layers = simulateTick(city);
    expect(city.stats!.traffic.trips).toBeGreaterThan(1000);
    expect(layers.roadLoad[city.roads[0]!.id]).toBeGreaterThan(0.2);
    expect(analyzeLayout(city).routing.samples.length).toBeGreaterThan(0);
  });

  it('les transports en commun retirent des voitures et rapportent des recettes', () => {
    const car = commuterTown();
    const transit = commuterTown();
    ok(transit, { type: 'build', building: 'metro_station', x: 150, y: 975, rotation: 0 });
    ok(transit, { type: 'build', building: 'metro_station', x: 560, y: 975, rotation: 0 });
    const l1 = simulateTick(car);
    const l2 = simulateTick(transit);
    expect(transit.stats!.transit.riders).toBeGreaterThan(0);
    expect(transit.stats!.budget.transitFares).toBeGreaterThan(0);
    expect(l2.roadLoad[transit.roads[0]!.id]!).toBeLessThan(l1.roadLoad[car.roads[0]!.id]!);
  });

  it('une seule station ne crée pas de ligne', () => {
    const city = commuterTown();
    ok(city, { type: 'build', building: 'bus_station', x: 150, y: 978, rotation: 0 });
    simulateTick(city);
    expect(city.stats!.transit.riders).toBe(0);
  });
});

describe('port', () => {
  it("exige de l'eau à proximité", () => {
    const city = withMainRoad(newCity());
    city.treasury = 1e7;
    const r = applyCityCommand(city, { type: 'build', building: 'port', x: 100, y: 1030, rotation: 0 });
    expect(waterNearby(city.cityId, { minX: 70, minY: 1010, maxX: 130, maxY: 1050 }, 40)).toBe(false);
    expect(r).toMatchObject({ ok: false });
  });
});

describe('conseillers et historique', () => {
  it('signale route manquante, chômage et couverture', () => {
    const empty = newCity();
    expect(adviseCity(empty, null).map((a) => a.id)).toContain('no-road');
    const city = withMainRoad(newCity());
    city.treasury = 1e7;
    for (let i = 0; i < 8; i++) ok(city, { type: 'build', building: 'apartment', x: 30 + i * 35, y: 1028, rotation: 0 });
    city.population = 900;
    const layers = simulateTick(city);
    const ids = adviseCity(city, layers).map((a) => a.id);
    expect(ids).toContain('unemployment');
    expect(ids).toContain('cover-health');
  });

  it('détecte un équipement saturé et le situe', () => {
    const city = withMainRoad(newCity());
    city.treasury = 1e8;
    for (let i = 0; i < 10; i++) ok(city, { type: 'build', building: 'tower', x: 30 + i * 35, y: 1028, rotation: 0 });
    for (let i = 0; i < 5; i++) ok(city, { type: 'build', building: 'office', x: 30 + i * 35, y: 970, rotation: 0 });
    ok(city, { type: 'build', building: 'school', x: 230, y: 970, rotation: 0 });
    city.population = 4000;
    const layers = simulateTick(city);
    const sat = adviseCity(city, layers).find((a) => a.id.startsWith('saturated-'));
    expect(sat?.title).toMatch(/École.*saturé/);
  });

  it('échantillonne l’historique toutes les 4 h de jeu', () => {
    const city = withMainRoad(newCity());
    simulateTicks(city, TICKS_PER_DAY);
    expect(city.history!.length).toBe(TICKS_PER_DAY / 24);
  });
});

// --- Monde ------------------------------------------------------------------------------------

const id = (name: string) => WORLD_CITIES.find((c) => c.name === name)!.id;
const PARIS = id('Paris');
const LILLE = id('Lille');
const BRUSSELS = id('Brussels');
const LYON = id('Lyon');

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' }, carol: { name: 'Carol' } };
  return { tick: 0, cities: new Map(), meta };
}
function give(w: World, cityId: string, owner: string, buildings: string[] = []) {
  const wc = WORLD_CITIES.find((c) => c.id === cityId)!;
  const city = createCityState({ cityId, countryId: wc.countryId, ownerId: owner, ownerName: owner, tick: 0 });
  city.treasury = 1e7;
  city.population = 5000;
  buildings.forEach((t, i) => city.buildings.push({ id: 1000 + i, type: t as never, x: 0, y: 0, rotation: 0, builtAtTick: 0 }));
  w.cities.set(cityId, city);
  return city;
}
const act = (w: World, p: string, a: WorldAction) => {
  const r = applyWorldAction(w, p, a);
  if (!r.ok) throw new Error(r.error);
};
const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) stepWorld(w); };
function leader(w: World, player: string, countryId: string) {
  act(w, player, { type: 'runForLeader', countryId, run: true });
  act(w, player, { type: 'vote', countryId, candidateId: player });
}

describe('douanes, transport et logistique', () => {
  it('les droits de douane frappent les contrats étrangers sauf libre-échange', () => {
    const w = world();
    give(w, PARIS, 'alice');
    give(w, BRUSSELS, 'bob');
    const fr = w.cities.get(PARIS)!.countryId;
    leader(w, 'alice', fr);
    act(w, 'alice', { type: 'setTariff', countryId: fr, rate: 0.3 });
    act(w, 'bob', { type: 'proposeContract', myCityId: BRUSSELS, otherCityId: PARIS, direction: 'sell', qtyPerDay: 100, pricePerUnit: 10, days: 10 });
    act(w, 'alice', { type: 'respondContract', contractId: w.meta.contracts[0]!.id, accept: true });
    const taxed = cityModifiers(w, PARIS);
    expect(taxed.tariffRate).toBe(0.3);
    expect(taxed.contractIn.tariff).toBeCloseTo(300);
    expect(taxed.contractIn.cost).toBeGreaterThan(1000); // marchandise + transport
    act(w, 'alice', { type: 'proposeTreaty', to: 'bob', treaty: 'trade' });
    act(w, 'bob', { type: 'respondTreaty', treatyId: w.meta.treaties[0]!.id, accept: true });
    expect(cityModifiers(w, PARIS).contractIn.tariff).toBe(0);
  });

  it('un port améliore les prix du marché', () => {
    const w = world();
    give(w, PARIS, 'alice');
    give(w, LYON, 'bob', ['port']);
    expect(cityModifiers(w, LYON).goodsExportPrice).toBeGreaterThan(cityModifiers(w, PARIS).goodsExportPrice);
  });
});

describe('organisations multinationales', () => {
  it('une alliance militaire rend alliés et interdit la guerre entre membres', () => {
    const w = world();
    give(w, PARIS, 'alice');
    give(w, LILLE, 'bob', ['barracks']);
    act(w, 'alice', { type: 'createOrganization', name: 'Pacte du Nord', kind: 'military' });
    const org = w.meta.organizations[0]!;
    act(w, 'alice', { type: 'inviteToOrganization', orgId: org.id, playerId: 'bob' });
    act(w, 'bob', { type: 'respondOrganization', orgId: org.id, accept: true });
    expect(org.members).toEqual(['alice', 'bob']);
    expect(applyWorldAction(w, 'alice', { type: 'declareWar', target: 'bob' }).ok).toBe(false);
    act(w, 'bob', { type: 'recruit', cityId: LILLE, unit: 'infantry', count: 10 });
    act(w, 'bob', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: PARIS });
    act(w, 'alice', { type: 'sendMessage', to: `org:${org.id}`, text: 'Bienvenue' });
    act(w, 'bob', { type: 'leaveOrganization', orgId: org.id });
    expect(w.meta.organizations[0]!.members).toEqual(['alice']);
  });
});

describe('guerre étendue', () => {
  it('bataille en rase campagne entre deux armées en marche, puis retraite', () => {
    const w = world();
    give(w, PARIS, 'alice', ['barracks']);
    give(w, BRUSSELS, 'bob', ['barracks']);
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'infantry', count: 50 });
    act(w, 'bob', { type: 'recruit', cityId: BRUSSELS, unit: 'infantry', count: 50 });
    act(w, 'alice', { type: 'declareWar', target: 'bob' });
    const [a, b] = w.meta.armies;
    act(w, 'alice', { type: 'moveArmy', armyId: a!.id, toCityId: BRUSSELS });
    act(w, 'bob', { type: 'moveArmy', armyId: b!.id, toCityId: PARIS });
    steps(w, 6 * 8);
    expect(w.meta.battles).toHaveLength(1);
    expect(a!.engaged).toBe(true);
    expect(armySize(a!)).toBeLessThan(50);
    expect(applyWorldAction(w, 'alice', { type: 'moveArmy', armyId: a!.id, toCityId: LYON }).ok).toBe(false);
    act(w, 'alice', { type: 'moveArmy', armyId: a!.id, toCityId: PARIS });
    expect(a!.retreating).toBe(true);
    steps(w, 6 * 24);
    expect(a!.movement).toBeNull();
    expect(a!.cityId).toBe(PARIS);
  });

  it('flotte limitée aux ports, aviation à 1 500 km, prise impossible sans troupes au sol', () => {
    const w = world();
    give(w, PARIS, 'alice', ['port', 'airbase']);
    give(w, LILLE, 'bob');
    give(w, BRUSSELS, 'bob', ['port']);
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'navy', count: 10 });
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'air', count: 5 });
    act(w, 'alice', { type: 'declareWar', target: 'bob' });
    expect(applyWorldAction(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: LILLE }).ok).toBe(false);
    // Avion seul : rayon d'action limité (Moscou est à ~2 500 km).
    expect(applyWorldAction(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: id('Moscow'), units: { air: 5 } }).ok).toBe(false);
    act(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: BRUSSELS });
    steps(w, TICKS_PER_DAY * 4);
    expect(w.cities.get(BRUSSELS)!.ownerId).toBe('bob');
    expect(w.meta.sieges[BRUSSELS]?.progress).toBeCloseTo(0.99);
  });

  it('le rail triple la vitesse entre deux gares amies', () => {
    const w = world();
    give(w, PARIS, 'alice', ['barracks', 'train_station']);
    give(w, LYON, 'alice', ['train_station']);
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'infantry', count: 10 });
    act(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: LYON });
    stepWorld(w);
    expect(w.meta.armies[0]!.movement!.progressKm).toBeCloseTo(20 * 3 / 6);
  });
});
