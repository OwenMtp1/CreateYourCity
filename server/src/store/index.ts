import type { ServerConfig } from '../config.ts';
import { FileStore } from './file.ts';
import { MemoryStore } from './memory.ts';
import { PostgresStore } from './postgres.ts';
import type { Store } from './types.ts';

export function createStore(cfg: ServerConfig): Store {
  switch (cfg.store) {
    case 'memory': return new MemoryStore();
    case 'file': return new FileStore(cfg.dataDir);
    case 'postgres':
      return new PostgresStore({
        connectionString: cfg.databaseUrl!,
        ssl: cfg.databaseSsl,
        caCert: cfg.databaseCaCert,
        autoMigrate: cfg.dbAutoMigrate,
      });
  }
}
