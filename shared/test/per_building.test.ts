import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, simulateTick, type CityCommand, type CityState } from '../src/index.ts';

function city(): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  const cmds: CityCommand[] = [
    { type: 'buildRoad', road: 'avenue', x1: 0, y1: 1000, x2: 600, y2: 1000 },
    { type: 'build', building: 'factory', x: 60, y: 966, rotation: 0 },
    { type: 'build', building: 'shop', x: 200, y: 975, rotation: 0 },
    { type: 'build', building: 'bus_station', x: 240, y: 975, rotation: 0 },
    { type: 'build', building: 'bus_station', x: 360, y: 975, rotation: 0 },
    { type: 'build', building: 'parking', x: 480, y: 965, rotation: 0 },
    { type: 'build', building: 'clinic', x: 420, y: 968, rotation: 0 },
    ...[20, 55, 90, 125].map((x) => ({ type: 'build' as const, building: 'apartment' as const, x, y: 1036, rotation: 0 as const })),
  ];
  for (const cmd of cmds) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  c.population = 400;
  return c;
}

describe('chiffres propres à chaque bâtiment', () => {
  it('les voyageurs se répartissent entre les stations et totalisent ceux de la ville', () => {
    const c = city();
    const layers = simulateTick(c);
    const stations = c.buildings.filter((b) => b.type === 'bus_station');
    const sum = stations.reduce((s, b) => s + (layers.details[b.id]?.riders ?? 0), 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeCloseTo(c.stats!.transit.riders, 3);
  });

  it('chaque usine, commerce, service et station a sa capacité effective', () => {
    const c = city();
    const layers = simulateTick(c);
    for (const b of c.buildings.filter((x) => ['factory', 'shop', 'clinic', 'bus_station'].includes(x.type))) {
      expect(layers.details[b.id]?.capacity, `capacité de ${b.type} #${b.id}`).toBeGreaterThan(0);
    }
  });

  it('un parking a ses propres recettes', () => {
    const c = city();
    const layers = simulateTick(c);
    const lot = c.buildings.find((b) => b.type === 'parking')!;
    expect(layers.details[lot.id]?.revenue).toBeDefined();
  });
});
