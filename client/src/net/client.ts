// Connexion WebSocket au serveur de jeu, avec reconnexion automatique et reprise de session.
import type { ClientMessage, ServerMessage } from '@cyc/shared';
import { getState, setState, toast } from '../state.ts';
import { currentToken, rememberedLobby, rememberLobby, setDevToken } from './auth.ts';

type Result = Extract<ServerMessage, { t: 'result' }>;
type Outgoing = ClientMessage extends infer M ? (M extends { reqId?: number } ? Omit<M, 'reqId'> : never) : never;

class GameClient {
  private ws: WebSocket | null = null;
  private reqId = 0;
  private readonly pending = new Map<number, (r: Result) => void>();
  private retry = 0;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.open();
  }

  private open() {
    setState({ status: 'connecting' });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      setState({ status: 'online' });
      void this.resume();
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMessage);
    ws.onclose = () => {
      this.ws = null;
      for (const resolve of this.pending.values()) resolve({ t: 'result', reqId: -1, ok: false, error: 'Connexion perdue.' });
      this.pending.clear();
      setState({ status: 'offline' });
      const delay = Math.min(15_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  /** Après (re)connexion : ré-authentification puis retour dans le dernier salon. */
  private async resume() {
    const token = await currentToken();
    if (!token) return;
    const res = await this.request({ t: 'auth', token });
    if (!res.ok) {
      setDevToken(null);
      setState({ player: null, authError: res.error ?? null });
      return;
    }
    const code = getState().lobby?.code ?? rememberedLobby();
    if (code) {
      const join = await this.request({ t: 'joinLobby', code });
      if (!join.ok) rememberLobby(null);
    }
    void this.request({ t: 'listLobbies' });
  }

  request(msg: Outgoing): Promise<Result> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ t: 'result', reqId: -1, ok: false, error: 'Hors ligne.' });
    const reqId = ++this.reqId;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      ws.send(JSON.stringify({ ...msg, reqId }));
    });
  }

  /** Requête avec affichage automatique de l'erreur. */
  async act(msg: Outgoing): Promise<boolean> {
    const res = await this.request(msg);
    if (!res.ok) toast(res.error ?? 'Action refusée.', 'error');
    return res.ok;
  }

  private onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case 'result': {
        const resolve = this.pending.get(msg.reqId);
        this.pending.delete(msg.reqId);
        resolve?.(msg);
        return;
      }
      case 'authed':
        if (msg.token) setDevToken(msg.token);
        setState({ player: msg.player, authMode: msg.authMode, authError: null });
        return;
      case 'error':
        toast(msg.message, 'error');
        return;
      case 'lobbies':
        setState({ lobbies: msg.lobbies });
        return;
      case 'lobbyJoined':
        rememberLobby(msg.lobby.code);
        setState({
          lobby: msg.lobby, clock: msg.clock, tick: msg.clock.tick, summaries: msg.summaries, myCity: msg.myCity,
          layers: msg.layers, chat: msg.chat, lastSavedAt: msg.lastSavedAt,
        });
        return;
      case 'lobbyLeft':
        rememberLobby(null);
        setState({ lobby: null, myCity: null, layers: null, summaries: [], chat: [], clock: null });
        return;
      case 'tick':
        setState({ tick: msg.tick });
        return;
      case 'city':
        setState({ myCity: msg.city, layers: msg.layers });
        return;
      case 'cityStats': {
        const { t: _t, ...update } = msg;
        setState((s) => (s.myCity ? { myCity: { ...s.myCity, ...update } } : {}));
        return;
      }
      case 'layers':
        setState({ layers: msg.layers });
        return;
      case 'summaries':
        setState({ summaries: msg.summaries });
        return;
      case 'chat':
        setState((s) => ({ chat: [...s.chat, msg.message].slice(-100) }));
        return;
      case 'saved':
        setState({ lastSavedAt: msg.at });
        return;
    }
  }
}

export const client = new GameClient();
