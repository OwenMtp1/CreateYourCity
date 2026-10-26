"""Maquettes 3D de CreateYourCity : un fichier glTF par bâtiment, route et terrain.

Exécution (Blender en Python, sans interface) :
    python tools/blender/build_models.py -- <dossier_de_sortie>

Chaque modèle est construit à l'échelle du jeu (1 unité = 1 m), posé au sol (z = 0), centré sur
son emprise. Les dimensions de l'emprise viennent du catalogue (shared/src/catalog.ts).
"""
import math
import os
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "models"
os.makedirs(OUT, exist_ok=True)


# --- Matériaux et primitives ---------------------------------------------------------------------

_mats = {}


def mat(name, color, rough=0.75, emit=0.0):
    """Matériau réutilisé : couleur RGB 0..1, rugosité, émission facultative."""
    key = (name, tuple(color), rough, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    _mats[key] = m
    return m


def box(w, d, h, x, y, z, m, rot=0.0):
    """Pavé de dimensions w×d×h, dont la base est posée en (x, y, z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + h / 2))
    o = bpy.context.active_object
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, rot)
    o.data.materials.append(m)
    return o


def cyl(r, h, x, y, z, m, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(x, y, z + h / 2))
    o = bpy.context.active_object
    o.data.materials.append(m)
    return o


def cone(r1, r2, h, x, y, z, m, verts=4, rot=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h, location=(x, y, z + h / 2))
    o = bpy.context.active_object
    o.rotation_euler = (0, 0, rot)
    o.data.materials.append(m)
    return o


def sphere(r, x, y, z, m):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, z), segments=12, ring_count=8)
    o = bpy.context.active_object
    o.data.materials.append(m)
    return o


def bands(w, d, h, x, y, z, glass, every=3.2, depth=0.25):
    """Façade : bandeaux de fenêtres horizontaux (un par étage) sur les deux grands côtés."""
    out = []
    n = max(1, int(h // every) - 1)
    for k in range(n):
        zz = z + 1.6 + k * every
        out.append(box(w * 0.92, depth, 1.4, x, y - d / 2 - depth / 2 + 0.05, zz, glass))
        out.append(box(w * 0.92, depth, 1.4, x, y + d / 2 + depth / 2 - 0.05, zz, glass))
    return out


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def export(name):
    """Exporte tout ce qui est dans la scène comme un seul glTF nommé d'après le bâtiment."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=True, export_apply=True)
    clear_scene()


# Palette commune : murs crème, toits sombres, verre bleuté, accents discrets.
WALL = (0.86, 0.84, 0.80)
BRICK = (0.66, 0.38, 0.30)
ROOF = (0.28, 0.30, 0.34)
GLASS = (0.42, 0.60, 0.74)
CONCRETE = (0.62, 0.62, 0.60)
STEEL = (0.45, 0.48, 0.52)
GREEN = (0.35, 0.58, 0.32)
TREE = (0.20, 0.45, 0.22)
TRUNK = (0.36, 0.25, 0.16)
ASPHALT = (0.22, 0.22, 0.24)
WATER = (0.12, 0.36, 0.60)
RED = (0.75, 0.15, 0.15)
GOLD = (0.85, 0.66, 0.20)


# --- Bâtiments -----------------------------------------------------------------------------------

def house(w, d):
    box(w * 0.8, d * 0.8, 5.5, 0, 0, 0, mat("wall", WALL))
    cone(w * 0.62, 0.0, 3.2, 0, 0, 5.5, mat("roof", ROOF), verts=4, rot=math.pi / 4)
    box(1.6, 0.3, 2.2, 0, -d * 0.4 - 0.1, 0, mat("door", BRICK))


def tower(w, d):
    h = 100
    box(w, d, h, 0, 0, 0, mat("wall", WALL))
    bands(w, d, h, 0, 0, 0, mat("glass", GLASS, 0.2))
    box(w * 0.7, d * 0.7, 3, 0, 0, h, mat("roof", ROOF))


def apartment(w, d):
    h = 24
    box(w, d, h, 0, 0, 0, mat("brick", BRICK, 0.85))
    bands(w, d, h, 0, 0, 0, mat("glass", GLASS, 0.2))
    box(w, d, 1.0, 0, 0, h, mat("roof", ROOF))


def shop(w, d):
    box(w, d, 6, 0, 0, 0, mat("wall", WALL))
    box(w, 0.6, 1.4, 0, -d / 2 - 0.3, 4.2, mat("awning", RED))
    bands(w, d, 6, 0, 0, 0, mat("glass", GLASS, 0.2), every=3.0)
    box(w, d, 0.6, 0, 0, 6, mat("roof", ROOF))


def office(w, d):
    h = 45
    box(w, d, h, 0, 0, 0, mat("glass", GLASS, 0.15))
    box(w * 0.6, d * 0.6, 8, 0, 0, h, mat("glass", GLASS, 0.15))
    cyl(0.4, 8, 0, 0, h + 8, mat("steel", STEEL))


def factory(w, d):
    box(w, d, 10, 0, 0, 0, mat("hall", (0.60, 0.55, 0.48)))
    for k in range(5):
        x = -w / 2 + 4 + k * (w - 8) / 4
        box(w / 5 * 0.9, d * 0.9, 0.3, x, 0, 10, mat("roof", ROOF), rot=0)
        box(w / 5 * 0.9, d * 0.9, 4, x, 0, 10, mat("saw", ROOF))
    cyl(1.6, 36, w / 2 - 5, -d / 2 + 5, 0, mat("chimney", BRICK))


def clinic(w, d):
    box(w, d, 9, 0, 0, 0, mat("wall", (0.95, 0.95, 0.95)))
    box(w * 0.5, 0.3, 2.4, 0, -d / 2 - 0.15, 6, mat("red", RED))
    box(w * 0.2, 0.3, 0.8, 0, -d / 2 - 0.35, 6.8, mat("white", (1, 1, 1)))
    box(w, d, 0.6, 0, 0, 9, mat("roof", ROOF))


def school(w, d):
    box(w, d, 7, 0, 0, 0, mat("brick", BRICK, 0.85))
    box(w, d, 0.6, 0, 0, 7, mat("roof", ROOF))
    cyl(0.2, 9, -w / 2 + 3, -d / 2 + 3, 0, mat("steel", STEEL))


def police(w, d):
    box(w, d, 7, 0, 0, 0, mat("wall", WALL))
    box(w, 0.4, 1.0, 0, -d / 2 - 0.2, 3.0, mat("blue", (0.15, 0.30, 0.70)))
    box(w, d, 0.6, 0, 0, 7, mat("roof", ROOF))


def power_plant(w, d):
    box(w, d * 0.6, 14, 0, -d * 0.2, 0, mat("hall", (0.60, 0.58, 0.55)))
    cyl(12, 40, w * 0.25, d * 0.25, 0, mat("tower", (0.80, 0.80, 0.82)), verts=24)
    cyl(12, 40, -w * 0.15, d * 0.25, 0, mat("tower", (0.80, 0.80, 0.82)), verts=24)


def water_tower(w, d):
    for x, y in [(-6, -6), (6, -6), (-6, 6), (6, 6)]:
        cyl(0.7, 22, x, y, 0, mat("steel", STEEL), verts=8)
    cyl(8, 6, 0, 0, 22, mat("tank", (0.70, 0.74, 0.78)), verts=20)
    cone(8, 0.0, 3, 0, 0, 28, mat("roof", ROOF), verts=20)


def urban_forest(w, d):
    for k in range(9):
        x = -w * 0.35 + (k % 3) * w * 0.35
        y = -d * 0.35 + (k // 3) * d * 0.35
        cyl(0.4, 3, x, y, 0, mat("trunk", TRUNK), verts=6)
        sphere(3.2, x, y, 5.0, mat("leaves", TREE, 0.9))


def solar_plant(w, d):
    for i in range(3):
        for j in range(3):
            x = -w * 0.33 + i * w * 0.33
            y = -d * 0.33 + j * d * 0.33
            cyl(0.25, 2.2, x, y, 0, mat("steel", STEEL), verts=6)
            o = box(w / 3.6, d / 3.6, 0.25, x, y, 2.2, mat("panel", (0.10, 0.20, 0.38), 0.2))
            o.rotation_euler = (math.radians(25), 0, 0)


def park(w, d):
    box(w, d, 0.3, 0, 0, 0, mat("grass", GREEN, 0.9))
    box(w * 0.2, d * 0.9, 0.05, 0, 0, 0.3, mat("path", (0.80, 0.78, 0.70)))
    for x, y in [(-w * 0.3, -d * 0.3), (w * 0.3, d * 0.2), (-w * 0.1, d * 0.3)]:
        cyl(0.4, 3, x, y, 0.3, mat("trunk", TRUNK), verts=6)
        sphere(3.0, x, y, 6.0, mat("leaves", TREE, 0.9))


def barracks(w, d):
    box(w, d, 8, 0, 0, 0, mat("wall", (0.55, 0.55, 0.45)))
    box(w, d, 0.6, 0, 0, 8, mat("roof", ROOF))
    cyl(0.2, 12, w / 2 - 3, 0, 0, mat("steel", STEEL))
    box(3, 0.1, 2, w / 2 - 3, 0, 12, mat("flag", RED))


def bus_station(w, d):
    box(w, d, 0.3, 0, 0, 0, mat("platform", CONCRETE))
    for x in (-w / 2 + 1, w / 2 - 1):
        for y in (-d / 2 + 1, d / 2 - 1):
            cyl(0.25, 3.2, x, y, 0.3, mat("steel", STEEL), verts=6)
    box(w, d, 0.4, 0, 0, 3.5, mat("roof", ROOF))
    box(2.5, 0.2, 1.4, 0, -d / 2 - 0.1, 2.4, mat("bus", (0.10, 0.45, 0.75)))


def tram_station(w, d):
    box(w, d, 0.6, 0, 0, 0, mat("platform", CONCRETE))
    box(w * 0.7, d, 0.4, 0, 0, 4.2, mat("roof", ROOF))
    for y in (-d / 2 + 1, d / 2 - 1):
        cyl(0.2, 4.2, 0, y, 0.6, mat("steel", STEEL), verts=6)
    box(w, 0.1, 0.1, 0, 0, 4.6, mat("wire", (0.2, 0.2, 0.2)))


def metro_station(w, d):
    box(w, d, 1.0, 0, 0, 0, mat("entrance", (0.55, 0.57, 0.60)))
    box(w * 0.5, 0.2, 1.4, 0, -d / 2 - 0.1, 1.0, mat("sign", (0.10, 0.30, 0.70), emit=2.0))
    cyl(0.12, 2.6, 0, 0, 1.0, mat("steel", STEEL), verts=8)


def train_station(w, d):
    box(w, d, 9, 0, 0, 0, mat("hall", (0.72, 0.68, 0.62)))
    box(w, d * 0.8, 0.5, 0, 0, 9, mat("roof", ROOF))
    # Toiture en berceau : cylindre couché le long de la gare, posé sur les murs (axe à 9 m + rayon).
    r = d * 0.45
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=w * 0.92, location=(0, 0, 9 + r))
    arch = bpy.context.active_object
    arch.rotation_euler = (0, math.pi / 2, 0)
    arch.data.materials.append(mat("roof", ROOF))
    box(w * 0.92, 0.2, 0.25, 0, -d / 2 - 4, 0, mat("rail", STEEL))


def port(w, d):
    box(w, d, 1.2, 0, 0, 0, mat("quay", CONCRETE))
    cols = [(0.8, 0.2, 0.2), (0.2, 0.4, 0.8), (0.9, 0.7, 0.2), (0.3, 0.6, 0.3)]
    for i in range(4):
        for j in range(2):
            box(6, 2.5, 2.6, -w / 2 + 8 + i * 12, -d / 2 + 4 + j * 4, 1.2, mat(f"cont{i}{j}", cols[(i + j) % 4]))
    box(4, 4, 36, w / 2 - 8, -d / 2 + 4, 1.2, mat("crane", (0.85, 0.55, 0.15)))
    box(22, 2, 2, w / 2 - 14, -d / 2 + 4, 36, mat("crane", (0.85, 0.55, 0.15)))


def airbase(w, d):
    box(w, d * 0.2, 0.2, 0, -d * 0.25, 0, mat("runway", (0.15, 0.15, 0.16)))
    box(w * 0.3, d * 0.4, 12, w * 0.25, d * 0.2, 0, mat("hangar", (0.55, 0.57, 0.60)))
    cone(1.0, 0.4, 2.0, w * 0.25, d * 0.2 - d * 0.25, 12, mat("tower", STEEL), verts=8)


def parking(w, d):
    box(w, d, 0.4, 0, 0, 0, mat("asphalt", ASPHALT, 0.9))
    for k in range(4):
        for side in (-1, 1):
            box(2.0, 4.5, 1.2, side * 4, -d / 2 + 5 + k * 9, 0.4, mat(f"car{k}{side}", ((0.8, 0.8, 0.85) if k % 2 else (0.4, 0.5, 0.6))))


def parking_garage(w, d):
    for k in range(3):
        box(w, d, 2.8, 0, 0, k * 3.0, mat("concrete", CONCRETE))
        box(w, 0.3, 1.8, 0, -d / 2, k * 3.0 + 0.5, mat("dark", (0.15, 0.16, 0.18)))
    box(w, d, 0.3, 0, 0, 9, mat("roof", ROOF))


def casino(w, d):
    box(w, d, 9, 0, 0, 0, mat("casino", RED))
    box(w * 0.75, d * 0.75, 5, 0, 0, 9, mat("gold", GOLD, 0.4, emit=0.4))
    box(w * 0.5, 0.3, 2, 0, -d / 2 - 0.15, 0, mat("glass", GLASS, 0.2))


def hotel(w, d):
    h = 21
    box(w, d, h, 0, 0, 0, mat("wall", WALL))
    bands(w, d, h, 0, 0, 0, mat("glass", GLASS, 0.2))
    box(w, d, 0.8, 0, 0, h, mat("roof", ROOF))
    box(w * 0.5, 0.3, 1.6, 0, -d / 2 - 0.2, 0, mat("sign", (0.85, 0.66, 0.2), emit=1.5))


def cinema(w, d):
    box(w, d, 8, 0, 0, 0, mat("wall", (0.30, 0.32, 0.38)))
    box(w * 0.9, 0.4, 2.0, 0, -d / 2 - 0.2, 4.0, mat("marquee", (1.0, 0.85, 0.3), emit=1.5))
    box(w, d, 0.5, 0, 0, 8, mat("roof", ROOF))


BUILDINGS = {
    "house": (house, 20, 20), "tower": (tower, 30, 30), "apartment": (apartment, 30, 30), "shop": (shop, 20, 20),
    "office": (office, 30, 30), "factory": (factory, 50, 40), "clinic": (clinic, 30, 30), "school": (school, 40, 30),
    "police": (police, 25, 25), "power_plant": (power_plant, 50, 50), "water_tower": (water_tower, 20, 20),
    "urban_forest": (urban_forest, 50, 50), "solar_plant": (solar_plant, 40, 40), "park": (park, 40, 40),
    "barracks": (barracks, 60, 40), "bus_station": (bus_station, 20, 20), "tram_station": (tram_station, 16, 30),
    "metro_station": (metro_station, 20, 20), "train_station": (train_station, 60, 30), "port": (port, 60, 40),
    "airbase": (airbase, 80, 60), "parking": (parking, 30, 40), "parking_garage": (parking_garage, 30, 40),
    "casino": (casino, 40, 30), "hotel": (hotel, 40, 40), "cinema": (cinema, 40, 30),
}


# --- Routes et terrains --------------------------------------------------------------------------

def road(kind):
    """Tronçon de 10 m : rue (6 m), avenue (12 m) ou pont (8 m, avec garde-corps)."""
    width = {"street": 6, "avenue": 12, "bridge": 8}[kind]
    box(10, width, 0.2, 0, 0, 0, mat("asphalt", ASPHALT, 0.9))
    if kind == "avenue":
        box(10, 0.3, 0.02, 0, 0, 0.21, mat("line", (0.9, 0.9, 0.85)))
    if kind == "bridge":
        for y in (-width / 2, width / 2):
            box(10, 0.3, 1.0, 0, y, 0.2, mat("rail", STEEL))


def terrain(kind):
    if kind == "land":
        box(20, 20, 0.5, 0, 0, -0.5, mat("grass", GREEN, 0.9))
    elif kind == "hill":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=10, location=(0, 0, -2), segments=24, ring_count=12)
        o = bpy.context.active_object
        o.scale = (1, 1, 0.5)
        o.data.materials.append(mat("hill", (0.42, 0.52, 0.30), 0.95))
    elif kind == "water":
        box(20, 20, 0.4, 0, 0, -0.45, mat("water", WATER, 0.1))


# --- Lancement -----------------------------------------------------------------------------------

if __name__ == "__main__":
    clear_scene()
    for name, (fn, w, d) in BUILDINGS.items():
        fn(w, d)
        export(name)
    for kind in ("street", "avenue", "bridge"):
        road(kind)
        export(kind)
    for kind in ("land", "hill", "water"):
        terrain(kind)
        export("terrain_" + kind)
    print(f"{len(BUILDINGS) + 6} modèles écrits dans {OUT}")
