// Économie lisible : le circuit des biens (usines → commerces → habitants) et les comptes des entreprises.
import { BUILDINGS, COMMERCE, ECONOMY, type Building } from '@cyc/shared';
import { activeCity, useGame } from '../../state.ts';
import { fmtInt } from '../format.ts';
import { ICON } from './city.tsx';

const cr = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} cr`;

/** Schéma du circuit des biens du jour, avec les prix unitaires de chaque étape. */
export function GoodsCircuit() {
  const city = useGame(activeCity)!;
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] ?? null : null));
  const g = city.stats!.goods;
  const links = layers?.supply ?? [];
  const avgDistance = links.length ? links.reduce((a, l) => a + l.distance * l.qty, 0) / Math.max(1, links.reduce((a, l) => a + l.qty, 0)) : 0;
  const localUnit = ECONOMY.localWholesalePrice + avgDistance * COMMERCE.deliveryCostPerMeter;
  // Droits de douane par bien importé (approximation : les droits sur contrats sont inclus).
  const tariffUnit = g.imported > 0 ? Math.min(g.tariffPaid / g.imported, g.importPrice) : 0;
  const importUnit = g.importPrice + COMMERCE.importHandling + tariffUnit;
  const localSupplied = g.localSupplied ?? 0;
  const unserved = g.unserved ?? 0;
  const factories = city.buildings.filter((b) => BUILDINGS[b.type].goodsProductionPerDay).length;
  const shops = city.buildings.filter((b) => BUILDINGS[b.type].goodsSalesCapacityPerDay).length;

  return (
    <div className="circuit">
      <h4>Circuit des biens (par jour)</h4>
      <div className="circuit-grid">
        <div className={`node ${factories ? '' : 'empty'}`}>
          <span className="node-icon">🏭</span>
          <strong>Usines ({factories})</strong>
          <span>{fmtInt(g.produced)} biens produits</span>
        </div>
        <div className="arrow" title="Livraisons par camion, les commerces les plus proches d'abord">
          <span>🚚 {fmtInt(localSupplied)}</span>
          <small>{localSupplied > 0 ? `≈ ${cr(localUnit)}/bien` : 'aucune livraison'}</small>
        </div>
        <div className={`node ${shops ? '' : 'empty'}`}>
          <span className="node-icon">🛍️</span>
          <strong>Commerces ({shops})</strong>
          <span>{fmtInt(g.sold)} vendus à {cr(ECONOMY.retailPrice)}</span>
        </div>
        <div className="arrow" title={`Chaque commerce vend aux habitants à moins de ${COMMERCE.catchmentRadius} m`}>
          <span>🛒 {fmtInt(g.sold)}</span>
          <small>rayon {COMMERCE.catchmentRadius} m</small>
        </div>
        <div className="node">
          <span className="node-icon">👥</span>
          <strong>Habitants</strong>
          <span>{fmtInt(g.demand)} demandés</span>
          {unserved > 0.5 && <span className="neg">{fmtInt(unserved)} sans commerce proche</span>}
        </div>
      </div>
      <div className="circuit-side">
        <div className={`side ${g.imported > 0.5 ? 'warn' : ''}`}>
          🌍 <strong>Importations</strong> : {fmtInt(g.imported)} biens à ≈ {cr(importUnit)}
          {g.imported > 0.5 && <small> — marge {cr(ECONOMY.retailPrice - importUnit)}/bien contre {cr(ECONOMY.retailPrice - localUnit)} avec une usine locale</small>}
        </div>
        <div className={`side ${g.exported > 0.5 ? 'info' : ''}`}>
          📤 <strong>Exportations</strong> : {fmtInt(g.exported)} biens à {cr(g.exportPrice)}
          {g.exported > 0.5 && <small> — vendus {cr(ECONOMY.localWholesalePrice - g.exportPrice)} moins cher qu'à vos commerces</small>}
        </div>
        {(g.contractIn > 0 || g.contractDelivered > 0) && (
          <div className="side">🤝 <strong>Contrats</strong> : {fmtInt(g.contractIn)} reçus · {fmtInt(g.contractDelivered)} livrés</div>
        )}
      </div>
    </div>
  );
}

/** Comptes des entreprises : bénéficiaires et déficitaires, cliquables pour ouvrir leur fiche. */
export function Businesses({ onSelect }: { onSelect?: (b: Building) => void }) {
  const city = useGame(activeCity)!;
  const layers = useGame((s) => (s.activeCityId ? s.layers[s.activeCityId] ?? null : null));
  const list = city.buildings
    .filter((b) => (BUILDINGS[b.type].category === 'commercial' || BUILDINGS[b.type].category === 'industrial') && layers?.economy?.[b.id])
    .map((b) => ({ b, e: layers!.economy![b.id]! }))
    .sort((x, y) => y.e.profit - x.e.profit);
  if (!list.length) return null;
  const winners = list.filter((x) => x.e.profit >= 0);
  const losers = list.filter((x) => x.e.profit < 0).reverse();
  const totalTax = list.reduce((a, x) => a + x.e.tax, 0);
  const row = ({ b, e }: (typeof list)[number]) => (
    <li key={b.id}>
      <button className="link" onClick={() => onSelect?.(b)}>{ICON[b.type]} {BUILDINGS[b.type].label} <span className="muted">#{b.id}</span></button>
      <span className={e.profit >= 0 ? 'pos' : 'neg'}>{e.profit >= 0 ? '+' : '−'}{fmtInt(Math.abs(e.profit))} cr/j</span>
    </li>
  );
  return (
    <div className="stack">
      <h4>Entreprises</h4>
      <p className="small muted">
        {winners.length} bénéficiaire{winners.length > 1 ? 's' : ''}, {losers.length} déficitaire{losers.length > 1 ? 's' : ''} ·
        {' '}{fmtInt(totalTax)} cr/j d'impôts versés à la ville. Seuls les bénéfices sont imposés : une entreprise en perte ne rapporte rien.
        Couche « Économie » pour les voir sur la carte.
      </p>
      {winners.length > 0 && <ul className="list building-list">{winners.slice(0, 5).map(row)}</ul>}
      {losers.length > 0 && (
        <>
          <p className="small neg">Les plus déficitaires</p>
          <ul className="list building-list">{losers.slice(0, 5).map(row)}</ul>
        </>
      )}
    </div>
  );
}
