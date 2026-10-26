"""Maquettes 3D réalistes de CreateYourCity : un fichier glTF par bâtiment, route et terrain.

Exécution (Blender en Python, sans interface) :
    python tools/blender/build_models.py -- <dossier_de_sortie>

Chaque modèle est à l'échelle du jeu (1 unité = 1 m), posé au sol (z = 0) et centré sur son emprise
(dimensions de shared/src/catalog.ts). Les détails (fenêtres en trame, balcons, toitures, auvents) sont
de vraie géométrie, puis fusionnés par matériau pour limiter le nombre d'objets.
"""
import math
import os
import random
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "models"
os.makedirs(OUT, exist_ok=True)

_mats = {}


# --- Matériaux -----------------------------------------------------------------------------------

def mat(name, color, rough=0.7, metal=0.0, emit=0.0):
    """Matériau réutilisé. `color` en RGB 0..1, `emit` = intensité d'émission (enseignes, vitrines)."""
    key = (name, tuple(color), rough, metal, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*color, 1.0)
        b.inputs["Emission Strength"].default_value = emit
    _mats[key] = m
    return m


# Palette réaliste : béton, briques, enduits, verre teinté, aluminium, bitume, végétation.
CONCRETE = (0.66, 0.65, 0.62)
CONCRETE_DARK = (0.42, 0.41, 0.40)
BRICK = (0.58, 0.27, 0.20)
BRICK_LIGHT = (0.74, 0.55, 0.42)
PLASTER = (0.90, 0.87, 0.80)
PLASTER_COOL = (0.82, 0.85, 0.86)
GLASS = (0.10, 0.18, 0.25)
GLASS_BLUE = (0.16, 0.30, 0.42)
ALU = (0.55, 0.57, 0.60)
FRAME = (0.20, 0.21, 0.23)
BITUMEN = (0.16, 0.16, 0.17)
TILE_RED = (0.55, 0.22, 0.16)
METAL = (0.48, 0.50, 0.53)
RUST = (0.45, 0.30, 0.20)
ASPHALT = (0.12, 0.12, 0.13)
LAWN = (0.30, 0.48, 0.22)
LEAF = (0.22, 0.40, 0.18)
LEAF_LIGHT = (0.34, 0.52, 0.24)
TRUNK = (0.33, 0.22, 0.14)
WATER = (0.10, 0.30, 0.48)
RED = (0.62, 0.10, 0.10)
BLUE = (0.10, 0.22, 0.55)
GOLD = (0.80, 0.62, 0.22)
WHITE = (0.94, 0.94, 0.93)
SIGN_WARM = (1.0, 0.82, 0.45)

# Couleurs de façades variées pour les immeubles (tirées de façon déterministe).
FACADES = [PLASTER, PLASTER_COOL, BRICK, BRICK_LIGHT, (0.80, 0.74, 0.62), (0.72, 0.66, 0.58)]


# --- Primitives ----------------------------------------------------------------------------------

def _link(o, m=None):
    if m is not None:
        o.data.materials.append(m)
    return o


