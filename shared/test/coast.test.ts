import { describe, expect, it } from 'vitest';
import { REGIONAL_ACCESS } from '../src/constants.ts';
import { generateTerrain, seaBand, terrainAt, TerrainKind } from '../src/terrain.ts';
import { WORLD_CITIES } from '../src/world.ts';

const FRANCE = WORLD_CITIES.find((c) => c.name === 'Paris')!.countryId;
const city = (name: string) => WORLD_CITIES.find((c) => c.name === name && c.countryId === FRANCE)!;

/** Part d'eau dans une bande de 300 m le long d'un bord de la carte. */
function waterShare(cityId: string, side: 'n' | 's' | 'e' | 'w'): number {
  const t = generateTerrain(cityId);
  let wet = 0, all = 0;
  for (let a = 10; a < 2000; a += 20) for (let b = 10; b < 300; b += 20) {
    const [x, y] = side === 'w' ? [b, a] : side === 'e' ? [2000 - b, a] : side === 'n' ? [a, b] : [a, 2000 - b];
    if (terrainAt(t, x, y) === TerrainKind.Water) wet++;
    all++;
  }
  return wet / all;
}

describe('villes côtières', () => {
  it('les données géographiques situent la mer du bon côté', () => {
    expect(city('Paris').coast).toBeUndefined();
    expect(city('Lyon').coast).toBeUndefined();
    const toulon = city('Toulon').coast!;
    expect(Math.abs(toulon.dir - 180)).toBeLessThan(40);
    const marseille = city('Marseille').coast!;
    expect(marseille.dir).toBeGreaterThan(200);
    expect(marseille.dir).toBeLessThan(290);
    expect(WORLD_CITIES.filter((c) => c.coast).length).toBeGreaterThan(1000);
  });

  it('une bande de mer borde la carte du côté de la mer réelle', () => {
    const toulon = city('Toulon').id;
    expect(seaBand(toulon)).not.toBeNull();
    expect(waterShare(toulon, 's')).toBeGreaterThan(0.6);
    expect(waterShare(toulon, 'n')).toBeLessThan(0.3);
    expect(seaBand(city('Paris').id)).toBeNull();
  });

  it("la mer n'occupe qu'une petite partie de la carte, quelle que soit son orientation", () => {
    for (const c of WORLD_CITIES.filter((x) => x.coast).slice(0, 80)) {
      const band = seaBand(c.id)!;
      let wet = 0;
      for (let y = 10; y < 2000; y += 20) for (let x = 10; x < 2000; x += 20) if (band.contains(x, y)) wet++;
      expect(wet / 10_000).toBeLessThan(0.3);
      expect(wet / 10_000).toBeGreaterThan(0.05);
    }
  });

  it("l'accès régional et sa route restent sur la terre ferme, même face à la mer", () => {
    const west = WORLD_CITIES.filter((c) => c.coast && Math.abs(c.coast.dir - 270) < 20 && c.coast.dist < 2).slice(0, 20);
    expect(west.length).toBeGreaterThan(5);
    for (const c of west) {
      const t = generateTerrain(c.id);
      expect(waterShare(c.id, 'w')).toBeGreaterThan(0.5);
      // La digue traverse la mer : au plus une rivière à franchir sur l'axe de la route nationale.
      let wet = 0;
      for (let x = 0; x < 600; x += 5) if (terrainAt(t, x, REGIONAL_ACCESS.y) === TerrainKind.Water) wet += 5;
      expect(wet).toBeLessThan(150);
    }
  });
});
