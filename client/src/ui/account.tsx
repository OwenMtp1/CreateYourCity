// Compte : profil (mot de passe), amis (recherche, demandes, présence), messages privés et invitations.
import { useEffect, useState, type FormEvent } from 'react';
import { getSupabase } from '../net/auth.ts';
import { client } from '../net/client.ts';
import { setState, useGame } from '../state.ts';
import type { DirectMessage, FriendEntry } from '@cyc/shared';

/** Bouton d'accès au compte, toujours visible une fois connecté. */
export function AccountButton() {
  const player = useGame((s) => s.player);
  const invites = useGame((s) => s.invites.length);
  if (!player) return null;
  return (
    <button className="account-btn glass" onClick={() => setState({ accountOpen: true })} aria-label="Mon compte">
      👤 {player.name}{invites > 0 ? <em className="badge">{invites}</em> : null}
    </button>
  );
}

export function AccountPanel() {
  const open = useGame((s) => s.accountOpen);
  const [tab, setTab] = useState<'profile' | 'friends'>('friends');
  if (!open) return null;
  const close = () => setState({ accountOpen: false, dmWith: null });
  return (
    <div className="account-overlay" onClick={close}>
      <section className="account glass" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Mon compte">
        <header>
          <h2>Mon compte</h2>
          <button className="close" onClick={close} aria-label="Fermer">×</button>
        </header>
        <div className="tabs">
          <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>Amis</button>
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Profil</button>
        </div>
        {tab === 'profile' ? <Profile /> : <Friends />}
      </section>
    </div>
  );
}

function Profile() {
  const player = useGame((s) => s.player)!;
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const supabase = getSupabase();
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error ? { ok: false, text: error.message } : { ok: true, text: 'Mot de passe modifié.' });
    if (!error) setPassword('');
  };
  return (
    <div className="stack">
      <p>Pseudo : <strong>{player.name}</strong></p>
      <p className="small muted">Identifiant de joueur : <code>{player.id}</code></p>
      {supabase ? (
        <form className="stack" onSubmit={(e) => void change(e)}>
          <label>Nouveau mot de passe
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required autoComplete="new-password" />
          </label>
          <button className="primary" disabled={password.length < 6}>Changer le mot de passe</button>
          {message && <p className={message.ok ? 'notice' : 'error-text'}>{message.text}</p>}
        </form>
      ) : (
        <p className="notice">Le mot de passe se gère avec un compte Supabase. En mode invité, il n'existe pas.</p>
      )}
    </div>
  );
}

