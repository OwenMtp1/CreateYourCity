import { useEffect, useState } from 'react';
import { formatGameTime, GAME_MINUTES_PER_TICK, TICK_MS } from '@cyc/shared';
import { CITY_BY_ID } from '@cyc/shared/world';
import { CityView, type Layer, type Tool } from '../city/CityView.tsx';
import { WorldMap } from '../map/WorldMap.tsx';
import { client } from '../net/client.ts';
import { toast, useGame } from '../state.ts';
import { fmtInt, fmtMoney } from '../ui/format.ts';
import { BuildPanel, EconomyPanel, LobbyPanel, PopulationPanel, ServicesPanel } from '../ui/panels.tsx';
import { StatusBadge } from '../ui/StatusBadge.tsx';

type Tab = 'build' | 'economy' | 'population' | 'services' | 'lobby';
const TABS: [Tab, string][] = [
  ['build', 'Construire'], ['economy', 'Économie'], ['population', 'Population'], ['services', 'Services'], ['lobby', 'Salon'],
];

export function GameScreen() {
  const myCity = useGame((s) => s.myCity);
  const layers = useGame((s) => s.layers);
  const [view, setView] = useState<'map' | 'city'>(myCity ? 'city' : 'map');
  const [tab, setTab] = useState<Tab>('build');
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [grid, setGrid] = useState(true);
  const [layer, setLayer] = useState<Layer>('none');
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (!myCity && view === 'city') setView('map');
  }, [myCity, view]);

  return (
    <div className="game">
      <Hud view={view} setView={setView} />
      {view === 'map' || !myCity ? (
        <WorldMap onEnterCity={() => setView('city')} />
      ) : (
        <div className="city-layout">
          <CityView
            city={myCity} layers={layers} tool={tool} setTool={setTool} grid={grid} setGrid={setGrid}
            layer={layer} selected={selected} setSelected={setSelected}
          />
          <aside className="sidebar">
            <nav className="tabs">
              {TABS.map(([id, label]) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
              ))}
            </nav>
            <div className="sidebar-body">
              {tab === 'build' && (
                <BuildPanel tool={tool} setTool={setTool} grid={grid} setGrid={setGrid} layer={layer} setLayer={setLayer} selected={selected} />
              )}
              {tab === 'economy' && <EconomyPanel />}
              {tab === 'population' && <PopulationPanel />}
              {tab === 'services' && <ServicesPanel layer={layer} setLayer={setLayer} />}
              {tab === 'lobby' && <LobbyPanel />}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Hud({ view, setView }: { view: 'map' | 'city'; setView: (v: 'map' | 'city') => void }) {
  const lobby = useGame((s) => s.lobby)!;
  const tick = useGame((s) => s.tick);
  const clock = useGame((s) => s.clock);
  const myCity = useGame((s) => s.myCity);
  const lastSavedAt = useGame((s) => s.lastSavedAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const saveAge = lastSavedAt ? Math.max(0, Math.round((now - lastSavedAt) / 1000)) : null;
  const cityName = myCity ? CITY_BY_ID.get(myCity.cityId)?.name : null;

  const copyCode = () => {
    void navigator.clipboard?.writeText(lobby.code).then(() => toast("Code d'invitation copié"));
  };

  return (
    <header className="hud">
      <div className="hud-group">
        <strong>{lobby.name}</strong>
        <button className="chip-btn" onClick={copyCode} title="Copier le code d'invitation">Code {lobby.code}</button>
      </div>
      <div className="hud-group" title={`Vitesse fixe commune : 1 tick = ${TICK_MS / 1000} s réelle = ${GAME_MINUTES_PER_TICK} min de jeu`}>
        <span>{formatGameTime(tick)}</span>
        <span className="muted small">vitesse fixe · 1 s = {GAME_MINUTES_PER_TICK} min</span>
      </div>
      {myCity && (
        <div className="hud-group stats">
          <span title="Ville dirigée">{cityName}</span>
          <span className={myCity.treasury < 0 ? 'neg' : ''} title="Trésorerie">{fmtMoney(myCity.treasury)}</span>
          <span title="Population">{fmtInt(myCity.population)} hab.</span>
          {myCity.stats && (
            <span className={myCity.stats.budget.net < 0 ? 'neg' : 'pos'} title="Solde budgétaire par jour de jeu">
              {myCity.stats.budget.net >= 0 ? '+' : ''}{fmtInt(myCity.stats.budget.net)} cr/j
            </span>
          )}
        </div>
      )}
      <div className="hud-group right">
        {clock && clock.catchUpTicks + clock.skippedTicks > 0 && (
          <span className="small muted" title="Le serveur a redémarré : le temps manqué a été rejoué de façon déterministe (dans la limite du plafond).">
            Rattrapage : {fmtInt(clock.catchUpTicks)} ticks{clock.skippedTicks ? `, ${fmtInt(clock.skippedTicks)} sautés` : ''}
          </span>
        )}
        <span className="small muted" title="Dernière sauvegarde en base">
          {saveAge === null ? 'Pas encore sauvegardé' : `Sauvegardé il y a ${saveAge} s`}
        </span>
        <StatusBadge />
        {myCity && (
          <button onClick={() => setView(view === 'map' ? 'city' : 'map')}>{view === 'map' ? 'Ma ville' : 'Carte du monde'}</button>
        )}
        <button className="ghost" onClick={() => void client.act({ t: 'leaveLobby' })}>Quitter</button>
      </div>
    </header>
  );
}
