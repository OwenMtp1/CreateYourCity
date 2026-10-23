// Fiches détaillées des bâtiments : inspecteur flottant (clic sur un bâtiment) et répertoire de la ville.
import { useMemo, useState } from 'react';
import {
  BUILDINGS, COMMERCE, ECONOMY, FACTORY_STOCK_DAYS, formatGameTime, sectorOf, SERVICE_KINDS, TRANSIT, type Building, type BuildingCategory, type BuildingEconomy, type CityLayers, type CityState, type Sector,
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
  const status = layers?.buildingStatus[b.id] ?? 'ok';
  const working = status === 'ok';
  // Chiffres propres à ce bâtiment (calculés par la simulation), et non moyennes de la ville.
  const d = layers?.details?.[b.id] ?? {};
  const staffing = working ? d.staffing ?? 0 : 0;
  const rows: { label: string; value: string; tone?: 'pos' | 'neg' }[] = [];
  const add = (label: string, value: string, tone?: 'pos' | 'neg') => rows.push({ label, value, tone });

  add('État', STATUS_LABEL[status], working ? 'pos' : 'neg');
  if (def.housing) {
    const residents = working ? d.residents ?? 0 : 0;
    add('Logements', fmtInt(def.housing));
    add('Habitants dans ce logement', fmtInt(residents));
    add('Actifs issus de ce logement', fmtInt(residents * ECONOMY.workforceShare));
    const cov = layers?.residentialCoverage[b.id];
    if (cov) for (const k of SERVICE_KINDS) add(`Couverture ${SERVICE_LABEL[k].toLowerCase()}`, fmtPct(cov[k] ?? 0), (cov[k] ?? 0) < 0.5 ? 'neg' : undefined);
    if (layers?.pollution[b.id] !== undefined) add('Exposition à la pollution', fmtPct(layers.pollution[b.id]!), layers.pollution[b.id]! > 0.3 ? 'neg' : undefined);
  }
  if (def.jobs) {
    const workers = working ? d.workers ?? 0 : 0;
    add('Emplois', fmtInt(def.jobs));
    add('Actifs sur ce site', fmtInt(workers));
    add('Postes pourvus', `${fmtInt(workers)} / ${fmtInt(def.jobs)} (${fmtPct(staffing)})`, staffing < 0.6 ? 'neg' : undefined);
    add('Salaires versés', `${fmtInt(def.jobs * staffing * ECONOMY.wagePerWorker)} cr/j`);
  }
  if (def.goodsSalesCapacityPerDay) add('Capacité de vente', `${fmtInt(d.capacity ?? 0)} biens/j`);
  if (def.goodsProductionPerDay) add('Production', `${fmtInt(d.capacity ?? 0)} biens/j`);
  if (def.pollution) add('Pollution émise', `rayon ${def.pollution.radius} m · intensité ${fmtPct(def.pollution.intensity)}`, 'neg');
  if (def.service) {
    add('Service', `${SERVICE_LABEL[def.service.kind]} · rayon ${def.service.radius} m`);
    add('Capacité effective', `${fmtInt(d.capacity ?? 0)} habitants`);
    add('Habitants servis', `${fmtInt(d.served ?? 0)}`);
    if (layers?.serviceLoad[b.id] !== undefined) add('Utilisation', fmtPct(layers.serviceLoad[b.id]!), layers.serviceLoad[b.id]! > 0.95 ? 'neg' : undefined);
  }
  if (def.powerOutputMW) add('Production électrique', `${fmtInt(d.capacity ?? 0)} MW`);
  if (def.waterOutputM3PerDay) add("Production d'eau", `${fmtInt(d.capacity ?? 0)} m³/j`);
  if (def.transit) {
    const same = city.buildings.filter((x) => BUILDINGS[x.type].transit?.mode === def.transit!.mode && layers?.buildingStatus[x.id] === 'ok').length;
    add('Ligne', `${MODE_LABEL[def.transit.mode]} · rayon ${def.transit.radius} m`);
    add('Capacité effective', `${fmtInt(d.capacity ?? 0)} voyages/j`);
    add('Réseau', same >= TRANSIT.minStationsPerMode ? `${same} stations : en service` : `${same} station : il en faut ${TRANSIT.minStationsPerMode}`, same >= TRANSIT.minStationsPerMode ? 'pos' : 'neg');
  }
  if (def.powerMW) add('Consommation électrique', `${def.powerMW.toLocaleString('fr-FR')} MW`);
  if (def.waterM3PerDay) add("Consommation d'eau", `${fmtInt(def.waterM3PerDay)} m³/j`);
  const publicCost = layers?.economy?.[b.id]?.publicCost;
  if (def.service && publicCost !== undefined) {
    add('Entretien (selon utilisation)', `${fmtInt(publicCost)} cr/j sur ${fmtInt(def.upkeepPerDay)} au maximum`);
  } else add('Entretien', `${fmtInt(def.upkeepPerDay)} cr/j`);
  add('Coût de construction', fmtMoney(def.cost));
  add('Emprise', `${b.rotation === 90 ? def.h : def.w} × ${b.rotation === 90 ? def.w : def.h} m`);
  add('Construit', formatGameTime(b.builtAtTick));
  return rows;
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtInt(Math.abs(v))} cr/j`;

/** Comptes du jour d'une entreprise ou d'un logement, avec ses fournisseurs et clients (cliquables). */
function Accounts({ city, layers, b, onSelect }: { city: CityState; layers: CityLayers | null; b: Building; onSelect: (b: Building) => void }) {
  const e = layers?.economy?.[b.id];
  const def = BUILDINGS[b.type];
  if (!e) return null;
  const byId = new Map(city.buildings.map((x) => [x.id, x]));
  const link = (id: number) => {
    const x = byId.get(id);
    return x ? <button className="link" onClick={() => onSelect(x)}>{ICON[x.type]} {BUILDINGS[x.type].label} #{x.id}</button> : `#${id}`;
  };
  if (e.publicCost !== undefined) {
    return (
      <div className="accounts">
        <h4>Coût pour la ville</h4>
        <div className="profit neg">{signed(-e.publicCost)}<small>entretien du jour</small></div>
        <Row label="Capacité utilisée" value={fmtPct(e.use ?? 0)} />
        <p className="small muted">
          {Math.round(COMMERCE.serviceFixedUpkeepShare * 100)} % de l'entretien est fixe, le reste suit l'utilisation : un équipement peu utilisé coûte moins cher.
        </p>
      </div>
    );
  }
  if (def.housing) {
    return (
      <div className="accounts">
        <h4>Recettes pour la ville</h4>
        <Row label="Impôt sur le revenu des habitants" value={`${fmtInt(e.tax)} cr/j`} tone="pos" />
        <Row label="Valeur foncière (loisirs à proximité)" value={e.landValue ? `+${fmtPct(e.landValue)} d'impôt` : 'aucun parc à portée'} tone={e.landValue ? 'pos' : undefined} />
      </div>
    );
  }
  const suppliers = (layers?.supply ?? []).filter((l) => l.to === b.id);
  const customers = (layers?.supply ?? []).filter((l) => l.from === b.id);
  return (
    <div className="accounts">
      <h4>Comptes du jour</h4>
      <div className={`profit ${e.profit >= 0 ? 'pos' : 'neg'}`}>{signed(e.profit)}<small>bénéfice</small></div>
      <Row label="Recettes" value={`${fmtInt(e.revenue)} cr/j`} tone="pos" />
      <Row label="Dépenses (achats + salaires)" value={`${fmtInt(e.costs)} cr/j`} tone="neg" />
      <Row label="Impôt versé à la ville" value={e.tax > 0 ? `${fmtInt(e.tax)} cr/j` : 'aucun (pas de bénéfice)'} />
      {e.sold !== undefined && (
        <>
          <Row label="Habitants dans la zone (450 m)" value={fmtInt(e.catchment ?? 0)} tone={(e.catchment ?? 0) < 1 ? 'neg' : undefined} />
          <Row label="Clients" value={fmtInt(e.customers ?? 0)} tone={(e.customers ?? 0) < 1 ? 'neg' : undefined} />
          <Row label="Biens vendus" value={`${fmtInt(e.sold)} /j à ${ECONOMY.retailPrice} cr`} />
          <Row label="Prix d'achat moyen" value={e.sold > 0 ? `${(e.unitCost ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} cr/bien` : '—'} />
          <p className="small muted">Approvisionnement</p>
          <ul className="list supply-list">
            {suppliers.map((l) => (
              <li key={l.from}>{link(l.from)}<span className="small">{fmtInt(l.qty)} biens · {fmtInt(l.distance)} m</span></li>
            ))}
            {(e.contract ?? 0) > 0.5 && <li><span>🤝 Contrats</span><span className="small">{fmtInt(e.contract ?? 0)} biens</span></li>}
            {(e.imported ?? 0) > 0.5 && <li className="neg"><span>🌍 Importations (plus chères)</span><span className="small">{fmtInt(e.imported ?? 0)} biens</span></li>}
            {e.sold < 0.5 && <li className="muted">{saleBlocker(e)}</li>}
          </ul>
        </>
      )}
      {e.produced !== undefined && (
        <>
          <Row label="Production" value={`${fmtInt(e.produced)} biens/j`} />
          <p className="small muted">Livraisons</p>
          <ul className="list supply-list">
            {customers.map((l) => (
              <li key={l.to}>{link(l.to)}<span className="small">{fmtInt(l.qty)} biens à {ECONOMY.localWholesalePrice} cr</span></li>
            ))}
            {(e.exported ?? 0) > 0.5 && <li className="muted"><span>📤 Exportations (moins chères)</span><span className="small">{fmtInt(e.exported ?? 0)} biens</span></li>}
          </ul>
        </>
      )}
      {e.educated !== undefined && (
        <Row label="Main-d'œuvre qualifiée (école à portée)" value={e.educated ? `oui : +${Math.round(COMMERCE.educatedOfficeBonus * 100)} % de chiffre d'affaires` : 'non : construisez une école à proximité'} tone={e.educated ? 'pos' : 'neg'} />
      )}
    </div>
  );
}

