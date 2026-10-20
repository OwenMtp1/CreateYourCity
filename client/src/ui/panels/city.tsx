import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BUILDING_TYPES, BUILDINGS, MAX_DEBT, MAX_TAX_RATE, PARKING, ROAD_TYPES, ROADS, SERVICE_KINDS, type Building, type BuildingCategory, type ServiceKind,
} from '@cyc/shared';
import type { CityLayer } from '../../city3d/CityScene.ts';
import type { Tool } from '../../city3d/CityView3D.tsx';
import { client } from '../../net/client.ts';
import { getQuality, setQuality } from '../../city3d/quality.ts';
import { activeCity, useGame } from '../../state.ts';
import { flow, Row } from '../common.tsx';
import { Businesses, GoodsCircuit } from './economy.tsx';
import { fmtInt, fmtMoney, fmtPct } from '../format.ts';

const CATEGORY_LABEL: Record<BuildingCategory, string> = {
  residential: 'Logement', commercial: 'Commerce et entreprises', industrial: 'Industrie', service: 'Services publics',
  utility: 'Réseaux', transport: 'Transports', military: 'Défense',
};
export const SERVICE_LABEL: Record<ServiceKind, string> = { health: 'Santé', education: 'Éducation', safety: 'Sécurité', leisure: 'Loisirs' };
export { ICON };
export const STATUS_LABEL = { ok: 'En service', no_road: 'Aucune route à proximité', disconnected: "Route non reliée à l'accès régional" };
const ICON: Record<string, string> = {
  house: '🏡', apartment: '🏢', tower: '🏙️', shop: '🛍️', office: '💼', factory: '🏭', clinic: '🏥', school: '🏫', police: '🚓',
  power_plant: '⚡', water_tower: '💧', park: '🌳', barracks: '🎖️', street: '🛣️', avenue: '🛤️', bridge: '🌉',
  bus_station: '🚌', tram_station: '🚋', metro_station: '🚇', train_station: '🚆', port: '⚓', airbase: '✈️',
  parking: '🅿️', parking_garage: '🚗',
};

/** Réglages d'affichage de la ville : grille, cycle jour/nuit, qualité, couche d'information. */
export function DisplayOptions(props: {
  grid: boolean; setGrid: (g: boolean) => void; layer: CityLayer; setLayer: (l: CityLayer) => void; dayNight: boolean; setDayNight: (v: boolean) => void;
}) {
  const { grid, setGrid, layer, setLayer, dayNight, setDayNight } = props;
  return (
    <>
      <div className="row wrap">
        <label className="check"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grille</label>
        <label className="check"><input type="checkbox" checked={dayNight} onChange={(e) => setDayNight(e.target.checked)} /> Cycle jour/nuit</label>
        <label className="check" title="Mode économique : sans ombres, résolution réduite (rechargement de la page)">
          <input type="checkbox" checked={getQuality() === 'low'} onChange={(e) => { setQuality(e.target.checked ? 'low' : 'high'); location.reload(); }} /> Graphismes économiques
        </label>
      </div>
      <label>
        Couche d'information
        <select value={layer} onChange={(e) => setLayer(e.target.value as CityLayer)}>
          <option value="none">Aucune</option>
          <option value="status">Raccordement des bâtiments</option>
          <option value="traffic">Trafic</option>
          <option value="health">Couverture santé</option>
          <option value="education">Couverture éducation</option>
          <option value="safety">Couverture sécurité</option>
          <option value="leisure">Couverture loisirs</option>
          <option value="pollution">Pollution</option>
          <option value="economy">Économie : bénéfices et livraisons</option>
        </select>
      </label>

    </>
  );
}

const ROAD_MODES = [['straight', '➖', 'Droite'], ['curve', '〰️', 'Courbe'], ['roundabout', '⭕', 'Rond-point']] as const;
type BarCategory = 'roads' | BuildingCategory;
const CATEGORY_ICON: Record<BarCategory, string> = {
  roads: '🛣️', residential: '🏡', commercial: '🛍️', industrial: '🏭', service: '🏥', utility: '⚡', transport: '🚆', military: '🎖️',
};
const shortMoney = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : v >= 1e4 ? `${Math.round(v / 1e3)} k` : fmtInt(v));

/**
 * Barre de construction mobile, à la manière des jeux de gestion : catégories en haut, cartes défilantes
 * dessous, la ville reste visible. Toucher une carte choisit l'outil ; toucher la carte de la ville place l'aperçu.
 */
