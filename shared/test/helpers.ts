import { applyCityCommand, createCityState, generateTerrain, REGIONAL_ACCESS, terrainAt, TerrainKind, type CityState } from '../src/index.ts';

/** Trouve une ville de test dont le corridor y=1000 depuis l'accès régional est sur la terre ferme. */
export function dryCityId(): string {
  for (let i = 0; i < 500; i++) {
    const id = `test-${i}`;
    const t = generateTerrain(id);
    let ok = true;
    for (let x = 0; x < 2000 && ok; x += 10) {
      for (const y of [940, 970, 1000, 1030, 1060]) if (terrainAt(t, x, y) !== TerrainKind.Land) ok = false;
    }
    if (ok) return id;
  }
  throw new Error('aucune ville sèche trouvée');
}

export function newCity(id = dryCityId()): CityState {
  return createCityState({ cityId: id, countryId: 'N250', ownerId: 'p1', ownerName: 'Alice', tick: 0 });
}

/** Avenue principale depuis l'accès régional vers l'est. */
export function withMainRoad(city: CityState): CityState {
  const r = applyCityCommand(city, { type: 'buildRoad', road: 'street', x1: REGIONAL_ACCESS.x, y1: REGIONAL_ACCESS.y, x2: 700, y2: REGIONAL_ACCESS.y });
  if (!r.ok) throw new Error(r.reason);
  return city;
}
