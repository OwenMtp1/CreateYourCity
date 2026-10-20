// Ajoute à chaque ville de shared/data/cities.json la direction de la mer quand elle est proche
// (trait de côte Natural Earth 1:10m via world-atlas, sans accès réseau).
// Usage : node scripts/build-coasts.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
const topo = JSON.parse(await readFile(require.resolve('world-atlas/land-10m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);
// Trait de côte : les arcs de la couche « terres » sont exactement les limites terre / mer.
const coast = mesh(topo, topo.objects.land);

const RANGE_KM = 8; // au-delà, la ville est considérée comme continentale
const DIRS = 16;
const STEP_KM = 0.25;
const CELL_DEG = 0.25;

// Index spatial des segments de côte par cellule de 0,25°.
const grid = new Map();
const key = (i, j) => `${i},${j}`;
for (const line of coast.coordinates) {
  for (let k = 1; k < line.length; k++) {
    const [a, b] = [line[k - 1], line[k]];
    if (Math.abs(a[0] - b[0]) > 180) continue; // antiméridien
    const i0 = Math.floor(Math.min(a[0], b[0]) / CELL_DEG), i1 = Math.floor(Math.max(a[0], b[0]) / CELL_DEG);
    const j0 = Math.floor(Math.min(a[1], b[1]) / CELL_DEG), j1 = Math.floor(Math.max(a[1], b[1]) / CELL_DEG);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const c = grid.get(key(i, j));
      if (c) c.push([a, b]); else grid.set(key(i, j), [[a, b]]);
    }
  }
}

// Polygones de terres avec leur emprise, pour le test « la ville est-elle sur la terre ? ».
const geoms = land.type === 'FeatureCollection' ? land.features.map((f) => f.geometry) : [land.geometry];
const polys = geoms.flatMap((g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)).map((rings) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY, f: { type: 'Polygon', coordinates: rings } };
});
const onLand = (lon, lat) => polys.some((p) => lon >= p.minX && lon <= p.maxX && lat >= p.minY && lat <= p.maxY && geoContains(p.f, [lon, lat]));

// Paramètre t (0..1) du point où le rayon (0,0)→(px,py) coupe le segment, ou -1.
const hit = (px, py, cx, cy, dx, dy) => {
  const d = px * (dy - cy) - py * (dx - cx);
  if (d === 0) return -1;
  const t = (cx * (dy - cy) - cy * (dx - cx)) / d;
  const u = (cx * py - cy * px) / d;
  return t > 0 && t <= 1 && u >= 0 && u < 1 ? t : -1;
};
const segDist = (x1, y1, x2, y2) => {
  const l = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  const t = l ? Math.max(0, Math.min(1, -(x1 * (x2 - x1) + y1 * (y2 - y1)) / l)) : 0;
  return Math.hypot(x1 + t * (x2 - x1), y1 + t * (y2 - y1));
};

function coastOf(city) {
  if (Math.abs(city.lat) > 80) return null; // pôles : projection locale dégénérée
  const kx = 111.32 * Math.cos((city.lat * Math.PI) / 180);
  const ky = 110.57;
  const rx = RANGE_KM / kx / CELL_DEG + 1, ry = RANGE_KM / ky / CELL_DEG + 1;
  const ci = Math.floor(city.lon / CELL_DEG), cj = Math.floor(city.lat / CELL_DEG);
  // Segments à moins de RANGE_KM, en kilomètres autour de la ville (x vers l'est, y vers le nord).
  const segs = [];
  const seen = new Set();
  for (let i = Math.floor(ci - rx); i <= Math.ceil(ci + rx); i++) for (let j = Math.floor(cj - ry); j <= Math.ceil(cj + ry); j++) {
    for (const s of grid.get(key(i, j)) ?? []) {
      // Un même segment peut figurer dans deux arcs : compté deux fois, il fausserait la parité.
      const id = [s[0], s[1]].map((p) => p.join(',')).sort().join(';');
      if (seen.has(id)) continue;
      seen.add(id);
      const q = [(s[0][0] - city.lon) * kx, (s[0][1] - city.lat) * ky, (s[1][0] - city.lon) * kx, (s[1][1] - city.lat) * ky];
      if (segDist(...q) <= RANGE_KM) segs.push(q);
    }
  }
  if (!segs.length) return null;
  // Parité des traversées de côte entre la ville et chaque point échantillonné.
  const startLand = onLand(city.lon, city.lat);
  const steps = Math.round(RANGE_KM / STEP_KM);
  const sea = []; // sea[d][k] : mer dans la direction d à (k + 1) pas
  let nearest = Infinity;
  for (let d = 0; d < DIRS; d++) {
    const b = (d / DIRS) * Math.PI * 2; // azimut, 0 = nord
    const px = Math.sin(b) * RANGE_KM, py = Math.cos(b) * RANGE_KM;
    const ts = [];
    for (const s of segs) { const t = hit(px, py, s[0], s[1], s[2], s[3]); if (t >= 0) ts.push(t * RANGE_KM); }
    ts.sort((a, c) => a - c);
    const row = [];
    let n = 0;
    for (let k = 1; k <= steps; k++) {
      const r = k * STEP_KM;
      while (n < ts.length && ts[n] <= r) n++;
      const isSea = (n % 2 === 1) === startLand;
      row.push(isSea);
      if (isSea) nearest = Math.min(nearest, r);
    }
    sea.push(row);
  }
  if (nearest > RANGE_KM) return null;
  // Direction de la mer : moyenne des directions pondérée par la proximité de l'eau.
  let sx = 0, sy = 0, wet = 0;
  for (let d = 0; d < DIRS; d++) {
    const b = (d / DIRS) * Math.PI * 2;
    let w = 0;
    sea[d].forEach((s, k) => { if (s) w += 1 / ((k + 1) * STEP_KM); });
    sx += Math.sin(b) * w; sy += Math.cos(b) * w;
    if (sea[d].some((s, k) => s && (k + 1) * STEP_KM <= nearest + 3)) wet++;
  }
  // Ville sur une île ou une presqu'île étroite : la mer entoure, pas de côté dominant.
  if (Math.hypot(sx, sy) < 1e-6) return null;
  const dir = Math.round(((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360);
  return { dir, dist: Math.round(nearest * 4) / 4, spread: wet };
}

const cities = JSON.parse(await readFile('shared/data/cities.json', 'utf8'));
let coastal = 0;
for (const c of cities) {
  const r = coastOf(c);
  delete c.coast;
  if (!r) continue;
  // Mer ouverte sur au moins deux directions voisines : on écarte les simples criques et les erreurs de tracé.
  if (r.spread < 2) continue;
  c.coast = { dir: r.dir, dist: r.dist };
  coastal++;
}
await writeFile('shared/data/cities.json', JSON.stringify(cities));
console.log(`${coastal} villes côtières sur ${cities.length}`);
