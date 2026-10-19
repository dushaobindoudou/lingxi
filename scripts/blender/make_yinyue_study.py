"""Yin Yue costume study on the downloaded, animated female humanoid.

Reuse Quaternius's mesh, weights, 65-node rig and imported long hairstyle.
Additional garments/accessories are authored here; no original show mesh is used.
Run from the repo with Blender --background --factory-startup --disable-autoexec
--python-exit-code 1 --python scripts/blender/make_yinyue_study.py.
"""
import json
import math
import random
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "assets/characters/human"
OUT = BASE / "work/yinyue"
PREVIEW = BASE / "preview"
random.seed(29)
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BASE / "work/human-female.blend"))
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
rig.name = "YinYue_Quaternius_Female65"
rig.animation_data.action = None
for track in rig.animation_data.nla_tracks:
    track.mute = True
rig.data.pose_position = "REST"
bpy.context.view_layer.update()
body = bpy.data.objects["Superhero_Female"]
original = [body, bpy.data.objects["Eyes"], bpy.data.objects["Eyebrows"]]
character = original.copy()

# A dressed game character omits skin polygons permanently concealed by clothes.
# Keep the original source file untouched; preserve skinning on the visible parts.
hidden_faces = []
for polygon in body.data.polygons:
    co = sum((body.data.vertices[i].co for i in polygon.vertices), Vector()) / len(polygon.vertices)
    if co.z < .069 or .235 < co.z < 1.08 or (1.08 <= co.z < 1.412 and abs(co.x) < .195) or .251 < abs(co.x) < .625:
        hidden_faces.append(polygon.index)
bm = bmesh.new()
bm.from_mesh(body.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in hidden_faces], context="FACES")
bm.to_mesh(body.data)
bm.free()
for obj in original:
    for vertex in obj.data.vertices:
        co = vertex.co
        if co.z > 1.54:
            if co.z < 1.635:
                # Softer jaw and a less projected lower face, not a new mesh.
                t = max(0, min(1, (1.635-co.z)/.075))
                co.x *= 1-.15*t
                if co.y < -.045:
                    co.y += .006*t
            else:
                co.x *= 1.035
        if obj==body and -.13 < co.y < -.035 and 1.628 < co.z < 1.685:
            # Open the original narrow eye area a little, with smooth falloff.
            distance=(abs(co.x)-.035)**2/.021**2+(co.z-1.656)**2/.022**2
            co.z += (co.z-1.656)*.20*math.exp(-distance)
        if obj==original[1]:
            co.z=1.656+(co.z-1.656)*1.12
        if obj==original[2]:
            co.z+=.006-.015*max(0,min(1,(abs(co.x)-.018)/.045))
    smooth_mesh=bmesh.new()
    smooth_mesh.from_mesh(obj.data)
    bmesh.ops.remove_doubles(smooth_mesh,verts=list(smooth_mesh.verts),dist=.000005)
    smooth_mesh.to_mesh(obj.data)
    smooth_mesh.free()
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if obj.data.has_custom_normals:
        obj.data.normals_split_custom_set([(0,0,0)]*len(obj.data.loops))
    obj.data.update()

# One surface subdivision softens the downloaded angular base without rebinding.
bpy.context.view_layer.objects.active=body
subdivision=body.modifiers.new("Soft facial surface","SUBSURF")
subdivision.levels=1
bpy.ops.object.modifier_apply(modifier=subdivision.name)

# Use gentler hands and head posture in this character's copied animation data.
for action in bpy.data.actions:
    if not action.name.startswith("Human_"):
        continue
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                grouped={}
                for fcurve in bag.fcurves:
                    if fcurve.data_path.endswith("rotation_quaternion"):
                        grouped.setdefault(fcurve.data_path,{})[fcurve.array_index]=fcurve
                for path,curves in grouped.items():
                    amount=.68 if any(f'["{name}' in path for name in ["thumb_","index_","middle_","ring_","pinky_"]) else 0
                    if action.name in ["Human_Idle_Loop","Human_Idle_Talking_Loop"]:
                        if '["Head"]' in path:
                            amount=.65
                        elif '["neck_01"]' in path:
                            amount=.35
                    if not amount or set(curves)!={0,1,2,3}:
                        continue
                    for i in range(len(curves[0].keyframe_points)):
                        q=Quaternion([curves[j].keyframe_points[i].co.y for j in range(4)])
                        q=q.slerp(Quaternion(),amount)
                        for j in range(4):
                            curves[j].keyframe_points[i].co.y=q[j]
                    for fcurve in curves.values():
                        fcurve.update()


