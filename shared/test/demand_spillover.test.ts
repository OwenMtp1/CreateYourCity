import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, simulateTick, type CityCommand, type CityState } from '../src/index.ts';

function city(): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  const cmds: CityCommand[] = [
    { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 400, y2: 1000 },
    { type: 'build', building: 'factory', x: 60, y: 975, rotation: 0 },
    { type: 'build', building: 'shop', x: 230, y: 985, rotation: 0 },
    { type: 'build', building: 'shop', x: 320, y: 985, rotation: 0 },
    ...[20, 55, 90, 125].map((x) => ({ type: 'build' as const, building: 'apartment' as const, x, y: 1022, rotation: 0 as const })),
  ];
  for (const cmd of cmds) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  c.population = 400;
  return c;
}

describe('demande partagée entre commerces', () => {
  it('un commerce saturé laisse la demande au second, qui vend aussi', () => {
    const c = city();
    const [s1, s2] = c.buildings.filter((b) => b.type === 'shop');
    const layers = simulateTick(c);
    const e1 = layers.economy![s1!.id]!;
    const e2 = layers.economy![s2!.id]!;
    expect(e1.sold!).toBeGreaterThan(0);
    expect(e2.sold!).toBeGreaterThan(0);
  });
});
