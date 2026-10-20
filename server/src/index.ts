import { TICK_MS } from '@cyc/shared';
import { Authenticator } from './auth.ts';
import { loadConfig } from './config.ts';
import { GameServer } from './game/gameServer.ts';
import { createHttpServer } from './http.ts';
import { acquireWorldLock } from './leader.ts';
import { createStore } from './store/index.ts';
import { PostgresStore } from './store/postgres.ts';

/**
 * Erreur fatale au démarrage : message lisible et piste de correction, en dernières lignes du journal
 * (Render n'affiche souvent que la fin : « npm error Lifecycle script start failed »).
 */
function fatal(stage: string, e: unknown): never {
  const err = e as { message?: string; code?: string };
  const msg = err?.message ?? String(e);
  const code = err?.code ?? '';
  const hints: [RegExp, string][] = [
    [/ENETUNREACH|EHOSTUNREACH/, "La base n'est pas joignable (souvent l'adresse IPv6 « db.xxx.supabase.co »). Utilisez l'URL du pooler Supabase (Connect → Session pooler, hôte aws-…pooler.supabase.com, port 5432) dans DATABASE_URL."],
    [/ENOTFOUND|EAI_AGAIN/, "Nom d'hôte de DATABASE_URL introuvable : recopiez l'URL depuis Supabase (Connect → Session pooler)."],
    [/password authentication failed|28P01/, 'Mot de passe de la base refusé : vérifiez le mot de passe dans DATABASE_URL (caractères spéciaux encodés, ex. @ → %40).'],
    [/Tenant or user not found/, "Utilisateur du pooler incorrect : il doit être de la forme postgres.<référence du projet>."],
    [/self[- ]signed|certificate/i, 'Certificat TLS refusé : mettez DATABASE_SSL=no-verify.'],
    [/ECONNREFUSED|ETIMEDOUT|timeout/i, "Connexion à la base refusée ou trop lente : vérifiez l'hôte et le port de DATABASE_URL et que le projet Supabase n'est pas en pause."],
    [/exige|invalide/, 'Variable d\'environnement manquante ou invalide dans Render (Environment).'],
  ];
  const hint = hints.find(([re]) => re.test(msg) || re.test(code))?.[1];
  console.error(`[démarrage] échec (${stage}) : ${msg}${code ? ` [${code}]` : ''}`);
  if (hint) console.error(`[démarrage] piste : ${hint}`);
  process.exit(1);
}

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig();
} catch (e) {
  fatal('configuration', e);
}
const store = createStore(cfg);
await store.init().catch((e: unknown) => fatal('base de données', e));

if (cfg.production && cfg.authMode === 'dev') {
  console.warn('[auth] ATTENTION : AUTH_MODE=dev en production. Utilisez AUTH_MODE=supabase pour un vrai monde partagé.');
}
if (cfg.store !== 'postgres') {
  console.warn(`[stockage] STORE=${cfg.store} : pas de base de données, réservé au développement local.`);
}

const game = new GameServer(store, new Authenticator(cfg), {
  snapshotIntervalMs: cfg.snapshotIntervalMs,
  maxCatchUpTicks: Math.round((cfg.maxCatchUpHours * 3_600_000) / TICK_MS),
});

// Le serveur HTTP écoute tout de suite (contrôle de santé), mais refuse les joueurs tant que
// cette instance n'est pas l'autorité du monde.
const server = createHttpServer(cfg, game, store.kind);
server.listen(cfg.port, cfg.host, () => {
  console.log(`[serveur] http://${cfg.host}:${cfg.port} — stockage ${store.kind}, auth ${cfg.authMode}, tick ${TICK_MS} ms`);
});

let worldLock: Awaited<ReturnType<typeof acquireWorldLock>> | null = null;
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[serveur] ${signal} : sauvegarde finale…`);
  server.close();
  await game.stop();
  if (worldLock) {
    // Fermer la connexion du verrou le libère pour l'instance suivante.
    worldLock.removeAllListeners('end');
    worldLock.removeAllListeners('error');
    worldLock.release(true);
  }
  await store.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

if (store instanceof PostgresStore) {
  worldLock = await acquireWorldLock(store.pool, () => {
    console.error("[autorité] verrou du monde perdu : arrêt immédiat pour éviter deux simulations concurrentes.");
    process.exit(1);
  }).catch((e: unknown) => fatal('verrou du monde', e));
}
await game.load().catch((e: unknown) => fatal('chargement du monde', e));
game.start();
console.log('[serveur] monde chargé, simulation en cours.');
