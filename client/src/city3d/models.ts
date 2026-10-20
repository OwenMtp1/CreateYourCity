// Modèles 3D procéduraux des constructions (aucun fichier externe). Matériaux et textures
// partagés ; les fenêtres s'illuminent la nuit via l'intensité émissive.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
    case 'bus_station': {
      g.add(ground(W, D, 0x9ca3af));
      g.add(box(18, 0.4, 7, solid(0x374151), 0, 3.6, -3));
      for (const x of [-8, 8]) g.add(box(0.4, 3.6, 0.4, solid(0x6b7280), x, 0, -6));
      g.add(box(16, 2.4, 0.3, solid(0x93c5fd, { transparent: true, opacity: 0.6 }), 0, 0.6, -6.3));
      g.add(box(3, 5, 0.4, solid(0x2563eb, { emissive: new THREE.Color(0x2563eb), emissiveIntensity: 0.5 }), 7, 0, 4));
      g.add(box(11, 3.2, 2.6, solid(0xf59e0b), -2, 0.4, 4));
      info.height = 5;
      break;
    }
    case 'tram_station': {
      g.add(ground(W, D, 0x8b8f94));
      for (const x of [-3, 3]) g.add(box(0.5, 0.25, D, solid(0xd1d5db, { metalness: 0.7, roughness: 0.3 }), x, 0.1, 0));
      g.add(box(4, 1, D - 4, solid(0xcbd5e1), -6, 0, 0));
      g.add(box(5, 0.3, D - 6, solid(0x0f766e), -6, 4, 0));
      g.add(box(4.2, 3.4, 14, solid(0x10b981, { metalness: 0.2 }), 0, 0.4, 3));
      info.height = 5;
      break;
    }
    case 'metro_station': {
      g.add(ground(W, D, 0xa8a29e));
      g.add(box(8, 0.5, 6, solid(0x1f2937), 0, 3.4, 0));
      for (const [x, z] of [[-3.8, -2.8], [3.8, -2.8], [-3.8, 2.8], [3.8, 2.8]] as const) g.add(box(0.3, 3.4, 0.3, solid(0x4b5563), x, 0, z));
      g.add(box(1.4, 1.4, 1.4, solid(0xfacc15, { emissive: new THREE.Color(0xfacc15), emissiveIntensity: 0.7 }), 6, 4, 6));
      const pole = new THREE.Mesh(sharedGeometry('mpole', () => new THREE.CylinderGeometry(0.15, 0.15, 4, 6)), solid(0x6b7280));
      pole.position.set(6, 2, 6);
      g.add(pole);
      info.height = 6;
      break;
    }
    case 'train_station': {
      g.add(ground(W, D, 0x9a958c));
      const stone = facade('plain', 40, 12);
      const roof = solid(0x475569);
      g.add(box(36, 12, 12, [stone, stone, roof, roof, stone, stone], -8, 0, -7));
      const hall = new THREE.Mesh(sharedGeometry('hall', () => new THREE.CylinderGeometry(9, 9, 52, 20, 1, false, 0, Math.PI)), solid(0x93c5fd, { transparent: true, opacity: 0.55, metalness: 0.5, side: THREE.DoubleSide }));
      hall.rotation.z = Math.PI / 2;
      hall.rotation.y = Math.PI / 2;
      hall.position.set(0, 0.5, 8);
      g.add(hall);
      for (const z of [4, 12]) g.add(box(58, 0.3, 1.6, solid(0x57534e), 0, 0.1, z));
      g.add(box(14, 3.4, 3.2, solid(0xdc2626), 8, 0.4, 4));
      g.add(box(4, 4, 4, solid(0xe5e7eb), -8, 12, -7));
      info.height = 16;
      break;
    }
    case 'port': {
      g.add(ground(W, D, 0x8a8f96));
      g.add(box(20, 9, 14, solid(0x9ca3af), -18, 0, -10));
      const colors = [0xdc2626, 0x2563eb, 0x16a34a, 0xf59e0b, 0x7c3aed];
      for (let i = 0; i < 8; i++) {
        g.add(box(6, 2.6, 2.4, solid(colors[Math.floor(rnd() * colors.length)]!), 2 + (i % 4) * 6.5, Math.floor(i / 4) * 2.6, -12));
      }
      // Grue portuaire.
      g.add(box(1.2, 22, 1.2, solid(0xf59e0b), 18, 0, 10));
      g.add(box(18, 1.2, 1.2, solid(0xf59e0b), 12, 22, 10));
      g.add(box(1, 6, 1, solid(0x374151), 6, 16, 10));
      info.height = 24;
      break;
    }
    case 'airbase': {
      g.add(ground(W, D, 0x71717a));
      g.add(box(78, 0.2, 12, solid(0x27272a), 0, 0.1, 18));
      g.add(box(78, 0.25, 0.6, solid(0xfafafa), 0, 0.2, 18));
      const hangar = new THREE.Mesh(sharedGeometry('hangar', () => new THREE.CylinderGeometry(9, 9, 20, 16, 1, false, 0, Math.PI)), solid(0x6b7280, { side: THREE.DoubleSide }));
      hangar.rotation.z = Math.PI / 2;
      hangar.rotation.y = Math.PI / 2;
      for (const x of [-22, 2]) {
        const h = hangar.clone();
        h.position.set(x, 0, -14);
        g.add(h);
      }
      g.add(box(3, 16, 3, solid(0xe5e7eb), 30, 0, -16));
      g.add(box(6, 3, 6, solid(0x60a5fa, { transparent: true, opacity: 0.7 }), 30, 16, -16));
      const jet = new THREE.Group();
      jet.add(box(10, 1.2, 1.4, solid(0x52525b)));
      jet.add(box(2.4, 0.3, 9, solid(0x52525b), 1, 0.4, 0));
      jet.position.set(-10, 0.3, 4);
      g.add(jet);
      info.height = 19;
      break;
    }
    case 'parking': {
      g.add(ground(W, D, 0x3b3f46));
      const line = solid(0xf1f5f9);
      // Deux rangées de places de part et d'autre d'une allée centrale.
      for (const side of [-1, 1]) {
        for (let i = 0; i <= 16; i++) g.add(box(6, 0.05, 0.14, line, side * 11.5, 0.07, -D / 2 + 0.5 + i * 2.45));
      }
      parkedCars(g, rnd, 0.65, [[-11.5, 0], [11.5, 0]], 16, 2.45, -D / 2 + 1.7, 0.1);
      parkingSign(g, W / 2 - 1, -D / 2 + 1);
      info.height = 5;
      break;
    }
    case 'parking_garage': {
      g.add(ground(W, D, 0x52525b));
      const concrete = solid(0xb8b5ae);
      const levels = 5;
      for (let l = 0; l < levels; l++) {
        const y = l * 3.1;
        if (l > 0) g.add(box(W - 1, 0.4, D - 1, concrete, 0, y - 0.4, 0));
        // Garde-corps bas : façades ouvertes typiques des silos.
        g.add(box(W - 1, 1, 0.3, concrete, 0, y, -D / 2 + 0.65));
        g.add(box(W - 1, 1, 0.3, concrete, 0, y, D / 2 - 0.65));
        g.add(box(0.3, 1, D - 1, concrete, -W / 2 + 0.65, y, 0));
        g.add(box(0.3, 1, D - 1, concrete, W / 2 - 0.65, y, 0));
        for (const [x, z] of [[-13, -18], [13, -18], [-13, 18], [13, 18], [-13, 0], [13, 0]] as const) g.add(box(0.7, 3.1, 0.7, concrete, x, y, z));
        parkedCars(g, rnd, 0.55, [[-9, 0], [9, 0]], 12, 2.8, -D / 2 + 4, y + (l > 0 ? 0 : 0.05));
      }
      g.add(box(W - 1, 0.5, D - 1, solid(0x8d8a84), 0, levels * 3.1 - 0.4, 0));
      // Cage d'escalier et enseigne.
      g.add(box(4, levels * 3.1 + 2.5, 4, solid(0x64748b), W / 2 - 2.5, 0, -D / 2 + 2.5));
      g.add(box(0.3, 3, 3, solid(0x2563eb, { emissive: new THREE.Color(0x2563eb), emissiveIntensity: 0.6 }), W / 2 - 0.4, levels * 3.1 - 1, -D / 2 + 2.5));
      info.height = levels * 3.1 + 2.5;
      break;
    }
  }
  return { group: mergeByMaterial(g), info };
}

