// Catalogue des constructions. Chaque valeur alimente une formule explicite de src/sim.

export type BuildingType =
  | 'house'
  | 'apartment'
  | 'shop'
  | 'office'
  | 'factory'
  | 'clinic'
  | 'school'
  | 'police'
  | 'power_plant'
  | 'water_tower'
  | 'tower'
  | 'park'
  | 'barracks'
  | 'bus_station'
  | 'tram_station'
  | 'metro_station'
  | 'train_station'
  | 'port'
  | 'airbase'
  | 'parking'
  | 'parking_garage'
  | 'urban_forest'
  | 'solar_plant'
  | 'casino'
  | 'hotel'
  | 'cinema'
  | 'theme_park'
  | 'airport'
  | 'skyscraper';

export type RoadType = 'street' | 'avenue' | 'bridge';
export type BuildingCategory = 'residential' | 'commercial' | 'industrial' | 'service' | 'utility' | 'transport' | 'military';
export type TransitMode = 'bus' | 'tram' | 'metro';
export const TRANSIT_MODES: readonly TransitMode[] = ['bus', 'tram', 'metro'];
export type ServiceKind = 'health' | 'education' | 'safety' | 'leisure';
export const SERVICE_KINDS: readonly ServiceKind[] = ['health', 'education', 'safety', 'leisure'];

