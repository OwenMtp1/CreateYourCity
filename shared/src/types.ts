import type { BuildingType, RoadType, ServiceKind } from './catalog.ts';

export interface Building {
  id: number;
  type: BuildingType;
  /** Centre de l'emprise, en mètres. */
  x: number;
  y: number;
  /** 0 ou 90 degrés. */
  rotation: 0 | 90;
  builtAtTick: number;
}

export interface Road {
  id: number;
  type: RoadType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  builtAtTick: number;
}

export interface TaxRates {
  residential: number;
  commercial: number;
  industrial: number;
}

export type BuildingStatus = 'ok' | 'no_road' | 'disconnected';

/** Résultats agrégés d'un tick, tous issus de formules de src/sim/tick.ts. */
export interface CityStats {
  housingCapacity: number;
  jobs: number;
  workforce: number;
  employed: number;
  unemploymentRate: number;
  staffingRatio: number;
  attractiveness: number;
  targetPopulation: number;
  migrationPerDay: number;
  power: { demandMW: number; localMW: number; importedMW: number };
  water: { demandM3: number; localM3: number; importedM3: number };
  goods: { demand: number; sold: number; produced: number; imported: number; exported: number };
  services: Record<ServiceKind, { coverage: number; capacity: number }>;
  /** Écart-type (pondéré par la population) de la couverture moyenne entre bâtiments résidentiels. */
  serviceInequality: number;
  pollutionExposure: number;
  traffic: { trips: number; efficiency: number; congestedSegments: number };
  /** Flux budgétaires par jour de jeu. */
  budget: {
    residentialTax: number;
    commercialTax: number;
    industrialTax: number;
    upkeep: number;
    utilityImports: number;
    loanInterest: number;
    net: number;
  };
}

export interface CityState {
  schemaVersion: number;
  cityId: string;
  countryId: string;
  ownerId: string;
  ownerName: string;
  /** Dernier tick simulé pour cette ville. */
  tick: number;
  claimedAtTick: number;
  treasury: number;
  debt: number;
  population: number;
  taxes: TaxRates;
  buildings: Building[];
  roads: Road[];
  nextEntityId: number;
  /** Incrémenté à chaque modification de l'agencement (invalide le cache d'analyse). */
  layoutVersion: number;
  stats: CityStats | null;
}

/** Informations par bâtiment/tronçon pour les couches cartographiques. */
export interface CityLayers {
  buildingStatus: Record<number, BuildingStatus>;
  /** Couverture moyenne des services pour chaque bâtiment résidentiel (0..1). */
  residentialCoverage: Record<number, Record<ServiceKind, number>>;
  pollution: Record<number, number>;
  /** Charge / capacité par tronçon de route. */
  roadLoad: Record<number, number>;
  roadConnected: Record<number, boolean>;
}

/** Vue publique d'une ville appartenant à un autre joueur (informations générales). */
export interface CitySummary {
  cityId: string;
  countryId: string;
  ownerId: string;
  ownerName: string;
  /** Arrondie à la centaine (information générale). */
  population: number;
  buildingCount: number;
}
