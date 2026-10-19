import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BUILDING_TYPES, BUILDINGS, MAX_DEBT, MAX_TAX_RATE, ROAD_TYPES, ROADS, SERVICE_KINDS, type BuildingCategory, type ServiceKind,
} from '@cyc/shared';
import type { CityLayer } from '../../city3d/CityScene.ts';
import type { Tool } from '../../city3d/CityView3D.tsx';
import { client } from '../../net/client.ts';
import { getQuality, setQuality } from '../../city3d/quality.ts';
import { activeCity, useGame } from '../../state.ts';
import { flow, Row } from '../common.tsx';
import { fmtInt, fmtMoney, fmtPct } from '../format.ts';

const CATEGORY_LABEL: Record<BuildingCategory, string> = {
  residential: 'Logement', commercial: 'Commerce et entreprises', industrial: 'Industrie', service: 'Services publics',
  utility: 'Réseaux', military: 'Défense',
};
export const SERVICE_LABEL: Record<ServiceKind, string> = { health: 'Santé', education: 'Éducation', safety: 'Sécurité', leisure: 'Loisirs' };
const STATUS_LABEL = { ok: 'En service', no_road: 'Aucune route à proximité', disconnected: "Route non reliée à l'accès régional" };
const ICON: Record<string, string> = {
  house: '🏡', apartment: '🏢', tower: '🏙️', shop: '🛍️', office: '💼', factory: '🏭', clinic: '🏥', school: '🏫', police: '🚓',
  power_plant: '⚡', water_tower: '💧', park: '🌳', barracks: '🎖️', street: '🛣️', avenue: '🛤️',
};

export function BuildPanel(props: {
  tool: Tool; setTool: (t: Tool) => void; grid: boolean; setGrid: (g: boolean) => void;
  layer: CityLayer; setLayer: (l: CityLayer) => void; selected: number | null; dayNight: boolean; setDayNight: (v: boolean) => void;
}) {
  const { tool, setTool, grid, setGrid, layer, setLayer, selected, dayNight, setDayNight } = props;
  const city = useGame(activeCity)!;
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] : undefined));
  const categories = [...new Set(BUILDING_TYPES.map((t) => BUILDINGS[t].category))];
  const sel = selected !== null ? city.buildings.find((b) => b.id === selected) : undefined;

  return (
    <div className="stack">
      <div className="row wrap">
        <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => setTool({ kind: 'select' })}>🔍 Inspecter</button>
        <button className={tool.kind === 'demolish' ? 'active danger' : 'danger'} onClick={() => setTool({ kind: 'demolish' })}>🧨 Démolir</button>
      </div>
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
        </select>
      </label>

      <h4>Routes</h4>
      <div className="build-grid">
        {ROAD_TYPES.map((r) => (
          <button key={r} className={tool.kind === 'road' && tool.road === r ? 'build active' : 'build'} onClick={() => setTool({ kind: 'road', road: r })}>
            <span className="build-icon">{ICON[r]}</span>
            <strong>{ROADS[r].label}</strong>
            <span className="small">{ROADS[r].costPerMeter} cr/m · {fmtInt(ROADS[r].capacityTripsPerDay)} trajets/j</span>
          </button>
        ))}
      </div>
      <p className="small muted">Partez du portique jaune (accès régional, bord ouest) : un bâtiment ne fonctionne que desservi par une route raccordée.</p>

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
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {sel && (
        <div className="card compact">
          <h4>{ICON[sel.type]} {BUILDINGS[sel.type].label} #{sel.id}</h4>
          <p className="small muted">{BUILDINGS[sel.type].description}</p>
          <Row label="État" value={STATUS_LABEL[layers?.buildingStatus[sel.id] ?? 'ok']} />
          {layers?.residentialCoverage[sel.id] && SERVICE_KINDS.map((k) => (
            <Row key={k} label={`Couverture ${SERVICE_LABEL[k].toLowerCase()}`} value={fmtPct(layers.residentialCoverage[sel.id]![k] ?? 0)} />
          ))}
          {layers?.pollution[sel.id] !== undefined && <Row label="Exposition à la pollution" value={fmtPct(layers.pollution[sel.id]!)} />}
          <button className="danger" onClick={() => void client.cityCommand({ type: 'demolish', target: 'building', id: sel.id })}>Démolir</button>
        </div>
      )}
    </div>
  );
}

export function EconomyPanel() {
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

      {s && (
        <>
          <h4>Biens</h4>
          <Row label="Demande des habitants" value={`${fmtInt(s.goods.demand)} /j`} />
          <Row label="Ventes des commerces" value={`${fmtInt(s.goods.sold)} /j`} />
          <Row label="Production locale" value={`${fmtInt(s.goods.produced)} /j`} />
          <Row label="Reçus par contrats" value={`${fmtInt(s.goods.contractIn)} /j`} />
          <Row label="Livrés par contrats" value={`${fmtInt(s.goods.contractDelivered)} /j`} />
          <Row label="Achetés au marché" value={`${fmtInt(s.goods.imported)} /j à ${s.goods.importPrice.toFixed(1)} cr`} />
          <Row label="Vendus au marché" value={`${fmtInt(s.goods.exported)} /j à ${s.goods.exportPrice.toFixed(1)} cr`} />
        </>
      )}
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
