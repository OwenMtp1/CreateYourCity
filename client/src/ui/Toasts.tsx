import { useGame } from '../state.ts';

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}