def material(name, color, rough=.6, metal=0, texture=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if texture:
        image = bpy.data.images.load(str(texture), check_existing=True)
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


cloth = material("YinYue | silver jacquard", (.7, .73, .77), .67,
                 texture=OUT / "textures/silver-cloud-jacquard.png")
graphite = material("YinYue | graphite borders", (.055, .065, .08), .65)
silver = material("YinYue | engraved silver", (.55, .64, .69), .29, .82)
gold = material("YinYue | aged champagne", (.47, .30, .13), .35, .67)
red = material("YinYue | crimson silk", (.24, .022, .031), .48)
pink = material("YinYue | inner ear", (.42, .19, .22), .83)
hair = material("YinYue | silver hair", (.66, .73, .8), .48)
fur = material("YinYue | snow fur", (.8, .84, .88), .9)
for mat, scale, strength in [(hair, 180, .11), (fur, 240, .35), (red, 100, .08)]:
    nt = mat.node_tree
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = .002
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], nt.nodes["Principled BSDF"].inputs["Normal"])

# Replace the source's baked angular skin shading with a smooth preview material.
# The downloaded body, visible mesh and original deform weights remain in use.
skin = material("YinYue | smooth porcelain skin",(.68,.48,.40),.6)
body.data.materials[0] = skin
nt = skin.node_tree
bsdf = nt.nodes.get("Principled BSDF")
bsdf.inputs["Roughness"].default_value = .6
lip=material("YinYue | rose lips",(.58,.35,.32),.62)
body.data.materials.append(lip)
for polygon in body.data.polygons:
    co=sum((body.data.vertices[i].co for i in polygon.vertices),Vector())/len(polygon.vertices)
    if 1.576 < co.z < 1.588 and co.y < -.079 and abs(co.x)<.024:
        polygon.material_index=1
original[2].data.materials.clear()
original[2].data.materials.append(material("YinYue | soft silver brows",(.21,.25,.29),.8))
eye_material = original[1].data.materials[0].copy()
original[1].data.materials[0] = eye_material
eye_nt = eye_material.node_tree
eye_bsdf = eye_nt.nodes.get("Principled BSDF")
eye_link = next((l for l in eye_nt.links if l.to_socket == eye_bsdf.inputs["Base Color"]), None)
if eye_link:
    source = eye_link.from_socket
    eye_nt.links.remove(eye_link)
    tint = eye_nt.nodes.new("ShaderNodeHueSaturation")
    tint.inputs["Hue"].default_value = .92
    tint.inputs["Saturation"].default_value = .7
    eye_nt.links.new(source, tint.inputs["Color"])
    eye_nt.links.new(tint.outputs["Color"], eye_bsdf.inputs["Base Color"])
    # glTF cannot encode Blender's Hue/Saturation node. Bake just the base-color
    # shader through the original UVs, so Blender and GLB show the same eyes.
    baked=bpy.data.images.new("YinYue turquoise eyes | shader bake",width=256,height=256,alpha=False)
    texture=eye_nt.nodes.new("ShaderNodeTexImage")
    texture.image=baked
    for node in eye_nt.nodes:
        node.select=False
    texture.select=True
    eye_nt.nodes.active=texture
    output=next(node for node in eye_nt.nodes if node.type=="OUTPUT_MATERIAL")
    emission=eye_nt.nodes.new("ShaderNodeEmission")
    eye_nt.links.new(tint.outputs["Color"],emission.inputs["Color"])
    eye_nt.links.new(emission.outputs[0],output.inputs["Surface"])
    bpy.ops.object.select_all(action="DESELECT")
    original[1].select_set(True)
    bpy.context.view_layer.objects.active=original[1]
    bpy.context.scene.render.engine="CYCLES"
    bpy.context.scene.cycles.samples=1
    bpy.ops.object.bake(type="EMIT",margin=4)
    eye_nt.links.new(eye_bsdf.outputs[0],output.inputs["Surface"])
    eye_nt.links.new(texture.outputs["Color"],eye_bsdf.inputs["Base Color"])
    eye_nt.nodes.remove(emission)
    baked.filepath_raw=str(OUT/"textures/eye-turquoise-baked.png")
    baked.file_format="PNG"
    baked.save()


