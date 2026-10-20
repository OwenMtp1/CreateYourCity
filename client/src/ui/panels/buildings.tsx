// Fiches détaillées des bâtiments : inspecteur flottant (clic sur un bâtiment) et répertoire de la ville.
import { useMemo, useState } from 'react';
import {
  BUILDINGS, ECONOMY, formatGameTime, SERVICE_KINDS, TRANSIT, type Building, type BuildingCategory, type CityLayers, type CityState,
} from '@cyc/shared';
import { client } from '../../net/client.ts';
import { activeCity, useGame } from '../../state.ts';
import { Row } from '../common.tsx';
import { fmtInt, fmtMoney, fmtPct } from '../format.ts';
import { ICON, ParkingSettings, SERVICE_LABEL, STATUS_LABEL } from './city.tsx';

const CATEGORY: Record<BuildingCategory, string> = {
  residential: 'Logement', commercial: 'Commerce et entreprises', industrial: 'Industrie', service: 'Services publics',
  utility: 'Réseaux', transport: 'Transports', military: 'Défense',
};
const MODE_LABEL = { bus: 'Bus', tram: 'Tramway', metro: 'Métro' } as const;

/** Lignes de détail d'un bâtiment, calculées à partir des règles partagées et du dernier tick. */
export function buildingDetails(city: CityState, layers: CityLayers | null, b: Building): { label: string; value: string; tone?: 'pos' | 'neg' }[] {
  const def = BUILDINGS[b.type];
  const s = city.stats;
  const status = layers?.buildingStatus[b.id] ?? 'ok';
  const working = status === 'ok';
  const staffing = working ? s?.staffingRatio ?? 0 : 0;
  const rows: { label: string; value: string; tone?: 'pos' | 'neg' }[] = [];
  const add = (label: string, value: string, tone?: 'pos' | 'neg') => rows.push({ label, value, tone });

  add('État', STATUS_LABEL[status], working ? 'pos' : 'neg');
  if (def.housing) {
    const residents = working && s && s.housingCapacity > 0 ? (city.population * def.housing) / s.housingCapacity : 0;
    add('Logements', fmtInt(def.housing));
    add('Habitants (estimation)', fmtInt(residents));
    add('Actifs (estimation)', fmtInt(residents * ECONOMY.workforceShare));
    const cov = layers?.residentialCoverage[b.id];
    if (cov) for (const k of SERVICE_KINDS) add(`Couverture ${SERVICE_LABEL[k].toLowerCase()}`, fmtPct(cov[k] ?? 0), (cov[k] ?? 0) < 0.5 ? 'neg' : undefined);
    if (layers?.pollution[b.id] !== undefined) add('Exposition à la pollution', fmtPct(layers.pollution[b.id]!), layers.pollution[b.id]! > 0.3 ? 'neg' : undefined);
  }
  if (def.jobs) {
    add('Emplois', fmtInt(def.jobs));
    add('Postes pourvus', `${fmtInt(def.jobs * staffing)} (${fmtPct(staffing)})`, staffing < 0.6 ? 'neg' : undefined);
    add('Salaires versés', `${fmtInt(def.jobs * staffing * ECONOMY.wagePerWorker)} cr/j`);
  }
  if (def.goodsSalesCapacityPerDay) add('Capacité de vente', `${fmtInt(def.goodsSalesCapacityPerDay * staffing)} biens/j`);
  if (def.officeRevenue) add("Chiffre d'affaires (estimation)", `${fmtInt(def.jobs * staffing * ECONOMY.officeRevenuePerWorker)} cr/j`);
  if (def.goodsProductionPerDay) add('Production', `${fmtInt(def.goodsProductionPerDay * staffing)} biens/j`);
  if (def.pollution) add('Pollution émise', `rayon ${def.pollution.radius} m · intensité ${fmtPct(def.pollution.intensity)}`, 'neg');
  if (def.service) {
    add('Service', `${SERVICE_LABEL[def.service.kind]} · rayon ${def.service.radius} m`);
    add('Capacité', `${fmtInt(def.service.capacity * staffing)} habitants`);
    if (layers?.serviceLoad[b.id] !== undefined) add('Utilisation', fmtPct(layers.serviceLoad[b.id]!), layers.serviceLoad[b.id]! > 0.95 ? 'neg' : undefined);
  }
  if (def.powerOutputMW) add('Production électrique', `${fmtInt(def.powerOutputMW * staffing)} MW`);
  if (def.waterOutputM3PerDay) add("Production d'eau", `${fmtInt(def.waterOutputM3PerDay * staffing)} m³/j`);
  if (def.transit) {
    const same = city.buildings.filter((x) => BUILDINGS[x.type].transit?.mode === def.transit!.mode && layers?.buildingStatus[x.id] === 'ok').length;
    add('Ligne', `${MODE_LABEL[def.transit.mode]} · rayon ${def.transit.radius} m`);
    add('Capacité', `${fmtInt(def.transit.capacity * staffing)} voyages/j`);
    add('Réseau', same >= TRANSIT.minStationsPerMode ? `${same} stations : en service` : `${same} station : il en faut ${TRANSIT.minStationsPerMode}`, same >= TRANSIT.minStationsPerMode ? 'pos' : 'neg');
  }
  if (def.powerMW) add('Consommation électrique', `${def.powerMW.toLocaleString('fr-FR')} MW`);
  if (def.waterM3PerDay) add("Consommation d'eau", `${fmtInt(def.waterM3PerDay)} m³/j`);
  add('Entretien', `${fmtInt(def.upkeepPerDay)} cr/j`);
  add('Coût de construction', fmtMoney(def.cost));
  add('Emprise', `${b.rotation === 90 ? def.h : def.w} × ${b.rotation === 90 ? def.w : def.h} m`);
  add('Construit', formatGameTime(b.builtAtTick));
  return rows;
}

