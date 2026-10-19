import type { ChatMessage, CityState } from '@cyc/shared';
import type { WorldMeta } from '@cyc/shared/game';
import type { ActionLogEntry, ClaimResult, LobbyClock, LobbyRecord, Store } from './types.ts';

export interface MemoryData {
  players: Record<string, { name: string }>;
  lobbies: Record<string, LobbyRecord>;
  members: Record<string, string[]>;
  cities: Record<string, Record<string, CityState>>;
  chat: Record<string, ChatMessage[]>;
}

const clone = <T>(v: T): T => structuredClone(v);

/** Stockage en mémoire (tests). Les données sont copiées pour imiter une vraie base. */
export class MemoryStore implements Store {
  readonly kind: string = 'memory';
  protected data: MemoryData = { players: {}, lobbies: {}, members: {}, cities: {}, chat: {} };
  readonly actions: ActionLogEntry[] = [];

  async init(): Promise<void> {}
  async close(): Promise<void> {}
  protected async changed(): Promise<void> {}

  async upsertPlayer(id: string, name: string) {
    this.data.players[id] = { name };
    await this.changed();
  }

  async loadLobbies() { return Object.values(this.data.lobbies).map(clone); }

  async createLobby(lobby: LobbyRecord) {
    if (Object.values(this.data.lobbies).some((l) => l.code === lobby.code)) throw new Error('code déjà utilisé');
    this.data.lobbies[lobby.id] = clone(lobby);
    this.data.members[lobby.id] = [];
    this.data.cities[lobby.id] = {};
    this.data.chat[lobby.id] = [];
    await this.changed();
  }

  async loadMembers(lobbyId: string) { return [...(this.data.members[lobbyId] ?? [])]; }

  async addMember(lobbyId: string, playerId: string) {
    const list = (this.data.members[lobbyId] ??= []);
    if (!list.includes(playerId)) list.push(playerId);
    await this.changed();
  }

  async loadCities(lobbyId: string) { return Object.values(this.data.cities[lobbyId] ?? {}).map(clone); }

  async claimCity(lobbyId: string, city: CityState): Promise<ClaimResult> {
    const cities = (this.data.cities[lobbyId] ??= {});
    if (cities[city.cityId]) return 'city_taken';
    cities[city.cityId] = clone(city);
    await this.changed();
    return 'ok';
  }

  async saveSnapshot(lobbyId: string, clock: LobbyClock, cities: CityState[], world: WorldMeta) {
    const lobby = this.data.lobbies[lobbyId];
    if (!lobby) throw new Error('salon inconnu');
    lobby.tick = clock.tick;
    lobby.lastSimulatedAt = clock.lastSimulatedAt;
    lobby.world = clone(world);
    const stored = (this.data.cities[lobbyId] ??= {});
    for (const c of cities) {
      // Seules les villes déjà attribuées (claimCity) sont mises à jour.
      if (stored[c.cityId]) stored[c.cityId] = clone(c);
    }
    await this.changed();
  }

  async logAction(entry: ActionLogEntry) { this.actions.push(clone(entry)); }

  async appendChat(lobbyId: string, message: ChatMessage) {
    const list = (this.data.chat[lobbyId] ??= []);
    list.push(clone(message));
    if (list.length > 200) list.splice(0, list.length - 200);
    await this.changed();
  }

  async loadChat(lobbyId: string, limit: number) { return (this.data.chat[lobbyId] ?? []).slice(-limit).map(clone); }
}
