import { describe, expect, it } from 'vitest';
import { applyCityCommand, createCityState, FACTORY_STOCK_DAYS, simulateTick, type CityCommand, type CityState } from '../src/index.ts';

function city(): CityState {
  const c = createCityState({ cityId: 'c1159151613', countryId: 'N250', ownerId: 'a', ownerName: 'A', tick: 0 });
  c.treasury = 1e9;
  const cmds: CityCommand[] = [
    { type: 'buildRoad', road: 'street', x1: 0, y1: 1000, x2: 400, y2: 1000 },
    { type: 'build', building: 'factory', x: 60, y: 975, rotation: 0 },
    { type: 'build', building: 'factory', x: 160, y: 975, rotation: 0 },
    { type: 'build', building: 'shop', x: 230, y: 985, rotation: 0 },
    { type: 'build', building: 'shop', x: 320, y: 985, rotation: 0 },
    ...[20, 55, 90, 125].map((x) => ({ type: 'build' as const, building: 'apartment' as const, x, y: 1022, rotation: 0 as const })),
  ];
  for (const cmd of cmds) {
    const r = applyCityCommand(c, cmd);
    if (!r.ok) throw new Error(r.reason);
  }
  c.population = 400;
  return c;
}

const factories = (c: CityState) => c.buildings.filter((b) => b.type === 'factory');
const shops = (c: CityState) => c.buildings.filter((b) => b.type === 'shop');
const run = (c: CityState, cmd: CityCommand) => applyCityCommand(c, cmd);

describe('approvisionnement des commerces par capacité', () => {
  it("par défaut, l'usine livre les commerces les plus proches et exporte le reste", () => {
    const c = city();
    const layers = simulateTick(c);
    expect(layers.economy![factories(c)[0]!.id]!.exported!).toBeGreaterThan(0);
  });

  it('une capacité envoyée à un commerce ne livre que ce commerce', () => {
    const c = city();
    const [f] = factories(c);
    const [s1] = shops(c);
    expect(run(c, { type: 'assignSupply', factoryId: f!.id, shopId: s1!.id, qty: 60 }).ok).toBe(true);
    const links = simulateTick(c).supply!.filter((l) => l.from === f!.id);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.to === s1!.id)).toBe(true);
    expect(links.reduce((sum, l) => sum + l.qty, 0)).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('une capacité au-delà de celle de l’usine est refusée', () => {
    const c = city();
    const [f] = factories(c);
    const [s1, s2] = shops(c);
    expect(run(c, { type: 'assignSupply', factoryId: f!.id, shopId: s1!.id, qty: 300 }).ok).toBe(true);
    expect(run(c, { type: 'assignSupply', factoryId: f!.id, shopId: s2!.id, qty: 200 }).ok).toBe(false);
  });

  it("un commerce déjà couvert par une usine n'accepte pas une autre usine", () => {
    const c = city();
    const [f1, f2] = factories(c);
    const [s1] = shops(c);
    simulateTick(c); // calcule la demande du commerce
    const demand = c.buildings.find((b) => b.id === s1!.id)!.demand!;
    expect(demand).toBeGreaterThan(0);
    expect(run(c, { type: 'assignSupply', factoryId: f1!.id, shopId: s1!.id, qty: demand + 10 }).ok).toBe(true);
    expect(run(c, { type: 'assignSupply', factoryId: f2!.id, shopId: s1!.id, qty: 30 }).ok).toBe(false);
  });

  it("une demande non couverte accepte une seconde usine, qui complète", () => {
    const c = city();
    const [f1, f2] = factories(c);
    const [s1] = shops(c);
    simulateTick(c);
    const demand = c.buildings.find((b) => b.id === s1!.id)!.demand!;
    expect(run(c, { type: 'assignSupply', factoryId: f1!.id, shopId: s1!.id, qty: Math.max(1, demand / 3) }).ok).toBe(true);
    expect(run(c, { type: 'assignSupply', factoryId: f2!.id, shopId: s1!.id, qty: 20 }).ok).toBe(true);
  });

  it('la répartition automatique revient après une réinitialisation', () => {
    const c = city();
    const [f] = factories(c);
    const [s1] = shops(c);
    run(c, { type: 'assignSupply', factoryId: f!.id, shopId: s1!.id, qty: 60 });
    expect(run(c, { type: 'resetSupply', factoryId: f!.id }).ok).toBe(true);
    expect(f!.supplyPlan).toBeUndefined();
  });

  it("sans export, le surplus reste en stock, plafonné à quelques jours de production", () => {
    const c = city();
    const [f] = factories(c);
    expect(run(c, { type: 'setFactoryExport', id: f!.id, exportSurplus: false }).ok).toBe(true);
    const layers = simulateTick(c);
    expect(layers.economy![f!.id]!.exported).toBe(0);
    expect(f!.stock ?? 0).toBeGreaterThan(0);
    expect(f!.stock!).toBeLessThanOrEqual(FACTORY_STOCK_DAYS * 400 + 1e-6);
  });

  it("un commerce garde sa demande même quand une usine le couvre entièrement", () => {
    const c = city();
    const [f] = factories(c);
    const [s1] = shops(c);
    const demand = simulateTick(c).economy![s1!.id]!.demand!;
    run(c, { type: 'assignSupply', factoryId: f!.id, shopId: s1!.id, qty: 400 });
    const again = simulateTick(c).economy![s1!.id]!.demand!;
    expect(Math.abs(again - demand) / demand).toBeLessThan(0.05);
  });
});
