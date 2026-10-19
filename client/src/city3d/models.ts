// Modèles 3D procéduraux des constructions (aucun fichier externe). Matériaux et textures
// partagés ; les fenêtres s'illuminent la nuit via l'intensité émissive.
import * as THREE from 'three';
import { BUILDINGS, mulberry32, hashString, type Building, type BuildingType } from '@cyc/shared';

type WindowStyle = 'residential' | 'glass' | 'office' | 'shop' | 'brick' | 'plain';

const textureCache = new Map<string, { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture }>();
const materialCache = new Map<string, THREE.Material>();
/** Matériaux à fenêtres : leur intensité émissive suit le cycle jour/nuit. */
export const windowMaterials = new Set<THREE.MeshStandardMaterial>();

function windowTextures(style: WindowStyle) {
  const cached = textureCache.get(style);
  if (cached) return cached;
  const W = 128;
  const H = 128;
  const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const base = make();
  const glow = make();
  const b = base.getContext('2d')!;
  const g = glow.getContext('2d')!;
  const rnd = mulberry32(hashString(style));
  const palette: Record<WindowStyle, { wall: string; win: string; cols: number; rows: number }> = {
    residential: { wall: '#d8c9b4', win: '#4b5d70', cols: 4, rows: 4 },
    glass: { wall: '#5b7fa3', win: '#9cc3e6', cols: 6, rows: 8 },
    office: { wall: '#9aa7b4', win: '#36506b', cols: 5, rows: 6 },
    shop: { wall: '#e9e4da', win: '#7aa6c2', cols: 2, rows: 1 },
    brick: { wall: '#a0583c', win: '#3e4c5a', cols: 4, rows: 3 },
    plain: { wall: '#e6e8ea', win: '#8fa3b5', cols: 4, rows: 2 },
  };
  const p = palette[style];
  b.fillStyle = p.wall;
  b.fillRect(0, 0, W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const cw = W / p.cols;
  const rh = H / p.rows;
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const x = c * cw + cw * 0.18;
      const y = r * rh + rh * 0.2;
      const w = cw * 0.64;
      const h = rh * (style === 'shop' ? 0.7 : 0.55);
      b.fillStyle = p.win;
      b.fillRect(x, y, w, h);
      b.fillStyle = 'rgba(255,255,255,0.18)';
      b.fillRect(x, y, w * 0.4, h);
      if (rnd() < 0.62) {
        g.fillStyle = rnd() < 0.8 ? '#ffd08a' : '#cfe6ff';
        g.fillRect(x, y, w, h);
      }
    }
  }
  const map = new THREE.CanvasTexture(base);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const emissive = new THREE.CanvasTexture(glow);
  emissive.colorSpace = THREE.SRGBColorSpace;
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  const out = { map, emissive };
  textureCache.set(style, out);
  return out;
}

/** Matériau de façade avec répétition adaptée aux dimensions (un étage ≈ 3,5 m). */
function facade(style: WindowStyle, width: number, height: number): THREE.MeshStandardMaterial {
  const tex = windowTextures(style);
  const per = { residential: 4, glass: 6, office: 5, shop: 2, brick: 4, plain: 4 }[style];
  const rows = { residential: 4, glass: 8, office: 6, shop: 1, brick: 3, plain: 2 }[style];
  const rx = Math.max(1, Math.round(width / (per * 3)));
  const ry = Math.max(1, Math.round(height / (rows * 3.5)));
  const key = `facade:${style}:${rx}:${ry}`;
  const cached = materialCache.get(key);
  if (cached) return cached as THREE.MeshStandardMaterial;
  const map = tex.map.clone();
  map.repeat.set(rx, ry);
  map.needsUpdate = true;
  const emissiveMap = tex.emissive.clone();
  emissiveMap.repeat.set(rx, ry);
  emissiveMap.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    map, emissiveMap, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0,
    roughness: style === 'glass' || style === 'office' ? 0.25 : 0.8, metalness: style === 'glass' || style === 'office' ? 0.35 : 0.05,
  });
  windowMaterials.add(mat);
  materialCache.set(key, mat);
  return mat;
}

