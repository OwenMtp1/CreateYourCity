import { describe, expect, it } from 'vitest';
import { createCityState, DT_DAYS, LAW_EFFECTS } from '../src/index.ts';
import { applyWorldAction, cityModifiers, createWorldMeta, measuresUpkeep, NATION, stepWorld, type World } from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const PARIS = WORLD_CITIES.find((c) => c.name === 'Paris')!.id;
const FRANCE = WORLD_CITIES.find((c) => c.id === PARIS)!.countryId;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  meta.nations[FRANCE] = {
    countryId: FRANCE, leaderId: 'alice', electedAtTick: 0, candidates: [], votes: {}, impeach: [], taxRate: 0.05, treasury: 1_000_000,
    laws: {}, projects: {},
  };
  return { tick: 0, cities: new Map(), meta };
}

describe('lois et projets : budget national', () => {
  it("l'entretien des mesures est payé par la nation, chaque jour", () => {
    const w = world();
    const nation = w.meta.nations[FRANCE]!;
    nation.laws.education = true;
    nation.projects.trade_fair = true;
    const expected = measuresUpkeep(nation);
    expect(expected).toBe(NATION.measureUpkeepPerDay.education! + NATION.measureUpkeepPerDay.trade_fair!);
    const before = nation.treasury;
    stepWorld(w);
    expect(nation.treasury).toBeCloseTo(before - expected * DT_DAYS, 5);
  });

  it('un budget en déficit suspend les effets des mesures', () => {
    const w = world();
    const nation = w.meta.nations[FRANCE]!;
    nation.laws.education = true;
    w.cities.set(PARIS, createCityState({ cityId: PARIS, countryId: FRANCE, ownerId: 'alice', ownerName: 'Alice', tick: 0 }));
    expect(cityModifiers(w, PARIS).laws.education).toBe(true);
    nation.treasury = -1;
    expect(cityModifiers(w, PARIS).laws.education).toBeUndefined();
  });

  it("l'état d'urgence suspend les élections", () => {
    const w = world();
    w.cities.set(PARIS, createCityState({ cityId: PARIS, countryId: FRANCE, ownerId: 'alice', ownerName: 'Alice', tick: 0 }));
    w.meta.nations[FRANCE]!.laws.emergency = true;
    const r = applyWorldAction(w, 'alice', { type: 'runForLeader', countryId: FRANCE, run: true });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toMatch(/état d'urgence/);
  });

  it("l'état d'urgence permet un impôt national jusqu'à 20 %, contre 10 % en temps normal", () => {
    const w = world();
    expect(applyWorldAction(w, 'alice', { type: 'setNationalTax', countryId: FRANCE, rate: 0.15 }).ok).toBe(false);
    w.meta.nations[FRANCE]!.laws.emergency = true;
    expect(LAW_EFFECTS.emergency.maxTaxRate).toBe(0.2);
    expect(applyWorldAction(w, 'alice', { type: 'setNationalTax', countryId: FRANCE, rate: 0.15 }).ok).toBe(true);
  });
});
