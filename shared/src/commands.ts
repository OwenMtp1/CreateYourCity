// Commandes qui modifient une ville. Le serveur est l'autorité : il appelle applyCityCommand.
// Le client réutilise les mêmes validations pour l'aperçu de construction (retour immédiat).
import { BUILDINGS, ROADS, type BuildingType, type RoadType } from './catalog.ts';
import { CITY_SIZE_M, MAX_DEBT, MAX_TAX_RATE, ROAD_ACCESS_DISTANCE, ROAD_MAX_LENGTH, ROAD_MIN_LENGTH } from './constants.ts';
import { buildingRect, footprint, rectsOverlap, roadWidth, segmentLength, segmentRectDistance, type Segment } from './geometry.ts';
import { generateTerrain, rectTerrain, roadTerrain } from './terrain.ts';
import type { CityState, TaxRates } from './types.ts';

export type CityCommand =
  | { type: 'build'; building: BuildingType; x: number; y: number; rotation: 0 | 90 }
  | { type: 'buildRoad'; road: RoadType; x1: number; y1: number; x2: number; y2: number }
  | { type: 'demolish'; target: 'building' | 'road'; id: number }
  | { type: 'setTaxes'; taxes: TaxRates }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number };

export type ValidationResult = { ok: true; cost: number } | { ok: false; reason: string };

const round1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (v: number) => Math.round(v).toLocaleString('fr-FR');

export function validateBuilding(city: CityState, type: BuildingType, x: number, y: number, rotation: 0 | 90): ValidationResult {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'Type de bâtiment inconnu.' };
  if (![x, y].every(Number.isFinite)) return { ok: false, reason: 'Position invalide.' };
  const rect = footprint(type, x, y, rotation);
  if (rect.minX < 0 || rect.minY < 0 || rect.maxX > CITY_SIZE_M || rect.maxY > CITY_SIZE_M) {
    return { ok: false, reason: "Hors de l'espace constructible." };
  }
  const terrain = rectTerrain(generateTerrain(city.cityId), rect);
  if (terrain.water) return { ok: false, reason: "Impossible de construire sur l'eau." };
  if (city.buildings.some((b) => rectsOverlap(rect, buildingRect(b)))) {
    return { ok: false, reason: 'Chevauche un bâtiment existant.' };
  }
  let hasAccess = false;
  for (const r of city.roads) {
    const d = segmentRectDistance(r, rect) - roadWidth(r) / 2;
    if (d < 0) return { ok: false, reason: 'Chevauche une route.' };
    if (d <= ROAD_ACCESS_DISTANCE) hasAccess = true;
  }
  if (!hasAccess) return { ok: false, reason: `Aucune route à moins de ${ROAD_ACCESS_DISTANCE} m : construisez d'abord une route.` };
  const cost = Math.round(def.cost * terrain.multiplier);
  if (city.treasury < cost) return { ok: false, reason: `Fonds insuffisants (${fmt(cost)} cr requis).` };
  return { ok: true, cost };
}

