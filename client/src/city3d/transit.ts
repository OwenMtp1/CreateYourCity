// Transports en commun : bus sur les routes, tram et métro sur leur propre voie.
import * as THREE from 'three';
import { BUILDINGS, buildingRect, CITY_SIZE_M, tramPath, type Building, type CityState, type CityLayout } from '@cyc/shared';
import { sharedGeometry, solid } from './models.ts';

const HALF = CITY_SIZE_M / 2;

function box3(w: number, h: number, d: number, color: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), solid(color, { metalness: 0.2, roughness: 0.5 }));
  body.position.y = h / 2;
  body.castShadow = true;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h * 0.35, d * 1.02), solid(0x1e293b, { roughness: 0.2, metalness: 0.4 }));
  glass.position.y = h * 0.7;
  g.add(body, glass);
  return g;
}

export class TransitView {
  private layout: CityLayout | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  // --- Transports en commun -------------------------------------------------------------------

  private readonly transitGroup = new THREE.Group();
  private vehicles: { mesh: THREE.Object3D; pts: THREE.Vector3[]; cum: number[]; total: number; s: number; dir: 1 | -1; speed: number }[] = [];

  /** Lignes reliant les stations d'un même mode (ordre du plus proche voisin) et leurs véhicules. */
  rebuild(city: CityState, layout: CityLayout | null) {
    this.layout = layout;
    for (const o of [...this.transitGroup.children]) o.removeFromParent();
    this.vehicles = [];
    if (!this.transitGroup.parent) this.scene.add(this.transitGroup);
    const style = {
      bus: { color: 0x3b82f6, y: 1.2, vehicle: () => box3(11, 3.2, 2.6, 0xf59e0b), speed: 12 },
      tram: { color: 0x10b981, y: 0.3, vehicle: () => box3(26, 3.4, 2.6, 0x10b981), speed: 14 },
      metro: { color: 0xfacc15, y: 9, vehicle: () => box3(40, 3.2, 3, 0xe5e7eb), speed: 22 },
    } as const;
    for (const mode of ['bus', 'tram', 'metro'] as const) {
      const st = style[mode];
      // Bus : tracés suivant les routes (calculés par la simulation). Tram et métro : chaîne de stations, voie propre.
      let chains: THREE.Vector3[][] = [];
      if (mode === 'bus') {
        chains = (this.layout?.busRoutes ?? []).map((r) => r.points.map((p) => new THREE.Vector3(p.x - HALF, st.y, p.y - HALF)));
      } else {
        const stations = city.buildings.filter((b) => BUILDINGS[b.type].transit?.mode === mode && this.layout?.status.get(b.id) === 'ok');
        if (stations.length < 2) continue;
        // Chaîne du plus proche voisin, depuis la station la plus à l'ouest.
        const rest = [...stations].sort((a, b) => a.x - b.x);
        const chain = [rest.shift()!];
        while (rest.length) {
          const last = chain.at(-1)!;
          rest.sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y));
          chain.push(rest.shift()!);
        }
        chains = mode === 'tram' ? tramChains(city, chain, st.y) : [chain.map((b) => new THREE.Vector3(b.x - HALF, st.y, b.y - HALF))];
      }
      for (const pts of chains) {
        if (pts.length < 2) continue;
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!, b = pts[i + 1]!;
          const len = a.distanceTo(b);
          const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
          const angle = Math.atan2(b.z - a.z, b.x - a.x);
          if (mode === 'metro') {
            const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 6), solid(0x9ca3af));
            deck.position.copy(mid).setY(st.y - 1.4);
            deck.rotation.y = -angle;
            deck.castShadow = deck.receiveShadow = true;
            this.transitGroup.add(deck);
            for (let k = 0; k <= Math.floor(len / 40); k++) {
              const p = new THREE.Vector3().lerpVectors(a, b, len > 0 ? (k * 40) / len : 0);
              const pillar = new THREE.Mesh(sharedGeometry('pillar', () => new THREE.CylinderGeometry(0.8, 1, 7.6, 8)), solid(0xa8a29e));
              pillar.position.set(p.x, 3.8, p.z);
              pillar.castShadow = true;
              this.transitGroup.add(pillar);
            }
          } else if (mode === 'tram') {
            for (const off of [-0.8, 0.8]) {
              const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 0.25), solid(0xd1d5db, { metalness: 0.8, roughness: 0.3 }));
              rail.position.copy(mid).add(new THREE.Vector3(-Math.sin(angle) * off, 0, Math.cos(angle) * off));
              rail.rotation.y = -angle;
              this.transitGroup.add(rail);
            }
          } else {
            const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.55, depthWrite: false }));
            line.rotation.x = -Math.PI / 2;
            line.rotation.z = -angle;
            line.position.copy(mid).setY(0.6);
            this.transitGroup.add(line);
          }
        }
        const total = cum.at(-1)!;
        const count = Math.max(1, Math.min(4, Math.round(total / 400)));
        for (let k = 0; k < count; k++) {
          const mesh = st.vehicle();
          this.transitGroup.add(mesh);
          this.vehicles.push({ mesh, pts, cum, total, s: (k / count) * total, dir: k % 2 ? -1 : 1, speed: st.speed });
        }
      }
    }
  }

  move(dt: number) {
    for (const v of this.vehicles) {
      v.s += v.dir * v.speed * dt * 4;
      if (v.s > v.total) { v.s = v.total; v.dir = -1; }
      if (v.s < 0) { v.s = 0; v.dir = 1; }
      let k = 1;
      while (k < v.cum.length - 1 && v.cum[k]! < v.s) k++;
      const a = v.pts[k - 1]!, b = v.pts[k]!;
      const segLen = v.cum[k]! - v.cum[k - 1]! || 1;
      v.mesh.position.lerpVectors(a, b, (v.s - v.cum[k - 1]!) / segLen);
      v.mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    }
  }

}

/**
 * Voie de tram entre stations consécutives : le tracé contourne les bâtiments. Si une liaison est impossible,
 * la ligne est coupée à cet endroit plutôt que de traverser un bâtiment.
 */
function tramChains(city: CityState, chain: Building[], y: number): THREE.Vector3[][] {
  const rects = city.buildings.map((b) => [b.id, buildingRect(b)] as const);
  const pieces: THREE.Vector3[][] = [];
  let cur: THREE.Vector3[] = [];
  for (let k = 1; k < chain.length; k++) {
    const a = chain[k - 1]!, b = chain[k]!;
    const obstacles = rects.filter(([id]) => id !== a.id && id !== b.id).map(([, r]) => r);
    const path = tramPath({ x: a.x, y: a.y }, { x: b.x, y: b.y }, obstacles);
    if (!path) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    const v = path.map((p) => new THREE.Vector3(p.x - HALF, y, p.y - HALF));
    if (cur.length === 0) cur = v;
    else cur.push(...v.slice(1));
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}