def bind(obj, weights=None, bone="Head"):
    # Use existing deform bones rather than adding/exporting a second armature.
    obj.parent = None
    obj.vertex_groups.clear()
    groups = {}
    for vertex in obj.data.vertices:
        co = obj.matrix_world @ vertex.co
        values = weights(co) if weights else {bone: 1}
        total = sum(values.values())
        for key, value in values.items():
            if value > 0:
                if key not in groups:
                    groups[key] = obj.vertex_groups.new(name=key)
                groups[key].add([vertex.index], value / total, "REPLACE")
    modifier = obj.modifiers.new("Original female skeleton", "ARMATURE")
    modifier.object = rig
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    character.append(obj)
    return obj


def mesh(name, vertices, faces, mat, uv=None, weights=None, bone="Head"):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    data.materials.append(mat)
    if uv:
        layer = data.uv_layers.new(name="GarmentUV")
        for polygon in data.polygons:
            for loop in polygon.loop_indices:
                layer.data[loop].uv = uv[data.loops[loop].vertex_index]
    return bind(obj, weights, bone)


def torso_weights(co):
    z = co.z
    if z < 1.08:
        return {"pelvis": 1}
    anchors = [(1.05, "spine_01"), (1.165, "spine_02"), (1.31, "spine_03")]
    for (a, first), (b, second) in zip(anchors, anchors[1:]):
        if a <= z <= b:
            t = (z - a) / (b - a)
            return {first: 1 - t, second: t}
    return {"spine_03": 1}


def oval_garment(name, profiles, mat, weights, pleat=0, tiles=(2, 2)):
    vertices, uv, faces = [], [], []
    count = 64
    for j, (z, rx, ry, cy) in enumerate(profiles):
        for i in range(count + 1):
            a = i / count * 2 * math.pi
            ripple = 1 + pleat * math.cos(12 * a) * j / max(1, len(profiles) - 1)
            vertices.append((rx * math.sin(a) * ripple, cy - ry * math.cos(a) * ripple, z))
            uv.append((i / count * tiles[0], j / (len(profiles) - 1) * tiles[1]))
    for j in range(len(profiles) - 1):
        for i in range(count):
            a = j * (count + 1) + i
            faces.append((a, a + 1, a + count + 2, a + count + 1))
    return mesh(name, vertices, faces, mat, uv, weights)


oval_garment("Silver high-neck bodice", [
    (1.055, .142, .095, .016), (1.105, .132, .098, .012),
    (1.18, .142, .104, .006), (1.25, .174, .139, -.004),
    (1.31, .177, .158, -.01), (1.36, .148, .132, .005),
    (1.41, .107, .091, .018), (1.47, .067, .065, .025),
    (1.493, .059, .058, .027),
], cloth, torso_weights, tiles=(1, 1))


def skirt_weights(co):
    # Broad robe follows pelvis; limited leg following permits slow walk preview.
    amount = max(0, min(.22, (1.0 - co.z) * .3))
    side = "l" if co.x >= 0 else "r"
    return {"pelvis": 1 - amount, f"thigh_{side}": amount}


oval_garment("Long pleated silver robe", [
    (1.067, .146, .11, .035), (.97, .19, .137, .04),
    (.88, .215, .157, .04), (.72, .24, .179, .035),
    (.52, .274, .201, .035), (.32, .305, .217, .034),
    (.18, .337, .235, .03),
], cloth, skirt_weights, .065, (3, 2))
oval_garment("Graphite robe hem", [(.205, .338, .236, .03), (.173, .343, .24, .03)],
             graphite, skirt_weights, .055, (3, 1))