def box(w, d, h, x, y, z, m, rot=0.0):
    """Pavé w×d×h posé en (x, y, z) par sa base, tourné autour de Z."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + h / 2))
    o = bpy.context.active_object
    o.scale = (w, d, h)
    o.rotation_euler = (0, 0, rot)
    return _link(o, m)


def cyl(r, h, x, y, z, m, verts=16, axis="z"):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=(x, y, z + (h / 2 if axis == "z" else 0)))
    o = bpy.context.active_object
    if axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    return _link(o, m)


def sphere(r, x, y, z, m):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, z), segments=10, ring_count=6)
    return _link(bpy.context.active_object, m)


def mesh_from(verts, faces, m, x=0.0, y=0.0, z=0.0):
    me = bpy.data.meshes.new("m")
    me.from_pydata([(vx + x, vy + y, vz + z) for vx, vy, vz in verts], [], faces)
    me.update()
    o = bpy.data.objects.new("m", me)
    bpy.context.collection.objects.link(o)
    return _link(o, m)


def gable(w, d, rise, x, y, z, m, ridge="x"):
    """Toit à deux pans (faîtage parallèle à `ridge`), posé sur les murs."""
    if ridge == "x":
        v = [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0), (-w / 2, 0, rise), (w / 2, 0, rise)]
        f = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)]
    else:
        v = [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0), (0, -d / 2, rise), (0, d / 2, rise)]
        f = [(1, 2, 5, 4), (3, 0, 4, 5), (0, 1, 4), (2, 3, 5)]
    return mesh_from(v, f, m, x, y, z)


def lathe(profile, x, y, z, m, segments=20):
    """Solide de révolution : `profile` = liste de (rayon, hauteur) du bas vers le haut."""
    verts, faces = [], []
    n = len(profile)
    for i, (r, h) in enumerate(profile):
        for k in range(segments):
            a = 2 * math.pi * k / segments
            verts.append((r * math.cos(a), r * math.sin(a), h))
    for i in range(n - 1):
        for k in range(segments):
            a, b = i * segments + k, i * segments + (k + 1) % segments
            c, d = (i + 1) * segments + (k + 1) % segments, (i + 1) * segments + k
            faces.append((a, b, c, d))
    # Couvercle du haut et fond plein.
    top = n - 1
    faces.append(tuple(top * segments + k for k in range(segments)))
    faces.append(tuple(k for k in reversed(range(segments))))
    return mesh_from(verts, faces, m, x, y, z)


# --- Détails architecturaux ----------------------------------------------------------------------

def windows(w, d, h, z0, floors, bays, glass, frame, margin=2.0, sides=("front", "back", "left", "right"), skip_ground=0):
    """Trame de fenêtres sur les faces d'un volume w×d×h, à partir de z0. `skip_ground` : étages sans fenêtres."""
    fh = h / floors
    for side in sides:
        length = w if side in ("front", "back") else d
        if bays < 1:
            continue
        step = (length - 2 * margin) / bays
        for fl in range(skip_ground, floors):
            zc = z0 + fl * fh + fh * 0.5
            for k in range(bays):
                t = -length / 2 + margin + step * (k + 0.5)
                ww, wh = step * 0.55, fh * 0.55
                if side in ("front", "back"):
                    yo = (-d / 2 if side == "front" else d / 2)
                    out = -0.04 if side == "front" else 0.04
                    box(ww + 0.25, 0.14, wh + 0.25, t, yo + out * 0.6, zc - wh / 2 - 0.12, frame)
                    box(ww, 0.10, wh, t, yo + out * 1.2, zc - wh / 2, glass)
                else:
                    xo = (-w / 2 if side == "left" else w / 2)
                    out = -0.04 if side == "left" else 0.04
                    box(0.14, ww + 0.25, wh + 0.25, xo + out * 0.6, t, zc - wh / 2 - 0.12, frame)
                    box(0.10, ww, wh, xo + out * 1.2, t, zc - wh / 2, glass)


def balconies(w, d, h, z0, floors, bays, m, every=2):
    """Balcons en saillie sur la façade avant, un étage sur deux."""
    fh = h / floors
    step = (w - 4) / bays
    for fl in range(1, floors, every):
        for k in range(bays):
            t = -w / 2 + 2 + step * (k + 0.5)
            zc = z0 + fl * fh
            box(step * 0.8, 1.6, 0.25, t, -d / 2 - 0.8, zc, m)
            box(step * 0.8, 0.12, 1.0, t, -d / 2 - 1.6, zc, m)


def rooftop_units(w, d, z, m, count=3, seed=1):
    rnd = random.Random(seed)
    for k in range(count):
        x = -w * 0.3 + (k % 3) * w * 0.3 + rnd.uniform(-0.5, 0.5)
        y = rnd.uniform(-d * 0.25, d * 0.25)
        box(rnd.uniform(2.5, 4.0), rnd.uniform(2.0, 3.0), rnd.uniform(1.4, 2.2), x, y, z, m)


def canopy(w, depth, z, m, posts=2, post_m=None, x=0.0, y=0.0):
    box(w, depth, 0.25, x, y, z, m)
    for k in range(posts):
        px = x - w / 2 + 0.6 + k * (w - 1.2) / max(1, posts - 1)
        cyl(0.12, z, px, y + depth / 2 - 0.2, 0, post_m or mat("post", FRAME, 0.5), verts=8)


def sign(w, h, x, y, z, m, emit=1.2):
    return box(w, 0.3, h, x, y, z, m)


def tree(x, y, z, scale, rnd):
    cyl(0.18 * scale, 2.6 * scale, x, y, z, mat("trunk", TRUNK, 0.9), verts=6)
    for _ in range(3):
        sphere(1.8 * scale * rnd.uniform(0.8, 1.1), x + rnd.uniform(-0.8, 0.8) * scale, y + rnd.uniform(-0.8, 0.8) * scale,
               z + 3.4 * scale + rnd.uniform(0, 1.2) * scale, mat("leaves", LEAF if rnd.random() < 0.5 else LEAF_LIGHT, 0.85))


# --- Fusion et export ----------------------------------------------------------------------------

def merge_by_material():
    """Fusionne les objets de même matériau : un petit nombre de maillages par bâtiment."""
    groups = {}
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        key = o.data.materials[0].name if o.data.materials else "none"
        groups.setdefault(key, []).append(o)
    for objs in groups.values():
        if len(objs) < 2:
            continue
        with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs):
            bpy.ops.object.join()


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def export(name):
    merge_by_material()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=True, export_apply=True)
    clear_scene()


def rnd_for(name):
    return random.Random(sum(ord(c) for c in name))


# --- Bâtiments résidentiels ----------------------------------------------------------------------

