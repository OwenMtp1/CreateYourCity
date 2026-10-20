// Simulation agrégée d'une ville pour un tick. Fonction déterministe : même état d'entrée,
// même résultat (aucun aléa, aucune horloge). Toutes les formules sont exprimées par jour de
// jeu puis multipliées par DT_DAYS.
import { BUILDINGS, ROADS, SERVICE_KINDS, TRANSIT_MODES, type ServiceKind, type TransitMode } from '../catalog.ts';
import { DAYS_PER_YEAR, DT_DAYS, ECONOMY, LOAN_ANNUAL_RATE, PARKING, POPULATION, TRAFFIC, TRANSIT } from '../constants.ts';
import { segmentLength } from '../geometry.ts';
import type { Building, CityLayers, CityState, CityStats } from '../types.ts';
import { getLayout } from './layout.ts';
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
  const pollutionFactor = law.environment ? LAW_EFFECTS.environment.pollutionFactor : 1;
  const industryFactor = law.environment ? LAW_EFFECTS.environment.industryFactor : 1;
  const roadCapacityFactor = project.highway ? PROJECT_EFFECTS.highway.roadCapacityFactor : 1;
  const powerPrice = ECONOMY.powerImportPricePerMWh * (project.power_grid ? PROJECT_EFFECTS.power_grid.powerImportFactor : 1);
  const officeFactor = project.university ? PROJECT_EFFECTS.university.officeRevenueFactor : 1;
  const serviceCapacityFactor: Record<ServiceKind, number> = {
    health: law.public_health ? LAW_EFFECTS.public_health.healthCapacityFactor : 1,
    education: project.university ? PROJECT_EFFECTS.university.educationCapacityFactor : 1,
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
  const workforce = population * ECONOMY.workforceShare;
  const employed = Math.min(workforce, jobs);
  const staffing = jobs > 0 ? employed / jobs : 0;
  const residents = new Map<number, number>();
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
    powerLocal += (def.powerOutputMW ?? 0) * staffing;
    waterLocal += (def.waterOutputM3PerDay ?? 0) * staffing;
  }
  const powerImported = Math.max(0, powerDemand - powerLocal);
  const waterImported = Math.max(0, waterDemand - waterLocal);

  // --- Biens : demande, ventes ----------------------------------------------------------
  let salesCapacity = 0;
  for (const b of ops) salesCapacity += (BUILDINGS[b.type].goodsSalesCapacityPerDay ?? 0) * staffing;
  const goodsDemand = population * ECONOMY.goodsDemandPerResident;
  const sold = Math.min(goodsDemand, salesCapacity);

  // --- Transports en commun : part modale des logements desservis, bornée par la capacité ---------
  const stationCount: Record<TransitMode, number> = { bus: 0, tram: 0, metro: 0 };
  let transitCapacity = 0;
  for (const b of ops) {
    const t = BUILDINGS[b.type].transit;
    if (t) stationCount[t.mode]++;
  }
  for (const b of ops) {
    const t = BUILDINGS[b.type].transit;
    if (t && stationCount[t.mode] >= TRANSIT.minStationsPerMode) transitCapacity += t.capacity * staffing;
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

  // --- Trafic : itinéraires sur le graphe routier (domicile-travail, achats, fret) ---------------
  const routing = layout.routing;
  const edgeLoad = new Float64Array(routing.edges.length);
  let carTrips = 0, riders = 0, personalCarTrips = 0;
  for (const [id, n] of residents) {
    const share = (potentialShare.get(id) ?? 0) * transitFill;
    const commuteTrips = n * employmentRate * 2;
    const shopTrips = population > 0 ? (sold * TRAFFIC.tripsPerGoodSold * n) / population : 0;
    const car = (commuteTrips + shopTrips) * (1 - share);
    riders += (commuteTrips + shopTrips) * share;
    carTrips += car;
    personalCarTrips += car;
    const cw = routing.commute.get(id);
    if (cw) for (const [e, w] of cw) edgeLoad[e]! += commuteTrips * (1 - share) * w;
    const sw = routing.shopping.get(id);
    if (sw) for (const [e, w] of sw) edgeLoad[e]! += shopTrips * (1 - share) * w;
  }
  for (const b of ops) {
    const fw = routing.freight.get(b.id);
    if (!fw) continue;
    const trips = (BUILDINGS[b.type].goodsProductionPerDay ?? 0) * staffing * TRAFFIC.freightTripsPerGood;
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
    parkingFees += l.used * l.fee * PARKING.turnoverPerDay;
    parkingUse[l.id] = l.spaces > 0 ? l.used / l.spaces : 0;
  }
  // Coût moyen du stationnement par trajet en voiture : au-delà de la tolérance, la ville déplaît.
  const feePerTrip = personalCarTrips > 0 ? parkingFees / personalCarTrips : 0;
  const parkingMalus = PARKING.maxFeeMalus * clamp01(feePerTrip / PARKING.feeTolerance);
  // Sans place, les voitures tournent : le trafic ralentit.
  const trafficEfficiency = roadEfficiency * (1 - PARKING.searchPenalty * (1 - parkingCoverage));

  // --- Production et comptes des entreprises ---------------------------------------------------
  let produced = 0, officeRevenue = 0, commercialWages = 0, industrialWages = 0;
  for (const b of ops) {
    const def = BUILDINGS[b.type];
    const wages = def.jobs * staffing * wage;
    produced += (def.goodsProductionPerDay ?? 0) * staffing * trafficEfficiency * industryFactor;
    if (def.officeRevenue) officeRevenue += def.jobs * staffing * ECONOMY.officeRevenuePerWorker * trafficEfficiency * officeFactor;
    if (def.category === 'commercial') commercialWages += wages;
    if (def.category === 'industrial') industrialWages += wages;
  }
  // Ordre d'approvisionnement des commerces : contrats, production locale, marché commun.
  // Les livraisons promises par contrat sont prélevées en priorité sur la production locale.
  const contractDelivered = Math.min(mod.contractOut.qty, produced);
  const contractDeliveredRatio = mod.contractOut.qty > 0 ? contractDelivered / mod.contractOut.qty : 1;
  const available = produced - contractDelivered;
  const contractUsed = Math.min(sold, mod.contractIn.qty);
  const localUsed = Math.min(sold - contractUsed, available);
  const imported = sold - contractUsed - localUsed;
  const exported = available - localUsed;
  const contractResold = mod.contractIn.qty - contractUsed;
  const commercialProfit =
    sold * ECONOMY.retailPrice + officeRevenue + contractResold * mod.goodsExportPrice -
    (mod.contractIn.cost + mod.contractIn.tariff + localUsed * ECONOMY.localWholesalePrice +
      imported * mod.goodsImportPrice * (1 + mod.tariffRate) + commercialWages);
  // Droits de douane versés au budget national (achats au marché + contrats étrangers).
  const tariffPaid = imported * mod.goodsImportPrice * mod.tariffRate + mod.contractIn.tariff;
  const industrialProfit =
    localUsed * ECONOMY.localWholesalePrice + exported * mod.goodsExportPrice +
    mod.contractOut.revenue * contractDeliveredRatio - industrialWages;

  // --- Services publics : affectation gloutonne, du plus proche au plus lointain ----------------
  const served: Record<ServiceKind, Map<number, number>> = { health: new Map(), education: new Map(), safety: new Map(), leisure: new Map() };
  const capacityByKind: Record<ServiceKind, number> = { health: 0, education: 0, safety: 0, leisure: 0 };
  const serviceLoad: Record<number, number> = {};
  for (const b of ops) {
    const svc = BUILDINGS[b.type].service;
    if (!svc) continue;
    let remaining = svc.capacity * serviceCapacityFactor[svc.kind] * staffing * budgetEfficiency;
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
  }
  // Couverture par bâtiment résidentiel. Sans habitants, on mesure la couverture potentielle
  // (bâtiment à portée d'un service doté de personnel) pondérée par la capacité de logement.
  const reachable: Record<ServiceKind, Set<number>> = { health: new Set(), education: new Set(), safety: new Set(), leisure: new Set() };
  for (const b of ops) {
    const svc = BUILDINGS[b.type].service;
    if (svc && staffing > 0) for (const id of layout.serviceReach.get(b.id) ?? []) reachable[svc.kind].add(id);
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
    const healthFactor = law.public_health && BUILDINGS[b.type].service?.kind === 'health' ? LAW_EFFECTS.public_health.healthUpkeepFactor : 1;
    upkeep += BUILDINGS[b.type].upkeepPerDay * healthFactor;
  }
  for (const r of city.roads) upkeep += segmentLength(r) * ROADS[r.type].upkeepPerMeterPerDay;
  const utilityImports =
    powerImported * 24 * powerPrice + waterImported * ECONOMY.waterImportPricePerM3;
  const loanInterest = (city.debt * LOAN_ANNUAL_RATE) / DAYS_PER_YEAR;
  const residentialTax = city.taxes.residential * employed * wage;
  // Impôt national prélevé sur les revenus des habitants ; versé au budget national par le monde.
  const nationalTax = mod.nationalTaxRate * employed * wage;
  const commercialTax = city.taxes.commercial * Math.max(0, commercialProfit);
  const industrialTax = city.taxes.industrial * Math.max(0, industrialProfit);
  const transitFares = riders * TRANSIT.farePerRide;
  const net = residentialTax + commercialTax + industrialTax + transitFares + parkingFees - upkeep - utilityImports - loanInterest;
  city.treasury += net * DT_DAYS;

  // --- Migrations -----------------------------------------------------------------------------
  const jobScore = workforce > 0 ? Math.min(1, jobs / workforce) : jobs > 0 ? 1 : 0;
  const serviceScore = meanCoverage;
  const bonus = (law.minimum_wage ? LAW_EFFECTS.minimum_wage.attractivenessBonus : 0) -
    (law.conscription ? LAW_EFFECTS.conscription.attractivenessMalus : 0) - parkingMalus;
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
      importPrice: mod.goodsImportPrice, exportPrice: mod.goodsExportPrice, tariffPaid,
    },
    services,
    serviceInequality,
    pollutionExposure,
    traffic: { trips: totalTrips, efficiency: trafficEfficiency, congestedSegments },
    transit: { riders, capacity: transitCapacity, share: totalTrips > 0 ? riders / totalTrips : 0 },
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

  return { buildingStatus, residentialCoverage, pollution, roadLoad, roadConnected, serviceLoad, parkingUse };
}

/** Avance une ville de n ticks (rattrapage déterministe). */
export function simulateTicks(city: CityState, n: number, mod: CityModifiers = DEFAULT_MODIFIERS): void {
  for (let i = 0; i < n; i++) simulateTick(city, mod);
}
