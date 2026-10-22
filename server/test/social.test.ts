import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { connectClient, FakeClock, makeServer } from './helpers.ts';

async function two() {
  const store = new MemoryStore();
  const game = await makeServer(store, new FakeClock());
  const alice = connectClient(game);
  const bob = connectClient(game);
  await alice.send({ t: 'auth', devName: 'Alice' });
  await bob.send({ t: 'auth', devName: 'Bob' });
  const aliceId = alice.last('authed')!.player.id as string;
  const bobId = bob.last('authed')!.player.id as string;
  return { game, alice, bob, aliceId, bobId };
}

describe('amis, messages privés et invitations', () => {
  it('recherche par pseudo, demande, acceptation', async () => {
    const { alice, bob, bobId } = await two();
    expect((await alice.send({ t: 'friendSearch', query: 'bo' })).ok).toBe(true);
    expect(alice.last('friendResults')!.players.map((p: { name: string }) => p.name)).toEqual(['Bob']);
    expect((await alice.send({ t: 'friendRequest', playerId: bobId })).ok).toBe(true);
    expect(alice.last('friends')!.friends[0]).toMatchObject({ name: 'Bob', status: 'outgoing' });
    expect(bob.last('friends')!.friends[0]).toMatchObject({ name: 'Alice', status: 'incoming' });
    expect((await alice.send({ t: 'friendRequest', playerId: bobId })).ok).toBe(false);
    expect((await bob.send({ t: 'friendAccept', playerId: alice.last('authed')!.player.id })).ok).toBe(true);
    expect(alice.last('friends')!.friends[0]).toMatchObject({ status: 'friend', online: true });
  });

  it("messages privés réservés aux amis, avec historique", async () => {
    const { alice, bob, aliceId, bobId } = await two();
    expect((await alice.send({ t: 'dmSend', to: bobId, text: 'salut' })).ok).toBe(false);
    await alice.send({ t: 'friendRequest', playerId: bobId });
    await bob.send({ t: 'friendAccept', playerId: aliceId });
    expect((await alice.send({ t: 'dmSend', to: bobId, text: 'salut' })).ok).toBe(true);
    expect(bob.last('dm')!.message).toMatchObject({ from: aliceId, to: bobId, text: 'salut' });
    await alice.send({ t: 'dmHistory', with: bobId });
    expect(alice.last('dmHistory')!.messages).toHaveLength(1);
  });

  it("invitation d'un ami à rejoindre le salon, seulement depuis un salon", async () => {
    const { alice, bob, aliceId, bobId } = await two();
    await alice.send({ t: 'friendRequest', playerId: bobId });
    await bob.send({ t: 'friendAccept', playerId: aliceId });
    expect((await alice.send({ t: 'inviteFriend', to: bobId })).ok).toBe(false);
    await alice.send({ t: 'createLobby', name: 'Europe', isPublic: false, maxPlayers: 4 });
    const code = alice.last('lobbyJoined')!.lobby.code;
    expect((await alice.send({ t: 'inviteFriend', to: bobId })).ok).toBe(true);
    expect(bob.last('invite')).toMatchObject({ from: { name: 'Alice' }, lobby: { code } });
  });

  it('retirer un ami supprime la relation', async () => {
    const { alice, bob, aliceId, bobId } = await two();
    await alice.send({ t: 'friendRequest', playerId: bobId });
    await bob.send({ t: 'friendAccept', playerId: aliceId });
    await alice.send({ t: 'friendRemove', playerId: bobId });
    expect(alice.last('friends')!.friends).toHaveLength(0);
    expect((await alice.send({ t: 'dmSend', to: bobId, text: 'x' })).ok).toBe(false);
  });
});
