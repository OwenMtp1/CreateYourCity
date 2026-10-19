// Garantit qu'une seule instance simule le monde à la fois (déploiements Render sans interruption,
// redémarrages) grâce à un verrou consultatif PostgreSQL tenu par une connexion dédiée.
import pg from 'pg';

const WORLD_LOCK_KEY = 727_275;

export async function acquireWorldLock(pool: pg.Pool, onLost: () => void): Promise<pg.PoolClient> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [WORLD_LOCK_KEY]);
    if (rows[0]?.ok) {
      // Si la connexion qui tient le verrou tombe, une autre instance peut le prendre :
      // cette instance doit alors cesser immédiatement de simuler.
      client.on('error', onLost);
      client.on('end', onLost);
      return client;
    }
    client.release();
    if (attempt % 10 === 0) console.log('[autorité] une autre instance simule le monde ; attente du verrou…');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
