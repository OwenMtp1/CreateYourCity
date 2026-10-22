import { useEffect, useRef, useState } from 'react';
import { formatGameTime, GAME_MINUTES_PER_TICK, TICK_MS, TICKS_PER_DAY } from '@cyc/shared';
import { CITY_BY_ID } from '@cyc/shared/world';
import type { CityLayer } from '../city3d/CityScene.ts';
import { CityView3D, type Tool } from '../city3d/CityView3D.tsx';
import { GlobeView } from '../globe/GlobeView.tsx';
import { client } from '../net/client.ts';
import { activeCity, setState, toast, useGame } from '../state.ts';
import { fmtInt, fmtMoney } from '../ui/format.ts';
import { BuildPanel, DisplayOptions, EconomyPanel, HistoryPanel, MobileBuildBar, PopulationPanel, ServicesPanel } from '../ui/panels/city.tsx';
import { ArmyPanel, DiplomacyPanel, LobbyPanel, NationPanel, TerritoryPanel, TradePanel } from '../ui/panels/world.tsx';
import { StatusBadge } from '../ui/StatusBadge.tsx';
import { AdvisorsPanel, StatsPanel, useAdvice } from '../ui/panels/insights.tsx';
import { BuildingInspector, BuildingsPanel } from '../ui/panels/buildings.tsx';
import type { Building } from '@cyc/shared';
import { Tutorial } from '../ui/Tutorial.tsx';
import { fmtShort, isMobile, useIsMobile } from '../ui/mobile.ts';
import { AccountButton } from '../ui/account.tsx';

