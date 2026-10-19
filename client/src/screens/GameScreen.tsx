import { useEffect, useRef, useState } from 'react';
import { formatGameTime, GAME_MINUTES_PER_TICK, TICK_MS } from '@cyc/shared';
import { CITY_BY_ID } from '@cyc/shared/world';
import type { CityLayer } from '../city3d/CityScene.ts';
import { CityView3D, type Tool } from '../city3d/CityView3D.tsx';
import { GlobeView } from '../globe/GlobeView.tsx';
import { client } from '../net/client.ts';
import { activeCity, setState, toast, useGame } from '../state.ts';
import { fmtInt, fmtMoney } from '../ui/format.ts';
import { BuildPanel, EconomyPanel, PopulationPanel, ServicesPanel } from '../ui/panels/city.tsx';
import { ArmyPanel, DiplomacyPanel, LobbyPanel, NationPanel, TerritoryPanel, TradePanel } from '../ui/panels/world.tsx';
import { StatusBadge } from '../ui/StatusBadge.tsx';

type Tab = 'build' | 'economy' | 'population' | 'services' | 'territory' | 'trade' | 'diplomacy' | 'army' | 'nation' | 'lobby';
const TABS: { id: Tab; icon: string; label: string; city?: boolean }[] = [
  { id: 'build', icon: '🏗️', label: 'Construire', city: true },
  { id: 'economy', icon: '💰', label: 'Économie', city: true },
  { id: 'population', icon: '👥', label: 'Population', city: true },
  { id: 'services', icon: '🏥', label: 'Services', city: true },
  { id: 'territory', icon: '🗺️', label: 'Territoire' },
  { id: 'trade', icon: '📦', label: 'Commerce' },
  { id: 'diplomacy', icon: '🤝', label: 'Diplomatie' },
  { id: 'army', icon: '⚔️', label: 'Armée' },
  { id: 'nation', icon: '🏛️', label: 'Nation' },
  { id: 'lobby', icon: '💬', label: 'Salon' },
];

