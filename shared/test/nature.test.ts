import { describe, expect, it } from 'vitest';
import { analyzeLayout, applyCityCommand, createCityState, daylight, type CityCommand, type CityState } from '../src/index.ts';

function city(extra: CityCommand[]): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  const base: CityCommand[] = [
    { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 300, y2: 1000 },
    { type: 'build', building: 'factory', x: 60, y: 975, rotation: 0 },
    { type: 'build', building: 'apartment', x: 200, y: 1022, rotation: 0 },
  ];
  for (const cmd of [...base, ...extra]) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  return c;
}

describe('forêt urbaine', () => {
  it('réduit la pollution des logements voisins d’une usine', () => {
    const without = city([]);
    const apt = without.buildings.find((b) => b.type === 'apartment')!;
    const polluted = analyzeLayout(without).pollution.get(apt.id) ?? 0;
    expect(polluted).toBeGreaterThan(0);

    const withForest = city([{ type: 'build', building: 'urban_forest', x: 250, y: 962, rotation: 0 }]);
    const apt2 = withForest.buildings.find((b) => b.type === 'apartment')!;
    expect(analyzeLayout(withForest).pollution.get(apt2.id) ?? 0).toBeLessThan(polluted);
  });

  it('une forêt loin des logements ne change rien', () => {
    const far = city([
      { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 0, y2: 1290 },
      { type: 'build', building: 'urban_forest', x: 40, y: 1290, rotation: 0 },
    ]);
    const near = city([]);
    const a = far.buildings.find((b) => b.type === 'apartment')!;
    const b = near.buildings.find((x) => x.type === 'apartment')!;
    expect(analyzeLayout(far).pollution.get(a.id) ?? 0).toBeCloseTo(analyzeLayout(near).pollution.get(b.id) ?? 0, 5);
  });
});

describe('centrale solaire', () => {
  it('ne produit que le jour', () => {
    expect(daylight(0)).toBeGreaterThanOrEqual(0);
    // Une valeur de tick qui tombe à 2 h du matin puis à midi.
    const night = [...Array(1440).keys()].find((t) => daylight(t) === 0 && t > 0)!;
    const noon = [...Array(1440).keys()].reduce((best, t) => (daylight(t) > daylight(best) ? t : best), 0);
    expect(daylight(night)).toBe(0);
    expect(daylight(noon)).toBeGreaterThan(0.9);
  });
});
