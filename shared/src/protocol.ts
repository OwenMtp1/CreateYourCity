// Protocole WebSocket. Les messages client sont validés côté serveur avec zod ;
// le serveur ne fait jamais confiance aux montants, propriétaires ou coûts envoyés.
import { z } from 'zod';
import { BUILDING_TYPES, ROAD_TYPES, type BuildingType, type RoadType } from './catalog.ts';
import type { CityCommand } from './commands.ts';
import type { CityLayers, CityState, CityStats, CitySummary, HistorySample, MilestoneReached, TaxRates } from './types.ts';
import type { WorldAction } from './world/actions.ts';
import type { WorldView } from './world/view.ts';

const id = z.string().min(1).max(80);
const cityId = z.string().min(1).max(40);
const unit = z.enum(['infantry', 'armor', 'artillery', 'navy', 'air']);
const treatyType = z.enum(['alliance', 'non_aggression', 'defense', 'trade', 'intel', 'peace', 'city_transfer', 'twin']);
const amount = z.number().finite().positive().max(1e10);

export const worldActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('transferFunds'), fromCityId: cityId, toCityId: cityId, amount }),
  z.object({
    type: z.literal('proposeTreaty'), to: id, treaty: treatyType, cityId: cityId.optional(), price: z.number().finite().min(0).max(1e10).optional(),
    payFromCityId: cityId.optional(), nation: z.object({ from: id, to: id }).optional(),
  }),
  z.object({ type: z.literal('respondTreaty'), treatyId: z.number().int(), accept: z.boolean(), payFromCityId: cityId.optional() }),
  z.object({ type: z.literal('cancelTreaty'), treatyId: z.number().int() }),
  z.object({ type: z.literal('declareWar'), target: id }),
  z.object({ type: z.literal('declareNationalWar'), countryId: id, targetCountryId: id }),
  z.object({
    type: z.literal('proposeContract'), myCityId: cityId, otherCityId: cityId, direction: z.enum(['sell', 'buy']),
    qtyPerDay: z.number().finite(), pricePerUnit: z.number().finite(), days: z.number().finite(),
  }),
  z.object({ type: z.literal('respondContract'), contractId: z.number().int(), accept: z.boolean() }),
  z.object({ type: z.literal('cancelContract'), contractId: z.number().int() }),
  z.object({ type: z.literal('recruit'), cityId, unit, count: z.number().finite() }),
  z.object({
    type: z.literal('moveArmy'), armyId: z.number().int(), toCityId: cityId,
    units: z.object({
      infantry: z.number().finite().optional(), armor: z.number().finite().optional(), artillery: z.number().finite().optional(),
      navy: z.number().finite().optional(), air: z.number().finite().optional(),
    }).optional(),
  }),
  z.object({ type: z.literal('disbandArmy'), armyId: z.number().int() }),
  z.object({ type: z.literal('runForLeader'), countryId: id, run: z.boolean() }),
  z.object({ type: z.literal('vote'), countryId: id, candidateId: id.nullable() }),
  z.object({ type: z.literal('impeach'), countryId: id, support: z.boolean() }),
  z.object({ type: z.literal('resign'), countryId: id }),
  z.object({ type: z.literal('setNationalTax'), countryId: id, rate: z.number().finite() }),
  z.object({ type: z.literal('setLaw'), countryId: id, law: z.enum(['environment', 'minimum_wage', 'public_health', 'conscription', 'education', 'emergency']), enabled: z.boolean() }),
  z.object({ type: z.literal('fundProject'), countryId: id, project: z.enum(['highway', 'power_grid', 'university', 'national_defense', 'trade_fair', 'national_health', 'data_network', 'national_park', 'international_airport']) }),
  z.object({ type: z.literal('nationalGrant'), countryId: id, toCityId: cityId, amount }),
  z.object({ type: z.literal('createOrganization'), name: z.string().trim().min(3).max(40), kind: z.enum(['military', 'trade']) }),
  z.object({ type: z.literal('inviteToOrganization'), orgId: z.number().int(), playerId: id }),
  z.object({ type: z.literal('respondOrganization'), orgId: z.number().int(), accept: z.boolean() }),
  z.object({ type: z.literal('leaveOrganization'), orgId: z.number().int() }),
  z.object({ type: z.literal('expelFromOrganization'), orgId: z.number().int(), playerId: id }),
  z.object({ type: z.literal('setTariff'), countryId: id, rate: z.number().finite() }),
  z.object({ type: z.literal('sendMessage'), to: id, text: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('secede'), cityId: id }),
  z.object({ type: z.literal('rejoinCountry'), cityId: id }),
  z.object({ type: z.literal('transferResidents'), fromCityId: cityId, toCityId: cityId, count: z.number().int().min(1).max(1_000_000) }),
  z.object({ type: z.literal('proposeTwin'), to: id, myCityId: cityId, otherCityId: cityId }),
  z.object({ type: z.literal('annexByForce'), fromCityId: cityId, cityId, troops: z.number().int().min(1).max(1_000_000).optional(), betray: z.boolean().optional() }),
]) satisfies z.ZodType<WorldAction>;

