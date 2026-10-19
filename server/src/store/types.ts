import type { ChatMessage, CityState } from '@cyc/shared';
import type { WorldMeta } from '@cyc/shared/game';

export interface LobbyRecord {
  id: string;
  code: string;
  name: string;
  isPublic: boolean;
  maxPlayers: number;
  ownerId: string;
  createdAt: string;
  /** Horloge du monde : dernier tick simulé et instant réel correspondant (ms epoch). */
  tick: number;
  lastSimulatedAt: number;
  /** État global du monde (diplomatie, armées, nations…), null pour un salon jamais simulé. */
  world: WorldMeta | null;
}

export interface LobbyClock { tick: number; lastSimulatedAt: number }

export type ClaimResult = 'ok' | 'city_taken';

export interface ActionLogEntry {
  lobbyId: string;
  playerId: string;
  action: string;
  payload: unknown;
}

/**
 * Persistance. Le serveur de jeu est l'autorité en mémoire ; le stockage garantit
 * l'unicité des propriétaires (transaction) et conserve des instantanés cohérents.
 */
export interface Store {
  readonly kind: string;
  init(): Promise<void>;
  close(): Promise<void>;
  upsertPlayer(id: string, name: string): Promise<void>;
  loadLobbies(): Promise<LobbyRecord[]>;
  createLobby(lobby: LobbyRecord): Promise<void>;
  loadMembers(lobbyId: string): Promise<string[]>;
  addMember(lobbyId: string, playerId: string): Promise<void>;
  loadCities(lobbyId: string): Promise<CityState[]>;
  /** Attribution atomique : une ville = un propriétaire (première ville ou expansion). */
  claimCity(lobbyId: string, city: CityState): Promise<ClaimResult>;
  /** Enregistre l'horloge, l'état du monde et les villes dans une même transaction. */
  saveSnapshot(lobbyId: string, clock: LobbyClock, cities: CityState[], world: WorldMeta): Promise<void>;
  logAction(entry: ActionLogEntry): Promise<void>;
  appendChat(lobbyId: string, message: ChatMessage): Promise<void>;
  loadChat(lobbyId: string, limit: number): Promise<ChatMessage[]>;
}