type Tab = 'history' | 'build' | 'display' | 'buildings' | 'advisors' | 'stats' | 'economy' | 'population' | 'services' | 'territory' | 'trade' | 'diplomacy' | 'army' | 'nation' | 'lobby';
const TABS: { id: Tab; icon: string; label: string; city?: boolean }[] = [
  { id: 'build', icon: '🏗️', label: 'Construire', city: true },
  { id: 'buildings', icon: '🏘️', label: 'Bâtiments', city: true },
  { id: 'advisors', icon: '🧭', label: 'Conseillers', city: true },
  { id: 'stats', icon: '📈', label: 'Statistiques', city: true },
  { id: 'economy', icon: '💰', label: 'Économie', city: true },
  { id: 'population', icon: '👥', label: 'Population', city: true },
  { id: 'services', icon: '🏥', label: 'Services', city: true },
  { id: 'display', icon: '🎛️', label: 'Affichage', city: true },
  { id: 'history', icon: '🕰️', label: 'Historique', city: true },
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
  // Sur téléphone, la carte s'affiche d'abord en entier (le panneau masquerait la moitié de l'écran).
  const [tab, setTab] = useState<Tab | null>(city && !isMobile() ? 'build' : null);
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [grid, setGrid] = useState(false);
  const [layer, setLayer] = useState<CityLayer>('none');
  const [selected, setSelected] = useState<number | null>(null);
  const [dayNight, setDayNight] = useState(true);
  /** Instant affiché en vue historique (null : aujourd'hui). */
  const [historyTick, setHistoryTick] = useState<number | null>(null);
  /** Demande de recentrage de la caméra sur un bâtiment (n change à chaque demande). */
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null);
  const focusOn = (b: Building) => {
    setState({ view: 'city' });
    setFocus((f) => ({ x: b.x, y: b.y, n: (f?.n ?? 0) + 1 }));
  };
  /** Ouvre la fiche d'un bâtiment ; sur mobile, le panneau se ferme pour laisser voir la ville. */
  const openBuilding = (b: Building) => {
    setSelected(b.id);
    focusOn(b);
    if (mobile) setTab(null);
  };
  const openTab = (t: Tab | null) => {
    // Sur mobile, refermer la barre de construction repose l'outil : pas de construction involontaire ensuite.
    if (mobile && tab === 'build' && t !== 'build' && t !== 'display') setTool({ kind: 'select' });
    if (mobile && t === 'build') setState({ view: 'city' });
    setTab(t);
    setMoreOpen(false);
    if (mobile && t) setSelected(null);
  };
  const pickTool = (t: Tool) => {
    setTool(t);
    if (t.kind !== 'select') setState({ view: 'city' });
  };
  const [visitedEconomy, setVisitedEconomy] = useState(false);
  const [visitedGlobe, setVisitedGlobe] = useState(false);
  const mobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  /** Panneau mobile déplié en plein écran (sinon à mi-hauteur). */
  const [sheetFull, setSheetFull] = useState(false);
  const advice = useAdvice();
  const alerts = advice.filter((a) => a.severity !== 'info').length;
  useEventNotifications();
  useEffect(() => { if (tab === 'economy') setVisitedEconomy(true); }, [tab]);
  // La vue historique ne reste active que tant que son panneau est ouvert.
  useEffect(() => { if (tab !== 'history') setHistoryTick(null); }, [tab]);
  useEffect(() => { if (view === 'globe' && cityCount > 0) setVisitedGlobe(true); }, [view, cityCount]);

  const showCity = view === 'city' && city;
  const tabDef = TABS.find((t) => t.id === tab);
  const panelAvailable = tabDef && (!tabDef.city || city);
  const buildBar = mobile && tab === 'build' && !!showCity && selected === null;

  return (
    <div className={`game ${mobile ? 'mobile' : ''} ${buildBar ? 'buildbar-open' : ''}`}>
      <div className="viewport">
        {showCity ? (
          <CityView3D city={city} layers={layers} tool={tool} setTool={setTool} grid={grid} setGrid={setGrid}
            layer={layer} selected={selected} setSelected={setSelected} dayNight={dayNight} focus={focus} historyTick={historyTick} />
        ) : (
          <GlobeView />
        )}
      </div>
      {mobile ? <MobileHud /> : <Hud />}
      {mobile ? (
        <nav className="tabbar glass">
          <button className={`tab-btn ${!showCity ? 'active' : ''}`} onClick={() => setState({ view: showCity ? 'globe' : 'city' })} disabled={!city && !!showCity}>
            {showCity ? '🌍' : '🏙️'}<span>{showCity ? 'Monde' : 'Ville'}</span>
          </button>
          {(['build', 'buildings', 'economy'] as const).map((id) => {
            const t = TABS.find((x) => x.id === id)!;
            return (
              <button key={id} className={`tab-btn ${tab === id ? 'active' : ''}`} disabled={!city} onClick={() => openTab(tab === id ? null : id)}>
                {t.icon}<span>{t.label}</span>
              </button>
            );
          })}
          <button className={`tab-btn ${moreOpen || (tab && !['build', 'buildings', 'economy'].includes(tab)) ? 'active' : ''}`} onClick={() => setMoreOpen(!moreOpen)}>
            ☰<span>Plus</span>
            {alerts > 0 && <em className="badge">{alerts}</em>}
          </button>
        </nav>
      ) : (
      <nav className="rail glass">
        <button className={`rail-btn ${!showCity ? 'active' : ''}`} onClick={() => setState({ view: 'globe' })} title="Globe">🌍<span>Monde</span></button>
        <button className={`rail-btn ${showCity ? 'active' : ''}`} disabled={!city} onClick={() => setState({ view: 'city' })} title="Ville">🏙️<span>Ville</span></button>
        <div className="rail-sep" />
        {TABS.filter((t) => t.id !== 'display').map((t) => (
          <button key={t.id} className={`rail-btn ${tab === t.id ? 'active' : ''}`} disabled={t.city && !city}
            onClick={() => setTab(tab === t.id ? null : t.id)} title={t.label}>
            {t.icon}<span>{t.label}</span>
            {t.id === 'advisors' && alerts > 0 && <em className="badge">{alerts}</em>}
          </button>
        ))}
      </nav>
      )}
      {mobile && moreOpen && (
        <div className="more-sheet glass" role="menu">
          {TABS.filter((t) => !['build', 'buildings', 'economy'].includes(t.id)).map((t) => (
            <button key={t.id} className={`more-btn ${tab === t.id ? 'active' : ''}`} disabled={t.city && !city} onClick={() => openTab(t.id)}>
              <span className="more-icon">{t.icon}</span>{t.label}
              {t.id === 'advisors' && alerts > 0 && <em className="badge">{alerts}</em>}
            </button>
          ))}
        </div>
      )}
      {buildBar && <MobileBuildBar tool={tool} setTool={pickTool} onOptions={() => openTab('display')} />}
      {tab && panelAvailable && !(mobile && tab === 'build') && (
        <aside className={`drawer glass ${mobile ? `sheet ${sheetFull ? 'full' : ''}` : ''}`}>
          {mobile && <button className="sheet-handle" onClick={() => setSheetFull(!sheetFull)} aria-label={sheetFull ? 'Réduire le panneau' : 'Agrandir le panneau'} />}
          <header>
            <h2>{tabDef.icon} {tabDef.label}{tabDef.city && city ? ` — ${CITY_BY_ID.get(city.cityId)?.name}` : ''}</h2>
            <button className="close" onClick={() => openTab(tab === 'display' && mobile ? 'build' : null)} aria-label="Fermer">×</button>
          </header>
          <div className="drawer-body">
            {tab === 'build' && <BuildPanel tool={tool} setTool={(t) => {
              setTool(t);
              if (t.kind !== 'select') setState({ view: 'city' });
              // Sur mobile, choisir un outil replie le panneau pour toucher la carte.
              if (mobile && t.kind !== 'select') setTab(null);
            }} grid={grid} setGrid={setGrid}
              layer={layer} setLayer={setLayer} dayNight={dayNight} setDayNight={setDayNight} />}
            {tab === 'display' && <DisplayOptions grid={grid} setGrid={setGrid} layer={layer} setLayer={setLayer} dayNight={dayNight} setDayNight={setDayNight} />}
            {tab === 'buildings' && <BuildingsPanel selected={selected} onSelect={openBuilding} />}
            {tab === 'advisors' && <AdvisorsPanel setTool={(t) => { setTool(t); setTab('build'); }} setSelected={setSelected} />}
            {tab === 'stats' && <StatsPanel />}
            {tab === 'economy' && <EconomyPanel onSelect={openBuilding} />}
            {tab === 'population' && <PopulationPanel />}
            {tab === 'services' && <ServicesPanel layer={layer} setLayer={setLayer} />}
            {tab === 'history' && city && <HistoryPanel city={city} value={historyTick} onChange={setHistoryTick} />}
            {tab === 'territory' && <TerritoryPanel />}
            {tab === 'trade' && <TradePanel />}
            {tab === 'diplomacy' && <DiplomacyPanel />}
            {tab === 'army' && <ArmyPanel />}
            {tab === 'nation' && <NationPanel />}
            {tab === 'lobby' && <LobbyPanel />}
          </div>
        </aside>
      )}
      {showCity && selected !== null && (
        <BuildingInspector id={selected} onClose={() => setSelected(null)} onFocus={focusOn} onSelect={openBuilding} />
      )}
      {showCity && (
        <Tutorial setTool={setTool} openTab={(t) => openTab(t)} visitedEconomy={visitedEconomy} visitedGlobe={visitedGlobe} compact={mobile} />
      )}
      <TwinView />
      {view === 'globe' && cityCount === 0 && (
        <div className="onboarding glass">
          <strong>Bienvenue !</strong> Faites tourner le globe, zoomez, puis choisissez une ville libre : vous en deviendrez le dirigeant.
        </div>
      )}
    </div>
  );
}

