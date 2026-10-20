// Tutoriel guidé : étapes détectées à partir de l'état réel de la ville.
import { useState } from 'react';
import { BUILDINGS } from '@cyc/shared';
import type { Tool } from '../city3d/CityView3D.tsx';
import { activeCity, useGame } from '../state.ts';

const KEY = 'cyc.tutorialDone';
const done = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

interface Step { title: string; text: string; ok: boolean; tool?: Tool; tab?: string }

export function Tutorial({ setTool, openTab, visitedEconomy, visitedGlobe, compact = false }: {
  setTool: (t: Tool) => void; openTab: (tab: 'build' | 'economy' | 'advisors') => void; visitedEconomy: boolean; visitedGlobe: boolean;
  /** Mobile : replié en pastille, déplié au toucher. */
  compact?: boolean;
}) {
  const city = useGame(activeCity);
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] : undefined));
  const [hidden, setHidden] = useState(done());
  const [expanded, setExpanded] = useState(false);
  if (hidden || !city) return null;
  const ok = (id: number) => layers?.buildingStatus[id] === 'ok';
  const has = (pred: (t: string) => boolean) => city.buildings.some((b) => pred(b.type) && ok(b.id));
  const steps: Step[] = [
    { title: 'Tracer une route', text: 'Choisissez « Rue » puis cliquez sur le portique jaune (bord ouest) et ailleurs pour tracer la route.', ok: Object.values(layers?.roadConnected ?? {}).some(Boolean), tool: { kind: 'road', road: 'street', mode: 'straight' } },
    { title: 'Construire des logements', text: 'Placez des maisons ou un immeuble à moins de 12 m de la route.', ok: has((t) => BUILDINGS[t as 'house'].housing > 0), tool: { kind: 'building', building: 'house', rotation: 0 } },
    { title: 'Créer des emplois', text: 'Ajoutez un commerce ou des bureaux : les habitants viennent là où il y a du travail.', ok: has((t) => ['shop', 'office', 'factory'].includes(t)), tool: { kind: 'building', building: 'shop', rotation: 0 } },
    { title: 'Accueillir des habitants', text: 'Patientez quelques instants : la population arrive progressivement (1 s = 10 min de jeu).', ok: city.population >= 20 },
    { title: 'Ouvrir un service public', text: 'Une école ou une clinique améliore l’attractivité des quartiers proches.', ok: has((t) => ['school', 'clinic'].includes(t)), tool: { kind: 'building', building: 'school', rotation: 0 } },
    { title: 'Surveiller le budget', text: 'Ouvrez l’onglet Économie : recettes, dépenses, impôts et emprunts.', ok: visitedEconomy, tab: 'economy' },
    { title: 'Découvrir le monde', text: 'Passez sur le globe (🌍) : commerce, diplomatie, armée et élections avec les autres joueurs.', ok: visitedGlobe },
  ];
  const current = steps.findIndex((s) => !s.ok);
  const finish = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* préférence non mémorisée */ }
    setHidden(true);
  };
  const step = steps[current];
  const doneCount = steps.filter((s) => s.ok).length;
  if (compact && !expanded) {
    return (
      <button className="tutorial-pill glass" onClick={() => setExpanded(true)} aria-label="Ouvrir le tutoriel">
        🎓 {doneCount}/{steps.length}{step ? ` · ${step.title}` : ' · terminé'}
      </button>
    );
  }
  return (
    <div className="tutorial glass" role="dialog" aria-label="Tutoriel">
      <div className="row tutorial-head">
        <strong>🎓 Premiers pas</strong>
        <span className="small muted">{steps.filter((s) => s.ok).length}/{steps.length}</span>
        {compact && <button className="ghost small-btn" onClick={() => setExpanded(false)} aria-label="Réduire">▾</button>}
        <button className="close" onClick={finish} aria-label="Fermer le tutoriel">×</button>
      </div>
      <div className="tutorial-progress"><div style={{ width: `${(steps.filter((s) => s.ok).length / steps.length) * 100}%` }} /></div>
      {step ? (
        <>
          <p><strong>{current + 1}. {step.title}</strong><br /><span className="small">{step.text}</span></p>
          <div className="row">
            {step.tool && <button className="small-btn primary" onClick={() => { setTool(step.tool!); openTab('build'); }}>Montrer</button>}
            {step.tab && <button className="small-btn primary" onClick={() => openTab('economy')}>Ouvrir</button>}
          </div>
        </>
      ) : (
        <>
          <p>🎉 Bravo, vous maîtrisez les bases ! Les conseillers (🧭) vous guideront ensuite.</p>
          <button className="small-btn primary" onClick={() => { openTab('advisors'); finish(); }}>Voir les conseillers</button>
        </>
      )}
      <ol className="tutorial-steps">
        {steps.map((s, i) => <li key={i} className={s.ok ? 'done' : i === current ? 'current' : ''}>{s.ok ? '✓' : '○'} {s.title}</li>)}
      </ol>
    </div>
  );
}
