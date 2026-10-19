// Paramètres externes d'une ville, fixés par le monde à chaque tick : marché commun, contrats
// entre joueurs, politique nationale. Une ville isolée utilise DEFAULT_MODIFIERS.
import { ECONOMY } from '../constants.ts';

export type LawId = 'environment' | 'minimum_wage' | 'public_health' | 'conscription';
export type ProjectId = 'highway' | 'power_grid' | 'university' | 'national_defense';

export interface CityModifiers {
  /** Prix d'achat des biens importés (marché commun). */
  goodsImportPrice: number;
  /** Prix de vente des biens exportés (marché commun). */
  goodsExportPrice: number;
  /** Biens livrés à cette ville par contrats (quantité/jour) et leur coût total/jour. */
  contractIn: { qty: number; cost: number };
  /** Biens promis par cette ville à d'autres (quantité/jour) et recette totale/jour si tout est livré. */
  contractOut: { qty: number; revenue: number };
  nationalTaxRate: number;
  laws: Partial<Record<LawId, boolean>>;
  projects: Partial<Record<ProjectId, boolean>>;
}

export const DEFAULT_MODIFIERS: CityModifiers = {
  goodsImportPrice: ECONOMY.importGoodsPrice,
  goodsExportPrice: ECONOMY.exportGoodsPrice,
  contractIn: { qty: 0, cost: 0 },
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
} as const;

/** Effets des grands projets nationaux. */
export const PROJECT_EFFECTS = {
  highway: { roadCapacityFactor: 1.3 },
  power_grid: { powerImportFactor: 0.6 },
  university: { educationCapacityFactor: 1.3, officeRevenueFactor: 1.1 },
  national_defense: { fortificationFactor: 1.5 },
} as const;