/** Fiche flottante du bâtiment sélectionné. */
export function BuildingInspector({ id, onClose, onFocus, onSelect }: { id: number; onClose: () => void; onFocus: (b: Building) => void; onSelect: (b: Building) => void }) {
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
        {def.jobs > 0 && <Workers city={city} b={b} />}
        {def.goodsProductionPerDay && <FactorySupply city={city} b={b} layers={layers} />}
        <Accounts city={city} layers={layers} b={b} onSelect={onSelect} />
        {buildingDetails(city, layers, b).map((r) => <Row key={r.label} label={r.label} value={r.value} tone={r.tone} />)}
        {def.parking && <ParkingSettings key={b.id} id={b.id} spaces={def.parking.spaces} fee={b.fee ?? 0} use={layers?.parkingUse?.[b.id]} revenue={layers?.details?.[b.id]?.revenue} />}
        {def.transit && <TransitSettings key={def.transit.mode} mode={def.transit.mode} fare={city.transitFares?.[def.transit.mode] ?? TRANSIT.farePerRide} riders={layers?.details?.[b.id]?.riders} revenue={layers?.details?.[b.id]?.revenue} />}
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

/**
 * Actifs d'un site d'emploi : répartition automatique, et déplacement manuel vers un autre site du même secteur.
 */
function Workers({ city, b }: { city: CityState; b: Building }) {
  const here = city.stats?.siteWorkers?.[b.id] ?? 0;
  const jobs = BUILDINGS[b.type].jobs;
  const sector = sectorOf(b.type);
  const others = city.buildings.filter((x) => x.id !== b.id && BUILDINGS[x.type].jobs > 0 && sectorOf(x.type) === sector);
  const [target, setTarget] = useState<number | null>(null);
  const [count, setCount] = useState(5);
  const manual = city.assignments?.[b.id] !== undefined;
  const to = target ?? others[0]?.id ?? null;
  const free = to === null ? 0 : BUILDINGS[city.buildings.find((x) => x.id === to)!.type].jobs - (city.stats?.siteWorkers?.[to] ?? 0);
  const max = Math.min(Math.floor(here), Math.floor(free));
  return (
    <div className="workers">
      <h4>Actifs</h4>
      <Row label={`Postes pourvus (secteur ${SECTOR_LABEL[sector]})`} value={`${fmtInt(here)} / ${fmtInt(jobs)}`} tone={here < jobs * 0.5 ? 'neg' : undefined} />
      {manual && <p className="small muted">Répartition modifiée à la main pour ce site.</p>}
      {others.length === 0 ? (
        <p className="small muted">Aucun autre site de ce secteur : construisez-en un pour pouvoir y déplacer des actifs.</p>
      ) : (
        <div className="stack">
          <label className="small">Déplacer vers
            <select value={to ?? ''} onChange={(e) => setTarget(Number(e.target.value))}>
              {others.map((x) => {
                const free2 = BUILDINGS[x.type].jobs - (city.stats?.siteWorkers?.[x.id] ?? 0);
                return <option key={x.id} value={x.id}>#{x.id} {BUILDINGS[x.type].label} ({fmtInt(free2)} poste(s) libre(s))</option>;
              })}
            </select>
          </label>
          <label className="small">Nombre d'actifs
            <input type="number" min={1} max={max} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          <button disabled={to === null || count < 1 || count > max}
            onClick={() => to !== null && void client.cityCommand({ type: 'moveWorkers', fromId: b.id, toId: to, count })}>
            Déplacer {fmtInt(count)} actif(s)
          </button>
        </div>
      )}
      {manual && <button className="link" onClick={() => void client.cityCommand({ type: 'resetAssignments' })}>Remettre la répartition automatique</button>}
    </div>
  );
}

const SECTOR_LABEL: Record<Sector, string> = { commerce: 'commerce', bureaux: 'bureaux', industrie: 'industrie', services: 'services' };

/**
 * Approvisionnement d'une usine. Chaque commerce affiche sa demande. On envoie la capacité de l'usine à un
 * commerce ; un commerce couvert par d'autres usines est grisé pour celle-ci. Sans choix, la répartition est
 * automatique (commerces les plus proches d'abord).
 */
function FactorySupply({ city, b, layers }: { city: CityState; b: Building; layers: CityLayers | null }) {
  const capacity = BUILDINGS[b.type].goodsProductionPerDay ?? 0;
  const shops = city.buildings.filter((x) => BUILDINGS[x.type].goodsSalesCapacityPerDay);
  const plan = b.supplyPlan;
  const planned = (shopId: number) => plan?.[shopId] ?? 0;
  const used = Object.values(plan ?? {}).reduce((sum, q) => sum + q, 0);
  const free = Math.max(0, capacity - used);
  const exportSurplus = b.exportSurplus !== false;
  const demandOf = (x: Building) => layers?.economy?.[x.id]?.demand ?? x.demand ?? 0;
  // Biens déjà envoyés à un commerce par les autres usines de la ville.
  const fromOthers = (shopId: number) => city.buildings
    .filter((x) => x.id !== b.id && BUILDINGS[x.type].goodsProductionPerDay)
    .reduce((sum, x) => sum + (x.supplyPlan?.[shopId] ?? 0), 0);
  const send = (shopId: number, qty: number) => void client.cityCommand({ type: 'assignSupply', factoryId: b.id, shopId, qty });
  return (
    <div className="stack supply">
      <h4>Approvisionnement</h4>
      {!plan && <p className="small muted">Répartition automatique : les commerces les plus proches d'abord. Envoyez la capacité de l'usine à un commerce pour la piloter.</p>}
      <p className="small muted">Capacité : {fmtInt(free)} / {fmtInt(capacity)} biens/j libres</p>
      {shops.length === 0 && <p className="small muted">Aucun commerce dans la ville pour l'instant.</p>}
      {shops.map((x) => {
        const demand = demandOf(x);
        const others = fromOthers(x.id);
        const mine = planned(x.id);
        const covered = mine === 0 && demand > 0 && others >= demand - 1e-6;
        const remaining = Math.max(0, demand - others);
        return (
          <div key={x.id} className="row supply-row">
            <span>Commerce #{x.id}</span>
            <span className="small">Demande {fmtInt(demand)} biens/j</span>
            <span className="small muted">
              {mine > 0 ? `${fmtInt(mine)} biens/j de cette usine` : others > 0 ? `${fmtInt(others)} biens/j d'autres usines` : 'non approvisionné'}
            </span>
            {mine > 0 ? (
              <button className="active small-btn" onClick={() => send(x.id, 0)}>✓ Retirer</button>
            ) : covered ? (
              <button className="small-btn" disabled>Couvert par une autre usine</button>
            ) : free <= 0 ? (
              <button className="small-btn" disabled>Capacité utilisée</button>
            ) : (
              <button className="primary small-btn" onClick={() => send(x.id, Math.min(free, remaining || free))}>
                Envoyer {fmtInt(Math.min(free, remaining || free))}/j
              </button>
            )}
          </div>
        );
      })}
      <label className="check">
        <input type="checkbox" checked={exportSurplus} onChange={(e) => void client.cityCommand({ type: 'setFactoryExport', id: b.id, exportSurplus: e.target.checked })} /> Exporter le surplus
      </label>
      {!exportSurplus && <p className="small muted">Stock conservé : {fmtInt(layers?.economy?.[b.id]?.stock ?? b.stock ?? 0)} biens (jusqu'à {FACTORY_STOCK_DAYS} jours de production).</p>}
      {plan && <button className="link small-btn" onClick={() => void client.cityCommand({ type: 'resetSupply', factoryId: b.id })}>Rétablir la répartition automatique</button>}
    </div>
  );
}

/** Tarif d'une ligne de transport : gratuite, tarif de base, ou plus cher (moins de voyageurs). */
function TransitSettings({ mode, fare, riders, revenue }: { mode: 'bus' | 'tram' | 'metro'; fare: number; riders: number | undefined; revenue: number | undefined }) {
  const [price, setPrice] = useState(fare);
  const dirty = price !== fare;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void client.cityCommand({ type: 'setTransitFare', mode, fee: price }); }}>
      <Row label={`Tarif de la ligne ${MODE_LABEL[mode].toLowerCase()}`} value={fare === 0 ? 'Gratuit' : `${fare.toLocaleString('fr-FR')} cr / voyage`} />
      <Row label="Voyageurs de cette station (estimation)" value={riders === undefined ? '—' : `${fmtInt(riders)} /j`} />
      <Row label="Recettes de cette station" value={revenue === undefined ? '—' : `${fmtInt(revenue)} cr/j`} />
      <label>
        Nouveau tarif : {price === 0 ? 'gratuit' : `${price.toLocaleString('fr-FR')} cr`}
        <input type="range" min={0} max={TRANSIT.maxFare} step={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
      </label>
      <p className="small muted">
        Plus cher, la ligne perd des voyageurs au profit de la voiture ; gratuite, elle en attire davantage mais ne rapporte rien.
      </p>
      <button type="submit" disabled={!dirty}>Appliquer le tarif</button>
    </form>
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

/** Cause la plus probable d'un commerce sans vente, dans l'ordre où le joueur peut la corriger. */
function saleBlocker(e: BuildingEconomy): string {
  if ((e.catchment ?? 0) < 1) return "Aucune vente : aucun habitant ne vit dans les logements à moins de 450 m. Un immeuble voisin vide ne compte pas tant qu'il n'a pas d'habitants.";
  if (e.staffed === false) return "Aucune vente : personne ne travaille dans la ville. Créez des emplois.";
  if (e.powered === false) return "Aucune vente : pas d'électricité ni d'eau pour le commerce.";
  return "Aucune vente : la ville n'a pas assez de biens à vendre (approvisionnement).";
}
