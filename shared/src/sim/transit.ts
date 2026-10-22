// Lignes de bus : chaque ligne suit le réseau routier entre ses stations (plus court chemin en temps).
// Le tracé dépend donc de l'emplacement des stations et des routes existantes.
import { buildingRect, closestPointOnSegment, pointSegmentDistance, segmentRectDistance, type Point } from '../geometry.ts';
import type { Routing } from './routing.ts';
import type { Building } from '../types.ts';

export interface TransitRoute {
  /** Tracé complet, de station en station, sur les routes. */
  points: Point[];
}

/** Distance maximale entre un logement et le tracé d'une ligne de bus pour qu'il soit desservi. */
export const BUS_ROUTE_RADIUS = 300;

interface Attach { edge: number; point: Point; nodes: [number, number]; costs: [number, number] }

export function busRoutes(routing: Routing, stations: Building[], speedOf: (roadId: number) => number, stationPoint: (b: Building) => Point): TransitRoute[] {
  const { nodes, edges } = routing;
  if (stations.length < 2 || edges.length === 0) return [];
  // Graphe : arcs pondérés par le temps de parcours.
  const adj: { to: number; cost: number }[][] = nodes.map(() => []);
  for (const e of edges) {
    const cost = e.length / speedOf(e.roadId);
    adj[e.a]!.push({ to: e.b, cost });
    adj[e.b]!.push({ to: e.a, cost });
  }
  // Accroche de chaque station à l'arête la plus proche.
  const attach = (b: Building): Attach | null => {
    const p = stationPoint(b);
    let best: Attach | null = null;
    let bestD = Infinity;
    for (const e of edges) {
      const seg = { x1: e.ax, y1: e.ay, x2: e.bx, y2: e.by };
      const d = pointSegmentDistance(p, seg);
      if (d < bestD) {
        bestD = d;
        const q = closestPointOnSegment(p, seg);
        const toA = Math.hypot(q.x - e.ax, q.y - e.ay);
        const toB = Math.hypot(q.x - e.bx, q.y - e.by);
        best = { edge: e.id, point: q, nodes: [e.a, e.b], costs: [toA / speedOf(e.roadId), toB / speedOf(e.roadId)] };
      }
    }
    return best;
  };
  // Plus court chemin (Dijkstra simple) depuis un ensemble de nœuds initiaux.
  const shortest = (sources: [number, number], costs: [number, number]) => {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const done = new Uint8Array(nodes.length);
    sources.forEach((n, i) => { if (costs[i]! < dist[n]!) { dist[n] = costs[i]!; } });
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
      if (u < 0) break;
      done[u] = 1;
      for (const { to, cost } of adj[u]!) {
        if (dist[u]! + cost < dist[to]!) { dist[to] = dist[u]! + cost; prev[to] = u; }
      }
    }
    return { dist, prev };
  };
  const pathNodes = (prev: Int32Array, target: number): number[] => {
    const out = [target];
    while (prev[out[0]!]! >= 0) out.unshift(prev[out[0]!]!);
    return out;
  };

  // Ordre des stations : chaîne du plus proche voisin, depuis la plus à l'ouest (comme les autres modes).
  const ordered = [...stations].sort((a, b) => a.x - b.x);
  const chain = [ordered.shift()!];
  while (ordered.length) {
    const last = chain.at(-1)!;
    ordered.sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y));
    chain.push(ordered.shift()!);
  }
  const attached = chain.map((b) => attach(b));
  const routes: TransitRoute[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const from = attached[i], to = attached[i + 1];
    if (!from || !to) continue;
    const { dist, prev } = shortest(from.nodes, from.costs);
    // Arrivée : meilleure extrémité de l'arête de la station suivante.
    const [a, b] = to.nodes;
    const viaA = dist[a]! + to.costs[0], viaB = dist[b]! + to.costs[1];
    const ends = viaA <= viaB ? a : b;
    if (!Number.isFinite(Math.min(viaA, viaB))) continue;
    const seq = pathNodes(prev, ends).map((n) => nodes[n]!);
    routes.push({ points: [from.point, ...seq, to.point] });
  }
  return routes;
}

/** Vrai si un logement (rectangle) est à moins de BUS_ROUTE_RADIUS d'un tracé. */
export function nearRoute(route: TransitRoute, rect: ReturnType<typeof buildingRect>): boolean {
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i]!, b = route.points[i + 1]!;
    const d = segmentRectDistanceOf(a, b, rect);
    if (d <= BUS_ROUTE_RADIUS) return true;
  }
  return false;
}

function segmentRectDistanceOf(a: Point, b: Point, rect: ReturnType<typeof buildingRect>): number {
  return segmentRectDistance({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, rect);
}
