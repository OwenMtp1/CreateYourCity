// Simulation agrégée d'une ville pour un tick. Fonction déterministe : même état d'entrée,
// même résultat (aucun aléa, aucune horloge). Toutes les formules sont exprimées par jour de
// jeu puis multipliées par DT_DAYS.
import { BUILDINGS, ROADS, SERVICE_KINDS, TRANSIT_MODES, type ServiceKind, type TransitMode } from '../catalog.ts';
import { COMMERCE, DAYS_PER_YEAR, FACTORY_STOCK_DAYS, DT_DAYS, ECONOMY, INDEPENDENCE, LOAN_ANNUAL_RATE, PARKING, POPULATION, POPULATION_POLICY, TRAFFIC, TRANSIT } from '../constants.ts';
import { segmentLength } from '../geometry.ts';
import { daylight } from '../time.ts';
import type { Building, BuildingDetail, BuildingEconomy, CampaignKind, CityLayers, CityState, CityStats, SupplyLink } from '../types.ts';
import { getLayout } from './layout.ts';
import { assignWorkers } from './staffing.ts';
import { checkMilestones } from './milestones.ts';
import { DEFAULT_MODIFIERS, LAW_EFFECTS, PROJECT_EFFECTS, type CityModifiers } from './modifiers.ts';

export const HISTORY_EVERY_TICKS = 24;
export const HISTORY_LENGTH = 90;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Efficacité d'un tronçon selon son ratio charge / capacité. */
export function segmentEfficiency(ratio: number): number {
  if (ratio <= TRAFFIC.freeFlowRatio) return 1;
  return Math.max(TRAFFIC.minEfficiency, 1 - (ratio - TRAFFIC.freeFlowRatio) * 0.6);
}

/** Attractivité 0..1 : emploi, services, fiscalité, trafic, pollution. */
export function attractiveness(input: {
  jobScore: number; serviceScore: number; residentialTax: number; trafficEfficiency: number; pollution: number; bonus?: number;
}): number {
  const taxScore = 1 - clamp01((input.residentialTax - POPULATION.comfortableTaxRate) / 0.22);
  return clamp01(
    0.4 * input.jobScore + 0.25 * input.serviceScore + 0.2 * taxScore + 0.15 * input.trafficEfficiency - 0.3 * input.pollution +
      (input.bonus ?? 0),
  );
}

