// Connexion WebSocket au serveur de jeu, avec reconnexion automatique et reprise de session.
import type { ClientMessage, ServerMessage } from '@cyc/shared';
import { CITY_BY_ID } from '@cyc/shared/world';
import { getState, setState, toast } from '../state.ts';
import { currentToken, rememberedLobby, rememberLobby, setDevToken } from './auth.ts';
import { notifyMilestones } from './milestones.ts';

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

  /** Commande sur la ville active. */
  cityCommand(cmd: Extract<Outgoing, { t: 'command' }>['cmd']): Promise<boolean> {
    const cityId = getState().activeCityId;
    if (!cityId) return Promise.resolve(false);
    return this.act({ t: 'command', cityId, cmd });
  }

  /** Action de niveau monde (diplomatie, commerce, armée, nation). */
  action(action: Extract<Outgoing, { t: 'action' }>['action']): Promise<boolean> {
    return this.act({ t: 'action', action });
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
      case 'myLobbies':
        setState({ myLobbies: msg.lobbies });
        return;
      case 'lobbyClosed':
        rememberLobby(null);
        setState({ lobby: null, myCities: {}, twinCities: {}, twinViewId: null, activeCityId: null, layers: {}, world: null, summaries: [], chat: [], clock: null, view: 'globe' });
        toast(`La partie « ${msg.name} » a été supprimée par son hôte.`, 'error');
        return;
      case 'lobbyJoined': {
        rememberLobby(msg.lobby.code);
        const myCities = Object.fromEntries(msg.myCities.map((c) => [c.cityId, c]));
        const first = msg.myCities[0]?.cityId ?? null;
        setState((s) => ({
          lobby: msg.lobby, clock: msg.clock, tick: msg.clock.tick, summaries: msg.summaries, myCities, layers: msg.layers,
          world: msg.world, chat: msg.chat, lastSavedAt: msg.lastSavedAt,
          activeCityId: s.activeCityId && myCities[s.activeCityId] ? s.activeCityId : first,
          view: s.lobby?.id === msg.lobby.id ? s.view : first ? 'city' : 'globe',
        }));
        // Paliers obtenus pendant l'absence : notifiés au retour (après la mise à jour du salon).
        for (const c of msg.myCities) notifyMilestones(c.cityId, c.milestones);
        return;
      }
      case 'lobbyLeft':
        rememberLobby(null);
        setState({ lobby: null, myCities: {}, twinCities: {}, twinViewId: null, activeCityId: null, layers: {}, world: null, summaries: [], chat: [], clock: null, view: 'globe' });
        return;
      case 'tick':
        setState({ tick: msg.tick });
        return;
      case 'city':
        setState((s) => ({
          myCities: { ...s.myCities, [msg.city.cityId]: msg.city },
          layers: { ...s.layers, [msg.city.cityId]: msg.layers },
          activeCityId: s.activeCityId ?? msg.city.cityId,
        }));
        notifyMilestones(msg.city.cityId, msg.city.milestones);
        return;
      case 'twinCity':
        setState((s) => ({ twinCities: { ...s.twinCities, [msg.city.cityId]: msg.city } }));
        break;
      case 'twinRemoved':
        setState((s) => {
          const twinCities = { ...s.twinCities };
          delete twinCities[msg.cityId];
          return { twinCities, twinViewId: s.twinViewId === msg.cityId ? null : s.twinViewId };
        });
        break;
      case 'cityRemoved': {
        const name = CITY_BY_ID.get(msg.cityId)?.name ?? msg.cityId;
        toast(`Vous ne contrôlez plus ${name}.`, 'error');
        setState((s) => {
          const myCities = { ...s.myCities };
          delete myCities[msg.cityId];
          const activeCityId = s.activeCityId === msg.cityId ? Object.keys(myCities)[0] ?? null : s.activeCityId;
          return { myCities, activeCityId, view: activeCityId ? s.view : 'globe' };
        });
        return;
      }
      case 'cityStats': {
        const { t: _t, cityId, ...update } = msg;
        setState((s) => (s.myCities[cityId] ? { myCities: { ...s.myCities, [cityId]: { ...s.myCities[cityId]!, ...update } } } : {}));
        if (msg.milestones) notifyMilestones(cityId, msg.milestones);
        return;
      }
      case 'layers':
        setState((s) => ({ layers: { ...s.layers, [msg.cityId]: msg.layers } }));
        return;
      case 'world':
        setState({ world: msg.world });
        return;
      case 'summaries':
        setState({ summaries: msg.summaries });
        return;
      case 'chat':
        setState((s) => ({ chat: [...s.chat, msg.message].slice(-100) }));
        return;
      case 'friends':
        setState({ friends: msg.friends });
        return;
      case 'friendResults':
        setState({ friendResults: msg.players });
        return;
      case 'dm': {
        const me = getState().player?.id;
        const other = msg.message.from === me ? msg.message.to : msg.message.from;
        setState((s) => ({ dms: { ...s.dms, [other]: [...(s.dms[other] ?? []), msg.message].slice(-200) } }));
        return;
      }
      case 'dmHistory':
        setState((s) => ({ dms: { ...s.dms, [msg.with]: msg.messages } }));
        return;
      case 'invite':
        setState((s) => ({ invites: [...s.invites, { id: Date.now(), from: msg.from, lobby: msg.lobby }] }));
        toast(`${msg.from.name} vous invite à « ${msg.lobby.name} ».`);
        return;
      case 'saved':
        setState({ lastSavedAt: msg.at });
        return;
    }
  }
}

export const client = new GameClient();
