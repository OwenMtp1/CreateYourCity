// Commandes qui modifient une ville. Le serveur est l'autorité : il appelle applyCityCommand.
// Le client réutilise les mêmes validations pour l'aperçu de construction (retour immédiat).
import { BUILDINGS, ROADS, type BuildingType, type RoadType } from './catalog.ts';
import { CITY_SIZE_M, MAX_DEBT, MAX_TAX_RATE, PARKING, ROAD_ACCESS_DISTANCE, ROAD_MAX_LENGTH, ROAD_MIN_LENGTH } from './constants.ts';
import { buildingRect, footprint, rectsOverlap, roadWidth, segmentLength, segmentRectDistance, type Segment } from './geometry.ts';
import { generateTerrain, rectTerrain, roadTerrain, terrainAt, TerrainKind } from './terrain.ts';
import type { CityState, TaxRates } from './types.ts';

export type CityCommand =
  | { type: 'build'; building: BuildingType; x: number; y: number; rotation: 0 | 90 }
  | { type: 'buildRoad'; road: RoadType; x1: number; y1: number; x2: number; y2: number }
  /** Tracé à plusieurs tronçons (courbe, rond-point) : construit entièrement ou pas du tout. */
  | { type: 'buildRoadPath'; road: RoadType; points: { x: number; y: number }[] }
  | { type: 'demolish'; target: 'building' | 'road'; id: number }
  | { type: 'setTaxes'; taxes: TaxRates }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  /** Tarif d'un parking (0 : gratuit). */
  | { type: 'setParkingFee'; id: number; fee: number };

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
  if (def.needsWater && !waterNearby(city.cityId, rect, 40)) return { ok: false, reason: "Un port doit être construit à moins de 40 m de l'eau." };
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

/** Présence d'eau à moins de `margin` mètres d'une emprise (échantillonnage tous les 10 m). */
export function waterNearby(cityId: string, rect: { minX: number; minY: number; maxX: number; maxY: number }, margin: number): boolean {
  const t = generateTerrain(cityId);
  for (let x = rect.minX - margin; x <= rect.maxX + margin; x += 10) {
    for (let y = rect.minY - margin; y <= rect.maxY + margin; y += 10) {
      if (x < 0 || y < 0 || x > CITY_SIZE_M || y > CITY_SIZE_M) continue;
      if (terrainAt(t, x, y) === TerrainKind.Water) return true;
    }
  }
  return false;
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

export const MAX_PATH_POINTS = 48;

/** Valide un tracé multi-tronçons sur une copie de la ville (les tronçons se suivent). */
export function validateRoadPath(
  city: CityState, type: RoadType, points: { x: number; y: number }[],
): { ok: true; cost: number; segments: Segment[] } | { ok: false; reason: string } {
  if (points.length < 2 || points.length > MAX_PATH_POINTS) return { ok: false, reason: `Tracé de 2 à ${MAX_PATH_POINTS} points.` };
  const draft: CityState = { ...city, roads: [...city.roads] };
  let cost = 0;
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const seg = { x1: round1(a.x), y1: round1(a.y), x2: round1(b.x), y2: round1(b.y) };
    const v = validateRoad({ ...draft, treasury: Infinity }, type, seg);
    if (!v.ok) return { ok: false, reason: `Tronçon ${i + 1} : ${v.reason}` };
    cost += v.cost;
    segments.push(seg);
    draft.roads.push({ id: -1 - i, type, ...seg, builtAtTick: city.tick });
  }
  if (city.treasury < cost) return { ok: false, reason: `Fonds insuffisants (${fmt(cost)} cr requis).` };
  return { ok: true, cost, segments };
}

/** Points d'une courbe de Bézier quadratique (un point tous les ~25 m, tronçons ≥ 10 m). */
export function curvePoints(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }) {
  const approx = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
  const n = Math.max(2, Math.min(MAX_PATH_POINTS - 1, Math.round(approx / 25)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return { x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y };
  });
}

/** Points d'un rond-point (polygone fermé à 12 côtés). */
export function roundaboutPoints(center: { x: number; y: number }, radius: number) {
  return Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
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
    case 'buildRoadPath': {
      const v = validateRoadPath(city, cmd.road, cmd.points);
      if (!v.ok) return v;
      city.treasury -= v.cost;
      for (const seg of v.segments) city.roads.push({ id: city.nextEntityId++, type: cmd.road, ...seg, builtAtTick: city.tick });
      city.layoutVersion++;
      return { ok: true, cost: v.cost };
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
    case 'setParkingFee': {
      const b = city.buildings.find((x) => x.id === cmd.id);
      if (!b || !BUILDINGS[b.type].parking) return { ok: false, reason: 'Parking introuvable.' };
      if (!Number.isFinite(cmd.fee) || cmd.fee < 0 || cmd.fee > PARKING.maxFee) {
        return { ok: false, reason: `Tarif entre 0 et ${PARKING.maxFee} cr.` };
      }
      const fee = Math.round(cmd.fee * 10) / 10;
      if (fee > 0) b.fee = fee;
      else delete b.fee;
      return { ok: true, cost: 0 };
    }
  }
}
