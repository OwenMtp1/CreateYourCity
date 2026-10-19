import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BUILDING_TYPES, BUILDINGS, MAX_DEBT, MAX_TAX_RATE, ROAD_TYPES, ROADS, SERVICE_KINDS, type BuildingCategory, type ServiceKind,
} from '@cyc/shared';
import { CITY_BY_ID, COUNTRY_BY_ID } from '@cyc/shared/world';
import type { Layer, Tool } from '../city/CityView.tsx';
import { client } from '../net/client.ts';
import { useGame } from '../state.ts';
import { fmtInt, fmtMoney, fmtPct } from './format.ts';

const CATEGORY_LABEL: Record<BuildingCategory, string> = {
  residential: 'Logement', commercial: 'Commerce et entreprises', industrial: 'Industrie', service: 'Services publics', utility: 'Réseaux',
};
const SERVICE_LABEL: Record<ServiceKind, string> = { health: 'Santé', education: 'Éducation', safety: 'Sécurité' };
const STATUS_LABEL = { ok: 'En service', no_road: 'Aucune route à proximité', disconnected: "Route non reliée à l'accès régional" };

/** Montant signé d'une ligne budgétaire (pas de « −0 »). */
const flow = (v: number, sign: '+' | '−') => (Math.round(v) === 0 ? '0' : `${sign}${fmtInt(v)}`);

function Row({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <span className={tone}>{value}</span>
    </div>
  );
}