const coord = z.number().finite().min(-10_000).max(10_000);

export const cityCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('build'),
    building: z.enum(BUILDING_TYPES as [BuildingType, ...BuildingType[]]),
    x: coord, y: coord,
    rotation: z.union([z.literal(0), z.literal(90)]),
  }),
  z.object({
    type: z.literal('buildRoad'),
    road: z.enum(ROAD_TYPES as [RoadType, ...RoadType[]]),
    x1: coord, y1: coord, x2: coord, y2: coord,
  }),
  z.object({
    type: z.literal('buildRoadPath'),
    road: z.enum(ROAD_TYPES as [RoadType, ...RoadType[]]),
    points: z.array(z.object({ x: coord, y: coord })).min(2).max(48),
  }),
  z.object({ type: z.literal('demolish'), target: z.enum(['building', 'road']), id: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('setTaxes'),
    taxes: z.object({ residential: z.number(), commercial: z.number(), industrial: z.number() }),
  }),
  z.object({ type: z.literal('borrow'), amount: z.number().positive().max(1e9) }),
  z.object({ type: z.literal('repay'), amount: z.number().positive().max(1e9) }),
  z.object({ type: z.literal('setParkingFee'), id: z.number().int().nonnegative(), fee: z.number().finite().min(0).max(1000) }),
  z.object({ type: z.literal('campaign'), kind: z.enum(['jobs', 'attract']) }),
  z.object({ type: z.literal('moveWorkers'), fromId: z.number().int().nonnegative(), toId: z.number().int().nonnegative(), count: z.number().int().min(1).max(1_000_000) }),
  z.object({ type: z.literal('resetAssignments') }),
  z.object({ type: z.literal('setTransitFare'), mode: z.enum(['bus', 'tram', 'metro']), fee: z.number().finite().min(0).max(100) }),
]) satisfies z.ZodType<CityCommand>;

