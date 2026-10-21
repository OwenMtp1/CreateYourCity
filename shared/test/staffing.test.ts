import { describe, expect, it } from 'vitest';
import { applyCityCommand, assignWorkers, createCityState, sectorOf, simulateTick, type CityState } from '../src/index.ts';

describe('répartition des actifs', () => {
  it('sans affectation, les postes se remplissent proportionnellement aux vacances', () => {
    const r = assignWorkers([{ id: 1, jobs: 10 }, { id: 2, jobs: 30 }], 20, undefined);
    expect([...r.employed.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(20, 5);
    expect(r.staffing.get(1)).toBeCloseTo(0.5, 5);
    expect(r.staffing.get(2)).toBeCloseTo(0.5, 5);
  });

  it('un effectif fixé à la main tient ; le reste remplit les autres postes', () => {
    const r = assignWorkers([{ id: 1, jobs: 10 }, { id: 2, jobs: 30 }], 20, { 1: 10 });
    expect(r.employed.get(1)).toBeCloseTo(10, 5);
    expect(r.employed.get(2)).toBeCloseTo(10, 5);
    expect(r.staffing.get(1)).toBeCloseTo(1, 5);
  });

  it('sans assez d’actifs, les affectations manuelles sont réduites au prorata', () => {
    const r = assignWorkers([{ id: 1, jobs: 10 }, { id: 2, jobs: 10 }], 5, { 1: 10, 2: 10 });
    expect([...r.employed.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(5, 5);
  });

  it('les secteurs regroupent les bâtiments d’emploi comparables', () => {
    expect(sectorOf('factory')).toBe('industrie');
    expect(sectorOf('shop')).toBe('commerce');
    expect(sectorOf('office')).toBe('bureaux');
    expect(sectorOf('clinic')).toBe('services');
  });
});

describe('déplacement des actifs entre sites', () => {
  function city(): CityState {
    const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
    c.treasury = 1e9;
    const cmd = (x: Parameters<typeof applyCityCommand>[1]) => {
      const r = applyCityCommand(c, x);
      if (!r.ok) throw new Error(r.reason);
    };
    cmd({ type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 300, y2: 1000 });
    cmd({ type: 'build', building: 'factory', x: 60, y: 975, rotation: 0 });
    cmd({ type: 'build', building: 'factory', x: 160, y: 975, rotation: 0 });
    cmd({ type: 'build', building: 'shop', x: 240, y: 985, rotation: 0 });
    for (let i = 0; i < 4; i++) cmd({ type: 'build', building: 'apartment', x: 20 + i * 35, y: 1022, rotation: 0 });
    c.population = 60;
    simulateTick(c);
    return c;
  }
  const ids = (c: CityState) => c.buildings.filter((b) => b.type === 'factory').map((b) => b.id);

  it('déplace des actifs d’un site à un autre du même secteur, sans changer le total', () => {
    const c = city();
    const [a, b] = ids(c) as [number, number];
    const before = c.stats!.siteWorkers!;
    const r = applyCityCommand(c, { type: 'moveWorkers', fromId: a, toId: b, count: 1 });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    expect((c.assignments![a] ?? 0) + (c.assignments![b] ?? 0)).toBeCloseTo((before[a] ?? 0) + (before[b] ?? 0), 5);
    expect(c.assignments![b]).toBeCloseTo((before[b] ?? 0) + 1, 5);
    simulateTick(c);
    expect(c.stats!.siteWorkers![b]!).toBeGreaterThan((before[b] ?? 0) - 1);
  });

  it('refuse un déplacement entre secteurs différents', () => {
    const c = city();
    const [a] = ids(c) as [number];
    const shop = c.buildings.find((x) => x.type === 'shop')!;
    expect(applyCityCommand(c, { type: 'moveWorkers', fromId: a, toId: shop.id, count: 1 }).ok).toBe(false);
  });

  it('refuse de déplacer plus d’actifs qu’il n’en travaille, ou de dépasser les postes libres', () => {
    const c = city();
    const [a, b] = ids(c) as [number, number];
    expect(applyCityCommand(c, { type: 'moveWorkers', fromId: a, toId: b, count: 100_000 }).ok).toBe(false);
  });

  it('la réinitialisation rend la répartition automatique', () => {
    const c = city();
    const [a, b] = ids(c) as [number, number];
    applyCityCommand(c, { type: 'moveWorkers', fromId: a, toId: b, count: 0.5 < (c.stats!.siteWorkers![a] ?? 0) ? 1 : 0 });
    expect(applyCityCommand(c, { type: 'resetAssignments' }).ok).toBe(true);
    expect(c.assignments).toBeUndefined();
  });
});