export function GameScreen() {
  const city = useGame(activeCity);
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] ?? null : null));
  const view = useGame((s) => s.view);
  const cityCount = useGame((s) => Object.keys(s.myCities).length);
  const [tab, setTab] = useState<Tab | null>(city ? 'build' : null);
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [grid, setGrid] = useState(false);
  const [layer, setLayer] = useState<CityLayer>('none');
  const [selected, setSelected] = useState<number | null>(null);
  const [dayNight, setDayNight] = useState(true);
  useEventNotifications();

  const showCity = view === 'city' && city;
  const tabDef = TABS.find((t) => t.id === tab);
  const panelAvailable = tabDef && (!tabDef.city || city);

  return (
    <div className="game">
      <div className="viewport">
        {showCity ? (
          <CityView3D city={city} layers={layers} tool={tool} setTool={setTool} grid={grid} setGrid={setGrid}
            layer={layer} selected={selected} setSelected={setSelected} dayNight={dayNight} />
        ) : (
          <GlobeView />
        )}
      </div>
      <Hud />
      <nav className="rail glass">
        <button className={`rail-btn ${!showCity ? 'active' : ''}`} onClick={() => setState({ view: 'globe' })} title="Globe">🌍<span>Monde</span></button>
        <button className={`rail-btn ${showCity ? 'active' : ''}`} disabled={!city} onClick={() => setState({ view: 'city' })} title="Ville">🏙️<span>Ville</span></button>
        <div className="rail-sep" />
        {TABS.map((t) => (
          <button key={t.id} className={`rail-btn ${tab === t.id ? 'active' : ''}`} disabled={t.city && !city}
            onClick={() => setTab(tab === t.id ? null : t.id)} title={t.label}>
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </nav>
      {tab && panelAvailable && (
        <aside className="drawer glass">
          <header>
            <h2>{tabDef.icon} {tabDef.label}{tabDef.city && city ? ` — ${CITY_BY_ID.get(city.cityId)?.name}` : ''}</h2>
            <button className="close" onClick={() => setTab(null)} aria-label="Fermer">×</button>
          </header>
          <div className="drawer-body">
            {tab === 'build' && <BuildPanel tool={tool} setTool={(t) => { setTool(t); if (t.kind !== 'select') setState({ view: 'city' }); }} grid={grid} setGrid={setGrid}
              layer={layer} setLayer={setLayer} selected={selected} dayNight={dayNight} setDayNight={setDayNight} />}
            {tab === 'economy' && <EconomyPanel />}
            {tab === 'population' && <PopulationPanel />}
            {tab === 'services' && <ServicesPanel layer={layer} setLayer={setLayer} />}
            {tab === 'territory' && <TerritoryPanel />}
            {tab === 'trade' && <TradePanel />}
            {tab === 'diplomacy' && <DiplomacyPanel />}
            {tab === 'army' && <ArmyPanel />}
            {tab === 'nation' && <NationPanel />}
            {tab === 'lobby' && <LobbyPanel />}
          </div>
        </aside>
      )}
      {view === 'globe' && cityCount === 0 && (
        <div className="onboarding glass">
          <strong>Bienvenue !</strong> Faites tourner le globe, zoomez, puis choisissez une ville libre : vous en deviendrez le dirigeant.
        </div>
      )}
    </div>
  );
}

function Hud() {
  const lobby = useGame((s) => s.lobby)!;
  const tick = useGame((s) => s.tick);
  const clock = useGame((s) => s.clock);
  const city = useGame(activeCity);
  const myCities = useGame((s) => s.myCities);
  const lastSavedAt = useGame((s) => s.lastSavedAt);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const saveAge = lastSavedAt ? Math.max(0, Math.round((now - lastSavedAt) / 1000)) : null;
  const ids = Object.keys(myCities);
  const total = Object.values(myCities).reduce((a, c) => ({ treasury: a.treasury + c.treasury, pop: a.pop + c.population }), { treasury: 0, pop: 0 });

  return (
    <header className="hud glass">
      <div className="hud-group">
        <strong className="brand">CreateYourCity</strong>
        <span className="muted">{lobby.name}</span>
        <button className="chip-btn" onClick={() => void navigator.clipboard?.writeText(lobby.code).then(() => toast("Code d'invitation copié"))} title="Copier le code d'invitation">
          {lobby.code}
        </button>
      </div>
      <div className="hud-group clock" title={`Vitesse fixe commune : 1 s réelle = ${GAME_MINUTES_PER_TICK} min de jeu (tick ${TICK_MS} ms)`}>
        <span>🕒 {formatGameTime(tick)}</span>
      </div>
      {city && (
        <div className="hud-group stats">
          {ids.length > 1 ? (
            <select value={city.cityId} onChange={(e) => setState({ activeCityId: e.target.value })}>
              {ids.map((id) => <option key={id} value={id}>{CITY_BY_ID.get(id)?.name}</option>)}
            </select>
          ) : <strong>{CITY_BY_ID.get(city.cityId)?.name}</strong>}
          <span className={city.treasury < 0 ? 'neg' : ''} title="Trésorerie de la ville">💰 {fmtMoney(city.treasury)}</span>
          <span title="Population">👥 {fmtInt(city.population)}</span>
          {city.stats && (
            <span className={city.stats.budget.net < 0 ? 'neg' : 'pos'} title="Solde par jour de jeu">
              {city.stats.budget.net >= 0 ? '▲' : '▼'} {fmtInt(Math.abs(city.stats.budget.net))} cr/j
            </span>
          )}
          {ids.length > 1 && <span className="muted small" title="Total de vos villes">Σ {fmtMoney(total.treasury)} · {fmtInt(total.pop)} hab.</span>}
        </div>
      )}
      <div className="hud-group right">
        {clock && clock.catchUpTicks + clock.skippedTicks > 0 && (
          <span className="small muted" title="Temps rejoué de façon déterministe après un redémarrage du serveur.">
            ⟲ {fmtInt(clock.catchUpTicks)} ticks rattrapés{clock.skippedTicks ? `, ${fmtInt(clock.skippedTicks)} sautés` : ''}
          </span>
        )}
        <span className="small muted">{saveAge === null ? 'Non sauvegardé' : `💾 il y a ${saveAge} s`}</span>
        <StatusBadge />
        <button className="ghost small-btn" onClick={() => void client.act({ t: 'leaveLobby' })}>Quitter</button>
      </div>
    </header>
  );
}

/** Affiche une notification pour les nouveaux événements du monde qui me concernent ou sont publics et majeurs. */
function useEventNotifications() {
  const world = useGame((s) => s.world);
  const player = useGame((s) => s.player);
  const lastId = useRef<number | null>(null);
  useEffect(() => {
    if (!world) return;
    const events = world.events;
    const max = events.reduce((m, e) => Math.max(m, e.id), 0);
    if (lastId.current === null) { lastId.current = max; return; }
    for (const e of events) {
      if (e.id <= lastId.current) continue;
      const concernsMe = player && e.players.includes(player.id);
      const major = ['war', 'peace', 'capture', 'election', 'impeachment'].includes(e.kind);
      if (concernsMe || major) toast(e.text, e.kind === 'war' || e.kind === 'capture' ? 'error' : 'info');
    }
    lastId.current = Math.max(lastId.current, max);
  }, [world?.events]);
}
