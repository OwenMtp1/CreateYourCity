// Notifications de paliers : comparées à ceux déjà vus sur cet appareil (par salon et par ville).
// La première fois qu'une ville est vue, ses paliers existants servent de référence, sans notification.
import { MILESTONE_BY_ID, type MilestoneReached } from '@cyc/shared';
import { CITY_BY_ID } from '@cyc/shared/world';
import { getState, milestoneToast } from '../state.ts';

const key = (cityId: string) => `cyc.milestones.${getState().lobby?.id ?? 'local'}.${cityId}`;

function readSeen(cityId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key(cityId));
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(cityId: string, ids: string[]) {
  try { localStorage.setItem(key(cityId), JSON.stringify(ids)); } catch { /* stockage indisponible */ }
}

/** Mémoire de secours quand le stockage local est indisponible. */
const memory = new Map<string, Set<string>>();

export function notifyMilestones(cityId: string, milestones: MilestoneReached[] | undefined) {
  const ids = (milestones ?? []).map((m) => m.id);
  const seen = readSeen(cityId) ?? memory.get(cityId);
  memory.set(cityId, new Set(ids));
  writeSeen(cityId, ids);
  if (!seen) return;
  const fresh = ids.filter((id) => !seen.has(id)).map((id) => MILESTONE_BY_ID.get(id)).filter((m) => m !== undefined);
  if (!fresh.length) return;
  const city = CITY_BY_ID.get(cityId)?.name ?? '';
  // Plusieurs paliers d'un coup (rattrapage) : le plus récent, et le nombre des autres.
  const last = fresh[fresh.length - 1]!;
  milestoneToast(last.icon, last.title, `${city ? `${city} · ` : ''}${last.detail}${fresh.length > 1 ? ` (+${fresh.length - 1} autre${fresh.length > 2 ? 's' : ''})` : ''}`);
}
