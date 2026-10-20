// Scène 3D d'une ville : terrain, eau, ciel dynamique (cycle jour/nuit lié au temps de jeu),
// routes, bâtiments procéduraux, arbres, couches d'information et aperçu de construction.
import * as THREE from 'three';
import { captureMode, expose } from '../automation.ts';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  BUILDINGS, CITY_SIZE_M, footprint, generateTerrain, hashString, mulberry32, REGIONAL_ACCESS, ROADS, segmentLength,
  terrainAt, TerrainKind, analyzeLayout, type BuildingType, type CityLayers, type CityLayout, type CityState, type Point, type RoadType, type Segment,
} from '@cyc/shared';
import { getQuality } from './quality.ts';
import { buildModel, placeModel, sharedGeometry, solid, treeInstances, windowMaterials, type ModelInfo } from './models.ts';

export type CityLayer = 'none' | 'status' | 'traffic' | 'health' | 'education' | 'safety' | 'leisure' | 'pollution';

export type Preview =
  | { kind: 'building'; type: BuildingType; x: number; y: number; rotation: 0 | 90; ok: boolean }
  | { kind: 'road'; road: RoadType; seg: Segment; ok: boolean }
  | { kind: 'path'; road: RoadType; points: Point[]; ok: boolean }
  | { kind: 'cursor'; x: number; y: number }
  | { kind: 'demolish'; target: { kind: 'building' | 'road'; id: number } | null }
  | null;

const HALF = CITY_SIZE_M / 2;
const ramp = (v: number) => {
  const c = Math.max(0, Math.min(1, v));
  return new THREE.Color().setHSL((c * 120) / 360, 0.75, 0.5);
};

interface BuildingEntry { key: string; obj: THREE.Group; info: ModelInfo; smoke: THREE.Points[] }

