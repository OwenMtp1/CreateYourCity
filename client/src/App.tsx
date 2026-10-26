import { useEffect, useState } from 'react';
import { BUILDING_TYPES } from '@cyc/shared';
import { preloadModels } from './city3d/models.ts';
import { loadPublicConfig } from './net/auth.ts';
import { client } from './net/client.ts';
import { GameScreen } from './screens/GameScreen.tsx';
import { LobbyScreen } from './screens/LobbyScreen.tsx';
import { LoginScreen } from './screens/LoginScreen.tsx';
import { useGame } from './state.ts';
import { Toasts } from './ui/Toasts.tsx';
import { AccountPanel } from './ui/account.tsx';

export function App() {
  const [configError, setConfigError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const player = useGame((s) => s.player);
  const lobby = useGame((s) => s.lobby);

  useEffect(() => {
    loadPublicConfig()
      .then(() => preloadModels(BUILDING_TYPES))
      .then(() => {
        setReady(true);
        client.start();
      })
      .catch((e: Error) => setConfigError(e.message));
  }, []);

  if (configError) {
    return (
      <div className="center-screen">
        <div className="card">
          <h1>Serveur indisponible</h1>
          <p>{configError}. Vérifiez que le serveur de jeu tourne (<code>npm run dev</code>).</p>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="center-screen muted">Chargement…</div>;

  return (
    <>
      {!player ? <LoginScreen /> : !lobby ? <LobbyScreen /> : <GameScreen />}
      <AccountPanel />
      <Toasts />
    </>
  );
}
