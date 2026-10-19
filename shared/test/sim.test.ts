import { describe, expect, it } from 'vitest';
import { analyzeLayout, applyCityCommand, generateTerrain, simulateTick, simulateTicks, TICKS_PER_DAY, type CityState } from '../src/index.ts';
import { newCity, withMainRoad } from './helpers.ts';

function build(city: CityState, building: Parameters<typeof applyCityCommand>[1] & { type: 'build' }) {
  const r = applyCityCommand(city, building);
  if (!r.ok) throw new Error(`${building.building} @${building.x},${building.y}: ${r.reason}`);
}

/** Quartier type : logements au nord de la rue, emplois et services au sud. */
function smallTown(): CityState {
  const city = withMainRoad(newCity());
  city.treasury = 2_000_000;
  for (let i = 0; i < 8; i++) build(city, { type: 'build', building: 'apartment', x: 60 + i * 35, y: 1022, rotation: 0 });
  build(city, { type: 'build', building: 'office', x: 60, y: 978, rotation: 0 });
  build(city, { type: 'build', building: 'office', x: 95, y: 978, rotation: 0 });
  build(city, { type: 'build', building: 'shop', x: 130, y: 983, rotation: 0 });
  build(city, { type: 'build', building: 'clinic', x: 170, y: 978, rotation: 0 });
  build(city, { type: 'build', building: 'school', x: 215, y: 978, rotation: 0 });
  build(city, { type: 'build', building: 'police', x: 260, y: 980, rotation: 0 });
  return city;
}

describe('analyse de l’agencement', () => {
  it('distingue bâtiments raccordés, isolés et sans route', () => {
    const city = withMainRoad(newCity());
    // Route isolée (non reliée à l'accès régional).
    expect(applyCityCommand(city, { type: 'buildRoad', road: 'street', x1: 1000, y1: 300, x2: 1200, y2: 300 }).ok).toBe(true);
    build(city, { type: 'build', building: 'house', x: 100, y: 1020, rotation: 0 });
    build(city, { type: 'build', building: 'house', x: 1100, y: 320, rotation: 0 });
    const layout = analyzeLayout(city);
    const [connected, isolated] = city.buildings;
    expect(layout.status.get(connected!.id)).toBe('ok');
    expect(layout.status.get(isolated!.id)).toBe('disconnected');
    expect(layout.roadConnected.get(city.roads[0]!.id)).toBe(true);
    expect(layout.roadConnected.get(city.roads[1]!.id)).toBe(false);
  });
});

describe('simulation', () => {
  it('une ville sans logement reste sans habitants et paie l’entretien', () => {
    const city = withMainRoad(newCity());
    const before = city.treasury;
    simulateTicks(city, TICKS_PER_DAY);
    expect(city.population).toBe(0);
    expect(city.treasury).toBeLessThan(before);
    expect(city.tick).toBe(TICKS_PER_DAY);
  });

  it('la population s’installe, travaille et paie des impôts', () => {
    const city = smallTown();
    simulateTicks(city, TICKS_PER_DAY * 10);
    const s = city.stats!;
    expect(city.population).toBeGreaterThan(300);
    expect(city.population).toBeLessThanOrEqual(s.housingCapacity);
    expect(s.employed).toBeGreaterThan(0);
    expect(s.budget.residentialTax).toBeGreaterThan(0);
    expect(s.services.health.coverage).toBeGreaterThan(0.9);
    expect(s.power.importedMW).toBeCloseTo(s.power.demandMW);
  });

  it('les emplois et les services augmentent l’attractivité', () => {
    const housingOnly = withMainRoad(newCity());
    housingOnly.treasury = 2_000_000;
    for (let i = 0; i < 8; i++) build(housingOnly, { type: 'build', building: 'apartment', x: 60 + i * 35, y: 1022, rotation: 0 });
    const town = smallTown();
    simulateTicks(housingOnly, TICKS_PER_DAY * 10);
    simulateTicks(town, TICKS_PER_DAY * 10);
    expect(town.population).toBeGreaterThan(housingOnly.population);
    expect(town.stats!.attractiveness).toBeGreaterThan(housingOnly.stats!.attractiveness);
  });

  it('les habitants quittent un logement démoli', () => {
    const city = smallTown();
    simulateTicks(city, TICKS_PER_DAY * 5);
    for (const b of city.buildings.filter((x) => x.type === 'apartment')) {
      applyCityCommand(city, { type: 'demolish', target: 'building', id: b.id });
    }
    simulateTick(city);
    expect(city.population).toBe(0);
  });

  it('est déterministe', () => {
    const a = smallTown();
    const b = smallTown();
    simulateTicks(a, 500);
    simulateTicks(b, 500);
    expect(a).toEqual(b);
  });

  it('un rattrapage en un bloc équivaut à des ticks successifs', () => {
    const a = smallTown();
    const b = smallTown();
    simulateTicks(a, 300);
    for (let i = 0; i < 3; i++) simulateTicks(b, 100);
    expect(a.population).toBe(b.population);
    expect(a.treasury).toBe(b.treasury);
  });

  it('une centrale réduit les importations d’électricité', () => {
    const city = smallTown();
    build(city, { type: 'build', building: 'power_plant', x: 600, y: 970, rotation: 0 });
    simulateTicks(city, TICKS_PER_DAY * 5);
    expect(city.stats!.power.localMW).toBeGreaterThan(0);
    expect(city.stats!.power.importedMW).toBeLessThan(city.stats!.power.demandMW);
  });

  it('le terrain est déterministe par ville', () => {
    expect(generateTerrain('abc').cells).toEqual(generateTerrain('abc').cells);
  });

  it('reste performant (200 bâtiments, 1 jour de jeu)', () => {
    const city = withMainRoad(newCity());
    city.treasury = 1e9;
    for (let row = 0; row < 4; row++) {
      const y = 1100 + row * 120;
      expect(applyCityCommand(city, { type: 'buildRoad', road: 'street', x1: 200 + row * 3, y1: 1000, x2: 200 + row * 3, y2: 1000 }).ok).toBe(false);
      applyCityCommand(city, { type: 'buildRoad', road: 'street', x1: 30, y1: 1000, x2: 30, y2: y });
      applyCityCommand(city, { type: 'buildRoad', road: 'street', x1: 30, y1: y, x2: 680, y2: y });
      for (let i = 0; i < 25; i++) {
        applyCityCommand(city, { type: 'build', building: 'house', x: 60 + i * 25, y: y + 20, rotation: 0 });
        applyCityCommand(city, { type: 'build', building: i % 5 === 0 ? 'office' : 'house', x: 60 + i * 25, y: y - 22, rotation: 0 });
      }
    }
    expect(city.buildings.length).toBeGreaterThan(150);
    const t0 = performance.now();
    simulateTicks(city, TICKS_PER_DAY);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
