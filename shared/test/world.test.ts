import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, TICKS_PER_DAY, type CityState } from '../src/index.ts';
import {
  applyWorldAction, armySize, buildWorldView, checkExpansion, commitExpansion, createWorldMeta, stepWorld, type World, type WorldAction,
} from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const id = (name: string, country?: string) => {
  const c = WORLD_CITIES.find((x) => x.name === name && (!country || x.countryId === country));
  if (!c) throw new Error(name);
  return c.id;
};
const PARIS = id('Paris');
const LYON = id('Lyon');
const LILLE = id('Lille');
const BRUSSELS = id('Brussels');
const ORLEANS = id('Orléans');

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' }, carol: { name: 'Carol' } };
  return { tick: 0, cities: new Map(), meta };
}

function give(w: World, cityId: string, owner: string, treasury = 2_000_000): CityState {
  const wc = WORLD_CITIES.find((c) => c.id === cityId)!;
  const city = createCityState({ cityId, countryId: wc.countryId, ownerId: owner, ownerName: w.meta.players[owner]!.name, tick: w.tick });
  city.treasury = treasury;
  w.cities.set(cityId, city);
  return city;
}

function act(w: World, player: string, action: WorldAction) {
  const r = applyWorldAction(w, player, action);
  if (!r.ok) throw new Error(r.error);
}

function steps(w: World, n: number) {
  for (let i = 0; i < n; i++) stepWorld(w);
}

/** Ville peuplée avec une route, des logements, une caserne et éventuellement une usine. */
function developed(w: World, cityId: string, owner: string, opts: { factory?: boolean; shops?: number } = {}) {
  const city = give(w, cityId, owner, 5_000_000);
  const cmd = (c: Parameters<typeof applyCityCommand>[1]) => {
    const r = applyCityCommand(city, c);
    if (!r.ok) throw new Error(r.reason);
  };
  // Couloir sec garanti par la zone d'accès régional (200 m autour de l'accès).
  cmd({ type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 180, y2: 1000 });
  for (let i = 0; i < 4; i++) cmd({ type: 'build', building: 'apartment', x: 20 + i * 35, y: 1022, rotation: 0 });
  cmd({ type: 'build', building: 'barracks', x: 35, y: 975, rotation: 0 });
  if (opts.factory) cmd({ type: 'build', building: 'factory', x: 100, y: 975, rotation: 0 });
  for (let i = 0; i < (opts.shops ?? 0); i++) cmd({ type: 'build', building: 'shop', x: 140 + i * 22, y: 985, rotation: 0 });
  city.population = 480;
  return city;
}

