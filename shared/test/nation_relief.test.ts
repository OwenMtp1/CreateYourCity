import { describe, expect, it } from 'vitest';
import { createCityState } from '../src/index.ts';
import { TICKS_PER_DAY } from '../src/constants.ts';
import { applyWorldAction, buildWorldView, createWorldMeta, type World } from '../src/world/index.ts';
import { NATION_RELIEF } from '../src/world/rules.ts';
import { WORLD_CITIES } from '../src/world.ts';

const PARIS = WORLD_CITIES.find((c) => c.name === 'Paris')!;
const LYON = WORLD_CITIES.find((c) => c.name === 'Lyon')!;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  meta.nations[PARIS.countryId] = {
    countryId: PARIS.countryId, leaderId: 'alice', electedAtTick: 0, candidates: [], votes: {}, impeach: [],
    taxRate: 0, treasury: 0, laws: {}, projects: {},
  };
  return { tick: 0, cities: new Map(), meta };
}
const city = (w: World, id: string, countryId: string, owner: string, debt: number) => {
  const c = createCityState({ cityId: id, countryId, ownerId: owner, ownerName: w.meta.players[owner]!.name, tick: 0 });
  c.debt = debt;
  w.cities.set(id, c);
  return c;
};
const claim = (w: World, player: string) => applyWorldAction(w, player, { type: 'claimNationRelief', countryId: PARIS.countryId });
const milestone = (w: World, k: number) => { w.tick = k * NATION_RELIEF.everyDays * TICKS_PER_DAY; };

describe('aide de la Communauté internationale', () => {
  it('efface toutes les dettes de la nation au palier de 2 000 jours', () => {
    const w = world();
    const paris = city(w, PARIS.id, PARIS.countryId, 'alice', 300_000);
    const lyon = city(w, LYON.id, LYON.countryId, 'bob', 200_000);
    milestone(w, 1);
    expect(buildWorldView(w, 'alice').nations.find((n) => n.countryId === PARIS.countryId)!.reliefDue).toBe(true);
    expect(claim(w, 'alice').ok).toBe(true);
    expect(paris.debt).toBe(0);
    expect(lyon.debt).toBe(0);
  });

  it("verse l'aide à la nation sans dette, et seul le dirigeant peut la demander", () => {
    const w = world();
    city(w, PARIS.id, PARIS.countryId, 'alice', 0);
    milestone(w, 1);
    expect(claim(w, 'bob').ok).toBe(false);
    const before = w.meta.nations[PARIS.countryId]!.treasury;
    expect(claim(w, 'alice').ok).toBe(true);
    expect(w.meta.nations[PARIS.countryId]!.treasury).toBe(before + NATION_RELIEF.aid);
  });

  it("une seule demande par palier : la suivante attend 2 000 jours de plus", () => {
    const w = world();
    city(w, PARIS.id, PARIS.countryId, 'alice', 0);
    milestone(w, 1);
    expect(claim(w, 'alice').ok).toBe(true);
    expect(claim(w, 'alice').ok).toBe(false);
    milestone(w, 2);
    expect(claim(w, 'alice').ok).toBe(true);
  });
});
