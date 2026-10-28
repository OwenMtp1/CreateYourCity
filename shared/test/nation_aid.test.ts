import { describe, expect, it } from 'vitest';
import { createCityState } from '../src/index.ts';
import { applyWorldAction, createWorldMeta, type World, type WorldAction } from '../src/world/index.ts';
import { WORLD_CITIES } from '../src/world.ts';

const PARIS = WORLD_CITIES.find((c) => c.name === 'Paris')!;

function world(treasury = 1_000_000): World {
  const meta = createWorldMeta();
  meta.players = { alice: { name: 'Alice' }, bob: { name: 'Bob' } };
  meta.nations[PARIS.countryId] = {
    countryId: PARIS.countryId, leaderId: 'bob', electedAtTick: 0, candidates: [], votes: {}, impeach: [], taxRate: 0,
    treasury, laws: {}, projects: {},
  };
  const w: World = { tick: 0, cities: new Map(), meta };
  const city = createCityState({ cityId: PARIS.id, countryId: PARIS.countryId, ownerId: 'alice', ownerName: 'Alice', tick: 0 });
  city.treasury = 0;
  w.cities.set(PARIS.id, city);
  return w;
}
const act = (w: World, player: string, action: WorldAction) => applyWorldAction(w, player, action);
const requestId = (w: World) => w.meta.nations[PARIS.countryId]!.aidRequests![0]!.id;

describe("demandes d'aide des villes à la nation", () => {
  it('une ville demande le montant de son choix, une seule demande à la fois', () => {
    const w = world();
    expect(act(w, 'alice', { type: 'requestNationAid', cityId: PARIS.id, amount: 250_000 }).ok).toBe(true);
    expect(w.meta.nations[PARIS.countryId]!.aidRequests![0]!.amount).toBe(250_000);
    expect(act(w, 'alice', { type: 'requestNationAid', cityId: PARIS.id, amount: 1 }).ok).toBe(false);
  });

  it('le dirigeant accepte au montant demandé', () => {
    const w = world();
    act(w, 'alice', { type: 'requestNationAid', cityId: PARIS.id, amount: 250_000 });
    expect(act(w, 'bob', { type: 'respondNationAid', countryId: PARIS.countryId, requestId: requestId(w), accept: true }).ok).toBe(true);
    expect(w.meta.nations[PARIS.countryId]!.treasury).toBe(750_000);
    expect(w.cities.get(PARIS.id)!.treasury).toBe(250_000);
    expect(w.meta.nations[PARIS.countryId]!.aidRequests).toHaveLength(0);
  });

  it('le dirigeant peut modifier le montant accordé', () => {
    const w = world();
    act(w, 'alice', { type: 'requestNationAid', cityId: PARIS.id, amount: 250_000 });
    act(w, 'bob', { type: 'respondNationAid', countryId: PARIS.countryId, requestId: requestId(w), accept: true, amount: 100_000 });
    expect(w.cities.get(PARIS.id)!.treasury).toBe(100_000);
    expect(w.meta.nations[PARIS.countryId]!.treasury).toBe(900_000);
  });

  it('le dirigeant peut refuser, sans rien verser', () => {
    const w = world();
    act(w, 'alice', { type: 'requestNationAid', cityId: PARIS.id, amount: 250_000 });
    act(w, 'bob', { type: 'respondNationAid', countryId: PARIS.countryId, requestId: requestId(w), accept: false });
    expect(w.meta.nations[PARIS.countryId]!.treasury).toBe(1_000_000);
    expect(w.cities.get(PARIS.id)!.treasury).toBe(0);
    expect(w.meta.nations[PARIS.countryId]!.aidRequests).toHaveLength(0);
  });

  it("refuse une réponse hors budget ou d'un joueur qui n'est pas dirigeant", () => {
    const w = world(100_000);
    act(w, 'alice', { type: 'requestNationAid', cityId: PARIS.id, amount: 250_000 });
    expect(act(w, 'alice', { type: 'respondNationAid', countryId: PARIS.countryId, requestId: requestId(w), accept: true }).ok).toBe(false);
    expect(act(w, 'bob', { type: 'respondNationAid', countryId: PARIS.countryId, requestId: requestId(w), accept: true }).ok).toBe(false);
  });
});
