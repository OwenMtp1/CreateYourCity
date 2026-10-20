import { useMemo } from 'react';
import { adviseCity, BUILDINGS, formatGameTime, MILESTONE_BY_ID, MILESTONES, type Advice } from '@cyc/shared';
import type { Tool } from '../../city3d/CityView3D.tsx';
import { activeCity, setState, useGame } from '../../state.ts';
import { Row } from '../common.tsx';
import { fmtInt, fmtMoney, fmtPct } from '../format.ts';
import { LineChart } from '../LineChart.tsx';
import { ICON } from './city.tsx';

const SEVERITY = {
  critical: { icon: '⛔', label: 'Urgent' },
  warning: { icon: '⚠️', label: 'Important' },
  info: { icon: '💡', label: 'Conseil' },
} as const;

export function useAdvice(): Advice[] {
  const city = useGame(activeCity);
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] ?? null : null));
  return useMemo(() => (city ? adviseCity(city, layers) : []), [city, layers]);
}

export function AdvisorsPanel({ setTool, setSelected }: { setTool: (t: Tool) => void; setSelected: (id: number | null) => void }) {
  const advice = useAdvice();
  if (advice.length === 0) return <p className="muted">✅ Vos conseillers n'ont rien à signaler. La ville se porte bien.</p>;
  return (
    <div className="stack">
      <p className="small muted">Analyse automatique et chiffrée de la ville (règles fixes, aucune IA), mise à jour à chaque tick.</p>
      {advice.map((a) => (
        <div key={a.id} className={`advice advice-${a.severity}`}>
          <div className="advice-head">
            <span aria-hidden>{SEVERITY[a.severity].icon}</span>
            <strong>{a.title}</strong>
            <span className="chip">{SEVERITY[a.severity].label}</span>
          </div>
          <p className="small">{a.detail}</p>
          <div className="row">
            {a.build && (
              <button className="small-btn primary" onClick={() => { setTool({ kind: 'building', building: a.build!, rotation: 0 }); setState({ view: 'city' }); }}>
                {ICON[a.build]} Construire : {BUILDINGS[a.build].label}
              </button>
            )}
            {a.buildingId !== undefined && (
              <button className="small-btn" onClick={() => { setSelected(a.buildingId!); setState({ view: 'city' }); }}>Localiser</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsPanel() {
  const city = useGame(activeCity)!;
  const market = useGame((s) => s.world?.market);
  const tick = useGame((s) => s.tick);
  const h = city.history ?? [];
  const pts = (f: (s: (typeof h)[number]) => number) => h.map((s) => ({ x: s.tick, y: f(s), label: formatGameTime(s.tick) }));
  const marketPts = (market?.history ?? []).map((v, i, arr) => ({ x: i, y: v, label: formatGameTime(tick - (arr.length - 1 - i) * 24) }));
  return (
    <div className="stack">
      <p className="small muted">Un point toutes les 4 h de jeu, sur les 15 derniers jours. Survolez une courbe pour lire une valeur.</p>
      <LineChart title="Population" points={pts((s) => s.population)} format={(v) => `${fmtInt(v)} hab.`} />
      <LineChart title="Trésorerie" points={pts((s) => s.treasury)} format={fmtMoney} zeroLine />
      <LineChart title="Solde budgétaire" points={pts((s) => s.net)} format={(v) => `${fmtInt(v)} cr/j`} zeroLine />
      <LineChart title="Chômage" points={pts((s) => s.unemployment)} format={(v) => fmtPct(v, 1)} />
      <LineChart title="Attractivité" points={pts((s) => s.attractiveness)} format={(v) => fmtPct(v)} />
      <LineChart title="Fluidité du trafic" points={pts((s) => s.traffic)} format={(v) => fmtPct(v)} />
      <LineChart title="Prix des biens (marché commun)" points={marketPts} format={(v) => `${v.toFixed(2)} cr`} />
      {city.stats?.parking && (
        <div className="card compact">
          <h4>🅿️ Stationnement</h4>
          <Row label="Places dans les rues" value={fmtInt(city.stats.parking.streetSpaces)} />
          <Row label="Places en parking" value={fmtInt(city.stats.parking.lotSpaces)} />
          <Row label="Demande (voitures garées en même temps)" value={fmtInt(city.stats.parking.demand)} />
          <Row label="Demande satisfaite" value={fmtPct(city.stats.parking.coverage)} tone={city.stats.parking.coverage < 0.8 ? 'neg' : 'pos'} />
          <Row label="Recettes" value={`${fmtInt(city.stats.parking.revenue)} cr/j`} />
        </div>
      )}
      <Milestones />
    </div>
  );
}

/** Paliers atteints, puis prochains paliers de chaque catégorie. */
function Milestones() {
  const city = useGame(activeCity)!;
  const reached = city.milestones ?? [];
  const done = new Set(reached.map((m) => m.id));
  const next = (['population', 'treasury'] as const)
    .map((kind) => MILESTONES.find((m) => m.kind === kind && !done.has(m.id)))
    .filter((m) => m !== undefined);
  return (
    <div className="card compact">
      <h4>🏆 Paliers ({reached.length}/{MILESTONES.length})</h4>
      {reached.length === 0 && <p className="small muted">Aucun palier pour l'instant.</p>}
      <ul className="list milestones">
        {[...reached].reverse().map((r) => {
          const m = MILESTONE_BY_ID.get(r.id);
          return m ? (
            <li key={r.id} title={m.detail}><span>{m.icon} {m.title}</span><span className="small muted">{formatGameTime(r.tick)}</span></li>
          ) : null;
        })}
        {next.map((m) => (
          <li key={m.id} className="muted" title={m.detail}><span>🔒 {m.title}</span><span className="small">prochain</span></li>
        ))}
      </ul>
    </div>
  );
}
