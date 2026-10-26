import { describe, expect, it } from 'vitest';
import { applyCityCommand, BUILDINGS, createCityState, simulateTick, type CityCommand, type CityState } from '../src/index.ts';

function town(): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  const cmds: CityCommand[] = [
    { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 400, y2: 1000 },
    ...[20, 55, 90, 125].map((x) => ({ type: 'build' as const, building: 'apartment' as const, x, y: 1022, rotation: 0 as const })),
    { type: 'build', building: 'office', x: 200, y: 975, rotation: 0 },
    { type: 'build', building: 'casino', x: 280, y: 975, rotation: 0 },
    { type: 'build', building: 'cinema', x: 340, y: 978, rotation: 0 },
  ];
  for (const cmd of cmds) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  c.population = 400;
  return c;
}

describe('casino, hôtel et cinéma', () => {
  it('sont définis comme des bâtiments commerciaux avec leurs effets', () => {
    expect(BUILDINGS.casino.revenuePerWorker).toBeGreaterThan(0);
    expect(BUILDINGS.casino.pollution).toBeDefined();
    expect(BUILDINGS.hotel.pricing).toBeDefined();
    expect(BUILDINGS.hotel.housing).toBe(0);
    expect(BUILDINGS.cinema.service?.kind).toBe('leisure');
    expect(BUILDINGS.cinema.pricing).toBeDefined();
  });

  it('un casino et un cinéma en activité génèrent un chiffre d\'affaires', () => {
    const c = town();
    const layers = simulateTick(c);
    const casino = c.buildings.find((b) => b.type === 'casino')!;
    const cinema = c.buildings.find((b) => b.type === 'cinema')!;
    expect(layers.economy![casino.id]!.revenue).toBeGreaterThan(0);
    expect(layers.economy![cinema.id]!.revenue).toBeGreaterThan(0);
  });

  it('le prix d\'une place se règle dans des bornes, et une place plus chère fait fuir des spectateurs', () => {
    const c = town();
    const cinema = c.buildings.find((b) => b.type === 'cinema')!;
    expect(applyCityCommand(c, { type: 'setPrice', id: cinema.id, price: 1 }).ok).toBe(false);
    expect(applyCityCommand(c, { type: 'setPrice', id: cinema.id, price: 20 }).ok).toBe(true);
    const high = simulateTick(c).economy![cinema.id]!;
    cinema.price = 11;
    const base = simulateTick(c).economy![cinema.id]!;
    expect(base.visitors!).toBeGreaterThan(high.visitors!);
  });
});
