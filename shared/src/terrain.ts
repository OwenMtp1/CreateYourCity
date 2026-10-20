// Terrain constructible déterministe dérivé de l'identifiant de la ville.
// Provisoire : il ne reproduit PAS le relief réel (voir docs/DECISIONS.md), il sert à donner
// des contraintes de placement (eau infranchissable sauf pont, collines plus chères).
import { CITY_SIZE_M, REGIONAL_ACCESS, TERRAIN_CELL_M } from './constants.ts';
import type { Rect, Segment } from './geometry.ts';
import { CITY_BY_ID } from './world.ts';

export const TerrainKind = { Land: 0, Hill: 1, Water: 2 } as const;
export type TerrainKind = (typeof TerrainKind)[keyof typeof TerrainKind];

export const TERRAIN_COST = {
  hillBuildingMultiplier: 1.4,
  hillRoadMultiplier: 1.6,
  bridgeMultiplier: 6,
} as const;

export interface Terrain {
  size: number; // nombre de cellules par côté
  cell: number;
  cells: Uint8Array;
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, Terrain>();

export function generateTerrain(cityId: string): Terrain {
  const cached = cache.get(cityId);
  if (cached) return cached;
  const rand = mulberry32(hashString(cityId));
  const size = Math.ceil(CITY_SIZE_M / TERRAIN_CELL_M);
  const cells = new Uint8Array(size * size);

  // Collines : bruit de valeur sur une grille grossière, interpolé.
  const g = 6;
  const coarse = Array.from({ length: (g + 1) * (g + 1) }, () => rand());
  const hillThreshold = 0.68 + rand() * 0.1;

  // Rivière nord → sud avec probabilité 0,55 ; lac avec probabilité 0,3.
  const hasRiver = rand() < 0.55;
  const riverX = 500 + rand() * 1000;
  const riverAmp = 80 + rand() * 200;
  const riverFreq = 0.002 + rand() * 0.003;
  const riverPhase = rand() * Math.PI * 2;
  const riverHalfWidth = 30 + rand() * 40;
  const hasLake = rand() < 0.3;
  const lake = { x: 300 + rand() * 1400, y: 300 + rand() * 1400, rx: 80 + rand() * 150, ry: 60 + rand() * 120 };

  const sea = seaBand(cityId);

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * TERRAIN_CELL_M;
      const y = (j + 0.5) * TERRAIN_CELL_M;
      const gx = (x / CITY_SIZE_M) * g;
      const gy = (y / CITY_SIZE_M) * g;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const at = (a: number, b: number) => coarse[Math.min(b, g) * (g + 1) + Math.min(a, g)] ?? 0;
      const n =
        at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) +
        at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      let kind: TerrainKind = n > hillThreshold ? TerrainKind.Hill : TerrainKind.Land;
      if (hasRiver && Math.abs(x - (riverX + riverAmp * Math.sin(y * riverFreq + riverPhase))) < riverHalfWidth) {
        kind = TerrainKind.Water;
      }
      if (hasLake && ((x - lake.x) / lake.rx) ** 2 + ((y - lake.y) / lake.ry) ** 2 < 1) kind = TerrainKind.Water;
      // Mer des villes côtières ; une digue porte la route nationale si la mer est à l'ouest.
      if (sea?.contains(x, y) && Math.abs(y - REGIONAL_ACCESS.y) > 45) kind = TerrainKind.Water;
      // L'accès régional reste toujours constructible.
      if (Math.hypot(x - REGIONAL_ACCESS.x, y - REGIONAL_ACCESS.y) < 200) kind = TerrainKind.Land;
      cells[j * size + i] = kind;
    }
  }
  const terrain = { size, cell: TERRAIN_CELL_M, cells };
  cache.set(cityId, terrain);
  return terrain;
}

export interface SeaBand {
  /** Direction de la mer sur la carte (unitaire, y vers le sud). */
  dx: number;
  dy: number;
  /** Distance du centre de la carte au rivage moyen, mesurée vers la mer. */
  shoreline: number;
  contains(x: number, y: number): boolean;
}

/**
 * Bande de mer le long du bord de la carte tourné vers la mer réelle : plus large quand la côte est proche
 * du centre-ville, avec un trait de côte ondulé. Renvoie null pour une ville continentale.
 */