oval_garment("Silver robe hem piping", [(.210, .339, .237, .03), (.204, .34, .238, .03)],
             silver, skirt_weights, .055)
oval_garment("Crimson waist wrap", [
    (1.063, .154, .117, .012), (1.10, .148, .113, .012), (1.137, .145, .111, .012),
], red, torso_weights, tiles=(1, 1))


def curve(name, points, radius, mat, weights=None, bone="Head"):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 12
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return bind(bpy.context.object, weights, bone)


def ball(name, location, scale, mat, bone="Head", weights=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return bind(obj, weights, bone)


def torus(name, location, radius, minor, mat, rotation=(math.pi/2, 0, 0), bone="Head"):
    bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=8,
        location=location, rotation=rotation, major_radius=radius, minor_radius=minor)
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    return bind(obj, bone=bone)


# Waist cords, bow and broad draping tails.
for z in [1.078, 1.113]:
    curve("Twisted crimson belt", [(.15*math.sin(a), .012-.122*math.cos(a),
          z+.005*math.sin(a*2)) for a in [i*math.pi/8 for i in range(17)]], .008, red, torso_weights)
for side in [-1, 1]:
    curve("Crimson bow loop", [(0, -.127, 1.086), (side*.065, -.143, 1.13),
          (side*.087, -.145, 1.07), (0, -.135, 1.086)], .015, red, torso_weights)
    vertices, uv = [], []
    for j in range(17):
        t = j/16
        center = Vector((side*(.016+.046*t), -.134-.015*math.sin(t*math.pi), 1.076-.52*t))
        width = .029*(1-.18*t)
        for i in range(5):
            u = i/4
            co = center+Vector(((u-.5)*2*width, -.008*math.sin(u*2*math.pi+t*3), 0))
            vertices.append(co)
            uv.append((u,t))
    faces = [(j*5+i,j*5+i+1,(j+1)*5+i+1,(j+1)*5+i) for j in range(16) for i in range(4)]
    mesh("Crimson sash tail", vertices, faces, red, uv, skirt_weights)
ball("Silver belt clasp", (0, -.155, 1.087), (.022, .01, .015), gold, weights=torso_weights)

# Draped sleeves retain the source arm chain and hand freedom.
for side, suffix in [(1, "l"), (-1, "r")]:
    def arm_weights(co, suffix=suffix):
        t = max(0, min(1, (abs(co.x)-.33)/.09))
        return {f"upperarm_{suffix}": 1-t, f"lowerarm_{suffix}": t}
    profiles = [(.242,.06),(.29,.073),(.37,.084),(.45,.11),(.53,.138),(.609,.158)]
    vertices, uv, faces = [], [], []
    for j,(x,radius) in enumerate(profiles):
        for i in range(33):
            a=i/32*2*math.pi
            vertices.append((side*x,.054-radius*math.cos(a),1.418+radius*math.sin(a)))
            uv.append((i/32*1.5,j/(len(profiles)-1)))
    for j in range(len(profiles)-1):
        for i in range(32):
            a=j*33+i
            faces.append((a,a+1,a+34,a+33))
    mesh(f"Silver bell sleeve {suffix}",vertices,faces,cloth,uv,arm_weights)
    for x,radius,width,mat in [(.245,.066,.006,red),(.602,.161,.007,graphite),(.594,.159,.0025,silver)]:
        curve(f"Sleeve edging {suffix}",[(side*x,.054-radius*math.cos(a),1.418+radius*math.sin(a))
              for a in [i*math.pi/16 for i in range(33)]],width,mat,arm_weights)
    for i in range(24):
        a=i/24*2*math.pi
        loc=(side*.25,.054-.07*math.cos(a),1.418+.07*math.sin(a))
        ball(f"Fur upper cuff {suffix}",loc,(.019,.014,.015),fur,bone=f"upperarm_{suffix}")

# An asymmetric-looking fur collar is built from soft overlapping tufts.
collar=[(-.085,.026,1.483),(-.067,-.033,1.464),(-.033,-.081,1.447),
        (0,-.098,1.424),(.033,-.081,1.447),(.067,-.033,1.464),(.085,.026,1.483),
        (.056,.095,1.492),(0,.106,1.496),(-.056,.095,1.492),(-.085,.026,1.483)]
