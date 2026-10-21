import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, getLayout, type CityCommand, type CityState } from '../src/index.ts';

function city(steps: CityCommand[]): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  for (const s of steps) {
    const r = applyCityCommand(c, s);
    if (!r.ok) throw new Error(r.reason);
  }
  return c;
}

describe('raccordement automatique des routes', () => {
  it('une route qui touche un bâtiment isolé et s’approche du réseau s’y raccorde', () => {
    const c = city([
      { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 240, y2: 1000 },
      { type: 'buildRoad', road: 'street', x1: 300, y1: 1000, x2: 360, y2: 1000 },
      { type: 'build', building: 'apartment', x: 330, y: 1022, rotation: 0 },
      { type: 'buildRoad', road: 'street', x1: 300, y1: 1000, x2: 250, y2: 1000 },
    ]);
    const layout = getLayout(c);
    expect(layout.status.get(c.buildings[0]!.id)).toBe('ok');
  });

  it('une route trop éloignée du réseau reste isolée', () => {
    const c = city([
      { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 240, y2: 1000 },
      { type: 'buildRoad', road: 'street', x1: 300, y1: 1000, x2: 360, y2: 1000 },
      { type: 'build', building: 'apartment', x: 330, y: 1022, rotation: 0 },
    ]);
    expect(getLayout(c).status.get(c.buildings[0]!.id)).toBe('disconnected');
  });

  it("l'extrémité collée au portique s'y accroche", () => {
    const c = city([{ type: 'buildRoad', road: 'street', x1: 8, y1: 1005, x2: 200, y2: 1005 }]);
    expect(c.roads[0]).toMatchObject({ x1: 0, y1: 1000 });
  });

  it('une route posée à partir de l’extrémité raccordée reste connectée au réseau', () => {
    const c = city([
      { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 200, y2: 1000 },
      // Extrémité à 8 m du réseau : elle s'y greffe.
      { type: 'buildRoad', road: 'street', x1: 200, y1: 1100, x2: 208, y2: 1000 + 8 },
      { type: 'buildRoad', road: 'street', x1: 208, y1: 1008, x2: 300, y2: 1008 },
    ]);
    const layout = getLayout(c);
    expect(c.roads.every((r) => layout.roadConnected.get(r.id))).toBe(true);
  });
});