def house(w, d):
    r = rnd_for("house")
    facade = mat("facade", r.choice(FACADES), 0.85)
    box(w * 0.8, d * 0.8, 5.6, 0, 0, 0, facade)
    gable(w * 0.8 + 0.6, d * 0.8 + 0.6, 3.2, 0, 0, 5.6, mat("roof", TILE_RED, 0.8), ridge="x")
    windows(w * 0.8, d * 0.8, 5.6, 0, 2, 2, mat("glass", GLASS, 0.1, 0.1), mat("frame", FRAME, 0.5), margin=1.5)
    box(1.1, 0.12, 2.1, 0, -d * 0.4 - 0.05, 0, mat("door", (0.35, 0.22, 0.14), 0.6))
    tree(-w * 0.38, d * 0.3, 0, 0.8, r)


def apartment(w, d):
    r = rnd_for("apartment")
    h, floors = 22, 7
    facade = mat("facade", r.choice(FACADES), 0.85)
    box(w, d, h, 0, 0, 0, facade)
    # Rez-de-chaussée : vitrines et entrée.
    box(w - 2, 0.1, 3.4, 0, -d / 2 - 0.02, 0.0, mat("shopglass", GLASS_BLUE, 0.05, 0.2))
    canopy(w * 0.4, 1.4, 3.4, mat("canopy", ALU, 0.4, 0.6), posts=2, x=0, y=-d / 2 - 0.7)
    windows(w, d, h, 3.4, floors, 5, mat("glass", GLASS, 0.1, 0.1), mat("frame", FRAME, 0.5), skip_ground=1)
    balconies(w, d, h, 3.4, floors, 3, mat("balcony", ALU, 0.5, 0.5))
    box(w + 0.6, d + 0.6, 0.6, 0, 0, h, mat("cornice", PLASTER, 0.8))
    rooftop_units(w, d, h + 0.6, mat("hvac", METAL, 0.5, 0.5), count=4, seed=3)


def tower(w, d):
    h, floors = 90, 28
    box(w, d, h, 0, 0, 0, mat("curtain", GLASS_BLUE, 0.08, 0.6))
    windows(w, d, h, 0, floors, 6, mat("curtain_panel", (0.20, 0.32, 0.42), 0.05, 0.5), mat("mullion", ALU, 0.3, 0.8), margin=0.8)
    box(w * 0.7, d * 0.7, 6, 0, 0, h, mat("crown", ALU, 0.3, 0.8))
    rooftop_units(w * 0.6, d * 0.6, h + 6, mat("hvac", METAL, 0.5, 0.5), count=3, seed=9)
    cyl(0.25, 14, 0, 0, h + 6, mat("antenna", METAL, 0.4, 0.8), verts=8)


def shop(w, d):
    h = 6.2
    box(w, d, h, 0, 0, 0, mat("facade", PLASTER, 0.8))
    box(w - 1.5, 0.12, 3.8, 0, -d / 2 - 0.03, 0.8, mat("shopglass", GLASS_BLUE, 0.05, 0.2))
    canopy(w - 1.0, 1.6, 4.6, mat("awning", RED, 0.7), posts=2, x=0, y=-d / 2 - 0.8)
    sign(w * 0.8, 1.0, 0, -d / 2 - 0.2, 5.9, mat("sign", SIGN_WARM, 0.4, emit=0.8))
    box(w + 0.4, d + 0.4, 0.5, 0, 0, h, mat("cornice", PLASTER, 0.8))
    windows(w, d, h, 0, 1, 0, mat("glass", GLASS, 0.1), mat("frame", FRAME, 0.5), sides=("back",))


def office(w, d):
    h, floors = 48, 12
    box(w, d, h, 0, 0, 0, mat("curtain", GLASS, 0.06, 0.5))
    windows(w, d, h, 0, floors, 7, mat("curtain_panel", (0.16, 0.26, 0.34), 0.05, 0.5), mat("mullion", ALU, 0.3, 0.8), margin=1.0)
    box(w * 0.65, d * 0.65, 7, 0, 0, h, mat("setback", ALU, 0.4, 0.6))
    windows(w * 0.65, d * 0.65, 7, h, 1, 3, mat("curtain_panel", (0.16, 0.26, 0.34), 0.05, 0.5), mat("mullion", ALU, 0.3, 0.8), margin=0.8)
    rooftop_units(w * 0.5, d * 0.5, h + 7, mat("hvac", METAL, 0.5, 0.5), count=3, seed=5)