describe('diplomatie', () => {
  it('propose, accepte et rend visibles les détails avec un partage d’informations', () => {
    const w = world();
    give(w, PARIS, 'alice');
    give(w, BRUSSELS, 'bob');
    expect(buildWorldView(w, 'alice').cityDetails).toHaveLength(0);
    act(w, 'alice', { type: 'proposeTreaty', to: 'bob', treaty: 'intel' });
    expect(applyWorldAction(w, 'alice', { type: 'respondTreaty', treatyId: w.meta.treaties[0]!.id, accept: true }).ok).toBe(false);
    act(w, 'bob', { type: 'respondTreaty', treatyId: w.meta.treaties[0]!.id, accept: true });
    expect(w.meta.treaties[0]!.status).toBe('active');
    expect(buildWorldView(w, 'alice').cityDetails.map((c) => c.cityId)).toEqual([BRUSSELS]);
  });

  it('un pacte de non-agression bloque la guerre jusqu’à la fin du préavis', () => {
    const w = world();
    give(w, PARIS, 'alice');
    give(w, BRUSSELS, 'bob');
    act(w, 'alice', { type: 'proposeTreaty', to: 'bob', treaty: 'non_aggression' });
    act(w, 'bob', { type: 'respondTreaty', treatyId: w.meta.treaties[0]!.id, accept: true });
    expect(applyWorldAction(w, 'alice', { type: 'declareWar', target: 'bob' }).ok).toBe(false);
    act(w, 'alice', { type: 'cancelTreaty', treatyId: w.meta.treaties[0]!.id });
    expect(applyWorldAction(w, 'alice', { type: 'declareWar', target: 'bob' }).ok).toBe(false);
    steps(w, TICKS_PER_DAY);
    act(w, 'alice', { type: 'declareWar', target: 'bob' });
    expect(w.meta.wars).toHaveLength(1);
    act(w, 'bob', { type: 'proposeTreaty', to: 'alice', treaty: 'peace' });
    act(w, 'alice', { type: 'respondTreaty', treatyId: w.meta.treaties.at(-1)!.id, accept: true });
    expect(w.meta.wars).toHaveLength(0);
  });

  it('cède une ville contre paiement', () => {
    const w = world();
    give(w, PARIS, 'alice', 100_000);
    give(w, LYON, 'alice', 0);
    give(w, BRUSSELS, 'bob', 1_000_000);
    act(w, 'alice', { type: 'proposeTreaty', to: 'bob', treaty: 'city_transfer', cityId: LYON, price: 300_000 });
    act(w, 'bob', { type: 'respondTreaty', treatyId: w.meta.treaties[0]!.id, accept: true, payFromCityId: BRUSSELS });
    expect(w.cities.get(LYON)!.ownerId).toBe('bob');
    expect(w.cities.get(BRUSSELS)!.treasury).toBe(700_000);
    expect(w.cities.get(PARIS)!.treasury).toBe(400_000);
  });

  it('messages privés visibles des seuls interlocuteurs', () => {
    const w = world();
    act(w, 'alice', { type: 'sendMessage', to: 'bob', text: 'Alliance ?' });
    expect(buildWorldView(w, 'bob').messages).toHaveLength(1);
    expect(buildWorldView(w, 'carol').messages).toHaveLength(0);
  });
});

describe('territoire', () => {
  it('étend son territoire à une ville neutre proche contre paiement', () => {
    const w = world();
    give(w, PARIS, 'alice', 1_000_000);
    expect(() => checkExpansion(w, 'alice', PARIS, WORLD_CITIES.find((c) => c.name === 'Tokyo')!.id)).toThrow(/Trop loin/);
    const { cost, city } = checkExpansion(w, 'alice', PARIS, ORLEANS);
    commitExpansion(w, 'alice', PARIS, city, cost);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('alice');
    expect(w.cities.get(PARIS)!.treasury).toBe(1_000_000 - cost);
    expect(w.cities.get(ORLEANS)!.buildings).toHaveLength(0);
  });

  it('transfère des fonds entre ses villes', () => {
    const w = world();
    give(w, PARIS, 'alice', 1000);
    give(w, LYON, 'alice', 0);
    act(w, 'alice', { type: 'transferFunds', fromCityId: PARIS, toCityId: LYON, amount: 600 });
    expect(w.cities.get(LYON)!.treasury).toBe(600);
    expect(applyWorldAction(w, 'alice', { type: 'transferFunds', fromCityId: PARIS, toCityId: LYON, amount: 600 }).ok).toBe(false);
  });
});

