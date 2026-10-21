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
  /** Parkings : prix d'un stationnement en crédits (absent ou 0 : gratuit). */
  fee?: number;
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
  /** Actifs qui travaillent sur chaque site d'emploi (dernier tick). */
  siteWorkers?: Record<number, number>;
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
  goods: {
    demand: number; sold: number; produced: number; imported: number; exported: number;
    /** Biens reçus par contrats, livrés aux contrats, et part des engagements honorée. */
    contractIn: number; contractDelivered: number; contractDeliveredRatio: number;
    importPrice: number; exportPrice: number;
    /** Droits de douane payés par les commerces (versés au budget national). */
    tariffPaid: number;
    /** Biens vendus aux commerces de la ville par ses propres usines. */
    localSupplied: number;
    /** Demande des habitants qui n'ont aucun commerce à moins de 450 m (ou commerces saturés). */
    unserved: number;
  };
  services: Record<ServiceKind, { coverage: number; capacity: number }>;
  /** Écart-type (pondéré par la population) de la couverture moyenne entre bâtiments résidentiels. */
  serviceInequality: number;
  pollutionExposure: number;
  traffic: { trips: number; efficiency: number; congestedSegments: number };
  /** Ville indépendante : couverture électricité/eau sans réseau régional, ventes perdues, biens invendus. */
  isolation?: { powerCover: number; waterCover: number; lostSales: number; unsoldGoods: number };
  /** Transports en commun : voyages par jour, capacité, part des déplacements. */
  transit: { riders: number; capacity: number; share: number };
  /**
   * Stationnement (places occupées simultanément) : places le long des rues raccordées et dans
   * les parkings, demande des automobilistes, part de la demande satisfaite, recettes par jour.
   */
  parking: { streetSpaces: number; lotSpaces: number; demand: number; used: number; coverage: number; revenue: number };
  /** Flux budgétaires par jour de jeu. */
  budget: {
    residentialTax: number;
    commercialTax: number;
    industrialTax: number;
    upkeep: number;
    utilityImports: number;
    loanInterest: number;
    net: number;
    /** Impôt national payé par les habitants (hors budget municipal). */
    nationalTax: number;
    transitFares: number;
    parkingFees: number;
  };
}

export type CampaignKind = 'jobs' | 'attract';

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
  /** Campagnes de communication en cours ; `endsTick` exclu. */
  campaigns?: { kind: CampaignKind; endsTick: number }[];
  /** Effectifs fixés à la main par bâtiment d'emploi ; les autres postes se remplissent automatiquement. */
  assignments?: Record<number, number>;
  stats: CityStats | null;
  /** Échantillons d'historique (un toutes les 4 h de jeu, 15 jours au plus). */
  history?: HistorySample[];
  /** Paliers atteints (population, trésorerie, réussites), dans l'ordre d'obtention. */
  milestones?: MilestoneReached[];
  /**
   * Dictature indépendante : tick de la proclamation (absent si la ville fait partie de son pays).
   * Ni impôt, ni lois, ni projets, ni subventions nationales ; aucun échange avec l'extérieur.
   */
  independentSince?: number;
  /** Tick de la dernière réintégration dans le pays (délai avant une nouvelle sécession). */
  rejoinedAtTick?: number;
}

export interface MilestoneReached {
  id: string;
  tick: number;
}

export interface HistorySample {
  tick: number;
  population: number;
  treasury: number;
  net: number;
  unemployment: number;
  attractiveness: number;
  traffic: number;
}

/** Informations par bâtiment/tronçon pour les couches cartographiques. */
export interface CityLayers {
  buildingStatus: Record<number, BuildingStatus>;
  /** Couverture moyenne des services pour chaque bâtiment résidentiel (0..1). */
  residentialCoverage: Record<number, Record<ServiceKind, number>>;
  pollution: Record<number, number>;
  /** Charge / capacité par tronçon de route. */
  roadLoad: Record<number, number>;
  /** Taux d'utilisation (0..1) de chaque équipement de service. */
  serviceLoad: Record<number, number>;
  /** Taux d'occupation (0..1) de chaque parking. */
  parkingUse?: Record<number, number>;
  roadConnected: Record<number, boolean>;
  /** Comptes de chaque entreprise et impôt de chaque logement (dernier tick, par jour de jeu). */
  economy?: Record<number, BuildingEconomy>;
  /** Livraisons du jour : usine → commerce (quantité en biens/j, distance par la route). */
  supply?: SupplyLink[];
}

/** Comptes d'un bâtiment, en crédits par jour de jeu. */
export interface BuildingEconomy {
  /** Recettes (ventes, chiffre d'affaires) et dépenses (achats, salaires) de l'entreprise. */
  revenue: number;
  costs: number;
  profit: number;
  /** Impôt versé à la ville : sur le bénéfice (entreprise) ou sur le revenu des habitants (logement). */
  tax: number;
  /** Commerces : habitants clients, biens vendus, achetés aux usines de la ville, par contrat, importés. */
  customers?: number;
  /** Habitants dans la zone de chalandise, et conditions de vente (emploi, électricité et eau). */
  catchment?: number;
  staffed?: boolean;
  powered?: boolean;
  sold?: number;
  local?: number;
  contract?: number;
  imported?: number;
  /** Prix moyen payé par bien (achats / quantité). */
  unitCost?: number;
  /** Usines : production, livraisons aux commerces de la ville, exportations, contrats honorés. */
  produced?: number;
  shipped?: number;
  exported?: number;
  /** Ville indépendante : biens produits que personne n'achète (exportation impossible). */
  unsold?: number;
  /** Bureaux : main-d'œuvre qualifiée (école à portée). */
  educated?: boolean;
  /** Logements : bonus de valeur foncière grâce aux loisirs (0 à 0,15). */
  landValue?: number;
  /** Services publics : coût d'entretien du jour et utilisation de la capacité nominale (0..1). */
  publicCost?: number;
  use?: number;
}

export interface SupplyLink {
  from: number;
  to: number;
  qty: number;
  distance: number;
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
  /** Dictature indépendante (sécession du pays), signalée à tous les joueurs. */
  independent?: boolean;
}
