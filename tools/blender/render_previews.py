"""Rendus d'aperçu des maquettes : une image par modèle, en vue isométrique (Blender en Python, sans interface).

Usage : python tools/blender/render_previews.py -- <dossier_des_glb> <dossier_des_png>
"""
import glob
import math
import os
import sys

import bpy
from mathutils import Vector

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
os.makedirs(dst, exist_ok=True)

for path in sorted(glob.glob(os.path.join(src, "*.glb"))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    # Boîte englobante pour cadrer la caméra.
    corners = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    centre = (lo + hi) / 2
    size = max((hi - lo).length, 10)

    bpy.ops.object.camera_add(location=(centre.x + size, centre.y - size, centre.z + size * 0.8))
    cam = bpy.context.active_object
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    bpy.context.scene.camera = cam
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.0
    sun_obj = bpy.data.objects.new("sun", sun)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(55), 0, math.radians(30))
    # Ciel clair et lumière du soleil : rendu physique (Cycles, CPU).
    scene = bpy.context.scene
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.74, 0.90, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    bpy.context.scene.render.filepath = os.path.join(dst, os.path.basename(path)[:-4] + ".png")
    bpy.ops.render.render(write_still=True)
    print("aperçu :", bpy.context.scene.render.filepath)