export function validateRoad(city: CityState, type: RoadType, seg: Segment): ValidationResult {
  const def = ROADS[type];
  if (!def) return { ok: false, reason: 'Type de route inconnu.' };
  if (![seg.x1, seg.y1, seg.x2, seg.y2].every(Number.isFinite)) return { ok: false, reason: 'Tracé invalide.' };
  const inside = (v: number) => v >= 0 && v <= CITY_SIZE_M;
  if (![seg.x1, seg.y1, seg.x2, seg.y2].every(inside)) return { ok: false, reason: "Hors de l'espace constructible." };
  const len = segmentLength(seg);
  if (len < ROAD_MIN_LENGTH) return { ok: false, reason: `Route trop courte (min. ${ROAD_MIN_LENGTH} m).` };
  if (len > ROAD_MAX_LENGTH) return { ok: false, reason: `Tronçon trop long (max. ${ROAD_MAX_LENGTH} m).` };
  for (const b of city.buildings) {
    if (segmentRectDistance(seg, buildingRect(b)) < def.width / 2) return { ok: false, reason: 'Le tracé traverse un bâtiment.' };
  }
  const near = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) < 2;
  const duplicate = city.roads.some(
    (r) =>
      (near(r.x1, r.y1, seg.x1, seg.y1) && near(r.x2, r.y2, seg.x2, seg.y2)) ||
      (near(r.x1, r.y1, seg.x2, seg.y2) && near(r.x2, r.y2, seg.x1, seg.y1)),
  );
  if (duplicate) return { ok: false, reason: 'Cette route existe déjà.' };
  const terrain = roadTerrain(generateTerrain(city.cityId), seg);
  const cost = Math.round(terrain.weightedLength * def.costPerMeter);
  if (city.treasury < cost) return { ok: false, reason: `Fonds insuffisants (${fmt(cost)} cr requis).` };
  return { ok: true, cost };
}

export type CommandResult = { ok: true; cost: number } | { ok: false; reason: string };

/** Valide puis applique une commande sur l'état de la ville (mutation). */
export function applyCityCommand(city: CityState, cmd: CityCommand): CommandResult {
  switch (cmd.type) {
    case 'build': {
      const x = round1(cmd.x);
      const y = round1(cmd.y);
      const v = validateBuilding(city, cmd.building, x, y, cmd.rotation);
      if (!v.ok) return v;
      city.treasury -= v.cost;
      city.buildings.push({ id: city.nextEntityId++, type: cmd.building, x, y, rotation: cmd.rotation, builtAtTick: city.tick });
      city.layoutVersion++;
      return v;
    }
    case 'buildRoad': {
      const seg = { x1: round1(cmd.x1), y1: round1(cmd.y1), x2: round1(cmd.x2), y2: round1(cmd.y2) };
      const v = validateRoad(city, cmd.road, seg);
      if (!v.ok) return v;
      city.treasury -= v.cost;
      city.roads.push({ id: city.nextEntityId++, type: cmd.road, ...seg, builtAtTick: city.tick });
      city.layoutVersion++;
      return v;
    }
    case 'demolish': {
      const list: { id: number }[] = cmd.target === 'building' ? city.buildings : city.roads;
      const idx = list.findIndex((e) => e.id === cmd.id);
      if (idx < 0) return { ok: false, reason: 'Élément introuvable.' };
      list.splice(idx, 1);
      city.layoutVersion++;
      return { ok: true, cost: 0 };
    }
    case 'setTaxes': {
      const t = cmd.taxes;
      const valid = [t.residential, t.commercial, t.industrial].every((v) => Number.isFinite(v) && v >= 0 && v <= MAX_TAX_RATE);
      if (!valid) return { ok: false, reason: `Taux d'imposition entre 0 et ${MAX_TAX_RATE * 100} %.` };
      city.taxes = { residential: t.residential, commercial: t.commercial, industrial: t.industrial };
      return { ok: true, cost: 0 };
    }
    case 'borrow': {
      const amount = Math.floor(cmd.amount);
      if (!(amount > 0)) return { ok: false, reason: 'Montant invalide.' };
      if (city.debt + amount > MAX_DEBT) return { ok: false, reason: `Plafond d'endettement : ${fmt(MAX_DEBT)} cr.` };
      city.debt += amount;
      city.treasury += amount;
      return { ok: true, cost: 0 };
    }
    case 'repay': {
      const amount = Math.floor(cmd.amount);
      if (!(amount > 0)) return { ok: false, reason: 'Montant invalide.' };
      if (amount > city.debt) return { ok: false, reason: 'Le remboursement dépasse la dette.' };
      if (amount > city.treasury) return { ok: false, reason: 'Trésorerie insuffisante.' };
      city.debt -= amount;
      city.treasury -= amount;
      return { ok: true, cost: amount };
    }
  }
}