curve("Snow fur collar base",collar,.019,fur,torso_weights)
for a,b in zip(collar,collar[1:]):
    for i in range(6):
        co=Vector(a).lerp(Vector(b),i/6)
        co+=Vector((random.uniform(-.006,.006),random.uniform(-.006,.006),random.uniform(-.003,.003)))
        ball("Collar fur tuft",co,(.014,.012,random.uniform(.018,.025)),fur,weights=torso_weights)

# Reuse the package's actual female-compatible long hairstyle.
hair_file=next((BASE/"downloads/universal-base-characters").rglob(
    "Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.gltf"))
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(hair_file))
imported=set(bpy.data.objects)-before
long_hair=next(o for o in imported if o.type=="MESH" and o.name.startswith("Hair_Long"))
world=long_hair.matrix_world.copy()
long_hair.parent=None
long_hair.matrix_world=world
long_hair.modifiers.clear()
source_hair_mat=long_hair.data.materials[0].copy()
source_hair_mat.name="YinYue | reused silver hair UVs"
for node in source_hair_mat.node_tree.nodes:
    if node.type=="NORMAL_MAP":
        node.inputs["Strength"].default_value=.5
long_hair.data.materials.clear()
long_hair.data.materials.append(source_hair_mat)
long_hair.name="Silver hair | reused Quaternius Hair_Long"
# Retain the downloaded crown; replace its blunt lower bob with flowing locks.
hair_mesh=bmesh.new()
hair_mesh.from_mesh(long_hair.data)
hair_mesh.faces.ensure_lookup_table()
bmesh.ops.delete(hair_mesh,geom=[f for f in hair_mesh.faces
    if min(v.co.z for v in f.verts)<1.624],context="FACES")
hair_mesh.to_mesh(long_hair.data)
hair_mesh.free()
bind(long_hair)
for obj in imported:
    if obj!=long_hair:
        bpy.data.objects.remove(obj,do_unlink=True)


def lock(name,points,widths,depths):
    data=bpy.data.curves.new(name,"CURVE")
    data.dimensions="3D"
    data.resolution_u=16
    data.bevel_depth=max(widths)
    data.bevel_resolution=3
    data.use_fill_caps=True
    spline=data.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for point,co,width in zip(spline.bezier_points,points,widths):
        point.co=co
        point.radius=width/max(widths)
        point.handle_left_type="AUTO"
        point.handle_right_type="AUTO"
    obj=bpy.data.objects.new(name,data)
    bpy.context.scene.collection.objects.link(obj)
    data.materials.append(hair)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target="MESH")
    return bind(bpy.context.object)

# Sculptural side locks and swept bangs make the silver silhouette readable.
for side in [-1,1]:
    for i in range(5):
        x=side*(.073+i*.013)
        y=.034+i*.012
        lock("Silver long side lock",[(x,y,1.727),(x*1.16,y,1.60),
             (x*1.32,y+.016,1.44),(x*1.54,y+.047,1.265),
             (x*1.64,y+.05,1.20)], [.018,.025,.026,.02,.001], [.015,.019,.018,.014,.001])
        curve("Silver lock highlight",[(x,y-.016,1.716),(x*1.16,y-.021,1.60),
              (x*1.32,y-.018,1.44),(x*1.53,y+.03,1.27)],.0011,silver)
    # Front curtain sweeps away from the eyes, rather than covering the face.
    lock("Silver cheek framing lock",[(side*.071,-.063,1.737),(side*.105,-.092,1.70),
         (side*.114,-.080,1.61),(side*.13,-.068,1.46),(side*.15,-.061,1.35)],
         [.022,.019,.016,.017,.001],[.012,.012,.012,.011,.001])
for i in range(7):
    x=(i-3)*.014
    end=1.689+abs(i-3)*.004
    lock("Silver swept fringe",[(x*.3+.025,-.025,1.767),(x*.65+.006,-.077,1.735),
         (x-.025,-.105,end+.015),(x-.044,-.096,end)],
         [.012,.014,.012,.001],[.012,.01,.008,.001])
