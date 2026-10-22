// Amis, messages privés et invitations. Les données sont stockées par le magasin ; les mises à jour
// sont poussées aux sessions des joueurs concernés (en ligne seulement).
import { randomUUID } from 'node:crypto';
import type { DirectMessage, FriendEntry, PlayerRef, ServerMessage } from '@cyc/shared';
import type { PlayerIdentity } from '../auth.ts';
import type { Store } from '../store/types.ts';
import type { Session } from './gameServer.ts';

export interface SocialContext {
  store: Store;
  sessions: Iterable<Session>;
  now(): number;
}

/** Erreur destinée au joueur (affichée tel quel). */
export class SocialError extends Error {}

const sessionsOf = (ctx: SocialContext, playerId: string) => [...ctx.sessions].filter((s) => s.player?.id === playerId);
const send = (ctx: SocialContext, playerId: string, msg: ServerMessage) => {
  for (const s of sessionsOf(ctx, playerId)) s.conn.send(msg);
};
const online = (ctx: SocialContext, playerId: string) => sessionsOf(ctx, playerId).length > 0;

/** Liste d'amis d'un joueur, du point de vue de ce joueur. */
export async function friendsOf(ctx: SocialContext, playerId: string): Promise<FriendEntry[]> {
  const rels = await ctx.store.loadFriendships(playerId);
  const entries: FriendEntry[] = [];
  for (const r of rels) {
    const other = await ctx.store.getPlayer(r.other);
    if (!other) continue;
    const status = r.status === 'accepted' ? 'friend' : r.requestedBy === playerId ? 'outgoing' : 'incoming';
    entries.push({ ...other, status, online: online(ctx, other.id) });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Envoie la liste d'amis à tous les onglets du joueur. */
export async function pushFriends(ctx: SocialContext, playerId: string) {
  if (!sessionsOf(ctx, playerId).length) return;
  send(ctx, playerId, { t: 'friends', friends: await friendsOf(ctx, playerId) });
}

/** Un joueur se connecte ou se déconnecte : ses amis voient sa présence. */
export async function pushPresence(ctx: SocialContext, playerId: string) {
  const rels = await ctx.store.loadFriendships(playerId);
  for (const r of rels) if (r.status === 'accepted') await pushFriends(ctx, r.other);
}

async function relation(ctx: SocialContext, a: string, b: string) {
  return (await ctx.store.loadFriendships(a)).find((r) => r.other === b);
}

export async function searchPlayers(ctx: SocialContext, me: PlayerIdentity, query: string): Promise<PlayerRef[]> {
  return ctx.store.searchPlayers(query, me.id, 10);
}

export async function requestFriend(ctx: SocialContext, me: PlayerIdentity, target: string) {
  if (target === me.id) throw new SocialError('Vous ne pouvez pas vous ajouter vous-même.');
  if (!(await ctx.store.getPlayer(target))) throw new SocialError('Joueur introuvable.');
  const existing = await relation(ctx, me.id, target);
  if (existing?.status === 'accepted') throw new SocialError('Vous êtes déjà amis.');
  if (existing?.requestedBy === me.id) throw new SocialError('Demande déjà envoyée.');
  // Si l'autre a déjà demandé, la demande vaut acceptation.
  await ctx.store.saveFriendship(me.id, target, existing ? 'accepted' : 'pending', me.id);
  await pushFriends(ctx, me.id);
  await pushFriends(ctx, target);
}

export async function acceptFriend(ctx: SocialContext, me: PlayerIdentity, from: string) {
  const r = await relation(ctx, me.id, from);
  if (!r || r.status !== 'pending' || r.requestedBy !== from) throw new SocialError("Pas de demande de ce joueur.");
  await ctx.store.saveFriendship(me.id, from, 'accepted', from);
  await pushFriends(ctx, me.id);
  await pushFriends(ctx, from);
}

export async function removeFriend(ctx: SocialContext, me: PlayerIdentity, other: string) {
  if (!(await relation(ctx, me.id, other))) throw new SocialError('Pas de relation avec ce joueur.');
  await ctx.store.deleteFriendship(me.id, other);
  await pushFriends(ctx, me.id);
  await pushFriends(ctx, other);
}

async function requireFriends(ctx: SocialContext, me: PlayerIdentity, other: string) {
  const r = await relation(ctx, me.id, other);
  if (r?.status !== 'accepted') throw new SocialError('Seuls vos amis peuvent recevoir vos messages.');
}

export async function sendDirect(ctx: SocialContext, me: PlayerIdentity, to: string, text: string) {
  await requireFriends(ctx, me, to);
  const message: DirectMessage = { id: randomUUID(), from: me.id, to, text, at: new Date(ctx.now()).toISOString() };
  await ctx.store.appendDirect(message);
  send(ctx, me.id, { t: 'dm', message });
  send(ctx, to, { t: 'dm', message });
}

export async function directHistory(ctx: SocialContext, me: PlayerIdentity, other: string): Promise<DirectMessage[]> {
  await requireFriends(ctx, me, other);
  return ctx.store.loadDirect(me.id, other, 100);
}

export async function inviteFriend(ctx: SocialContext, me: PlayerIdentity, friend: string, lobby: { name: string; code: string }) {
  await requireFriends(ctx, me, friend);
  send(ctx, friend, { t: 'invite', from: { id: me.id, name: me.name }, lobby });
}
