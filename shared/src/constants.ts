// Constantes de simulation. Les valeurs non tranchées par le cahier des charges sont
// des choix provisoires documentés dans docs/DECISIONS.md.

/** Version du format de sauvegarde d'une ville (incrémenter + migrer en cas de changement). */
export const SCHEMA_VERSION = 1;

/** Durée réelle d'un tick serveur (vitesse fixe, identique pour tous). */
export const TICK_MS = 1000;
/** Temps de jeu écoulé par tick. */
export const GAME_MINUTES_PER_TICK = 10;
export const TICKS_PER_DAY = (24 * 60) / GAME_MINUTES_PER_TICK;
/** Heure de jeu au tick 0 (un monde démarre le matin). */
export const GAME_START_HOUR = 8;
/** Pas de simulation exprimé en jours de jeu (les formules sont écrites « par jour »). */
export const DT_DAYS = 1 / TICKS_PER_DAY;
export const DAYS_PER_YEAR = 360;

/** Côté de l'espace constructible d'une ville, en mètres (Q94 non répondue : provisoire). */
export const CITY_SIZE_M = 2000;

/** Joueurs administrateurs (par nom, sans tenir compte de la casse) : remise à zéro des budgets nationaux. */
export const ADMIN_PLAYER_NAMES: readonly string[] = ['OwenMtp'];

export const isAdminName = (name: string | undefined): boolean =>
  !!name && ADMIN_PLAYER_NAMES.some((admin) => admin.toLowerCase() === name.toLowerCase());
/** Point d'accès au réseau régional (bord ouest, milieu). */
export const REGIONAL_ACCESS = { x: 0, y: CITY_SIZE_M / 2 } as const;
/** Distance maximale bord de bâtiment ↔ bord de route pour être desservi. */
export const ROAD_ACCESS_DISTANCE = 12;
/** Tolérance de raccordement entre deux routes. */
export const ROAD_JOIN_TOLERANCE = 1.5;
/** Raccordement automatique : une extrémité de route à moins de cette distance d'un réseau relié s'y greffe. */
export const ROAD_AUTO_CONNECT_DISTANCE = 12;
export const ROAD_MIN_LENGTH = 10;
export const ROAD_MAX_LENGTH = 800;
/** Taille d'une cellule de terrain. */
export const TERRAIN_CELL_M = 50;

/** Budget initial (Q93 non répondue : provisoire). */
export const STARTING_TREASURY = 500_000;
export const MAX_DEBT = 1_000_000;
export const LOAN_ANNUAL_RATE = 0.06;
export const DEFAULT_TAXES = { residential: 0.1, commercial: 0.1, industrial: 0.1 } as const;
export const MAX_TAX_RATE = 0.3;

/** Économie (unité : crédits « cr », par jour de jeu). */
export const ECONOMY = {
  wagePerWorker: 100,
  workforceShare: 0.5,
  /** Biens achetés par habitant et par jour (dans un commerce à proximité). */
  goodsDemandPerResident: 0.3,
  /** Biens achetés par salarié et par jour, près de son lieu de travail (hors commerces). */
  goodsDemandPerWorker: 0.1,
  retailPrice: 30,
  localWholesalePrice: 14,
  importGoodsPrice: 18,
  exportGoodsPrice: 10,
  officeRevenuePerWorker: 140,
  powerImportPricePerMWh: 8,
  waterImportPricePerM3: 0.8,
  /** Efficacité des services publics quand le trésor est négatif. */
  deficitServiceEfficiency: 0.6,
} as const;

/**
 * Circuit des biens : usines → commerces → habitants. Les commerces vendent aux habitants de leur
 * quartier, s'approvisionnent d'abord auprès des usines de la ville (prix de gros + livraison selon
 * la distance), puis importent le reste, nettement plus cher. Les usines exportent leurs surplus.
 */