export function seaBand(cityId: string): SeaBand | null {
  const coast = CITY_BY_ID.get(cityId)?.coast;
  if (!coast) return null;
  const rand = mulberry32(hashString(cityId) ^ 0x5ea5ea);
  const b = (coast.dir * Math.PI) / 180;
  const dx = Math.sin(b);
  const dy = -Math.cos(b); // le nord est en haut de la carte (y décroissant)
  const half = CITY_SIZE_M / 2;
  const width = Math.max(SEA.minWidth, Math.min(SEA.maxWidth, SEA.maxWidth - (coast.dist - 0.5) * 70));
  // Position du rivage telle que la mer couvre la même surface qu'une bande droite de `width` mètres,
  // quelle que soit l'orientation (une mer en diagonale occupe un coin de la carte).
  const target = width / CITY_SIZE_M;
  const n = 50;
  const seaShare = (s: number) => {
    let wet = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (((i + 0.5) / n - 0.5) * dx + ((j + 0.5) / n - 0.5) * dy > s / CITY_SIZE_M) wet++;
    }
    return wet / (n * n);
  };
  let lo = -half * 2, hi = half * 2;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (seaShare(mid) > target) lo = mid; else hi = mid;
  }
  const shoreline = (lo + hi) / 2;
  const waves = [0, 1, 2].map((k) => ({ amp: [45, 20, 8][k]!, freq: [0.003, 0.009, 0.025][k]! * (0.8 + rand() * 0.4), phase: rand() * Math.PI * 2 }));
  return {
    dx, dy, shoreline,
    contains(x, y) {
      const along = (x - half) * dx + (y - half) * dy;
      const across = (x - half) * -dy + (y - half) * dx;
      let edge = shoreline;
      for (const w of waves) edge += w.amp * Math.sin(across * w.freq + w.phase);
      return along > edge;
    },
  };
}

export const SEA = { minWidth: 160, maxWidth: 520 } as const;

export function terrainAt(t: Terrain, x: number, y: number): TerrainKind {
  const i = Math.min(t.size - 1, Math.max(0, Math.floor(x / t.cell)));
  const j = Math.min(t.size - 1, Math.max(0, Math.floor(y / t.cell)));
  return (t.cells[j * t.size + i] ?? TerrainKind.Land) as TerrainKind;
}

/** Terrain sous une emprise : bloqué si une cellule est de l'eau, multiplicateur si colline. */
export function rectTerrain(t: Terrain, r: Rect): { water: boolean; multiplier: number } {
  let water = false;
  let hill = false;
  const i0 = Math.max(0, Math.floor(r.minX / t.cell));
  const i1 = Math.min(t.size - 1, Math.floor((r.maxX - 1e-6) / t.cell));
  const j0 = Math.max(0, Math.floor(r.minY / t.cell));
  const j1 = Math.min(t.size - 1, Math.floor((r.maxY - 1e-6) / t.cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = t.cells[j * t.size + i];
      if (k === TerrainKind.Water) water = true;
      if (k === TerrainKind.Hill) hill = true;
    }
  }
  return { water, multiplier: hill ? TERRAIN_COST.hillBuildingMultiplier : 1 };
}

/** Longueur pondérée d'un tracé de route (pont sur l'eau, surcoût en colline). */
export function roadTerrain(t: Terrain, s: Segment): { weightedLength: number; bridgeLength: number } {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const steps = Math.max(1, Math.ceil(len / 5));
  let weighted = 0;
  let bridge = 0;
  for (let k = 0; k < steps; k++) {
    const f = (k + 0.5) / steps;
    const kind = terrainAt(t, s.x1 + (s.x2 - s.x1) * f, s.y1 + (s.y2 - s.y1) * f);
    const part = len / steps;
    if (kind === TerrainKind.Water) {
      weighted += part * TERRAIN_COST.bridgeMultiplier;
      bridge += part;
    } else {
      weighted += part * (kind === TerrainKind.Hill ? TERRAIN_COST.hillRoadMultiplier : 1);
    }
  }
  return { weightedLength: weighted, bridgeLength: bridge };
}
