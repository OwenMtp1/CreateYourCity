// État global du client (copie des données reçues du serveur, qui reste l'autorité).
import { useSyncExternalStore } from 'react';
import { expose } from './automation.ts';
import { validateBuilding, type ChatMessage, type CityLayers, type CityState, type CitySummary, type ClockInfo, type LobbyInfo } from '@cyc/shared';
import type { WorldView } from '@cyc/shared/game';

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface Toast { id: number; kind: 'error' | 'info' | 'milestone'; text: string; title?: string; icon?: string }

export interface GameState {
  status: ConnStatus;
  authMode: 'dev' | 'supabase' | null;
  player: { id: string; name: string } | null;
  authError: string | null;
  lobbies: LobbyInfo[];
  lobby: LobbyInfo | null;
  clock: ClockInfo | null;
  tick: number;
  summaries: CitySummary[];
  myCities: Record<string, CityState>;
  activeCityId: string | null;
  layers: Record<string, CityLayers>;
  world: WorldView | null;
  view: 'globe' | 'city';
  /** Ville sélectionnée sur le globe. */
  focusCityId: string | null;
  chat: ChatMessage[];
  lastSavedAt: number | null;
  toasts: Toast[];
}

let state: GameState = {
  status: 'connecting', authMode: null, player: null, authError: null, lobbies: [], lobby: null, clock: null, tick: 0,
  summaries: [], myCities: {}, activeCityId: null, layers: {}, world: null, view: 'globe', focusCityId: null, chat: [],
  lastSavedAt: null, toasts: [],
};
const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<GameState> | ((s: GameState) => Partial<GameState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const l of listeners) l();
}

export function useGame<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => selector(state),
  );
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, kind, text }].slice(-4) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 5000 : 3000);
}

/** Notification de palier atteint (plus visible et plus longue qu'un message ordinaire). */
export function milestoneToast(icon: string, title: string, text: string) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, kind: 'milestone' as const, icon, title, text }].slice(-4) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 7000);
}

/** Ville active (vue de construction et panneaux municipaux). */
export const activeCity = (s: GameState): CityState | null => (s.activeCityId ? s.myCities[s.activeCityId] ?? null : null);

expose('state', getState);
expose('setState', setState);
expose('rules', { validateBuilding });
