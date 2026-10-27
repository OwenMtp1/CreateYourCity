import { describe, expect, it } from 'vitest';
import { createCityState, isAdminName } from '../src/index.ts';
import { applyWorldAction, createWorldMeta, type World } from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const PARIS = WORLD_CITIES.find((c) => c.name === 'Paris')!;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { owen: { name: 'OwenMtp' }, alice: { name: 'Alice' } };
  meta.nations[PARIS.countryId] = {
    countryId: PARIS.countryId, leaderId: 'alice', electedAtTick: 0, candidates: [], votes: {}, impeach: [], taxRate: 0,
    treasury: -30_000_000, laws: {}, projects: {},
  };
  const w: World = { tick: 0, cities: new Map(), meta };
  w.cities.set(PARIS.id, createCityState({ cityId: PARIS.id, countryId: PARIS.countryId, ownerId: 'alice', ownerName: 'Alice', tick: 0 }));
  return w;
}

describe('remise à zéro admin du budget national', () => {
  it("l'administrateur remet le budget à zéro", () => {
    const w = world();
    expect(applyWorldAction(w, 'owen', { type: 'resetNationBudget', countryId: PARIS.countryId }).ok).toBe(true);
    expect(w.meta.nations[PARIS.countryId]!.treasury).toBe(0);
  });

  it("un joueur ordinaire ne le peut pas", () => {
    const w = world();
    expect(applyWorldAction(w, 'alice', { type: 'resetNationBudget', countryId: PARIS.countryId }).ok).toBe(false);
    expect(w.meta.nations[PARIS.countryId]!.treasury).toBe(-30_000_000);
  });

  it('le nom administrateur ne tient pas compte de la casse', () => {
    expect(isAdminName('owenmtp')).toBe(true);
    expect(isAdminName('OwenMtp')).toBe(true);
    expect(isAdminName('Alice')).toBe(false);
    expect(isAdminName(undefined)).toBe(false);
  });
});
