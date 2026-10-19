import { TICK_MS } from '@cyc/shared';
import { Authenticator } from './auth.ts';
import { loadConfig } from './config.ts';
import { GameServer } from './game/gameServer.ts';
import { createHttpServer } from './http.ts';
import { acquireWorldLock } from './leader.ts';
import { createStore } from './store/index.ts';
import { PostgresStore } from './store/postgres.ts';

const cfg = loadConfig();
const store = createStore(cfg);
await store.init();

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
  });
}
await game.load();
game.start();
console.log('[serveur] monde chargé, simulation en cours.');
