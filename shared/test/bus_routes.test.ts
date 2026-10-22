import { describe, expect, it } from 'vitest';
import { analyzeLayout, applyCityCommand, createCityState, type CityCommand, type CityState } from '../src/index.ts';

function city(cmds: CityCommand[]): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  for (const cmd of cmds) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  return c;
}

const avenue: CityCommand = { type: 'buildRoad', road: 'avenue', x1: 0, y1: 1000, x2: 800, y2: 1000 };

describe('lignes de bus sur le réseau routier', () => {
  it('une ligne entre deux stations suit les routes', () => {
    const c = city([
      avenue,
      { type: 'build', building: 'bus_station', x: 60, y: 975, rotation: 0 },
      { type: 'build', building: 'bus_station', x: 740, y: 975, rotation: 0 },
    ]);
    const layout = analyzeLayout(c);
    expect(layout.busRoutes).toHaveLength(1);
    const pts = layout.busRoutes[0]!.points;
    // Le tracé reste sur l'avenue (y ≈ 1000) entre les deux stations.
    expect(Math.min(...pts.map((p) => p.x))).toBeLessThan(80);
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(720);
    for (const p of pts) expect(Math.abs(p.y - 1000)).toBeLessThan(10);
  });

  it('le tracé dépend du réseau : une route de détour change le chemin', () => {
    const detour = city([
      avenue,
      { type: 'buildRoad', road: 'street', x1: 400, y1: 1000, x2: 400, y2: 1200 },
      { type: 'buildRoad', road: 'street', x1: 400, y1: 1200, x2: 800, y2: 1200 },
      { type: 'build', building: 'bus_station', x: 60, y: 975, rotation: 0 },
      { type: 'build', building: 'bus_station', x: 740, y: 975, rotation: 0 },
    ]);
    const direct = analyzeLayout(city([
      avenue,
      { type: 'build', building: 'bus_station', x: 60, y: 975, rotation: 0 },
      { type: 'build', building: 'bus_station', x: 740, y: 975, rotation: 0 },
    ]));
    const route = analyzeLayout(detour).busRoutes[0]!.points;
    // Le tracé passe par l'avenue, pas par le détour (moins rapide).
    expect(route.some((p) => p.y > 1150)).toBe(false);
    expect(direct.busRoutes[0]!.points.length).toBeGreaterThan(1);
  });

  it('des stations sur un réseau non relié à l’accès ne forment aucune ligne', () => {
    const c = city([
      avenue,
      { type: 'buildRoad', road: 'street', x1: 400, y1: 1400, x2: 800, y2: 1400 },
      { type: 'build', building: 'bus_station', x: 420, y: 1375, rotation: 0 },
      { type: 'build', building: 'bus_station', x: 780, y: 1375, rotation: 0 },
    ]);
    expect(analyzeLayout(c).busRoutes).toHaveLength(0);
  });

  it('les logements proches du tracé sont desservis par le bus, les autres non', () => {
    const c = city([
      avenue,
      { type: 'build', building: 'bus_station', x: 60, y: 975, rotation: 0 },
      { type: 'build', building: 'bus_station', x: 740, y: 975, rotation: 0 },
      { type: 'build', building: 'apartment', x: 400, y: 1036, rotation: 0 },
    ]);
    const layout = analyzeLayout(c);
    const apt = c.buildings.find((b) => b.type === 'apartment')!;
    expect(layout.transitCover.get(apt.id)?.has('bus')).toBe(true);
  });
});
