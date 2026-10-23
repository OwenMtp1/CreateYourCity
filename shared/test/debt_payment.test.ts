import { describe, expect, it } from 'vitest';
import { createCityState, type CityState } from '../src/index.ts';
import { applyWorldAction, buildWorldView, createWorldMeta, type World } from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const FRENCH = WORLD_CITIES.find((c) => c.name === 'Paris')!;
const LYON = WORLD_CITIES.find((c) => c.name === 'Lyon')!;
const FOREIGN = WORLD_CITIES.find((c) => c.countryId !== FRENCH.countryId)!;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  return { tick: 0, cities: new Map(), meta };
}

function city(w: World, id: string, countryId: string, owner: string, treasury: number, debt: number): CityState {
  const c = createCityState({ cityId: id, countryId, ownerId: owner, ownerName: w.meta.players[owner]!.name, tick: 0 });
  c.treasury = treasury;
  c.debt = debt;
  w.cities.set(id, c);
  return c;
}

describe("dettes de la nation", () => {
  it("un membre solde une partie de la dette d'une ville de sa nation", () => {
    const w = world();
    const paris = city(w, FRENCH.id, FRENCH.countryId, 'alice', 500_000, 0);
    const lyon = city(w, LYON.id, LYON.countryId, 'bob', 0, 300_000);
    expect(applyWorldAction(w, 'alice', { type: 'payDebt', fromCityId: paris.cityId, toCityId: lyon.cityId, amount: 100_000 }).ok).toBe(true);
    expect(lyon.debt).toBe(200_000);
    expect(paris.treasury).toBe(400_000);
  });

  it("le paiement est plafonné à la dette et solde entièrement", () => {
    const w = world();
    const paris = city(w, FRENCH.id, FRENCH.countryId, 'alice', 500_000, 0);
    const lyon = city(w, LYON.id, LYON.countryId, 'bob', 0, 300_000);
    expect(applyWorldAction(w, 'alice', { type: 'payDebt', fromCityId: paris.cityId, toCityId: lyon.cityId, amount: 1e9 }).ok).toBe(true);
    expect(lyon.debt).toBe(0);
    expect(paris.treasury).toBe(200_000);
  });

  it("refuse une ville d'un autre pays, une ville sans dette, ou une trésorerie insuffisante", () => {
    const w = world();
    const paris = city(w, FRENCH.id, FRENCH.countryId, 'alice', 50_000, 0);
    const foreign = city(w, FOREIGN.id, FOREIGN.countryId, 'bob', 0, 300_000);
    const lyon = city(w, LYON.id, LYON.countryId, 'bob', 0, 0);
    expect(applyWorldAction(w, 'alice', { type: 'payDebt', fromCityId: paris.cityId, toCityId: foreign.cityId, amount: 1000 }).ok).toBe(false);
    expect(applyWorldAction(w, 'alice', { type: 'payDebt', fromCityId: paris.cityId, toCityId: lyon.cityId, amount: 1000 }).ok).toBe(false);
    const big = city(w, LYON.id, LYON.countryId, 'bob', 0, 300_000);
    expect(applyWorldAction(w, 'alice', { type: 'payDebt', fromCityId: paris.cityId, toCityId: big.cityId, amount: 100_000 }).ok).toBe(false);
  });

  it("la vue nationale liste les dettes des villes du même pays", () => {
    const w = world();
    city(w, FRENCH.id, FRENCH.countryId, 'alice', 0, 0);
    city(w, LYON.id, LYON.countryId, 'bob', 0, 300_000);
    city(w, FOREIGN.id, FOREIGN.countryId, 'bob', 0, 999);
    const view = buildWorldView(w, 'alice');
    expect(view.nationDebts.map((d) => d.cityId).sort()).toEqual([FRENCH.id, LYON.id].sort());
    expect(view.nationDebts.find((d) => d.cityId === LYON.id)!.debt).toBe(300_000);
  });
});
