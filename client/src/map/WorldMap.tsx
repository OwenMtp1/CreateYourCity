// Carte du monde : pays et villes réels (Natural Earth), zoom continu monde → pays → régions → villes.
import { geoContains, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import countries110Url from 'world-atlas/countries-110m.json?url';
import countries50Url from 'world-atlas/countries-50m.json?url';
import { COUNTRY_BY_ID, WORLD_CITIES, type WorldCity } from '@cyc/shared/world';
import { client } from '../net/client.ts';
import { useGame } from '../state.ts';
import { fmtInt } from '../ui/format.ts';

const W = 960;
const H = 500;
const projection = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], { type: 'Sphere' });
const pathGen = geoPath(projection);

interface CountryShape { id: string; feature: GeoPermissibleObjects; path: Path2D }
interface MapData { low: CountryShape[]; high: CountryShape[] | null; regions: Path2D | null }

const countryId = (f: { id?: string | number; properties: { name: string } }) =>
  f.id ? `N${f.id}` : `X-${f.properties.name.replace(/[^A-Za-z]/g, '')}`;

async function loadCountries(url: string): Promise<CountryShape[]> {
  const topo = (await (await fetch(url)).json()) as Topology;
  const fc = feature(topo, topo.objects.countries!) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;
  return fc.features.map((f) => ({
    id: countryId(f as never),
    feature: f,
    path: new Path2D(pathGen(f) ?? ''),
  }));
}

const projected = new Map<string, [number, number]>(
  WORLD_CITIES.map((c) => [c.id, projection([c.lon, c.lat]) ?? [-1e6, -1e6]]),
);

/** Rang maximal (scalerank) des villes affichées selon le niveau de zoom. */
const rankThreshold = (k: number) => (k < 1.6 ? 1 : k < 3 ? 3 : k < 6 ? 5 : k < 12 ? 7 : k < 24 ? 9 : 10);

const SPHERE = new Path2D(pathGen({ type: 'Sphere' }) ?? '');

