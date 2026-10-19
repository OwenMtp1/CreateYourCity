// Simulation agrégée d'une ville pour un tick. Fonction déterministe : même état d'entrée,
// même résultat (aucun aléa, aucune horloge). Toutes les formules sont exprimées par jour de
// jeu puis multipliées par DT_DAYS.
import { BUILDINGS, ROADS, SERVICE_KINDS, type ServiceKind } from '../catalog.ts';
import { DAYS_PER_YEAR, DT_DAYS, ECONOMY, LOAN_ANNUAL_RATE, POPULATION, TRAFFIC } from '../constants.ts';
import { segmentLength } from '../geometry.ts';
import type { Building, CityLayers, CityState, CityStats } from '../types.ts';
import { getLayout } from './layout.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Efficacité d'un tronçon selon son ratio charge / capacité. */
export function segmentEfficiency(ratio: number): number {
  if (ratio <= TRAFFIC.freeFlowRatio) return 1;
  return Math.max(TRAFFIC.minEfficiency, 1 - (ratio - TRAFFIC.freeFlowRatio) * 0.6);
}

/** Attractivité 0..1 : emploi, services, fiscalité, trafic, pollution. */
export function attractiveness(input: {
  jobScore: number; serviceScore: number; residentialTax: number; trafficEfficiency: number; pollution: number;
}): number {
  const taxScore = 1 - clamp01((input.residentialTax - POPULATION.comfortableTaxRate) / 0.22);
  return clamp01(
    0.4 * input.jobScore + 0.25 * input.serviceScore + 0.2 * taxScore + 0.15 * input.trafficEfficiency - 0.3 * input.pollution,
  );
}