export function MobileBuildBar({ tool, setTool, onOptions }: { tool: Tool; setTool: (t: Tool) => void; onOptions: () => void }) {
  const city = useGame(activeCity)!;
  const categories: BarCategory[] = ['roads', ...new Set(BUILDING_TYPES.map((t) => BUILDINGS[t].category))];
  const [cat, setCat] = useState<BarCategory>(tool.kind === 'building' ? BUILDINGS[tool.building].category : 'roads');
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ left: 0 }); }, [cat]);
  const roadTool = (road: (typeof ROAD_TYPES)[number], mode = tool.kind === 'road' ? tool.mode ?? 'straight' : 'straight') =>
    setTool({ kind: 'road', road, mode, radius: tool.kind === 'road' ? tool.radius ?? 30 : 30 });

  let info = 'Choisissez une construction, puis touchez la carte pour la placer.';
  if (tool.kind === 'building') {
    const d = BUILDINGS[tool.building];
    info = `${d.label} · ${fmtMoney(d.cost)} · entretien ${fmtInt(d.upkeepPerDay)}/j · ${d.housing ? `${d.housing} logements` : `${d.jobs} emplois`}`;
  } else if (tool.kind === 'road') {
    info = `${ROADS[tool.road].label} · ${ROADS[tool.road].costPerMeter} cr/m · touchez le départ puis l'arrivée (accès : portique jaune à l'ouest)`;
  } else if (tool.kind === 'demolish') info = 'Démolir : touchez un bâtiment ou une route (sans remboursement).';

  return (
    <div className="buildbar glass" onPointerDown={(e) => e.stopPropagation()}>
      <div className="buildbar-cats" role="tablist">
        <button className={`cat-chip ${tool.kind === 'select' ? 'active' : ''}`} onClick={() => setTool({ kind: 'select' })} aria-label="Inspecter">🔍</button>
        <button className={`cat-chip danger ${tool.kind === 'demolish' ? 'active' : ''}`} onClick={() => setTool({ kind: 'demolish' })} aria-label="Démolir">🧨</button>
        <span className="cat-sep" />
        {categories.map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} className={`cat-chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}
            aria-label={c === 'roads' ? 'Routes' : CATEGORY_LABEL[c]}>
            {CATEGORY_ICON[c]}
          </button>
        ))}
        <button className="cat-chip" onClick={onOptions} aria-label="Affichage">🎛️</button>
      </div>
      <div className="bb-info">{info}</div>
      <div className="buildbar-items" ref={scroller}>
        {cat === 'roads' ? (
          <>
            {ROAD_TYPES.map((r) => (
              <button key={r} className={`bb-item ${tool.kind === 'road' && tool.road === r ? 'active' : ''}`} onClick={() => roadTool(r)}>
                <span className="bb-icon">{ICON[r]}</span>
                <span className="bb-name">{ROADS[r].label}</span>
                <span className="bb-price">{ROADS[r].costPerMeter} cr/m</span>
              </button>
            ))}
            {ROAD_MODES.map(([mode, icon, label]) => (
              <button key={mode} className={`bb-item mode ${tool.kind === 'road' && (tool.mode ?? 'straight') === mode ? 'active' : ''}`}
                onClick={() => roadTool(tool.kind === 'road' ? tool.road : 'street', mode)}>
                <span className="bb-icon">{icon}</span>
                <span className="bb-name">{label}</span>
                <span className="bb-price muted">tracé</span>
              </button>
            ))}
          </>
        ) : (
          BUILDING_TYPES.filter((t) => BUILDINGS[t].category === cat).map((t) => {
            const d = BUILDINGS[t];
            const poor = city.treasury < d.cost;
            return (
              <button key={t} className={`bb-item ${tool.kind === 'building' && tool.building === t ? 'active' : ''} ${poor ? 'poor' : ''}`} disabled={poor}
                onClick={() => setTool({ kind: 'building', building: t, rotation: tool.kind === 'building' ? tool.rotation : 0 })}>
                <span className="bb-icon">{ICON[t]}</span>
                <span className="bb-name">{d.label}</span>
                <span className="bb-price">{shortMoney(d.cost)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function BuildPanel(props: {
  tool: Tool; setTool: (t: Tool) => void; grid: boolean; setGrid: (g: boolean) => void;
  layer: CityLayer; setLayer: (l: CityLayer) => void; dayNight: boolean; setDayNight: (v: boolean) => void;
}) {
  const { tool, setTool, grid, setGrid, layer, setLayer, dayNight, setDayNight } = props;
  const city = useGame(activeCity)!;
  const categories = [...new Set(BUILDING_TYPES.map((t) => BUILDINGS[t].category))];

  return (
    <div className="stack">
      <div className="row wrap">
        <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => setTool({ kind: 'select' })}>🔍 Inspecter</button>
        <button className={tool.kind === 'demolish' ? 'active danger' : 'danger'} onClick={() => setTool({ kind: 'demolish' })}>🧨 Démolir</button>
      </div>
      <DisplayOptions grid={grid} setGrid={setGrid} layer={layer} setLayer={setLayer} dayNight={dayNight} setDayNight={setDayNight} />

      <h4>Routes</h4>
      <div className="row wrap">
        {([['straight', '➖ Droite'], ['curve', '〰️ Courbe'], ['roundabout', '⭕ Rond-point']] as const).map(([mode, label]) => (
          <button key={mode} className={`small-btn ${tool.kind === 'road' && (tool.mode ?? 'straight') === mode ? 'active' : ''}`}
            onClick={() => setTool({ kind: 'road', road: tool.kind === 'road' ? tool.road : 'street', mode, radius: tool.kind === 'road' ? tool.radius ?? 30 : 30 })}>
            {label}
          </button>
        ))}
        {tool.kind === 'road' && tool.mode === 'roundabout' && (
          <select value={tool.radius ?? 30} onChange={(e) => setTool({ ...tool, radius: Number(e.target.value) })} style={{ width: 'auto' }}>
            <option value={22}>Petit (22 m)</option>
            <option value={30}>Moyen (30 m)</option>
            <option value={45}>Grand (45 m)</option>
          </select>
        )}
      </div>
      <div className="build-grid">
        {ROAD_TYPES.map((r) => (
          <button key={r} className={tool.kind === 'road' && tool.road === r ? 'build active' : 'build'}
            onClick={() => setTool({ kind: 'road', road: r, mode: tool.kind === 'road' ? tool.mode ?? 'straight' : 'straight', radius: tool.kind === 'road' ? tool.radius ?? 30 : 30 })}>
            <span className="build-icon">{ICON[r]}</span>
            <strong>{ROADS[r].label}</strong>
            <span className="small">{ROADS[r].costPerMeter} cr/m · {fmtInt(ROADS[r].capacityTripsPerDay)} trajets/j</span>
          </button>
        ))}
      </div>
      <p className="small muted">Partez du portique jaune (accès régional, bord ouest) : un bâtiment ne fonctionne que desservi par une route raccordée.
        Pour franchir l'eau, utilisez le <strong>pont</strong> (rues et avenues ne peuvent pas traverser).</p>

      {categories.map((cat) => (
        <div key={cat}>
          <h4>{CATEGORY_LABEL[cat]}</h4>
          <div className="build-grid">
            {BUILDING_TYPES.filter((t) => BUILDINGS[t].category === cat).map((t) => {
              const d = BUILDINGS[t];
              const active = tool.kind === 'building' && tool.building === t;
              return (
                <button key={t} title={d.description} className={active ? 'build active' : 'build'} disabled={city.treasury < d.cost}
                  onClick={() => setTool({ kind: 'building', building: t, rotation: tool.kind === 'building' ? tool.rotation : 0 })}>
                  <span className="build-icon">{ICON[t]}</span>
                  <strong>{d.label}</strong>
                  <span className="small">{fmtMoney(d.cost)} · {fmtInt(d.upkeepPerDay)}/j</span>
                  <span className="small muted">
                    {d.housing ? `${d.housing} logements` : `${d.jobs} emplois`}
                    {d.service ? ` · ${fmtInt(d.service.capacity)} hab./${d.service.radius} m` : ''}
                    {d.powerOutputMW ? ` · ${d.powerOutputMW} MW` : ''}
                    {d.waterOutputM3PerDay ? ` · ${fmtInt(d.waterOutputM3PerDay)} m³/j` : ''}
                    {d.goodsProductionPerDay ? ` · ${d.goodsProductionPerDay} biens/j` : ''}
                    {d.parking ? ` · ${fmtInt(d.parking.spaces)} places` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

    </div>
  );
}

/** Réglage du tarif d'un parking : gratuit, ou payant avec un prix par stationnement. */
export function ParkingSettings({ id, spaces, fee, use }: { id: number; spaces: number; fee: number; use: number | undefined }) {
  const [paid, setPaid] = useState(fee > 0);
  const [price, setPrice] = useState(fee > 0 ? fee : 2);
  const dirty = (paid ? price : 0) !== fee;
  const apply = async (e: FormEvent) => {
    e.preventDefault();
    await client.cityCommand({ type: 'setParkingFee', id, fee: paid ? price : 0 });
  };
  return (
    <form className="stack" onSubmit={(e) => void apply(e)}>
      <Row label="Places" value={fmtInt(spaces)} />
      <Row label="Occupation" value={use === undefined ? '—' : `${fmtPct(use)} (${fmtInt(use * spaces)} places)`} />
      <Row label="Tarif actuel" value={fee > 0 ? `${fee.toLocaleString('fr-FR')} cr / stationnement` : 'Gratuit'} />
      <label className="check"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Parking payant</label>
      {paid && (
        <label>
          Prix d'un stationnement : {price.toLocaleString('fr-FR')} cr
          <input type="range" min={0.5} max={PARKING.maxFee} step={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </label>
      )}
      <p className="small muted">
        Un parking payant rapporte {PARKING.turnoverPerDay} stationnements par place occupée et par jour, mais les automobilistes
        préfèrent la rue et les parkings gratuits ; trop cher, il reste vide et la ville perd en attractivité.
      </p>
      <button type="submit" disabled={!dirty}>Appliquer le tarif</button>
    </form>
  );
}

export function EconomyPanel({ onSelect }: { onSelect?: (b: Building) => void }) {
  const city = useGame(activeCity)!;
  const s = city.stats;
  const [taxes, setTaxes] = useState(city.taxes);
  const [amount, setAmount] = useState(100_000);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setTaxes(city.taxes); }, [city.taxes]);

  const applyTaxes = async (e: FormEvent) => {
    e.preventDefault();
    await client.cityCommand({ type: 'setTaxes', taxes });
    dirty.current = false;
  };

  return (
    <div className="stack">
      <h4>Budget municipal (par jour de jeu)</h4>
      {s ? (
        <>
          <Row label="Impôt sur le revenu" value={flow(s.budget.residentialTax, '+')} tone="pos" />
          <Row label="Impôt commercial" value={flow(s.budget.commercialTax, '+')} tone="pos" />
          <Row label="Impôt industriel" value={flow(s.budget.industrialTax, '+')} tone="pos" />
          <Row label="Entretien et salaires publics" value={flow(s.budget.upkeep, '−')} tone="neg" />
          {(s.budget.transitFares ?? 0) > 0 && <Row label="Billets de transports en commun" value={flow(s.budget.transitFares, '+')} tone="pos" />}
          {(s.budget.parkingFees ?? 0) > 0 && <Row label="Stationnement payant" value={flow(s.budget.parkingFees, '+')} tone="pos" />}
          <Row label="Importations d'électricité et d'eau" value={flow(s.budget.utilityImports, '−')} tone="neg" />
          <Row label="Intérêts de la dette" value={flow(s.budget.loanInterest, '−')} tone="neg" />
          <Row label="Solde" value={`${s.budget.net >= 0 ? '+' : '−'}${fmtInt(Math.abs(s.budget.net))}`} tone={s.budget.net >= 0 ? 'pos' : 'neg'} />
          {s.budget.nationalTax > 0 && <Row label="Impôt national payé par les habitants" value={fmtInt(s.budget.nationalTax)} />}
        </>
      ) : <p className="muted">En attente du premier tick…</p>}
      {city.treasury < 0 && <p className="error-text small">Trésorerie négative : services publics à 60 %, construction impossible.</p>}

      <h4>Fiscalité locale</h4>
      <form onSubmit={applyTaxes} className="stack">
        {(['residential', 'commercial', 'industrial'] as const).map((k) => (
          <label key={k}>
            {k === 'residential' ? 'Résidentiel (revenus)' : k === 'commercial' ? 'Commercial (bénéfices)' : 'Industriel (bénéfices)'} : {fmtPct(taxes[k])}
            <input type="range" min={0} max={MAX_TAX_RATE} step={0.01} value={taxes[k]}
              onChange={(e) => { dirty.current = true; setTaxes({ ...taxes, [k]: Number(e.target.value) }); }} />
          </label>
        ))}
        <button className="primary">Appliquer les taux</button>
      </form>

      <h4>Dette</h4>
      <Row label="Dette" value={fmtMoney(city.debt)} />
      <Row label="Plafond" value={fmtMoney(MAX_DEBT)} />
      <div className="row">
        <input type="number" min={1000} step={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <button onClick={() => void client.cityCommand({ type: 'borrow', amount })}>Emprunter</button>
        <button onClick={() => void client.cityCommand({ type: 'repay', amount })} disabled={city.debt <= 0}>Rembourser</button>
      </div>

      {s && <GoodsCircuit />}
      {s && <Businesses onSelect={onSelect} />}
    </div>
  );
}

export function PopulationPanel() {
  const city = useGame(activeCity)!;
  const s = city.stats;
  if (!s) return <p className="muted">En attente du premier tick…</p>;
  return (
    <div className="stack">
      <h4>Habitants</h4>
      <Row label="Population" value={fmtInt(city.population)} />
      <Row label="Logements disponibles" value={fmtInt(s.housingCapacity)} />
      <Row label="Population d'équilibre" value={fmtInt(s.targetPopulation)} />
      <Row label="Migrations" value={`${s.migrationPerDay >= 0 ? '+' : '−'}${fmtInt(Math.abs(s.migrationPerDay))} /j`} tone={s.migrationPerDay >= 0 ? 'pos' : 'neg'} />
      <Row label="Attractivité" value={fmtPct(s.attractiveness)} />
      <div className="bar big"><div style={{ width: `${Math.round(s.attractiveness * 100)}%` }} /></div>
      <h4>Emploi</h4>
      <Row label="Actifs" value={fmtInt(s.workforce)} />
      <Row label="Emplois" value={fmtInt(s.jobs)} />
      <Row label="Actifs occupés" value={fmtInt(s.employed)} />
      <Row label="Chômage" value={fmtPct(s.unemploymentRate, 1)} tone={s.unemploymentRate > 0.1 ? 'neg' : undefined} />
      <Row label="Postes pourvus" value={fmtPct(s.staffingRatio)} />
      <p className="small muted">
        Attractivité = 40 % emploi + 25 % services + 20 % fiscalité (locale + nationale) + 15 % trafic − 30 % pollution (± lois nationales).
      </p>
    </div>
  );
}

export function ServicesPanel({ layer, setLayer }: { layer: CityLayer; setLayer: (l: CityLayer) => void }) {
  const city = useGame(activeCity)!;
  const s = city.stats;
  if (!s) return <p className="muted">En attente du premier tick…</p>;
  return (
    <div className="stack">
      <h4>Services publics</h4>
      {SERVICE_KINDS.map((k) => (
        <div key={k} className="service-row">
          <button className={layer === k ? 'active small-btn' : 'small-btn'} onClick={() => setLayer(layer === k ? 'none' : k)}>Couche</button>
          <span>{SERVICE_LABEL[k]}</span>
          <div className="bar"><div style={{ width: `${Math.round(s.services[k].coverage * 100)}%` }} /></div>
          <span className="small">{fmtPct(s.services[k].coverage)}</span>
        </div>
      ))}
      <Row label="Inégalités entre quartiers" value={fmtPct(s.serviceInequality)} />
      <Row label="Exposition à la pollution" value={fmtPct(s.pollutionExposure)} />
      <h4>Réseaux</h4>
      <Row label="Électricité : demande" value={`${s.power.demandMW.toFixed(2)} MW`} />
      <Row label="Électricité : locale / importée" value={`${s.power.localMW.toFixed(2)} / ${s.power.importedMW.toFixed(2)} MW`} />
      <Row label="Eau : demande" value={`${fmtInt(s.water.demandM3)} m³/j`} />
      <Row label="Eau : locale / importée" value={`${fmtInt(s.water.localM3)} / ${fmtInt(s.water.importedM3)} m³/j`} />
      <h4>Trafic</h4>
      <Row label="Déplacements" value={`${fmtInt(s.traffic.trips)} /j`} />
      <Row label="Fluidité" value={fmtPct(s.traffic.efficiency)} tone={s.traffic.efficiency < 0.9 ? 'neg' : undefined} />
      <Row label="Tronçons saturés" value={String(s.traffic.congestedSegments)} />
      <button className={layer === 'traffic' ? 'active' : ''} onClick={() => setLayer(layer === 'traffic' ? 'none' : 'traffic')}>Couche trafic</button>
    </div>
  );
}
