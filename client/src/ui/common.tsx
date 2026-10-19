import { CITY_BY_ID } from '@cyc/shared/world';
import { fmtInt } from './format.ts';

export function Row({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | undefined }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <span className={tone}>{value}</span>
    </div>
  );
}

/** Montant signé d'une ligne budgétaire (pas de « −0 »). */
export const flow = (v: number, sign: '+' | '−') => (Math.round(v) === 0 ? '0' : `${sign}${fmtInt(v)}`);

export const cityLabel = (id: string) => CITY_BY_ID.get(id)?.name ?? id;

export function Sparkline({ values, width = 260, height = 56 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <div className="small muted">Historique en cours de constitution…</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 4 - ((v - min) / span) * (height - 8)}`).join(' ');
  return (
    <svg width={width} height={height} className="sparkline" role="img" aria-label="Évolution du prix">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