def factory(w, d):
    r = rnd_for("factory")
    hall_h = 11
    box(w, d, hall_h, 0, 0, 0, mat("hall", (0.64, 0.60, 0.55), 0.8))
    # Toiture en sheds : une dent vitrée orientée au nord, pour la lumière du jour.
    n = 5
    for k in range(n):
        x = -w / 2 + 4 + k * (w - 8) / (n - 1)
        box(w / n * 0.92, d * 0.92, 2.5, x, 0, hall_h, mat("saw_glass", (0.50, 0.58, 0.62), 0.2, 0.2))
        gable(w / n * 0.92, d * 0.92, 2.5, x, 0, hall_h, mat("saw_roof", BITUMEN, 0.8), ridge="y")
    # Bureaux à l'avant, silo et cheminée.
    box(w * 0.28, d * 0.45, 8, -w / 2 + w * 0.14, -d / 2 - d * 0.22, 0, mat("office", PLASTER, 0.8))
    windows(w * 0.28, d * 0.45, 8, 0, 2, 3, mat("glass", GLASS, 0.1), mat("frame", FRAME, 0.5), margin=1.0)
    cyl(2.8, 16, w / 2 - 4, d / 2 - 5, 0, mat("silo", (0.80, 0.80, 0.78), 0.4, 0.4), verts=20)
    cyl(1.3, 38, w / 2 - 12, -d / 2 + 4, 0, mat("chimney", BRICK, 0.9), verts=14)
    for z in (12, 22, 32):
        cyl(1.42, 0.5, w / 2 - 12, -d / 2 + 4, z, mat("chimney_band", (0.8, 0.8, 0.8), 0.7), verts=14)


def clinic(w, d):
    h = 12
    box(w, d, h, 0, 0, 0, mat("facade", WHITE, 0.6))
    windows(w, d, h, 0, 3, 5, mat("glass", GLASS_BLUE, 0.1), mat("frame", ALU, 0.4), margin=1.5)
    box(w * 0.35, 0.12, 2.0, 0, -d / 2 - 0.05, h - 3.0, mat("cross_bg", RED, 0.6))
    box(w * 0.14, 0.14, 0.6, 0, -d / 2 - 0.12, h - 2.8, mat("cross", WHITE, 0.5))
    box(0.6, 0.14, 1.8, 0, -d / 2 - 0.12, h - 3.4, mat("cross", WHITE, 0.5))
    canopy(w * 0.5, 4.0, 3.2, mat("canopy", WHITE, 0.4, 0.2), posts=3, x=0, y=-d / 2 - 2.0)
    box(w, d, 0.6, 0, 0, h, mat("roof", BITUMEN, 0.8))
    rooftop_units(w, d, h + 0.6, mat("hvac", METAL, 0.5, 0.5), count=3, seed=4)


def school(w, d):
    h = 9
    box(w * 0.7, d, h, -w * 0.15, 0, 0, mat("brick", BRICK, 0.9))
    box(w * 0.3, d * 0.7, 10.5, w * 0.35, 0, 0, mat("gym", BRICK_LIGHT, 0.85))
    gable(w * 0.3 + 0.8, d * 0.7 + 0.8, 3.0, w * 0.35, 0, 10.5, mat("roof", BITUMEN, 0.8), ridge="x")
    windows(w * 0.7, d, h, 0, 2, 9, mat("glass", GLASS, 0.1), mat("frame", FRAME, 0.5), margin=1.2)
    box(w * 0.7 + 0.6, d + 0.6, 0.5, -w * 0.15, 0, h, mat("roof", BITUMEN, 0.8))
    cyl(0.1, 12, -w / 2 + 2, -d / 2 + 2, 0, mat("pole", METAL, 0.4, 0.8), verts=8)
    box(1.8, 0.1, 1.2, -w / 2 + 2.9, -d / 2 + 2, 10.5, mat("flag", (0.12, 0.35, 0.70), 0.7))


def police(w, d):
    h = 8
    box(w, d, h, 0, 0, 0, mat("facade", PLASTER, 0.8))
    box(w + 0.1, d + 0.1, 0.8, 0, 0, h, mat("roof", BITUMEN, 0.8))
    box(w, 0.14, 1.0, 0, -d / 2 - 0.07, 3.8, mat("stripe", BLUE, 0.5))
    windows(w, d, h, 0, 2, 4, mat("glass", GLASS, 0.1), mat("frame", FRAME, 0.5), margin=1.5, sides=("front", "back"))
    cyl(0.08, 4.0, w / 2 - 3, d / 2 - 3, h + 0.8, mat("antenna", METAL, 0.4, 0.8), verts=6)


# --- Énergie, eau, environnement -----------------------------------------------------------------

def power_plant(w, d):
    hall_h = 18
    box(w * 0.6, d * 0.7, hall_h, -w * 0.12, -d * 0.1, 0, mat("hall", (0.66, 0.64, 0.60), 0.8))
    gable(w * 0.6 + 0.6, d * 0.7 + 0.6, 4, -w * 0.12, -d * 0.1, hall_h, mat("roof", BITUMEN, 0.8), ridge="x")
    windows(w * 0.6, d * 0.7, hall_h, 0, 1, 10, mat("glass", GLASS, 0.1), mat("frame", FRAME, 0.5), margin=2.0, sides=("front", "back"))
    tower_profile = [(9.0, 0), (9.0, 4), (7.2, 22), (6.2, 36), (6.6, 44), (7.2, 46)]
    for cx in (w * 0.22, w * 0.42):
        lathe(tower_profile, cx, d * 0.18, 0, mat("cooling", (0.82, 0.82, 0.80), 0.6), segments=20)
    cyl(2.0, 58, w * 0.05, d * 0.32, 0, mat("stack", WHITE, 0.5), verts=14)
    for z in (20, 40):
        cyl(2.1, 1.0, w * 0.05, d * 0.32, z, mat("stack_band", RED, 0.6), verts=14)