for i in range(15):
    a=(i-7)/7*1.35
    x=.104*math.sin(a)
    y=.115*math.cos(a)
    lock("Silver flowing back lock",[(x*.75,y*.8,1.746),(x*1.05,y,1.66),
         (x*1.22,y+.035,1.48),(x*1.5,y+.05,1.30),(x*1.65,y+.09,1.22)],
         [.013,.016,.019,.022,.0008],[.009,.011,.014,.015,.001])

# Two soft triangular beast ears, with pink insets and one ear's three rings.
for side in [-1,1]:
    verts=[(side*.041,-.025,1.738),(side*.136,-.022,1.732),(side*.153,.009,1.88),
           (side*.057,.049,1.751),(side*.136,.041,1.75),(side*.149,.026,1.87),
           (side*.101,-.01,1.80)]
    faces=[(0,6,2),(6,1,2),(0,1,6),(3,5,4),(0,3,4,1),(1,4,5,2),(2,5,3,0)]
    ear=mesh("Silver beast ear",verts,faces,fur)
    bevel=ear.modifiers.new("Soft ear edges","BEVEL")
    bevel.width=.005
    bevel.segments=2
    mesh("Rose inner ear",[(side*.067,-.027,1.759),(side*.117,-.026,1.754),
         (side*.143,.003,1.861),(side*.10,-.021,1.792)],[(0,3,2),(3,1,2)],pink)
    for i in range(10):
        t=i/10
        loc=Vector((side*.136,-.02,1.739)).lerp(Vector((side*.15,.01,1.87)),t)
        ball("Ear edge tuft",loc,(.009,.008,.016),fur)
    if side==1:
        for i in range(3):
            torus("Silver ear ring",(side*(.13+i*.007),-.022,1.785+i*.026),.012,.0028,silver)
    torus("Silver hanging earring",(side*.097,-.006,1.60),.013,.0024,silver)
    ball("Silver earring drop",(side*.097,-.005,1.568),(.009,.009,.018),silver)

# Bodice silver scrolls and front skirt piping, authored as actual 3D trim.
for side in [-1,1]:
    curve("Graphite bodice outline",[(side*.028,-.086,1.467),(side*.089,-.114,1.391),
          (side*.133,-.12,1.332),(side*.13,-.104,1.28)],.0035,graphite,torso_weights)
    curve("Silver breast embroidery",[(side*.024,-.151,1.345),(side*.058,-.171,1.312),
          (side*.102,-.145,1.295),(side*.128,-.132,1.338),(side*.075,-.136,1.37),
          (side*.042,-.153,1.343)],.0027,silver,torso_weights)
    curve("Silver robe panel piping",[(side*.078,-.113,1.05),(side*.106,-.14,.9),
          (side*.15,-.158,.68),(side*.21,-.175,.39),(side*.24,-.183,.20)],.003,silver,skirt_weights)
    # Closed slippers cover the original bare feet without editing body weights.
    ball("Graphite silk slipper",(side*.112,-.053,.04),(.065,.132,.052),graphite,bone=f"foot_{'l' if side==1 else 'r'}")
    curve("Silver slipper piping",[(side*.15,-.132,.05),(side*.11,-.182,.036),
          (side*.069,-.13,.05)],.0025,silver,bone=f"foot_{'l' if side==1 else 'r'}")

# Merge small accessories per weighting family, keeping materials and skin groups.
# It also keeps the runtime draw count reasonable without introducing extra bones.
categories={}
for obj in character[3:]:
    if obj==long_hair:
        continue
    key="head" if all(g.name=="Head" for g in obj.vertex_groups) else "garment"
    categories.setdefault(key,[]).append(obj)
for key,objects in categories.items():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        # Apply bevel in bind pose before merging, preserving armature deformation.
        bpy.context.view_layer.objects.active=obj
        for modifier in list(obj.modifiers):
            if modifier.type!="ARMATURE":
                bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    objects[0].name=f"YinYue | {key} accessories"
    character=[o for o in character if o not in objects or o==objects[0]]

rig.data.pose_position="POSE"
for track in rig.animation_data.nla_tracks:
    track.mute=False
