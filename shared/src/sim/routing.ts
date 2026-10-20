// Réseau routier en graphe et itinéraires. Les tronçons sont découpés aux croisements et aux
// raccordements en T ; chaque déplacement suit le plus court chemin en temps (avenues plus
// rapides). Les répartitions de flux sont précalculées à chaque changement d'agencement :
// à chaque tick, la charge d'un tronçon est une simple somme pondérée.
import { BUILDINGS } from '../catalog.ts';
import { REGIONAL_ACCESS, ROAD_JOIN_TOLERANCE } from '../constants.ts';
import { buildingRect, closestPointOnSegment, rectCenter, segmentLength } from '../geometry.ts';
import type { Building, CityState, Road } from '../types.ts';

export const ROAD_SPEED_KMH = { street: 30, avenue: 50, bridge: 50 } as const;

export interface RouteEdge {
  id: number;
  roadId: number;
  a: number;
  b: number;
  length: number;
  /** Coordonnées des extrémités (pour l'animation des véhicules). */
  ax: number; ay: number; bx: number; by: number;
}

/** Point d'attache d'un bâtiment sur le graphe : arête et distance à chacune de ses extrémités. */
interface Attachment { edge: number; da: number; db: number; x: number; y: number }

export interface Routing {
  nodes: { x: number; y: number }[];
  edges: RouteEdge[];
  /** Pour chaque logement : part de ses trajets domicile-travail passant par chaque arête. */
  commute: Map<number, Map<number, number>>;
  /** Pour chaque logement : idem pour les trajets vers les commerces. */
  shopping: Map<number, Map<number, number>>;
  /** Fret des usines vers l'accès régional : part par arête, pondérée par la production. */
  freight: Map<number, Map<number, number>>;
  /** Itinéraires représentatifs (suites de points) pour l'animation des véhicules. */
  samples: { weight: number; points: { x: number; y: number }[] }[];
}

const key = (x: number, y: number) => `${Math.round(x / 2)}:${Math.round(y / 2)}`;

function intersection(r: Road, s: Road): { t: number; x: number; y: number } | null {
  const dx1 = r.x2 - r.x1, dy1 = r.y2 - r.y1, dx2 = s.x2 - s.x1, dy2 = s.y2 - s.y1;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((s.x1 - r.x1) * dy2 - (s.y1 - r.y1) * dx2) / den;
  const u = ((s.x1 - r.x1) * dy1 - (s.y1 - r.y1) * dx1) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t: Math.max(0, Math.min(1, t)), x: r.x1 + t * dx1, y: r.y1 + t * dy1 };
}