const reqId = z.number().int().optional();

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('auth'), reqId, token: z.string().max(4096).optional(), devName: z.string().trim().min(2).max(24).optional() }),
  z.object({ t: z.literal('listLobbies'), reqId }),
  z.object({
    t: z.literal('createLobby'), reqId,
    name: z.string().trim().min(3).max(40),
    isPublic: z.boolean(),
    maxPlayers: z.number().int().min(2).max(500),
  }),
  z.object({ t: z.literal('joinLobby'), reqId, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/) }),
  z.object({ t: z.literal('leaveLobby'), reqId }),
  z.object({ t: z.literal('claimCity'), reqId, cityId: z.string().max(40) }),
  /** `force` : annexion d'une ville neutre par l'armée stationnée dans la ville de départ, sans paiement. */
  z.object({ t: z.literal('expandCity'), reqId, fromCityId: z.string().max(40), cityId: z.string().max(40), force: z.boolean().optional(), troops: z.number().int().min(1).max(1_000_000).optional() }),
  z.object({ t: z.literal('command'), reqId, cityId: z.string().max(40), cmd: cityCommandSchema }),
  z.object({ t: z.literal('action'), reqId, action: worldActionSchema }),
  z.object({ t: z.literal('chat'), reqId, text: z.string().trim().min(1).max(500) }),
  z.object({ t: z.literal('friendSearch'), reqId, query: z.string().trim().min(1).max(24) }),
  z.object({ t: z.literal('friendRequest'), reqId, playerId: id }),
  z.object({ t: z.literal('friendAccept'), reqId, playerId: id }),
  z.object({ t: z.literal('friendRemove'), reqId, playerId: id }),
  z.object({ t: z.literal('dmSend'), reqId, to: id, text: z.string().trim().min(1).max(500) }),
  z.object({ t: z.literal('dmHistory'), reqId, with: id }),
  z.object({ t: z.literal('inviteFriend'), reqId, to: id }),
  z.object({ t: z.literal('ping'), reqId }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface LobbyInfo {
  id: string;
  code: string;
  name: string;
  isPublic: boolean;
  maxPlayers: number;
  playerCount: number;
  createdAt: string;
}

/** Joueur trouvé par son pseudo (plusieurs joueurs peuvent porter le même). */
export interface PlayerRef { id: string; name: string }

/** Relation avec un autre joueur : ami, demande reçue, demande envoyée. */
export interface FriendEntry extends PlayerRef {
  status: 'friend' | 'incoming' | 'outgoing';
  online: boolean;
}

/** Message privé entre deux amis, conservé. */
export interface DirectMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  at: string;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  author: string;
  text: string;
  at: string;
}

export interface ClockInfo {
  tick: number;
  tickMs: number;
  /** Ticks rejoués au démarrage du serveur pour rattraper un arrêt (0 si aucun). */
  catchUpTicks: number;
  /** Ticks non simulés car l'arrêt dépassait le plafond de rattrapage. */
  skippedTicks: number;
}

export type ServerMessage =
  | { t: 'authed'; player: { id: string; name: string }; token?: string; authMode: 'dev' | 'supabase' }
  | { t: 'result'; reqId: number; ok: boolean; error?: string; cost?: number }
  | { t: 'error'; message: string }
  | { t: 'lobbies'; lobbies: LobbyInfo[] }
  | {
      t: 'lobbyJoined';
      lobby: LobbyInfo;
      clock: ClockInfo;
      summaries: CitySummary[];
      myCities: CityState[];
      layers: Record<string, CityLayers>;
      world: WorldView;
      chat: ChatMessage[];
      lastSavedAt: number | null;
    }
  | { t: 'lobbyLeft' }
  | { t: 'tick'; tick: number }
  | { t: 'city'; city: CityState; layers: CityLayers }
  | { t: 'cityRemoved'; cityId: string }
  /** Ville jumelée d'un partenaire (lecture seule : historique et état, mis à jour une fois par jour). */
  | { t: 'twinCity'; city: CityState }
  | { t: 'twinRemoved'; cityId: string }
  | {
      t: 'cityStats'; cityId: string; tick: number; treasury: number; debt: number; population: number; taxes: TaxRates;
      stats: CityStats | null;
      /** Envoyé seulement quand un nouvel échantillon d'historique vient d'être ajouté. */
      history?: HistorySample[];
      /** Envoyé seulement quand un nouveau palier vient d'être atteint. */
      milestones?: MilestoneReached[];
    }
  | { t: 'layers'; cityId: string; layers: CityLayers }
  | { t: 'world'; world: WorldView }
  | { t: 'summaries'; summaries: CitySummary[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'friends'; friends: FriendEntry[] }
  | { t: 'friendResults'; players: PlayerRef[] }
  | { t: 'dm'; message: DirectMessage }
  | { t: 'dmHistory'; with: string; messages: DirectMessage[] }
  /** Invitation d'un ami à rejoindre son salon (code à utiliser avec « Rejoindre »). */
  | { t: 'invite'; from: PlayerRef; lobby: { name: string; code: string } }
  | { t: 'saved'; at: number };