export interface BuildingDef {
  type: BuildingType;
  label: string;
  category: BuildingCategory;
  description: string;
  /** Emprise en mètres (avant rotation). */
  w: number;
  h: number;
  cost: number;
  /** Entretien municipal par jour (inclut les salaires du personnel public pour services/réseaux). */
  upkeepPerDay: number;
  jobs: number;
  housing: number;
  powerMW: number;
  waterM3PerDay: number;
  goodsProductionPerDay?: number;
  goodsSalesCapacityPerDay?: number;
  /** Bureaux : chiffre d'affaires par employé et par jour. */
  officeRevenue?: boolean;
  /** Autres entreprises privées : chiffre d'affaires par employé et par jour (comme les bureaux). */
  revenuePerWorker?: number;
  service?: { kind: ServiceKind; radius: number; capacity: number };
  powerOutputMW?: number;
  waterOutputM3PerDay?: number;
  pollution?: { radius: number; intensity: number };
  /** Absorbe la pollution des logements proches : `amount` points à la limite du rayon, plein effet au centre. */
  pollutionAbsorption?: { radius: number; amount: number };
  /** Produit de l'électricité seulement le jour (powerOutputMW est alors la puissance de pointe). */
  sunPowered?: boolean;
  /** Les salaires sont payés par la ville via l'entretien (pas d'impôt sur les bénéfices). */
  publicSector?: boolean;
  /** Station de transport en commun : rayon desservi et capacité en voyages par jour. */
  transit?: { mode: TransitMode; radius: number; capacity: number };
  /** Doit être construit à moins de 40 m d'une étendue d'eau (port). */
  needsWater?: boolean;
  /** Parking municipal : nombre de places (gratuit ou payant, tarif réglable par parking). */
  parking?: { spaces: number };
  /**
   * Vente à l'unité (place de cinéma, chambre d'hôtel) : prix réglable par le joueur. La demande suit
   * (defaultPrice / prix)^elasticity, plafonnée par la capacité du bâtiment (capacityPerDay × personnel).
   */
  pricing?: { unit: string; defaultPrice: number; capacityPerDay: number; elasticity: number };
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  theme_park: {
    type: 'theme_park', label: 'Parc à thème', category: 'commercial',
    description: "Grand parc d'attractions : gros chiffre d'affaires et loisirs pour toute la région, mais beaucoup de visiteurs et d'électricité.",
    w: 80, h: 80, cost: 4_000_000, upkeepPerDay: 600, jobs: 60, housing: 0, powerMW: 2.0, waterM3PerDay: 40,
    revenuePerWorker: 240, service: { kind: 'leisure', radius: 600, capacity: 6_000 },
  },
  airport: {
    type: 'airport', label: 'Aéroport international', category: 'transport',
    description: "Relie la ville au monde : importations moins chères dans toute la ville (-10 %) et gros chiffre d'affaires. Très grande emprise.",
    w: 200, h: 120, cost: 8_000_000, upkeepPerDay: 2_000, jobs: 150, housing: 0, powerMW: 3.0, waterM3PerDay: 30,
    revenuePerWorker: 300, publicSector: false,
  },
  casino: {
    type: 'casino', label: 'Casino', category: 'commercial',
    description: 'Gros chiffre d\'affaires pour peu d\'employés, mais affluence et bruit autour : nuisance pour les logements proches.',
    w: 40, h: 30, cost: 450_000, upkeepPerDay: 250, jobs: 30, housing: 0, powerMW: 0.8, waterM3PerDay: 8,
    revenuePerWorker: 260, pollution: { radius: 250, intensity: 0.3 },
  },
  hotel: {
    type: 'hotel', label: 'Hôtel', category: 'commercial',
    description: "Héberge des visiteurs de passage : chiffre d'affaires sans habitants supplémentaires.",
    w: 40, h: 40, cost: 300_000, upkeepPerDay: 150, jobs: 20, housing: 0, powerMW: 0.6, waterM3PerDay: 15,
    pricing: { unit: 'chambre', defaultPrice: 150, capacityPerDay: 24, elasticity: 1.2 },
  },
  cinema: {
    type: 'cinema', label: 'Cinéma', category: 'commercial',
    description: 'Loisirs pour les quartiers voisins, avec un petit chiffre d\'affaires.',
    w: 40, h: 30, cost: 180_000, upkeepPerDay: 90, jobs: 12, housing: 0, powerMW: 0.2, waterM3PerDay: 3,
    service: { kind: 'leisure', radius: 350, capacity: 1_500 },
    pricing: { unit: 'place', defaultPrice: 11, capacityPerDay: 300, elasticity: 1.2 },
  },
  house: {
    type: 'house', label: 'Maisons', category: 'residential',
    description: 'Petit îlot de maisons individuelles.',
    w: 20, h: 20, cost: 15_000, upkeepPerDay: 10, jobs: 0, housing: 12, powerMW: 0.02, waterM3PerDay: 3,
  },
  skyscraper: {
    type: 'skyscraper', label: 'Gratte-ciel de luxe', category: 'residential',
    description: "Tour de très haut standing : beaucoup d'appartements premium sur une petite emprise. Gros besoins en électricité et en eau.",
    w: 50, h: 50, cost: 5_000_000, upkeepPerDay: 800, jobs: 0, housing: 900, powerMW: 4.0, waterM3PerDay: 250,
  },
  tower: {
    type: 'tower', label: "Tour d'habitation", category: 'residential',
    description: 'Logements à haute densité : beaucoup d\'habitants sur peu de place, mais gros besoins en électricité et en eau.',
    w: 30, h: 30, cost: 260_000, upkeepPerDay: 140, jobs: 0, housing: 400, powerMW: 1.2, waterM3PerDay: 140,
  },
  apartment: {
    type: 'apartment', label: 'Immeuble', category: 'residential',
    description: "Immeuble d'habitation collectif.",
    w: 30, h: 30, cost: 70_000, upkeepPerDay: 40, jobs: 0, housing: 120, powerMW: 0.15, waterM3PerDay: 25,
  },
  shop: {
    type: 'shop', label: 'Commerce', category: 'commercial',
    description: "Vend aux habitants à moins de 450 m. S'approvisionne auprès des usines de la ville (moins cher), sinon importe.",
    w: 20, h: 20, cost: 30_000, upkeepPerDay: 15, jobs: 12, housing: 0, powerMW: 0.05, waterM3PerDay: 1,
    goodsSalesCapacityPerDay: 150,
  },
  office: {
    type: 'office', label: 'Bureaux', category: 'commercial',
    description: "Entreprise de services vendus à la région. +20 % de chiffre d'affaires à portée d'une école (main-d'œuvre qualifiée).",
    w: 30, h: 30, cost: 90_000, upkeepPerDay: 30, jobs: 100, housing: 0, powerMW: 0.3, waterM3PerDay: 5,
    officeRevenue: true,
  },
  factory: {
    type: 'factory', label: 'Usine', category: 'industrial',
    description: 'Produit 400 biens/j livrés par camion aux commerces de la ville (les plus proches d\'abord), le surplus est exporté à bas prix. Pollue.',
    w: 50, h: 40, cost: 160_000, upkeepPerDay: 60, jobs: 30, housing: 0, powerMW: 1.5, waterM3PerDay: 40,
    goodsProductionPerDay: 400, pollution: { radius: 300, intensity: 0.6 },
  },
  clinic: {
    type: 'clinic', label: 'Clinique', category: 'service',
    description: 'Soins de proximité.',
    w: 30, h: 30, cost: 120_000, upkeepPerDay: 1_800, jobs: 25, housing: 0, powerMW: 0.2, waterM3PerDay: 10,
    service: { kind: 'health', radius: 600, capacity: 4_000 }, publicSector: true,
  },
  school: {
    type: 'school', label: 'École', category: 'service',
    description: 'Éducation primaire et secondaire.',
    w: 40, h: 30, cost: 100_000, upkeepPerDay: 1_500, jobs: 20, housing: 0, powerMW: 0.1, waterM3PerDay: 8,
    service: { kind: 'education', radius: 700, capacity: 3_000 }, publicSector: true,
  },
  police: {
    type: 'police', label: 'Commissariat', category: 'service',
    description: 'Sécurité publique.',
    w: 25, h: 25, cost: 80_000, upkeepPerDay: 1_200, jobs: 20, housing: 0, powerMW: 0.1, waterM3PerDay: 3,
    service: { kind: 'safety', radius: 800, capacity: 5_000 }, publicSector: true,
  },
  power_plant: {
    type: 'power_plant', label: 'Centrale électrique', category: 'utility',
    description: "Produit de l'électricité ; sinon la ville importe du réseau régional.",
    w: 50, h: 50, cost: 250_000, upkeepPerDay: 1_200, jobs: 30, housing: 0, powerMW: 0, waterM3PerDay: 50,
    powerOutputMW: 15, pollution: { radius: 350, intensity: 0.7 }, publicSector: true,
  },
  water_tower: {
    type: 'water_tower', label: "Château d'eau", category: 'utility',
    description: "Fournit de l'eau ; sinon la ville importe de l'eau régionale.",
    w: 20, h: 20, cost: 50_000, upkeepPerDay: 300, jobs: 5, housing: 0, powerMW: 0.1, waterM3PerDay: 0,
    waterOutputM3PerDay: 2_000, publicSector: true,
  },
  urban_forest: {
    type: 'urban_forest', label: 'Forêt urbaine', category: 'service',
    description: 'Boisement de quartier : absorbe 15 points de pollution des logements dans un rayon de 200 m. Peu d\'entretien, aucune pollution.',
    w: 50, h: 50, cost: 60_000, upkeepPerDay: 120, jobs: 2, housing: 0, powerMW: 0, waterM3PerDay: 5,
    pollutionAbsorption: { radius: 200, amount: 0.15 }, publicSector: true,
  },
  solar_plant: {
    type: 'solar_plant', label: 'Centrale solaire', category: 'utility',
    description: "Électricité sans pollution : 4 MW de pointe, seulement de jour (du lever au coucher du soleil). La nuit, la ville importe du réseau.",
    w: 40, h: 40, cost: 300_000, upkeepPerDay: 250, jobs: 3, housing: 0, powerMW: 0, waterM3PerDay: 2,
    powerOutputMW: 4, sunPowered: true, publicSector: true,
  },
  park: {
    type: 'park', label: 'Parc', category: 'service',
    description: 'Espace vert : loisirs pour les quartiers voisins, dont les logements prennent de la valeur (+15 % d\'impôt).',
    w: 40, h: 40, cost: 40_000, upkeepPerDay: 150, jobs: 3, housing: 0, powerMW: 0, waterM3PerDay: 20,
    service: { kind: 'leisure', radius: 400, capacity: 3_000 }, publicSector: true,
  },
  barracks: {
    type: 'barracks', label: 'Caserne', category: 'military',
    description: "Permet de recruter des unités et renforce la défense de la ville.",
    w: 60, h: 40, cost: 200_000, upkeepPerDay: 1_000, jobs: 40, housing: 0, powerMW: 0.3, waterM3PerDay: 15, publicSector: true,
  },
  bus_station: {
    type: 'bus_station', label: 'Gare routière', category: 'transport',
    description: 'Lignes de bus : une partie des habitants à 400 m laisse la voiture (2 stations minimum).',
    w: 20, h: 20, cost: 60_000, upkeepPerDay: 500, jobs: 15, housing: 0, powerMW: 0.05, waterM3PerDay: 2,
    transit: { mode: 'bus', radius: 400, capacity: 4_000 }, publicSector: true,
  },
  tram_station: {
    type: 'tram_station', label: 'Station de tram', category: 'transport',
    description: 'Tramway : rayon 500 m, part modale plus forte que le bus (2 stations minimum).',
    w: 16, h: 30, cost: 150_000, upkeepPerDay: 900, jobs: 12, housing: 0, powerMW: 0.4, waterM3PerDay: 2,
    transit: { mode: 'tram', radius: 500, capacity: 9_000 }, publicSector: true,
  },
  metro_station: {
    type: 'metro_station', label: 'Station de métro', category: 'transport',
    description: 'Métro : rayon 700 m, très forte capacité (2 stations minimum).',
    w: 20, h: 20, cost: 400_000, upkeepPerDay: 1_800, jobs: 20, housing: 0, powerMW: 0.8, waterM3PerDay: 4,
    transit: { mode: 'metro', radius: 700, capacity: 25_000 }, publicSector: true,
  },
  train_station: {
    type: 'train_station', label: 'Gare ferroviaire', category: 'transport',
    description: 'Réseau ferré : meilleurs prix sur le marché, transport des contrats moins cher, ravitaillement et déplacements militaires accélérés.',
    w: 60, h: 30, cost: 500_000, upkeepPerDay: 2_000, jobs: 60, housing: 0, powerMW: 0.6, waterM3PerDay: 10, publicSector: true,
  },
  port: {
    type: 'port', label: 'Port', category: 'transport',
    description: "Au bord de l'eau : meilleurs prix sur le marché, transport des contrats moins cher, flotte de guerre.",
    w: 60, h: 40, cost: 450_000, upkeepPerDay: 1_500, jobs: 80, housing: 0, powerMW: 0.5, waterM3PerDay: 10,
    needsWater: true, publicSector: true,
  },
  airbase: {
    type: 'airbase', label: 'Base aérienne', category: 'military',
    description: "Permet de recruter l'aviation.",
    w: 80, h: 60, cost: 600_000, upkeepPerDay: 3_000, jobs: 80, housing: 0, powerMW: 0.8, waterM3PerDay: 10, publicSector: true,
  },
  parking: {
    type: 'parking', label: 'Parking', category: 'transport',
    description: 'Parking à ciel ouvert (120 places). Gratuit ou payant : sans places, les voitures tournent et ralentissent le trafic.',
    w: 30, h: 40, cost: 20_000, upkeepPerDay: 30, jobs: 1, housing: 0, powerMW: 0.01, waterM3PerDay: 0,
    parking: { spaces: 120 }, publicSector: true,
  },
  parking_garage: {
    type: 'parking_garage', label: 'Parking à étages', category: 'transport',
    description: 'Silo de stationnement (600 places) sur une petite emprise. Gratuit ou payant.',
    w: 30, h: 40, cost: 150_000, upkeepPerDay: 220, jobs: 4, housing: 0, powerMW: 0.1, waterM3PerDay: 1,
    parking: { spaces: 600 }, publicSector: true,
  },
};

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

