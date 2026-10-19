// Test d'intégration PostgreSQL : lancé seulement si TEST_DATABASE_URL est défini
// (base jetable : le schéma public est réinitialisé).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCityState } from '@cyc/shared';
import { createWorldMeta } from '@cyc/shared/game';
import { PostgresStore } from '../src/store/postgres.ts';
import type { LobbyRecord } from '../src/store/types.ts';
import { connectClient, FakeClock, makeServer } from './helpers.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('stockage PostgreSQL', () => {
  let store: PostgresStore;

  beforeAll(async () => {
    store = new PostgresStore({ connectionString: url!, ssl: 'disable', autoMigrate: true });
    await store.pool.query('drop schema public cascade; create schema public;');
    await store.init();
    await store.init(); // idempotent
  });
  afterAll(async () => { await store?.close(); });

  async function lobby(): Promise<LobbyRecord> {
    const owner = `p-${randomUUID()}`;
    await store.upsertPlayer(owner, 'Owner');
    const l: LobbyRecord = {
      id: randomUUID(), code: randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), name: 'Test', isPublic: true,
      maxPlayers: 10, ownerId: owner, createdAt: new Date().toISOString(), tick: 0, lastSimulatedAt: Date.now(), world: null,
    };
    await store.createLobby(l);
    return l;
  }

  it('garantit l’unicité des propriétaires sous concurrence', async () => {
    const l = await lobby();
    const players = Array.from({ length: 8 }, (_, i) => `p${i}-${randomUUID()}`);
    for (const p of players) await store.upsertPlayer(p, p);
    const results = await Promise.all(
      players.map((p) => store.claimCity(l.id, createCityState({ cityId: 'c1', countryId: 'N250', ownerId: p, ownerName: p, tick: 0 }))),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'city_taken')).toHaveLength(7);
    // Un joueur peut posséder plusieurs villes (expansion) : la limite est appliquée par le serveur de jeu.
    const winner = players[results.indexOf('ok')]!;
    const again = await store.claimCity(l.id, createCityState({ cityId: 'c2', countryId: 'N250', ownerId: winner, ownerName: winner, tick: 0 }));
    expect(again).toBe('ok');
  });

  it('sauvegarde et recharge un instantané', async () => {
    const l = await lobby();
    await store.upsertPlayer('alice-pg', 'Alice');
    const city = createCityState({ cityId: 'c9', countryId: 'N250', ownerId: 'alice-pg', ownerName: 'Alice', tick: 0 });
    expect(await store.claimCity(l.id, city)).toBe('ok');
    city.treasury = 1234;
    city.tick = 42;
    const meta = createWorldMeta();
    meta.players['alice-pg'] = { name: 'Alice' };
    // Conquête : le propriétaire change et doit être réécrit.
    await store.upsertPlayer('bob-pg', 'Bob');
    city.ownerId = 'bob-pg';
    await store.saveSnapshot(l.id, { tick: 42, lastSimulatedAt: l.lastSimulatedAt + 42_000 }, [city], meta);
    const [loaded] = await store.loadCities(l.id);
    expect(loaded).toMatchObject({ treasury: 1234, tick: 42, ownerId: 'bob-pg' });
    const { rows } = await store.pool.query('select owner_id from cities where lobby_id = $1', [l.id]);
    expect(rows[0].owner_id).toBe('bob-pg');
    const reloaded = (await store.loadLobbies()).find((x) => x.id === l.id)!;
    expect(reloaded.tick).toBe(42);
    expect(reloaded.lastSimulatedAt).toBe(l.lastSimulatedAt + 42_000);
    expect(reloaded.world!.players['alice-pg']!.name).toBe('Alice');
  });

  it('fait tourner une partie complète sur PostgreSQL', async () => {
    const clock = new FakeClock(Date.now());
    const game = await makeServer(store, clock);
    const alice = connectClient(game);
    await alice.send({ t: 'auth', devName: 'Alice' });
    expect(await alice.send({ t: 'createLobby', name: 'Partie PG', isPublic: true, maxPlayers: 4 })).toMatchObject({ ok: true });
    expect(await alice.send({ t: 'claimCity', cityId: 'c1159151613' })).toMatchObject({ ok: true });
    expect((await alice.send({ t: 'chat', text: 'Salut' })).ok).toBe(true);
    await alice.send({ t: 'command', cityId: 'c1159151613', cmd: { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 200, y2: 1000 } });
    clock.t += 10_000;
    game.loop();
    await game.stop();
    const lobbyId = alice.last('lobbyJoined')!.lobby.id;
    const [city] = await store.loadCities(lobbyId);
    expect(city!.roads).toHaveLength(1);
    expect(city!.tick).toBe(10);
    expect(await store.loadChat(lobbyId, 10)).toHaveLength(1);
    const { rows } = await store.pool.query('select action from action_log where lobby_id = $1 order by id', [lobbyId]);
    expect(rows.map((r) => r.action)).toEqual(['claimCity', 'buildRoad']);
  });
});
