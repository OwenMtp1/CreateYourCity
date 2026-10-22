import { DEFAULT_TAXES, SCHEMA_VERSION, STARTING_TREASURY } from './constants.ts';
import { BUILDINGS, type BuildingType } from './catalog.ts';
import { CITY_SIZE_M } from './constants.ts';
import type { CityState, CitySummary, RemovedItem } from './types.ts';

/** Nouvelle ville : aucun bâtiment préexistant, le joueur construit tout lui-même. */
export function createCityState(params: {
  cityId: string; countryId: string; ownerId: string; ownerName: string; tick: number;
}): CityState {
  return {
    schemaVersion: SCHEMA_VERSION,
    cityId: params.cityId,
    countryId: params.countryId,
    ownerId: params.ownerId,
    ownerName: params.ownerName,
    tick: params.tick,
    claimedAtTick: params.tick,
    treasury: STARTING_TREASURY,
    debt: 0,
    population: 0,
    taxes: { ...DEFAULT_TAXES },
    buildings: [],
    roads: [],
    nextEntityId: 1,
    layoutVersion: 0,
    stats: null,
  };
}

/** Informations générales visibles par tous les joueurs du salon. */
export function summarizeCity(city: CityState): CitySummary {
  return {
    cityId: city.cityId,
    countryId: city.countryId,
    ownerId: city.ownerId,
    ownerName: city.ownerName,
    population: Math.round(city.population / 100) * 100,
    buildingCount: city.buildings.length,
    skyline: skylineOf(city.buildings),
    ...(city.independentSince !== undefined ? { independent: true } : {}),
  };
}

/** Silhouette de la ville : densité (logements + emplois) de 16 tranches d'ouest en est, normalisée. */
export function skylineOf(buildings: { x: number; type: string }[]): number[] {
  const bins = new Array<number>(16).fill(0);
  for (const b of buildings) {
    const def = BUILDINGS[b.type as BuildingType];
    if (!def) continue;
    const i = Math.min(15, Math.max(0, Math.floor((b.x / CITY_SIZE_M) * 16)));
    bins[i]! += def.housing + def.jobs;
  }
  const max = Math.max(1, ...bins);
  return bins.map((v) => Math.round((v / max) * 100) / 100);
}

/**
 * La ville telle qu'elle était à `tick` : bâtiments et routes construits avant, non démolis depuis.
 * Lecture seule : sert à la vue historique, sans toucher à l'état réel.
 */
export function cityAt(city: CityState, tick: number): CityState {
  const alive = (item: { builtAtTick: number }, removedAt: number | undefined) =>
    item.builtAtTick <= tick && (removedAt === undefined || removedAt > tick);
  const removedFor = (id: number, kind: 'building' | 'road') =>
    city.removed?.find((r) => r.kind === kind && r.item.id === id)?.removedAtTick;
  const buildings = [
    ...city.buildings.filter((b) => alive(b, removedFor(b.id, 'building'))),
    ...(city.removed ?? []).filter((r): r is Extract<RemovedItem, { kind: 'building' }> => r.kind === 'building' && alive(r.item, r.removedAtTick))
      .map((r) => r.item),
  ].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);
  const roads = [
    ...city.roads.filter((r) => alive(r, removedFor(r.id, 'road'))),
    ...(city.removed ?? []).filter((r): r is Extract<RemovedItem, { kind: 'road' }> => r.kind === 'road' && alive(r.item, r.removedAtTick))
      .map((r) => r.item),
  ].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
  // Clé de cache propre à cet instant (le cache du tracé de routes dépend de layoutVersion).
  return { ...city, buildings, roads, layoutVersion: -1 - tick, stats: null };
}

/** Migration d'un état sauvegardé vers le schéma courant. */
export function migrateCityState(raw: unknown): CityState {
  const state = raw as CityState;
  if (typeof state !== 'object' || state === null) throw new Error('État de ville invalide');
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Version de sauvegarde ${String(state.schemaVersion)} non prise en charge`);
  }
  return state;
}
