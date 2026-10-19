// Conseillers municipaux : règles fixes et chiffrées (aucune IA), dérivées des statistiques du
// dernier tick et de l'agencement. Chaque conseil indique quoi construire ou modifier.
import { BUILDINGS, type BuildingType, type ServiceKind } from '../catalog.ts';
import { ECONOMY } from '../constants.ts';
import { buildingRect, rectCenter } from '../geometry.ts';
import type { CityLayers, CityState } from '../types.ts';

export type AdviceSeverity = 'critical' | 'warning' | 'info';

export interface Advice {
  id: string;
  severity: AdviceSeverity;
  title: string;
  detail: string;
  /** Construction suggérée (sélectionnable directement dans l'interface). */
  build?: BuildingType;
  /** Bâtiment concerné (pour le localiser). */
  buildingId?: number;
}

const SERVICE_BUILDING: Record<ServiceKind, BuildingType> = { health: 'clinic', education: 'school', safety: 'police', leisure: 'park' };
const SERVICE_NAME: Record<ServiceKind, string> = { health: 'santé', education: 'éducation', safety: 'sécurité', leisure: 'loisirs' };
const fmt = (v: number) => Math.round(v).toLocaleString('fr-FR');
const pct = (v: number) => `${Math.round(v * 100)} %`;
const RANK: Record<AdviceSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Position d'un bâtiment par rapport au centre de la ville bâtie (« de l'est », « du centre »…). */
function quarter(city: CityState, id: number): string {
  const b = city.buildings.find((x) => x.id === id);
  if (!b || city.buildings.length < 3) return '';
  let cx = 0, cy = 0;
  for (const x of city.buildings) { cx += x.x; cy += x.y; }
  cx /= city.buildings.length;
  cy /= city.buildings.length;
  const c = rectCenter(buildingRect(b));
  const dx = c.x - cx, dy = c.y - cy;
  if (Math.hypot(dx, dy) < 120) return ' du centre';
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? " de l'est" : " de l'ouest";
  return dy > 0 ? ' du sud' : ' du nord';
}

