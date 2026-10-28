import { describe, expect, it } from 'vitest';
import { BUILDINGS, COMMERCE } from '../src/index.ts';

describe('parc à thème, aéroport international et gratte-ciel', () => {
  it('ont leurs effets : revenu et loisirs pour le parc, emplois et revenu pour l\'aéroport, logements pour le gratte-ciel', () => {
    expect(BUILDINGS.theme_park.revenuePerWorker).toBeGreaterThan(0);
    expect(BUILDINGS.theme_park.service?.kind).toBe('leisure');
    expect(BUILDINGS.airport.revenuePerWorker).toBeGreaterThan(0);
    expect(BUILDINGS.airport.jobs).toBeGreaterThan(BUILDINGS.theme_park.jobs);
    expect(BUILDINGS.skyscraper.housing).toBeGreaterThan(BUILDINGS.tower.housing);
  });

  it('un aéroport réduit le prix des importations', () => {
    expect(COMMERCE.airportImportFactor).toBeLessThan(1);
  });

  it('les coûts sont dans l\'échelle des autres grands bâtiments', () => {
    expect(BUILDINGS.theme_park.cost).toBeGreaterThan(BUILDINGS.casino.cost);
    expect(BUILDINGS.airport.cost).toBeGreaterThan(BUILDINGS.theme_park.cost);
    expect(BUILDINGS.skyscraper.cost).toBeGreaterThan(BUILDINGS.tower.cost);
  });
});
