import { describe, expect, it } from 'vitest';
import { createCityState } from '../src/index.ts';
import { applyWorldAction, createWorldMeta, type World, type WorldAction } from '../src/world/index.ts';
import { NATION } from '../src/world/rules.ts';
import { WORLD_CITIES } from '../src/world.ts';

const id = (name: string) => WORLD_CITIES.find((x) => x.name === name)!;
const PARIS = id('Paris');
const LYON = id('Lyon');
const FRANCE = PARIS.countryId;

function world(): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  return { tick: 0, cities: new Map(), meta };
}
const act = (w: World, player: string, action: WorldAction) => {
  const r = applyWorldAction(w, player, action);
  if (!r.ok) throw new Error(r.error);
};
function elect(w: World, candidate: string, voters: string[]) {
  act(w, candidate, { type: 'runForLeader', countryId: FRANCE, run: true });
  for (const v of voters) act(w, v, { type: 'vote', countryId: FRANCE, candidateId: candidate });
}

describe('budget initial de la nation', () => {
  it("le premier vote accorde un budget par ville administrée, les votes suivants n'en accordent pas", () => {
    const w = world();
    for (const [c, owner] of [[PARIS, 'alice'], [LYON, 'bob']] as const) {
      w.cities.set(c.id, createCityState({ cityId: c.id, countryId: FRANCE, ownerId: owner, ownerName: w.meta.players[owner]!.name, tick: 0 }));
    }
    elect(w, 'alice', ['alice', 'bob']);
    expect(w.meta.nations[FRANCE]!.leaderId).toBe('alice');
    expect(w.meta.nations[FRANCE]!.treasury).toBe(2 * NATION.startingBudgetPerCity);

    act(w, 'alice', { type: 'resign', countryId: FRANCE });
    elect(w, 'bob', ['alice', 'bob']);
    expect(w.meta.nations[FRANCE]!.leaderId).toBe('bob');
    expect(w.meta.nations[FRANCE]!.treasury).toBe(2 * NATION.startingBudgetPerCity);
  });
});
