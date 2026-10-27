// État du monde d'un salon au-delà des villes : diplomatie, commerce, armées, nations.
import type { LawId, ProjectId } from '../sim/modifiers.ts';
import type { CityState } from '../types.ts';

export const WORLD_SCHEMA_VERSION = 1;

export type TreatyType = 'alliance' | 'non_aggression' | 'defense' | 'trade' | 'intel' | 'peace' | 'city_transfer' | 'twin';

export interface Treaty {
  id: number;
  type: TreatyType;
  /** a : joueur qui propose ; b : joueur qui répond. */
  a: string;
  b: string;
  status: 'proposed' | 'active';
  proposedAtTick: number;
  activeSinceTick: number | null;
  /** Résiliation avec préavis (pacte de non-agression). */
  endsAtTick: number | null;
  /** Cession de ville : ville, vendeur, prix, ville qui paie (côté acheteur). */
  terms?: { cityId: string; seller: string; price: number; payFromCityId?: string };
  /** Jumelage : ville de a et ville de b. */
  cities?: { a: string; b: string };
  /** Traité conclu par des dirigeants nationaux au nom de leurs pays. */
  nations?: { a: string; b: string };
}

export interface War {
  id: number;
  a: string;
  b: string;
  sinceTick: number;
  /** Guerre déclarée au niveau national. */
  nations?: { a: string; b: string };
}

export interface TradeContract {
  id: number;
  sellerId: string;
  sellerCityId: string;
  buyerId: string;
  buyerCityId: string;
  qtyPerDay: number;
  pricePerUnit: number;
  days: number;
  proposedBy: string;
  status: 'proposed' | 'active';
  startTick: number | null;
  endTick: number | null;
  /** Part des livraisons effectivement honorée au tick précédent (0..1). */
  deliveredRatio: number;
}

export type UnitType = 'infantry' | 'armor' | 'artillery' | 'navy' | 'air';
export const UNIT_TYPES: readonly UnitType[] = ['infantry', 'armor', 'artillery', 'navy', 'air'];
/** Seules les unités terrestres peuvent prendre une ville. */
export const LAND_UNITS: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

export interface Army {
  id: number;
  ownerId: string;
  /** Ville qui paie la solde et l'entretien. */
  homeCityId: string;
  /** Effectifs (nombres réels : les pertes sont continues ; affichés arrondis). */
  units: Record<UnitType, number>;
  /** Ville où l'armée stationne, ou ville de départ si elle se déplace. */
  cityId: string;
  movement: { toCityId: string; progressKm: number; totalKm: number } | null;
  supplied: boolean;
  paid: boolean;
  /** Engagée dans une bataille en rase campagne (n'avance plus). */
  engaged?: boolean;
  /** En retraite vers sa ville de départ (ignore les engagements, vitesse réduite). */
  retreating?: boolean;
}

/** Bataille en rase campagne entre armées ennemies proches. */
export interface FieldBattle {
  id: number;
  armies: number[];
  players: string[];
  position: [number, number];
  sinceTick: number;
}

export type OrganizationKind = 'military' | 'trade';

/** Organisation multinationale créée par des joueurs. */
export interface Organization {
  id: number;
  name: string;
  kind: OrganizationKind;
  founderId: string;
  members: string[];
  invites: string[];
  createdTick: number;
}

export interface Siege {
  cityId: string;
  attackerId: string;
  /** 0..1 ; la ville est prise à 1. */
  progress: number;
}

export interface NationState {
  countryId: string;
  leaderId: string | null;
  electedAtTick: number | null;
  /** Nombre de paliers de 2 000 jours dont l'aide a déjà été demandée. */
  reliefClaimed?: number;
  /** Budget initial accordé au premier vote de la partie (une seule fois). */
  endowed?: boolean;
  candidates: string[];
  /** électeur → candidat */
  votes: Record<string, string>;
  /** électeurs favorables à la destitution */
  impeach: string[];
  taxRate: number;
  /** Droit de douane sur les importations (marché commun, contrats étrangers non exemptés). */
  tariff?: number;
  treasury: number;
  laws: Partial<Record<LawId, boolean>>;
  projects: Partial<Record<ProjectId, boolean>>;
}

export interface MarketState {
  /** Prix de référence des biens (cr/unité). */
  price: number;
  supply: number;
  demand: number;
  /** Échantillons de prix (un toutes les 4 h de jeu). */
  history: number[];
}

export type WorldEventKind =
  | 'war' | 'peace' | 'treaty' | 'treaty_end' | 'capture' | 'battle' | 'expansion' | 'transfer'
  | 'election' | 'resignation' | 'impeachment' | 'law' | 'project' | 'contract' | 'recruit' | 'funds' | 'organization' | 'independence' | 'betrayal';

export interface WorldEvent {
  id: number;
  tick: number;
  kind: WorldEventKind;
  text: string;
  /** Joueurs concernés ; vide = événement public. */
  players: string[];
  /** Événement visible seulement des joueurs concernés. */
  private?: boolean;
}

export interface DirectMessage {
  id: number;
  from: string;
  to: string;
  text: string;
  tick: number;
  at: string;
}

export interface WorldMeta {
  schemaVersion: number;
  nextId: number;
  players: Record<string, { name: string }>;
  treaties: Treaty[];
  wars: War[];
  contracts: TradeContract[];
  armies: Army[];
  sieges: Record<string, Siege>;
  battles: FieldBattle[];
  organizations: Organization[];
  nations: Record<string, NationState>;
  market: MarketState;
  events: WorldEvent[];
  messages: DirectMessage[];
}

/** Monde complet d'un salon : horloge, villes possédées et état global. */
export interface World {
  tick: number;
  cities: Map<string, CityState>;
  meta: WorldMeta;
}

export function createWorldMeta(): WorldMeta {
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    nextId: 1,
    players: {},
    treaties: [],
    wars: [],
    contracts: [],
    armies: [],
    sieges: {},
    battles: [],
    organizations: [],
    nations: {},
    market: { price: 14, supply: 0, demand: 0, history: [] },
    events: [],
    messages: [],
  };
}

export function migrateWorldMeta(raw: unknown): WorldMeta {
  const meta = raw as Partial<WorldMeta> | null;
  if (!meta || typeof meta !== 'object' || meta.schemaVersion === undefined) return createWorldMeta();
  if (meta.schemaVersion !== WORLD_SCHEMA_VERSION) throw new Error(`Version de monde ${meta.schemaVersion} non prise en charge`);
  const merged = { ...createWorldMeta(), ...meta } as WorldMeta;
  // Armées sauvegardées avant l'ajout des unités navales et aériennes.
  for (const a of merged.armies) for (const u of UNIT_TYPES) a.units[u] ??= 0;
  return merged;
}
