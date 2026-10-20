// Scène 3D d'une ville : terrain, eau, ciel dynamique (cycle jour/nuit lié au temps de jeu),
// routes, bâtiments procéduraux, arbres, couches d'information et aperçu de construction.
import * as THREE from 'three';
import { captureMode, expose } from '../automation.ts';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  BUILDINGS, CITY_SIZE_M, footprint, generateTerrain, hashString, mulberry32, REGIONAL_ACCESS, ROADS, segmentLength,
  roadTerrain, terrainAt, TerrainKind, analyzeLayout, type BuildingType, type CityLayers, type CityLayout, type CityState, type Point, type RoadType, type Segment,
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
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.sky.scale.setScalar(10000);
    const u = this.sky.material.uniforms;
    u.turbidity!.value = 6;
    u.rayleigh!.value = 1.6;
    u.mieCoefficient!.value = 0.004;
    u.mieDirectionalG!.value = 0.8;
    this.scene.add(this.sky);
    this.scene.background = new THREE.Color(0x1d2b45);
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
    this.lastCity = city;
    if (city.cityId !== this.cityId) {
      this.loadTerrain(city.cityId);
      if (!this.street) this.viewFromAbove();
    }
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
      if (this.bridges.length) pos.y = 0.9 + this.deckHeightAt(pos.x, pos.z);
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
  /** Tabliers surélevés (coordonnées de scène) : hauteur des voitures sur les ponts. */
  private bridges: { x1: number; z1: number; x2: number; z2: number; len: number; width: number; profile: (along: number) => number }[] = [];

  /** Hauteur du tablier au point (x, z) de la scène (0 hors des ponts). */
  private deckHeightAt(x: number, z: number): number {
    let best = 0;
    for (const b of this.bridges) {
      const dx = b.x2 - b.x1, dz = b.z2 - b.z1;
      const t = ((x - b.x1) * dx + (z - b.z1) * dz) / (b.len * b.len || 1);
      if (t < 0 || t > 1) continue;
      const px = b.x1 + dx * t, pz = b.z1 + dz * t;
      if (Math.hypot(x - px, z - pz) > b.width / 2 + 1) continue;
      best = Math.max(best, b.profile(t * b.len - b.len / 2));
    }
    return best;
  }

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
    const concrete: THREE.BufferGeometry[] = [];
    let vertexCursor = 0;
    const terrain = generateTerrain(city.cityId);
    this.bridges = [];
    /**
     * Place une géométrie le long d'un tronçon. Par défaut, un plan XY est couché au sol (face vers le haut) ;
     * `flat = false` le laisse debout (bordure, poutre), `down = true` le couche face vers le bas (sous-face).
     */
    const place = (g: THREE.BufferGeometry, r: { x1: number; y1: number; x2: number; y2: number }, along: number, side: number, y: number, flat = true, down = false) => {
      const angle = Math.atan2(r.y2 - r.y1, r.x2 - r.x1);
      const m = new THREE.Matrix4()
        .makeTranslation((r.x1 + r.x2) / 2 - HALF, y, (r.y1 + r.y2) / 2 - HALF)
        .multiply(new THREE.Matrix4().makeRotationY(-angle))
        .multiply(new THREE.Matrix4().makeTranslation(along, 0, side));
      if (flat) m.multiply(new THREE.Matrix4().makeRotationX(down ? Math.PI / 2 : -Math.PI / 2));
      return g.applyMatrix4(m);
    };
    for (const r of city.roads) {
      const def = ROADS[r.type];
      const len = segmentLength(r);
      this.roadSegs.set(r.id, { ...r, width: def.width });
      // Pont (ou ancienne route au-dessus de l'eau) : tablier surélevé avec rampes aux extrémités.
      const elevated = r.type === 'bridge' || roadTerrain(terrain, r).bridgeLength > 0;
      const profile = elevated ? bridgeProfile(len) : null;
      const h = (along: number) => (profile ? profile(along) : 0);
      if (profile) {
        this.bridges.push({ x1: r.x1 - HALF, z1: r.y1 - HALF, x2: r.x2 - HALF, z2: r.y2 - HALF, len, width: def.width, profile });
        const segs = Math.max(2, Math.ceil(len / 5));
        // Poutres latérales, sous-face, garde-corps et piles.
        for (const side of [-1, 1]) {
          concrete.push(place(lift(new THREE.PlaneGeometry(len, 1.4, segs, 1), (x, y) => h(x) - 0.7 + y, 'standing'), r, 0, side * def.width / 2, 0, false).toNonIndexed());
          concrete.push(place(lift(new THREE.PlaneGeometry(len, 1.1, segs, 1), (x, y) => h(x) + 0.75 + y, 'standing'), r, 0, side * (def.width / 2 - 0.2), 0, false).toNonIndexed());
        }
        concrete.push(place(lift(new THREE.PlaneGeometry(len, def.width, segs, 1), (x) => h(x) - 1.4, 'down'), r, 0, 0, 0, true, true).toNonIndexed());
        for (let a = -len / 2 + 12; a <= len / 2 - 12; a += 24) {
          const top = h(a) - 1.4;
          if (top < 1.5) continue;
          const pile = new THREE.CylinderGeometry(1.1, 1.4, top + 4, 8);
          pile.translate(0, (top - 4) / 2, 0);
          concrete.push(place(pile, r, a, 0, 0, false).toNonIndexed());
        }
      }
      // Asphalte + raccords arrondis aux extrémités (jonctions et virages propres).
      const deck = profile
        ? place(lift(new THREE.PlaneGeometry(len, def.width, Math.max(2, Math.ceil(len / 5)), 1), (x) => h(x)), r, 0, 0, 0.18)
        : place(new THREE.PlaneGeometry(len, def.width), r, 0, 0, 0.18);
      const parts = [
        deck,
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
        const segs = profile ? Math.max(2, Math.ceil(inner / 5)) : 1;
        if (!profile) for (const side of [-1, 1]) curbs.push(place(new THREE.PlaneGeometry(inner, 1.4), r, 0, side * (def.width / 2 - 0.7), 0.2).toNonIndexed());
        const line = lift(new THREE.PlaneGeometry(inner, r.type === 'avenue' ? 0.9 : 0.5, segs, 1), (x) => h(x));
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
          .multiply(new THREE.Matrix4().makeTranslation(along, h(along), profile ? def.width / 2 - 0.6 : def.width / 2 + 0.6));
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
    if (concrete.length) {
      for (const g of concrete) for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      const m = new THREE.Mesh(mergeGeometries(concrete)!, solid(0xc4c0b8, { side: THREE.DoubleSide }));
      m.castShadow = m.receiveShadow = true;
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
    // Le shader de ciel devient noir une fois le soleil couché : la nuit, un ciel bleu nuit le remplace.
    this.sky.visible = day > 0.08;
    (this.scene.background as THREE.Color).setHSL(0.62, 0.45, 0.13 + 0.25 * day);
    // La nuit, un clair de lune bleuté garde la ville lisible.
    this.sun.intensity = 1.0 + 1.2 * day;
    if (day > 0.2) this.sun.color.setHSL(0.09, 0.5 * (1 - day) + 0.15, 0.8 + 0.15 * day);
    else this.sun.color.setHSL(0.62, 0.35, 0.75);
    this.hemi.intensity = 0.8 + 0.1 * day;
    this.renderer.toneMappingExposure = 0.78 + 0.07 * day;
    (this.scene.fog as THREE.Fog).color.setHSL(0.6, 0.35, 0.2 + 0.6 * day);
    for (const m of windowMaterials) m.emissiveIntensity = 1.4 * this.night;
    this.lampMaterial.emissiveIntensity = 2.2 * this.night;
    // La nuit, la lumière directionnelle devient une lune haute (sinon le sol serait éclairé par-dessous).
    const light = day > 0.15 ? dir : new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), theta + Math.PI);
    this.sunOffset.copy(light).multiplyScalar(1500);
    // Éclairage d'ambiance : dégradé ciel/horizon/sol sans disque solaire (le disque du shader
    // Sky dépasse la plage des textures demi-flottantes et rendrait l'environnement invalide).
    const top = new THREE.Color().setHSL(0.6, 0.5, 0.16 + 0.42 * day);
    const horizon = new THREE.Color().setHSL(0.08 + 0.5 * day, 0.35, 0.2 + 0.52 * day);
    const bottom = new THREE.Color().setHSL(0.25, 0.2, 0.1 + 0.15 * day);
    this.scene.environmentIntensity = 0.3 + 0.12 * day;
    // L'environnement (coûteux à préfiltrer) n'est régénéré qu'une fois par heure de jeu.
    const envKey = Math.round(h);
    if (envKey === this.lastEnvHour || this.contextLost) return;
    this.lastEnvHour = envKey;
    // Une seule scène d'environnement, réutilisée : seules ses couleurs changent (pas de fuite de mémoire
    // graphique, qui finissait par faire perdre le contexte WebGL et noircir l'écran).
    const u = this.envMaterial.uniforms;
    u.top!.value.copy(top);
    u.horizon!.value.copy(horizon);
    u.bottom!.value.copy(bottom);
    const previous = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene);
    this.scene.environment = this.envTarget.texture;
    previous?.dispose();
  }

  private readonly envMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main() { float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.4));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  private readonly envScene = new THREE.Scene().add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.envMaterial));

  private readonly sunOffset = new THREE.Vector3(800, 1200, 600);

  // --- Caméras : vue du dessus et vue de rue ---------------------------------------------------

  private lastCity: CityState | null = null;

  /** Vue du dessus (par défaut) cadrée sur la partie construite, ou sur l'accès régional d'une ville vide. */
  viewFromAbove() {
    if (this.street) this.exitStreetView();
    const c = this.lastCity;
    let minX: number = REGIONAL_ACCESS.x, maxX: number = REGIONAL_ACCESS.x + 300;
    let minY: number = REGIONAL_ACCESS.y - 150, maxY: number = REGIONAL_ACCESS.y + 150;
    const pts: Point[] = [];
    for (const b of c?.buildings ?? []) pts.push({ x: b.x, y: b.y });
    for (const r of c?.roads ?? []) pts.push({ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 });
    if (pts.length) {
      minX = Math.min(...pts.map((q) => q.x)); maxX = Math.max(...pts.map((q) => q.x));
      minY = Math.min(...pts.map((q) => q.y)); maxY = Math.max(...pts.map((q) => q.y));
    }
    const cx = (minX + maxX) / 2 - HALF;
    const cz = (minY + maxY) / 2 - HALF;
    const extent = Math.max(maxX - minX, (maxY - minY) * this.camera.aspect, 200);
    const height = THREE.MathUtils.clamp(extent / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.15, 220, 2400);
    this.controls.target.set(cx, 0, cz);
    // Presque à la verticale (~7°) : le nord reste en haut de l'écran et les hauteurs se lisent encore.
    this.camera.position.set(cx, height, cz + height * 0.12);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  /** Recentre la vue aérienne sur un point de la ville (coordonnées de jeu), à distance de lecture. */
  focusOn(x: number, y: number) {
    if (this.street) this.exitStreetView();
    const target = new THREE.Vector3(x - HALF, 0, y - HALF);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.length() > 320 || offset.length() < 60) offset.setLength(260);
    if (offset.y < 80) offset.y = 120;
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.controls.update();
  }

  /** Vue de rue : caméra libre au ras du sol (souris pour regarder, ZQSD/WASD pour se déplacer). */
  street = false;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  /** Notifié à chaque entrée/sortie de la vue de rue ou de la capture de la souris. */
  onStreetChange: ((state: { street: boolean; locked: boolean }) => void) | null = null;

  private readonly onKey = (e: KeyboardEvent) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement | null)?.tagName ?? '')) return;
    // e.code désigne la touche physique : ZQSD en AZERTY et WASD en QWERTY donnent les mêmes codes.
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (e.type === 'keydown' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };
  private readonly onBlur = () => this.keys.clear();
  private readonly onMouseMove = (e: MouseEvent) => {
    const locked = document.pointerLockElement === this.renderer.domElement;
    // Sans capture de la souris (refusée, ou tactile), on regarde en glissant avec le bouton enfoncé.
    if (!locked && !(e.buttons & 1)) return;
    this.look(e.movementX, e.movementY);
  };
  private readonly onLockChange = () => {
    this.onStreetChange?.({ street: this.street, locked: document.pointerLockElement === this.renderer.domElement });
  };
  private touchLast: { x: number; y: number } | null = null;
  private readonly onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    if (this.touchLast) this.look(t.clientX - this.touchLast.x, t.clientY - this.touchLast.y);
    this.touchLast = { x: t.clientX, y: t.clientY };
  };
  private readonly onTouchEnd = () => { this.touchLast = null; };

  private look(dx: number, dy: number) {
    this.yaw -= dx * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0025, -1.45, 1.45);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  enterStreetView() {
    if (this.street) return;
    this.street = true;
    this.controls.enabled = false;
    // Départ au centre de la vue actuelle, à hauteur d'yeux, dans la direction où regardait la caméra.
    const tg = this.controls.target;
    const dir = tg.clone().sub(this.camera.position).setY(0);
    this.yaw = dir.lengthSq() > 1 ? Math.atan2(-dir.x, -dir.z) : 0;
    this.pitch = 0;
    this.camera.position.set(tg.x, 1.7, tg.z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    this.camera.near = 0.2;
    this.camera.updateProjectionMatrix();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.renderer.domElement.addEventListener('touchmove', this.onTouchMove, { passive: true });
    this.renderer.domElement.addEventListener('touchend', this.onTouchEnd);
    this.onStreetChange?.({ street: true, locked: false });
  }

  /** Capture la souris (à appeler depuis un clic). */
  lockPointer() {
    if (!this.street || document.pointerLockElement === this.renderer.domElement) return;
    try {
      const r = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => { /* refusé : on regarde en glissant */ });
    } catch { /* idem */ }
  }

  exitStreetView() {
    if (!this.street) return;
    this.street = false;
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.renderer.domElement.removeEventListener('touchmove', this.onTouchMove);
    this.renderer.domElement.removeEventListener('touchend', this.onTouchEnd);
    this.keys.clear();
    this.camera.near = 1;
    this.camera.updateProjectionMatrix();
    // Retour en vue aérienne au-dessus de l'endroit visité.
    const p = this.camera.position;
    this.controls.target.set(p.x, 0, p.z);
    this.camera.position.set(p.x, 420, p.z + 50);
    this.controls.enabled = true;
    this.controls.update();
    this.onStreetChange?.({ street: false, locked: false });
  }

  private moveStreet(dt: number) {
    const k = this.keys;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = (run ? 28 : 7) * Math.min(dt, 0.25);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (move.lengthSq() > 0) this.camera.position.addScaledVector(move.normalize(), speed);
    // Caméra libre : Espace monte, C descend (jamais sous la hauteur d'yeux).
    if (k.has('Space') || k.has('KeyE')) this.camera.position.y += speed * 0.8;
    if (k.has('KeyC') || k.has('KeyQ')) this.camera.position.y -= speed * 0.8;
    const p = this.camera.position;
    p.x = THREE.MathUtils.clamp(p.x, -HALF - 200, HALF + 200);
    p.z = THREE.MathUtils.clamp(p.z, -HALF - 200, HALF + 200);
    p.y = THREE.MathUtils.clamp(p.y, 1.7, 600);
  }

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
    // Retour d'un onglet en arrière-plan : on n'avance pas les animations de plusieurs minutes d'un coup.
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.contextLost) return;
    this.step(dt);
  };

  private elapsed = 0;

  /** Avance les animations de `dt` secondes et dessine une image (aussi appelé par l'automatisation). */
  step(dt: number) {
    this.elapsed += dt;
    const t = this.elapsed;
    let tg: THREE.Vector3;
    if (this.street) {
      this.moveStreet(dt);
      // L'ombre couvre la zone devant le promeneur.
      tg = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize().multiplyScalar(120).add(this.camera.position).setY(0);
    } else {
      this.controls.update();
      // Garder la cible dans les environs de la ville.
      tg = this.controls.target;
      tg.x = THREE.MathUtils.clamp(tg.x, -HALF - 300, HALF + 300);
      tg.z = THREE.MathUtils.clamp(tg.z, -HALF - 300, HALF + 300);
      tg.y = 0;
    }
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
    this.exitStreetView();
    this.controls.dispose();
    this.envTarget?.dispose();
    this.envMaterial.dispose();
    this.pmrem.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.dispose();
    // Libère réellement le contexte : le navigateur n'en garde que quelques-uns (globe ⇄ ville répétés).
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // --- Perte du contexte WebGL (pilote, mémoire, onglet en veille) ------------------------------

  contextLost = false;
  /** Notifié lors d'une perte ou d'une reprise du contexte (affichage d'un message, recréation). */
  onContextChange: ((lost: boolean) => void) | null = null;
  private readonly onContextLost = (e: Event) => {
    // Sans preventDefault, le navigateur ne tente jamais de restaurer le contexte.
    e.preventDefault();
    this.contextLost = true;
    this.onContextChange?.(true);
  };
  private readonly onContextRestored = () => {
    this.contextLost = false;
    // Three.js renvoie les ressources au GPU ; l'environnement (rendu hors écran) doit être recalculé.
    this.lastSkyHour = -1;
    this.lastEnvHour = -1;
    this.envTarget = null;
    this.onContextChange?.(false);
  };
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

/** Profil d'un tablier : 0 aux extrémités, rampes adoucies, hauteur maximale au milieu (abscisse centrée). */
function bridgeProfile(len: number): (along: number) => number {
  const height = Math.min(8, Math.max(2.5, len * 0.12));
  const ramp = Math.min(len / 2, 30);
  return (along: number) => {
    const d = Math.max(0, len / 2 - Math.abs(along));
    const t = Math.min(1, d / ramp);
    return height * t * t * (3 - 2 * t);
  };
}

/**
 * Décale verticalement les sommets d'un plan avant sa mise en place, x étant l'abscisse le long du tronçon :
 * plan couché (`z` devient la hauteur), debout (`y`) ou couché face vers le bas (sous-face).
 */
function lift(g: THREE.PlaneGeometry, f: (x: number, y: number) => number, mode: 'lying' | 'standing' | 'down' = 'lying'): THREE.PlaneGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    if (mode === 'standing') pos.setY(i, f(x, y));
    else pos.setZ(i, mode === 'down' ? -f(x, y) : f(x, y));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