def water_tower(w, d):
    leg = mat("leg", METAL, 0.5, 0.6)
    for x, y in [(-6, -6), (6, -6), (-6, 6), (6, 6)]:
        cyl(0.35, 22, x, y, 0, leg, verts=8)
    for z in (6, 14):
        box(12, 0.25, 0.25, 0, -6, z, leg)
        box(0.25, 12, 0.25, -6, 0, z, leg)
    lathe([(7.2, 22), (8.2, 25.5), (8.0, 30), (7.0, 31.5), (0, 31.5)], 0, 0, 0, mat("tank", (0.85, 0.86, 0.84), 0.5, 0.2), segments=24)
    cone_top = lathe([(7.4, 31.5), (0.0, 36)], 0, 0, 0, mat("tank_roof", (0.36, 0.38, 0.42), 0.6, 0.3), segments=24)


def urban_forest(w, d):
    rnd = random.Random(7)
    for k in range(14):
        x = rnd.uniform(-w * 0.42, w * 0.42)
        y = rnd.uniform(-d * 0.42, d * 0.42)
        tree(x, y, 0, rnd.uniform(0.9, 1.6), rnd)


def solar_plant(w, d):
    rows, cols = 4, 6
    dx, dy = w / cols, d / rows
    for i in range(cols):
        for j in range(rows):
            x = -w / 2 + dx * (i + 0.5)
            y = -d / 2 + dy * (j + 0.5)
            cyl(0.07, 1.6, x - dx * 0.3, y, 0, mat("rack", METAL, 0.5, 0.6), verts=6)
            cyl(0.07, 1.6, x + dx * 0.3, y, 0, mat("rack", METAL, 0.5, 0.6), verts=6)
            panel = box(dx * 0.78, dy * 0.72, 0.1, x, y, 1.6, mat("panel", (0.08, 0.14, 0.30), 0.12, 0.3))
            panel.rotation_euler = (math.radians(25), 0, 0)


def park(w, d):
    box(w, d, 0.2, 0, 0, 0, mat("lawn", LAWN, 0.9))
    box(w * 0.18, d * 0.92, 0.04, 0, 0, 0.2, mat("path", (0.78, 0.76, 0.70), 0.9))
    box(w * 0.92, w * 0.10, 0.04, 0, 0, 0.2, mat("path", (0.78, 0.76, 0.70), 0.9))
    rnd = random.Random(3)
    for x, y in [(-w * 0.32, -d * 0.30), (w * 0.30, d * 0.28), (-w * 0.30, d * 0.22), (w * 0.32, -d * 0.25)]:
        tree(x, y, 0.2, 1.0, rnd)
    box(2.0, 0.5, 0.45, w * 0.1, d * 0.1, 0.2, mat("bench", (0.45, 0.30, 0.20), 0.7))


def barracks(w, d):
    h = 7
    box(w, d, h, 0, 0, 0, mat("facade", (0.50, 0.52, 0.42), 0.85))
    gable(w + 0.6, d + 0.6, 4.0, 0, 0, h, mat("roof", (0.30, 0.32, 0.28), 0.85), ridge="x")
    windows(w, d, h, 0, 2, 9, mat("glass", GLASS, 0.1), mat("frame", FRAME, 0.5), margin=2.0, sides=("front", "back"))
    cyl(0.12, 12, w / 2 - 3, 0, 0, mat("pole", METAL, 0.4, 0.8), verts=8)
    box(3.0, 0.1, 1.8, w / 2 - 3 + 1.5, 0, 10.5, mat("flag", RED, 0.7))


def bus_station(w, d):
    box(w, d, 0.2, 0, 0, 0, mat("platform", CONCRETE_DARK, 0.9))
    for x in (-w / 2 + 0.8, w / 2 - 0.8):
        for y in (-d / 2 + 0.8, d / 2 - 0.8):
            cyl(0.07, 3.0, x, y, 0.2, mat("steel", METAL, 0.4, 0.8), verts=6)
    box(w, d, 0.12, 0, 0, 3.2, mat("shelter_roof", ALU, 0.3, 0.6))
    box(w - 1.2, 0.04, 2.2, 0, d / 2 - 0.5, 0.2, mat("shelter_glass", (0.55, 0.70, 0.78), 0.05, 0.1))
    box(2.0, 0.12, 0.5, 0, -d / 2 + 0.6, 0.5, mat("bench", (0.40, 0.28, 0.18), 0.7))
    sign(0.9, 1.4, w / 2 - 1.0, -d / 2 + 0.5, 0.2, mat("bus_sign", (0.08, 0.40, 0.70), 0.4, emit=0.6))