export function solid(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = `solid:${color}:${JSON.stringify(opts)}`;
  const cached = materialCache.get(key);
  if (cached) return cached as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...opts });
  materialCache.set(key, mat);
  return mat;
}

const geometryCache = new Map<string, THREE.BufferGeometry>();
/** Géométries partagées (non libérées) : les mêmes dimensions reviennent souvent. */
export function sharedGeometry<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geometryCache.set(key, g);
  }
  return g as T;
}

function box(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(sharedGeometry(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Bloc à façades vitrées et toit uni. */
function tower(w: number, h: number, d: number, style: WindowStyle, roof: number, x = 0, y = 0, z = 0) {
  const side = facade(style, Math.max(w, d), h);
  const top = solid(roof);
  return box(w, h, d, [side, side, top, top, side, side], x, y, z);
}

function tree(x: number, z: number, scale: number, rnd: () => number) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(sharedGeometry('trunk', () => new THREE.CylinderGeometry(0.25, 0.35, 2.5, 6)), solid(0x6b4f35));
  trunk.scale.setScalar(scale);
  trunk.position.y = 1.25 * scale;
  const greens = [0x3f7d3a, 0x4f8f3f, 0x2f6b3a, 0x5c9a46];
  const crown = new THREE.Mesh(sharedGeometry('crown', () => new THREE.IcosahedronGeometry(2, 0)), solid(greens[Math.floor(rnd() * greens.length)]!, { flatShading: true }));
  crown.scale.setScalar(scale);
  crown.position.y = 3.8 * scale;
  trunk.castShadow = crown.castShadow = true;
  g.add(trunk, crown);
  g.position.set(x, 0, z);
  return g;
}

function ground(w: number, d: number, color: number) {
  const m = new THREE.Mesh(sharedGeometry(`plane:${w}:${d}`, () => new THREE.PlaneGeometry(w, d)), solid(color));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.06;
  m.receiveShadow = true;
  return m;
}

/** Points d'émission de fumée (usines, centrales), en coordonnées locales. */
export interface ModelInfo { height: number; smoke: THREE.Vector3[] }

const WALLS = [0xe8dcc6, 0xd9c2a3, 0xf0e6d6, 0xc9b79c, 0xe3d2d2, 0xd6dfe6];
const ROOFS = [0x9c3b2e, 0x7a4a36, 0x5b5f66, 0xa8553d, 0x6d3b2f];

/** Modèle d'un bâtiment, centré sur son emprise, variations déterministes par identifiant. */
export function buildModel(type: BuildingType, seed: number): { group: THREE.Group; info: ModelInfo } {
  const def = BUILDINGS[type];
  const rnd = mulberry32(seed * 7919 + hashString(type));
  const g = new THREE.Group();
  const info: ModelInfo = { height: 10, smoke: [] };
  const W = def.w;
  const D = def.h;
  switch (type) {
    case 'house': {
      g.add(ground(W, D, 0x6f9a52));
      for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]] as const) {
        if (rnd() < 0.12) { g.add(tree(dx, dz, 0.9, rnd)); continue; }
        const h = 4 + rnd() * 2;
        const wall = solid(WALLS[Math.floor(rnd() * WALLS.length)]!);
        g.add(box(6.5, h, 6.5, wall, dx, 0, dz));
        const roof = new THREE.Mesh(new THREE.ConeGeometry(5.1, 3, 4), solid(ROOFS[Math.floor(rnd() * ROOFS.length)]!, { flatShading: true }));
        roof.rotation.y = Math.PI / 4;
        roof.position.set(dx, h + 1.5, dz);
        roof.castShadow = true;
        g.add(roof);
      }
      info.height = 9;
      break;
    }
    case 'apartment': {
      const h = 15 + Math.floor(rnd() * 4) * 3;
      g.add(ground(W, D, 0x8c8f93));
      g.add(tower(26, h, 26, 'residential', 0x6f7378));
      g.add(box(8, 3, 6, solid(0x9aa0a6), 4, h, -3));
      info.height = h + 3;
      break;
    }
    case 'tower': {
      const h = 55 + Math.floor(rnd() * 5) * 6;
      g.add(ground(W, D, 0x8c8f93));
      g.add(box(28, 4, 28, solid(0xb8bec4)));
      g.add(tower(24, h, 24, 'glass', 0x3c4652, 0, 4));
      g.add(box(10, 6, 10, solid(0x4b5563), 0, h + 4));
      info.height = h + 10;
      break;
    }
    case 'shop': {
      const awning = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b][Math.floor(rnd() * 4)]!;
      g.add(ground(W, D, 0xb7b2a8));
      g.add(tower(18, 6, 16, 'shop', 0x8b8f94, 0, 0, -1));
      g.add(box(18.5, 0.6, 3, solid(awning), 0, 3.6, 7.6));
      g.add(box(8, 1.6, 0.4, solid(0xffffff, { emissive: new THREE.Color(awning), emissiveIntensity: 0.4 }), 0, 6.2, 7));
      info.height = 8;
      break;
    }
    case 'office': {
      const h = 28 + Math.floor(rnd() * 4) * 4;
      g.add(ground(W, D, 0x9ca3af));
      g.add(tower(26, h, 26, 'office', 0x4b5563));
      g.add(tower(18, 10, 18, 'office', 0x374151, 0, h));
      g.add(box(1, 8, 1, solid(0xdddddd), 5, h + 10, 5));
      info.height = h + 18;
      break;
    }
    case 'factory': {
      g.add(ground(W, D, 0x7d7b74));
      const hallMat = solid(0x9a8f80);
      g.add(box(44, 9, 26, hallMat, 0, 0, 3));
      for (let i = 0; i < 5; i++) {
        const tooth = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.2, 26, 3, 1), solid(0x6b7280, { flatShading: true }));
        tooth.rotation.z = Math.PI / 2;
        tooth.rotation.y = Math.PI / 2;
        tooth.position.set(-17 + i * 8.5, 10.4, 3);
        tooth.castShadow = true;
        g.add(tooth);
      }
      for (const x of [-14, -6]) {
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 24, 12), solid(0x8b3a2b));
        ch.position.set(x, 12, -13);
        ch.castShadow = true;
        g.add(ch);
        g.add(box(3.2, 1, 3.2, solid(0xe5e7eb), x, 21, -13));
        info.smoke.push(new THREE.Vector3(x, 25, -13));
      }
      g.add(box(10, 5, 8, solid(0xc4b8a6), 15, 0, -12));
      info.height = 26;
      break;
    }
    case 'clinic': {
      g.add(ground(W, D, 0xcfd6dc));
      g.add(tower(26, 10, 22, 'plain', 0xf3f4f6, 0, 0, -2));
      const cross = solid(0xdc2626, { emissive: new THREE.Color(0xdc2626), emissiveIntensity: 0.3 });
      g.add(box(8, 0.4, 2.4, cross, 0, 10, -2));
      g.add(box(2.4, 0.4, 8, cross, 0, 10, -2));
      g.add(box(26, 0.5, 4, solid(0x2563eb), 0, 3.5, 10));
      info.height = 11;
      break;
    }
    case 'school': {
      g.add(ground(W, D, 0xc2a57a));
      const brick = facade('brick', 40, 10);
      const roof = solid(0x6b4f3a);
      g.add(box(38, 10, 11, [brick, brick, roof, roof, brick, brick], 0, 0, -9));
      g.add(box(11, 10, 18, [brick, brick, roof, roof, brick, brick], -13.5, 0, 5));
      const court = ground(20, 12, 0x2f8f5b);
      court.position.set(8, 0.08, 7);
      g.add(court);
      info.height = 11;
      break;
    }
    case 'police': {
      g.add(ground(W, D, 0x9aa3ad));
      g.add(tower(22, 9, 20, 'office', 0x1e3a5f, 0, 0, -1));
      g.add(box(1.5, 1.2, 1.5, solid(0x60a5fa, { emissive: new THREE.Color(0x3b82f6), emissiveIntensity: 1.2 }), 0, 9, -1));
      g.add(box(22, 3.5, 0.6, solid(0x1d4ed8), 0, 5, 9.2));
      info.height = 11;
      break;
    }
    case 'power_plant': {
      g.add(ground(W, D, 0x8b8a85));
      g.add(box(18, 14, 40, solid(0xa3a3a3), -14, 0, 0));
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector2(9 - 4.2 * Math.sin(Math.PI * t * 0.9), t * 28));
      }
      for (const z of [-11, 11]) {
        const ct = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), solid(0xd6d3d1, { side: THREE.DoubleSide }));
        ct.position.set(10, 0, z);
        ct.castShadow = true;
        g.add(ct);
        info.smoke.push(new THREE.Vector3(10, 30, z));
      }
      info.height = 30;
      break;
    }
    case 'water_tower': {
      g.add(ground(W, D, 0x8fa37a));
      for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 16, 6), solid(0x6b7280));
        leg.position.set(x, 8, z);
        leg.castShadow = true;
        g.add(leg);
      }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 7, 24), solid(0x60a5fa, { metalness: 0.4, roughness: 0.4 }));
      tank.position.y = 19.5;
      tank.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(7.3, 3, 24), solid(0x475569));
      cap.position.y = 24.5;
      g.add(tank, cap);
      info.height = 26;
      break;
    }
    case 'park': {
      g.add(ground(W, D, 0x5f9e4a));
      const path1 = ground(W, 3, 0xd6c7a1);
      path1.position.y = 0.09;
      const path2 = ground(3, D, 0xd6c7a1);
      path2.position.y = 0.09;
      g.add(path1, path2);
      const pond = new THREE.Mesh(new THREE.CircleGeometry(5, 24), solid(0x3b82c4, { roughness: 0.1, metalness: 0.3 }));
      pond.rotation.x = -Math.PI / 2;
      pond.position.set(9, 0.1, 9);
      g.add(pond);
      for (let i = 0; i < 12; i++) {
        const x = (rnd() - 0.5) * (W - 6);
        const z = (rnd() - 0.5) * (D - 6);
        if (Math.abs(x) < 3 || Math.abs(z) < 3 || Math.hypot(x - 9, z - 9) < 6) continue;
        g.add(tree(x, z, 0.8 + rnd() * 0.5, rnd));
      }
      info.height = 8;
      break;
    }
    case 'barracks': {
      g.add(ground(W, D, 0x8a8a6a));
      const khaki = facade('brick', 50, 7);
      const roof = solid(0x4d5a3a);
      g.add(box(52, 7, 11, [khaki, khaki, roof, roof, khaki, khaki], 0, 0, -12));
      g.add(box(52, 7, 11, [khaki, khaki, roof, roof, khaki, khaki], 0, 0, 2));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 14, 6), solid(0xd1d5db));
      pole.position.set(22, 7, 14);
      const flag = box(5, 3, 0.2, solid(0x2563eb), 24.6, 10.5, 14);
      g.add(pole, flag);
      info.height = 14;
      break;
    }
  }
  return { group: g, info };
}

/** Rotation d'un bâtiment (emprise tournée de 90°). */
export function placeModel(obj: THREE.Object3D, b: Pick<Building, 'x' | 'y' | 'rotation'>, offset: number) {
  obj.position.set(b.x - offset, 0, b.y - offset);
  obj.rotation.y = b.rotation === 90 ? Math.PI / 2 : 0;
}

/** Arbres décoratifs instanciés (troncs + houppiers). */
export function treeInstances(count: number) {
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 3, 5), solid(0x6b4f35), count);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 0), solid(0xffffff, { flatShading: true }), count);
  trunks.castShadow = crowns.castShadow = true;
  return { trunks, crowns };
}
