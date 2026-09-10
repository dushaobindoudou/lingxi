"""Read-only verification of the saved character production scene."""
import bpy
from pathlib import Path
scene = bpy.context.scene
refs = [o for o in scene.objects if o.type == 'EMPTY' and o.empty_display_type == 'IMAGE']
module = 'bl_ext.user_default.mcp'
result = {
    'scene': scene.name,
    'saved_file_exists': Path(bpy.data.filepath).is_file(),
    'references': [{'name': o.name, 'packed': bool(o.data.packed_file)} for o in refs],
    'cameras': len([o for o in scene.objects if o.type == 'CAMERA']),
    'lights': len([o for o in scene.objects if o.type == 'LIGHT']),
    'official_addon_enabled': module in bpy.context.preferences.addons,
    'automatic_start': bpy.context.preferences.addons[module].preferences.use_autostart,
    'community_addon_enabled': 'blender_mcp' in bpy.context.preferences.addons,
    'stage': scene.get('stage'),
}
assert result['saved_file_exists'] and len(refs) == 3
assert all(r['packed'] for r in result['references'])
assert result['cameras'] == 4 and result['lights'] == 3
assert result['official_addon_enabled'] and not result['automatic_start']
