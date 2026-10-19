import type { ServerMessage } from '@cyc/shared';
import { Authenticator } from '../src/auth.ts';
import type { ServerConfig } from '../src/config.ts';
import { GameServer, type Session } from '../src/game/gameServer.ts';
import type { Store } from '../src/store/types.ts';

export const testConfig: ServerConfig = {
  port: 0, host: '127.0.0.1', production: false, authMode: 'dev', devAuthSecret: 'test-secret',
  supabaseUrl: null, supabaseAnonKey: null, supabaseJwtSecret: null, store: 'memory', databaseUrl: null,
  databaseSsl: 'disable', databaseCaCert: null, dbAutoMigrate: true, dataDir: '', snapshotIntervalMs: 60_000,
  maxCatchUpHours: 24, clientDist: '/nonexistent', allowedOrigins: null,
};

export class FakeClock {
  constructor(public t = 1_700_000_000_000) {}
  now = () => this.t;
}

/** Serveur de jeu chargé depuis le stockage (comme au démarrage réel). */
export async function makeServer(store: Store, clock: FakeClock, maxCatchUpTicks = 86_400) {
  const game = new GameServer(store, new Authenticator(testConfig), { snapshotIntervalMs: 60_000, maxCatchUpTicks, now: clock.now, maxTicksPerLoop: 100_000 });
  await game.load();
  return game;
}

export interface TestClient {
  session: Session;
  messages: ServerMessage[];
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined;
  send(msg: Record<string, unknown>): Promise<Extract<ServerMessage, { t: 'result' }>>;
}

let reqCounter = 0;

export function connectClient(game: GameServer): TestClient {
  const messages: ServerMessage[] = [];
  const session = game.connect({ send: (m) => messages.push(JSON.parse(JSON.stringify(m)) as ServerMessage), close: () => {} });
  return {
    session,
    messages,
    last(t) {
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.t === t) return messages[i] as never;
      return undefined;
    },
    async send(msg) {
      const reqId = ++reqCounter;
      await game.handleRaw(session, JSON.stringify({ ...msg, reqId }));
      const res = messages.find((m) => m.t === 'result' && m.reqId === reqId);
      if (!res || res.t !== 'result') throw new Error('pas de réponse');
      return res;
    },
  };
}
