import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, roundaboutPoints } from '../src/index.ts';

describe('rond-points : anneau identifié', () => {
  it('tous les tronçons d\'un rond-point partagent le même anneau, une route droite n\'en a pas', () => {
    const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
    c.treasury = 1e9;
    expect(applyCityCommand(c, { type: 'buildRoadPath', road: 'street', points: roundaboutPoints({ x: 600, y: 1000 }, 30) }).ok).toBe(true);
    const ring = c.roads.filter((r) => r.ring !== undefined);
    expect(ring.length).toBe(12);
    expect(new Set(ring.map((r) => r.ring)).size).toBe(1);
    expect(applyCityCommand(c, { type: 'buildRoadPath', road: 'street', points: [{ x: 100, y: 300 }, { x: 300, y: 300 }] }).ok).toBe(true);
    expect(c.roads.filter((r) => r.ring === undefined).length).toBeGreaterThan(0);
  });
});