export function WorldMap({ onEnterCity }: { onEnterCity: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const dataRef = useRef<MapData>({ low: [], high: null, regions: null });
  const sizeRef = useRef({ w: 800, h: 500, base: 1, ox: 0, oy: 0 });
  const frame = useRef(0);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const summaries = useGame((s) => s.summaries);
  const myCity = useGame((s) => s.myCity);
  const player = useGame((s) => s.player);
  const owners = useMemo(() => new Map(summaries.map((s) => [s.cityId, s])), [summaries]);
  const countriesWithPlayers = useMemo(() => new Set(summaries.map((s) => s.countryId)), [summaries]);

  const stateRef = useRef({ owners, countriesWithPlayers, selectedCountry, selectedCity, myCityId: myCity?.cityId ?? null });
  stateRef.current = { owners, countriesWithPlayers, selectedCountry, selectedCity, myCityId: myCity?.cityId ?? null };

  const draw = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => render());
  };

  // Transformation écran : zoom utilisateur ∘ ajustement de la carte de référence à la taille du canevas.
  const toScreen = (p: [number, number], t: ZoomTransform) => {
    const { base, ox, oy } = sizeRef.current;
    return [t.x + t.k * (ox + p[0] * base), t.y + t.k * (oy + p[1] * base)] as const;
  };

  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { w, h, base, ox, oy } = sizeRef.current;
    const t = transformRef.current;
    const st = stateRef.current;
    const data = dataRef.current;
    const css = getComputedStyle(canvas);
    const color = (name: string) => css.getPropertyValue(name).trim();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color('--map-bg');
    ctx.fillRect(0, 0, w, h);
    const k = t.k * base;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (t.x + t.k * ox), dpr * (t.y + t.k * oy));
    ctx.fillStyle = color('--map-ocean');
    ctx.fill(SPHERE);
    const shapes = t.k >= 3 && data.high ? data.high : data.low;
    ctx.lineWidth = 0.6 / k;
    ctx.strokeStyle = color('--map-border');
    for (const c of shapes) {
      ctx.fillStyle =
        c.id === st.selectedCountry ? color('--map-land-selected')
          : st.countriesWithPlayers.has(c.id) ? color('--map-land-played')
            : color('--map-land');
      ctx.fill(c.path);
      ctx.stroke(c.path);
    }
    if (t.k >= 5 && data.regions) {
      ctx.lineWidth = 0.4 / k;
      ctx.strokeStyle = color('--map-region');
      ctx.stroke(data.regions);
    }

    // Villes, en coordonnées écran.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const maxRank = rankThreshold(t.k);
    const labels: [number, number, number, number][] = [];
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const c of WORLD_CITIES) {
      const owner = st.owners.get(c.id);
      const important = owner || c.id === st.selectedCity;
      if (c.rank > maxRank && !important) continue;
      const [x, y] = toScreen(projected.get(c.id)!, t);
      if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue;
      const mine = c.id === st.myCityId;
      const r = mine ? 6 : owner ? 5 : c.capital ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = mine ? color('--city-mine') : owner ? color('--city-owned') : color('--city-free');
      ctx.fill();
      if (c.id === st.selectedCity) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = color('--accent');
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      const showLabel = important || c.rank <= maxRank - 1 || t.k > 30;
      if (!showLabel) continue;
      const text = owner ? `${c.name} (${owner.ownerName})` : c.name;
      const tw = ctx.measureText(text).width;
      const box: [number, number, number, number] = [x + r + 3, y - 7, x + r + 3 + tw, y + 7];
      if (!important && labels.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
      labels.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = color('--map-label-halo');
      ctx.strokeText(text, box[0], y);
      ctx.fillStyle = owner ? color('--text') : color('--map-label');
      ctx.fillText(text, box[0], y);
    }
  }

  // Chargement des données géographiques.
  useEffect(() => {
    let cancelled = false;
    void loadCountries(countries110Url).then((low) => {
      if (cancelled) return;
      dataRef.current.low = low;
      draw();
      void loadCountries(countries50Url).then((high) => {
        if (cancelled) return;
        dataRef.current.high = high;
        draw();
      });
      void fetch('/geo/regions-50m.json')
        .then((r) => r.json())
        .then((fc: GeoJSON.FeatureCollection) => {
          if (cancelled) return;
          dataRef.current.regions = new Path2D(fc.features.map((f) => pathGen(f) ?? '').join(''));
          draw();
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  // Taille du canevas et comportement de zoom.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const base = Math.min(w / W, h / H);
      sizeRef.current = { w, h, base, ox: (w - W * base) / 2, oy: (h - H * base) / 2 };
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    const behavior = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 800])
      .on('zoom', (e: { transform: ZoomTransform }) => {
        transformRef.current = e.transform;
        draw();
      });
    zoomRef.current = behavior;
    select(canvas).call(behavior);
    return () => {
      ro.disconnect();
      select(canvas).on('.zoom', null);
    };
  }, []);

  useEffect(draw, [owners, countriesWithPlayers, selectedCountry, selectedCity, myCity?.cityId]);

  const focusCity = (c: WorldCity, k = 40) => {
    setSelectedCity(c.id);
    setSelectedCountry(c.countryId);
    const canvas = canvasRef.current;
    const z = zoomRef.current;
    if (!canvas || !z) return;
    const { w, h, base, ox, oy } = sizeRef.current;
    const p = projected.get(c.id)!;
    const sx = ox + p[0] * base;
    const sy = oy + p[1] * base;
    select(canvas).call(z.transform, zoomIdentity.translate(w / 2 - k * sx, h / 2 - k * sy).scale(k));
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = transformRef.current;
    const maxRank = rankThreshold(t.k);
    let best: WorldCity | null = null;
    let bestD = 10;
    for (const c of WORLD_CITIES) {
      if (c.rank > maxRank && !owners.has(c.id)) continue;
      const [x, y] = toScreen(projected.get(c.id)!, t);
      const d = Math.hypot(x - mx, y - my);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      setSelectedCity(best.id);
      setSelectedCountry(best.countryId);
      return;
    }
    const { base, ox, oy } = sizeRef.current;
    const lonlat = projection.invert?.([((mx - t.x) / t.k - ox) / base, ((my - t.y) / t.k - oy) / base]);
    setSelectedCity(null);
    if (!lonlat) return setSelectedCountry(null);
    const shapes = dataRef.current.high ?? dataRef.current.low;
    setSelectedCountry(shapes.find((s) => geoContains(s.feature, lonlat))?.id ?? null);
  };

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return WORLD_CITIES.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  const country = selectedCountry ? COUNTRY_BY_ID.get(selectedCountry) : undefined;
  const countryCities = useMemo(
    () => (selectedCountry ? WORLD_CITIES.filter((c) => c.countryId === selectedCountry).sort((a, b) => b.pop - a.pop) : []),
    [selectedCountry],
  );
  const city = selectedCity ? WORLD_CITIES.find((c) => c.id === selectedCity) : undefined;
  const cityOwner = city ? owners.get(city.id) : undefined;

  const claim = async (c: WorldCity) => {
    if (await client.act({ t: 'claimCity', cityId: c.id })) onEnterCity();
  };

  return (
    <div className="map-layout">
      <div ref={containerRef} className="map-canvas">
        <canvas ref={canvasRef} onClick={onClick} aria-label="Carte du monde" />
        <div className="map-legend">
          <span><i className="lg lg-free" /> Ville libre</span>
          <span><i className="lg lg-owned" /> Ville d'un joueur</span>
          <span><i className="lg lg-mine" /> Ma ville</span>
          <span><i className="lg lg-played" /> Pays avec joueurs</span>
        </div>
        <div className="map-credits">Données : Natural Earth (domaine public)</div>
      </div>
      <aside className="map-panel">
        <input className="search" placeholder="Rechercher une ville…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {searchResults.length > 0 && (
          <ul className="list">
            {searchResults.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => { focusCity(c); setQuery(''); }}>
                  {c.name} <span className="muted">· {COUNTRY_BY_ID.get(c.countryId)?.nameFr}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {myCity && (
          <div className="card compact">
            <div className="muted small">Ma ville</div>
            <strong>{WORLD_CITIES.find((c) => c.id === myCity.cityId)?.name}</strong>
            <button className="primary" onClick={onEnterCity}>Entrer dans ma ville</button>
          </div>
        )}

        {city ? (
          <div className="card compact">
            <h3>{city.name}</h3>
            <div className="muted">{COUNTRY_BY_ID.get(city.countryId)?.nameFr}{city.capital ? ' · capitale' : ''}</div>
            <div className="small muted">Population réelle (contexte) : {fmtInt(city.pop)}</div>
            {cityOwner ? (
              <>
                <p>
                  Dirigée par <strong>{cityOwner.ownerName}</strong>
                  {cityOwner.ownerId === player?.id ? ' (vous)' : ''}
                </p>
                <div className="small">Habitants (jeu) : ~{fmtInt(cityOwner.population)} · Constructions : {cityOwner.buildingCount}</div>
                {cityOwner.ownerId !== player?.id && (
                  <p className="small muted">Les informations économiques et militaires détaillées dépendront des relations diplomatiques (non implémentées).</p>
                )}
              </>
            ) : myCity ? (
              <p className="small muted">Ville libre. Vous dirigez déjà une ville dans ce salon.</p>
            ) : (
              <>
                <p className="small">Ville libre : vous en deviendrez le dirigeant. L'espace urbain commence vide.</p>
                <button className="primary" onClick={() => void claim(city)}>Prendre cette ville</button>
              </>
            )}
            <button className="link" onClick={() => focusCity(city)}>Centrer la carte</button>
          </div>
        ) : null}

        {country ? (
          <div className="card compact">
            <h3>{country.nameFr}</h3>
            <div className="small muted">
              {summaries.filter((s) => s.countryId === country.id).length} ville(s) dirigée(s) par des joueurs · élection nationale non implémentée
            </div>
            <ul className="list scroll">
              {countryCities.slice(0, 60).map((c) => {
                const o = owners.get(c.id);
                return (
                  <li key={c.id}>
                    <button className="link" onClick={() => focusCity(c)}>{c.name}</button>
                    <span className={`chip ${o ? 'chip-owned' : 'chip-free'}`}>{o ? o.ownerName : 'libre'}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : !city && (
          <p className="muted small">
            Faites défiler pour zoomer, glissez pour vous déplacer. Cliquez sur un pays puis choisissez une ville libre.
          </p>
        )}
      </aside>
    </div>
  );
}
