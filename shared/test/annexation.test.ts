import { describe, expect, it } from 'vitest';
import { createCityState, type CityState } from '../src/index.ts';
import {
  annexationTroops, applyWorldAction, travelLosses, checkExpansion, checkForcedAnnexation, commitExpansion, commitForcedAnnexation,
  createWorldMeta, distanceKm, forcedAnnexationPlan, landSize, UNIT_TYPES, type Army, type World,
} from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const id = (name: string) => WORLD_CITIES.find((c) => c.name === name && c.countryId === WORLD_CITIES.find((x) => x.name === 'Paris')!.countryId)!.id;
const PARIS = id('Paris');
const ORLEANS = id('Orléans');
const LYON = id('Lyon');
const MARSEILLE = id('Marseille');
const FRANCE = WORLD_CITIES.find((c) => c.id === PARIS)!.countryId;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  return { tick: 0, cities: new Map(), meta };
}
function own(w: World, cityId: string, owner: string): CityState {
  const c = createCityState({ cityId, countryId: FRANCE, ownerId: owner, ownerName: w.meta.players[owner]!.name, tick: 0 });
  c.treasury = 5_000_000;
  w.cities.set(cityId, c);
  return c;
}
function troops(w: World, owner: string, cityId: string, infantry: number) {
  const units = Object.fromEntries(UNIT_TYPES.map((u) => [u, 0])) as Army['units'];
  units.infantry = infantry;
  w.meta.armies.push({ id: w.meta.nextId++, ownerId: owner, homeCityId: cityId, units, cityId, movement: null, supplied: true, paid: true });
}
const soldiersAt = (w: World, owner: string, cityId: string) =>
  w.meta.armies.filter((a) => a.ownerId === owner && a.cityId === cityId).reduce((s, a) => s + landSize(a), 0);