def tram_station(w, d):
    box(w, d, 0.35, 0, 0, 0, mat("platform", CONCRETE, 0.85))
    box(w * 0.8, d * 0.7, 0.1, 0, 0, 4.2, mat("tram_roof", ALU, 0.3, 0.6))
    for y in (-d / 2 + 1, d / 2 - 1):
        cyl(0.1, 4.2, 0, y, 0.35, mat("steel", METAL, 0.4, 0.8), verts=6)
    box(w, 0.1, 0.1, 0, 0, 5.8, mat("catenary", (0.2, 0.2, 0.22), 0.4, 0.6))
    box(0.08, 0.08, 1.6, 0, 0, 5.8, mat("catenary", (0.2, 0.2, 0.22), 0.4, 0.6))


def metro_station(w, d):
    box(w, d, 3.4, 0, 0, 0, mat("entrance_glass", GLASS_BLUE, 0.05, 0.3))
    box(w + 0.4, d + 0.4, 0.2, 0, 0, 3.4, mat("entrance_roof", ALU, 0.4, 0.6))
    windows(w, d, 3.4, 0, 1, 3, mat("glass", GLASS, 0.05), mat("frame", FRAME, 0.5), margin=1.5, sides=("front",))
    sign(1.8, 1.8, 0, -d / 2 - 0.2, 1.4, mat("metro_m", (0.06, 0.32, 0.72), 0.4, emit=1.0))
    cyl(0.9, 0.2, 0, -d / 2 - 1.2, 0.0, mat("entrance_base", CONCRETE, 0.8), verts=10)


def train_station(w, d):
    h = 10
    box(w, d, h, 0, 0, 0, mat("hall", (0.72, 0.70, 0.66), 0.7))
    windows(w, d, h, 0, 3, 14, mat("glass", GLASS, 0.05, 0.1), mat("frame", ALU, 0.4, 0.6), margin=1.5, sides=("front", "back"))
    r = d * 0.42
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=w * 0.96, location=(0, 0, h + r))
    arch = bpy.context.active_object
    arch.rotation_euler = (0, math.pi / 2, 0)
    _link(arch, mat("arch_roof", ALU, 0.3, 0.6))
    box(w * 0.96, d * 0.92, 0.1, 0, 0, h + r - 0.1, mat("arch_glass", (0.45, 0.58, 0.64), 0.1, 0.2))
    for x in range(-int(w / 2) + 2, int(w / 2) - 1, 6):
        box(0.3, d * 0.9, 0.2, x, 0, h + r * 0.4, mat("arch_rib", ALU, 0.3, 0.6))
    box(w + 6, 4.0, 0.25, 0, -d / 2 - 3.5, 3.2, mat("platform_canopy", ALU, 0.4, 0.5))
    for x in (-w / 2 + 2, 0, w / 2 - 2):
        cyl(0.15, 3.2, x, -d / 2 - 5.5, 0, mat("steel", METAL, 0.4, 0.8), verts=8)
    box(w + 6, 1.5, 0.3, 0, -d / 2 - 1.0, 0.0, mat("plat", CONCRETE, 0.8))


def port(w, d):
    box(w, d, 1.2, 0, 0, 0, mat("quay", CONCRETE, 0.85))
    cols = [(0.78, 0.18, 0.15), (0.12, 0.35, 0.62), (0.88, 0.66, 0.16), (0.22, 0.50, 0.30), (0.70, 0.72, 0.74)]
    for i in range(5):
        for j in range(3):
            c = cols[(i * 3 + j) % len(cols)]
            for lvl in range(2):
                box(6.0, 2.5, 2.6, -w / 2 + 6 + i * 11, -d / 2 + 4 + j * 4.5, 1.2 + lvl * 2.6, mat(f"cont{(i + j) % 5}", c, 0.5, 0.3))
    warehouse_w = w * 0.3
    box(warehouse_w, d * 0.45, 8, w * 0.28, d * 0.22, 1.2, mat("warehouse", (0.58, 0.60, 0.62), 0.6, 0.3))
    gable(warehouse_w + 0.4, d * 0.45 + 0.4, 2.0, w * 0.28, d * 0.22, 9.2, mat("roof", BITUMEN, 0.8), ridge="x")
    # Portique : deux jambes, une flèche en porte-à-faux.
    gx, gy = w / 2 - 6, -d / 2 + 4
    crane = mat("crane", (0.85, 0.55, 0.15), 0.5, 0.4)
    for lx in (gx - 3.5, gx + 3.5):
        box(1.0, 1.0, 34, lx, gy, 1.2, crane)
    box(9.0, 1.4, 1.4, gx, gy, 34.5, crane)
    box(26.0, 1.0, 1.0, gx - 11, gy, 35.0, crane)
    box(2.6, 2.6, 2.4, gx - 3, gy, 31.8, mat("crane_cab", (0.9, 0.9, 0.85), 0.5))
    for k in range(4):
        cyl(0.12, 1.0, gx - 18 + k * 1.2, gy, 35.0, mat("crane_stay", (0.4, 0.4, 0.42), 0.5, 0.6), verts=6)


