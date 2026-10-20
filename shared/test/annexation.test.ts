import { describe, expect, it } from 'vitest';
import { createCityState, type CityState } from '../src/index.ts';
import {
  annexationTroops, applyWorldAction, checkExpansion, checkForcedAnnexation, commitExpansion, commitForcedAnnexation,
  createWorldMeta, distanceKm, forcedAnnexationPlan, landSize, UNIT_TYPES, type Army, type World,
} from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const id = (name: string) => WORLD_CITIES.find((c) => c.name === name && c.countryId === WORLD_CITIES.find((x) => x.name === 'Paris')!.countryId)!.id;
const PARIS = id('Paris');
const ORLEANS = id('Orléans');
const LYON = id('Lyon');
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

  it('par la force : il faut plus de soldats pour une ville lointaine', () => {
    const near = distanceKm(PARIS, ORLEANS);
    const far = distanceKm(PARIS, LYON);
    expect(far).toBeGreaterThan(near);
    expect(annexationTroops(far)).toBeGreaterThan(annexationTroops(near));
    const w = world();
    own(w, PARIS, 'alice');
    expect(() => forcedAnnexationPlan(w, 'alice', PARIS, ORLEANS)).toThrow(/Armée insuffisante/);
    troops(w, 'alice', PARIS, annexationTroops(near));
    expect(() => forcedAnnexationPlan(w, 'alice', PARIS, LYON)).toThrow(/Armée insuffisante/);
    const { plan, city } = checkForcedAnnexation(w, 'alice', PARIS, ORLEANS);
    const treasury = w.cities.get(PARIS)!.treasury;
    commitForcedAnnexation(w, 'alice', PARIS, city, plan);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('alice');
    expect(w.cities.get(PARIS)!.treasury).toBe(treasury);
    expect(soldiersAt(w, 'alice', PARIS)).toBeLessThan(1);
    expect(soldiersAt(w, 'alice', ORLEANS)).toBeGreaterThan(0);
    expect(soldiersAt(w, 'alice', ORLEANS)).toBeLessThan(plan.required);
  });

  it("seules les troupes nécessaires partent, le reste garde la ville d'origine", () => {
    const w = world();
    own(w, PARIS, 'alice');
    const need = annexationTroops(distanceKm(PARIS, ORLEANS));
    troops(w, 'alice', PARIS, need * 3);
    const { plan, city } = checkForcedAnnexation(w, 'alice', PARIS, ORLEANS);
    commitForcedAnnexation(w, 'alice', PARIS, city, plan);
    expect(soldiersAt(w, 'alice', PARIS)).toBeCloseTo(need * 2, 5);
  });

  it("la ville d'un joueur exige aussi de vaincre sa garnison, et l'attaque déclare la guerre", () => {
    const w = world();
    own(w, PARIS, 'alice');
    own(w, ORLEANS, 'bob');
    troops(w, 'bob', ORLEANS, 100);
    const base = annexationTroops(distanceKm(PARIS, ORLEANS));
    troops(w, 'alice', PARIS, base + 50);
    const r = applyWorldAction(w, 'alice', { type: 'annexByForce', fromCityId: PARIS, cityId: ORLEANS });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/garnison/);
    troops(w, 'alice', PARIS, 400);
    expect(applyWorldAction(w, 'alice', { type: 'annexByForce', fromCityId: PARIS, cityId: ORLEANS }).ok).toBe(true);
    expect(w.cities.get(ORLEANS)!.ownerId).toBe('alice');
    expect(w.meta.wars.some((x) => (x.a === 'alice' && x.b === 'bob'))).toBe(true);
    expect(w.meta.armies.some((a) => a.ownerId === 'bob' && a.cityId === ORLEANS)).toBe(false);
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