export class CityScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 1, 30000);
  readonly controls: MapControls;
  private readonly sky = new Sky();
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a3a, 0.9);
  private readonly pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private readonly buildings = new Map<number, BuildingEntry>();
  private readonly roadGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly previewGroup = new THREE.Group();
  private readonly gridGroup = new THREE.Group();
  private trees: { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh } | null = null;
  private lampMaterial = solid(0xfff3c4, { emissive: new THREE.Color(0xffd27a), emissiveIntensity: 0 });
  private cityId: string | null = null;
  private layoutKey = '';
  private frame = 0;
  private disposed = false;
  private readonly timer = new THREE.Timer();
  private lastSkyHour = -1;
  private lastEnvHour = -1;
  private night = 0;

  private readonly low = getQuality() === 'low';

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, preserveDrawingBuffer: captureMode() });
    this.renderer.setPixelRatio(this.low ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.sky.scale.setScalar(10000);
    const u = this.sky.material.uniforms;
    u.turbidity!.value = 6;
    u.rayleigh!.value = 1.6;
    u.mieCoefficient!.value = 0.004;
    u.mieDirectionalG!.value = 0.8;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xb8cbe0, 2500, 9000);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -500; sc.right = 500; sc.top = 500; sc.bottom = -500; sc.near = 10; sc.far = 4000;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 1.2;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.roadGroup, this.overlayGroup, this.previewGroup, this.gridGroup);

    // Campagne environnante (hors de l'espace constructible).
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), solid(0x5d7a4a));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.3;
    outer.receiveShadow = true;
    this.scene.add(outer);

    this.camera.position.set(-HALF + 330, 190, 260);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-HALF + 220, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = 1.38;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 2600;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setTimeOfDay(11, false);
    this.animate();
    expose('city', this);
  }

  /** Coordonnées ville (m) du point du sol sous le curseur. */
  screenToCity(mx: number, my: number): Point | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1), this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    return { x: hit.x + HALF, y: hit.z + HALF };
  }

  /** Pixels écran par mètre au voisinage de la cible (pour les tolérances d'accrochage). */
  pixelsPerMeter(): number {
    const d = this.camera.position.distanceTo(this.controls.target);
    const h = this.renderer.domElement.clientHeight;
    return h / (2 * d * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /** Couche imposée (automatisation, bande-annonce). */
  layerOverride: CityLayer | null = null;

  setCity(city: CityState, layers: CityLayers | null, requestedLayer: CityLayer, selected: number | null) {
    const layer = this.layerOverride ?? requestedLayer;
    if (city.cityId !== this.cityId) this.loadTerrain(city.cityId);
    // Bâtiments : ajouts, suppressions.
    const seen = new Set<number>();
    for (const b of city.buildings) {
      seen.add(b.id);
      const key = `${b.type}:${b.x}:${b.y}:${b.rotation}`;
      const existing = this.buildings.get(b.id);
      if (existing && existing.key === key) continue;
      if (existing) this.removeBuilding(b.id);
      const { group, info } = buildModel(b.type, b.id + hashString(city.cityId));
      placeModel(group, b, HALF);
      group.userData.buildingId = b.id;
      this.scene.add(group);
      const smoke = info.smoke.map((p) => this.makeSmoke(group, p));
      this.buildings.set(b.id, { key, obj: group, info, smoke });
    }
    for (const id of [...this.buildings.keys()]) if (!seen.has(id)) this.removeBuilding(id);

    const layoutKey = `${city.cityId}:${city.layoutVersion}`;
    if (layoutKey !== this.layoutKey) {
      this.layoutKey = layoutKey;
      this.rebuildRoads(city, layers, layer);
      this.placeTrees(city);
      this.layout = analyzeLayout(city);
      this.rebuildTransit(city);
    } else {
      this.colorRoads(city, layers, layer);
    }
    this.updateTraffic(city);
    this.rebuildOverlays(city, layers, layer, selected);
  }

  // --- Circulation animée -------------------------------------------------------------------

  private layout: CityLayout | null = null;
  private cars: THREE.InstancedMesh | null = null;
  private carState: { path: number; s: number; dir: 1 | -1; speed: number }[] = [];
  private paths: { pts: THREE.Vector3[]; cum: number[]; total: number }[] = [];
  private trafficEfficiency = 1;

  /** Voitures proportionnelles aux déplacements, sur les itinéraires représentatifs du graphe. */
  private updateTraffic(city: CityState) {
    const routing = this.layout?.routing;
    const trips = city.stats?.traffic.trips ?? 0;
    const carTrips = trips * (1 - (city.stats?.transit.share ?? 0));
    this.trafficEfficiency = city.stats?.traffic.efficiency ?? 1;
    const wanted = routing && routing.samples.length ? Math.min(this.low ? 80 : 260, Math.round(carTrips / 25)) : 0;
    if (this.cars && this.carState.length === wanted && this.paths.length === (routing?.samples.length ?? 0)) return;
    if (this.cars) {
      this.scene.remove(this.cars);
      this.cars.dispose();
      this.cars = null;
    }
    this.carState = [];
    if (!routing || wanted === 0) return;
    this.paths = routing.samples.map((sm) => {
      const pts = sm.points.map((p) => new THREE.Vector3(p.x - HALF, 0.9, p.y - HALF));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
      return { pts, cum, total: cum.at(-1)! };
    }).filter((p) => p.total > 5);
    if (!this.paths.length) return;
    const geo = sharedGeometry('car', () => new THREE.BoxGeometry(4.4, 1.6, 2));
    this.cars = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), wanted);
    this.cars.castShadow = !this.low;
    const rnd = mulberry32(hashString(city.cityId) + wanted);
    const colors = [0xe5e7eb, 0x1f2937, 0xdc2626, 0x2563eb, 0x9ca3af, 0xf59e0b, 0x16a34a, 0xf8fafc];
    const weights = routing.samples.map((s2) => s2.weight);
    const total = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < wanted; i++) {
      let r = rnd() * total, k = 0;
      while (k < weights.length - 1 && r > weights[k]!) { r -= weights[k]!; k++; }
      const path = Math.min(k, this.paths.length - 1);
      this.carState.push({ path, s: rnd() * this.paths[path]!.total, dir: rnd() < 0.5 ? 1 : -1, speed: 10 + rnd() * 6 });
      this.cars.setColorAt(i, new THREE.Color(colors[Math.floor(rnd() * colors.length)]!));
    }
    this.scene.add(this.cars);
  }

  private moveCars(dt: number) {
    if (!this.cars) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    // Les embouteillages ralentissent visiblement la circulation.
    const slow = Math.max(0.15, this.trafficEfficiency ** 3);
    this.carState.forEach((c, i) => {
      const p = this.paths[c.path]!;
      c.s += c.dir * c.speed * slow * dt * 4;
      if (c.s > p.total) { c.s = p.total; c.dir = -1; }
      if (c.s < 0) { c.s = 0; c.dir = 1; }
      let k = 1;
      while (k < p.cum.length - 1 && p.cum[k]! < c.s) k++;
      const a = p.pts[k - 1]!, b = p.pts[k]!;
      const segLen = p.cum[k]! - p.cum[k - 1]! || 1;
      pos.lerpVectors(a, b, (c.s - p.cum[k - 1]!) / segLen);
      const dir = new THREE.Vector3().subVectors(b, a).normalize().multiplyScalar(c.dir);
      // Circulation à droite.
      pos.add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(-2.4));
      q.setFromAxisAngle(up, Math.atan2(-dir.z, dir.x));
      m.compose(pos, q, new THREE.Vector3(1, 1, 1));
      this.cars!.setMatrixAt(i, m);
    });
    this.cars.instanceMatrix.needsUpdate = true;
  }

  // --- Transports en commun -------------------------------------------------------------------

  private readonly transitGroup = new THREE.Group();
  private vehicles: { mesh: THREE.Object3D; pts: THREE.Vector3[]; cum: number[]; total: number; s: number; dir: 1 | -1; speed: number }[] = [];

  /** Lignes reliant les stations d'un même mode (ordre du plus proche voisin) et leurs véhicules. */
  private rebuildTransit(city: CityState) {
    for (const o of [...this.transitGroup.children]) o.removeFromParent();
    this.vehicles = [];
    if (!this.transitGroup.parent) this.scene.add(this.transitGroup);
    const style = {
      bus: { color: 0x3b82f6, y: 1.2, vehicle: () => box3(11, 3.2, 2.6, 0xf59e0b), speed: 12 },
      tram: { color: 0x10b981, y: 0.3, vehicle: () => box3(26, 3.4, 2.6, 0x10b981), speed: 14 },
      metro: { color: 0xfacc15, y: 9, vehicle: () => box3(40, 3.2, 3, 0xe5e7eb), speed: 22 },
    } as const;
    for (const mode of ['bus', 'tram', 'metro'] as const) {
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
      const st = style[mode];
      const pts = chain.map((b) => new THREE.Vector3(b.x - HALF, st.y, b.y - HALF));
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

  private moveVehicles(dt: number) {
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

  private removeBuilding(id: number) {
    const e = this.buildings.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    e.obj.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g && !g.userData.shared) g.dispose();
    });
    this.buildings.delete(id);
  }

  private makeSmoke(group: THREE.Group, origin: THREE.Vector3): THREE.Points {
    const n = 24;
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe5e7eb, size: 9, transparent: true, opacity: 0.35, depthWrite: false }));
    pts.userData.origin = origin.clone();
    pts.userData.phase = Array.from({ length: n }, (_, i) => i / n);
    group.add(pts);
    return pts;
  }

  private loadTerrain(cityId: string) {
    this.cityId = cityId;
    for (const id of [...this.buildings.keys()]) this.removeBuilding(id);
    this.layoutKey = '';
    this.scene.getObjectByName('terrain')?.removeFromParent();
    this.scene.getObjectByName('water')?.removeFromParent();
    this.scene.getObjectByName('access')?.removeFromParent();

    const t = generateTerrain(cityId);
    const S = 1024;
    const color = document.createElement('canvas');
    color.width = color.height = S;
    const mask = document.createElement('canvas');
    mask.width = mask.height = S;
    const c = color.getContext('2d')!;
    const m = mask.getContext('2d')!;
    // Couleur du sol : herbe nuancée, collines plus sombres, berges sableuses.
    const img = c.createImageData(S, S);
    const mimg = m.createImageData(S, S);
    const rnd = mulberry32(hashString(cityId) ^ 0x9e3779b9);
    const noise = new Float32Array(64 * 64).map(() => rnd());
    const sample = (x: number, y: number) => {
      // Valeur interpolée de l'eau (0..1) pour des berges lisses.
      const gx = (x / CITY_SIZE_M) * t.size - 0.5;
      const gy = (y / CITY_SIZE_M) * t.size - 0.5;
      const x0 = Math.max(0, Math.min(t.size - 1, Math.floor(gx)));
      const y0 = Math.max(0, Math.min(t.size - 1, Math.floor(gy)));
      const x1 = Math.min(t.size - 1, x0 + 1);
      const y1 = Math.min(t.size - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, gx - x0));
      const fy = Math.max(0, Math.min(1, gy - y0));
      const w = (i: number, j: number) => (t.cells[j * t.size + i] === TerrainKind.Water ? 1 : 0);
      const h = (i: number, j: number) => (t.cells[j * t.size + i] === TerrainKind.Hill ? 1 : 0);
      const lerp = (f: (i: number, j: number) => number) =>
        f(x0, y0) * (1 - fx) * (1 - fy) + f(x1, y0) * fx * (1 - fy) + f(x0, y1) * (1 - fx) * fy + f(x1, y1) * fx * fy;
      return { water: lerp(w), hill: lerp(h) };
    };
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = ((i + 0.5) / S) * CITY_SIZE_M;
        const y = ((j + 0.5) / S) * CITY_SIZE_M;
        const { water, hill } = sample(x, y);
        const n = smoothNoise(noise, i / 24, j / 24) * 0.6 + smoothNoise(noise, i / 7 + 17, j / 7 + 5) * 0.4;
        let r = 70 + n * 22, g = 104 + n * 26, b = 52 + n * 12;
        r = r * (1 - hill * 0.35) + 104 * hill * 0.35;
        g = g * (1 - hill * 0.35) + 112 * hill * 0.35;
        b = b * (1 - hill * 0.35) + 72 * hill * 0.35;
        const shore = Math.max(0, 1 - Math.abs(water - 0.5) * 4);
        r = r * (1 - shore) + 200 * shore;
        g = g * (1 - shore) + 184 * shore;
        b = b * (1 - shore) + 140 * shore;
        const k = (j * S + i) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
        const a = water > 0.5 ? 255 : 0;
        mimg.data[k] = mimg.data[k + 1] = mimg.data[k + 2] = a;
        mimg.data[k + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    m.putImageData(mimg, 0, 0);
    const tex = new THREE.CanvasTexture(color);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(CITY_SIZE_M, CITY_SIZE_M), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    this.scene.add(terrain);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_SIZE_M, CITY_SIZE_M),
      new THREE.MeshStandardMaterial({ color: 0x2c6e98, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.92, alphaMap: new THREE.CanvasTexture(mask) }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.08;
    water.name = 'water';
    water.receiveShadow = true;
    this.scene.add(water);

    // Accès régional : route nationale qui entre par l'ouest, portique jaune.
    const access = new THREE.Group();
    access.name = 'access';
    const hw = new THREE.Mesh(new THREE.PlaneGeometry(1600, 16), solid(0x3a3d42));
    hw.rotation.x = -Math.PI / 2;
    hw.position.set(-HALF - 800, 0.1, REGIONAL_ACCESS.y - HALF);
    hw.receiveShadow = true;
    const gate = new THREE.Group();
    const post = solid(0xfbbf24, { emissive: new THREE.Color(0xfbbf24), emissiveIntensity: 0.25 });
    const part = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), post);
      m.position.set(x, y, z);
      m.castShadow = true;
      gate.add(m);
    };
    part(1.2, 9, 1.2, 0, 4.5, -10);
    part(1.2, 9, 1.2, 0, 4.5, 10);
    part(1.4, 2.4, 21, 0, 9.6, 0);
    gate.position.set(-HALF - 6, 0, REGIONAL_ACCESS.y - HALF);
    access.add(hw, gate);
    this.scene.add(access);

    // Limite de l'espace constructible.
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(CITY_SIZE_M, 0.01, CITY_SIZE_M)),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 12, gapSize: 10, transparent: true, opacity: 0.5 }),
    );
    edge.computeLineDistances();
    edge.position.y = 0.3;
    edge.name = 'access-edge';
    access.add(edge);
  }

  /** Plage de sommets de chaque route dans la géométrie fusionnée de l'asphalte (couleur par route). */
  private roadRanges = new Map<number, { start: number; count: number }>();
  private asphaltMesh: THREE.Mesh | null = null;
  private roadSegs = new Map<number, { x1: number; y1: number; x2: number; y2: number; width: number }>();

  /**
   * Routes fusionnées en quelques maillages (asphalte, bordures, marquages, lampadaires instanciés) :
   * quelques appels de dessin au lieu de plusieurs par tronçon.
   */
  private rebuildRoads(city: CityState, layers: CityLayers | null, layer: CityLayer) {
    for (const o of [...this.roadGroup.children]) {
      o.removeFromParent();
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
    }
    this.roadRanges.clear();
    this.roadSegs.clear();
    this.asphaltMesh = null;
    const asphalt: THREE.BufferGeometry[] = [];
    const curbs: THREE.BufferGeometry[] = [];
    const marks: Record<'white' | 'yellow', THREE.BufferGeometry[]> = { white: [], yellow: [] };
    const lamps: THREE.Matrix4[] = [];
    let vertexCursor = 0;
    const place = (g: THREE.BufferGeometry, r: { x1: number; y1: number; x2: number; y2: number }, along: number, side: number, y: number) => {
      const angle = Math.atan2(r.y2 - r.y1, r.x2 - r.x1);
      const m = new THREE.Matrix4()
        .makeTranslation((r.x1 + r.x2) / 2 - HALF, y, (r.y1 + r.y2) / 2 - HALF)
        .multiply(new THREE.Matrix4().makeRotationY(-angle))
        .multiply(new THREE.Matrix4().makeTranslation(along, 0, side))
        .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      return g.applyMatrix4(m);
    };
    for (const r of city.roads) {
      const def = ROADS[r.type];
      const len = segmentLength(r);
      this.roadSegs.set(r.id, { ...r, width: def.width });
      // Asphalte + raccords arrondis aux extrémités (jonctions et virages propres).
      const parts = [
        place(new THREE.PlaneGeometry(len, def.width), r, 0, 0, 0.18),
        place(new THREE.CircleGeometry(def.width / 2, 20), r, -len / 2, 0, 0.185),
        place(new THREE.CircleGeometry(def.width / 2, 20), r, len / 2, 0, 0.185),
      ].map((g) => g.toNonIndexed());
      const merged = mergeGeometries(parts)!;
      merged.deleteAttribute('uv');
      const count = merged.getAttribute('position').count;
      this.roadRanges.set(r.id, { start: vertexCursor, count });
      vertexCursor += count;
      asphalt.push(merged);
      // Bordures et marquages s'arrêtent avant les carrefours.
      const inner = Math.max(0, len - def.width * 1.2);
      if (inner >= 1) {
        for (const side of [-1, 1]) curbs.push(place(new THREE.PlaneGeometry(inner, 1.4), r, 0, side * (def.width / 2 - 0.7), 0.2).toNonIndexed());
        const line = new THREE.PlaneGeometry(inner, r.type === 'avenue' ? 0.9 : 0.5);
        const uv = line.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * Math.max(1, inner / 12));
        marks[r.type === 'avenue' ? 'yellow' : 'white'].push(place(line, r, 0, 0, 0.22).toNonIndexed());
      }
      // Lampadaires tous les 40 m, d'un seul côté.
      const n = Math.floor(len / 40);
      const angle = Math.atan2(r.y2 - r.y1, r.x2 - r.x1);
      for (let k = 0; k <= n; k++) {
        const along = -len / 2 + (n ? (k * len) / n : len / 2);
        const base = new THREE.Matrix4()
          .makeTranslation((r.x1 + r.x2) / 2 - HALF, 0, (r.y1 + r.y2) / 2 - HALF)
          .multiply(new THREE.Matrix4().makeRotationY(-angle))
          .multiply(new THREE.Matrix4().makeTranslation(along, 0, def.width / 2 + 0.6));
        lamps.push(base);
      }
    }
    if (asphalt.length) {
      const geo = mergeGeometries(asphalt)!;
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 3), 3));
      this.asphaltMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
      this.asphaltMesh.receiveShadow = true;
      this.roadGroup.add(this.asphaltMesh);
    }
    if (curbs.length) {
      const m = new THREE.Mesh(mergeGeometries(curbs)!, solid(0xb9bcc0));
      m.receiveShadow = true;
      this.roadGroup.add(m);
    }
    const tex = dashTexture();
    for (const [color, list] of [[0xffffff, marks.white], [0xfacc15, marks.yellow]] as const) {
      if (!list.length) continue;
      this.roadGroup.add(new THREE.Mesh(mergeGeometries(list)!, new THREE.MeshBasicMaterial({ map: tex, transparent: true, color })));
    }
    if (lamps.length) {
      const poles = new THREE.InstancedMesh(sharedGeometry('lamp-pole', () => new THREE.CylinderGeometry(0.12, 0.15, 6, 5)), solid(0x4b5563), lamps.length);
      const bulbs = new THREE.InstancedMesh(sharedGeometry('lamp-bulb', () => new THREE.SphereGeometry(0.45, 8, 6)), this.lampMaterial, lamps.length);
      lamps.forEach((m, i) => {
        poles.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 3, 0)));
        bulbs.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 6.1, 0)));
      });
      poles.castShadow = !this.low;
      this.roadGroup.add(poles, bulbs);
    }
    this.colorRoads(city, layers, layer);
  }

  /** Couleur de l'asphalte par route : trafic, ou route non raccordée. */
  private colorRoads(city: CityState, layers: CityLayers | null, layer: CityLayer) {
    if (!this.asphaltMesh) return;
    const attr = this.asphaltMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (const r of city.roads) {
      const range = this.roadRanges.get(r.id);
      if (!range) continue;
      const connected = layers?.roadConnected[r.id] ?? true;
      if (layer === 'traffic') c.copy(ramp(1 - Math.min(1.2, layers?.roadLoad[r.id] ?? 0) / 1.2));
      else c.setHex(connected ? 0x3b3f45 : 0x6b4a3a);
      for (let i = range.start; i < range.start + range.count; i++) attr.setXYZ(i, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  /** Arbres décoratifs sur les terrains libres (plus denses sur les collines). */
  private placeTrees(city: CityState) {
    if (this.trees) {
      this.scene.remove(this.trees.trunks, this.trees.crowns);
      this.trees.trunks.dispose();
      this.trees.crowns.dispose();
    }
    const rnd = mulberry32(hashString(city.cityId) ^ 0x51ed27);
    const t = generateTerrain(city.cityId);
    const spots: [number, number, number][] = [];
    const rects = city.buildings.map((b) => footprint(b.type, b.x, b.y, b.rotation));
    for (let i = 0; i < 2600 && spots.length < (this.low ? 250 : 900); i++) {
      const x = rnd() * CITY_SIZE_M;
      const y = rnd() * CITY_SIZE_M;
      const kind = terrainAt(t, x, y);
      if (kind === TerrainKind.Water) continue;
      if (kind === TerrainKind.Land && rnd() < 0.72) continue;
      if (Math.hypot(x - REGIONAL_ACCESS.x, y - REGIONAL_ACCESS.y) < 60) continue;
      if (rects.some((r) => x > r.minX - 4 && x < r.maxX + 4 && y > r.minY - 4 && y < r.maxY + 4)) continue;
      if (city.roads.some((r) => distToSeg(x, y, r) < ROADS[r.type].width / 2 + 4)) continue;
      spots.push([x, y, 0.7 + rnd() * 0.8]);
    }
    const trees = treeInstances(spots.length);
    const mtx = new THREE.Matrix4();
    const greens = [0x3f7d3a, 0x4f8f3f, 0x2f6b3a, 0x5c9a46, 0x6a8f3a];
    spots.forEach(([x, y, s], i) => {
      mtx.compose(new THREE.Vector3(x - HALF, 1.5 * s, y - HALF), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      trees.trunks.setMatrixAt(i, mtx);
      mtx.compose(new THREE.Vector3(x - HALF, 4.6 * s, y - HALF), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 3, 0)), new THREE.Vector3(s, s * (1 + rnd() * 0.4), s));
      trees.crowns.setMatrixAt(i, mtx);
      trees.crowns.setColorAt(i, new THREE.Color(greens[Math.floor(rnd() * greens.length)]!));
    });
    this.trees = trees;
    this.scene.add(trees.trunks, trees.crowns);
  }

  private rebuildOverlays(city: CityState, layers: CityLayers | null, layer: CityLayer, selected: number | null) {
    for (const o of [...this.overlayGroup.children]) {
      o.removeFromParent();
      (o as THREE.Mesh).geometry?.dispose();
      ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose();
    }
    for (const b of city.buildings) {
      const entry = this.buildings.get(b.id);
      if (!entry) continue;
      const def = BUILDINGS[b.type];
      const r = footprint(b.type, b.x, b.y, b.rotation);
      const w = r.maxX - r.minX;
      const d = r.maxY - r.minY;
      const status = layers?.buildingStatus[b.id] ?? 'ok';
      let color: THREE.Color | null = null;
      if (layer === 'status') color = new THREE.Color(status === 'ok' ? 0x22c55e : status === 'disconnected' ? 0xf59e0b : 0xef4444);
      if (layer === 'health' || layer === 'education' || layer === 'safety' || layer === 'leisure') {
        const cov = layers?.residentialCoverage[b.id]?.[layer];
        if (cov !== undefined) color = ramp(cov);
      }
      if (layer === 'pollution') {
        const p = layers?.pollution[b.id];
        if (p !== undefined) color = ramp(1 - p);
        else if (def.pollution) color = new THREE.Color(0x92400e);
      }
      if (color) {
        const tint = new THREE.Mesh(
          new THREE.BoxGeometry(w + 1.5, entry.info.height + 1.5, d + 1.5),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }),
        );
        tint.position.set(b.x - HALF, entry.info.height / 2, b.y - HALF);
        this.overlayGroup.add(tint);
      }
      if (status !== 'ok' && layer !== 'status') {
        const warn = new THREE.Mesh(new THREE.OctahedronGeometry(2.4, 0), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
        warn.position.set(b.x - HALF, entry.info.height + 6, b.y - HALF);
        warn.userData.bob = entry.info.height + 6;
        this.overlayGroup.add(warn);
      }
      if (b.id === selected) {
        const sel = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 2, entry.info.height + 2, d + 2)),
          new THREE.LineBasicMaterial({ color: 0xffffff }),
        );
        sel.position.set(b.x - HALF, entry.info.height / 2, b.y - HALF);
        this.overlayGroup.add(sel);
      }
      // Zones de service ou de pollution.
      const radius = layer === 'pollution' ? def.pollution?.radius : def.service?.kind === layer ? def.service.radius : undefined;
      if (radius) {
        const ring = new THREE.Mesh(
          new THREE.CircleGeometry(radius, 64),
          new THREE.MeshBasicMaterial({ color: layer === 'pollution' ? 0xb45309 : 0x60a5fa, transparent: true, opacity: 0.13, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(b.x - HALF, 0.4, b.y - HALF);
        this.overlayGroup.add(ring);
      }
    }
  }

  setGrid(on: boolean) {
    for (const o of [...this.gridGroup.children]) o.removeFromParent();
    if (!on) return;
    const fine = new THREE.GridHelper(CITY_SIZE_M, CITY_SIZE_M / 10, 0xffffff, 0xffffff);
    (fine.material as THREE.Material).transparent = true;
    (fine.material as THREE.Material).opacity = 0.05;
    fine.position.y = 0.25;
    const coarse = new THREE.GridHelper(CITY_SIZE_M, CITY_SIZE_M / 50, 0xffffff, 0xffffff);
    (coarse.material as THREE.Material).transparent = true;
    (coarse.material as THREE.Material).opacity = 0.14;
    coarse.position.y = 0.26;
    this.gridGroup.add(fine, coarse);
  }

  setPreview(p: Preview) {
    for (const o of [...this.previewGroup.children]) o.removeFromParent();
    if (!p) return;
    if (p.kind === 'building') {
      const { group } = buildModel(p.type, 1);
      const mat = new THREE.MeshBasicMaterial({ color: p.ok ? 0x22c55e : 0xef4444, transparent: true, opacity: 0.55, depthWrite: false });
      group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).material = mat; (o as THREE.Mesh).castShadow = false; } });
      placeModel(group, p, HALF);
      const r = footprint(p.type, p.x, p.y, p.rotation);
      const base = new THREE.Mesh(
        new THREE.PlaneGeometry(r.maxX - r.minX + 6, r.maxY - r.minY + 6),
        new THREE.MeshBasicMaterial({ color: p.ok ? 0x22c55e : 0xef4444, transparent: true, opacity: 0.3, depthWrite: false }),
      );
      base.rotation.x = -Math.PI / 2;
      base.position.set(p.x - HALF, 0.5, p.y - HALF);
      this.previewGroup.add(group, base);
    } else if (p.kind === 'road') {
      const { seg } = p;
      const len = Math.max(1, segmentLength(seg));
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(len + ROADS[p.road].width, ROADS[p.road].width),
        new THREE.MeshBasicMaterial({ color: p.ok ? 0x22c55e : 0xef4444, transparent: true, opacity: 0.6, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.add(m);
      g.position.set((seg.x1 + seg.x2) / 2 - HALF, 0.5, (seg.y1 + seg.y2) / 2 - HALF);
      g.rotation.y = -Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
      this.previewGroup.add(g);
    } else if (p.kind === 'path') {
      for (let i = 0; i < p.points.length - 1; i++) {
        this.setPreviewSegment(p.road, { x1: p.points[i]!.x, y1: p.points[i]!.y, x2: p.points[i + 1]!.x, y2: p.points[i + 1]!.y }, p.ok);
      }
    } else if (p.kind === 'cursor') {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 1, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      dot.position.set(p.x - HALF, 0.6, p.y - HALF);
      this.previewGroup.add(dot);
    } else if (p.kind === 'demolish' && p.target) {
      if (p.target.kind === 'building') {
        const e = this.buildings.get(p.target.id);
        if (e) {
          const box = new THREE.Box3().setFromObject(e.obj);
          const helper = new THREE.Box3Helper(box, new THREE.Color(0xef4444));
          this.previewGroup.add(helper);
        }
      } else {
        const r = this.roadSegs.get(p.target.id);
        if (r) {
          const box = new THREE.Box3(
            new THREE.Vector3(Math.min(r.x1, r.x2) - HALF - r.width / 2, 0, Math.min(r.y1, r.y2) - HALF - r.width / 2),
            new THREE.Vector3(Math.max(r.x1, r.x2) - HALF + r.width / 2, 3, Math.max(r.y1, r.y2) - HALF + r.width / 2),
          );
          this.previewGroup.add(new THREE.Box3Helper(box, new THREE.Color(0xef4444)));
        }
      }
    }
  }

  private setPreviewSegment(road: RoadType, seg: Segment, ok: boolean) {
    const len = Math.max(1, segmentLength(seg));
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(len + ROADS[road].width, ROADS[road].width),
      new THREE.MeshBasicMaterial({ color: ok ? 0x22c55e : 0xef4444, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    g.add(m);
    g.position.set((seg.x1 + seg.x2) / 2 - HALF, 0.5, (seg.y1 + seg.y2) / 2 - HALF);
    g.rotation.y = -Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
    this.previewGroup.add(g);
  }

  /** Heure de jeu (0–24) : position du soleil, éclairage, fenêtres et lampadaires. */
  /** Heure imposée (automatisation, bande-annonce) : ignore l'heure du jeu tant qu'elle est définie. */
  timeOverride: number | null = null;

  setTimeOfDay(hour: number, cycle: boolean) {
    const h = this.timeOverride ?? (cycle ? hour : 11);
    const key = Math.round(h * 4) / 4;
    if (key === this.lastSkyHour) return;
    this.lastSkyHour = key;
    const elevation = Math.sin(((h - 6) / 24) * Math.PI * 2) * 62;
    const azimuth = 120 + (h / 24) * 180;
    const phi = THREE.MathUtils.degToRad(90 - Math.max(elevation, -8));
    const theta = THREE.MathUtils.degToRad(azimuth);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition!.value.copy(dir);
    const day = THREE.MathUtils.smoothstep(elevation, -6, 12);
    this.night = 1 - day;
    // La nuit, un clair de lune bleuté garde la ville lisible.
    this.sun.intensity = 0.7 + 1.5 * day;
    if (day > 0.2) this.sun.color.setHSL(0.09, 0.5 * (1 - day) + 0.15, 0.8 + 0.15 * day);
    else this.sun.color.setHSL(0.62, 0.35, 0.75);
    this.hemi.intensity = 0.55 + 0.15 * day;
    this.renderer.toneMappingExposure = 0.6 + 0.15 * day;
    (this.scene.fog as THREE.Fog).color.setHSL(0.6, 0.35, 0.12 + 0.68 * day);
    for (const m of windowMaterials) m.emissiveIntensity = 1.4 * this.night;
    this.lampMaterial.emissiveIntensity = 2.2 * this.night;
    // La nuit, la lumière directionnelle devient une lune haute (sinon le sol serait éclairé par-dessous).
    const light = day > 0.15 ? dir : new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), theta + Math.PI);
    this.sunOffset.copy(light).multiplyScalar(1500);
    // Éclairage d'ambiance : dégradé ciel/horizon/sol sans disque solaire (le disque du shader
    // Sky dépasse la plage des textures demi-flottantes et rendrait l'environnement invalide).
    const top = new THREE.Color().setHSL(0.58, 0.55, 0.08 + 0.5 * day);
    const horizon = new THREE.Color().setHSL(0.08 + 0.5 * day, 0.35, 0.12 + 0.6 * day);
    const bottom = new THREE.Color().setHSL(0.25, 0.2, 0.05 + 0.2 * day);
    this.scene.environmentIntensity = 0.12 + 0.3 * day;
    // L'environnement (coûteux à préfiltrer) n'est régénéré qu'une fois par heure de jeu.
    const envKey = Math.round(h);
    if (envKey === this.lastEnvHour) return;
    this.lastEnvHour = envKey;
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(100, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { top: { value: top }, horizon: { value: horizon }, bottom: { value: bottom } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
          void main() { float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.4));
          gl_FragColor = vec4(c, 1.0); }`,
      }),
    ));
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(envScene);
    this.scene.environment = this.envTarget.texture;
  }

  private readonly sunOffset = new THREE.Vector3(800, 1200, 600);

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    this.timer.update();
    this.step(this.timer.getDelta());
  };

  private elapsed = 0;

  /** Avance les animations de `dt` secondes et dessine une image (aussi appelé par l'automatisation). */
  step(dt: number) {
    this.elapsed += dt;
    const t = this.elapsed;
    this.controls.update();
    // Garder la cible dans les environs de la ville.
    const tg = this.controls.target;
    tg.x = THREE.MathUtils.clamp(tg.x, -HALF - 300, HALF + 300);
    tg.z = THREE.MathUtils.clamp(tg.z, -HALF - 300, HALF + 300);
    tg.y = 0;
    // L'ombre suit la zone regardée.
    this.sun.position.copy(tg).add(this.sunOffset);
    this.sun.target.position.copy(tg);
    for (const e of this.buildings.values()) {
      for (const s of e.smoke) {
        const pos = s.geometry.getAttribute('position') as THREE.BufferAttribute;
        const phases = s.userData.phase as number[];
        const o = s.userData.origin as THREE.Vector3;
        for (let i = 0; i < phases.length; i++) {
          phases[i] = (phases[i]! + dt * 0.12) % 1;
          const f = phases[i]!;
          pos.setXYZ(i, o.x + Math.sin(f * 7 + i) * 2 + f * 12, o.y + f * 45, o.z + Math.cos(f * 5 + i) * 2);
        }
        pos.needsUpdate = true;
      }
    }
    for (const o of this.overlayGroup.children) {
      if (o.userData.bob !== undefined) {
        o.position.y = (o.userData.bob as number) + Math.sin(t * 3) * 1.2;
        o.rotation.y += dt * 2;
      }
    }
    this.moveCars(dt);
    this.moveVehicles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Bruit de valeur interpolé (grille 64×64 périodique). */
function smoothNoise(grid: Float32Array, x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) => grid[(((j % 64) + 64) % 64) * 64 + (((i % 64) + 64) % 64)]!;
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Petit véhicule (bus, tram, rame) : caisse colorée et vitres. */
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

function distToSeg(x: number, y: number, s: Segment) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / l2));
  return Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy));
}

let dash: THREE.CanvasTexture | null = null;
function dashTexture() {
  if (dash) return dash;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 36, 8);
  dash = new THREE.CanvasTexture(c);
  dash.wrapS = THREE.RepeatWrapping;
  return dash;
}
