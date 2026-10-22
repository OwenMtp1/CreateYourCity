import type { ChatMessage, CityState, DirectMessage, PlayerRef } from '@cyc/shared';
import type { WorldMeta } from '@cyc/shared/game';
import type { ActionLogEntry, ClaimResult, LobbyClock, LobbyRecord, Store } from './types.ts';

export interface MemoryData {
  players: Record<string, { name: string }>;
  lobbies: Record<string, LobbyRecord>;
  members: Record<string, string[]>;
  cities: Record<string, Record<string, CityState>>;
  chat: Record<string, ChatMessage[]>;
  /** Relations entre joueurs, clé « a|b » avec a < b. */
  friendships: Record<string, { status: 'pending' | 'accepted'; requestedBy: string }>;
  direct: DirectMessage[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const clone = <T>(v: T): T => structuredClone(v);

/** Stockage en mémoire (tests). Les données sont copiées pour imiter une vraie base. */
export class MemoryStore implements Store {
  readonly kind: string = 'memory';
  protected data: MemoryData = { players: {}, lobbies: {}, members: {}, cities: {}, chat: {}, friendships: {}, direct: [] };
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

  async searchPlayers(query: string, excludeId: string, limit: number): Promise<PlayerRef[]> {
    const q = query.toLowerCase();
    return Object.entries(this.data.players)
      .filter(([id, p]) => id !== excludeId && p.name.toLowerCase().includes(q))
      .slice(0, limit)
      .map(([id, p]) => ({ id, name: p.name }));
  }

  async getPlayer(id: string): Promise<PlayerRef | null> {
    const p = this.data.players[id];
    return p ? { id, name: p.name } : null;
  }

  async loadFriendships(playerId: string) {
    return Object.entries(this.data.friendships)
      .filter(([key]) => key.split('|').includes(playerId))
      .map(([key, f]) => ({ other: key.split('|').find((x) => x !== playerId)!, status: f.status, requestedBy: f.requestedBy }));
  }

  async saveFriendship(a: string, b: string, status: 'pending' | 'accepted', requestedBy: string) {
    this.data.friendships[pairKey(a, b)] = { status, requestedBy };
    await this.changed();
  }

  async deleteFriendship(a: string, b: string) {
    delete this.data.friendships[pairKey(a, b)];
    await this.changed();
  }

  async appendDirect(message: DirectMessage) {
    this.data.direct.push(clone(message));
    if (this.data.direct.length > 5000) this.data.direct.splice(0, this.data.direct.length - 5000);
    await this.changed();
  }

  async loadDirect(a: string, b: string, limit: number): Promise<DirectMessage[]> {
    return this.data.direct
      .filter((m) => (m.from === a && m.to === b) || (m.from === b && m.to === a))
      .slice(-limit)
      .map(clone);
  }
}
