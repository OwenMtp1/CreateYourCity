// Paramètres externes d'une ville, fixés par le monde à chaque tick : marché commun, contrats
// entre joueurs, politique nationale. Une ville isolée utilise DEFAULT_MODIFIERS.
import { ECONOMY } from '../constants.ts';

export type LawId = 'environment' | 'minimum_wage' | 'public_health' | 'conscription' | 'education' | 'emergency';
export type ProjectId = 'highway' | 'power_grid' | 'university' | 'national_defense' | 'trade_fair' | 'national_health' | 'data_network' | 'national_park' | 'international_airport';

export interface CityModifiers {
  /** Prix d'achat des biens importés (marché commun). */
  goodsImportPrice: number;
  /** Prix de vente des biens exportés (marché commun). */
  goodsExportPrice: number;
  /** Biens livrés à cette ville par contrats (quantité/jour), coût total/jour (marchandise + transport) et droits de douane/jour. */
  contractIn: { qty: number; cost: number; tariff: number };
  /** Droit de douane national sur les achats au marché commun (0..0,5). */
  tariffRate: number;
  /** Biens promis par cette ville à d'autres (quantité/jour) et recette totale/jour si tout est livré. */
  contractOut: { qty: number; revenue: number };
  nationalTaxRate: number;
  laws: Partial<Record<LawId, boolean>>;
  projects: Partial<Record<ProjectId, boolean>>;
  /** Ville indépendante : ni marché commun, ni contrats, ni réseau régional d'électricité et d'eau. */
  isolated?: boolean;
}

export const DEFAULT_MODIFIERS: CityModifiers = {
  goodsImportPrice: ECONOMY.importGoodsPrice,
  goodsExportPrice: ECONOMY.exportGoodsPrice,
  contractIn: { qty: 0, cost: 0, tariff: 0 },
  tariffRate: 0,
  contractOut: { qty: 0, revenue: 0 },
  nationalTaxRate: 0,
  laws: {},
  projects: {},
};

/** Effets des lois nationales (formules utilisées dans sim/tick.ts et world/military.ts). */
export const LAW_EFFECTS = {
  environment: { pollutionFactor: 0.6, industryFactor: 0.9 },
  minimum_wage: { wageFactor: 1.15, attractivenessBonus: 0.05 },
  public_health: { healthCapacityFactor: 1.25, healthUpkeepFactor: 1.1 },
  conscription: { recruitCostFactor: 0.7, attractivenessMalus: 0.05 },
  /** Éducation obligatoire : capacité éducative +20 %, attractivité +3 points. */
  education: { educationCapacityFactor: 1.2, attractivenessBonus: 0.03 },
  /** État d'urgence : fortifications +30 %, impôt national jusqu'à 20 %, attractivité −8 points, élections suspendues. */
  emergency: { fortificationFactor: 1.3, attractivenessMalus: 0.08, maxTaxRate: 0.2 },
} as const;

/** Effets des grands projets nationaux. */
export const PROJECT_EFFECTS = {
  highway: { roadCapacityFactor: 1.3 },
  power_grid: { powerImportFactor: 0.6 },
  university: { educationCapacityFactor: 1.3, officeRevenueFactor: 1.1 },
  national_defense: { fortificationFactor: 1.5 },
  /** Foire commerciale : ventes des commerces +15 %. */
  trade_fair: { goodsSalesFactor: 1.15 },
  /** Système de santé national : capacité santé +20 %. */
  national_health: { healthCapacityFactor: 1.2 },
  /** Réseau de données : revenu des bureaux +10 %. */
  data_network: { officeRevenueFactor: 1.1 },
  /** Parc national : pollution −15 %, attractivité +3 points. */
  national_park: { pollutionFactor: 0.85, attractivenessBonus: 0.03 },
  /** Aéroport international : vitesse des unités aériennes ×1,5. */
  international_airport: { airSpeedFactor: 1.5 },
} as const;