export const COMMERCE = {
  /** Rayon de chalandise : un commerce vend aux habitants à moins de 450 m. */
  catchmentRadius: 450,
  /** Part minimale de la masse salariale d'un commerce, même quand il vend peu. Le reste suit ses ventes. */
  minPayroll: 0.4,
  /** Frais d'importation (transport, intermédiaires) ajoutés au prix du marché commun. */
  importHandling: 5,
  /** Coût de livraison par mètre de route entre une usine et un commerce (payé par le commerce). */
  deliveryCostPerMeter: 0.004,
  /** Bonus de chiffre d'affaires des bureaux à portée d'une école (main-d'œuvre qualifiée). */
  educatedOfficeBonus: 0.2,
  /** Part fixe de l'entretien des services publics ; le reste suit leur taux d'utilisation. */
  serviceFixedUpkeepShare: 0.4,
  /** Hausse de l'impôt résidentiel d'un logement bien desservi en loisirs (valeur foncière). */
  leisureTaxBonus: 0.15,
} as const;

/** Dictature indépendante : délai avant de réintégrer le pays (ou d'en sortir à nouveau), effet des coupures. */
export const INDEPENDENCE = {
  /** Un jour de jeu entre deux changements de statut. */
  cooldownTicks: 144,
  /** Perte d'attractivité maximale quand l'électricité ou l'eau manque totalement. */
  blackoutMalus: 0.25,
} as const;

/** Démographie agrégée. */
export const POPULATION = {
  baseOccupancy: 0.3,
  immigrationRatePerDay: 0.5,
  emigrationRatePerDay: 0.25,
  comfortableTaxRate: 0.08,
} as const;

/** Stock maximal d'une usine qui n'exporte pas son surplus, en jours de production. */
export const FACTORY_STOCK_DAYS = 3;

/** Villes jumelées : transport entre elles divisé par deux, sans droits de douane. */
export const TWIN_TRADE = { transportFactor: 0.5 } as const;

/**
 * Gestion des habitants. Une campagne coûte un montant fixe et dure `campaignDays` jours.
 * - « jobs » : davantage d'habitants en âge de travailler se présentent aux emplois.
 * - « attract » : la ville paraît plus attractive aux nouveaux arrivants.
 * Transférer des habitants vers une autre ville de la même main coûte un trajet, par personne.
 */
export const POPULATION_POLICY = {
  campaignDays: 5,
  campaignCost: { jobs: 60_000, attract: 80_000 },
  jobsParticipationBonus: 0.1,
  attractBonus: 0.12,
  transferBaseCost: 200,
  transferCostPerKm: 0.5,
} as const;

/** Trafic agrégé par tronçon. */
export const TRAFFIC = {
  tripsPerResidentPerDay: 1,
  tripsPerWorkerPerDay: 1,
  tripsPerGoodSold: 0.7,
  freeFlowRatio: 0.8,
  minEfficiency: 0.4,
  /** Déplacements de fret par unité de capacité de production. */
  freightTripsPerGood: 0.2,
} as const;

/**
 * Stationnement. La demande (places occupées en même temps) suit les trajets en voiture des
 * habitants ; l'offre vient des rues raccordées et des parkings. Un parking payant attire moins
 * (poids exp(−tarif / sensibilité)) ; les automobilistes n'y vont que faute de mieux.
 */
/** Bornes du prix d'une vente à l'unité, en fraction du prix par défaut. */
export const PRICING = { minFactor: 0.5, maxFactor: 3 } as const;

export const PARKING = {
  streetSpacesPerMeter: { street: 0.08, avenue: 0.05, bridge: 0 },
  spacesPerCarTrip: 0.12,
  /** Stationnements successifs par place occupée et par jour (recettes). */
  turnoverPerDay: 3,
  maxFee: 20,
  priceSensitivity: 6,
  /** Perte d'efficacité du trafic quand aucune place n'est disponible (voitures qui tournent). */
  searchPenalty: 0.12,
  /** Malus d'attractivité maximal, atteint quand le coût moyen par trajet atteint feeTolerance. */
  maxFeeMalus: 0.05,
  feeTolerance: 4,
} as const;

/** Transports en commun : part modale maximale des habitants desservis, tarif par voyage. */
export const TRANSIT = {
  modeShare: { bus: 0.25, tram: 0.35, metro: 0.5 },
  minStationsPerMode: 2,
  farePerRide: 1.5,
  /** Tarif maximal d'une ligne (crédits par voyage). 0 : gratuite. */
  maxFare: 6,
} as const;