function Friends() {
  const friends = useGame((s) => s.friends);
  const results = useGame((s) => s.friendResults);
  const invites = useGame((s) => s.invites);
  const lobby = useGame((s) => s.lobby);
  const [query, setQuery] = useState('');
  const me = useGame((s) => s.player?.id);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    await client.act({ t: 'friendSearch', query });
  };
  const incoming = friends.filter((f) => f.status === 'incoming');
  const outgoing = friends.filter((f) => f.status === 'outgoing');
  const accepted = friends.filter((f) => f.status === 'friend');
  return (
    <div className="stack">
      {invites.length > 0 && (
        <div className="stack">
          <strong>Invitations</strong>
          {invites.map((i) => (
            <div key={i.id} className="row">
              <span className="small">{i.from.name} · « {i.lobby.name} »</span>
              <button className="primary small-btn" onClick={() => {
                setState((s) => ({ invites: s.invites.filter((x) => x.id !== i.id) }));
                void client.act({ t: 'joinLobby', code: i.lobby.code });
              }}>Rejoindre</button>
              <button className="ghost small-btn" onClick={() => setState((s) => ({ invites: s.invites.filter((x) => x.id !== i.id) }))}>Ignorer</button>
            </div>
          ))}
        </div>
      )}
      <form className="row" onSubmit={(e) => void search(e)}>
        <input placeholder="Rechercher un pseudo" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={24} />
        <button disabled={query.trim().length < 1}>Chercher</button>
      </form>
      {results.filter((p) => p.id !== me).length > 0 && (
        <div className="stack">
          <span className="small muted">Résultats</span>
          {results.filter((p) => p.id !== me).map((p) => (
            <div key={p.id} className="row">
              <span>{p.name} <code className="small muted">{p.id.slice(0, 6)}</code></span>
              <button className="small-btn" onClick={() => void client.act({ t: 'friendRequest', playerId: p.id })}>Ajouter</button>
            </div>
          ))}
        </div>
      )}
      {incoming.length > 0 && (
        <div className="stack">
          <strong>Demandes reçues</strong>
          {incoming.map((f) => (
            <div key={f.id} className="row">
              <span>{f.name}</span>
              <button className="primary small-btn" onClick={() => void client.act({ t: 'friendAccept', playerId: f.id })}>Accepter</button>
              <button className="ghost small-btn" onClick={() => void client.act({ t: 'friendRemove', playerId: f.id })}>Refuser</button>
            </div>
          ))}
        </div>
      )}
      {outgoing.length > 0 && (
        <div className="stack">
          <span className="small muted">Demandes envoyées</span>
          {outgoing.map((f) => (
            <div key={f.id} className="row">
              <span>{f.name}</span>
              <button className="ghost small-btn" onClick={() => void client.act({ t: 'friendRemove', playerId: f.id })}>Annuler</button>
            </div>
          ))}
        </div>
      )}
      <strong>Amis ({accepted.length})</strong>
      {accepted.length === 0 && <p className="small muted">Aucun ami pour l'instant : recherchez un pseudo et envoyez une demande.</p>}
      {accepted.map((f) => <FriendRow key={f.id} friend={f} inLobby={!!lobby} />)}
      <DirectChat />
    </div>
  );
}

function FriendRow({ friend, inLobby }: { friend: FriendEntry; inLobby: boolean }) {
  return (
    <div className="row friend-row">
      <span className={`presence ${friend.online ? 'on' : ''}`} aria-label={friend.online ? 'En ligne' : 'Hors ligne'} />
      <span>{friend.name}</span>
      <button className="small-btn" onClick={() => setState({ dmWith: friend.id })}>Discuter</button>
      {inLobby && <button className="small-btn" onClick={() => void client.act({ t: 'inviteFriend', to: friend.id })}>Inviter</button>}
      <button className="ghost small-btn" onClick={() => void client.act({ t: 'friendRemove', playerId: friend.id })}>Retirer</button>
    </div>
  );
}

/** Référence stable : un tableau neuf à chaque lecture fait boucler useSyncExternalStore. */
const NO_MESSAGES: DirectMessage[] = [];

function DirectChat() {
  const with_ = useGame((s) => s.dmWith);
  const friends = useGame((s) => s.friends);
  const messages = useGame((s) => (s.dmWith ? s.dms[s.dmWith] ?? NO_MESSAGES : NO_MESSAGES));
  const me = useGame((s) => s.player?.id);
  const [text, setText] = useState('');
  useEffect(() => {
    if (with_) void client.act({ t: 'dmHistory', with: with_ });
  }, [with_]);
  if (!with_) return null;
  const name = friends.find((f) => f.id === with_)?.name ?? 'Ami';
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    await client.act({ t: 'dmSend', to: with_, text: body });
  };
  return (
    <div className="dm stack">
      <div className="row">
        <strong>{name}</strong>
        <button className="ghost small-btn" onClick={() => setState({ dmWith: null })}>Fermer</button>
      </div>
      <div className="dm-log">
        {messages.length === 0 && <p className="small muted">Aucun message. Dites bonjour !</p>}
        {messages.map((m: DirectMessage) => (
          <p key={m.id} className={m.from === me ? 'mine' : ''}><span className="small muted">{m.from === me ? 'Vous' : name} :</span> {m.text}</p>
        ))}
      </div>
      <form className="row" onSubmit={(e) => void send(e)}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Votre message" />
        <button disabled={!text.trim()}>Envoyer</button>
      </form>
    </div>
  );
}