export function BuildPanel(props: {
  tool: Tool; setTool: (t: Tool) => void; grid: boolean; setGrid: (g: boolean) => void;
  layer: Layer; setLayer: (l: Layer) => void; selected: number | null;
}) {
  const { tool, setTool, grid, setGrid, layer, setLayer, selected } = props;
  const city = useGame((s) => s.myCity)!;
  const layers = useGame((s) => s.layers);
  const categories = [...new Set(BUILDING_TYPES.map((t) => BUILDINGS[t].category))];
  const sel = selected !== null ? city.buildings.find((b) => b.id === selected) : undefined;

  return (
    <div className="stack">
      <div className="row wrap">
        <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => setTool({ kind: 'select' })}>Inspecter</button>
        <button className={tool.kind === 'demolish' ? 'active danger' : 'danger'} onClick={() => setTool({ kind: 'demolish' })}>Démolir</button>
        <label className="check"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grille</label>
      </div>
      <label>
        Couche
        <select value={layer} onChange={(e) => setLayer(e.target.value as Layer)}>
          <option value="none">Aucune</option>
          <option value="status">Raccordement des bâtiments</option>
          <option value="traffic">Trafic</option>
          <option value="health">Couverture santé</option>
          <option value="education">Couverture éducation</option>
          <option value="safety">Couverture sécurité</option>
          <option value="pollution">Pollution</option>
        </select>
      </label>

      <h4>Routes</h4>
      <div className="build-grid">
        {ROAD_TYPES.map((r) => (
          <button
            key={r}
            className={tool.kind === 'road' && tool.road === r ? 'build active' : 'build'}
            onClick={() => setTool({ kind: 'road', road: r })}
          >
            <strong>{ROADS[r].label}</strong>
            <span className="small">{ROADS[r].costPerMeter} cr/m · cap. {fmtInt(ROADS[r].capacityTripsPerDay)} trajets/j</span>
          </button>
        ))}
      </div>
      <p className="small muted">
        Reliez vos routes à l'accès régional (flèche jaune, bord ouest) : un bâtiment ne fonctionne que s'il est desservi par une route raccordée.
      </p>

      {categories.map((cat) => (
        <div key={cat}>
          <h4>{CATEGORY_LABEL[cat]}</h4>
          <div className="build-grid">
            {BUILDING_TYPES.filter((t) => BUILDINGS[t].category === cat).map((t) => {
              const d = BUILDINGS[t];
              const active = tool.kind === 'building' && tool.building === t;
              return (
                <button
                  key={t}
                  title={d.description}
                  className={active ? 'build active' : 'build'}
                  disabled={city.treasury < d.cost}
                  onClick={() => setTool({ kind: 'building', building: t, rotation: tool.kind === 'building' ? tool.rotation : 0 })}
                >
                  <strong>{d.label}</strong>
                  <span className="small">{fmtMoney(d.cost)} · entretien {fmtInt(d.upkeepPerDay)}/j</span>
                  <span className="small muted">
                    {d.housing ? `${d.housing} logements` : `${d.jobs} emplois`}
                    {d.service ? ` · ${fmtInt(d.service.capacity)} hab. / ${d.service.radius} m` : ''}
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
          <h4>{BUILDINGS[sel.type].label} #{sel.id}</h4>
          <p className="small muted">{BUILDINGS[sel.type].description}</p>
          <Row label="État" value={STATUS_LABEL[layers?.buildingStatus[sel.id] ?? 'ok']} />
          {layers?.residentialCoverage[sel.id] && SERVICE_KINDS.map((k) => (
            <Row key={k} label={`Couverture ${SERVICE_LABEL[k].toLowerCase()}`} value={fmtPct(layers.residentialCoverage[sel.id]![k])} />
          ))}
          {layers?.pollution[sel.id] !== undefined && <Row label="Exposition à la pollution" value={fmtPct(layers.pollution[sel.id]!)} />}
          <button className="danger" onClick={() => void client.act({ t: 'command', cmd: { type: 'demolish', target: 'building', id: sel.id } })}>
            Démolir
          </button>
        </div>
      )}
    </div>
  );
}

export function EconomyPanel() {
  const city = useGame((s) => s.myCity)!;
  const s = city.stats;
  const [taxes, setTaxes] = useState(city.taxes);
  const [amount, setAmount] = useState(100_000);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setTaxes(city.taxes);
  }, [city.taxes]);

  const applyTaxes = async (e: FormEvent) => {
    e.preventDefault();
    await client.act({ t: 'command', cmd: { type: 'setTaxes', taxes } });
    dirty.current = false;
  };

  return (
    <div className="stack">
      <h4>Budget municipal (par jour de jeu)</h4>
      {s ? (
        <>
          <Row label="Impôt sur le revenu (résidentiel)" value={flow(s.budget.residentialTax, '+')} tone="pos" />
          <Row label="Impôt commercial" value={flow(s.budget.commercialTax, '+')} tone="pos" />
          <Row label="Impôt industriel" value={flow(s.budget.industrialTax, '+')} tone="pos" />
          <Row label="Entretien (bâtiments, routes, salaires publics)" value={flow(s.budget.upkeep, '−')} tone="neg" />
          <Row label="Importations d'électricité et d'eau" value={flow(s.budget.utilityImports, '−')} tone="neg" />
          <Row label="Intérêts de la dette" value={flow(s.budget.loanInterest, '−')} tone="neg" />
          <Row label="Solde" value={`${s.budget.net >= 0 ? '+' : '−'}${fmtInt(Math.abs(s.budget.net))}`} tone={s.budget.net >= 0 ? 'pos' : 'neg'} />
        </>
      ) : <p className="muted">En attente du premier tick…</p>}
      {city.treasury < 0 && (
        <p className="error-text small">Trésorerie négative : services publics à 60 % d'efficacité, construction impossible.</p>
      )}

      <h4>Fiscalité</h4>
      <form onSubmit={applyTaxes} className="stack">
        {(['residential', 'commercial', 'industrial'] as const).map((k) => (
          <label key={k}>
            {k === 'residential' ? 'Résidentiel (revenus)' : k === 'commercial' ? 'Commercial (bénéfices)' : 'Industriel (bénéfices)'} : {fmtPct(taxes[k])}
            <input
              type="range" min={0} max={MAX_TAX_RATE} step={0.01} value={taxes[k]}
              onChange={(e) => { dirty.current = true; setTaxes({ ...taxes, [k]: Number(e.target.value) }); }}
            />
          </label>
        ))}
        <button className="primary">Appliquer les taux</button>
        <p className="small muted">Au-delà de 8 % d'impôt résidentiel, l'attractivité baisse progressivement.</p>
      </form>

      <h4>Dette</h4>
      <Row label="Dette" value={fmtMoney(city.debt)} />
      <Row label="Plafond" value={fmtMoney(MAX_DEBT)} />
      <div className="row">
        <input type="number" min={1000} step={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <button onClick={() => void client.act({ t: 'command', cmd: { type: 'borrow', amount } })}>Emprunter</button>
        <button onClick={() => void client.act({ t: 'command', cmd: { type: 'repay', amount } })} disabled={city.debt <= 0}>Rembourser</button>
      </div>
      <p className="small muted">Taux d'intérêt : 6 % par année de jeu (360 jours).</p>

      {s && (
        <>
          <h4>Biens</h4>
          <Row label="Demande des habitants" value={`${fmtInt(s.goods.demand)} /j`} />
          <Row label="Ventes des commerces" value={`${fmtInt(s.goods.sold)} /j`} />
          <Row label="Production locale" value={`${fmtInt(s.goods.produced)} /j`} />
          <Row label="Importés" value={`${fmtInt(s.goods.imported)} /j`} />
          <Row label="Exportés" value={`${fmtInt(s.goods.exported)} /j`} />
        </>
      )}
    </div>
  );
}

export function PopulationPanel() {
  const city = useGame((s) => s.myCity)!;
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
      <h4>Emploi</h4>
      <Row label="Actifs" value={fmtInt(s.workforce)} />
      <Row label="Emplois" value={fmtInt(s.jobs)} />
      <Row label="Actifs occupés" value={fmtInt(s.employed)} />
      <Row label="Chômage" value={fmtPct(s.unemploymentRate, 1)} tone={s.unemploymentRate > 0.1 ? 'neg' : undefined} />
      <Row label="Postes pourvus" value={fmtPct(s.staffingRatio)} />
      <p className="small muted">
        Attractivité = 40 % emploi + 25 % services + 20 % fiscalité + 15 % fluidité du trafic − 30 % pollution.
        La population tend vers logements × (30 % + 70 % × attractivité).
      </p>
    </div>
  );
}

export function ServicesPanel({ layer, setLayer }: { layer: Layer; setLayer: (l: Layer) => void }) {
  const city = useGame((s) => s.myCity)!;
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
      <Row label="Inégalités entre quartiers (écart-type)" value={fmtPct(s.serviceInequality)} />
      <Row label="Exposition moyenne à la pollution" value={fmtPct(s.pollutionExposure)} />
      <h4>Réseaux</h4>
      <Row label="Électricité : demande" value={`${s.power.demandMW.toFixed(2)} MW`} />
      <Row label="Électricité : production locale" value={`${s.power.localMW.toFixed(2)} MW`} />
      <Row label="Électricité : importée" value={`${s.power.importedMW.toFixed(2)} MW`} />
      <Row label="Eau : demande" value={`${fmtInt(s.water.demandM3)} m³/j`} />
      <Row label="Eau : production locale" value={`${fmtInt(s.water.localM3)} m³/j`} />
      <Row label="Eau : importée" value={`${fmtInt(s.water.importedM3)} m³/j`} />
      <h4>Trafic</h4>
      <Row label="Déplacements" value={`${fmtInt(s.traffic.trips)} /j`} />
      <Row label="Fluidité" value={fmtPct(s.traffic.efficiency)} tone={s.traffic.efficiency < 0.9 ? 'neg' : undefined} />
      <Row label="Tronçons saturés" value={String(s.traffic.congestedSegments)} />
      <button className={layer === 'traffic' ? 'active' : ''} onClick={() => setLayer(layer === 'traffic' ? 'none' : 'traffic')}>Couche trafic</button>
    </div>
  );
}

export function LobbyPanel() {
  const lobby = useGame((s) => s.lobby)!;
  const summaries = useGame((s) => s.summaries);
  const chat = useGame((s) => s.chat);
  const player = useGame((s) => s.player);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [chat.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (await client.act({ t: 'chat', text })) setText('');
  };

  return (
    <div className="stack">
      <Row label="Code d'invitation" value={lobby.code} />
      <Row label="Type" value={lobby.isPublic ? 'Public' : 'Privé'} />
      <Row label="Joueurs max." value={String(lobby.maxPlayers)} />
      <h4>Villes dirigées</h4>
      <ul className="list">
        {summaries.map((c) => (
          <li key={c.cityId}>
            <span>
              <strong>{CITY_BY_ID.get(c.cityId)?.name}</strong>{' '}
              <span className="muted small">({COUNTRY_BY_ID.get(c.countryId)?.nameFr})</span>
            </span>
            <span className="small">{c.ownerName}{c.ownerId === player?.id ? ' (vous)' : ''} · ~{fmtInt(c.population)} hab.</span>
          </li>
        ))}
      </ul>
      <h4>Discussion</h4>
      <div className="chat">
        {chat.map((m) => (
          <div key={m.id} className="chat-msg">
            <span className="muted small">{new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
            <strong>{m.author}</strong> : {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message au salon" />
        <button disabled={!text.trim()}>Envoyer</button>
      </form>
      <p className="small muted">La diplomatie, les traités, le commerce entre joueurs et l'armée ne sont pas encore implémentés (voir la feuille de route).</p>
    </div>
  );
}