const CAR_COLORS = [0xdc2626, 0x2563eb, 0xf8fafc, 0x1f2937, 0x9ca3af, 0x16a34a, 0xf59e0b, 0x7c2d12];

/** Voitures garées en rangées (centres de rangées, nombre de places, pas, départ, hauteur du sol). */
function parkedCars(g: THREE.Group, rnd: () => number, fill: number, rows: [number, number][], slots: number, step: number, z0: number, y: number) {
  for (const [x] of rows) {
    for (let i = 0; i < slots; i++) {
      if (rnd() > fill) continue;
      const color = solid(CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]!, { metalness: 0.4, roughness: 0.45 });
      const z = z0 + i * step;
      g.add(box(4.2, 0.8, 1.8, color, x, y + 0.25, z));
      g.add(box(2.2, 0.6, 1.6, solid(0x1e293b, { metalness: 0.3, roughness: 0.2 }), x - 0.2, y + 1.05, z));
    }
  }
}

/** Panneau « P » bleu sur poteau. */
function parkingSign(g: THREE.Group, x: number, z: number) {
  g.add(box(0.2, 3, 0.2, solid(0x6b7280), x, 0, z));
  g.add(box(0.15, 1.4, 1.4, solid(0x1d4ed8, { emissive: new THREE.Color(0x1d4ed8), emissiveIntensity: 0.5 }), x, 3, z));
  g.add(box(0.2, 0.9, 0.18, solid(0xffffff, { emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.4 }), x + 0.05, 3.25, z - 0.25));
  g.add(box(0.2, 0.18, 0.5, solid(0xffffff, { emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.4 }), x + 0.05, 3.95, z));
  g.add(box(0.2, 0.18, 0.5, solid(0xffffff, { emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.4 }), x + 0.05, 3.55, z));
}

/**
 * Fusionne les éléments d'un modèle qui partagent un matériau (un appel de dessin par matériau
 * au lieu d'un par élément). Les maillages multi-matériaux sont conservés tels quels.
 */
function mergeByMaterial(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      keep.push(mesh);
      return;
    }
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(flat.attributes)) if (!['position', 'normal', 'uv'].includes(name)) flat.deleteAttribute(name);
    if (!flat.getAttribute('uv')) flat.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(flat.getAttribute('position').count * 2), 2));
    const list = buckets.get(mesh.material) ?? [];
    list.push(flat);
    buckets.set(mesh.material, list);
  });
  const out = new THREE.Group();
  for (const mesh of keep) {
    const m = mesh as THREE.Mesh;
    const clone = new THREE.Mesh(m.geometry, m.material);
    m.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.castShadow = clone.receiveShadow = true;
    out.add(clone);
  }
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  }
  return out;
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
