import { useEffect, useMemo, useRef, useState } from 'react';
import { CITY_BY_ID, COUNTRY_BY_ID, WORLD_CITIES } from '@cyc/shared/world';
import { allied, distanceKm, EXPANSION, type WorldView } from '@cyc/shared/game';
import { client } from '../net/client.ts';
import { getState, setState, useGame } from '../state.ts';
import { fmtInt, fmtMoney } from '../ui/format.ts';
import { GlobeScene, type GlobeData, type Relation } from './GlobeScene.ts';

/** Relation d'un joueur vis-à-vis de moi, déduite des traités et guerres visibles. */
export function relationOf(world: WorldView | null, me: string | undefined, other: string): Relation {
  if (!me) return 'other';
  if (other === me) return 'mine';
  if (!world) return 'other';
  if (world.wars.some((w) => (w.a === me && w.b === other) || (w.a === other && w.b === me))) return 'enemy';
  const metaLike = { treaties: world.treaties, wars: world.wars, organizations: world.organizations } as Parameters<typeof allied>[0];
  return allied(metaLike, me, other) ? 'ally' : 'other';
}

/** Globe décoratif en rotation (écrans de connexion et de salons). */
export function GlobeBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = new GlobeScene(ref.current!, { interactive: false });
    scene.autoRotate = true;
    return () => scene.dispose();
  }, []);
  return <div ref={ref} className="globe-backdrop" aria-hidden />;
}

export function GlobeView() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const summaries = useGame((s) => s.summaries);
  const world = useGame((s) => s.world);
  const player = useGame((s) => s.player);
  const focusCityId = useGame((s) => s.focusCityId);
  const [country, setCountry] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Carte épurée par défaut : armées, routes et fronts n'apparaissent que sur demande.
  const [overlays, setOverlays] = useState(() => {
    try { return localStorage.getItem('cyc.mapOverlays') === '1'; } catch { return false; }
  });
  const toggleOverlays = () => {
    setOverlays((v) => {
      try { localStorage.setItem('cyc.mapOverlays', v ? '0' : '1'); } catch { /* stockage indisponible */ }
      return !v;
    });
  };

  const [generation, setGeneration] = useState(0);
  const [glLost, setGlLost] = useState(false);
  useEffect(() => {
    const scene = new GlobeScene(ref.current!, { interactive: true });
    sceneRef.current = scene;
    let retry: ReturnType<typeof setTimeout> | undefined;
    scene.onContextChange = (lost) => {
      setGlLost(lost);
      clearTimeout(retry);
      if (lost) retry = setTimeout(() => setGeneration((g) => g + 1), 3000);
    };
    setGlLost(false);
    scene.onPick = (p) => {
      setState({ focusCityId: p.cityId ?? null });
      setCountry(p.countryId ?? null);
    };
    const s = getState();
    const mine = Object.values(s.myCities)[0];
    const start = CITY_BY_ID.get(s.focusCityId ?? mine?.cityId ?? '');
    if (start) scene.flyTo(start.lat, start.lon, mine ? 1.6 : 2.4);
    return () => {
      clearTimeout(retry);
      scene.dispose();
    };
  }, [generation]);

  const data: GlobeData = useMemo(() => {
    const owners = new Map<string, { relation: Relation; label: string; independent?: boolean }>();
    for (const s of summaries) owners.set(s.cityId, { relation: relationOf(world, player?.id, s.ownerId), label: s.ownerName, independent: !!s.independent });
    const armies = (world?.armies ?? []).map((a) => ({
      id: a.id,
      position: a.position,
      destination: a.movement ? (() => { const c = CITY_BY_ID.get(a.movement!.toCityId)!; return [c.lat, c.lon] as [number, number]; })() : null,
      relation: relationOf(world, player?.id, a.ownerId),
      size: a.approxSize,
      kind: a.kind,
    }));
    const ll = (cityId: string): [number, number] => { const c = CITY_BY_ID.get(cityId)!; return [c.lat, c.lon]; };
    const routes = (world?.contracts ?? []).map((c) => ({ from: ll(c.sellerCityId), to: ll(c.buyerCityId), active: c.status === 'active' }));
    // Front : paires de villes de deux joueurs en guerre, distantes de moins de 500 km.
    const fronts: { from: [number, number]; to: [number, number] }[] = [];
    for (const w of world?.wars ?? []) {
      const ca = summaries.filter((s) => s.ownerId === w.a);
      const cb = summaries.filter((s) => s.ownerId === w.b);
      for (const x of ca) for (const y of cb) if (distanceKm(x.cityId, y.cityId) <= 500) fronts.push({ from: ll(x.cityId), to: ll(y.cityId) });
    }
    return {
      owners,
      playedCountries: new Set(summaries.map((s) => s.countryId)),
      selectedCountry: country,
      selectedCity: focusCityId,
      armies: overlays ? armies : [],
      sieges: overlays ? (world?.sieges ?? []).map((s) => s.cityId) : [],
      routes: overlays ? routes : [],
      fronts: overlays ? fronts.slice(0, 200) : [],
      battles: overlays ? (world?.battles ?? []).map((b) => b.position) : [],
    };
  }, [summaries, world, player?.id, country, focusCityId, overlays]);

  useEffect(() => sceneRef.current?.setData(data), [data, generation]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return WORLD_CITIES.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  const focus = (cityId: string) => {
    const c = CITY_BY_ID.get(cityId);
    if (!c) return;
    setState({ focusCityId: cityId });
    setCountry(c.countryId);
    sceneRef.current?.flyTo(c.lat, c.lon, 1.25);
  };

  return (
    <div className="globe-view">
      <div ref={ref} className="globe-canvas" />
      <div className="globe-search glass">
        <input placeholder="Rechercher une ville…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {results.length > 0 && (
          <ul className="list">
            {results.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => { focus(c.id); setQuery(''); }}>
                  {c.name} <span className="muted">· {COUNTRY_BY_ID.get(c.countryId)?.nameFr}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="map-legend glass">
        <span><i className="lg lg-occupied" /> Ville occupée</span>
        <span><i className="lg lg-free" /> Ville libre</span>
        {summaries.some((s) => s.independent) && <span><i className="lg lg-dictator" /> ⚑ Dictature indépendante</span>}
        <label className="check map-toggle">
          <input type="checkbox" checked={overlays} onChange={toggleOverlays} /> Militaire et commerce
        </label>
        {overlays && (
          <>
            <span><i className="lg lg-route" /> Routes commerciales</span>
            <span><i className="lg lg-front" /> Front</span>
          </>
        )}
      </div>
      {glLost && <div className="gl-lost glass">Affichage 3D interrompu par le navigateur — reprise en cours…</div>}
      <div className="map-credits">Données : Natural Earth (domaine public)</div>
      {(focusCityId || country) && <PlaceCard cityId={focusCityId} countryId={country} onFocus={focus} />}
    </div>
  );
}