/**
 * Ville jumelée d'un partenaire, en plein écran et en lecture seule : on peut remonter son historique
 * sans rien modifier.
 */
function TwinView() {
  const twinViewId = useGame((s) => s.twinViewId);
  const twin = useGame((s) => (twinViewId ? s.twinCities[twinViewId] : undefined));
  const [at, setAt] = useState<number | null>(null);
  if (!twinViewId || !twin) return null;
  const tick = at ?? twin.tick;
  return (
    <div className="twin-overlay glass">
      <header>
        <strong>🏙️ {CITY_BY_ID.get(twin.cityId)?.name}</strong>
        <span className="small muted">ville jumelée de {twin.ownerName} · lecture seule</span>
        <button className="ghost small-btn" onClick={() => setState({ twinViewId: null })}>Fermer</button>
      </header>
      <div className="twin-canvas">
        <CityView3D city={twin} layers={null} tool={{ kind: 'select' }} setTool={() => undefined} grid={false} setGrid={() => undefined}
          layer="none" selected={null} setSelected={() => undefined} dayNight focus={null} historyTick={tick} />
      </div>
      <div className="twin-time">
        <input type="range" min={twin.claimedAtTick} max={twin.tick} step={TICKS_PER_DAY} value={tick}
          onChange={(e) => setAt(Number(e.target.value) >= twin.tick ? null : Number(e.target.value))} />
        <span className="small">{formatGameTime(tick)}</span>
      </div>
    </div>
  );
}

