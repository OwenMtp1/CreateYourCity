// Protocole WebSocket. Les messages client sont validés côté serveur avec zod ;
// le serveur ne fait jamais confiance aux montants, propriétaires ou coûts envoyés.
import { z } from 'zod';
import { BUILDING_TYPES, ROAD_TYPES, type BuildingType, type RoadType } from './catalog.ts';
import type { CityCommand } from './commands.ts';
import type { CityLayers, CityState, CityStats, CitySummary, TaxRates } from './types.ts';

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
  z.object({ type: z.literal('demolish'), target: z.enum(['building', 'road']), id: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('setTaxes'),
    taxes: z.object({ residential: z.number(), commercial: z.number(), industrial: z.number() }),
  }),
  z.object({ type: z.literal('borrow'), amount: z.number().positive().max(1e9) }),
  z.object({ type: z.literal('repay'), amount: z.number().positive().max(1e9) }),
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
  z.object({ t: z.literal('command'), reqId, cmd: cityCommandSchema }),
  z.object({ t: z.literal('chat'), reqId, text: z.string().trim().min(1).max(500) }),
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
      myCity: CityState | null;
      layers: CityLayers | null;
      chat: ChatMessage[];
      lastSavedAt: number | null;
    }
  | { t: 'lobbyLeft' }
  | { t: 'tick'; tick: number }
  | { t: 'city'; city: CityState; layers: CityLayers }
  | { t: 'cityStats'; tick: number; treasury: number; debt: number; population: number; taxes: TaxRates; stats: CityStats | null }
  | { t: 'layers'; layers: CityLayers }
  | { t: 'summaries'; summaries: CitySummary[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'saved'; at: number };
