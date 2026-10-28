// Circulation animée : voitures sur chaque tronçon relié (au trafic réel) et camions sur les livraisons.
// Les véhicules ralentissent sur les tronçons saturés.
import * as THREE from 'three';
import { InstancedVehicles } from './vehicles.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY_SIZE_M, hashString, mulberry32, segmentEfficiency, type CityLayers, type CityLayout, type CityState, type Routing } from '@cyc/shared';
import { sharedGeometry } from './models.ts';

const HALF = CITY_SIZE_M / 2;

function truckCount(qty: number, perTruck: number, max: number): number {
  return Math.max(1, Math.min(max, Math.ceil(qty / perTruck)));
}

export class TrafficView {
  private routing: Routing | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly low: boolean,
    /** Hauteur du tablier sous un point (ponts), 0 ailleurs. */
    private readonly deckAt: (x: number, z: number) => number,
  ) {}

  /** Recalcule les véhicules après un changement de ville, de trafic ou d'agencement. */
  update(city: CityState, layers: CityLayers | null, routing: Routing | null) {
    this.routing = routing;
    this.roadEfficiency = new Map(Object.entries(layers?.roadLoad ?? {}).map(([id, ratio]) => [Number(id), segmentEfficiency(ratio)]));
    this.updateTraffic(city);
    this.updateTrucks(layers);
  }

  /** Fait avancer les véhicules d'un pas de temps. */
  move(dt: number) {
    this.moveCars(dt);
  }

  // --- Camions : livraisons usine → commerce et exportations ------------------------------------

  private trucks: InstancedVehicles | null = null;
  private truckState: { path: number; s: number; dir: 1 | -1; speed: number }[] = [];
  private truckPaths: { pts: THREE.Vector3[]; cum: number[]; total: number }[] = [];
  private truckKey = '';

  /** Camions orange (usine → commerce de la ville) et gris (exportations vers l'accès régional). */
  private updateTrucks(layers: CityLayers | null) {
    const routing = this.routing;
    const links = layers?.supply ?? [];
    const exports = Object.entries(layers?.economy ?? {})
      .filter(([, e]) => (e.exported ?? 0) > 15)
      .map(([id, e]) => ({ id: Number(id), qty: e.exported ?? 0 }));
    const key = [
      ...links.map((l) => `${l.from}>${l.to}:${truckCount(l.qty, 25, 8)}`),
      ...exports.map((x) => `${x.id}^${truckCount(x.qty, 80, 4)}`),
    ].join(',');
    if (key === this.truckKey && (this.trucks || !key)) return;
    this.truckKey = key;
    if (this.trucks) {
      this.trucks.removeFrom(this.scene);
      this.trucks.dispose();
      this.trucks = null;
    }
    this.truckState = [];
    this.truckPaths = [];
    if (!routing || !key) return;
    const toPath = (points: { x: number; y: number }[]) => {
      const pts = points.map((p) => new THREE.Vector3(p.x - HALF, 1.5, p.y - HALF));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
      return { pts, cum, total: cum.at(-1)! };
    };
    const colors: number[] = [];
    const rnd = mulberry32(links.length * 31 + exports.length);
    const addTrucks = (points: { x: number; y: number }[] | undefined, count: number, color: number) => {
      if (!points || points.length < 2) return;
      const path = toPath(points);
      if (path.total < 10) return;
      this.truckPaths.push(path);
      for (let k = 0; k < count; k++) {
        this.truckState.push({ path: this.truckPaths.length - 1, s: ((k + rnd()) / count) * path.total, dir: k % 2 ? -1 : 1, speed: 8 + rnd() * 3 });
        colors.push(color);
      }
    };
    // Un camion par tranche de 25 biens/j (plafonné) : un gros flux se voit, un petit flux reste discret.
    for (const l of links) addTrucks(routing.deliveries.get(l.from)?.find((d) => d.shopId === l.to)?.points, truckCount(l.qty, 25, this.low ? 4 : 8), 0xf97316);
    for (const x of exports) addTrucks(routing.exportPaths.get(x.id), truckCount(x.qty, 80, this.low ? 2 : 4), 0x94a3b8);
    const n = Math.min(this.truckState.length, this.low ? 60 : 160);
    this.truckState.length = n;
    if (!n) return;
    // Repli sans maquette : remorque et cabine, posées sur y = 0 comme la maquette.
    const fallback = sharedGeometry('truck', () => {
      const trailer = new THREE.BoxGeometry(5.2, 3, 2.5).translate(-0.9, 1.5, 0);
      const cab = new THREE.BoxGeometry(1.7, 2.3, 2.4).translate(2.7, 1.15, 0);
      return mergeGeometries([trailer.toNonIndexed(), cab.toNonIndexed()])!;
    });
    this.trucks = new InstancedVehicles('truck', n, fallback, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }), 0.1, !this.low);
    for (let i = 0; i < n; i++) this.trucks.setColor(i, new THREE.Color(colors[i]!));
    this.trucks.addTo(this.scene);
  }

  // --- Circulation animée -------------------------------------------------------------------

  private layout: CityLayout | null = null;
  private cars: InstancedVehicles | null = null;
  private carState: { path: number; s: number; dir: 1 | -1; speed: number }[] = [];
  private paths: { pts: THREE.Vector3[]; cum: number[]; total: number; weight?: number; roadId?: number; loop?: boolean }[] = [];
  private trafficEfficiency = 1;

  private trafficRouting: unknown = null;

  /**
   * Voitures sur chaque tronçon relié : un minimum partout pour que toute la voirie vive, plus une densité
   * proportionnelle aux trajets qui l'empruntent (domicile-travail, commerces, fret).
   */
  /** Vitesse relative des voitures par tronçon (1 = fluide) : un tronçon saturé se voit à l'écran. */
  private roadEfficiency = new Map<number, number>();

  private updateTraffic(city: CityState) {
    const routing = this.routing;
    const trips = city.stats?.traffic.trips ?? 0;
    const carTrips = trips * (1 - (city.stats?.transit.share ?? 0));
    this.trafficEfficiency = city.stats?.traffic.efficiency ?? 1;
    const cap = this.low ? 120 : 360;
    const edges = routing?.edges.filter((e) => Math.hypot(e.bx - e.ax, e.by - e.ay) > 5) ?? [];
    const wanted = routing && edges.length ? Math.min(cap, Math.max(Math.round(carTrips / 25), edges.length * 2)) : 0;
    if (this.cars && this.carState.length === wanted && this.trafficRouting === routing) return;
    this.trafficRouting = routing;
    if (this.cars) {
      this.cars.removeFrom(this.scene);
      this.cars.dispose();
      this.cars = null;
    }
    this.carState = [];
    if (!routing || wanted === 0) return;
    const load = new Map<number, number>();
    const addLoad = (m: Map<number, number>) => { for (const [e, w] of m) load.set(e, (load.get(e) ?? 0) + w); };
    for (const m of routing.commute.values()) addLoad(m);
    for (const m of routing.shopping.values()) addLoad(m);
    for (const m of routing.freight.values()) addLoad(m);
    const maxLoad = Math.max(1e-9, ...load.values());
    // Chaque tronçon est un aller-retour ; son poids dépend de son trafic (un tronçon vide garde un poids de base).
    // Tronçons d'un rond-point : un seul anneau parcouru dans un sens, pas des allers-retours sur chaque tronçon.
    const ringOf = new Map(city.roads.filter((r) => r.ring !== undefined).map((r) => [r.id, r.ring!]));
    const rings = new Map<number, typeof edges>();
    const straight: typeof edges = [];
    for (const e of edges) {
      const ring = ringOf.get(e.roadId);
      if (ring === undefined) straight.push(e);
      else rings.set(ring, [...(rings.get(ring) ?? []), e]);
    }
    const straightPaths = straight.map((e) => {
      const pts = [new THREE.Vector3(e.ax - HALF, 0.9, e.ay - HALF), new THREE.Vector3(e.bx - HALF, 0.9, e.by - HALF)];
      return { pts, cum: [0, pts[0]!.distanceTo(pts[1]!)], total: pts[0]!.distanceTo(pts[1]!), weight: 1 + 8 * ((load.get(e.id) ?? 0) / maxLoad), roadId: e.roadId };
    });
    const loopPaths = [...rings.values()].map((group) => {
      const pts = ringLoop(group);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
      const meanLoad = group.reduce((s, e) => s + (load.get(e.id) ?? 0), 0) / group.length;
      return { pts, cum, total: cum.at(-1)!, weight: 1 + 8 * (meanLoad / maxLoad), loop: true };
    });
    this.paths = [...straightPaths, ...loopPaths];
    if (!this.paths.length) return;
    const fallback = sharedGeometry('car', () => new THREE.BoxGeometry(4.4, 1.6, 2).translate(0, 0.8, 0));
    this.cars = new InstancedVehicles('car', wanted, fallback, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), 0.1, !this.low);
    const rnd = mulberry32(hashString(city.cityId) + wanted);
    const colors = [0xe5e7eb, 0x1f2937, 0xdc2626, 0x2563eb, 0x9ca3af, 0xf59e0b, 0x16a34a, 0xf8fafc];
    // Chaque tronçon reçoit d'abord une voiture, puis le reste est réparti selon son poids.
    const weights = this.paths.map((p) => p.weight ?? 1);
    const total = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < wanted; i++) {
      let path = i < this.paths.length ? i : 0;
      if (i >= this.paths.length) {
        let r = rnd() * total, k = 0;
        while (k < weights.length - 1 && r > weights[k]!) { r -= weights[k]!; k++; }
        path = k;
      }
      this.carState.push({ path, s: rnd() * this.paths[path]!.total, dir: rnd() < 0.5 ? 1 : -1, speed: 10 + rnd() * 6 });
      this.cars.setColor(i, new THREE.Color(colors[Math.floor(rnd() * colors.length)]!));
    }
    this.cars.addTo(this.scene);
  }

  private moveCars(dt: number) {
    // Les embouteillages ralentissent visiblement la circulation.
    const slow = Math.max(0.15, this.trafficEfficiency ** 3);
    if (this.cars) this.moveAlong(this.cars, this.carState, this.paths, dt, slow);
    if (this.trucks) this.moveAlong(this.trucks, this.truckState, this.truckPaths, dt, slow);
  }

  /** Avance des véhicules instanciés le long de leurs tracés (aller-retour, circulation à droite). */
  private moveAlong(
    mesh: InstancedVehicles, states: { path: number; s: number; dir: 1 | -1; speed: number }[],
    paths: { pts: THREE.Vector3[]; cum: number[]; total: number; roadId?: number; loop?: boolean }[], dt: number, slow: number,
  ) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    states.forEach((c, i) => {
      const p = paths[c.path]!;
      // Un tronçon saturé ralentit ses véhicules : l'embouteillage se voit sur la route.
      const jam = p.roadId !== undefined ? this.roadEfficiency.get(p.roadId) ?? 1 : 1;
      c.s += c.dir * c.speed * slow * jam * dt * 4;
      if (p.loop) {
        // Anneau : les voitures tournent toujours dans le même sens, sans faire demi-tour.
        c.dir = 1;
        c.s = ((c.s % p.total) + p.total) % p.total;
      } else {
        if (c.s > p.total) { c.s = p.total; c.dir = -1; }
        if (c.s < 0) { c.s = 0; c.dir = 1; }
      }
      let k = 1;
      while (k < p.cum.length - 1 && p.cum[k]! < c.s) k++;
      const a = p.pts[k - 1]!, b = p.pts[k]!;
      const segLen = p.cum[k]! - p.cum[k - 1]! || 1;
      pos.lerpVectors(a, b, (c.s - p.cum[k - 1]!) / segLen);
      const dir = new THREE.Vector3().subVectors(b, a).normalize().multiplyScalar(c.dir);
      // Circulation à droite.
      pos.add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(-2.4));
      pos.y = mesh.groundY + this.deckAt(pos.x, pos.z);
      q.setFromAxisAngle(up, Math.atan2(-dir.z, dir.x));
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrix(i, m);
    });
    mesh.update();
  }

}