def airbase(w, d):
    box(w, d * 0.22, 0.12, 0, -d * 0.28, 0, mat("runway", ASPHALT, 0.9))
    for k in range(-4, 5):
        box(4.0, 0.5, 0.02, k * 8.0, -d * 0.28, 0.12, mat("runway_mark", WHITE, 0.6))
    # Hangar à toit cintré.
    hw, hd, hh = w * 0.30, d * 0.38, 14
    box(hw, hd, hh * 0.5, w * 0.22, d * 0.18, 0, mat("hangar", (0.62, 0.64, 0.66), 0.5, 0.3))
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=hd / 2, depth=hw, location=(w * 0.22, d * 0.18, hh * 0.5))
    arch = bpy.context.active_object
    arch.rotation_euler = (0, math.pi / 2, 0)
    arch.scale = (1, 1, 0.9)
    _link(arch, mat("hangar_roof", (0.66, 0.68, 0.70), 0.5, 0.3))
    # Tour de contrôle.
    cyl(2.8, 16, -w * 0.32, d * 0.25, 0, mat("tower_base", PLASTER, 0.7), verts=12)
    box(7.5, 7.5, 3.0, -w * 0.32, d * 0.25, 16, mat("tower_cab", GLASS, 0.05, 0.4))
    box(8.4, 8.4, 0.5, -w * 0.32, d * 0.25, 19, mat("roof", BITUMEN, 0.8))


def parking(w, d):
    box(w, d, 0.3, 0, 0, 0, mat("asphalt", ASPHALT, 0.92))
    # Lignes de marquage et véhicules, en deux rangées.
    for k in range(5):
        box(w * 0.92, 0.12, 0.02, 0, -d / 2 + 4.5 + k * 7.0, 0.3, mat("paint", WHITE, 0.6))
    rnd = random.Random(11)
    for k in range(4):
        for side in (-1, 1):
            for slot in range(3):
                if rnd.random() < 0.3:
                    continue
                x = side * w * 0.22
                y = -d / 2 + 5 + k * 9.0 + (slot % 2) * 0.1
                body = (0.7, 0.72, 0.76) if rnd.random() < 0.5 else (0.2, 0.28, 0.42)
                box(2.0, 4.4, 0.8, x, y, 0.3, mat(f"car{rnd.randint(0,3)}", body, 0.35, 0.5))
                box(1.7, 2.2, 0.6, x, y - 0.3, 1.1, mat("glass_car", (0.18, 0.22, 0.26), 0.1, 0.3))


def parking_garage(w, d):
    floors, fh = 4, 3.2
    concrete = mat("concrete", CONCRETE, 0.85)
    for k in range(floors):
        z = k * fh
        # Dalle de sol de chaque niveau, bordure en façade, poteaux en trame, muret de fond seulement.
        box(w, d, 0.3, 0, 0, z, concrete)
        box(w, 0.4, fh, 0, d / 2 - 0.2, z, concrete)
        box(0.4, d, 0.25, -w / 2 + 0.2, 0, z + fh - 0.3, concrete)
        box(0.4, d, 0.25, w / 2 - 0.2, 0, z + fh - 0.3, concrete)
        for x in range(-int(w / 2) + 2, int(w / 2) - 1, 5):
            for y in (-d / 2 + 0.5, d / 2 - 0.5):
                box(0.5, 0.5, fh, x, y, z, mat("column", CONCRETE_DARK, 0.9))
        box(w - 1.0, 0.25, 0.9, 0, -d / 2 + 0.5, z + fh - 1.0, mat("garage_rail", (0.55, 0.56, 0.58), 0.6, 0.4))
    # Rampe en pente droite, de la rue au premier niveau ; toit-terrasse avec garde-corps.
    run = math.hypot(fh, 12.0)
    ramp = box(6.0, run, 0.3, w / 2 + 6.0, 0, 0, mat("ramp", CONCRETE_DARK, 0.9))
    ramp.rotation_euler = (math.atan2(fh, 12.0), 0, 0)
    box(w, d, 0.3, 0, 0, floors * fh, mat("roof_slab", CONCRETE, 0.9))
    box(w, 0.12, 1.0, 0, -d / 2 + 0.1, floors * fh + 0.3, mat("garde_corps", (0.5, 0.5, 0.52), 0.5, 0.5))


def casino(w, d):
    box(w, d, 10, 0, 0, 0, mat("casino_base", RED, 0.35, 0.2))
    windows(w, d, 10, 0, 1, 7, mat("casino_glass", (0.08, 0.12, 0.16), 0.05, 0.5), mat("gold_frame", GOLD, 0.2, 0.8), margin=2.0, sides=("front",))
    box(w * 0.78, d * 0.78, 6, 0, 0, 10, mat("casino_top", (0.45, 0.10, 0.10), 0.3, 0.3))
    box(w * 0.5, 0.2, 2.0, 0, -d / 2 - 0.1, 16, mat("sign_casino", GOLD, 0.3, 0.6, emit=2.5))
    canopy(w * 0.5, 3.0, 4.0, mat("canopy_gold", GOLD, 0.3, 0.8), posts=2, x=0, y=-d / 2 - 1.2)
    box(w * 0.4, 0.2, 2.6, 0, -d / 2 - 0.05, 0.0, mat("entry_glass", (0.08, 0.14, 0.18), 0.05, 0.5))