export function buildRouting(city: CityState, connectedRoads: Set<number>, access: Map<number, number | null>, okBuildings: Building[]): Routing {
  const roads = city.roads.filter((r) => connectedRoads.has(r.id));
  const nodes: { x: number; y: number }[] = [];
  const nodeIndex = new Map<string, number>();
  const nodeAt = (x: number, y: number) => {
    // Fusion des nœuds proches (grille de 2 m, voisins inclus).
    for (const dx of [-2, 0, 2]) for (const dy of [-2, 0, 2]) {
      const k = key(x + dx, y + dy);
      const i = nodeIndex.get(k);
      if (i !== undefined && Math.hypot(nodes[i]!.x - x, nodes[i]!.y - y) <= ROAD_JOIN_TOLERANCE + 1) return i;
    }
    nodes.push({ x, y });
    nodeIndex.set(key(x, y), nodes.length - 1);
    return nodes.length - 1;
  };

  // Découpage de chaque route aux croisements et raccordements.
  const edges: RouteEdge[] = [];
  const edgesOfRoad = new Map<number, { edge: number; t0: number; t1: number }[]>();
  for (const r of roads) {
    const len = segmentLength(r);
    const ts = new Set<number>([0, 1]);
    for (const s of roads) {
      if (s === r) continue;
      const hit = intersection(r, s);
      if (hit) ts.add(Math.round(hit.t * 1e4) / 1e4);
      for (const p of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) {
        const q = closestPointOnSegment(p, r);
        if (Math.hypot(q.x - p.x, q.y - p.y) <= ROAD_JOIN_TOLERANCE + 0.5 && len > 0) {
          ts.add(Math.round((Math.hypot(q.x - r.x1, q.y - r.y1) / len) * 1e4) / 1e4);
        }
      }
    }
    const sorted = [...ts].sort((a, b) => a - b);
    const list: { edge: number; t0: number; t1: number }[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const t0 = sorted[i]!, t1 = sorted[i + 1]!;
      if ((t1 - t0) * len < 0.5) continue;
      const ax = r.x1 + (r.x2 - r.x1) * t0, ay = r.y1 + (r.y2 - r.y1) * t0;
      const bx = r.x1 + (r.x2 - r.x1) * t1, by = r.y1 + (r.y2 - r.y1) * t1;
      const a = nodeAt(ax, ay), b = nodeAt(bx, by);
      if (a === b) continue;
      edges.push({ id: edges.length, roadId: r.id, a, b, length: (t1 - t0) * len, ax, ay, bx, by });
      list.push({ edge: edges.length - 1, t0, t1 });
    }
    edgesOfRoad.set(r.id, list);
  }
  const adj: { to: number; edge: number; cost: number }[][] = nodes.map(() => []);
  const roadType = new Map(roads.map((r) => [r.id, r.type]));
  const costOf = (e: RouteEdge) => e.length / ROAD_SPEED_KMH[roadType.get(e.roadId)!];
  for (const e of edges) {
    adj[e.a]!.push({ to: e.b, edge: e.id, cost: costOf(e) });
    adj[e.b]!.push({ to: e.a, edge: e.id, cost: costOf(e) });
  }

  const attach = (b: Building): Attachment | null => {
    const roadId = access.get(b.id);
    if (roadId == null) return null;
    const r = city.roads.find((x) => x.id === roadId);
    const parts = edgesOfRoad.get(roadId);
    if (!r || !parts?.length) return null;
    const c = rectCenter(buildingRect(b));
    const q = closestPointOnSegment(c, r);
    const len = segmentLength(r);
    const t = len > 0 ? Math.hypot(q.x - r.x1, q.y - r.y1) / len : 0;
    const part = parts.find((p) => t >= p.t0 - 1e-6 && t <= p.t1 + 1e-6) ?? parts[0]!;
    const e = edges[part.edge]!;
    const f = part.t1 > part.t0 ? Math.max(0, Math.min(1, (t - part.t0) / (part.t1 - part.t0))) : 0;
    return { edge: e.id, da: f * e.length, db: (1 - f) * e.length, x: q.x, y: q.y };
  };

  // Plus courts chemins depuis une attache (Dijkstra, tas binaire simple).
  const dijkstra = (src: Attachment) => {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const prevNode = new Int32Array(nodes.length).fill(-1);
    const e = edges[src.edge]!;
    const speed = ROAD_SPEED_KMH[roadType.get(e.roadId)!];
    const heap: [number, number][] = [];
    const push = (d: number, n: number) => {
      heap.push([d, n]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]![0] <= heap[i]![0]) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    dist[e.a] = src.da / speed;
    dist[e.b] = src.db / speed;
    push(dist[e.a]!, e.a);
    push(dist[e.b]!, e.b);
    while (heap.length) {
      const [d, n] = pop();
      if (d > dist[n]!) continue;
      for (const nb of adj[n]!) {
        const nd = d + nb.cost;
        if (nd < dist[nb.to]!) {
          dist[nb.to] = nd;
          prev[nb.to] = nb.edge;
          prevNode[nb.to] = n;
          push(nd, nb.to);
        }
      }
    }
    return { dist, prev, prevNode };
  };

  /** Arêtes d'un trajet d'une attache vers la source de l'arbre de Dijkstra. */
  const pathTo = (tree: ReturnType<typeof dijkstra>, src: Attachment, from: Attachment) => {
    const e = edges[from.edge]!;
    const speed = ROAD_SPEED_KMH[roadType.get(e.roadId)!];
    const viaA = tree.dist[e.a]! + from.da / speed;
    const viaB = tree.dist[e.b]! + from.db / speed;
    let n = viaA <= viaB ? e.a : e.b;
    if (!Number.isFinite(Math.min(viaA, viaB))) return null;
    const list = [from.edge];
    const pts = [{ x: from.x, y: from.y }, nodes[n]!];
    let guard = 0;
    while (tree.prev[n]! >= 0 && guard++ < 10_000) {
      list.push(tree.prev[n]!);
      n = tree.prevNode[n]!;
      pts.push(nodes[n]!);
    }
    if (from.edge !== src.edge) list.push(src.edge);
    pts.push({ x: src.x, y: src.y });
    return { edges: list, points: pts };
  };

  const residential = okBuildings.filter((b) => BUILDINGS[b.type].housing > 0);
  const workplaces = okBuildings.filter((b) => BUILDINGS[b.type].jobs > 0);
  const shops = okBuildings.filter((b) => (BUILDINGS[b.type].goodsSalesCapacityPerDay ?? 0) > 0);
  const factories = okBuildings.filter((b) => (BUILDINGS[b.type].goodsProductionPerDay ?? 0) > 0);
  const attachments = new Map<number, Attachment>();
  for (const b of okBuildings) {
    const a = attach(b);
    if (a) attachments.set(b.id, a);
  }

  const commute = new Map<number, Map<number, number>>(residential.map((r) => [r.id, new Map()]));
  const shopping = new Map<number, Map<number, number>>(residential.map((r) => [r.id, new Map()]));
  const freight = new Map<number, Map<number, number>>();
  const samples: Routing['samples'] = [];
  const add = (m: Map<number, number>, edgeIds: number[], w: number) => {
    for (const id of edgeIds) m.set(id, (m.get(id) ?? 0) + w);
  };

  const distribute = (targets: Building[], weightOf: (b: Building) => number, into: Map<number, Map<number, number>>, sample: boolean) => {
    const total = targets.reduce((s, b) => s + weightOf(b), 0);
    if (total <= 0) return;
    for (const w of targets) {
      const wa = attachments.get(w.id);
      if (!wa) continue;
      const share = weightOf(w) / total;
      const tree = dijkstra(wa);
      for (const r of residential) {
        const ra = attachments.get(r.id);
        if (!ra) continue;
        const path = pathTo(tree, wa, ra);
        if (!path) continue;
        add(into.get(r.id)!, path.edges, share);
        if (sample) samples.push({ weight: share * BUILDINGS[r.type].housing, points: path.points });
      }
    }
  };
  distribute(workplaces, (b) => BUILDINGS[b.type].jobs, commute, true);
  distribute(shops, (b) => BUILDINGS[b.type].goodsSalesCapacityPerDay ?? 0, shopping, false);

  // Fret : chaque usine vers l'accès régional.
  let accessNode = -1;
  let best = Infinity;
  nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - REGIONAL_ACCESS.x, n.y - REGIONAL_ACCESS.y);
    if (d < best) { best = d; accessNode = i; }
  });
  if (accessNode >= 0 && best < 30) {
    const accessEdge = edges.find((e) => e.a === accessNode || e.b === accessNode);
    if (accessEdge) {
      const src: Attachment = { edge: accessEdge.id, da: accessEdge.a === accessNode ? 0 : accessEdge.length, db: accessEdge.b === accessNode ? 0 : accessEdge.length, x: nodes[accessNode]!.x, y: nodes[accessNode]!.y };
      const tree = dijkstra(src);
      for (const f of factories) {
        const fa = attachments.get(f.id);
        const path = fa && pathTo(tree, src, fa);
        if (path) {
          const m = new Map<number, number>();
          add(m, path.edges, 1);
          freight.set(f.id, m);
          samples.push({ weight: 30, points: path.points });
        }
      }
    }
  }

  samples.sort((a, b) => b.weight - a.weight);
  return { nodes, edges, commute, shopping, freight, samples: samples.slice(0, 60) };
}
