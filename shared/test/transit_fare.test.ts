import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, simulateTick, TRANSIT, type CityCommand, type CityState } from '../src/index.ts';

function city(fare?: number): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  const cmds: CityCommand[] = [
    { type: 'buildRoad', road: 'avenue', x1: 0, y1: 1000, x2: 600, y2: 1000 },
    { type: 'build', building: 'apartment', x: 60, y: 1036, rotation: 0 },
    { type: 'build', building: 'apartment', x: 120, y: 1036, rotation: 0 },
    { type: 'build', building: 'apartment', x: 180, y: 1036, rotation: 0 },
    { type: 'build', building: 'office', x: 420, y: 975, rotation: 0 },
    { type: 'build', building: 'office', x: 520, y: 975, rotation: 0 },
    { type: 'build', building: 'bus_station', x: 240, y: 975, rotation: 0 },
    { type: 'build', building: 'bus_station', x: 360, y: 975, rotation: 0 },
  ];
  for (const cmd of cmds) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  if (fare !== undefined) {
    const r = applyCityCommand(c, { type: 'setTransitFare', mode: 'bus', fee: fare });
    if (!r.ok) throw new Error(r.reason);
  }
  c.population = 400;
  simulateTick(c);
  simulateTick(c);
  return c;
}

describe('tarif des lignes de bus', () => {
  it('un tarif élevé renvoie des voyageurs en voiture, un tarif nul en attire', () => {
    const base = city().stats!.transit.riders;
    const dear = city(TRANSIT.maxFare).stats!.transit.riders;
    const free = city(0).stats!.transit.riders;
    expect(base).toBeGreaterThan(0);
    expect(dear).toBeLessThan(base);
    expect(free).toBeGreaterThan(base);
  });

  it('le tarif est borné et le tarif de base n’est pas stocké', () => {
    const c = city();
    expect(applyCityCommand(c, { type: 'setTransitFare', mode: 'bus', fee: TRANSIT.maxFare + 1 }).ok).toBe(false);
    expect(applyCityCommand(c, { type: 'setTransitFare', mode: 'bus', fee: TRANSIT.farePerRide }).ok).toBe(true);
    expect(c.transitFares?.bus).toBeUndefined();
  });
});
