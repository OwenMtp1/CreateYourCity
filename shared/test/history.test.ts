import { describe, expect, it } from 'vitest';
import { applyCityCommand, cityAt, createCityState, skylineOf, summarizeCity, type CityState } from '../src/index.ts';

function city(): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  return c;
}
const run = (c: CityState, cmd: Parameters<typeof applyCityCommand>[1]) => {
  const r = applyCityCommand(c, cmd);
  if (!r.ok) throw new Error(r.reason);
};

describe('vue historique', () => {
  it('reconstitue les bâtiments d’un instant passé, démolis compris', () => {
    const c = city();
    run(c, { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 200, y2: 1000 });
    c.tick = 100;
    run(c, { type: 'build', building: 'apartment', x: 60, y: 1022, rotation: 0 });
    const id = c.buildings[0]!.id;
    c.tick = 200;
    run(c, { type: 'demolish', target: 'building', id });
    c.tick = 300;
    run(c, { type: 'build', building: 'house', x: 120, y: 1022, rotation: 0 });

    expect(cityAt(c, 50).buildings).toHaveLength(0);
    expect(cityAt(c, 150).buildings.map((b) => b.type)).toEqual(['apartment']);
    expect(cityAt(c, 250).buildings).toHaveLength(0);
    expect(cityAt(c, 350).buildings.map((b) => b.type)).toEqual(['house']);
    expect(cityAt(c, 50).roads).toHaveLength(1);
    expect(cityAt(c, 150).roads).toHaveLength(1);
  });

  it('la vue historique ne modifie pas la ville réelle', () => {
    const c = city();
    run(c, { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 200, y2: 1000 });
    const before = c.buildings.length;
    cityAt(c, 0);
    expect(c.buildings.length).toBe(before);
    expect(c.layoutVersion).toBeGreaterThanOrEqual(0);
  });

  it('la silhouette suit l’emplacement des logements et des emplois', () => {
    const c = city();
    run(c, { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 200, y2: 1000 });
    run(c, { type: 'build', building: 'apartment', x: 60, y: 1022, rotation: 0 });
    const sky = skylineOf(c.buildings);
    expect(sky).toHaveLength(16);
    expect(Math.max(...sky)).toBe(1);
    expect(sky[0]).toBe(1);
    expect(summarizeCity(c).skyline).toEqual(sky);
  });
});
