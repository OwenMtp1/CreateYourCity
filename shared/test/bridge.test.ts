import { describe, expect, it } from 'vitest';
import {
  analyzeLayout, applyCityCommand, createCityState, generateTerrain, ROAD_JOIN_TOLERANCE, ROADS, roadTerrain, segmentDistance, terrainAt,
  TerrainKind, validateRoad, type CityState,
} from '../src/index.ts';

/** Ville de test avec, sur une ligne horizontale, de la terre, puis de l'eau (≥ 60 m), puis de la terre. */
function riverCity(): { city: CityState; y: number; x1: number; x2: number } {
  for (let i = 0; i < 2000; i++) {
    const id = `river-${i}`;
    const t = generateTerrain(id);
    for (let y = 300; y <= 1700; y += 50) {
      let x = 100;
      while (x < 1800 && terrainAt(t, x, y) !== TerrainKind.Water) x += 5;
      if (x >= 1800 || terrainAt(t, x - 40, y) !== TerrainKind.Land) continue;
      let end = x;
      while (end < 1900 && terrainAt(t, end, y) === TerrainKind.Water) end += 5;
      if (end - x < 60 || end > 1850 || terrainAt(t, end + 40, y) !== TerrainKind.Land) continue;
      const city = createCityState({ cityId: id, countryId: 'N250', ownerId: 'p1', ownerName: 'Alice', tick: 0 });
      city.treasury = 1e9;
      return { city, y, x1: x - 40, x2: end + 40 };
    }
  }
  throw new Error('aucune ville avec rivière trouvée');
}

describe('ponts', () => {
  it("une rue ne traverse pas l'eau, un pont oui, et plus cher sur l'eau", () => {
    const { city, y, x1, x2 } = riverCity();
    const seg = { x1, y1: y, x2, y2: y };
    const street = validateRoad(city, 'street', seg);
    expect(street.ok).toBe(false);
    if (!street.ok) expect(street.reason).toMatch(/pont/);
    const bridge = validateRoad(city, 'bridge', seg);
    expect(bridge.ok).toBe(true);
    const len = x2 - x1;
    if (bridge.ok) expect(bridge.cost).toBeGreaterThan(len * ROADS.bridge.costPerMeter);
    expect(roadTerrain(generateTerrain(city.cityId), seg).bridgeLength).toBeGreaterThan(0);
  });

  it('un pont se raccorde aux rues des deux rives et dessert les bâtiments', () => {
    const { city, y, x1, x2 } = riverCity();
    const a = applyCityCommand(city, { type: 'buildRoad', road: 'bridge', x1, y1: y, x2, y2: y });
    expect(a.ok).toBe(true);
    const b = applyCityCommand(city, { type: 'buildRoad', road: 'street', x1: x2, y1: y, x2: Math.min(1990, x2 + 60), y2: y });
    expect(b.ok).toBe(true);
    const [bridgeRoad, street] = city.roads;
    expect(segmentDistance(bridgeRoad!, street!)).toBeLessThanOrEqual(ROAD_JOIN_TOLERANCE);
    // Un bâtiment au bord du pont trouve une route d'accès (il n'est pas « sans route »).
    const build = applyCityCommand(city, { type: 'build', building: 'house', x: Math.min(1980, x2 + 30), y: y + 17, rotation: 0 });
    if (build.ok) expect(analyzeLayout(city).status.get(city.buildings[0]!.id)).not.toBe('no_road');
  });
});
