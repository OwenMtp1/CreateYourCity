import { DEFAULT_TAXES, SCHEMA_VERSION, STARTING_TREASURY } from './constants.ts';
import type { CityState, CitySummary } from './types.ts';

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
    ...(city.independentSince !== undefined ? { independent: true } : {}),
  };
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
