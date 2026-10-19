// Courbe d'un indicateur unique : ligne fine, grille discrète, réticule et infobulle au survol.
import { useId, useState } from 'react';

export interface Point { x: number; y: number; label: string }

export function LineChart({ title, points, format, height = 110, zeroLine = false }: {
  title: string; points: Point[]; format: (v: number) => string; height?: number; zeroLine?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();
  const W = 320;
  const H = height;
  const pad = { l: 4, r: 4, t: 8, b: 16 };
  if (points.length < 2) {
    return (
      <figure className="chart">
        <figcaption>{title}</figcaption>
        <div className="small muted chart-empty">Historique en cours de constitution (un point toutes les 4 h de jeu).</div>
      </figure>
    );
  }
  const ys = points.map((p) => p.y);
  let min = Math.min(...ys, zeroLine ? 0 : Infinity);
  let max = Math.max(...ys, zeroLine ? 0 : -Infinity);
  if (max === min) { max += 1; min -= 1; }
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const last = points.at(-1)!;
  const h = hover !== null ? points[hover]! : null;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((rel - pad.l) / (W - pad.l - pad.r)) * (points.length - 1)))));
  };
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <strong>{format(h ? h.y : last.y)}</strong>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${title} : ${format(last.y)}`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <clipPath id={clip}><rect x="0" y="0" width={W} height={H} /></clipPath>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} className="chart-grid" />
        ))}
        {zeroLine && min < 0 && max > 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="chart-zero" />}
        <path d={d} className="chart-line" clipPath={`url(#${clip})`} />
        <circle cx={x(points.length - 1)} cy={y(last.y)} r={4} className="chart-dot" />
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="chart-cross" />
            <circle cx={x(hover)} cy={y(h.y)} r={4.5} className="chart-dot" />
          </>
        )}
        <text x={pad.l} y={H - 3} className="chart-axis">{points[0]!.label}</text>
        <text x={W - pad.r} y={H - 3} className="chart-axis" textAnchor="end">{last.label}</text>
      </svg>
      {h && <div className="chart-tip">{h.label} · {format(h.y)}</div>}
    </figure>
  );
}
