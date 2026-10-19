// Constantes de simulation. Les valeurs non tranchées par le cahier des charges sont
// des choix provisoires documentés dans docs/DECISIONS.md.

/** Version du format de sauvegarde d'une ville (incrémenter + migrer en cas de changement). */
export const SCHEMA_VERSION = 1;

/** Durée réelle d'un tick serveur (vitesse fixe, identique pour tous). */
export const TICK_MS = 1000;
/** Temps de jeu écoulé par tick. */
export const GAME_MINUTES_PER_TICK = 10;
export const TICKS_PER_DAY = (24 * 60) / GAME_MINUTES_PER_TICK;
/** Pas de simulation exprimé en jours de jeu (les formules sont écrites « par jour »). */
export const DT_DAYS = 1 / TICKS_PER_DAY;
export const DAYS_PER_YEAR = 360;

/** Côté de l'espace constructible d'une ville, en mètres (Q94 non répondue : provisoire). */
export const CITY_SIZE_M = 2000;
/** Point d'accès au réseau régional (bord ouest, milieu). */
export const REGIONAL_ACCESS = { x: 0, y: CITY_SIZE_M / 2 } as const;
/** Distance maximale bord de bâtiment ↔ bord de route pour être desservi. */
export const ROAD_ACCESS_DISTANCE = 12;
/** Tolérance de raccordement entre deux routes. */
export const ROAD_JOIN_TOLERANCE = 1.5;
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
  goodsDemandPerResident: 0.1,
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

/** Démographie agrégée. */
export const POPULATION = {
  baseOccupancy: 0.3,
  immigrationRatePerDay: 0.5,
  emigrationRatePerDay: 0.25,
  comfortableTaxRate: 0.08,
} as const;

/** Trafic agrégé par tronçon. */
export const TRAFFIC = {
  tripsPerResidentPerDay: 1,
  tripsPerWorkerPerDay: 1,
  tripsPerGoodSold: 2,
  freeFlowRatio: 0.8,
  minEfficiency: 0.4,
} as const;