describe('armée et conquête', () => {
  it('exige une caserne et limite la mobilisation', () => {
    const w = world();
    give(w, PARIS, 'alice');
    expect(applyWorldAction(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'infantry', count: 5 }).ok).toBe(false);
    developed(w, LYON, 'alice');
    expect(applyWorldAction(w, 'alice', { type: 'recruit', cityId: LYON, unit: 'infantry', count: 30 }).ok).toBe(false);
    act(w, 'alice', { type: 'recruit', cityId: LYON, unit: 'infantry', count: 20 });
    expect(armySize(w.meta.armies[0]!)).toBe(20);
  });

  it('interdit d’entrer chez un joueur neutre', () => {
    const w = world();
    developed(w, PARIS, 'alice');
    give(w, LILLE, 'bob');
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'infantry', count: 10 });
    expect(applyWorldAction(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: LILLE }).ok).toBe(false);
  });

  it('déplace une armée, assiège et prend une ville ennemie non défendue', () => {
    const w = world();
    developed(w, PARIS, 'alice');
    give(w, LILLE, 'bob');
    give(w, BRUSSELS, 'bob');
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'armor', count: 20 });
    act(w, 'alice', { type: 'declareWar', target: 'bob' });
    act(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: LILLE });
    const army = w.meta.armies[0]!;
    steps(w, 6 * 12); // 12 h de jeu
    expect(army.movement).toBeNull();
    expect(army.cityId).toBe(LILLE);
    steps(w, TICKS_PER_DAY * 3);
    expect(w.cities.get(LILLE)!.ownerId).toBe('alice');
    expect(w.meta.events.some((e) => e.kind === 'capture')).toBe(true);
  });

  it('une garnison combat les assaillants (pertes des deux côtés)', () => {
    const w = world();
    developed(w, PARIS, 'alice');
    developed(w, LILLE, 'bob');
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'infantry', count: 24 });
    act(w, 'bob', { type: 'recruit', cityId: LILLE, unit: 'infantry', count: 24 });
    act(w, 'alice', { type: 'declareWar', target: 'bob' });
    act(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: LILLE });
    steps(w, TICKS_PER_DAY * 2);
    expect(w.cities.get(LILLE)!.ownerId).toBe('bob');
    const a = w.meta.armies.find((x) => x.ownerId === 'alice');
    const b = w.meta.armies.find((x) => x.ownerId === 'bob')!;
    // À effectifs égaux, le défenseur (bonus défensif) l'emporte, avec des pertes.
    expect(a ? armySize(a) : 0).toBeLessThan(armySize(b));
    expect(armySize(b)).toBeLessThan(24);
  });

  it('les armées étrangères lointaines sont invisibles, les proches approximatives', () => {
    const w = world();
    developed(w, PARIS, 'alice');
    give(w, WORLD_CITIES.find((c) => c.name === 'Tokyo')!.id, 'bob');
    act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'infantry', count: 13 });
    expect(buildWorldView(w, 'bob').armies).toHaveLength(0);
    give(w, LILLE, 'carol');
    const seen = buildWorldView(w, 'carol').armies[0]!;
    expect(seen.units).toBeNull();
    expect(seen.approxSize).toBe(10);
  });
});

describe('commerce et marché', () => {
  it('un contrat livre des biens et rémunère le vendeur', () => {
    const w = world();
    const seller = developed(w, PARIS, 'alice', { factory: true });
    const buyer = developed(w, LYON, 'bob', { shops: 3 });
    act(w, 'alice', { type: 'proposeContract', myCityId: PARIS, otherCityId: LYON, direction: 'sell', qtyPerDay: 40, pricePerUnit: 12, days: 10 });
    act(w, 'bob', { type: 'respondContract', contractId: w.meta.contracts[0]!.id, accept: true });
    steps(w, TICKS_PER_DAY);
    expect(seller.stats!.goods.contractDelivered).toBeGreaterThan(0);
    expect(buyer.stats!.goods.contractIn).toBeGreaterThan(0);
    expect(w.meta.contracts[0]!.deliveredRatio).toBeGreaterThan(0);
    steps(w, TICKS_PER_DAY * 10);
    expect(w.meta.contracts).toHaveLength(0);
  });

  it('le prix du marché monte quand la demande d’importation domine', () => {
    const w = world();
    developed(w, LYON, 'bob', { shops: 3 });
    const before = w.meta.market.price;
    steps(w, TICKS_PER_DAY);
    expect(w.meta.market.demand).toBeGreaterThan(w.meta.market.supply);
    expect(w.meta.market.price).toBeGreaterThan(before);
  });
});

