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
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const startedAt = Date.now();

export function createHttpServer(cfg: ServerConfig, game: GameServer, storeKind: string) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), store: storeKind, ...game.stats() }));
      return;
    }
    if (url.pathname === '/api/config') {
      // Valeurs publiques uniquement (la clé anon Supabase est conçue pour être exposée).
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ authMode: cfg.authMode, supabaseUrl: cfg.supabaseUrl, supabaseAnonKey: cfg.supabaseAnonKey }));
      return;
    }
    await serveStatic(cfg.clientDist, url.pathname, req, res);
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 16 * 1024,
    // Seuls les messages de plus de 1 Ko (stats, ville, couches, monde) sont compressés ; sans contexte
    // conservé entre messages pour garder une mémoire faible par connexion.
    perMessageDeflate: {
      threshold: 1024,
      zlibDeflateOptions: { level: 4 },
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      concurrencyLimit: 4,
    },
  });
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

/** Variante précompressée (scripts/compress-dist.mjs) acceptée par le navigateur, si elle existe. */
async function compressedVariant(file: string, acceptEncoding: string) {
  for (const [enc, ext] of [['br', '.br'], ['gzip', '.gz']] as const) {
    if (!acceptEncoding.includes(enc)) continue;
    try {
      const st = await stat(file + ext);
      return { file: file + ext, encoding: enc, size: st.size };
    } catch { /* pas de variante */ }
  }
  return null;
}

async function serveStatic(root: string, pathname: string, req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let safe: string;
  try {
    safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(root, safe);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let st;
  try {
    st = await stat(file);
    if (st.isDirectory()) {
      file = path.join(file, 'index.html');
      st = await stat(file);
    }
  } catch {
    // Application monopage : les chemins inconnus renvoient index.html (sauf fichiers d'assets manquants).
    if (safe.startsWith('assets' + path.sep) || safe.startsWith('assets/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    file = path.join(root, 'index.html');
    try {
      st = await stat(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Client non construit : lancez « npm run build » ou utilisez le serveur Vite (npm run dev).');
      return;
    }
  }
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers: http.OutgoingHttpHeaders = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag,
    vary: 'Accept-Encoding',
    'x-content-type-options': 'nosniff',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  const variant = await compressedVariant(file, String(req.headers['accept-encoding'] ?? ''));
  if (variant) headers['content-encoding'] = variant.encoding;
  headers['content-length'] = variant ? variant.size : st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(variant ? variant.file : file).pipe(res);
}