def hotel(w, d):
    h, floors = 40, 12
    box(w, d, h, 0, 0, 0, mat("hotel_facade", PLASTER_COOL, 0.7))
    windows(w, d, h, 0, floors, 6, mat("glass", GLASS_BLUE, 0.1, 0.2), mat("frame", ALU, 0.4, 0.5), margin=2.0)
    box(w + 0.8, d + 0.8, 0.8, 0, 0, h, mat("cornice", PLASTER, 0.8))
    box(w * 0.5, 0.2, 2.2, 0, -d / 2 - 0.1, 0.0, mat("sign_hotel", (0.85, 0.66, 0.20), 0.3, 0.5, emit=1.5))
    canopy(w * 0.45, 4.0, 3.5, mat("canopy_hotel", ALU, 0.3, 0.6), posts=4, x=0, y=-d / 2 - 2.0)
    box(w * 0.85, 1.0, 0.5, 0, -d / 2 - 0.5, 5.0, mat("balcony_hotel", PLASTER, 0.8))


def cinema(w, d):
    h = 9
    box(w, d, h, 0, 0, 0, mat("cinema_facade", (0.22, 0.24, 0.30), 0.7))
    box(w * 0.92, 0.3, 4.0, 0, -d / 2 - 0.15, 3.0, mat("marquee", (0.92, 0.85, 0.55), 0.6, emit=2.0))
    for x in (-w * 0.3, 0, w * 0.3):
        box(w * 0.22, 0.12, 2.0, x, -d / 2 - 0.05, 3.2, mat("poster_glass", GLASS, 0.05, 0.4))
    canopy(w * 0.7, 2.6, 6.0, mat("canopy_cinema", (0.18, 0.20, 0.24), 0.4, 0.4), posts=3, x=0, y=-d / 2 - 1.2)
    box(w + 0.4, d + 0.4, 0.4, 0, 0, h, mat("roof", BITUMEN, 0.8))
    sign(1.2, 5.0, w / 2 - 1.0, -d / 2 - 0.5, 4.0, mat("cinema_sign", (0.90, 0.20, 0.20), 0.4, emit=1.5))


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
    """Tronçon de 10 m : rue (6 m), avenue (12 m, terre-plein central) ou pont (8 m, garde-corps)."""
    width = {"street": 6, "avenue": 12, "bridge": 8}[kind]
    box(10, width, 0.12, 0, 0, 0, mat("asphalt", ASPHALT, 0.9))
    box(10, 0.12, 0.01, 0, 0, 0.13, mat("paint", (0.85, 0.82, 0.55), 0.6))
    if kind == "avenue":
        box(10, 1.8, 0.2, 0, 0, 0.12, mat("median", LAWN, 0.9))
    if kind == "bridge":
        box(10, 0.3, 1.0, 0, -width / 2, 0.12, mat("rail", METAL, 0.4, 0.7))
        box(10, 0.3, 1.0, 0, width / 2, 0.12, mat("rail", METAL, 0.4, 0.7))


def terrain(kind):
    if kind == "land":
        box(20, 20, 0.5, 0, 0, -0.5, mat("grass", LAWN, 0.9))
    elif kind == "hill":
        # Grille 24×24 de 20 m : un massif avec des creux et des crêtes, pour que la colline ne soit pas un dôme.
        n, size = 24, 20.0
        rnd = random.Random(5)
        bumps = [(rnd.uniform(-7, 7), rnd.uniform(-7, 7), rnd.uniform(2.0, 4.0), rnd.uniform(3, 6)) for _ in range(5)]
        verts, faces = [], []
        for j in range(n + 1):
            for i in range(n + 1):
                x = -size / 2 + size * i / n
                y = -size / 2 + size * j / n
                r2 = (x * x + y * y) / 100.0
                z = max(0.0, 4.5 * (1 - r2) ** 1.5) if r2 < 1 else 0.0
                for bx, by, bh, bs in bumps:
                    z += bh * math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * bs * bs)) * (1 - r2 if r2 < 1 else 0)
                verts.append((x, y, z - 0.4))
        for j in range(n):
            for i in range(n):
                a = j * (n + 1) + i
                faces.append((a, a + 1, a + n + 2, a + n + 1))
        mesh_from(verts, faces, mat("hill", (0.40, 0.50, 0.28), 0.95))
    elif kind == "water":
        box(20, 20, 0.4, 0, 0, -0.45, mat("water", WATER, 0.1, 0.0))


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
