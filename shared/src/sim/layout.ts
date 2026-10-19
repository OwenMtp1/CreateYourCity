// Analyse géométrique de l'agencement d'une ville : raccordement des routes, desserte des
// bâtiments, zones de service et pollution. Recalculée seulement quand layoutVersion change.
import { BUILDINGS } from '../catalog.ts';
import { REGIONAL_ACCESS, ROAD_ACCESS_DISTANCE, ROAD_JOIN_TOLERANCE } from '../constants.ts';
import { buildingRect, pointSegmentDistance, rectDistance, roadWidth, segmentDistance, segmentRectDistance } from '../geometry.ts';
import type { BuildingStatus, CityState } from '../types.ts';

export interface CityLayout {
  key: string;
  roadConnected: Map<number, boolean>;
  /** Route desservant chaque bâtiment (null si aucune à portée). */
  access: Map<number, number | null>;
  status: Map<number, BuildingStatus>;
  /** Pour chaque bâtiment de service : bâtiments résidentiels à portée, du plus proche au plus lointain. */
  serviceReach: Map<number, number[]>;
  /** Exposition à la pollution (0..1) de chaque bâtiment résidentiel. */
  pollution: Map<number, number>;
}

function find(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]!]!;
    i = parent[i]!;
  }
  return i;
}

export function analyzeLayout(city: CityState): CityLayout {
  const { roads, buildings } = city;
  const parent = roads.map((_, i) => i);
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      if (segmentDistance(roads[i]!, roads[j]!) <= ROAD_JOIN_TOLERANCE) {
        parent[find(parent, i)] = find(parent, j);
      }
    }
  }
  const entryRoots = new Set<number>();
  roads.forEach((r, i) => {
    if (pointSegmentDistance(REGIONAL_ACCESS, r) <= roadWidth(r) / 2 + 5) entryRoots.add(find(parent, i));
  });
  const roadConnected = new Map<number, boolean>();
  roads.forEach((r, i) => roadConnected.set(r.id, entryRoots.has(find(parent, i))));

  const access = new Map<number, number | null>();
  const status = new Map<number, BuildingStatus>();
  for (const b of buildings) {
    const rect = buildingRect(b);
    let best: number | null = null;
    let bestDist = Infinity;
    let bestConnected = false;
    for (const r of roads) {
      const d = segmentRectDistance(r, rect) - roadWidth(r) / 2;
      if (d > ROAD_ACCESS_DISTANCE) continue;
      const connected = roadConnected.get(r.id) === true;
      // Une route raccordée est toujours préférée à une route isolée.
      if ((connected && !bestConnected) || (connected === bestConnected && d < bestDist)) {
        best = r.id;
        bestDist = d;
        bestConnected = connected;
      }
    }
    access.set(b.id, best);
    status.set(b.id, best === null ? 'no_road' : bestConnected ? 'ok' : 'disconnected');
  }

  const residential = buildings.filter((b) => BUILDINGS[b.type].category === 'residential' && status.get(b.id) === 'ok');
  const serviceReach = new Map<number, number[]>();
  const pollution = new Map<number, number>(residential.map((r) => [r.id, 0]));
  for (const s of buildings) {
    const def = BUILDINGS[s.type];
    if (status.get(s.id) !== 'ok') continue;
    const srect = buildingRect(s);
    if (def.service) {
      const radius = def.service.radius;
      const reach = residential
        .map((r) => ({ id: r.id, d: rectDistance(srect, buildingRect(r)) }))
        .filter((e) => e.d <= radius)
        .sort((a, b) => a.d - b.d || a.id - b.id)
        .map((e) => e.id);
      serviceReach.set(s.id, reach);
    }
    if (def.pollution) {
      for (const r of residential) {
        const d = rectDistance(srect, buildingRect(r));
        if (d < def.pollution.radius) {
          pollution.set(r.id, Math.min(1, (pollution.get(r.id) ?? 0) + def.pollution.intensity * (1 - d / def.pollution.radius)));
        }
      }
    }
  }

  return { key: `${city.cityId}:${city.layoutVersion}`, roadConnected, access, status, serviceReach, pollution };
}

const layoutCache = new WeakMap<CityState, CityLayout>();

/** Analyse mise en cache par objet ville et version d'agencement. */
export function getLayout(city: CityState): CityLayout {
  const key = `${city.cityId}:${city.layoutVersion}`;
  let layout = layoutCache.get(city);
  if (!layout || layout.key !== key) {
    layout = analyzeLayout(city);
    layoutCache.set(city, layout);
  }
  return layout;
}