/**
 * Chemin fermé d'un rond-point : ses tronçons, ordonnés autour du centre, dans le sens anti-horaire
 * (circulation à droite). Chaque tronçon est orienté pour suivre le précédent.
 */
function ringLoop(group: { ax: number; ay: number; bx: number; by: number }[]): THREE.Vector3[] {
  const xs = group.flatMap((e) => [e.ax, e.bx]), ys = group.flatMap((e) => [e.ay, e.by]);
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const angle = (e: { ax: number; ay: number; bx: number; by: number }) => Math.atan2((e.ay + e.by) / 2 - cy, (e.ax + e.bx) / 2 - cx);
  const ordered = [...group].sort((p, q) => angle(p) - angle(q));
  const first = ordered[0]!;
  let cur = { x: first.ax, y: first.ay };
  const pts: { x: number; y: number }[] = [cur];
  for (const e of ordered) {
    const toA = Math.hypot(e.ax - cur.x, e.ay - cur.y), toB = Math.hypot(e.bx - cur.x, e.by - cur.y);
    cur = toA <= toB ? { x: e.bx, y: e.by } : { x: e.ax, y: e.ay };
    pts.push(cur);
  }
  return pts.map((p) => new THREE.Vector3(p.x - HALF, 0.9, p.y - HALF));
}
