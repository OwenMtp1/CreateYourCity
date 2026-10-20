// Index des pays et villes réels (Natural Earth, domaine public).
import citiesData from '../data/cities.json' with { type: 'json' };
import countriesData from '../data/countries.json' with { type: 'json' };

export interface WorldCity {
  id: string;
  name: string;
  countryId: string;
  lat: number;
  lon: number;
  pop: number;
  /** scalerank Natural Earth : 0 = ville majeure, 10 = petite ville. */
  rank: number;
  capital: boolean;
  /** Mer à moins de 8 km : azimut vers la mer (0 = nord, 90 = est) et distance en km. */
  coast?: { dir: number; dist: number };
}

export interface WorldCountry {
  id: string;
  name: string;
  nameFr: string;
  iso2: string | null;
}

export const WORLD_CITIES = citiesData as WorldCity[];
export const WORLD_COUNTRIES = countriesData as WorldCountry[];
export const CITY_BY_ID = new Map(WORLD_CITIES.map((c) => [c.id, c]));
export const COUNTRY_BY_ID = new Map(WORLD_COUNTRIES.map((c) => [c.id, c]));
