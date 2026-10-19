// Stockage PostgreSQL (Supabase en production). Connexion directe du serveur de jeu.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrateCityState, type ChatMessage, type CityState } from '@cyc/shared';
import { migrateWorldMeta, type WorldMeta } from '@cyc/shared/game';
import type { ActionLogEntry, ClaimResult, LobbyClock, LobbyRecord, Store } from './types.ts';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

export interface PostgresOptions {
  connectionString: string;
  ssl: 'disable' | 'no-verify' | 'verify';
  caCert?: string | null;
  autoMigrate: boolean;
}

export class PostgresStore implements Store {
  readonly kind = 'postgres';
  readonly pool: pg.Pool;

  constructor(private readonly opts: PostgresOptions) {
    const ssl =
      opts.ssl === 'disable' ? false
        : opts.ssl === 'verify' ? { rejectUnauthorized: true, ...(opts.caCert ? { ca: opts.caCert } : {}) }
          : { rejectUnauthorized: false };
    // sslmode dans l'URL écraserait l'option ssl : on le retire et on applique DATABASE_SSL.
    const url = new URL(opts.connectionString);
    url.searchParams.delete('sslmode');
    this.pool = new pg.Pool({ connectionString: url.toString(), ssl, max: 5 });
    this.pool.on('error', (e) => console.error('[postgres] erreur de connexion inactive', e));
  }

  async init() {
    if (this.opts.autoMigrate) await runMigrations(this.pool);
  }

  async close() { await this.pool.end(); }

  async upsertPlayer(id: string, name: string) {
    await this.pool.query(
      `insert into players (id, display_name) values ($1, $2)
       on conflict (id) do update set display_name = excluded.display_name, updated_at = now()`,
      [id, name],
    );
  }

  async loadLobbies(): Promise<LobbyRecord[]> {
    const { rows } = await this.pool.query(
      `select id, code, name, is_public, max_players, owner_id, created_at, tick, last_simulated_at, world from lobbies`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isPublic: r.is_public,
      maxPlayers: r.max_players,
      ownerId: r.owner_id,
      createdAt: new Date(r.created_at).toISOString(),
      tick: Number(r.tick),
      lastSimulatedAt: new Date(r.last_simulated_at).getTime(),
      world: r.world && Object.keys(r.world).length ? migrateWorldMeta(r.world) : null,
    }));
  }

  async createLobby(l: LobbyRecord) {
    await this.pool.query(
      `insert into lobbies (id, code, name, is_public, max_players, owner_id, created_at, tick, last_simulated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [l.id, l.code, l.name, l.isPublic, l.maxPlayers, l.ownerId, l.createdAt, l.tick, new Date(l.lastSimulatedAt)],
    );
  }

  async loadMembers(lobbyId: string) {
    const { rows } = await this.pool.query(`select player_id from lobby_members where lobby_id = $1 order by joined_at`, [lobbyId]);
    return rows.map((r) => r.player_id as string);
  }

  async addMember(lobbyId: string, playerId: string) {
    await this.pool.query(
      `insert into lobby_members (lobby_id, player_id) values ($1, $2) on conflict do nothing`,
      [lobbyId, playerId],
    );
  }

  async loadCities(lobbyId: string): Promise<CityState[]> {
    const { rows } = await this.pool.query(`select state from cities where lobby_id = $1`, [lobbyId]);
    return rows.map((r) => migrateCityState(r.state));
  }

  async claimCity(lobbyId: string, city: CityState): Promise<ClaimResult> {
    try {
      await this.pool.query(
        `insert into cities (lobby_id, city_id, owner_id, country_id, schema_version, tick, state)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [lobbyId, city.cityId, city.ownerId, city.countryId, city.schemaVersion, city.tick, city],
      );
      return 'ok';
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505') return 'city_taken';
      throw e;
    }
  }

  async saveSnapshot(lobbyId: string, clock: LobbyClock, cities: CityState[], world: WorldMeta) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`update lobbies set tick = $2, last_simulated_at = $3, world = $4 where id = $1`, [
        lobbyId, clock.tick, new Date(clock.lastSimulatedAt), JSON.stringify(world),
      ]);
      for (const c of cities) {
        // Le propriétaire peut avoir changé (cession, conquête) : il est réécrit avec l'état.
        await client.query(
          `update cities set state = $4, tick = $5, schema_version = $6, owner_id = $3, updated_at = now()
           where lobby_id = $1 and city_id = $2`,
          [lobbyId, c.cityId, c.ownerId, c, c.tick, c.schemaVersion],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async logAction(entry: ActionLogEntry) {
    await this.pool.query(`insert into action_log (lobby_id, player_id, action, payload) values ($1, $2, $3, $4)`, [
      entry.lobbyId, entry.playerId, entry.action, JSON.stringify(entry.payload ?? null),
    ]);
  }

  async appendChat(lobbyId: string, m: ChatMessage) {
    await this.pool.query(
      `insert into chat_messages (id, lobby_id, player_id, author, text, created_at) values ($1, $2, $3, $4, $5, $6)`,
      [m.id, lobbyId, m.playerId, m.author, m.text, m.at],
    );
  }

  async loadChat(lobbyId: string, limit: number): Promise<ChatMessage[]> {
    const { rows } = await this.pool.query(
      `select id, player_id, author, text, created_at from chat_messages where lobby_id = $1 order by created_at desc limit $2`,
      [lobbyId, limit],
    );
    return rows.reverse().map((r) => ({
      id: r.id, playerId: r.player_id, author: r.author, text: r.text, at: new Date(r.created_at).toISOString(),
    }));
  }
}

/** Applique les fichiers de supabase/migrations non encore appliqués (verrou consultatif). */
export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const { rows } = await client.query(`select name from schema_migrations`);
    const done = new Set(rows.map((r) => r.name as string));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(`insert into schema_migrations (name) values ($1)`, [f]);
        await client.query('commit');
        applied.push(f);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migration ${f} échouée : ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
  return applied;
}