function PlaceCard({ cityId, countryId, onFocus }: { cityId: string | null; countryId: string | null; onFocus: (id: string) => void }) {
  const summaries = useGame((s) => s.summaries);
  const myCities = useGame((s) => s.myCities);
  const world = useGame((s) => s.world);
  const player = useGame((s) => s.player);
  const [fromCity, setFromCity] = useState<string>('');
  const [price, setPrice] = useState(500_000);
  const [armyId, setArmyId] = useState<number | ''>('');
  const city = cityId ? CITY_BY_ID.get(cityId) : undefined;
  const owner = city ? summaries.find((s) => s.cityId === city.id) : undefined;
  const mineIds = Object.keys(myCities);
  const myArmies = (world?.armies ?? []).filter((a) => a.ownerId === player?.id);
  const country = COUNTRY_BY_ID.get(city?.countryId ?? countryId ?? '');
  const relation = owner ? relationOf(world, player?.id, owner.ownerId) : null;
  const detail = city ? world?.cityDetails.find((d) => d.cityId === city.id) : undefined;
  const source = fromCity || mineIds[0] || '';

  const nearestSource = useMemo(() => {
    if (!city || mineIds.length === 0) return null;
    return mineIds.map((id) => ({ id, d: distanceKm(id, city.id) })).sort((a, b) => a.d - b.d)[0]!;
  }, [city, mineIds.join()]);

  useEffect(() => {
    if (nearestSource) setFromCity(nearestSource.id);
  }, [nearestSource?.id]);

  const expansionKm = city && source ? distanceKm(source, city.id) : Infinity;
  const expansionCost = Math.round(EXPANSION.baseCost + EXPANSION.costPerKm * expansionKm);

  return (
    <aside className="place-card glass">
      <button className="close" onClick={() => setState({ focusCityId: null })} aria-label="Fermer">×</button>
      {city ? (
        <>
          <h3>{city.name}</h3>
          <div className="muted">{country?.nameFr}{city.capital ? ' · capitale' : ''} · {fmtInt(city.pop)} hab. réels</div>
          {city.coast && <div className="small coast-note">🌊 Ville côtière : la mer borde la carte {seaSide(city.coast.dir)}, idéale pour un port.</div>}
          {owner ? (
            <>
              {owner.independent && (
                <div className="dictator-banner">
                  <strong>⚑ Dictature indépendante</strong>
                  <span className="small">A fait sécession de {country?.nameFr ?? 'son pays'} : ni impôt national, ni vote, ni échanges avec l'extérieur.</span>
                </div>
              )}
              <p>{owner.independent ? 'Dictateur' : 'Dirigée par'} <strong className={`rel-${relation}`}>{owner.ownerName}</strong>{relation === 'mine' ? ' (vous)' : ''}</p>
              <div className="small">~{fmtInt(owner.population)} habitants · {owner.buildingCount} constructions</div>
              {detail && (
                <div className="small kv-grid">
                  <span>Trésorerie</span><span>{fmtMoney(detail.treasury)}</span>
                  <span>Solde</span><span>{fmtInt(detail.netPerDay)} cr/j</span>
                  <span>Chômage</span><span>{(detail.unemploymentRate * 100).toFixed(1)} %</span>
                </div>
              )}
              {!detail && relation !== 'mine' && <p className="small muted">Détails économiques visibles avec une alliance ou un partage d'informations.</p>}
              {relation === 'mine' && (
                <button className="primary" onClick={() => setState({ activeCityId: city.id, view: 'city' })}>Construire ici</button>
              )}
              {relation !== 'mine' && owner && (
                <div className="stack">
                  {mineIds.length > 0 && relation !== 'enemy' && (
                    <div className="row">
                      <input type="number" min={0} step={50000} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                      <button onClick={() => void client.action({ type: 'proposeTreaty', to: owner.ownerId, treaty: 'city_transfer', cityId: city.id, price, payFromCityId: source })}>
                        Proposer l'achat
                      </button>
                    </div>
                  )}
                  {relation !== 'enemy' && mineIds.length > 0 && (
                    <button className="danger" onClick={() => { if (confirm(`Déclarer la guerre à ${owner.ownerName} ?`)) void client.action({ type: 'declareWar', target: owner.ownerId }); }}>
                      Déclarer la guerre à {owner.ownerName}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : mineIds.length === 0 ? (
            <>
              <p className="small">Ville libre : vous en deviendrez le dirigeant. L'espace urbain commence vide.</p>
              <button className="primary" onClick={async () => {
                if (await client.act({ t: 'claimCity', cityId: city.id })) setState({ activeCityId: city.id, view: 'city' });
              }}>Prendre cette ville</button>
            </>
          ) : (
            <div className="stack">
              <p className="small">Ville neutre. Étendez votre territoire (≤ {EXPANSION.maxDistanceKm} km d'une de vos villes).</p>
              <label className="small">Payée par
                <select value={source} onChange={(e) => setFromCity(e.target.value)}>
                  {mineIds.map((id) => <option key={id} value={id}>{CITY_BY_ID.get(id)?.name} ({fmtInt(distanceKm(id, city.id))} km)</option>)}
                </select>
              </label>
              <button className="primary" disabled={expansionKm > EXPANSION.maxDistanceKm}
                onClick={() => void client.act({ t: 'expandCity', fromCityId: source, cityId: city.id })}>
                {expansionKm > EXPANSION.maxDistanceKm ? `Trop loin (${fmtInt(expansionKm)} km)` : `Annexer pour ${fmtMoney(expansionCost)}`}
              </button>
            </div>
          )}
          {myArmies.length > 0 && (
            <div className="row">
              <select value={armyId} onChange={(e) => setArmyId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Envoyer une armée…</option>
                {myArmies.map((a) => (
                  <option key={a.id} value={a.id}>Armée #{a.id} ({fmtInt(a.approxSize)}) — {CITY_BY_ID.get(a.movement?.toCityId ?? a.cityId)?.name}</option>
                ))}
              </select>
              <button disabled={armyId === ''} onClick={() => void client.action({ type: 'moveArmy', armyId: Number(armyId), toCityId: city.id })}>Envoyer</button>
            </div>
          )}
          <button className="link" onClick={() => onFocus(city.id)}>Centrer la vue</button>
        </>
      ) : country ? (
        <CountryCard countryId={country.id} onFocus={onFocus} />
      ) : null}
    </aside>
  );
}

function CountryCard({ countryId, onFocus }: { countryId: string; onFocus: (id: string) => void }) {
  const summaries = useGame((s) => s.summaries);
  const world = useGame((s) => s.world);
  const country = COUNTRY_BY_ID.get(countryId);
  const nation = world?.nations.find((n) => n.countryId === countryId);
  const leader = nation?.leaderId ? world?.players.find((p) => p.id === nation.leaderId)?.name : null;
  const cities = useMemo(() => WORLD_CITIES.filter((c) => c.countryId === countryId).sort((a, b) => b.pop - a.pop).slice(0, 40), [countryId]);
  return (
    <>
      <h3>{country?.nameFr}</h3>
      <div className="small muted">
        {summaries.filter((s) => s.countryId === countryId).length} ville(s) dirigée(s) · {leader ? `dirigeant national : ${leader}` : 'pas de dirigeant national (villes indépendantes)'}
      </div>
      <ul className="list scroll">
        {cities.map((c) => {
          const o = summaries.find((s) => s.cityId === c.id);
          return (
            <li key={c.id}>
              <button className="link" onClick={() => onFocus(c.id)}>{c.name}</button>
              <span className={`chip ${o ? 'chip-owned' : 'chip-free'}`}>{o ? o.ownerName : 'libre'}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const SIDES = ['au nord', 'au nord-est', "à l'est", 'au sud-est', 'au sud', 'au sud-ouest', "à l'ouest", 'au nord-ouest'];
function seaSide(dir: number): string {
  return SIDES[Math.round(dir / 45) % 8]!;
}