describe('annexion', () => {
  it("l'argent d'une annexion payée revient au trésor du pays de la ville", () => {
    const w = world();
    const paris = own(w, PARIS, 'alice');
    const before = paris.treasury;
    const { cost, city } = checkExpansion(w, 'alice', PARIS, ORLEANS);
    commitExpansion(w, 'alice', PARIS, city, cost);
    expect(paris.treasury).toBe(before - cost);
    expect(w.meta.nations[FRANCE]!.treasury).toBe(cost);
  });

  it('par la force : plus la ville est loin, plus on perd de soldats en route', () => {
    const near = distanceKm(PARIS, ORLEANS);
    const far = distanceKm(PARIS, LYON);
    expect(travelLosses(far)).toBeGreaterThan(travelLosses(near));
    const w = world();
    own(w, PARIS, 'alice');
    expect(() => forcedAnnexationPlan(w, 'alice', PARIS, ORLEANS)).toThrow(/Aucun soldat/);
    troops(w, 'alice', PARIS, annexationTroops(near));
    expect(() => forcedAnnexationPlan(w, 'alice', PARIS, LYON)).toThrow(/perdus en route/);
    const { plan, city } = checkForcedAnnexation(w, 'alice', PARIS, ORLEANS);
    expect(plan.travelLoss).toBe(travelLosses(near));
    const treasury = w.cities.get(PARIS)!.treasury;
    commitForcedAnnexation(w, 'alice', PARIS, city, plan);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('alice');
    expect(w.cities.get(PARIS)!.treasury).toBe(treasury);
    expect(soldiersAt(w, 'alice', PARIS)).toBeLessThan(1);
    expect(soldiersAt(w, 'alice', ORLEANS)).toBeGreaterThan(0);
    expect(soldiersAt(w, 'alice', ORLEANS)).toBeLessThan(plan.arriving);
  });

  it("seuls les soldats envoyés partent, le reste garde la ville d'origine", () => {
    const w = world();
    own(w, PARIS, 'alice');
    troops(w, 'alice', PARIS, 500);
    const { plan, city } = checkForcedAnnexation(w, 'alice', PARIS, ORLEANS, 200);
    commitForcedAnnexation(w, 'alice', PARIS, city, plan);
    expect(soldiersAt(w, 'alice', PARIS)).toBeCloseTo(300, 5);
  });

  it("un port ou une base aérienne permet d'aller n'importe où, au prix de soldats perdus en route", () => {
    const w = world();
    const paris = own(w, PARIS, 'alice');
    troops(w, 'alice', PARIS, 2000);
    const km = distanceKm(PARIS, MARSEILLE);
    expect(km).toBeGreaterThan(500);
    expect(() => forcedAnnexationPlan(w, 'alice', PARIS, MARSEILLE)).toThrow(/port ni base aérienne/);
    paris.buildings.push({ id: 999, type: 'airbase', x: 500, y: 500, rotation: 0 } as never);
    const plan = forcedAnnexationPlan(w, 'alice', PARIS, MARSEILLE, 1000);
    expect(plan.travelLoss).toBe(travelLosses(km));
    expect(plan.arriving).toBe(1000 - travelLosses(km));
  });

  it("une défense plus forte (inconnue avant l'attaque) anéantit les troupes envoyées", () => {
    const w = world();
    own(w, PARIS, 'alice');
    own(w, ORLEANS, 'bob');
    troops(w, 'bob', ORLEANS, 200);
    troops(w, 'alice', PARIS, 300);
    expect(applyWorldAction(w, 'alice', { type: 'annexByForce', fromCityId: PARIS, cityId: ORLEANS, troops: 250 }).ok).toBe(true);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('bob');
    expect(soldiersAt(w, 'alice', PARIS)).toBeCloseTo(50, 5);
    expect(soldiersAt(w, 'alice', ORLEANS)).toBe(0);
    expect(soldiersAt(w, 'bob', ORLEANS)).toBeLessThan(200);
    expect(soldiersAt(w, 'bob', ORLEANS)).toBeGreaterThan(100);
    expect(w.meta.wars.some((x) => x.a === 'alice' && x.b === 'bob')).toBe(true);
    expect(w.meta.events.some((e) => e.kind === 'battle' && /repousse/.test(e.text))).toBe(true);
  });

  it('une attaque plus forte que la défense prend la ville', () => {
    const w = world();
    own(w, PARIS, 'alice');
    own(w, ORLEANS, 'bob');
    troops(w, 'bob', ORLEANS, 100);
    troops(w, 'alice', PARIS, 600);
    expect(applyWorldAction(w, 'alice', { type: 'annexByForce', fromCityId: PARIS, cityId: ORLEANS }).ok).toBe(true);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('alice');
    expect(w.meta.armies.some((a) => a.ownerId === 'bob' && a.cityId === ORLEANS)).toBe(false);
    expect(soldiersAt(w, 'alice', ORLEANS)).toBeGreaterThan(0);
  });

  it('on ne peut annexer un allié qu\'en le trahissant, ce qui rompt tous les accords', () => {
    const w = world();
    own(w, PARIS, 'alice');
    own(w, LYON, 'alice');
    own(w, ORLEANS, 'bob');
    troops(w, 'alice', PARIS, 1000);
    w.meta.treaties.push(
      { id: w.meta.nextId++, type: 'alliance', a: 'alice', b: 'bob', status: 'active', proposedAtTick: 0, activeSinceTick: 0, endsAtTick: null },
      { id: w.meta.nextId++, type: 'trade', a: 'bob', b: 'alice', status: 'active', proposedAtTick: 0, activeSinceTick: 0, endsAtTick: null },
    );
    w.meta.organizations.push({ id: w.meta.nextId++, name: 'Pacte du Nord', kind: 'military', founderId: 'alice', members: ['alice', 'bob'], invites: [], createdTick: 0 });
    w.meta.contracts.push({ id: w.meta.nextId++, sellerId: 'alice', sellerCityId: LYON, buyerId: 'bob', buyerCityId: ORLEANS, qtyPerDay: 10, pricePerUnit: 15, endsAtTick: 999, delivered: 0 } as never);

    const refused = applyWorldAction(w, 'alice', { type: 'annexByForce', fromCityId: PARIS, cityId: ORLEANS });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error).toMatch(/trahison/);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('bob');

    expect(applyWorldAction(w, 'alice', { type: 'annexByForce', fromCityId: PARIS, cityId: ORLEANS, betray: true }).ok).toBe(true);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('alice');
    expect(w.meta.treaties.filter((t) => [t.a, t.b].includes('bob'))).toHaveLength(0);
    expect(w.meta.organizations.find((o) => o.name === 'Pacte du Nord')!.members).toEqual(['bob']);
    expect(w.meta.contracts).toHaveLength(0);
    expect(w.meta.events.some((e) => e.kind === 'betrayal' && /trahit/.test(e.text))).toBe(true);
  });
});
