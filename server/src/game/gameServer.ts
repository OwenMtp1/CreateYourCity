// Serveur de jeu autoritaire : sessions, salons, commandes, boucle de simulation et sauvegardes.
import { randomInt, randomUUID } from 'node:crypto';
import {
  applyCityCommand, clientMessageSchema, createCityState, simulateTick, simulateTicks, TICK_MS,
  type ChatMessage, type ClientMessage, type LobbyInfo, type ServerMessage,
} from '@cyc/shared';
import { CITY_BY_ID } from '@cyc/shared/world';
import { AuthError, type Authenticator, type PlayerIdentity } from '../auth.ts';
import { TokenBucket } from '../rateLimit.ts';
import type { LobbyRecord, Store } from '../store/types.ts';
import { LobbyWorld } from './lobbyWorld.ts';

export interface Connection {
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
}

export class Session {
  player: PlayerIdentity | null = null;
  lobbyId: string | null = null;
  readonly commands = new TokenBucket(10, 30);
  readonly chat = new TokenBucket(1, 5);
  constructor(readonly conn: Connection) {}
}

export interface GameServerOptions {
  snapshotIntervalMs: number;
  maxCatchUpTicks: number;
  now?: () => number;
  /** Nombre maximal de ticks exécutés par itération de boucle (évite de bloquer l'event loop). */
  maxTicksPerLoop?: number;
}

const LAYERS_EVERY_TICKS = 5;
const SUMMARIES_EVERY_TICKS = 30;
const MAX_LOBBIES_PER_OWNER = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class UserError extends Error {}

export class GameServer {
  readonly lobbies = new Map<string, LobbyWorld>();
  private readonly byCode = new Map<string, LobbyWorld>();
  private readonly sessions = new Set<Session>();
  private readonly lobbySessions = new Map<string, Set<Session>>();
  private readonly saveChains = new Map<string, Promise<void>>();
  private readonly saveScheduled = new Set<string>();
  private timers: NodeJS.Timeout[] = [];
  /** Vrai une fois le monde chargé : avant, les connexions de joueurs sont refusées. */
  ready = false;
  private readonly now: () => number;

