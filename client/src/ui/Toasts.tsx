import { useGame } from '../state.ts';

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        t.kind === 'milestone' ? (
          <div key={t.id} className="toast toast-milestone">
            <span className="milestone-icon">{t.icon}</span>
            <span><strong>{t.title}</strong><span className="small">{t.text}</span></span>
          </div>
        ) : (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        )
      ))}
    </div>
  );
}
