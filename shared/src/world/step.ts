// Un tick du monde : villes (avec marché, contrats et politique nationale), budgets nationaux,
// contrats, marché commun, armées, traités et nations. Ordre fixe, itérations triées : déterministe.
import { DT_DAYS } from '../constants.ts';
import { DEFAULT_MODIFIERS, type CityModifiers } from '../sim/modifiers.ts';
import { simulateTick } from '../sim/tick.ts';
import type { CityLayers } from '../types.ts';
import { stepMilitary } from './military.ts';
import { evaluateNation } from './nations.ts';
import { cityName, distanceKm, freeTrade, fundedMeasures, hasBuilding, LOGISTICS, MARKET, marketPrices, measuresUpkeep, playerName, pushEvent, TRANSPORT, TREATY_LABEL } from './rules.ts';
import type { World } from './types.ts';


/** Facteurs de prix liés à la meilleure infrastructure logistique de la ville. */
function logistics(city: { buildings: { type: string }[] }) {
  if (hasBuilding(city, 'port')) return LOGISTICS.port;
  if (hasBuilding(city, 'train_station')) return LOGISTICS.train_station;
  return { sell: 1, buy: 1 };
}

const hasLogistics = (city: { buildings: { type: string }[] } | undefined) => hasBuilding(city, 'port') || hasBuilding(city, 'train_station');

/** Paramètres externes d'une ville à ce tick. */
export function cityModifiers(world: World, cityId: string): CityModifiers {
  const city = world.cities.get(cityId);
  if (!city) return DEFAULT_MODIFIERS;
  const meta = world.meta;
  const prices = marketPrices(meta.market.price);
  const log = logistics(city);
  // Dictature indépendante : hors du pays (ni impôt, ni lois, ni projets) et coupée de l'extérieur.
  if (city.independentSince !== undefined) {
    return { ...DEFAULT_MODIFIERS, goodsImportPrice: prices.buy, goodsExportPrice: prices.sell, isolated: true };
  }
  const nation = meta.nations[city.countryId];
  const tariffRate = nation?.tariff ?? 0;
  const contractIn = { qty: 0, cost: 0, tariff: 0 };
  const contractOut = { qty: 0, revenue: 0 };
  for (const c of meta.contracts) {
    if (c.status !== 'active') continue;
    if (c.buyerCityId === cityId) {
      // Livraisons du tick précédent (le vendeur peut ne pas tout produire).
      const q = c.qtyPerDay * c.deliveredRatio;
      const seller = world.cities.get(c.sellerCityId);
      const discount = hasLogistics(city) && hasLogistics(seller) ? TRANSPORT.logisticsDiscount : 1;
      const transport = (distanceKm(c.sellerCityId, cityId) / 1000) * TRANSPORT.costPer1000Km * discount;
      contractIn.qty += q;
      contractIn.cost += q * (c.pricePerUnit + transport);
      const foreign = seller ? seller.countryId !== city.countryId : true;
      if (foreign && !freeTrade(meta, c.buyerId, c.sellerId)) contractIn.tariff += q * c.pricePerUnit * tariffRate;
    }
    if (c.sellerCityId === cityId) {
      contractOut.qty += c.qtyPerDay;
      contractOut.revenue += c.qtyPerDay * c.pricePerUnit;
    }
  }
  return {
    goodsImportPrice: prices.buy * log.buy,
    goodsExportPrice: prices.sell * log.sell,
    contractIn,
    contractOut,
    tariffRate,
    nationalTaxRate: nation?.taxRate ?? 0,
    laws: fundedMeasures(nation).laws,
    projects: fundedMeasures(nation).projects,
  };
}

export function stepWorld(world: World): Map<string, CityLayers> {
  const meta = world.meta;
  const layers = new Map<string, CityLayers>();
  const ids = [...world.cities.keys()].sort();

  // 1. Villes.
  for (const id of ids) layers.set(id, simulateTick(world.cities.get(id)!, cityModifiers(world, id)));

  // 2. Impôt national.
  for (const id of ids) {
    const city = world.cities.get(id)!;
    const nation = meta.nations[city.countryId];
    if (nation && city.stats) nation.treasury += (city.stats.budget.nationalTax + city.stats.goods.tariffPaid) * DT_DAYS;
  }
  // Entretien des lois et grands projets : pris en charge par le budget national, pas par les villes.
  for (const nation of Object.values(meta.nations)) nation.treasury -= measuresUpkeep(nation) * DT_DAYS;

  // 3. Contrats : taux de livraison et échéances.
  for (const c of meta.contracts) {
    if (c.status !== 'active') continue;
    c.deliveredRatio = world.cities.get(c.sellerCityId)?.stats?.goods.contractDeliveredRatio ?? 0;
  }
  const ended = meta.contracts.filter((c) => c.status === 'active' && c.endTick !== null && world.tick + 1 >= c.endTick);
  for (const c of ended) {
    pushEvent(world, 'contract', `Contrat ${cityName(c.sellerCityId)} → ${cityName(c.buyerCityId)} arrivé à échéance.`, [c.sellerId, c.buyerId], true);
  }
  meta.contracts = meta.contracts.filter((c) => !ended.includes(c));

  // 4. Marché commun : le prix monte si la demande d'importation dépasse l'offre exportée.
  let supply = 0, demand = 0;
  for (const id of ids) {
    const g = world.cities.get(id)!.stats?.goods;
    if (!g) continue;
    supply += g.exported;
    demand += g.imported;
  }
  const m = meta.market;
  m.supply = supply;
  m.demand = demand;
  if (supply + demand > 0) {
    const pressure = (demand - supply) / (demand + supply);
    m.price = Math.min(MARKET.ceiling, Math.max(MARKET.floor, m.price * (1 + MARKET.adjustPerTick * pressure)));
  }
  if ((world.tick + 1) % MARKET.historyEveryTicks === 0) {
    m.history.push(Math.round(m.price * 100) / 100);
    if (m.history.length > MARKET.historyLength) m.history.splice(0, m.history.length - MARKET.historyLength);
  }

  // 5. Armées.
  stepMilitary(world);

  // 6. Traités résiliés avec préavis.
  const expired = meta.treaties.filter((t) => t.endsAtTick !== null && world.tick + 1 >= t.endsAtTick);
  for (const t of expired) {
    pushEvent(world, 'treaty_end', `${TREATY_LABEL[t.type]} entre ${playerName(meta, t.a)} et ${playerName(meta, t.b)} prend fin.`, [t.a, t.b]);
  }
  meta.treaties = meta.treaties.filter((t) => !expired.includes(t));

  // 7. Nations.
  for (const countryId of Object.keys(meta.nations).sort()) evaluateNation(world, countryId);

  world.tick += 1;
  return layers;
}