export function simulateTick(city: CityState): CityLayers {
  const layout = getLayout(city);
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

  // --- Trafic agrégé par tronçon ----------------------------------------------------------
  const roadTrips = new Map<number, number>();
  let totalTrips = 0;
  for (const b of ops) {
    const def = BUILDINGS[b.type];
    let trips = (residents.get(b.id) ?? 0) * TRAFFIC.tripsPerResidentPerDay + def.jobs * staffing * TRAFFIC.tripsPerWorkerPerDay;
    if (def.goodsSalesCapacityPerDay && salesCapacity > 0) {
      trips += ((sold * def.goodsSalesCapacityPerDay * staffing) / salesCapacity) * TRAFFIC.tripsPerGoodSold;
    }
    const road = layout.access.get(b.id);
    if (road == null) continue;
    roadTrips.set(road, (roadTrips.get(road) ?? 0) + trips);
    totalTrips += trips;
  }
  const roadLoad: Record<number, number> = {};
  const roadConnected: Record<number, boolean> = {};
  let weightedEfficiency = 0;
  let congestedSegments = 0;
  for (const r of city.roads) {
    const trips = roadTrips.get(r.id) ?? 0;
    const ratio = trips / ROADS[r.type].capacityTripsPerDay;
    roadLoad[r.id] = ratio;
    roadConnected[r.id] = layout.roadConnected.get(r.id) === true;
    weightedEfficiency += trips * segmentEfficiency(ratio);
    if (ratio > TRAFFIC.freeFlowRatio) congestedSegments++;
  }
  const trafficEfficiency = totalTrips > 0 ? weightedEfficiency / totalTrips : 1;

  // --- Production et comptes des entreprises ---------------------------------------------------
  let produced = 0, officeRevenue = 0, commercialWages = 0, industrialWages = 0;
  for (const b of ops) {
    const def = BUILDINGS[b.type];
    const wages = def.jobs * staffing * ECONOMY.wagePerWorker;
    produced += (def.goodsProductionPerDay ?? 0) * staffing * trafficEfficiency;
    if (def.officeRevenue) officeRevenue += def.jobs * staffing * ECONOMY.officeRevenuePerWorker * trafficEfficiency;
    if (def.category === 'commercial') commercialWages += wages;
    if (def.category === 'industrial') industrialWages += wages;
  }
  const localUsed = Math.min(sold, produced);
  const imported = sold - localUsed;
  const exported = produced - localUsed;
  const commercialProfit =
    sold * ECONOMY.retailPrice + officeRevenue -
    (localUsed * ECONOMY.localWholesalePrice + imported * ECONOMY.importGoodsPrice + commercialWages);
  const industrialProfit = localUsed * ECONOMY.localWholesalePrice + exported * ECONOMY.exportGoodsPrice - industrialWages;

  // --- Services publics : affectation gloutonne, du plus proche au plus lointain ----------------
  const served: Record<ServiceKind, Map<number, number>> = { health: new Map(), education: new Map(), safety: new Map() };
  const capacityByKind: Record<ServiceKind, number> = { health: 0, education: 0, safety: 0 };
  for (const b of ops) {
    const svc = BUILDINGS[b.type].service;
    if (!svc) continue;
    let remaining = svc.capacity * staffing * budgetEfficiency;
    capacityByKind[svc.kind] += remaining;
    const map = served[svc.kind];
    for (const resId of layout.serviceReach.get(b.id) ?? []) {
      if (remaining <= 0) break;
      const need = (residents.get(resId) ?? 0) - (map.get(resId) ?? 0);
      if (need <= 0) continue;
      const take = Math.min(need, remaining);
      map.set(resId, (map.get(resId) ?? 0) + take);
      remaining -= take;
    }
  }
  // Couverture par bâtiment résidentiel. Sans habitants, on mesure la couverture potentielle
  // (bâtiment à portée d'un service doté de personnel) pondérée par la capacité de logement.
  const reachable: Record<ServiceKind, Set<number>> = { health: new Set(), education: new Set(), safety: new Set() };
  for (const b of ops) {
    const svc = BUILDINGS[b.type].service;
    if (svc && staffing > 0) for (const id of layout.serviceReach.get(b.id) ?? []) reachable[svc.kind].add(id);
  }
  const residentialCoverage: Record<number, Record<ServiceKind, number>> = {};
  const covByKind: Record<ServiceKind, number> = { health: 0, education: 0, safety: 0 };
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
    pollutionSum += (layout.pollution.get(b.id) ?? 0) * w;
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
  for (const b of city.buildings) upkeep += BUILDINGS[b.type].upkeepPerDay;
  for (const r of city.roads) upkeep += segmentLength(r) * ROADS[r.type].upkeepPerMeterPerDay;
  const utilityImports =
    powerImported * 24 * ECONOMY.powerImportPricePerMWh + waterImported * ECONOMY.waterImportPricePerM3;
  const loanInterest = (city.debt * LOAN_ANNUAL_RATE) / DAYS_PER_YEAR;
  const residentialTax = city.taxes.residential * employed * ECONOMY.wagePerWorker;
  const commercialTax = city.taxes.commercial * Math.max(0, commercialProfit);
  const industrialTax = city.taxes.industrial * Math.max(0, industrialProfit);
  const net = residentialTax + commercialTax + industrialTax - upkeep - utilityImports - loanInterest;
  city.treasury += net * DT_DAYS;

  // --- Migrations -----------------------------------------------------------------------------
  const jobScore = workforce > 0 ? Math.min(1, jobs / workforce) : jobs > 0 ? 1 : 0;
  const serviceScore = meanCoverage;
  const attract = attractiveness({
    jobScore, serviceScore, residentialTax: city.taxes.residential, trafficEfficiency, pollution: pollutionExposure,
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
    goods: { demand: goodsDemand, sold, produced, imported, exported },
    services,
    serviceInequality,
    pollutionExposure,
    traffic: { trips: totalTrips, efficiency: trafficEfficiency, congestedSegments },
    budget: { residentialTax, commercialTax, industrialTax, upkeep, utilityImports, loanInterest, net },
  };

  return { buildingStatus, residentialCoverage, pollution, roadLoad, roadConnected };
}

/** Avance une ville de n ticks (rattrapage déterministe). */
export function simulateTicks(city: CityState, n: number): void {
  for (let i = 0; i < n; i++) simulateTick(city);
}
