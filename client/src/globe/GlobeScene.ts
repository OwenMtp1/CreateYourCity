// Globe 3D : texture politique (Natural Earth), frontières vectorielles, atmosphère, villes,
// armées et sièges. Classe impérative indépendante de React.
import { geoContains, geoEquirectangular, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import * as THREE from 'three';
import { captureMode, expose } from '../automation.ts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import countries110Url from 'world-atlas/countries-110m.json?url';
import countries50Url from 'world-atlas/countries-50m.json?url';
import { WORLD_CITIES, type WorldCity } from '@cyc/shared/world';
import { hashString } from '@cyc/shared';
import { getQuality } from '../city3d/quality.ts';

export type Relation = 'mine' | 'ally' | 'enemy' | 'other';

export interface GlobeArmy {
  id: number;
  position: [number, number];
  destination: [number, number] | null;
  relation: Relation;
  size: number;
  kind: 'land' | 'naval' | 'air';
}

export interface GlobeData {
  owners: Map<string, { relation: Relation; label: string; independent?: boolean; skyline?: number[] }>;
  playedCountries: Set<string>;
  selectedCountry: string | null;
  selectedCity: string | null;
  armies: GlobeArmy[];
  sieges: string[];
  /** Routes commerciales (contrats) : extrémités et statut. */
  routes: { from: [number, number]; to: [number, number]; active: boolean }[];
  /** Lignes de front entre villes ennemies proches. */
  fronts: { from: [number, number]; to: [number, number] }[];
  /** Batailles en rase campagne. */
  battles: [number, number][];
}

export interface GlobePick { cityId?: string; countryId?: string }

interface CountryShape { id: string; feature: GeoPermissibleObjects }

const RELATION_COLOR: Record<Relation, number> = { mine: 0xfbbf24, ally: 0x34d399, enemy: 0xf87171, other: 0xa78bfa };
/** Couleur unique des villes occupées par un joueur ; rouge pour les dictatures indépendantes. */
const OCCUPIED_COLOR = 0x22c55e;
const DICTATOR_COLOR = 0xef4444;
const TEX_W = 4096;
/** Rayon d'un territoire contrôlé autour de chaque ville, en kilomètres. */
const TERRITORY_KM = 120;
/** Couleur des territoires : vous, vos alliés, les autres. */
const TERRITORY_COLOR: Record<Relation, string> = { mine: '#22c55e', ally: '#3b82f6', enemy: '#ef4444', other: '#ef4444' };
const CITY_BY_ID_MAP = new Map(WORLD_CITIES.map((c) => [c.id, c]));
const TEX_H = 2048;

export function latLonToVec(lat: number, lon: number, r = 1): THREE.Vector3 {
  const phi = ((lon + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi));
}

export function vecToLatLon(v: THREE.Vector3): [number, number] {
  const r = v.length();
  const lat = 90 - (Math.acos(v.y / r) * 180) / Math.PI;
  let lon = (Math.atan2(v.z, -v.x) * 180) / Math.PI - 180;
  if (lon < -180) lon += 360;
  return [lat, lon];
}

const countryId = (f: { id?: string | number; properties: { name: string } }) =>
  f.id ? `N${f.id}` : `X-${f.properties.name.replace(/[^A-Za-z]/g, '')}`;

async function loadCountries(url: string): Promise<CountryShape[]> {
  const topo = (await (await fetch(url)).json()) as Topology;
  const fc = feature(topo, topo.objects.countries!) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;
  return fc.features.map((f) => ({ id: countryId(f as never), feature: f }));
}

/** Rang maximal des villes affichées selon la distance de la caméra. */
const rankForDistance = (d: number) => (d > 3.2 ? 1 : d > 2.4 ? 2 : d > 1.8 ? 4 : d > 1.4 ? 6 : d > 1.18 ? 8 : 10);

function landColor(id: string): string {
  // Teintes terreuses variées par pays (déterministe) pour une lecture politique douce.
  const h = hashString(id);
  const hue = 70 + (h % 60);
  const sat = 18 + ((h >> 8) % 14);
  const light = 30 + ((h >> 16) % 10);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export class GlobeScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  onPick: (p: GlobePick) => void = () => {};
  private readonly globe: THREE.Mesh;
  private readonly texCanvas = document.createElement('canvas');
  private readonly specCanvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private countries: CountryShape[] = [];
  private ownersKey = '';
  private borders: THREE.LineSegments | null = null;
  private regions: THREE.LineSegments | null = null;
  private readonly cityPoints: THREE.Points;
  private readonly armyGroup = new THREE.Group();
  private readonly siegeGroup = new THREE.Group();
  private readonly labelLayer: HTMLDivElement;
  private readonly labelPool: HTMLDivElement[] = [];
  private data: GlobeData = { owners: new Map(), playedCountries: new Set(), selectedCountry: null, selectedCity: null, armies: [], sieges: [], routes: [], fronts: [], battles: [] };
  private readonly routeGroup = new THREE.Group();
  private frame = 0;
  private disposed = false;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private readonly cityPositions: THREE.Vector3[];
  private lastRank = -1;
  private readonly timer = new THREE.Timer();
  autoRotate = false;

  constructor(private readonly container: HTMLElement, opts: { interactive: boolean }) {
    const low = getQuality() === 'low';
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, alpha: false, preserveDrawingBuffer: captureMode() });
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
    this.camera.position.copy(latLonToVec(30, 10, 3.2));
    this.scene.background = new THREE.Color(0x05070d);

    // Lumières : une lumière principale liée à la caméra garde la face visible éclairée.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(-2, 2, 3);
    this.camera.add(sun);
    this.scene.add(this.camera);

    // Texture politique.
    this.texCanvas.width = TEX_W;
    this.texCanvas.height = TEX_H;
    this.specCanvas.width = TEX_W / 4;
    this.specCanvas.height = TEX_H / 4;
    this.texture = new THREE.CanvasTexture(this.texCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const spec = new THREE.CanvasTexture(this.specCanvas);
    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 160, 120),
      new THREE.MeshPhongMaterial({ map: this.texture, specularMap: spec, specular: new THREE.Color(0x5577aa), shininess: 22 }),
    );
    this.scene.add(this.globe);
    this.paintTexture();

    // Atmosphère (halo de Fresnel).
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.12, 96, 64),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec3 vNormal; varying vec3 vPos;
          void main() { vNormal = normalize(normalMatrix * normal); vPos = (modelViewMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vNormal; varying vec3 vPos;
          void main() { float i = pow(0.72 - dot(vNormal, normalize(-vPos)), 3.0);
          gl_FragColor = vec4(0.35, 0.6, 1.0, 1.0) * i; }`,
        blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false,
      }),
    );
    this.scene.add(atmosphere);

    // Étoiles (positions déterministes).
    const starPos: number[] = [];
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4000; i++) {
      const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(60 + rnd() * 40);
      starPos.push(v.x, v.y, v.z);
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.8 }),
    );
    this.scene.add(stars);

    // Villes : points ronds avec rang et couleur par sommet, filtrés dans le shader.
    this.cityPositions = WORLD_CITIES.map((c) => latLonToVec(c.lat, c.lon, 1.002));
    const pos = new Float32Array(WORLD_CITIES.length * 3);
    this.cityPositions.forEach((v, i) => pos.set([v.x, v.y, v.z], i * 3));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('rank', new THREE.BufferAttribute(new Float32Array(WORLD_CITIES.map((c) => c.rank)), 1));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(WORLD_CITIES.length * 3).fill(0.9), 3));
    geo.setAttribute('important', new THREE.BufferAttribute(new Float32Array(WORLD_CITIES.length), 1));
    this.cityPoints = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { maxRank: { value: 2 }, pixelRatio: { value: this.renderer.getPixelRatio() } },
        vertexShader: `attribute float rank; attribute float important; attribute vec3 color; uniform float maxRank; uniform float pixelRatio;
          varying vec3 vColor; varying float vHide;
          void main() { vColor = color; vHide = (rank > maxRank && important < 0.5) ? 1.0 : 0.0;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (important > 0.5 ? 9.0 : max(3.0, 7.0 - rank * 0.45)) * pixelRatio;
          gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vColor; varying float vHide;
          void main() { if (vHide > 0.5) discard; vec2 c = gl_PointCoord - 0.5; float d = length(c);
          if (d > 0.5) discard; float edge = smoothstep(0.5, 0.36, d);
          gl_FragColor = vec4(mix(vec3(0.05), vColor, smoothstep(0.5, 0.42, d)), edge); }`,
        transparent: true,
      }),
    );
    this.scene.add(this.cityPoints, this.armyGroup, this.siegeGroup, this.routeGroup);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'globe-labels';
    container.appendChild(this.labelLayer);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.06;
    this.controls.maxDistance = 5;
    this.controls.zoomSpeed = 0.7;
    this.controls.enabled = opts.interactive;

    if (opts.interactive) this.bindPicking();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    void this.loadGeo();
    this.animate();
    expose('globe', this);
  }

  private async loadGeo() {
    this.countries = await loadCountries(countries110Url);
    this.paintTexture();
    const high = await loadCountries(countries50Url);
    if (this.disposed) return;
    this.countries = high;
    this.paintTexture();
    this.borders = this.buildLines(high.map((c) => c.feature), 1.0015, 0xe8eef7, 0.45);
    this.scene.add(this.borders);
    try {
      const fc = (await (await fetch('/geo/regions-50m.json')).json()) as GeoJSON.FeatureCollection;
      if (this.disposed) return;
      this.regions = this.buildLines(fc.features, 1.0012, 0xc9d4df, 0.22);
      this.regions.visible = false;
      this.scene.add(this.regions);
    } catch { /* régions facultatives */ }
  }

  private buildLines(features: GeoPermissibleObjects[], r: number, color: number, opacity: number) {
    const pts: number[] = [];
    const addRing = (ring: number[][]) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = latLonToVec(ring[i]![1]!, ring[i]![0]!, r);
        const b = latLonToVec(ring[i + 1]![1]!, ring[i + 1]![0]!, r);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    };
    for (const f of features as GeoJSON.Feature[]) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') g.coordinates.forEach(addRing);
      if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach(addRing));
    }
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
  }

  /** Redessine la texture politique (océan, terres, pays joués et sélection). */
  /** Territoires contrôlés : une zone remplie et entourée par ville, colorée selon la relation. Les villes libres ne sont pas dessinées. */
  private paintTerritories(ctx: CanvasRenderingContext2D, proj: ReturnType<typeof geoEquirectangular>) {
    const ry = ((TERRITORY_KM / 111.32) / 180) * TEX_H;
    for (const [cityId, owner] of this.data.owners) {
      const city = CITY_BY_ID_MAP.get(cityId);
      if (!city) continue;
      const p = proj([city.lon, city.lat]);
      if (!p) continue;
      const rx = ry / Math.max(0.2, Math.cos((city.lat * Math.PI) / 180));
      ctx.beginPath();
      ctx.ellipse(p[0], p[1], rx, ry, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = TERRITORY_COLOR[owner.relation];
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = TERRITORY_COLOR[owner.relation];
      ctx.stroke();
    }
  }

  private paintTexture() {
    const ctx = this.texCanvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, TEX_H);
    grad.addColorStop(0, '#0b2a4a');
    grad.addColorStop(0.5, '#0f3a63');
    grad.addColorStop(1, '#0b2a4a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    const proj = geoEquirectangular().scale(TEX_W / (2 * Math.PI)).translate([TEX_W / 2, TEX_H / 2]);
    const path = geoPath(proj, ctx);
    // Hauts-fonds côtiers : halo plus clair autour des terres.
    ctx.save();
    ctx.shadowColor = 'rgba(80,170,210,0.55)';
    ctx.shadowBlur = 18;
    for (const c of this.countries) {
      ctx.beginPath();
      path(c.feature);
      ctx.fillStyle = landColor(c.id);
      ctx.fill();
    }
    ctx.restore();
    this.paintTerritories(ctx, proj);
    for (const c of this.countries) {
      const selected = this.data.selectedCountry === c.id;
      if (!selected) continue;
      // Pays sélectionné : simple liseré clair, sans aplat.
      ctx.beginPath();
      path(c.feature);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    this.texture.needsUpdate = true;
    // Carte spéculaire : l'océan brille, pas les terres.
    const sctx = this.specCanvas.getContext('2d')!;
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, this.specCanvas.width, this.specCanvas.height);
    const sproj = geoEquirectangular().scale(this.specCanvas.width / (2 * Math.PI)).translate([this.specCanvas.width / 2, this.specCanvas.height / 2]);
    const spath = geoPath(sproj, sctx);
    sctx.fillStyle = '#000';
    for (const c of this.countries) { sctx.beginPath(); spath(c.feature); sctx.fill(); }
    const mat = this.globe.material as THREE.MeshPhongMaterial;
    if (mat.specularMap) mat.specularMap.needsUpdate = true;
  }

  setData(data: GlobeData) {
    const ownersKey = [...data.owners].map(([id, o]) => `${id}:${o.relation}`).sort().join();
    const repaint = data.selectedCountry !== this.data.selectedCountry || ownersKey !== this.ownersKey ||
      [...data.playedCountries].sort().join() !== [...this.data.playedCountries].sort().join();
    this.ownersKey = ownersKey;
    this.data = data;
    if (repaint) this.paintTexture();

    // Couleurs et importance des villes.
    const color = this.cityPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const important = this.cityPoints.geometry.getAttribute('important') as THREE.BufferAttribute;
    const c = new THREE.Color();
    WORLD_CITIES.forEach((city, i) => {
      const owner = data.owners.get(city.id);
      if (owner) c.setHex(owner.independent ? DICTATOR_COLOR : OCCUPIED_COLOR);
      else if (city.id === data.selectedCity) c.setHex(0xffffff);
      else c.setRGB(0.88, 0.9, 0.94);
      color.setXYZ(i, c.r, c.g, c.b);
      important.setX(i, owner || city.id === data.selectedCity ? 1 : 0);
    });
    color.needsUpdate = true;
    important.needsUpdate = true;

    const byId = new Map(WORLD_CITIES.map((x, i) => [x.id, i]));

    // Armées et trajets.
    this.clearGroup(this.armyGroup);
    for (const a of data.armies) {
      const p = latLonToVec(a.position[0], a.position[1], 1.004);
      const n = p.clone().normalize();
      const size = 0.0035 + Math.min(0.004, Math.sqrt(a.size) * 0.0003);
      const geom = a.kind === 'naval' ? new THREE.ConeGeometry(size * 0.9, size * 2.2, 3) : a.kind === 'air' ? new THREE.TetrahedronGeometry(size * 1.2, 0) : new THREE.OctahedronGeometry(size, 0);
      const marker = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: RELATION_COLOR[a.relation], emissive: RELATION_COLOR[a.relation], emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.4 }),
      );
      marker.position.copy(n.clone().multiplyScalar(1.004 + size));
      marker.userData.spin = true;
      this.armyGroup.add(marker);
      if (a.destination) {
        const to = latLonToVec(a.destination[0], a.destination[1], 1);
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 48; k++) {
          const f = k / 48;
          const v = n.clone().lerp(to.clone().normalize(), f).normalize();
          pts.push(v.multiplyScalar(1.003 + Math.sin(Math.PI * f) * 0.03 * n.distanceTo(to.clone().normalize())));
        }
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineDashedMaterial({ color: RELATION_COLOR[a.relation], dashSize: 0.01, gapSize: 0.006 }),
        );
        line.computeLineDistances();
        this.armyGroup.add(line);
      }
    }

    // Routes commerciales et lignes de front : arcs au-dessus du globe.
    this.clearGroup(this.routeGroup);
    const arc = (from: [number, number], to: [number, number], lift: number) => {
      const a = latLonToVec(from[0], from[1], 1).normalize();
      const b = latLonToVec(to[0], to[1], 1).normalize();
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 40; k++) {
        const f = k / 40;
        pts.push(a.clone().lerp(b, f).normalize().multiplyScalar(1.003 + Math.sin(Math.PI * f) * lift * a.distanceTo(b)));
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    };
    for (const r of data.routes) {
      const line = new THREE.Line(arc(r.from, r.to, 0.12), new THREE.LineBasicMaterial({ color: r.active ? 0x38bdf8 : 0x94a3b8, transparent: true, opacity: r.active ? 0.9 : 0.5 }));
      line.userData.flow = r.active;
      this.routeGroup.add(line);
    }
    for (const f of data.fronts) {
      const line = new THREE.Line(arc(f.from, f.to, 0.01), new THREE.LineDashedMaterial({ color: 0xef4444, dashSize: 0.006, gapSize: 0.004, transparent: true, opacity: 0.85 }));
      line.computeLineDistances();
      this.routeGroup.add(line);
    }
    for (const b of data.battles) {
      const p = latLonToVec(b[0], b[1], 1.006);
      const burst = new THREE.Mesh(new THREE.IcosahedronGeometry(0.0045, 0), new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.9 }));
      burst.position.copy(p);
      burst.userData.pulse = true;
      this.routeGroup.add(burst);
    }

    // Sièges : anneaux pulsants.
    this.clearGroup(this.siegeGroup);
    for (const cityId of data.sieges) {
      const i = byId.get(cityId);
      if (i === undefined) continue;
      const p = this.cityPositions[i]!;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.0045, 0.006, 40),
        new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      ring.position.copy(p.clone().multiplyScalar(1.001));
      ring.lookAt(p.clone().multiplyScalar(2));
      ring.userData.pulse = true;
      this.siegeGroup.add(ring);
    }
  }

  private clearGroup(g: THREE.Group) {
    for (const child of [...g.children]) {
      g.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
  }

  flyTo(lat: number, lon: number, distance = 1.45) {
    this.flight = { from: this.camera.position.clone(), to: latLonToVec(lat, lon, distance), t: 0 };
  }

  private bindPicking() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; this.flight = null; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.onPick(this.pick(mx, my));
    });
  }

  /** Ville visible la plus proche du clic (12 px), sinon pays sous le curseur. */
  pick(mx: number, my: number): GlobePick {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const maxRank = rankForDistance(this.camera.position.length());
    const camDir = this.camera.position.clone().normalize();
    let best: WorldCity | null = null;
    let bestD = 12;
    const v = new THREE.Vector3();
    WORLD_CITIES.forEach((c, i) => {
      if (c.rank > maxRank && !this.data.owners.has(c.id)) return;
      const p = this.cityPositions[i]!;
      if (p.dot(camDir) < 0.2) return;
      v.copy(p).project(this.camera);
      const sx = ((v.x + 1) / 2) * rect.width;
      const sy = ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - mx, sy - my);
      if (d < bestD) { bestD = d; best = c; }
    });
    if (best) return { cityId: (best as WorldCity).id, countryId: (best as WorldCity).countryId };
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((mx / rect.width) * 2 - 1, -(my / rect.height) * 2 + 1), this.camera);
    const hit = ray.intersectObject(this.globe)[0];
    if (!hit) return {};
    const [lat, lon] = vecToLatLon(hit.point);
    const country = this.countries.find((c) => geoContains(c.feature, [lon, lat]));
    return country ? { countryId: country.id } : {};
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
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.contextLost) return;
    const dist = this.camera.position.length();
    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + dt / 1.4);
      const e = this.flight.t < 0.5 ? 4 * this.flight.t ** 3 : 1 - (-2 * this.flight.t + 2) ** 3 / 2;
      const fromLen = this.flight.from.length();
      const toLen = this.flight.to.length();
      const dir = this.flight.from.clone().normalize().lerp(this.flight.to.clone().normalize(), e).normalize();
      const lift = Math.sin(Math.PI * e) * 0.6 * this.flight.from.clone().normalize().distanceTo(this.flight.to.clone().normalize());
      this.camera.position.copy(dir.multiplyScalar(fromLen + (toLen - fromLen) * e + lift));
      this.camera.lookAt(0, 0, 0);
      if (this.flight.t >= 1) this.flight = null;
    } else if (this.autoRotate) {
      this.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.06);
      this.camera.lookAt(0, 0, 0);
    }
    this.controls.rotateSpeed = Math.max(0.05, (dist - 1) * 0.55);
    this.controls.update();
    const rank = rankForDistance(dist);
    if (rank !== this.lastRank) {
      (this.cityPoints.material as THREE.ShaderMaterial).uniforms.maxRank!.value = rank;
      this.lastRank = rank;
    }
    if (this.regions) this.regions.visible = dist < 1.7;
    const t = this.timer.getElapsed();
    for (const m of this.armyGroup.children) if (m.userData.spin) m.rotateOnAxis(new THREE.Vector3(0, 1, 0), dt * 1.5);
    for (const m of [...this.siegeGroup.children, ...this.routeGroup.children.filter((c) => c.userData.pulse)]) {
      const s = 1 + 0.35 * Math.sin(t * 4);
      m.scale.setScalar(s);
      ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(t * 4);
    }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(rank);
  };

  /** Étiquettes HTML projetées, sans chevauchement, limitées à la face visible. */
  private updateLabels(maxRank: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const camDir = this.camera.position.clone().normalize();
    const v = new THREE.Vector3();
    const boxes: [number, number, number, number][] = [];
    let used = 0;
    const labelRank = Math.max(0, maxRank - 1);
    const place = (i: number, text: string, cls: string, skyline?: number[]) => {
      if (used >= 90) return;
      const p = this.cityPositions[i]!;
      if (p.dot(camDir) < 0.25) return;
      v.copy(p).project(this.camera);
      const x = ((v.x + 1) / 2) * rect.width;
      const y = ((1 - v.y) / 2) * rect.height;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
      const w = text.length * 6.6 + 10;
      const box: [number, number, number, number] = [x + 6, y - 8, x + 6 + w, y + 8];
      if (boxes.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) return;
      boxes.push(box);
      let el = this.labelPool[used];
      if (!el) {
        el = document.createElement('div');
        this.labelLayer.appendChild(el);
        this.labelPool.push(el);
      }
      el.className = `globe-label ${cls}`;
      el.textContent = text;
      if (skyline) {
        // Silhouette de la ville : une colonne par tranche, hauteur selon la densité.
        const sky = document.createElement('span');
        sky.className = 'skyline';
        for (const h of skyline) {
          const bar = document.createElement('span');
          bar.style.height = `${Math.max(2, Math.round(h * 22))}px`;
          sky.appendChild(bar);
        }
        el.appendChild(sky);
      }
      el.style.transform = `translate(${Math.round(x + 7)}px, ${Math.round(y - 8)}px)`;
      el.style.display = '';
      used++;
    };
    // Priorité : ville sélectionnée, villes des joueurs, puis grandes villes.
    WORLD_CITIES.forEach((c, i) => { if (c.id === this.data.selectedCity) place(i, c.name, 'sel'); });
    WORLD_CITIES.forEach((c, i) => {
      const o = this.data.owners.get(c.id);
      if (o && c.id !== this.data.selectedCity) place(i, `${o.independent ? '⚑ ' : ''}${c.name} · ${o.label}`, `occupied${o.relation === 'mine' ? ' mine' : ''}${o.independent ? ' independent' : ''}`, o.skyline);
    });
    WORLD_CITIES.forEach((c, i) => {
      if (c.rank <= labelRank && !this.data.owners.has(c.id) && c.id !== this.data.selectedCity) place(i, c.name, '');
    });
    for (let k = used; k < this.labelPool.length; k++) this.labelPool[k]!.style.display = 'none';
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.dispose();
    // Libère réellement le contexte : le navigateur n'en garde que quelques-uns (globe ⇄ ville répétés).
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  contextLost = false;
  /** Notifié lors d'une perte ou d'une reprise du contexte WebGL. */
  onContextChange: ((lost: boolean) => void) | null = null;
  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.onContextChange?.(true);
  };
  private readonly onContextRestored = () => {
    this.contextLost = false;
    // La texture politique (canevas) doit être renvoyée au GPU.
    this.texture.needsUpdate = true;
    this.onContextChange?.(false);
  };
}