describe('politique nationale', () => {
  it('élit à la majorité absolue, prélève l’impôt national, finance un projet, destitue', () => {
    const w = world();
    developed(w, PARIS, 'alice');
    developed(w, LYON, 'bob');
    developed(w, LILLE, 'carol');
    const fr = w.cities.get(PARIS)!.countryId;
    act(w, 'alice', { type: 'runForLeader', countryId: fr, run: true });
    act(w, 'alice', { type: 'vote', countryId: fr, candidateId: 'alice' });
    expect(w.meta.nations[fr]!.leaderId).toBeNull();
    act(w, 'bob', { type: 'vote', countryId: fr, candidateId: 'alice' });
    expect(w.meta.nations[fr]!.leaderId).toBe('alice');
    expect(applyWorldAction(w, 'bob', { type: 'setNationalTax', countryId: fr, rate: 0.05 }).ok).toBe(false);
    act(w, 'alice', { type: 'setNationalTax', countryId: fr, rate: 0.05 });
    steps(w, TICKS_PER_DAY * 2);
    expect(w.meta.nations[fr]!.treasury).toBeGreaterThan(0);
    w.meta.nations[fr]!.treasury = 2_000_000;
    act(w, 'alice', { type: 'fundProject', countryId: fr, project: 'highway' });
    expect(w.meta.nations[fr]!.projects.highway).toBe(true);
    act(w, 'alice', { type: 'setLaw', countryId: fr, law: 'environment', enabled: true });
    act(w, 'bob', { type: 'impeach', countryId: fr, support: true });
    expect(w.meta.nations[fr]!.leaderId).toBe('alice');
    act(w, 'carol', { type: 'impeach', countryId: fr, support: true });
    expect(w.meta.nations[fr]!.leaderId).toBeNull();
  });

  it('aucun dirigeant sans vote majoritaire, même avec des candidats et du temps', () => {
    const w = world();
    give(w, PARIS, 'alice');
    give(w, LYON, 'bob');
    give(w, LILLE, 'carol');
    const fr = w.cities.get(PARIS)!.countryId;
    act(w, 'alice', { type: 'runForLeader', countryId: fr, run: true });
    act(w, 'bob', { type: 'runForLeader', countryId: fr, run: true });
    act(w, 'alice', { type: 'vote', countryId: fr, candidateId: 'alice' });
    act(w, 'bob', { type: 'vote', countryId: fr, candidateId: 'bob' });
    steps(w, TICKS_PER_DAY * 3);
    expect(w.meta.nations[fr]!.leaderId).toBeNull();
    expect(applyWorldAction(w, 'alice', { type: 'setNationalTax', countryId: fr, rate: 0.05 }).ok).toBe(false);
    expect(w.meta.nations[fr]!.taxRate).toBe(0);
  });

  it('une guerre nationale engage tous les joueurs des deux pays', () => {
    const w = world();
    give(w, PARIS, 'alice');
    give(w, LYON, 'carol');
    give(w, BRUSSELS, 'bob');
    const fr = w.cities.get(PARIS)!.countryId;
    const be = w.cities.get(BRUSSELS)!.countryId;
    act(w, 'alice', { type: 'runForLeader', countryId: fr, run: true });
    act(w, 'alice', { type: 'vote', countryId: fr, candidateId: 'alice' });
    act(w, 'carol', { type: 'vote', countryId: fr, candidateId: 'alice' });
    act(w, 'alice', { type: 'declareNationalWar', countryId: fr, targetCountryId: be });
    expect(w.meta.wars).toHaveLength(2);
    act(w, 'bob', { type: 'runForLeader', countryId: be, run: true });
    act(w, 'bob', { type: 'vote', countryId: be, candidateId: 'bob' });
    act(w, 'bob', { type: 'proposeTreaty', to: 'alice', treaty: 'peace', nation: { from: be, to: fr } });
    act(w, 'alice', { type: 'respondTreaty', treatyId: w.meta.treaties.at(-1)!.id, accept: true });
    expect(w.meta.wars).toHaveLength(0);
  });

  it('le monde est déterministe', () => {
    const make = () => {
      const w = world();
      developed(w, PARIS, 'alice', { factory: true });
      developed(w, LILLE, 'bob', { shops: 2 });
      act(w, 'alice', { type: 'recruit', cityId: PARIS, unit: 'armor', count: 10 });
      act(w, 'alice', { type: 'declareWar', target: 'bob' });
      act(w, 'alice', { type: 'moveArmy', armyId: w.meta.armies[0]!.id, toCityId: LILLE });
      steps(w, 400);
      return w;
    };
    const a = make();
    const b = make();
    expect(a.meta).toEqual(b.meta);
    expect([...a.cities.values()]).toEqual([...b.cities.values()]);
  });
});
