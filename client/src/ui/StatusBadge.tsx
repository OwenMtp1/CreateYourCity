import { useGame } from '../state.ts';

const LABEL = { online: 'Connecté', connecting: 'Connexion…', offline: 'Hors ligne — reconnexion' } as const;

export function StatusBadge() {
  const status = useGame((s) => s.status);
  return (
    <span className={`status status-${status}`} title="État de la connexion au serveur de jeu">
      <span className="dot" /> {LABEL[status]}
    </span>
  );
}
