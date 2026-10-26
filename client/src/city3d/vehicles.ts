// Véhicules 3D : maquettes Blender (public/models) instanciées par partie. La carrosserie (matériau « paint »)
// prend la couleur de chaque instance ; vitres et pneus gardent leur matériau. Sans maquette, on garde les boîtes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type VehicleKind = 'car' | 'truck' | 'bus' | 'tram';

interface Part { geometry: THREE.BufferGeometry; material: THREE.Material; tint: boolean }

const parts = new Map<VehicleKind, Part[]>();
const scenes = new Map<VehicleKind, THREE.Group>();

/** Charge les véhicules. Un fichier manquant laisse la boîte de repli. */
export async function preloadVehicles(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all((['car', 'truck', 'bus', 'tram'] as const).map(async (kind) => {
    try {
      const gltf = await loader.loadAsync(`/models/${kind}.glb`);
      gltf.scene.updateMatrixWorld(true);
      scenes.set(kind, gltf.scene);
      const list: Part[] = [];
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
        const material = Array.isArray(o.material) ? o.material[0]! : o.material;
        list.push({ geometry, material, tint: material.name === 'paint' });
      });
      parts.set(kind, list);
    } catch {
      /* pas de maquette : boîte de repli */
    }
  }));
}

/**
 * Groupe d'instances d'un type de véhicule. `fallback` est la boîte utilisée sans maquette ; son bas doit
 * être à y = 0 comme la maquette, car `groundY` (hauteur du bas des roues) est appliqué aux deux.
 */
export class InstancedVehicles {
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly tinted: THREE.InstancedMesh[] = [];
  readonly groundY: number;

  constructor(kind: VehicleKind, count: number, fallback: THREE.BufferGeometry, fallbackMaterial: THREE.Material, groundY: number, castShadow: boolean) {
    this.groundY = groundY;
    const list = parts.get(kind) ?? [{ geometry: fallback, material: fallbackMaterial, tint: true }];
    for (const p of list) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, count);
      im.castShadow = castShadow;
      this.meshes.push(im);
      if (p.tint) this.tinted.push(im);
    }
  }

  setColor(i: number, color: THREE.Color) {
    for (const m of this.tinted) m.setColorAt(i, color);
  }

  setMatrix(i: number, m: THREE.Matrix4) {
    for (const im of this.meshes) im.setMatrixAt(i, m);
  }

  update() {
    for (const im of this.meshes) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  addTo(scene: THREE.Object3D) {
    for (const im of this.meshes) scene.add(im);
  }

  removeFrom(scene: THREE.Object3D) {
    for (const im of this.meshes) scene.remove(im);
  }

  dispose() {
    for (const im of this.meshes) im.dispose();
  }
}

/** Véhicule seul (bus, tram) : une copie de la maquette, carrosserie teintée à part. */
export function vehicleObject(kind: VehicleKind, color: number, fallback: () => THREE.Object3D): THREE.Object3D {
  const scene = scenes.get(kind);
  if (!scene) return fallback();
  const copy = scene.clone(true);
  copy.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    const m = Array.isArray(o.material) ? o.material[0]! : o.material;
    if (m.name === 'paint') {
      o.material = (m as THREE.MeshStandardMaterial).clone();
      (o.material as THREE.MeshStandardMaterial).color.setHex(color);
    }
  });
  return copy;
}
