import { describe, expect, it } from 'vitest';
import { applyCityCommand, BUILDINGS, MAX_DEBT, STARTING_TREASURY, validateBuilding } from '../src/index.ts';
import { newCity, withMainRoad } from './helpers.ts';

describe('construction', () => {
  it('une nouvelle ville est vide', () => {
    const city = newCity();
    expect(city.buildings).toHaveLength(0);
    expect(city.roads).toHaveLength(0);
    expect(city.treasury).toBe(STARTING_TREASURY);
  });

  it('exige une route à proximité', () => {
    const city = newCity();
    const v = validateBuilding(city, 'house', 100, 100, 0);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/route/);
  });

  it('construit une route puis une maison et débite le coût', () => {
    const city = withMainRoad(newCity());
    const afterRoad = city.treasury;
    expect(afterRoad).toBeLessThan(STARTING_TREASURY);
    const r = applyCityCommand(city, { type: 'build', building: 'house', x: 100, y: 1000 + 5 + 10 + 2, rotation: 0 });
    expect(r).toEqual({ ok: true, cost: BUILDINGS.house.cost });
    expect(city.treasury).toBe(afterRoad - BUILDINGS.house.cost);
    expect(city.buildings).toHaveLength(1);
  });

  it('refuse les chevauchements et les routes à travers un bâtiment', () => {
    const city = withMainRoad(newCity());
    expect(applyCityCommand(city, { type: 'build', building: 'house', x: 100, y: 1020, rotation: 0 }).ok).toBe(true);
    expect(applyCityCommand(city, { type: 'build', building: 'house', x: 110, y: 1020, rotation: 0 }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'build', building: 'house', x: 100, y: 1000, rotation: 0 }).ok).toBe(false);
    const road = applyCityCommand(city, { type: 'buildRoad', road: 'street', x1: 100, y1: 1100, x2: 100, y2: 1000 });
    expect(road.ok).toBe(false);
  });

  it('refuse une construction trop chère', () => {
    const city = withMainRoad(newCity());
    city.treasury = 1000;
    const r = applyCityCommand(city, { type: 'build', building: 'factory', x: 200, y: 1035, rotation: 0 });
    expect(r.ok).toBe(false);
    expect(city.buildings).toHaveLength(0);
    expect(city.treasury).toBe(1000);
  });

  it('gère emprunts, remboursements et impôts', () => {
    const city = newCity();
    expect(applyCityCommand(city, { type: 'borrow', amount: 100_000 }).ok).toBe(true);
    expect(city.debt).toBe(100_000);
    expect(applyCityCommand(city, { type: 'borrow', amount: MAX_DEBT }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'repay', amount: 200_000 }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'repay', amount: 40_000 }).ok).toBe(true);
    expect(city.debt).toBe(60_000);
    expect(applyCityCommand(city, { type: 'setTaxes', taxes: { residential: 0.5, commercial: 0.1, industrial: 0.1 } }).ok).toBe(false);
    expect(applyCityCommand(city, { type: 'setTaxes', taxes: { residential: 0.15, commercial: 0.1, industrial: 0.05 } }).ok).toBe(true);
  });

  it('démolit un élément', () => {
    const city = withMainRoad(newCity());
    const id = city.roads[0]!.id;
    expect(applyCityCommand(city, { type: 'demolish', target: 'road', id }).ok).toBe(true);
    expect(city.roads).toHaveLength(0);
    expect(applyCityCommand(city, { type: 'demolish', target: 'road', id }).ok).toBe(false);
  });
});
