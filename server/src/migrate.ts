// npm run db:migrate : applique les migrations SQL sur DATABASE_URL.
import { loadConfig } from './config.ts';
import { PostgresStore, runMigrations } from './store/postgres.ts';

const cfg = loadConfig();
if (!cfg.databaseUrl) {
  console.error('DATABASE_URL manquant.');
  process.exit(1);
}
const store = new PostgresStore({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl, caCert: cfg.databaseCaCert, autoMigrate: false });
try {
  const applied = await runMigrations(store.pool);
  console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour.');
} finally {
  await store.close();
}
