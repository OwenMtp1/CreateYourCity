// État global du client (copie des données reçues du serveur, qui reste l'autorité).
import { useSyncExternalStore } from 'react';
import type { ChatMessage, CityLayers, CityState, CitySummary, ClockInfo, LobbyInfo } from '@cyc/shared';

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface Toast { id: number; kind: 'error' | 'info'; text: string }

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
  myCity: CityState | null;
  layers: CityLayers | null;
  chat: ChatMessage[];
  lastSavedAt: number | null;
  toasts: Toast[];
}

let state: GameState = {
  status: 'connecting', authMode: null, player: null, authError: null, lobbies: [], lobby: null, clock: null, tick: 0,
  summaries: [], myCity: null, layers: null, chat: [], lastSavedAt: null, toasts: [],
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
