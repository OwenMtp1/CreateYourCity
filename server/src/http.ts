// Serveur HTTP : santé, configuration publique du client, fichiers statiques du client et WebSocket.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerConfig } from './config.ts';
import type { GameServer } from './game/gameServer.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const startedAt = Date.now();

export function createHttpServer(cfg: ServerConfig, game: GameServer, storeKind: string) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), store: storeKind, ...game.stats() }));
      return;
    }
    if (url.pathname === '/api/config') {
      // Valeurs publiques uniquement (la clé anon Supabase est conçue pour être exposée).
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ authMode: cfg.authMode, supabaseUrl: cfg.supabaseUrl, supabaseAnonKey: cfg.supabaseAnonKey }));
      return;
    }
    await serveStatic(cfg.clientDist, url.pathname, res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws: WebSocket, req) => {
    if (!game.ready) {
      ws.close(1013, 'Serveur en cours de démarrage');
      return;
    }
    const origin = req.headers.origin;
    if (cfg.allowedOrigins && origin && !cfg.allowedOrigins.includes(origin)) {
      ws.close(1008, 'Origine non autorisée');
      return;
    }
    const session = game.connect({
      send: (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
      close: (code, reason) => ws.close(code, reason),
    });
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    // Les messages d'une connexion sont traités dans l'ordre d'arrivée.
    let queue = Promise.resolve();
    ws.on('message', (data) => {
      queue = queue.then(() => game.handleRaw(session, data.toString())).catch((e) => console.error('[ws]', e));
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      game.disconnect(session);
    });
  });
  return server;
}

async function serveStatic(root: string, pathname: string, res: http.ServerResponse) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = path.join(root, safe);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    // Application monopage : les chemins inconnus renvoient index.html.
    file = path.join(root, 'index.html');
  }
  try {
    await stat(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Client non construit : lancez « npm run build » ou utilisez le serveur Vite (npm run dev).');
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