/** Fiche flottante du bâtiment sélectionné. */
export function BuildingInspector({ id, onClose, onFocus }: { id: number; onClose: () => void; onFocus: (b: Building) => void }) {
  const city = useGame(activeCity);
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] ?? null : null));
  const b = city?.buildings.find((x) => x.id === id);
  if (!city || !b) return null;
  const def = BUILDINGS[b.type];
  return (
    <aside className="inspector glass" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <h3>{ICON[b.type]} {def.label} <span className="muted small">#{b.id}</span></h3>
        <button className="close" onClick={onClose} aria-label="Fermer">×</button>
      </header>
      <p className="small muted">{def.description}</p>
      <div className="inspector-body">
        {buildingDetails(city, layers, b).map((r) => <Row key={r.label} label={r.label} value={r.value} tone={r.tone} />)}
        {def.parking && <ParkingSettings key={b.id} id={b.id} spaces={def.parking.spaces} fee={b.fee ?? 0} use={layers?.parkingUse?.[b.id]} />}
      </div>
      <div className="row">
        <button onClick={() => onFocus(b)}>🎯 Centrer la vue</button>
        <button className="danger" onClick={() => { if (confirm(`Démolir ${def.label} #${b.id} ? (aucun remboursement)`)) void client.cityCommand({ type: 'demolish', target: 'building', id: b.id }).then(onClose); }}>
          Démolir
        </button>
      </div>
    </aside>
  );
}

/** Répertoire de tous les bâtiments de la ville, par catégorie, avec recherche. */
export function BuildingsPanel({ selected, onSelect }: { selected: number | null; onSelect: (b: Building) => void }) {
  const city = useGame(activeCity)!;
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] ?? null : null));
  const [query, setQuery] = useState('');
  const [onlyBroken, setOnlyBroken] = useState(false);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = city.buildings.filter((b) => {
      if (onlyBroken && (layers?.buildingStatus[b.id] ?? 'ok') === 'ok') return false;
      return !q || BUILDINGS[b.type].label.toLowerCase().includes(q) || String(b.id) === q;
    });
    const byCat = new Map<BuildingCategory, Building[]>();
    for (const b of list) {
      const cat = BUILDINGS[b.type].category;
      byCat.set(cat, [...(byCat.get(cat) ?? []), b]);
    }
    for (const arr of byCat.values()) arr.sort((a, z) => a.type.localeCompare(z.type) || a.id - z.id);
    return [...byCat.entries()];
  }, [city.buildings, layers, query, onlyBroken]);
  const broken = city.buildings.filter((b) => (layers?.buildingStatus[b.id] ?? 'ok') !== 'ok').length;

  return (
    <div className="stack">
      <p className="small muted">
        {fmtInt(city.buildings.length)} bâtiments, {fmtInt(city.roads.length)} tronçons de route. Cliquez sur une ligne (ou sur un
        bâtiment dans la vue 3D) pour ouvrir sa fiche.
      </p>
      <input placeholder="Rechercher (type ou n°)…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="check"><input type="checkbox" checked={onlyBroken} onChange={(e) => setOnlyBroken(e.target.checked)} /> Hors service uniquement ({broken})</label>
      {groups.length === 0 && <p className="small muted">Aucun bâtiment.</p>}
      {groups.map(([cat, list]) => (
        <div key={cat}>
          <h4>{CATEGORY[cat]} ({list.length})</h4>
          <ul className="list building-list">
            {list.map((b) => {
              const st = layers?.buildingStatus[b.id] ?? 'ok';
              return (
                <li key={b.id} className={selected === b.id ? 'active' : ''}>
                  <button className="link" onClick={() => onSelect(b)}>
                    <span className={`dot ${st === 'ok' ? 'ok' : 'bad'}`} /> {ICON[b.type]} {BUILDINGS[b.type].label} <span className="muted">#{b.id}</span>
                  </button>
                  <span className="small muted">{summary(b)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function summary(b: Building): string {
  const d = BUILDINGS[b.type];
  if (d.housing) return `${fmtInt(d.housing)} logements`;
  if (d.parking) return b.fee ? `${d.parking.spaces} pl. · ${b.fee.toLocaleString('fr-FR')} cr` : `${d.parking.spaces} pl. · gratuit`;
  if (d.service) return `${SERVICE_LABEL[d.service.kind]} · ${fmtInt(d.service.capacity)}`;
  if (d.jobs) return `${fmtInt(d.jobs)} emplois`;
  return '';
}
