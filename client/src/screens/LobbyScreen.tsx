import { useEffect, useState, type FormEvent } from 'react';
import { client } from '../net/client.ts';
import { useGame } from '../state.ts';
import { StatusBadge } from '../ui/StatusBadge.tsx';
import { AccountButton } from '../ui/account.tsx';
import { GlobeBackdrop } from '../globe/GlobeView.tsx';

export function LobbyScreen() {
  const player = useGame((s) => s.player)!;
  const lobbies = useGame((s) => s.lobbies);
  const myLobbies = useGame((s) => s.myLobbies);
  const me = useGame((s) => s.player?.id);
  const [tab, setTab] = useState<'mine' | 'browse'>('mine');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(16);

  useEffect(() => {
    void client.request({ t: 'listLobbies' });
    const id = setInterval(() => void client.request({ t: 'listLobbies' }), 10_000);
    return () => clearInterval(id);
  }, []);

  const create = (e: FormEvent) => {
    e.preventDefault();
    void client.act({ t: 'createLobby', name: name.trim(), isPublic, maxPlayers });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    void client.act({ t: 'joinLobby', code: code.trim().toUpperCase() });
  };

  return (
    <div className="center-screen">
      <GlobeBackdrop />
      <div className="lobby-grid">
        <header className="lobby-header glass">
          <h1>Salons</h1>
          <span className="muted">Connecté en tant que <strong>{player.name}</strong></span>
          <StatusBadge />
          <AccountButton />
        </header>
        <nav className="tabs lobby-tabs">
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>Parties en cours ({myLobbies.length})</button>
          <button className={tab === 'browse' ? 'active' : ''} onClick={() => setTab('browse')}>Rejoindre ou créer</button>
        </nav>
        {tab === 'mine' ? (
          <section className="card glass lobby-mine">
            <h2>Parties en cours</h2>
            {myLobbies.length === 0 ? (
              <p className="muted">Vous n'êtes dans aucune partie. Rejoignez un salon ou créez-en un.</p>
            ) : (
              <ul className="lobby-list">
                {myLobbies.map((l) => (
                  <li key={l.id}>
                    <div>
                      <strong>{l.name}</strong>
                      <span className="muted"> · {l.playerCount}/{l.maxPlayers} joueurs</span>
                      <div className="small muted">{l.cities.length > 0 ? l.cities.map((c) => c.name).join(', ') : 'Aucune ville'}</div>
                    </div>
                    <button className="primary" onClick={() => void client.act({ t: 'joinLobby', code: l.code })}>Reprendre</button>
                    {l.ownerId === me && (
                      <button className="ghost small-btn danger" onClick={() => {
                        if (confirm(`Supprimer la partie « ${l.name} » ? Toutes les villes seront perdues.`)) void client.act({ t: 'deleteLobby', lobbyId: l.id });
                      }}>Supprimer</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (<>
        <section className="card glass">
          <h2>Rejoindre avec un code</h2>
          <form onSubmit={join} className="row">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABC123" maxLength={6} className="code-input" required />
            <button className="primary" disabled={code.trim().length !== 6}>Rejoindre</button>
          </form>
          <h2>Salons publics</h2>
          {lobbies.length === 0 ? (
            <p className="muted">Aucun salon public pour l'instant.</p>
          ) : (
            <ul className="lobby-list">
              {lobbies.map((l) => (
                <li key={l.id}>
                  <div>
                    <strong>{l.name}</strong>
                    <span className="muted"> · {l.playerCount}/{l.maxPlayers} joueurs</span>
                  </div>
                  <button onClick={() => void client.act({ t: 'joinLobby', code: l.code })} disabled={l.playerCount >= l.maxPlayers}>
                    Rejoindre
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card glass">
          <h2>Créer un salon</h2>
          <form onSubmit={create} className="stack">
            <label>Nom<input value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={40} required /></label>
            <label>
              Joueurs maximum
              <input type="number" min={2} max={500} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              Public (sinon privé : accès par code d'invitation)
            </label>
            <button className="primary" disabled={name.trim().length < 3}>Créer</button>
          </form>
          <p className="muted small">
            Le monde d'un salon est persistant : la simulation continue sur le serveur à vitesse fixe, même sans joueur connecté.
          </p>
        </section>
        </>)}
      </div>
    </div>
  );
}
