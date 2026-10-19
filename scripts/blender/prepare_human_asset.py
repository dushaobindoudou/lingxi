"""Prepare downloaded Quaternius humanoids without rebuilding mesh or skin weights.

blender --background --factory-startup --disable-autoexec \
  --python scripts/blender/prepare_human_asset.py -- --gender Male

Originals stay in assets/characters/human/downloads. Derived .blend/.glb files
and a measured rig/animation report go to assets/characters/human/work.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
HOME = ROOT / "assets/characters/human"
CLIPS = [
    "Idle_Loop", "Idle_Talking_Loop", "Walk_Loop", "Walk_Formal_Loop",
    "Jog_Fwd_Loop", "Sprint_Loop", "Crouch_Idle_Loop", "Crouch_Fwd_Loop",
    "Sitting_Enter", "Sitting_Idle_Loop", "Sitting_Exit", "Interact",
    "Dance_Loop", "Jump_Start", "Jump_Loop", "Jump_Land",
]


def import_fixed_model(gender, output):
    source = next((HOME / "downloads/universal-base-characters").rglob(
        f"Godot - UE/Superhero_{gender}_FullBody.gltf"))
    data = json.loads(source.read_text())
    stage = output / f"input-{gender.lower()}"
    stage.mkdir(parents=True, exist_ok=True)
    repairs = []
    for entry in data.get("images", []) + data.get("buffers", []):
        uri = entry.get("uri")
        if not uri or uri.startswith("data:"):
            continue
        original = source.parent / uri
        if not original.is_file():
            corrected = uri.replace("_png.png", ".png")
            candidate = source.parent / corrected
            if not candidate.is_file():
                raise FileNotFoundError(f"Missing source resource: {uri}")
            repairs.append({"original": uri, "resolved": corrected})
            entry["uri"] = corrected
            original = candidate
        destination = stage / entry["uri"]
        if not destination.exists():
            destination.symlink_to(original)
    fixed = stage / source.name
    fixed.write_text(json.dumps(data))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(fixed))
    imported = set(bpy.data.objects) - before
    rig = next(obj for obj in imported if obj.type == "ARMATURE")
    meshes = [obj for obj in imported if obj.type == "MESH" and any(
        modifier.type == "ARMATURE" and modifier.object == rig for modifier in obj.modifiers)]
    assert len(meshes) == 3, "Expected the source body, eyes and eyebrows"
    return rig, meshes, source, repairs


def choose_action(rig, action, slot):
    rig.animation_data_create()
    rig.animation_data.action = action
    rig.animation_data.action_slot = slot


def retarget(target, source, actions):
    # Equal bone names do not imply equal rest poses or segment lengths. Transfer
    # rotations relative to the source bind pose; preserve target parent offsets.
    rest = {bone.name: bone.matrix_local.copy() for bone in target.data.bones}
    target.animation_data_create()
    source_rest = {bone.name: bone.matrix_local.copy() for bone in source.data.bones}
    assert set(rest) == set(source_rest), "Source and target bone roles differ"
    ordered = sorted(target.data.bones, key=lambda bone: len(bone.parent_recursive))
    def leg_length(matrices, side):
        return sum((matrices[a].translation - matrices[b].translation).length for a, b in [
            (f"thigh_{side}", f"calf_{side}"), (f"calf_{side}", f"foot_{side}")])
    motion_scale = sum(leg_length(rest, side) for side in ["l", "r"]) / sum(
        leg_length(source_rest, side) for side in ["l", "r"])
    reports, prepared = [], {}
    for name in CLIPS:
        source_action, slot = actions[name]
        choose_action(source, source_action, slot)
        start, end = [int(round(value)) for value in source_action.frame_range]
        action = bpy.data.actions.new(name=f"Human_{name}")
        action.use_fake_user = True
        target.animation_data.action = action
        previous = {}
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            poses = {}
            for bone in ordered:
                key = bone.name
                current = source.pose.bones[key].matrix
                rotation = (current.to_quaternion()
                            @ source_rest[key].to_quaternion().inverted()
                            @ rest[key].to_quaternion())
                pose = rotation.to_matrix().to_4x4()
                if bone.parent:
                    offset = rest[bone.parent.name].inverted() @ rest[key]
                    pose.translation = (poses[bone.parent.name] @ offset).translation
                else:
                    pose.translation = rest[key].translation
                if key in {"root", "pelvis"}:
                    pose.translation = rest[key].translation + (
                        current.translation - source_rest[key].translation) * motion_scale
                poses[key] = pose
                kwargs = {"matrix": pose, "matrix_local": rest[key], "invert": True}
                if bone.parent:
                    kwargs.update(parent_matrix=poses[bone.parent.name],
                                  parent_matrix_local=rest[bone.parent.name])
                basis = bone.convert_local_to_pose(**kwargs)
                location, rotation, scale = basis.decompose()
                if key in previous:
                    rotation.make_compatible(previous[key])
                previous[key] = rotation.copy()
                posed = target.pose.bones[key]
                posed.rotation_mode = "QUATERNION"
                posed.rotation_quaternion = rotation
                posed.location = location if key in {"root", "pelvis"} else Vector((0, 0, 0))
                posed.scale = (1, 1, 1)
                posed.keyframe_insert("rotation_quaternion", frame=frame, group=key)
                if key in {"root", "pelvis"}:
                    posed.keyframe_insert("location", frame=frame, group=key)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for point in curve.keyframe_points:
                            point.interpolation = "LINEAR"
        prepared[name] = action
        reports.append({"name": name, "frames": [start, end],
                        "seconds": (end - start) / bpy.context.scene.render.fps})
        print("HUMAN_CLIP", name, start, end, flush=True)
    return prepared, reports, motion_scale


def bounds(meshes):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
    assert all(math.isfinite(component) for point in points for component in point)
    return {"min": [min(point[i] for point in points) for i in range(3)],
            "max": [max(point[i] for point in points) for i in range(3)]}


def studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new("HumanPreviewWorld")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.15, 0.19, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    bpy.ops.object.camera_add(location=(2.8, -5, 2.4))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, 0.9)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.3
    scene.camera = camera
    for name, location, energy, size in [
        ("Key", (3, -4, 5), 600, 4), ("Fill", (-3, -2, 3), 350, 3),
        ("Rim", (0, 3, 3), 500, 3),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size = energy, "DISK", size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200)
    ground = bpy.context.object
    ground.name = "PreviewGround_NotCharacter"
    material = bpy.data.materials.new("PreviewGround")
    material.diffuse_color = (0.09, 0.11, 0.14, 1)
    ground.data.materials.append(material)


def present_rig(target):
    groups = {name: target.data.collections.new(name) for name in [
        "Core - pelvis spine head", "Arm L", "Arm R", "Leg L", "Leg R",
        "Fingers L", "Fingers R", "Leaf helpers",
    ]}
    for bone in target.data.bones:
        for collection in list(bone.collections):
            collection.unassign(bone)
        name = bone.name
        side = "L" if name.endswith("_l") else "R"
        if "leaf" in name:
            group = "Leaf helpers"
        elif name.startswith(("thumb", "index", "middle", "ring", "pinky")):
            group = "Fingers " + side
        elif name.startswith(("clavicle", "upperarm", "lowerarm", "hand")):
            group = "Arm " + side
        elif name.startswith(("thigh", "calf", "foot", "ball")):
            group = "Leg " + side
        else:
            group = "Core - pelvis spine head"
        groups[group].assign(bone)
        target.pose.bones[name].custom_shape = None
    groups["Leaf helpers"].is_visible = False
    target["asset_author"] = "Quaternius"
    target["asset_source"] = "https://quaternius.itch.io/universal-base-characters"
    target["human_rig_id"] = "quaternius-human65-v1"
    target["animation_mode"] = "FK baked; in-place library; no live foot IK"
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.shading.type = "MATERIAL"
                space.region_3d.view_location = (0, 0, .9)
                space.region_3d.view_distance = 3.2
                space.region_3d.view_rotation = bpy.context.scene.camera.rotation_euler.to_quaternion()
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="POSE")
    target.data.bones.active = target.data.bones["pelvis"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gender", choices=["Male", "Female"], default="Male")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    output = HOME / "work"
    output.mkdir(parents=True, exist_ok=True)
    preview = HOME / "preview"
    preview.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    target, meshes, original, repairs = import_fixed_model(args.gender, output)
    target.name = f"Human_{args.gender}_OriginalRig"
    target.show_in_front = True
    target.data.display_type = "OCTAHEDRAL"
    original_vertices = {obj.name: len(obj.data.vertices) for obj in meshes}
    before = set(bpy.data.objects)
    library = next((HOME / "downloads/universal-animation-library").rglob("UAL1_Standard.glb"))
    bpy.ops.import_scene.gltf(filepath=str(library))
    source_objects = set(bpy.data.objects) - before
    source = next(obj for obj in source_objects if obj.type == "ARMATURE")
    actions = {strip.action.name: (strip.action, strip.action_slot)
               for track in source.animation_data.nla_tracks for strip in track.strips}
    for track in source.animation_data.nla_tracks:
        track.mute = True
    prepared, clips, motion_scale = retarget(target, source, actions)
    for obj in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    diagnostics = []
    for report in clips:
        action = prepared[report["name"]]
        choose_action(target, action, action.slots[0])
        first, last = report["frames"]
        samples = []
        for frame in sorted(set([first, (first + last) // 2, last])):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            measured = bounds(meshes)
            samples.append({"frame": frame, **measured})
        diagnostics.append({"name": report["name"], "samples": samples})
        track = target.animation_data.nla_tracks.new()
        track.name = report["name"]
        strip = track.strips.new(report["name"], first, action)
        strip.action_slot = action.slots[0]
        strip.extrapolation = "NOTHING"
        track.mute = True
    # The entire model retains the original imported mesh and weights.
    assert original_vertices == {obj.name: len(obj.data.vertices) for obj in meshes}
    missing_images = [image.name for image in bpy.data.images if image.users and image.size[0] == 0]
    assert not missing_images, missing_images
    for image in bpy.data.images:
        if image.size[0] and image.source == "FILE":
            image.pack()
    target.animation_data.action = None
    for track in target.animation_data.nla_tracks:
        track.mute = False
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [target] + meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = target
    identifier = f"human-{args.gender.lower()}"
    bpy.ops.export_scene.gltf(
        filepath=str(output / (identifier + ".glb")), export_format="GLB",
        use_selection=True, export_skins=True, export_animations=True,
        export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_anim_slide_to_zero=True, export_cameras=False, export_lights=False,
    )
    for track in target.animation_data.nla_tracks:
        track.mute = True
    choose_action(target, prepared["Idle_Loop"], prepared["Idle_Loop"].slots[0])
    scene.frame_start, scene.frame_end = [int(value) for value in prepared["Idle_Loop"].frame_range]
    scene.frame_set(scene.frame_start)
    studio()
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    present_rig(target)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / (identifier + ".blend")))
    for name in ["Idle_Loop", "Walk_Loop", "Crouch_Idle_Loop", "Interact"]:
        action = prepared[name]
        choose_action(target, action, action.slots[0])
        scene.frame_set(int(sum(action.frame_range) / 2))
        scene.render.filepath = str(preview / f"{identifier}-{name}.png")
        bpy.ops.render.render(write_still=True)
    report = {"id": identifier, "source": str(original.relative_to(ROOT)),
              "boneCount": len(target.data.bones), "fps": scene.render.fps,
              "meshVertices": original_vertices, "imageReferenceRepairs": repairs,
              "retarget": {"method": "bind-relative global rotations, preserved target segment offsets",
                           "rootPelvisMotionScale": motion_scale, "sourceRootMotion": "disabled",
                           "footLock": "not implemented", "sourceClips": len(actions)},
              "bones": [{"name": bone.name, "parent": bone.parent.name if bone.parent else None,
                         "head": list(bone.head_local), "tail": list(bone.tail_local)} for bone in target.data.bones],
              "clips": clips, "poseBounds": diagnostics,
              "limitations": ["No facial morphs or jaw bone", "FK/baked rig; no live IK solver exported",
                              "Sitting clips require an external seat", "Foot contacts require review before runtime locomotion"]}
    (output / (identifier + "-audit.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print("HUMAN_READY", identifier, len(target.data.bones), len(prepared), flush=True)


if __name__ == "__main__":
    main()
