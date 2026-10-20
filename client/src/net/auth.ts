// Identifiants envoyés au serveur : jeton Supabase (session gérée par supabase-js) ou jeton invité.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublicConfig { authMode: 'dev' | 'supabase'; supabaseUrl: string | null; supabaseAnonKey: string | null }

const DEV_TOKEN_KEY = 'cyc.devToken';
let supabase: SupabaseClient | null = null;
let config: PublicConfig | null = null;

export async function loadPublicConfig(): Promise<PublicConfig> {
  if (config) return config;
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Serveur de jeu injoignable');
  config = (await res.json()) as PublicConfig;
  if (config.authMode === 'supabase' && config.supabaseUrl && config.supabaseAnonKey) {
    // Chargé à la demande : le mode invité n'a pas besoin de supabase-js.
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  return config;
}

export const getSupabase = () => supabase;

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function getDevToken(): string | null {
  try { return storage()?.getItem(DEV_TOKEN_KEY) ?? null; } catch { return null; }
}
export function setDevToken(token: string | null) {
  try {
    if (token) storage()?.setItem(DEV_TOKEN_KEY, token);
    else storage()?.removeItem(DEV_TOKEN_KEY);
  } catch { /* stockage indisponible : l'identité ne survivra pas au rechargement */ }
}

export async function currentToken(): Promise<string | null> {
  if (config?.authMode === 'supabase') {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    return data.session?.access_token ?? null;
  }
  return getDevToken();
}

export function rememberLobby(code: string | null) {
  try {
    if (code) storage()?.setItem('cyc.lobby', code);
    else storage()?.removeItem('cyc.lobby');
  } catch { /* ignoré */ }
}
export function rememberedLobby(): string | null {
  try { return storage()?.getItem('cyc.lobby') ?? null; } catch { return null; }
}
