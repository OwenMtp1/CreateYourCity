import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export type StoreKind = 'memory' | 'file' | 'postgres';

export interface ServerConfig {
  port: number;
  host: string;
  production: boolean;
  authMode: 'dev' | 'supabase';
  devAuthSecret: string | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseJwtSecret: string | null;
  store: StoreKind;
  databaseUrl: string | null;
  databaseSsl: 'disable' | 'no-verify' | 'verify';
  databaseCaCert: string | null;
  dbAutoMigrate: boolean;
  dataDir: string;
  snapshotIntervalMs: number;
  maxCatchUpHours: number;
  clientDist: string;
  allowedOrigins: string[] | null;
}

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : null;
}

export function loadConfig(): ServerConfig {
  const databaseUrl = env('DATABASE_URL');
  const authMode = env('AUTH_MODE') === 'supabase' ? 'supabase' : 'dev';
  const store = (env('STORE') as StoreKind | null) ?? (databaseUrl ? 'postgres' : 'file');
  if (!['memory', 'file', 'postgres'].includes(store)) throw new Error(`STORE invalide : ${store}`);
  if (store === 'postgres' && !databaseUrl) throw new Error('STORE=postgres exige DATABASE_URL');
  if (authMode === 'supabase' && !env('SUPABASE_URL')) throw new Error('AUTH_MODE=supabase exige SUPABASE_URL');
  const ssl = env('DATABASE_SSL') ?? 'no-verify';
  if (!['disable', 'no-verify', 'verify'].includes(ssl)) throw new Error(`DATABASE_SSL invalide : ${ssl}`);
  return {
    port: Number(env('PORT') ?? 8787),
    host: env('HOST') ?? '0.0.0.0',
    production: process.env.NODE_ENV === 'production',
    authMode,
    devAuthSecret: env('DEV_AUTH_SECRET'),
    supabaseUrl: env('SUPABASE_URL')?.replace(/\/$/, '') ?? null,
    supabaseAnonKey: env('SUPABASE_ANON_KEY'),
    supabaseJwtSecret: env('SUPABASE_JWT_SECRET'),
    store,
    databaseUrl,
    databaseSsl: ssl as ServerConfig['databaseSsl'],
    databaseCaCert: env('DATABASE_CA_CERT')?.replace(/\\n/g, '\n') ?? null,
    dbAutoMigrate: env('DB_AUTO_MIGRATE') !== 'false',
    dataDir: path.resolve(env('DATA_DIR') ?? path.join(here, '../../data')),
    snapshotIntervalMs: Number(env('SNAPSHOT_INTERVAL_MS') ?? 15_000),
    maxCatchUpHours: Number(env('MAX_CATCHUP_HOURS') ?? 24),
    clientDist: path.resolve(env('CLIENT_DIST') ?? path.join(here, '../../client/dist')),
    allowedOrigins: env('ALLOWED_ORIGINS')?.split(',').map((s) => s.trim()) ?? null,
  };
}