rig.animation_data.action=None
bpy.ops.object.select_all(action="DESELECT")
for obj in [rig]+character:
    obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/"yinyue-study.glb"),export_format="GLB",
    use_selection=True,export_skins=True,export_animations=True,
    export_animation_mode="NLA_TRACKS",export_force_sampling=True,
    export_anim_slide_to_zero=True,export_cameras=False,export_lights=False)
for track in rig.animation_data.nla_tracks:
    track.mute=True
idle=bpy.data.actions["Human_Idle_Loop"]
rig.animation_data.action=idle
rig.animation_data.action_slot=idle.slots[0]
scene=bpy.context.scene
scene.frame_set(int(sum(idle.frame_range)/2))
scene.frame_start,scene.frame_end=[int(v) for v in idle.frame_range]
rig["costume_study"]="Yin Yue / 凡人修仙传; fan reconstruction on existing adult female base"
rig["reused"]="Quaternius female mesh, original weights, 65 bones, Hair_Long; UAL baked actions"
rig["new_geometry"]="robe, bell sleeves, sash, fur collar, beast ears, silver accessories, hair extensions"
scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.028,.044,.064,1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value=.35
ground=bpy.data.objects.get("PreviewGround_NotCharacter")
if ground:
    mat=material("Moonlit studio floor",(.045,.064,.082),.82)
    ground.data.materials.clear()
    ground.data.materials.append(mat)
scene.render.engine="BLENDER_EEVEE"
scene.render.resolution_x=1000
scene.render.resolution_y=1300
scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG"
scene.view_settings.view_transform="AgX"
camera=scene.camera
camera.data.type="ORTHO"
camera.data.ortho_scale=2.35


def shot(name,position,target,scale=2.35):
    camera.location=position
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.ortho_scale=scale
    scene.render.filepath=str(PREVIEW/f"yinyue-{name}.png")
    bpy.ops.render.render(write_still=True)


for image in bpy.data.images:
    if image.size[0] and image.source=="FILE":
        image.pack()
shot("front",(0,-5,1.45),(0,0,.99))
shot("three-quarter",(2.7,-5,2.0),(0,0,.99))
scene.render.resolution_x=1000
scene.render.resolution_y=1000
shot("portrait",(.7,-4,1.8),(0,-.015,1.57),.78)
walk=bpy.data.actions["Human_Walk_Loop"]
rig.animation_data.action=walk
rig.animation_data.action_slot=walk.slots[0]
scene.frame_set(int(sum(walk.frame_range)/2))
scene.render.resolution_x=1000
scene.render.resolution_y=1300
shot("walk",(2.7,-5,2.0),(0,0,.99))
rig.animation_data.action=idle
rig.animation_data.action_slot=idle.slots[0]
scene.frame_set(int(sum(idle.frame_range)/2))
camera.location=(2.7,-5,2.0)
camera.rotation_euler=(Vector((0,0,.99))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.ortho_scale=2.35
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=="VIEW_3D":
            area.spaces.active.shading.type="MATERIAL"
            area.spaces.active.region_3d.view_location=(0,0,1)
            area.spaces.active.region_3d.view_distance=3.3
            area.spaces.active.region_3d.view_rotation=camera.rotation_euler.to_quaternion()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"yinyue-study.blend"))
report={"id":"yinyue-study","base":"human-female.blend","bones":len(rig.data.bones),
    "actions":len(rig.animation_data.nla_tracks),"meshes":[{"name":o.name,"vertices":len(o.data.vertices)} for o in character],
    "style":"animation Yin Yue inspired costume study, adult base with softened jaw and concealed-body mask",
    "bodyMask":{"hiddenSourceFaces":len(hidden_faces),"purpose":"prevent concealed skin from protruding through the robe"},
    "limitations":["Original show's face/body were not acquired or recreated exactly",
                   "Garments and long hair use skeletal weights, not cloth/hair dynamics",
                   "Deep squat, sitting, and extreme arms require costume collision cleanup",
                   "Existing base grounding and lack of live IK still apply"],
    "texture":"textures/silver-cloud-jacquard.png"}
(OUT/"audit.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print("YINYUE_READY",json.dumps(report,ensure_ascii=False),flush=True)
