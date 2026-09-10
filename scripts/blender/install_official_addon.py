"""Install official Blender Lab MCP with automatic server startup disabled."""
from pathlib import Path
import bpy
import addon_utils
root = Path(__file__).resolve().parents[2]
assert bpy.app.background, 'Install in background so no autostart timer can run'
if 'blender_mcp' in bpy.context.preferences.addons:
    addon_utils.disable('blender_mcp', default_set=True)
bpy.ops.extensions.package_install_files(filepath=str(root / '.local/blender-lab-mcp.zip'), repo='user_default', enable_on_install=False)
module = 'bl_ext.user_default.mcp'
addon_utils.enable(module, default_set=True, persistent=True)
prefs = bpy.context.preferences.addons[module].preferences
prefs.host = '127.0.0.1'
prefs.port = 9877
prefs.use_autostart = False
bpy.ops.wm.save_userpref()
print('OFFICIAL_ADDON_INSTALLED', module, prefs.host, prefs.port, 'autostart=', prefs.use_autostart)