export function simulateTick(city: CityState, mod: CityModifiers = DEFAULT_MODIFIERS): CityLayers {
  const layout = getLayout(city);
  const law = mod.laws;
  const project = mod.projects;
  const wage = ECONOMY.wagePerWorker * (law.minimum_wage ? LAW_EFFECTS.minimum_wage.wageFactor : 1);
  const pollutionFactor = (law.environment ? LAW_EFFECTS.environment.pollutionFactor : 1) * (project.national_park ? PROJECT_EFFECTS.national_park.pollutionFactor : 1);
  const goodsSalesFactor = project.trade_fair ? PROJECT_EFFECTS.trade_fair.goodsSalesFactor : 1;
  const industryFactor = law.environment ? LAW_EFFECTS.environment.industryFactor : 1;
  const roadCapacityFactor = project.highway ? PROJECT_EFFECTS.highway.roadCapacityFactor : 1;
  const powerPrice = ECONOMY.powerImportPricePerMWh * (project.power_grid ? PROJECT_EFFECTS.power_grid.powerImportFactor : 1);
  const officeFactor = (project.university ? PROJECT_EFFECTS.university.officeRevenueFactor : 1) * (project.data_network ? PROJECT_EFFECTS.data_network.officeRevenueFactor : 1);
  const serviceCapacityFactor: Record<ServiceKind, number> = {
    health: (law.public_health ? LAW_EFFECTS.public_health.healthCapacityFactor : 1) * (project.national_health ? PROJECT_EFFECTS.national_health.healthCapacityFactor : 1),
    education: (project.university ? PROJECT_EFFECTS.university.educationCapacityFactor : 1) * (law.education ? LAW_EFFECTS.education.educationCapacityFactor : 1),
    safety: 1,
    leisure: 1,
  };
  const ops: Building[] = city.buildings.filter((b) => layout.status.get(b.id) === 'ok');
  const budgetEfficiency = city.treasury < 0 ? ECONOMY.deficitServiceEfficiency : 1;

  // --- Logement, emploi -------------------------------------------------------------------
  let housing = 0;
  let jobs = 0;
  for (const b of ops) {
    housing += BUILDINGS[b.type].housing;
    jobs += BUILDINGS[b.type].jobs;
  }
  // Les habitants d'un logement démoli ou déconnecté partent immédiatement.
  const population = Math.min(city.population, housing);
  const campaignActive = (kind: CampaignKind) => (city.campaigns ?? []).some((c) => c.kind === kind && c.endsTick > city.tick);
  const participation = ECONOMY.workforceShare + (campaignActive('jobs') ? POPULATION_POLICY.jobsParticipationBonus : 0);
  const workforce = population * participation;
  // Répartition des actifs par site : automatique, avec les déplacements manuels du joueur.
  const allocation = assignWorkers(
    ops.filter((b) => BUILDINGS[b.type].jobs > 0).map((b) => ({ id: b.id, jobs: BUILDINGS[b.type].jobs })),
    workforce, city.assignments,
  );
  const employed = [...allocation.employed.values()].reduce((a, b) => a + b, 0);
  const staffing = jobs > 0 ? employed / jobs : 0;
  /** Part des postes pourvus sur un site donné. */
  const staff = (id: number) => allocation.staffing.get(id) ?? 0;
  const residents = new Map<number, number>();
  const details: Record<number, BuildingDetail> = {};
  const detail = (id: number): BuildingDetail => (details[id] ??= {});
  for (const b of ops) {
    const h = BUILDINGS[b.type].housing;
    if (h > 0) residents.set(b.id, housing > 0 ? (population * h) / housing : 0);
  }

  // --- Électricité et eau (déficit importé du réseau régional) -------------------------------
  let powerDemand = 0, powerLocal = 0, waterDemand = 0, waterLocal = 0;
  for (const b of ops) {
    const def = BUILDINGS[b.type];
    powerDemand += def.powerMW;
    waterDemand += def.waterM3PerDay;
    // Le solaire ne produit que le jour ; les autres centrales produisent à toute heure.
    const sun = def.sunPowered ? daylight(city.tick) : 1;
    powerLocal += (def.powerOutputMW ?? 0) * staff(b.id) * sun;
    waterLocal += (def.waterOutputM3PerDay ?? 0) * staff(b.id);
    if (def.powerOutputMW) detail(b.id).capacity = def.powerOutputMW * staff(b.id) * sun;
    if (def.waterOutputM3PerDay) detail(b.id).capacity = def.waterOutputM3PerDay * staff(b.id);
  }
  // Ville indépendante : pas de réseau régional. Un déficit provoque des coupures qui freinent
  // les entreprises et les services (facteur `utilitySupply`) et font fuir les habitants.
  const isolated = mod.isolated === true;
  const powerImported = isolated ? 0 : Math.max(0, powerDemand - powerLocal);
  const waterImported = isolated ? 0 : Math.max(0, waterDemand - waterLocal);
  const powerCover = isolated && powerDemand > 0 ? Math.min(1, powerLocal / powerDemand) : 1;
  const waterCover = isolated && waterDemand > 0 ? Math.min(1, waterLocal / waterDemand) : 1;
  const utilitySupply = Math.min(powerCover, waterCover);

  // --- Biens : chaque commerce vend aux habitants de son quartier, du plus proche au plus lointain ---
  const goodsDemand = population * ECONOMY.goodsDemandPerResident;
  /** Biens achetés par logement, ventes et clients par commerce. */
  const purchased = new Map<number, number>();
  const shopSold = new Map<number, number>();
  const shopCustomers = new Map<number, number>();
  /** Habitants vivant dans la zone de chalandise (qu'ils achètent ou non). */
  const shopCatchment = new Map<number, number>();
  let sold = 0;
  /** Capacité encore libre de chaque commerce. */
  const room = new Map<number, number>();
  const shops = ops.filter((b) => (BUILDINGS[b.type].goodsSalesCapacityPerDay ?? 0) > 0);
  for (const b of shops) {
    const available = BUILDINGS[b.type].goodsSalesCapacityPerDay! * staff(b.id) * utilitySupply * goodsSalesFactor;
    room.set(b.id, available);
    shopSold.set(b.id, 0);
    detail(b.id).capacity = available;
    let catchment = 0;
    for (const resId of layout.shopReach.get(b.id) ?? []) catchment += residents.get(resId) ?? 0;
    shopCatchment.set(b.id, catchment);
  }
  // Tous les habitants de la ville achètent, du commerce le plus proche au plus lointain, jusqu'à épuisement de chaque commerce.
  const at = new Map(city.buildings.map((b) => [b.id, b]));
  const distance = (a: Building | undefined, b: Building | undefined) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);
  for (const [resId, count] of residents) {
    let want = count * ECONOMY.goodsDemandPerResident;
    const home = at.get(resId);
    const nearestFirst = shops
      .filter((s) => (room.get(s.id) ?? 0) > 1e-9)
      .sort((a, b) => distance(home, a) - distance(home, b));
    for (const s of nearestFirst) {
      if (want <= 1e-9) break;
      const free = room.get(s.id) ?? 0;
      const take = Math.min(want, free);
      want -= take;
      room.set(s.id, free - take);
      shopSold.set(s.id, (shopSold.get(s.id) ?? 0) + take);
      purchased.set(resId, (purchased.get(resId) ?? 0) + take);
    }
  }
  for (const [id, sales] of shopSold) {
    shopCustomers.set(id, sales / ECONOMY.goodsDemandPerResident);
    sold += sales;
  }

  // --- Approvisionnement : contrats, puis usines de la ville (les plus proches d'abord), puis importations ---
  const factories = ops.filter((b) => (BUILDINGS[b.type].goodsProductionPerDay ?? 0) > 0);
  const potentialOutput = (f: Building) => (BUILDINGS[f.type].goodsProductionPerDay ?? 0) * staff(f.id) * industryFactor * utilitySupply;
  const contractUsed = Math.min(sold, mod.contractIn.qty);
  const supplyPlan = (outputOf: (f: Building) => number) => {
    const total = factories.reduce((a, f) => a + outputOf(f), 0);
    // Les livraisons promises par contrat sont prélevées en priorité sur la production.
    const contractDelivered = Math.min(mod.contractOut.qty, total);
    const keep = total > 0 ? 1 - contractDelivered / total : 0;
    const need = new Map<number, number>();
    for (const [id, q] of shopSold) need.set(id, sold > 0 ? q * (1 - contractUsed / sold) : 0);
    const links: SupplyLink[] = [];
    const shipped = new Map<number, number>();
    const ship = (f: Building, shopId: number, qty: number, distance: number) => {
      need.set(shopId, (need.get(shopId) ?? 0) - qty);
      shipped.set(f.id, (shipped.get(f.id) ?? 0) + qty);
      links.push({ from: f.id, to: shopId, qty, distance });
    };
    for (const f of factories) {
      // Production du jour et stock conservé.
      let left = outputOf(f) * keep + (f.stock ?? 0);
      const routes = layout.routing.deliveries.get(f.id) ?? [];
      if (f.supplyPlan) {
        // Choix du joueur : la capacité envoyée à chaque commerce, dans la limite de la demande et de la route.
        for (const [key, planned] of Object.entries(f.supplyPlan)) {
          const shopId = Number(key);
          const route = routes.find((d) => d.shopId === shopId);
          const n = need.get(shopId) ?? 0;
          if (!route || n <= 1e-9) continue;
          const q = Math.min(planned, n, left);
          if (q <= 1e-9) continue;
          left -= q;
          ship(f, shopId, q, route.distance);
        }
        continue;
      }
      // Répartition automatique : les commerces les plus proches d'abord.
      for (const d of routes) {
        if (left <= 1e-9) break;
        const n = need.get(d.shopId) ?? 0;
        if (n <= 1e-9) continue;
        const q = Math.min(n, left);
        left -= q;
        ship(f, d.shopId, q, d.distance);
      }
    }
    return { total, contractDelivered, links, shipped };
  };
  // Plan prévisionnel (sans les embouteillages) pour charger les routes des camions.
  const freightPlan = supplyPlan(potentialOutput);

  // --- Transports en commun : part modale des logements desservis, bornée par la capacité ---------
  const stationCount: Record<TransitMode, number> = { bus: 0, tram: 0, metro: 0 };
  let transitCapacity = 0;
  const modeCapacity: Record<TransitMode, number> = { bus: 0, tram: 0, metro: 0 };
  for (const b of ops) {
    const t = BUILDINGS[b.type].transit;
    if (t) stationCount[t.mode]++;
  }
  for (const b of ops) {
    const t = BUILDINGS[b.type].transit;
    if (t && stationCount[t.mode] >= TRANSIT.minStationsPerMode) {
      transitCapacity += t.capacity * staff(b.id) * utilitySupply;
      modeCapacity[t.mode] += t.capacity * staff(b.id) * utilitySupply;
    }
    if (t) detail(b.id).capacity = t.capacity * staff(b.id) * utilitySupply;
  }
  const employmentRate = population > 0 ? employed / population : 0;
  const potentialShare = new Map<number, number>();
  let transitDemand = 0;
  for (const [id, n] of residents) {
    let share = 0;
    for (const m of TRANSIT_MODES) {
      if (stationCount[m] >= TRANSIT.minStationsPerMode && layout.transitCover.get(id)?.has(m)) share = Math.max(share, TRANSIT.modeShare[m]);
    }
    potentialShare.set(id, share);
    transitDemand += n * employmentRate * 2 * share;
  }
  const transitFill = transitDemand > 0 ? Math.min(1, transitCapacity / transitDemand) : 0;
  // Bus à tarif libre : un tarif plus bas retient davantage de voyageurs, un tarif plus haut les renvoie en voiture.
  const baseFare = TRANSIT.farePerRide;
  const busFare = city.transitFares?.bus ?? baseFare;
  const busWeight = transitCapacity > 0 ? modeCapacity.bus / transitCapacity : 0;
  const busRetention = Math.min(1.3, Math.max(0.4, 1 - (0.5 * (busFare - baseFare)) / baseFare));
  const busNormal = 1 - busWeight + busWeight * busRetention;
  const busPart = busNormal > 0 ? (busWeight * busRetention) / busNormal : 0;
  let busRiders = 0;

  // --- Trafic : itinéraires sur le graphe routier (domicile-travail, achats, fret) ---------------
  const routing = layout.routing;
  const edgeLoad = new Float64Array(routing.edges.length);
  let carTrips = 0, riders = 0, personalCarTrips = 0;
  for (const [id, n] of residents) {
    const share = Math.min(1, (potentialShare.get(id) ?? 0) * transitFill * busNormal);
    const commuteTrips = n * employmentRate * 2;
    const shopTrips = (purchased.get(id) ?? 0) * TRAFFIC.tripsPerGoodSold;
    const car = (commuteTrips + shopTrips) * (1 - share);
    riders += (commuteTrips + shopTrips) * share;
    busRiders += (commuteTrips + shopTrips) * share * busPart;
    carTrips += car;
    personalCarTrips += car;
    const cw = routing.commute.get(id);
    if (cw) for (const [e, w] of cw) edgeLoad[e]! += commuteTrips * (1 - share) * w;
    const sw = routing.shopping.get(id);
    if (sw) for (const [e, w] of sw) edgeLoad[e]! += shopTrips * (1 - share) * w;
  }
  // Camions : livraisons vers les commerces de la ville, puis exportations vers l'accès régional.
  for (const l of freightPlan.links) {
    const d = routing.deliveries.get(l.from)?.find((x) => x.shopId === l.to);
    if (!d) continue;
    const trips = l.qty * TRAFFIC.freightTripsPerGood;
    carTrips += trips;
    for (const [e, w] of d.edges) edgeLoad[e]! += trips * w;
  }
  for (const f of factories) {
    const fw = routing.freight.get(f.id);
    if (!fw) continue;
    const trips = Math.max(0, potentialOutput(f) - (freightPlan.shipped.get(f.id) ?? 0)) * TRAFFIC.freightTripsPerGood;
    carTrips += trips;
    for (const [e, w] of fw) edgeLoad[e]! += trips * w;
  }
  const roadRatio = new Map<number, number>();
  let weighted = 0, weight = 0;
  const roadById = new Map(city.roads.map((r) => [r.id, r]));
  for (const e of routing.edges) {
    const road = roadById.get(e.roadId);
    if (!road) continue;
    const ratio = edgeLoad[e.id]! / (ROADS[road.type].capacityTripsPerDay * roadCapacityFactor);
    roadRatio.set(e.roadId, Math.max(roadRatio.get(e.roadId) ?? 0, ratio));
    weighted += edgeLoad[e.id]! * e.length * segmentEfficiency(ratio);
    weight += edgeLoad[e.id]! * e.length;
  }
  const roadLoad: Record<number, number> = {};
  const roadConnected: Record<number, boolean> = {};
  let congestedSegments = 0;
  for (const r of city.roads) {
    const ratio = roadRatio.get(r.id) ?? 0;
    roadLoad[r.id] = ratio;
    roadConnected[r.id] = layout.roadConnected.get(r.id) === true;
    if (ratio > TRAFFIC.freeFlowRatio) congestedSegments++;
  }
  const roadEfficiency = weight > 0 ? weighted / weight : 1;
  const totalTrips = carTrips + riders;

  // --- Stationnement : rues raccordées + parkings, répartis selon le tarif -----------------------
  let streetSpaces = 0;
  for (const r of city.roads) {
    if (layout.roadConnected.get(r.id)) streetSpaces += segmentLength(r) * PARKING.streetSpacesPerMeter[r.type];
  }
  const lots: { id: number; spaces: number; fee: number; weight: number; used: number }[] = [];
  for (const b of ops) {
    const p = BUILDINGS[b.type].parking;
    if (!p) continue;
    const fee = Math.max(0, Math.min(PARKING.maxFee, b.fee ?? 0));
    lots.push({ id: b.id, spaces: p.spaces, fee, weight: p.spaces * Math.exp(-fee / PARKING.priceSensitivity), used: 0 });
  }
  const lotSpaces = lots.reduce((a, l) => a + l.spaces, 0);
  const parkingDemand = personalCarTrips * PARKING.spacesPerCarTrip;
  // Premier passage : chacun choisit selon l'attrait (places × tarif) ; second passage : le reste
  // de la demande se gare là où il reste de la place, faute de mieux.
  let streetUsed = 0;
  let remaining = parkingDemand;
  for (let pass = 0; pass < 2 && remaining > 1e-9; pass++) {
    // La rue est gratuite : son poids est simplement le nombre de places libres.
    const streetFree = streetSpaces - streetUsed;
    const total = streetFree + lots.reduce((a, l) => a + (l.spaces - l.used > 0 ? (pass === 0 ? l.weight : l.spaces - l.used) : 0), 0);
    if (total <= 0) break;
    const want = remaining;
    const takeStreet = Math.min(streetFree, (want * streetFree) / total);
    streetUsed += takeStreet;
    remaining -= takeStreet;
    for (const l of lots) {
      const free = l.spaces - l.used;
      if (free <= 0) continue;
      const take = Math.min(free, (want * (pass === 0 ? l.weight : free)) / total);
      l.used += take;
      remaining -= take;
    }
  }
  const parkingUsed = parkingDemand - Math.max(0, remaining);
  const parkingCoverage = parkingDemand > 0 ? Math.min(1, parkingUsed / parkingDemand) : 1;
  let parkingFees = 0;
  const parkingUse: Record<number, number> = {};
  for (const l of lots) {
    const revenue = l.used * l.fee * PARKING.turnoverPerDay;
    parkingFees += revenue;
    parkingUse[l.id] = l.spaces > 0 ? l.used / l.spaces : 0;
    detail(l.id).revenue = revenue;
  }
  // Coût moyen du stationnement par trajet en voiture : au-delà de la tolérance, la ville déplaît.
  const feePerTrip = personalCarTrips > 0 ? parkingFees / personalCarTrips : 0;
  const parkingMalus = PARKING.maxFeeMalus * clamp01(feePerTrip / PARKING.feeTolerance);
  // Sans place, les voitures tournent : le trafic ralentit.
  const trafficEfficiency = roadEfficiency * (1 - PARKING.searchPenalty * (1 - parkingCoverage));

  // --- Production et comptes de chaque entreprise ---------------------------------------------
  // Les embouteillages freinent la production des usines et l'activité des bureaux.
  const plan = supplyPlan((f) => potentialOutput(f) * trafficEfficiency);
  const produced = plan.total;
  const contractDelivered = plan.contractDelivered;
  const contractDeliveredRatio = mod.contractOut.qty > 0 ? contractDelivered / mod.contractOut.qty : 1;
  const localIn = new Map<number, { qty: number; cost: number }>();
  let localSupplied = 0;
  for (const l of plan.links) {
    const c = localIn.get(l.to) ?? { qty: 0, cost: 0 };
    c.qty += l.qty;
    c.cost += l.qty * (ECONOMY.localWholesalePrice + l.distance * COMMERCE.deliveryCostPerMeter);
    localIn.set(l.to, c);
    localSupplied += l.qty;
  }
  const importUnit = mod.goodsImportPrice * (1 + mod.tariffRate) + COMMERCE.importHandling;
  const contractUnit = mod.contractIn.qty > 0 ? (mod.contractIn.cost + mod.contractIn.tariff) / mod.contractIn.qty : 0;
  const economy: Record<number, BuildingEconomy> = {};
  let imported = 0, exported = 0, commercialTax = 0, industrialTax = 0, lostSales = 0, unsoldGoods = 0;
  for (const b of ops) {
    const def = BUILDINGS[b.type];
    const wages = def.jobs * staff(b.id) * wage;
    if (def.goodsSalesCapacityPerDay) {
      const wanted = shopSold.get(b.id) ?? 0;
      const contract = sold > 0 ? (wanted * contractUsed) / sold : 0;
      const local = localIn.get(b.id) ?? { qty: 0, cost: 0 };
      // Sans accès au marché commun, un commerce ne vend que ce que la ville produit.
      const missing = Math.max(0, wanted - contract - local.qty);
      const imp = isolated ? 0 : missing;
      const q = isolated ? wanted - missing : wanted;
      if (isolated) lostSales += missing;
      b.demand = (shopCatchment.get(b.id) ?? 0) * ECONOMY.goodsDemandPerResident;
      imported += imp;
      const purchases = local.cost + contract * contractUnit + imp * importUnit;
      const revenue = q * ECONOMY.retailPrice;
      const profit = revenue - purchases - wages;
      const tax = city.taxes.commercial * Math.max(0, profit);
      commercialTax += tax;
      economy[b.id] = {
        revenue, costs: purchases + wages, profit, tax, customers: (shopCustomers.get(b.id) ?? 0) * (wanted > 0 ? q / wanted : 0), sold: q, local: local.qty, contract,
        catchment: shopCatchment.get(b.id) ?? 0, demand: (shopCatchment.get(b.id) ?? 0) * ECONOMY.goodsDemandPerResident,
        staffed: staff(b.id) > 0, powered: utilitySupply > 0,
        imported: imp, unitCost: q > 0 ? purchases / q : 0,
      };
    } else if (def.officeRevenue) {
      const educated = layout.educatedOffices.has(b.id);
      const revenue = def.jobs * staff(b.id) * ECONOMY.officeRevenuePerWorker * trafficEfficiency * officeFactor * utilitySupply *
        (educated ? 1 + COMMERCE.educatedOfficeBonus : 1);
      const profit = revenue - wages;
      const tax = city.taxes.commercial * Math.max(0, profit);
      commercialTax += tax;
      economy[b.id] = { revenue, costs: wages, profit, tax, educated };
    } else if (def.goodsProductionPerDay) {
      const out = potentialOutput(b) * trafficEfficiency;
      const share = plan.total > 0 ? out / plan.total : 0;
      const shipped = plan.shipped.get(b.id) ?? 0;
      const stockBefore = b.stock ?? 0;
      const leftover = Math.max(0, out + stockBefore - contractDelivered * share - shipped);
      // Surplus : exporté (par défaut), ou gardé en stock jusqu'à FACTORY_STOCK_DAYS de production.
      const stockCap = FACTORY_STOCK_DAYS * (BUILDINGS[b.type].goodsProductionPerDay ?? 0);
      const keepStock = b.exportSurplus === false;
      const newStock = keepStock && !isolated ? Math.min(stockCap, leftover) : 0;
      const surplus = leftover - newStock;
      b.stock = newStock > 0 ? newStock : undefined;
      // Ville indépendante : le surplus ne peut pas être exporté, il reste invendu.
      const exp = isolated || keepStock ? 0 : surplus;
      if (isolated) unsoldGoods += surplus;
      exported += exp;
      const revenue = shipped * ECONOMY.localWholesalePrice + exp * mod.goodsExportPrice + mod.contractOut.revenue * contractDeliveredRatio * share;
      const profit = revenue - wages;
      const tax = city.taxes.industrial * Math.max(0, profit);
      industrialTax += tax;
      economy[b.id] = { revenue, costs: wages, profit, tax, produced: out, shipped, exported: exp, stock: newStock, ...(isolated || keepStock ? { unsold: surplus } : {}) };
    }
  }
  sold -= lostSales;
  // Biens achetés par contrat mais invendus : revendus au marché commun (négoce municipal).
  const contractResold = mod.contractIn.qty - contractUsed;
  const trading = contractResold * (mod.goodsExportPrice - contractUnit);
  commercialTax += city.taxes.commercial * Math.max(0, trading);
  // Droits de douane versés au budget national (achats au marché + contrats étrangers).
  const tariffPaid = imported * mod.goodsImportPrice * mod.tariffRate + mod.contractIn.tariff;

  // --- Services publics : affectation gloutonne, du plus proche au plus lointain ----------------
  const served: Record<ServiceKind, Map<number, number>> = { health: new Map(), education: new Map(), safety: new Map(), leisure: new Map() };
  const capacityByKind: Record<ServiceKind, number> = { health: 0, education: 0, safety: 0, leisure: 0 };
  const serviceLoad: Record<number, number> = {};
  const serviceUse = new Map<number, number>();
  for (const b of ops) {
    const svc = BUILDINGS[b.type].service;
    if (!svc) continue;
    let remaining = svc.capacity * serviceCapacityFactor[svc.kind] * staff(b.id) * budgetEfficiency * utilitySupply;
    capacityByKind[svc.kind] += remaining;
    const initial = remaining;
    const map = served[svc.kind];
    for (const resId of layout.serviceReach.get(b.id) ?? []) {
      if (remaining <= 0) break;
      const need = (residents.get(resId) ?? 0) - (map.get(resId) ?? 0);
      if (need <= 0) continue;
      const take = Math.min(need, remaining);
      map.set(resId, (map.get(resId) ?? 0) + take);
      remaining -= take;
    }
    serviceLoad[b.id] = initial > 0 ? 1 - remaining / initial : 1;
    detail(b.id).capacity = initial;
    detail(b.id).served = initial - remaining;
    // Utilisation réelle par rapport à la capacité nominale (pour l'entretien variable).
    serviceUse.set(b.id, Math.min(1, (initial - remaining) / (svc.capacity * serviceCapacityFactor[svc.kind])));
  }
  // Couverture par bâtiment résidentiel. Sans habitants, on mesure la couverture potentielle
  // (bâtiment à portée d'un service doté de personnel) pondérée par la capacité de logement.
  const reachable: Record<ServiceKind, Set<number>> = { health: new Set(), education: new Set(), safety: new Set(), leisure: new Set() };
  for (const b of ops) {
    const svc = BUILDINGS[b.type].service;
    if (svc && staff(b.id) > 0) for (const id of layout.serviceReach.get(b.id) ?? []) reachable[svc.kind].add(id);
  }
  const residentialCoverage: Record<number, Record<ServiceKind, number>> = {};
  const covByKind: Record<ServiceKind, number> = { health: 0, education: 0, safety: 0, leisure: 0 };
  let covSum = 0, covSqSum = 0, pollutionSum = 0, weightSum = 0;
  for (const b of ops) {
    const n = residents.get(b.id);
    if (n === undefined) continue;
    const w = population > 0 ? n : BUILDINGS[b.type].housing;
    const cov = {} as Record<ServiceKind, number>;
    for (const kind of SERVICE_KINDS) {
      cov[kind] = n > 0 ? (served[kind].get(b.id) ?? 0) / n : reachable[kind].has(b.id) ? 1 : 0;
      covByKind[kind] += cov[kind] * w;
    }
    residentialCoverage[b.id] = cov;
    const avg = SERVICE_KINDS.reduce((a, k) => a + cov[k], 0) / SERVICE_KINDS.length;
    covSum += avg * w;
    covSqSum += avg * avg * w;
    pollutionSum += (layout.pollution.get(b.id) ?? 0) * pollutionFactor * w;
    weightSum += w;
  }
  const services = {} as CityStats['services'];
  for (const kind of SERVICE_KINDS) {
    services[kind] = { coverage: weightSum > 0 ? covByKind[kind] / weightSum : 0, capacity: capacityByKind[kind] };
  }
  const meanCoverage = weightSum > 0 ? covSum / weightSum : 0;
  const serviceInequality = weightSum > 0 ? Math.sqrt(Math.max(0, covSqSum / weightSum - meanCoverage ** 2)) : 0;
  const pollutionExposure = weightSum > 0 ? pollutionSum / weightSum : 0;

  // --- Budget municipal ---------------------------------------------------------------------
  let upkeep = 0;
  for (const b of city.buildings) {
    const def = BUILDINGS[b.type];
    const healthFactor = law.public_health && def.service?.kind === 'health' ? LAW_EFFECTS.public_health.healthUpkeepFactor : 1;
    // Services publics : une part fixe, le reste selon l'utilisation (un équipement vide coûte moins cher).
    const use = serviceUse.get(b.id) ?? 0;
    const usage = def.service ? COMMERCE.serviceFixedUpkeepShare + (1 - COMMERCE.serviceFixedUpkeepShare) * use : 1;
    const cost = def.upkeepPerDay * healthFactor * usage;
    upkeep += cost;
    if (def.service) economy[b.id] = { revenue: 0, costs: cost, profit: -cost, tax: 0, publicCost: cost, use };
  }
  for (const r of city.roads) upkeep += segmentLength(r) * ROADS[r.type].upkeepPerMeterPerDay;
  const utilityImports =
    powerImported * 24 * powerPrice + waterImported * ECONOMY.waterImportPricePerM3;
  const loanInterest = (city.debt * LOAN_ANNUAL_RATE) / DAYS_PER_YEAR;
  // Impôt sur le revenu, logement par logement : les loisirs à proximité font monter la valeur foncière.
  let residentialTax = 0;
  for (const [id, n] of residents) {
    const landValue = COMMERCE.leisureTaxBonus * (residentialCoverage[id]?.leisure ?? 0);
    const tax = city.taxes.residential * n * employmentRate * wage * (1 + landValue);
    residentialTax += tax;
    economy[id] = { revenue: 0, costs: 0, profit: 0, tax, landValue };
  }
  // Impôt national prélevé sur les revenus des habitants ; versé au budget national par le monde.
  const nationalTax = mod.nationalTaxRate * employed * wage;
  const transitFares = (riders - busRiders) * baseFare + busRiders * busFare;
  // Voyageurs et recettes par station : part proportionnelle à sa capacité (estimation).
  for (const b of ops) {
    const t = BUILDINGS[b.type].transit;
    if (!t || transitCapacity <= 0 || !(detail(b.id).capacity ?? 0)) continue;
    const share = (detail(b.id).capacity ?? 0) / transitCapacity;
    const stationRiders = riders * share;
    detail(b.id).riders = stationRiders;
    detail(b.id).revenue = stationRiders * (city.transitFares?.[t.mode] ?? baseFare);
  }
  const net = residentialTax + commercialTax + industrialTax + transitFares + parkingFees - upkeep - utilityImports - loanInterest;
  city.treasury += net * DT_DAYS;

  // --- Migrations -----------------------------------------------------------------------------
  const jobScore = workforce > 0 ? Math.min(1, jobs / workforce) : jobs > 0 ? 1 : 0;
  const serviceScore = meanCoverage;
  const bonus = (campaignActive('attract') ? POPULATION_POLICY.attractBonus : 0) +
    (law.education ? LAW_EFFECTS.education.attractivenessBonus : 0) - (law.emergency ? LAW_EFFECTS.emergency.attractivenessMalus : 0) +
    (project.national_park ? PROJECT_EFFECTS.national_park.attractivenessBonus : 0) +
    (law.minimum_wage ? LAW_EFFECTS.minimum_wage.attractivenessBonus : 0) -
    (law.conscription ? LAW_EFFECTS.conscription.attractivenessMalus : 0) - parkingMalus - INDEPENDENCE.blackoutMalus * (1 - utilitySupply);
  const attract = attractiveness({
    jobScore, serviceScore, residentialTax: city.taxes.residential + mod.nationalTaxRate, trafficEfficiency,
    pollution: pollutionExposure, bonus,
  });
  const targetPopulation = housing * (POPULATION.baseOccupancy + (1 - POPULATION.baseOccupancy) * attract);
  const rate = targetPopulation > population ? POPULATION.immigrationRatePerDay : POPULATION.emigrationRatePerDay;
  const migrationPerDay = (targetPopulation - population) * rate;
  city.population = Math.max(0, Math.min(housing, population + migrationPerDay * DT_DAYS));
  city.tick += 1;

  const buildingStatus: Record<number, CityLayers['buildingStatus'][number]> = {};
  for (const [id, st] of layout.status) buildingStatus[id] = st;
  const pollution: Record<number, number> = {};
  for (const [id, v] of layout.pollution) pollution[id] = v;

  city.stats = {
    siteWorkers: Object.fromEntries(allocation.employed),
    housingCapacity: housing,
    jobs,
    workforce,
    employed,
    unemploymentRate: workforce > 0 ? (workforce - employed) / workforce : 0,
    staffingRatio: staffing,
    attractiveness: attract,
    targetPopulation,
    migrationPerDay,
    power: { demandMW: powerDemand, localMW: powerLocal, importedMW: powerImported },
    water: { demandM3: waterDemand, localM3: waterLocal, importedM3: waterImported },
    goods: {
      demand: goodsDemand, sold, produced, imported, exported, contractIn: mod.contractIn.qty, contractDelivered, contractDeliveredRatio,
      importPrice: mod.goodsImportPrice, exportPrice: mod.goodsExportPrice, tariffPaid, localSupplied, unserved: Math.max(0, goodsDemand - sold),
    },
    services,
    serviceInequality,
    pollutionExposure,
    traffic: { trips: totalTrips, efficiency: trafficEfficiency, congestedSegments },
    transit: { riders, capacity: transitCapacity, share: totalTrips > 0 ? riders / totalTrips : 0 },
    ...(isolated ? { isolation: { powerCover, waterCover, lostSales, unsoldGoods } } : {}),
    parking: { streetSpaces, lotSpaces, demand: parkingDemand, used: parkingUsed, coverage: parkingCoverage, revenue: parkingFees },
    budget: { residentialTax, commercialTax, industrialTax, upkeep, utilityImports, loanInterest, net, nationalTax, transitFares, parkingFees },
  };
  checkMilestones(city);

  if (city.tick % HISTORY_EVERY_TICKS === 0) {
    const history = (city.history ??= []);
    history.push({
      tick: city.tick, population: city.population, treasury: city.treasury, net, unemployment: city.stats.unemploymentRate,
      attractiveness: attract, traffic: trafficEfficiency,
    });
    if (history.length > HISTORY_LENGTH) history.splice(0, history.length - HISTORY_LENGTH);
  }

  // Couches allégées pour le réseau : valeurs arrondies au dixième.
  const r1 = (v: number) => Math.round(v * 10) / 10;
  for (const e of Object.values(economy)) {
    for (const k of Object.keys(e) as (keyof BuildingEconomy)[]) {
      const v = e[k];
      if (typeof v === 'number') (e as unknown as Record<string, number>)[k] = r1(v);
    }
  }
  const supply = plan.links.map((l) => ({ from: l.from, to: l.to, qty: r1(l.qty), distance: Math.round(l.distance) }));
  for (const f of factories) detail(f.id).capacity = potentialOutput(f);
  for (const [id, n] of residents) detail(id).residents = n;
  for (const [id, e] of allocation.employed) Object.assign(detail(id), { workers: e, staffing: staff(id) });
  return { buildingStatus, details, residentialCoverage, pollution, roadLoad, roadConnected, serviceLoad, parkingUse, economy, supply };
}

/** Avance une ville de n ticks (rattrapage déterministe). */
export function simulateTicks(city: CityState, n: number, mod: CityModifiers = DEFAULT_MODIFIERS): void {
  for (let i = 0; i < n; i++) simulateTick(city, mod);
}
