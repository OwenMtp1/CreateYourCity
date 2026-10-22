import { describe, expect, it } from 'vitest';
import { createCityState, type CityState } from '../src/index.ts';
import { applyWorldAction, changeOwner, cityModifiers, createWorldMeta, twinned, type World } from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const find = (name: string) => WORLD_CITIES.find((c) => c.name === name)!;
const PARIS = find('Paris'), LYON = find('Lyon'), BERLIN = find('Berlin');
const FRANCE = PARIS.countryId;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  meta.nations[FRANCE] = { countryId: FRANCE, leaderId: null, electedAtTick: null, candidates: [], votes: {}, impeach: [], taxRate: 0, tariff: 0.2, treasury: 0, laws: {}, projects: {} };
  return { tick: 0, cities: new Map(), meta };
}
function own(w: World, id: string, owner: string, countryId = FRANCE): CityState {
  const c = createCityState({ cityId: id, countryId, ownerId: owner, ownerName: w.meta.players[owner]!.name, tick: 0 });
  c.treasury = 1e6;
  w.cities.set(id, c);
  return c;
}

describe('villes jumelées', () => {
  it("un jumelage se propose à un autre joueur et devient actif à son acceptation", () => {
    const w = world();
    own(w, PARIS.id, 'alice');
    own(w, LYON.id, 'bob');
    expect(applyWorldAction(w, 'alice', { type: 'proposeTwin', to: 'bob', myCityId: PARIS.id, otherCityId: LYON.id }).ok).toBe(true);
    expect(twinned(w.meta, PARIS.id, LYON.id)).toBe(false);
    const t = w.meta.treaties.find((x) => x.type === 'twin')!;
    expect(applyWorldAction(w, 'bob', { type: 'respondTreaty', treatyId: t.id, accept: true }).ok).toBe(true);
    expect(twinned(w.meta, PARIS.id, LYON.id)).toBe(true);
    expect(twinned(w.meta, LYON.id, PARIS.id)).toBe(true);
  });

  it('refuse de jumeler ses propres villes, une ville étrangère au joueur ou une ville déjà jumelée', () => {
    const w = world();
    own(w, PARIS.id, 'alice');
    own(w, LYON.id, 'alice');
    own(w, BERLIN.id, 'bob', BERLIN.countryId);
    expect(applyWorldAction(w, 'alice', { type: 'proposeTwin', to: 'alice', myCityId: PARIS.id, otherCityId: LYON.id }).ok).toBe(false);
    expect(applyWorldAction(w, 'alice', { type: 'proposeTwin', to: 'bob', myCityId: PARIS.id, otherCityId: LYON.id }).ok).toBe(false);
    expect(applyWorldAction(w, 'alice', { type: 'proposeTwin', to: 'bob', myCityId: PARIS.id, otherCityId: BERLIN.id }).ok).toBe(true);
    expect(applyWorldAction(w, 'alice', { type: 'proposeTwin', to: 'bob', myCityId: PARIS.id, otherCityId: BERLIN.id }).ok).toBe(false);
  });

  it('une ville jumelée qui change de main perd son jumelage', () => {
    const w = world();
    own(w, PARIS.id, 'alice');
    const berlin = own(w, BERLIN.id, 'bob', BERLIN.countryId);
    applyWorldAction(w, 'alice', { type: 'proposeTwin', to: 'bob', myCityId: PARIS.id, otherCityId: BERLIN.id });
    applyWorldAction(w, 'bob', { type: 'respondTreaty', treatyId: w.meta.treaties[0]!.id, accept: true });
    expect(twinned(w.meta, PARIS.id, BERLIN.id)).toBe(true);
    changeOwner(w, berlin, 'alice');
    expect(twinned(w.meta, PARIS.id, BERLIN.id)).toBe(false);
  });

  it('entre villes jumelées, pas de droit de douane sur les échanges', () => {
    const w = world();
    const paris = own(w, PARIS.id, 'alice');
    own(w, BERLIN.id, 'bob', BERLIN.countryId);
    w.meta.contracts.push({
      id: w.meta.nextId++, sellerId: 'bob', sellerCityId: BERLIN.id, buyerId: 'alice', buyerCityId: PARIS.id,
      qtyPerDay: 50, pricePerUnit: 15, days: 10, status: 'active', deliveredRatio: 1, proposedAtTick: 0, activeSinceTick: 0, endsAtTick: 999,
    } as never);
    expect(cityModifiers(w, PARIS.id).contractIn.tariff).toBeGreaterThan(0);
    applyWorldAction(w, 'alice', { type: 'proposeTwin', to: 'bob', myCityId: PARIS.id, otherCityId: BERLIN.id });
    applyWorldAction(w, 'bob', { type: 'respondTreaty', treatyId: w.meta.treaties[0]!.id, accept: true });
    expect(cityModifiers(w, PARIS.id).contractIn.tariff).toBe(0);
    void paris;
  });
});
