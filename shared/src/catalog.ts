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
  | 'water_tower';

export type RoadType = 'street' | 'avenue';
export type BuildingCategory = 'residential' | 'commercial' | 'industrial' | 'service' | 'utility';
export type ServiceKind = 'health' | 'education' | 'safety';
export const SERVICE_KINDS: readonly ServiceKind[] = ['health', 'education', 'safety'];

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
  service?: { kind: ServiceKind; radius: number; capacity: number };
  powerOutputMW?: number;
  waterOutputM3PerDay?: number;
  pollution?: { radius: number; intensity: number };
  /** Les salaires sont payés par la ville via l'entretien (pas d'impôt sur les bénéfices). */
  publicSector?: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  house: {
    type: 'house', label: 'Maisons', category: 'residential',
    description: 'Petit îlot de maisons individuelles.',
    w: 20, h: 20, cost: 15_000, upkeepPerDay: 10, jobs: 0, housing: 12, powerMW: 0.02, waterM3PerDay: 3,
  },
  apartment: {
    type: 'apartment', label: 'Immeuble', category: 'residential',
    description: "Immeuble d'habitation collectif.",
    w: 30, h: 30, cost: 70_000, upkeepPerDay: 40, jobs: 0, housing: 120, powerMW: 0.15, waterM3PerDay: 25,
  },
  shop: {
    type: 'shop', label: 'Commerce', category: 'commercial',
    description: 'Vend des biens aux habitants (biens locaux ou importés).',
    w: 20, h: 20, cost: 30_000, upkeepPerDay: 15, jobs: 12, housing: 0, powerMW: 0.05, waterM3PerDay: 1,
    goodsSalesCapacityPerDay: 100,
  },
  office: {
    type: 'office', label: 'Bureaux', category: 'commercial',
    description: 'Entreprise de services vendus à la région.',
    w: 30, h: 30, cost: 90_000, upkeepPerDay: 30, jobs: 100, housing: 0, powerMW: 0.3, waterM3PerDay: 5,
    officeRevenue: true,
  },
  factory: {
    type: 'factory', label: 'Usine', category: 'industrial',
    description: 'Produit des biens vendus aux commerces locaux ou exportés. Pollue.',
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
};

export const ROAD_TYPES = Object.keys(ROADS) as RoadType[];
