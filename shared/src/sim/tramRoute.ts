// Tracé d'une voie de tram entre deux stations : contourne les bâtiments, jamais à travers eux.
import { CITY_SIZE_M } from '../constants.ts';
import type { Point, Rect } from '../geometry.ts';

/** Taille d'une cellule de la grille de recherche (mètres). */
export const TRAM_GRID_M = 10;
/** Distance minimale entre la voie et un bâtiment (mètres). */
export const TRAM_CLEARANCE_M = 1;

/**
 * Plus court chemin sur une grille (4 directions) entre deux points, en évitant les rectangles d'obstacles
 * (élargis de TRAM_CLEARANCE_M). Renvoie la polyligne de départ à arrivée, ou null si aucun tracé n'existe.
 */
export function tramPath(from: Point, to: Point, obstacles: Rect[], size = CITY_SIZE_M): Point[] | null {
  const n = Math.ceil(size / TRAM_GRID_M);
  const idx = (i: number, j: number) => j * n + i;
  const cellOf = (p: Point) => ({
    i: Math.min(n - 1, Math.max(0, Math.floor(p.x / TRAM_GRID_M))),
    j: Math.min(n - 1, Math.max(0, Math.floor(p.y / TRAM_GRID_M))),
  });
  const blocked = new Uint8Array(n * n);
  for (const r of obstacles) {
    const m = TRAM_CLEARANCE_M;
    const i0 = Math.max(0, Math.floor((r.minX - m) / TRAM_GRID_M)), i1 = Math.min(n - 1, Math.floor((r.maxX + m) / TRAM_GRID_M));
    const j0 = Math.max(0, Math.floor((r.minY - m) / TRAM_GRID_M)), j1 = Math.min(n - 1, Math.floor((r.maxY + m) / TRAM_GRID_M));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx0 = i * TRAM_GRID_M, cx1 = cx0 + TRAM_GRID_M, cy0 = j * TRAM_GRID_M, cy1 = cy0 + TRAM_GRID_M;
      if (cx0 < r.maxX + m && cx1 > r.minX - m && cy0 < r.maxY + m && cy1 > r.minY - m) blocked[idx(i, j)] = 1;
    }
  }
  const start = cellOf(from), goal = cellOf(to);
  blocked[idx(start.i, start.j)] = 0;
  blocked[idx(goal.i, goal.j)] = 0;

  // A* avec file de priorité binaire (distance de Manhattan, admissible sur grille 4 directions).
  const g = new Float64Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const heap: { f: number; k: number }[] = [];
  const push = (f: number, k: number) => {
    heap.push({ f, k });
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p]!.f <= heap[c]!.f) break;
      [heap[p], heap[c]] = [heap[c]!, heap[p]!];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let s = c;
        if (l < heap.length && heap[l]!.f < heap[s]!.f) s = l;
        if (r < heap.length && heap[r]!.f < heap[s]!.f) s = r;
        if (s === c) break;
        [heap[s], heap[c]] = [heap[c]!, heap[s]!];
        c = s;
      }
    }
    return top;
  };
  const h = (i: number, j: number) => Math.abs(i - goal.i) + Math.abs(j - goal.j);
  const s0 = idx(start.i, start.j), target = idx(goal.i, goal.j);
  g[s0] = 0;
  push(h(start.i, start.j), s0);
  while (heap.length) {
    const { k } = pop();
    if (k === target) break;
    const i = k % n, j = Math.floor(k / n);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nk = idx(ni, nj);
      if (blocked[nk]) continue;
      const ng = g[k]! + 1;
      if (ng < g[nk]!) {
        g[nk] = ng;
        prev[nk] = k;
        push(ng + h(ni, nj), nk);
      }
    }
  }
  if (prev[target] === -1 && target !== s0) return null;

  const cells: Point[] = [];
  for (let k = target; k !== -1; k = prev[k]!) {
    cells.push({ x: ((k % n) + 0.5) * TRAM_GRID_M, y: (Math.floor(k / n) + 0.5) * TRAM_GRID_M });
    if (k === s0) break;
  }
  cells.reverse();
  // Points exacts des stations aux extrémités, puis suppression des points alignés.
  const pts = [from, ...cells.slice(1, -1), to];
  const out: Point[] = [pts[0]!];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = out[out.length - 1]!, b = pts[k]!, c = pts[k + 1]!;
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}