export interface RoadDef {
  type: RoadType;
  label: string;
  width: number;
  costPerMeter: number;
  upkeepPerMeterPerDay: number;
  /** Capacité en déplacements par jour pour un tronçon. */
  capacityTripsPerDay: number;
}

export const ROADS: Record<RoadType, RoadDef> = {
  street: { type: 'street', label: 'Rue', width: 10, costPerMeter: 40, upkeepPerMeterPerDay: 0.05, capacityTripsPerDay: 4_000 },
  avenue: { type: 'avenue', label: 'Avenue', width: 18, costPerMeter: 100, upkeepPerMeterPerDay: 0.12, capacityTripsPerDay: 12_000 },
  /** Seul type de voie autorisé au-dessus de l'eau (tablier surélevé ; la partie sur l'eau coûte plus cher). */
  bridge: { type: 'bridge', label: 'Pont', width: 14, costPerMeter: 120, upkeepPerMeterPerDay: 0.4, capacityTripsPerDay: 8_000 },
};

export const ROAD_TYPES = Object.keys(ROADS) as RoadType[];

/** Secteur d'un bâtiment d'emploi : les actifs ne se déplacent qu'entre sites d'un même secteur. */
export type Sector = 'commerce' | 'bureaux' | 'industrie' | 'services';
export function sectorOf(type: BuildingType): Sector {
  const d = BUILDINGS[type];
  if (d.goodsSalesCapacityPerDay) return 'commerce';
  if (d.officeRevenue) return 'bureaux';
  if (d.category === 'industrial') return 'industrie';
  return 'services';
}