  constructor(
    private readonly store: Store,
    private readonly auth: Authenticator,
    private readonly opts: GameServerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Charge tous les salons depuis le stockage et rattrape le temps écoulé. */
  async load() {
    for (const record of await this.store.loadLobbies()) {
      const world = new LobbyWorld(record);
      for (const m of await this.store.loadMembers(record.id)) world.members.add(m);
      for (const c of await this.store.loadCities(record.id)) world.addCity(c);
      const report = world.restore(this.now(), this.opts.maxCatchUpTicks);
      if (report.simulated || report.skipped) {
        console.log(`[monde] salon ${record.code} : ${report.simulated} ticks rattrapés, ${report.skipped} ticks sautés (plafond)`);
      }
      this.register(world);
    }
    await Promise.all([...this.lobbies.values()].map((w) => this.saveLobby(w)));
    this.ready = true;
  }

  start() {
    this.timers.push(setInterval(() => this.loop(), Math.max(20, TICK_MS / 5)));
    this.timers.push(setInterval(() => {
      for (const w of this.lobbies.values()) void this.saveLobby(w);
    }, this.opts.snapshotIntervalMs));
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (!this.ready) return;
    await Promise.all([...this.lobbies.values()].map((w) => this.saveLobby(w)));
  }

  stats() {
    return { ready: this.ready, lobbies: this.lobbies.size, sessions: this.sessions.size, cities: [...this.lobbies.values()].reduce((a, w) => a + w.cities.size, 0) };
  }

  // --- Boucle de simulation -----------------------------------------------------------------

  loop(now = this.now()) {
    for (const world of this.lobbies.values()) {
      const before = world.tick;
      const n = world.advanceTo(now, this.opts.maxTicksPerLoop ?? 50);
      if (n > 0) this.broadcastTick(world, before);
    }
  }

  private broadcastTick(world: LobbyWorld, previousTick: number) {
    const sessions = this.lobbySessions.get(world.record.id);
    if (!sessions?.size) return;
    const crossed = (every: number) => Math.floor(world.tick / every) > Math.floor(previousTick / every);
    const sendLayers = crossed(LAYERS_EVERY_TICKS);
    const summaries = crossed(SUMMARIES_EVERY_TICKS) ? world.summaries() : null;
    for (const s of sessions) {
      s.conn.send({ t: 'tick', tick: world.tick });
      const city = s.player ? world.cityOf(s.player.id) : undefined;
      if (city) {
        s.conn.send({ t: 'cityStats', tick: city.tick, treasury: city.treasury, debt: city.debt, population: city.population, taxes: city.taxes, stats: city.stats });
        const layers = world.layers.get(city.cityId);
        if (sendLayers && layers) s.conn.send({ t: 'layers', layers });
      }
      if (summaries) s.conn.send({ t: 'summaries', summaries });
    }
  }

  // --- Sauvegardes ------------------------------------------------------------------------

  /** Sauvegarde sérialisée par salon : l'instantané est pris au moment où l'écriture démarre. */
  saveLobby(world: LobbyWorld): Promise<void> {
    const id = world.record.id;
    const chain = (this.saveChains.get(id) ?? Promise.resolve()).then(async () => {
      const clock = { tick: world.record.tick, lastSimulatedAt: world.record.lastSimulatedAt };
      const cities = [...world.cities.values()].map((c) => structuredClone(c));
      try {
        await this.store.saveSnapshot(id, clock, cities);
        world.lastSavedAt = this.now();
        this.toLobby(id, { t: 'saved', at: world.lastSavedAt });
      } catch (e) {
        console.error(`[sauvegarde] salon ${world.record.code} :`, e);
      }
    });
    this.saveChains.set(id, chain);
    return chain;
  }

  /** Sauvegarde rapprochée après une commande (regroupe les commandes successives). */
  private requestSave(world: LobbyWorld) {
    const id = world.record.id;
    if (this.saveScheduled.has(id)) return;
    this.saveScheduled.add(id);
    setTimeout(() => {
      this.saveScheduled.delete(id);
      void this.saveLobby(world);
    }, 250);
  }

  // --- Connexions ---------------------------------------------------------------------------

  connect(conn: Connection): Session {
    const s = new Session(conn);
    this.sessions.add(s);
    return s;
  }

  disconnect(s: Session) {
    this.leaveLobby(s);
    this.sessions.delete(s);
  }

  async handleRaw(s: Session, raw: string) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      s.conn.send({ t: 'error', message: 'Message illisible.' });
      return;
    }
    const parsed = clientMessageSchema.safeParse(data);
    if (!parsed.success) {
      const reqId = (data as { reqId?: unknown })?.reqId;
      const error = 'Requête invalide.';
      s.conn.send(typeof reqId === 'number' ? { t: 'result', reqId, ok: false, error } : { t: 'error', message: error });
      return;
    }
    await this.handle(s, parsed.data);
  }

  async handle(s: Session, msg: ClientMessage) {
    const reply = (ok: boolean, error?: string, cost?: number) => {
      if (msg.reqId !== undefined) s.conn.send({ t: 'result', reqId: msg.reqId, ok, ...(error ? { error } : {}), ...(cost !== undefined ? { cost } : {}) });
    };
    try {
      if (msg.t !== 'ping' && msg.t !== 'chat' && !s.commands.take()) throw new UserError('Trop de requêtes, ralentissez.');
      switch (msg.t) {
        case 'ping': return reply(true);
        case 'auth': return await this.onAuth(s, msg, reply);
      }
      const player = s.player;
      if (!player) throw new UserError('Authentification requise.');
      switch (msg.t) {
        case 'listLobbies':
          s.conn.send({ t: 'lobbies', lobbies: this.publicLobbies() });
          return reply(true);
        case 'createLobby': {
          const world = await this.createLobby(player, msg.name, msg.isPublic, msg.maxPlayers);
          await this.joinLobby(s, player, world);
          return reply(true);
        }
        case 'joinLobby': {
          const world = this.byCode.get(msg.code);
          if (!world) throw new UserError('Aucun salon avec ce code.');
          await this.joinLobby(s, player, world);
          return reply(true);
        }
        case 'leaveLobby':
          this.leaveLobby(s);
          s.conn.send({ t: 'lobbyLeft' });
          return reply(true);
        case 'claimCity':
          await this.claimCity(this.currentLobby(s), player, msg.cityId);
          return reply(true);
        case 'command': {
          const world = this.currentLobby(s);
          const city = world.cityOf(player.id);
          if (!city) throw new UserError("Choisissez d'abord une ville.");
          const res = applyCityCommand(city, msg.cmd);
          if (!res.ok) return reply(false, res.reason);
          reply(true, undefined, res.cost);
          this.sendCity(world, player.id);
          this.requestSave(world);
          await this.store.logAction({ lobbyId: world.record.id, playerId: player.id, action: msg.cmd.type, payload: msg.cmd })
            .catch((e) => console.error('[journal]', e));
          return;
        }
        case 'chat': {
          if (!s.chat.take()) throw new UserError('Trop de messages, patientez.');
          const world = this.currentLobby(s);
          const message: ChatMessage = { id: randomUUID(), playerId: player.id, author: player.name, text: msg.text, at: new Date(this.now()).toISOString() };
          await this.store.appendChat(world.record.id, message);
          this.toLobby(world.record.id, { t: 'chat', message });
          return reply(true);
        }
      }
    } catch (e) {
      if (e instanceof UserError || e instanceof AuthError) return reply(false, e.message);
      console.error('[serveur] erreur inattendue', e);
      return reply(false, 'Erreur interne du serveur.');
    }
  }

  private async onAuth(s: Session, msg: Extract<ClientMessage, { t: 'auth' }>, reply: (ok: boolean, error?: string) => void) {
    let token: string | undefined;
    let player: PlayerIdentity;
    if (msg.token) {
      player = await this.auth.verify(msg.token);
    } else if (msg.devName) {
      ({ player, token } = await this.auth.createDevIdentity(msg.devName));
    } else {
      throw new UserError('Jeton ou nom requis.');
    }
    await this.store.upsertPlayer(player.id, player.name);
    s.player = player;
    s.conn.send({ t: 'authed', player, ...(token ? { token } : {}), authMode: this.auth.mode });
    reply(true);
  }

  // --- Salons ---------------------------------------------------------------------------------

  private register(world: LobbyWorld) {
    this.lobbies.set(world.record.id, world);
    this.byCode.set(world.record.code, world);
  }

  publicLobbies(): LobbyInfo[] {
    return [...this.lobbies.values()]
      .filter((w) => w.record.isPublic)
      .map((w) => w.info())
      .sort((a, b) => b.playerCount - a.playerCount || a.createdAt.localeCompare(b.createdAt))
      .slice(0, 50);
  }

  private async createLobby(player: PlayerIdentity, name: string, isPublic: boolean, maxPlayers: number) {
    const owned = [...this.lobbies.values()].filter((w) => w.record.ownerId === player.id).length;
    if (owned >= MAX_LOBBIES_PER_OWNER) throw new UserError(`Limite de ${MAX_LOBBIES_PER_OWNER} salons créés atteinte.`);
    let code: string;
    do code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (this.byCode.has(code));
    const record: LobbyRecord = {
      id: randomUUID(), code, name, isPublic, maxPlayers, ownerId: player.id,
      createdAt: new Date(this.now()).toISOString(), tick: 0, lastSimulatedAt: this.now(),
    };
    await this.store.createLobby(record);
    const world = new LobbyWorld(record);
    this.register(world);
    return world;
  }

  private async joinLobby(s: Session, player: PlayerIdentity, world: LobbyWorld) {
    if (!world.members.has(player.id)) {
      if (world.members.size >= world.record.maxPlayers) throw new UserError('Salon complet.');
      world.members.add(player.id);
      await this.store.addMember(world.record.id, player.id);
    }
    this.leaveLobby(s);
    s.lobbyId = world.record.id;
    let set = this.lobbySessions.get(world.record.id);
    if (!set) this.lobbySessions.set(world.record.id, (set = new Set()));
    set.add(s);
    const city = world.cityOf(player.id) ?? null;
    s.conn.send({
      t: 'lobbyJoined',
      lobby: world.info(),
      clock: { tick: world.tick, tickMs: TICK_MS, catchUpTicks: world.catchUp.simulated, skippedTicks: world.catchUp.skipped },
      summaries: world.summaries(),
      myCity: city,
      layers: city ? (world.layers.get(city.cityId) ?? null) : null,
      chat: await this.store.loadChat(world.record.id, 50),
      lastSavedAt: world.lastSavedAt,
    });
  }

  private leaveLobby(s: Session) {
    if (s.lobbyId) this.lobbySessions.get(s.lobbyId)?.delete(s);
    s.lobbyId = null;
  }

  private currentLobby(s: Session): LobbyWorld {
    const world = s.lobbyId ? this.lobbies.get(s.lobbyId) : undefined;
    if (!world) throw new UserError("Rejoignez d'abord un salon.");
    return world;
  }

  // --- Villes ---------------------------------------------------------------------------------

  private async claimCity(world: LobbyWorld, player: PlayerIdentity, cityId: string) {
    if (!world.members.has(player.id)) throw new UserError("Vous n'êtes pas membre de ce salon.");
    if (world.cityByOwner.has(player.id)) throw new UserError('Vous dirigez déjà une ville dans ce salon.');
    const wc = CITY_BY_ID.get(cityId);
    if (!wc) throw new UserError('Ville inconnue.');
    const ownerKey = `owner:${player.id}`;
    if (world.cities.has(cityId) || world.pendingClaims.has(cityId)) throw new UserError('Cette ville appartient déjà à un joueur.');
    if (world.pendingClaims.has(ownerKey)) throw new UserError('Revendication déjà en cours.');
    world.pendingClaims.add(cityId);
    world.pendingClaims.add(ownerKey);
    try {
      const city = createCityState({ cityId, countryId: wc.countryId, ownerId: player.id, ownerName: player.name, tick: world.tick });
      const res = await this.store.claimCity(world.record.id, city);
      if (res === 'city_taken') throw new UserError('Cette ville appartient déjà à un joueur.');
      if (res === 'player_has_city') throw new UserError('Vous dirigez déjà une ville dans ce salon.');
      // Des ticks ont pu s'écouler pendant l'écriture : la ville rattrape l'horloge du salon.
      if (city.tick < world.tick) simulateTicks(city, world.tick - city.tick);
      world.addCity(city);
      await this.store.logAction({ lobbyId: world.record.id, playerId: player.id, action: 'claimCity', payload: { cityId } })
        .catch((e) => console.error('[journal]', e));
    } finally {
      world.pendingClaims.delete(cityId);
      world.pendingClaims.delete(ownerKey);
    }
    this.sendCity(world, player.id);
    this.toLobby(world.record.id, { t: 'summaries', summaries: world.summaries() });
  }

  /** Envoie l'état complet de la ville à toutes les sessions de son propriétaire. */
  private sendCity(world: LobbyWorld, playerId: string) {
    const city = world.cityOf(playerId);
    if (!city) return;
    // Couches recalculées sur une copie : l'état réel n'avance que lors des ticks.
    const layers = simulateTick(structuredClone(city));
    world.layers.set(city.cityId, layers);
    for (const s of this.lobbySessions.get(world.record.id) ?? []) {
      if (s.player?.id === playerId) s.conn.send({ t: 'city', city, layers });
    }
  }

  private toLobby(lobbyId: string, msg: ServerMessage) {
    for (const s of this.lobbySessions.get(lobbyId) ?? []) s.conn.send(msg);
  }
}
