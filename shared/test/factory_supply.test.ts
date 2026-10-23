import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, FACTORY_STOCK_DAYS, simulateTick, type CityCommand, type CityState } from '../src/index.ts';

function city(extra: CityCommand[] = []): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  const cmds: CityCommand[] = [
    { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 400, y2: 1000 },
    { type: 'build', building: 'factory', x: 60, y: 975, rotation: 0 },
    { type: 'build', building: 'shop', x: 200, y: 985, rotation: 0 },
    { type: 'build', building: 'shop', x: 300, y: 985, rotation: 0 },
    ...[20, 55, 90, 125].map((x) => ({ type: 'build' as const, building: 'apartment' as const, x, y: 1022, rotation: 0 as const })),
    ...extra,
  ];
  for (const cmd of cmds) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  c.population = 400;
  return c;
}

const shops = (c: CityState) => c.buildings.filter((b) => b.type === 'shop').map((b) => b.id);
const factory = (c: CityState) => c.buildings.find((b) => b.type === 'factory')!;

describe('approvisionnement des commerces par usine', () => {
  it("par défaut, l'usine livre les commerces proches et exporte le reste", () => {
    const c = city();
    const layers = simulateTick(c);
    expect(layers.economy![factory(c).id]!.exported!).toBeGreaterThan(0);
  });

  it('seuls les commerces choisis sont approvisionnés', () => {
    const c = city();
    const [first] = shops(c);
    expect(applyCityCommand(c, { type: 'setFactorySupply', id: factory(c).id, shops: [first!], exportSurplus: true }).ok).toBe(true);
    const layers = simulateTick(c);
    const links = layers.supply!.filter((l) => l.from === factory(c).id);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.to === first)).toBe(true);
  });

  it("sans export, le surplus reste en stock, plafonné à quelques jours de production", () => {
    const c = city();
    expect(applyCityCommand(c, { type: 'setFactorySupply', id: factory(c).id, shops: [], exportSurplus: false }).ok).toBe(true);
    const layers = simulateTick(c);
    expect(layers.economy![factory(c).id]!.exported).toBe(0);
    const stock = factory(c).stock ?? 0;
    expect(stock).toBeGreaterThan(0);
    expect(stock).toBeLessThanOrEqual(FACTORY_STOCK_DAYS * 400 + 1e-6);
    simulateTick(c);
    expect(factory(c).stock!).toBeGreaterThanOrEqual(stock - 1e-6);
  });

  it('refuse un commerce absent de la ville', () => {
    const c = city();
    expect(applyCityCommand(c, { type: 'setFactorySupply', id: factory(c).id, shops: [999999], exportSurplus: true }).ok).toBe(false);
  });

  it("un commerce garde sa demande affichée même quand l'usine le remplit entièrement", () => {
    const c = city();
    const layers = simulateTick(c);
    const shop = shops(c)[0]!;
    const demand = layers.economy![shop]!.demand!;
    expect(demand).toBeGreaterThan(0);
    applyCityCommand(c, { type: 'setFactorySupply', id: factory(c).id, shops: null, exportSurplus: true });
    const again = simulateTick(c);
    // La population bouge à chaque tick : on tolère quelques pourcents d'écart.
    expect(Math.abs(again.economy![shop]!.demand! - demand) / demand).toBeLessThan(0.05);
  });
});