/** Barre d'état compacte : ville, trésorerie, population, solde ; le reste dans un menu. */
function MobileHud() {
  const lobby = useGame((s) => s.lobby)!;
  const tick = useGame((s) => s.tick);
  const city = useGame(activeCity);
  const myCities = useGame((s) => s.myCities);
  const [open, setOpen] = useState(false);
  const ids = Object.keys(myCities);
  return (
    <header className="hud hud-mobile glass">
      <div className="hud-row">
        {city ? (
          ids.length > 1 ? (
            <select value={city.cityId} onChange={(e) => setState({ activeCityId: e.target.value })}>
              {ids.map((id) => <option key={id} value={id}>{CITY_BY_ID.get(id)?.name}</option>)}
            </select>
          ) : <strong className="city-name">{CITY_BY_ID.get(city.cityId)?.name}</strong>
        ) : <strong className="brand">CreateYourCity</strong>}
        {city?.independentSince !== undefined && <span className="hud-dictator" title="Dictature indépendante">⚑</span>}
        {city && (
          <>
            <span className={city.treasury < 0 ? 'neg' : ''}>💰 {fmtShort(city.treasury)}</span>
            <span>👥 {fmtShort(city.population)}</span>
            {city.stats && <span className={city.stats.budget.net < 0 ? 'neg' : 'pos'}>{city.stats.budget.net >= 0 ? '▲' : '▼'} {fmtShort(Math.abs(city.stats.budget.net))}</span>}
          </>
        )}
        <StatusBadge />
        <AccountButton />
        <button className="ghost small-btn hud-more" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Plus d'informations">⋯</button>
      </div>
      {open && (
        <div className="hud-details">
          <span>🕒 {formatGameTime(tick)}</span>
          <span className="muted">{lobby.name}</span>
          <button className="chip-btn" onClick={() => void navigator.clipboard?.writeText(lobby.code).then(() => toast("Code d'invitation copié"))}>{lobby.code}</button>
          <button className="ghost small-btn" onClick={() => void client.act({ t: 'leaveLobby' })}>Quitter</button>
        </div>
      )}
    </header>
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
          {city.independentSince !== undefined && <span className="hud-dictator" title="Dictature indépendante : hors du pays, sans échanges extérieurs">⚑ Dictature</span>}
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
        <AccountButton />
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
      const major = ['war', 'peace', 'capture', 'election', 'impeachment', 'betrayal'].includes(e.kind);
      if (concernsMe || major) toast(e.text, e.kind === 'war' || e.kind === 'capture' ? 'error' : 'info');
    }
    lastId.current = Math.max(lastId.current, max);
  }, [world?.events]);
}
