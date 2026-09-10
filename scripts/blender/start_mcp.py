"""Explicitly start official MCP for this Blender session, preserving manual-start preference."""
import bpy
import addon_utils
module = 'bl_ext.user_default.mcp'
addon_utils.enable(module, default_set=False)
prefs = bpy.context.preferences.addons[module].preferences
prefs.host = '127.0.0.1'
prefs.port = 9877
prefs.use_autostart = False
outcome = bpy.ops.blmcp.server_start()
print('LINGXI_OFFICIAL_MCP', outcome, bpy.app.version_string, flush=True)
