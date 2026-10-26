"""Véhicules 3D de CreateYourCity : voiture, camion, bus, tramway (glTF, Blender en Python sans interface).

Exécution : python tools/blender/build_vehicles.py -- <dossier_de_sortie>

Conventions : l'avant du véhicule est le +X, le bas de roue est à z = 0, la largeur est sur Y. Le matériau
« paint » est la carrosserie (teintée par le client) ; « glass », « dark » (pneus, bas de caisse) et
« light » (phares, feux) ne sont jamais teintés.
"""
import math
import os
import sys

import bpy

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "vehicles"
os.makedirs(OUT, exist_ok=True)

_mats = {}


def mat(name, color, rough=0.5, metal=0.0, emit=0.0):
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


def box(w, d, h, x, y, z, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + h / 2))
    o = bpy.context.active_object
    o.scale = (w, d, h)
    o.data.materials.append(m)
    return o


def wheel(x, y, r, width, m):
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=r, depth=width, location=(x, y, r))
    o = bpy.context.active_object
    o.rotation_euler = (math.pi / 2, 0, 0)
    o.data.materials.append(m)
    return o


def rounded_body(length, width, height, x0, z0, m, glass_m, cabin_len, cabin_h, cabin_x):
    """Caisse basse et habitacle vitré, en deux pavés (approximation des profils arrondis)."""
    box(length, width, height, x0, 0, z0, m)
    box(cabin_len, width * 0.92, cabin_h, cabin_x, 0, z0 + height, m)
    # Pare-brise et lunette : vitrages fins sur les faces avant et arrière de l'habitacle.
    box(0.05, width * 0.84, cabin_h * 0.72, cabin_x + cabin_len / 2 + 0.01, 0, z0 + height + cabin_h * 0.12, glass_m)
    box(0.05, width * 0.84, cabin_h * 0.6, cabin_x - cabin_len / 2 - 0.01, 0, z0 + height + cabin_h * 0.18, glass_m)
    box(cabin_len * 0.7, 0.05, cabin_h * 0.6, cabin_x, width * 0.46, z0 + height + cabin_h * 0.2, glass_m)
    box(cabin_len * 0.7, 0.05, cabin_h * 0.6, cabin_x, -width * 0.46, z0 + height + cabin_h * 0.2, glass_m)


def export(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=True, export_apply=True)
    # On supprime seulement les objets : les matériaux partagés restent valables pour le véhicule suivant.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


PAINT = mat("paint", (1.0, 1.0, 1.0), 0.45, 0.2)
GLASS = mat("glass", (0.09, 0.13, 0.18), 0.05, 0.4)
DARK = mat("dark", (0.07, 0.07, 0.08), 0.8)
RIM = mat("rim", (0.62, 0.64, 0.68), 0.35, 0.8)
LIGHT_W = mat("light", (1.0, 0.97, 0.85), 0.2, 0.0, emit=3.0)
LIGHT_R = mat("light_red", (0.9, 0.12, 0.10), 0.3, 0.0, emit=1.5)


def car():
    """Berline 4,4 m : caisse basse, habitacle vitré, quatre roues, phares et feux."""
    rounded_body(4.4, 1.8, 0.6, 0, 0.25, PAINT, GLASS, cabin_len=2.2, cabin_h=0.6, cabin_x=-0.2)
    box(4.4, 1.8, 0.12, 0, 0, 0.2, DARK)  # bas de caisse noir
    for x in (-1.35, 1.35):
        for y in (-0.9, 0.9):
            wheel(x, y * 1.0, 0.33, 0.24, DARK)
            wheel(x, y * 1.0, 0.18, 0.26, RIM)
    for y in (-0.6, 0.6):
        box(0.05, 0.3, 0.12, 2.22, y, 0.62, LIGHT_W)
        box(0.05, 0.3, 0.12, -2.22, y, 0.62, LIGHT_R)


def truck():
    """Camion : cabine avancée et remorque de 7,5 m."""
    box(7.5, 2.5, 3.0, -1.6, 0, 0.6, PAINT)
    box(7.5, 2.5, 0.25, -1.6, 0, 0.5, DARK)
    box(2.0, 2.4, 2.4, 3.7, 0, 0.6, PAINT)
    box(0.05, 2.0, 1.1, 4.72, 0, 1.7, GLASS)
    box(0.2, 2.2, 0.5, 4.75, 0, 0.7, DARK)  # calandre
    for x in (-3.6, -0.5, 3.4):
        for y in (-1.1, 1.1):
            wheel(x, y, 0.5, 0.36, DARK)
            wheel(x, y, 0.3, 0.38, RIM)
    for y in (-0.85, 0.85):
        box(0.05, 0.3, 0.14, 4.74, y, 0.85, LIGHT_W)


def bus():
    """Bus urbain de 12 m : caisse haute, vitrages en bandeau, portes à l'avant."""
    box(12.0, 2.5, 2.9, 0, 0, 0.7, PAINT)
    box(11.9, 2.52, 0.6, 0, 0, 0.7, DARK)
    for k in range(6):
        x = -5.0 + k * 2.0
        box(1.5, 0.04, 1.0, x, 1.27, 1.9, GLASS)
        box(1.5, 0.04, 1.0, x, -1.27, 1.9, GLASS)
    box(0.05, 2.1, 1.4, 6.02, 0, 2.2, GLASS)  # pare-brise
    box(0.6, 0.04, 1.6, 5.2, 1.27, 1.4, GLASS)  # porte avant
    for x in (-3.6, 3.6):
        for y in (-1.15, 1.15):
            wheel(x, y, 0.5, 0.36, DARK)
            wheel(x, y, 0.3, 0.38, RIM)
    for y in (-0.8, 0.8):
        box(0.05, 0.3, 0.14, 6.02, y, 0.9, LIGHT_W)


def tram():
    """Rame de tram : deux caisses articulées de 13 m, toit plat, bandeau de vitres."""
    for x in (-6.8, 6.8):
        box(13.0, 2.5, 3.2, x, 0, 0.7, PAINT)
        for k in range(4):
            box(2.2, 0.04, 1.1, x - 4.5 + k * 3.0, 1.27, 2.1, GLASS)
            box(2.2, 0.04, 1.1, x - 4.5 + k * 3.0, -1.27, 2.1, GLASS)
    box(1.2, 2.2, 1.0, 0, 0, 0.7, DARK)  # articulation
    box(0.05, 2.2, 1.5, 13.35, 0, 1.9, GLASS)
    box(13.5, 2.55, 0.2, 0, 0, 0.6, DARK)
    for x in (-10.0, -3.5, 3.5, 10.0):
        wheel(x, 1.15, 0.45, 0.3, DARK)
        wheel(x, -1.15, 0.45, 0.3, DARK)


if __name__ == "__main__":
    for name, fn in [("car", car), ("truck", truck), ("bus", bus), ("tram", tram)]:
        fn()
        export(name)
    print(f"4 véhicules écrits dans {OUT}")