export function adviseCity(city: CityState, layers: CityLayers | null): Advice[] {
  const out: Advice[] = [];
  const s = city.stats;
  const add = (a: Advice) => out.push(a);

  if (city.roads.length === 0) {
    add({ id: 'no-road', severity: 'critical', title: 'Aucune route', detail: "Tracez une rue depuis le portique jaune (accès régional, bord ouest) : rien ne fonctionne sans route raccordée." });
  }
  if (layers) {
    const broken = city.buildings.filter((b) => layers.buildingStatus[b.id] && layers.buildingStatus[b.id] !== 'ok');
    if (broken.length) {
      add({ id: 'broken', severity: 'critical', title: `${broken.length} bâtiment(s) hors service`, detail: "Ils n'ont pas de route à moins de 12 m ou leur route n'est pas reliée à l'accès régional. Couche « Raccordement » pour les repérer.", buildingId: broken[0]!.id });
    }
  }
  if (!s) return out;

  if (city.treasury < 0) {
    add({ id: 'bankrupt', severity: 'critical', title: 'Trésorerie négative', detail: `Services publics à 60 % et construction impossible. Empruntez, augmentez les impôts ou démolissez des équipements coûteux.` });
  }
  if (s.budget.net < 0) {
    const days = city.treasury > 0 ? city.treasury / -s.budget.net : 0;
    const biggest = s.budget.upkeep >= s.budget.utilityImports ? "l'entretien des équipements" : "les importations d'électricité et d'eau";
    add({ id: 'deficit', severity: days < 10 ? 'warning' : 'info', title: `Déficit de ${fmt(-s.budget.net)} cr/jour`, detail: `Principal poste : ${biggest}. ${city.treasury > 0 ? `Trésorerie épuisée dans ~${Math.round(days)} jours.` : ''} Des emplois et des habitants supplémentaires augmentent les recettes.` });
  }
  if (s.housingCapacity === 0 && city.roads.length > 0) {
    add({ id: 'no-housing', severity: 'warning', title: 'Aucun logement', detail: 'Construisez des maisons ou des immeubles le long de la route pour attirer des habitants.', build: 'house' });
  }
  const unemployed = s.workforce - s.employed;
  if (s.workforce > 20 && s.unemploymentRate > 0.15) {
    add({ id: 'unemployment', severity: s.unemploymentRate > 0.3 ? 'warning' : 'info', title: `Chômage à ${pct(s.unemploymentRate)}`, detail: `${fmt(unemployed)} actifs sans emploi : il manque ~${fmt(unemployed)} emplois. Un immeuble de bureaux en offre 100, une usine 30, un commerce 12.`, build: 'office' });
  }
  if (s.jobs > 20 && s.staffingRatio < 0.7) {
    add({ id: 'vacancies', severity: 'warning', title: `${fmt(s.jobs - s.employed)} postes vacants`, detail: `Seulement ${pct(s.staffingRatio)} des postes sont pourvus : la production et les services tournent au ralenti. Construisez des logements (un immeuble = 120 logements).`, build: 'apartment' });
  }
  if (s.housingCapacity > 0 && city.population >= 0.95 * s.housingCapacity && s.targetPopulation >= 0.9 * s.housingCapacity) {
    add({ id: 'housing-full', severity: 'info', title: 'Logements complets', detail: 'La ville attire plus de monde qu\'elle ne peut loger : de nouveaux logements augmenteront population et recettes.', build: 'apartment' });
  }
  if (city.population > 150) {
    for (const kind of ['health', 'education', 'safety', 'leisure'] as const) {
      const cov = s.services[kind].coverage;
      if (cov < 0.6) {
        add({ id: `cover-${kind}`, severity: kind === 'leisure' ? 'info' : 'warning', title: `Couverture ${SERVICE_NAME[kind]} : ${pct(cov)}`, detail: `~${fmt(city.population * (1 - cov))} habitants non couverts. Construisez : ${BUILDINGS[SERVICE_BUILDING[kind]].label.toLowerCase()} près des quartiers concernés.`, build: SERVICE_BUILDING[kind] });
      }
    }
  }
  if (layers) {
    for (const b of city.buildings) {
      const load = layers.serviceLoad[b.id];
      const svc = BUILDINGS[b.type].service;
      if (svc && load !== undefined && load >= 0.98 && city.population > 150) {
        add({ id: `saturated-${b.id}`, severity: 'warning', title: `${BUILDINGS[b.type].label}${quarter(city, b.id)} saturé(e)`, detail: `Capacité de ${fmt(svc.capacity)} habitants atteinte : ajoutez un équipement à proximité.`, build: b.type, buildingId: b.id });
      }
    }
  }
  if (s.traffic.efficiency < 0.85) {
    add({ id: 'traffic', severity: s.traffic.efficiency < 0.65 ? 'warning' : 'info', title: `Embouteillages : fluidité ${pct(s.traffic.efficiency)}`, detail: `${s.traffic.congestedSegments} tronçon(s) saturé(s) (couche « Trafic »). Doublez les axes, remplacez des rues par des avenues ou créez des transports en commun (2 stations minimum).`, build: s.transit.capacity > 0 ? 'tram_station' : 'bus_station' });
  }
  if (s.pollutionExposure > 0.2) {
    add({ id: 'pollution', severity: 'warning', title: `Pollution : ${pct(s.pollutionExposure)} d'exposition`, detail: 'Éloignez les logements des usines et centrales (rayon 300–350 m) ou plantez des parcs ; la loi nationale sur l\'environnement la réduit de 40 %.', build: 'park' });
  }
  const powerImportCost = s.power.importedMW * 24 * ECONOMY.powerImportPricePerMWh;
  if (powerImportCost > BUILDINGS.power_plant.upkeepPerDay * 1.5) {
    add({ id: 'power', severity: 'info', title: `Électricité importée : ${fmt(powerImportCost)} cr/jour`, detail: `Une centrale (15 MW, entretien ${fmt(BUILDINGS.power_plant.upkeepPerDay)} cr/j) serait rentable.`, build: 'power_plant' });
  }
  const waterImportCost = s.water.importedM3 * ECONOMY.waterImportPricePerM3;
  if (waterImportCost > BUILDINGS.water_tower.upkeepPerDay * 1.5) {
    add({ id: 'water', severity: 'info', title: `Eau importée : ${fmt(waterImportCost)} cr/jour`, detail: `Un château d'eau (2 000 m³/j, entretien ${fmt(BUILDINGS.water_tower.upkeepPerDay)} cr/j) serait rentable.`, build: 'water_tower' });
  }
  if (s.goods.imported > 150 && s.goods.importPrice > 16) {
    add({ id: 'goods', severity: 'info', title: `${fmt(s.goods.imported)} biens importés par jour`, detail: `Le marché est cher (${s.goods.importPrice.toFixed(1)} cr) : une usine (400 biens/j) ou un contrat avec un joueur réduirait les coûts des commerces.`, build: 'factory' });
  }
  if (s.goods.demand > s.goods.sold * 1.2 && s.goods.demand > 20) {
    add({ id: 'shops', severity: 'info', title: 'Commerces insuffisants', detail: `Les habitants veulent ${fmt(s.goods.demand)} biens/j mais les commerces n'en vendent que ${fmt(s.goods.sold)}.`, build: 'shop' });
  }
  if (city.taxes.residential > 0.15) {
    add({ id: 'tax', severity: 'info', title: `Impôt sur le revenu élevé (${pct(city.taxes.residential)})`, detail: "Au-delà de 8 %, chaque point réduit l'attractivité de la ville." });
  }
  if (city.debt > 0 && city.treasury > city.debt * 1.5 && s.budget.net > 0) {
    add({ id: 'repay', severity: 'info', title: 'Vous pouvez rembourser la dette', detail: `Rembourser ${fmt(city.debt)} cr économiserait ${fmt(s.budget.loanInterest)} cr d'intérêts par jour.` });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
