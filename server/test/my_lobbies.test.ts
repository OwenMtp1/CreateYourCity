import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { connectClient, FakeClock, makeServer } from './helpers.ts';

describe('parties du joueur', () => {
  it("liste les salons dont le joueur est membre, pas ceux des autres", async () => {
    const clock = new FakeClock();
    const game = await makeServer(new MemoryStore(), clock);
    const alice = connectClient(game);
    const bob = connectClient(game);
    await alice.send({ t: 'auth', devName: 'Alice' });
    await bob.send({ t: 'auth', devName: 'Bob' });
    await alice.send({ t: 'createLobby', name: 'Partie A', isPublic: true, maxPlayers: 4 });
    await bob.send({ t: 'createLobby', name: 'Partie B', isPublic: false, maxPlayers: 4 });
    await alice.send({ t: 'listLobbies' });
    const names = alice.last('myLobbies')!.lobbies.map((l: { name: string }) => l.name);
    expect(names).toEqual(['Partie A']);
    expect(alice.last('myLobbies')!.lobbies[0]!.cities).toEqual([]);
  });
});
