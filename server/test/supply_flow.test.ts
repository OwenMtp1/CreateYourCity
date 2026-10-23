import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.ts';
import { connectClient, FakeClock, makeServer } from './helpers.ts';
import { TICK_MS } from '@cyc/shared';

const PARIS = 'c1159151613';

describe('livraisons vues par le joueur', () => {
  it('une capacité envoyée à un commerce apparaît dans les livraisons reçues', async () => {
    const clock = new FakeClock();
    const game = await makeServer(new MemoryStore(), clock);
    const alice = connectClient(game);
    await alice.send({ t: 'auth', devName: 'Alice' });
    await alice.send({ t: 'createLobby', name: 'Test', isPublic: false, maxPlayers: 4 });
    expect((await alice.send({ t: 'claimCity', cityId: PARIS })).ok).toBe(true);
    const cmd = (c: object) => alice.send({ t: 'command', cityId: PARIS, cmd: c });
    expect((await cmd({ type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 400, y2: 1000 })).ok).toBe(true);
    expect((await cmd({ type: 'build', building: 'factory', x: 60, y: 975, rotation: 0 })).ok).toBe(true);
    expect((await cmd({ type: 'build', building: 'shop', x: 200, y: 985, rotation: 0 })).ok).toBe(true);
    for (const x of [20, 55, 90, 125]) expect((await cmd({ type: 'build', building: 'apartment', x, y: 1022, rotation: 0 })).ok).toBe(true);
    clock.t += TICK_MS * 10;
    game.loop();
    const city = alice.last('city')!.city;
    const factory = city.buildings.find((b) => b.type === 'factory')!;
    const shop = city.buildings.find((b) => b.type === 'shop')!;
    const sent = await cmd({ type: 'assignSupply', factoryId: factory.id, shopId: shop.id, qty: 100 });
    expect(sent.ok, sent.ok ? '' : sent.error).toBe(true);
    clock.t += TICK_MS * 10;
    game.loop();
    const layers = alice.last('layers')?.layers ?? alice.last('city')?.layers;
    const received = (layers?.supply ?? []).filter((l) => l.to === shop.id);
    console.log('livraisons reçues', JSON.stringify(received), 'demande', layers?.economy?.[shop.id]?.demand, 'ventes', layers?.economy?.[shop.id]?.sold);
    expect(received.reduce((s, l) => s + l.qty, 0)).toBeGreaterThan(0);
  });
});
