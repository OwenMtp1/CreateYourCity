import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONAL_ACCESS, STARTING_TREASURY, TICK_MS, TICKS_PER_DAY } from '@cyc/shared';
import { FileStore } from '../src/store/file.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { connectClient, FakeClock, makeServer } from './helpers.ts';

const PARIS = 'c1159151613';
const LYON = 'c1159150845';

async function lobbyWithTwoPlayers() {
  const store = new MemoryStore();
  const clock = new FakeClock();
  const game = await makeServer(store, clock);
  const alice = connectClient(game);
  const bob = connectClient(game);
  expect((await alice.send({ t: 'auth', devName: 'Alice' })).ok).toBe(true);
  expect((await bob.send({ t: 'auth', devName: 'Bob' })).ok).toBe(true);
  expect((await alice.send({ t: 'createLobby', name: 'Europe', isPublic: false, maxPlayers: 4 })).ok).toBe(true);
  const code = alice.last('lobbyJoined')!.lobby.code;
  expect((await bob.send({ t: 'joinLobby', code })).ok).toBe(true);
  return { store, clock, game, alice, bob, code };
}

describe('serveur de jeu', () => {
  it('exige une authentification', async () => {
    const game = await makeServer(new MemoryStore(), new FakeClock());
    const c = connectClient(game);
    const res = await c.send({ t: 'listLobbies' });
    expect(res.ok).toBe(false);
  });

  it('rejette les messages invalides', async () => {
    const game = await makeServer(new MemoryStore(), new FakeClock());
    const c = connectClient(game);
    await c.send({ t: 'auth', devName: 'Alice' });
    const res = await c.send({ t: 'command', cityId: PARIS, cmd: { type: 'build', building: 'castle', x: 1, y: 1, rotation: 0 } });
    expect(res.ok).toBe(false);
  });

  it('rejoint un salon privé par code et liste seulement les salons publics', async () => {
    const { alice, game } = await lobbyWithTwoPlayers();
    expect(game.publicLobbies()).toHaveLength(0);
    await alice.send({ t: 'createLobby', name: 'Monde ouvert', isPublic: true, maxPlayers: 10 });
    expect(game.publicLobbies().map((l) => l.name)).toEqual(['Monde ouvert']);
  });

  it('une ville ne peut avoir qu’un propriétaire, même avec des demandes simultanées', async () => {
    const { alice, bob, store } = await lobbyWithTwoPlayers();
    const [a, b] = await Promise.all([alice.send({ t: 'claimCity', cityId: PARIS }), bob.send({ t: 'claimCity', cityId: PARIS })]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const lobbyId = alice.last('lobbyJoined')!.lobby.id;
    expect(await store.loadCities(lobbyId)).toHaveLength(1);
    // Un joueur ne peut pas prendre une deuxième ville dans le même salon.
    const winner = a.ok ? alice : bob;
    expect((await winner.send({ t: 'claimCity', cityId: LYON })).ok).toBe(false);
    const loser = a.ok ? bob : alice;
    expect((await loser.send({ t: 'claimCity', cityId: LYON })).ok).toBe(true);
  });

  it('la ville commence vide et le serveur valide les constructions', async () => {
    const { alice, game, clock } = await lobbyWithTwoPlayers();
    await alice.send({ t: 'claimCity', cityId: PARIS });
    const city = alice.last('city')!.city;
    expect(city.buildings).toHaveLength(0);
    expect(city.treasury).toBe(STARTING_TREASURY);
    const bad = await alice.send({ t: 'command', cityId: PARIS, cmd: { type: 'build', building: 'house', x: 500, y: 500, rotation: 0 } });
    expect(bad.ok).toBe(false);
    const road = await alice.send({ t: 'command', cityId: PARIS, cmd: { type: 'buildRoad', road: 'street', x1: REGIONAL_ACCESS.x, y1: REGIONAL_ACCESS.y, x2: 150, y2: REGIONAL_ACCESS.y } });
    expect(road.ok).toBe(true);
    const house = await alice.send({ t: 'command', cityId: PARIS, cmd: { type: 'build', building: 'house', x: 60, y: 1020, rotation: 0 } });
    expect(house.ok).toBe(true);
    expect(alice.last('city')!.city.buildings).toHaveLength(1);
    expect(alice.last('city')!.layers.buildingStatus[alice.last('city')!.city.buildings[0]!.id]).toBe('ok');
    // Les ticks avancent au rythme fixe et diffusent les statistiques au propriétaire.
    clock.t += TICK_MS * TICKS_PER_DAY;
    game.loop();
    expect(alice.last('tick')!.tick).toBe(TICKS_PER_DAY);
    expect(alice.last('cityStats')!.population).toBeGreaterThan(0);
    // L'historique accompagne les statistiques dès qu'un échantillon est ajouté.
    expect(alice.last('cityStats')!.history!.length).toBe(TICKS_PER_DAY / 24);
  });

  it('les deux joueurs voient la même horloge et la ville de l’autre en résumé', async () => {
    const { alice, bob, game, clock } = await lobbyWithTwoPlayers();
    await alice.send({ t: 'claimCity', cityId: PARIS });
    clock.t += TICK_MS * 30;
    game.loop();
    expect(alice.last('tick')!.tick).toBe(30);
    expect(bob.last('tick')!.tick).toBe(30);
    expect(bob.last('summaries')!.summaries.map((s) => s.cityId)).toEqual([PARIS]);
    // Bob ne reçoit pas l'état détaillé de la ville d'Alice.
    expect(bob.messages.some((m) => m.t === 'city' || m.t === 'cityStats')).toBe(false);
    // Bob voit le monde mais pas le détail de la ville d'Alice.
    expect(bob.last('world')!.world.cityDetails).toHaveLength(0);
  });

  it('diffuse le chat aux membres du salon', async () => {
    const { alice, bob } = await lobbyWithTwoPlayers();
    expect((await alice.send({ t: 'chat', text: 'Bonjour' })).ok).toBe(true);
    expect(bob.last('chat')!.message.text).toBe('Bonjour');
  });

  it('refuse les joueurs au-delà de la capacité du salon', async () => {
    const { game, code } = await lobbyWithTwoPlayers();
    const carol = connectClient(game);
    await carol.send({ t: 'auth', devName: 'Carol' });
    expect((await carol.send({ t: 'joinLobby', code })).ok).toBe(true);
    const dave = connectClient(game);
    await dave.send({ t: 'auth', devName: 'Dave' });
    expect((await dave.send({ t: 'joinLobby', code })).ok).toBe(true);
    const eve = connectClient(game);
    await eve.send({ t: 'auth', devName: 'Eve' });
    const res = await eve.send({ t: 'joinLobby', code });
    expect(res).toMatchObject({ ok: false, error: 'Salon complet.' });
  });

  it('reprend après redémarrage et rattrape le temps écoulé de façon déterministe', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cyc-'));
    try {
      const clock = new FakeClock();
      const store1 = new FileStore(dir);
      await store1.init();
      const game1 = await makeServer(store1, clock);
      const alice = connectClient(game1);
      await alice.send({ t: 'auth', devName: 'Alice' });
      const token = alice.last('authed')!.token!;
      await alice.send({ t: 'createLobby', name: 'Persistant', isPublic: true, maxPlayers: 4 });
      const code = alice.last('lobbyJoined')!.lobby.code;
      await alice.send({ t: 'claimCity', cityId: PARIS });
      await alice.send({ t: 'command', cityId: PARIS, cmd: { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 200, y2: 1000 } });
      await alice.send({ t: 'command', cityId: PARIS, cmd: { type: 'build', building: 'apartment', x: 60, y: 1025, rotation: 0 } });
      clock.t += TICK_MS * 100;
      game1.loop();
      await game1.stop();
      await store1.close();
      const treasuryAtStop = alice.last('cityStats')!.treasury;

      // Serveur arrêté pendant une heure, puis redémarrage.
      clock.t += 3_600_000;
      const store2 = new FileStore(dir);
      await store2.init();
      const game2 = await makeServer(store2, clock);
      const world = [...game2.lobbies.values()][0]!;
      expect(world.tick).toBe(100 + 3600);
      expect(world.catchUp).toEqual({ simulated: 3600, skipped: 0 });

      // Le même jeton invité permet de retrouver sa ville après reconnexion.
      const again = connectClient(game2);
      expect((await again.send({ t: 'auth', token })).ok).toBe(true);
      expect((await again.send({ t: 'joinLobby', code })).ok).toBe(true);
      const joined = again.last('lobbyJoined')!;
      expect(joined.myCities[0]!.buildings).toHaveLength(1);
      expect(joined.myCities[0]!.tick).toBe(world.tick);
      expect(joined.myCities[0]!.treasury).not.toBe(treasuryAtStop);
      expect(joined.clock.catchUpTicks).toBe(3600);
      await game2.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('plafonne le rattrapage et signale le temps sauté', async () => {
    const store = new MemoryStore();
    const clock = new FakeClock();
    const game1 = await makeServer(store, clock);
    const alice = connectClient(game1);
    await alice.send({ t: 'auth', devName: 'Alice' });
    await alice.send({ t: 'createLobby', name: 'Plafond', isPublic: true, maxPlayers: 4 });
    await game1.stop();
    clock.t += TICK_MS * 1000;
    const game2 = await makeServer(store, clock, 200);
    const world = [...game2.lobbies.values()][0]!;
    expect(world.catchUp).toEqual({ simulated: 200, skipped: 800 });
    expect(world.tick).toBe(200);
    game2.loop(clock.t + TICK_MS);
    expect(world.tick).toBe(201);
  });

  it('phase 3 : traité, expansion et état du monde survivent au redémarrage', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cyc-'));
    try {
      const clock = new FakeClock();
      const store1 = new FileStore(dir);
      await store1.init();
      const game1 = await makeServer(store1, clock);
      const alice = connectClient(game1);
      const bob = connectClient(game1);
      await alice.send({ t: 'auth', devName: 'Alice' });
      await bob.send({ t: 'auth', devName: 'Bob' });
      await alice.send({ t: 'createLobby', name: 'Diplomatie', isPublic: false, maxPlayers: 4 });
      const code = alice.last('lobbyJoined')!.lobby.code;
      await bob.send({ t: 'joinLobby', code });
      await alice.send({ t: 'claimCity', cityId: PARIS });
      await bob.send({ t: 'claimCity', cityId: LYON });
      const bobId = bob.last('authed')!.player.id;
      expect((await alice.send({ t: 'action', action: { type: 'proposeTreaty', to: bobId, treaty: 'alliance' } })).ok).toBe(true);
      const proposal = bob.last('world')!.world.treaties.find((t) => t.status === 'proposed')!;
      expect((await bob.send({ t: 'action', action: { type: 'respondTreaty', treatyId: proposal.id, accept: true } })).ok).toBe(true);
      expect(alice.last('world')!.world.treaties[0]!.status).toBe('active');
      // L'alliance donne accès au détail de la ville du partenaire.
      expect(alice.last('world')!.world.cityDetails.map((c) => c.cityId)).toEqual([LYON]);
      // Expansion : nouvelle ville neutre à moins de 500 km, payée par Paris.
      const ORLEANS = 'c1159142017';
      const exp = await alice.send({ t: 'expandCity', fromCityId: PARIS, cityId: ORLEANS });
      expect(exp.ok).toBe(true);
      expect(alice.messages.some((m) => m.t === 'city' && m.city.cityId === ORLEANS)).toBe(true);
      expect((await alice.send({ t: 'claimCity', cityId: 'c1159151609' })).ok).toBe(false);
      clock.t += TICK_MS * 10;
      game1.loop();
      await game1.stop();
      await store1.close();

      const store2 = new FileStore(dir);
      await store2.init();
      const game2 = await makeServer(store2, clock);
      const world = [...game2.lobbies.values()][0]!;
      expect(world.world.meta.treaties[0]!.status).toBe('active');
      expect(world.citiesOf(alice.last('authed')!.player.id).map((c) => c.cityId).sort()).toEqual([ORLEANS, PARIS].sort());
      await game2.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
