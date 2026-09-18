"""Explicitly start official MCP for this Blender session, preserving manual-start preference."""
import os
import bpy
import addon_utils

# The legacy community addon (scripts/addons/blender_mcp.py, module 'blender_mcp')
# auto-starts its own threaded server on 9876 at every launch and speaks a different
# wire protocol - it silently starves the official server (docs/10 claims it was
# disabled, but it was still enabled in userprefs and grabbed the port first, which
# is why the official bridge appeared "connected but never answering").
# Disable it for real and persist that, so the official server owns the port.
if addon_utils.check('blender_mcp')[0]:
    addon_utils.disable('blender_mcp', default_set=True)
    print('LINGXI_MCP: legacy community blender_mcp addon disabled', flush=True)

module = 'bl_ext.user_default.mcp'
addon_utils.enable(module, default_set=False)
prefs = bpy.context.preferences.addons[module].preferences
prefs.host = os.environ.get('BLENDER_MCP_HOST', '127.0.0.1')
# 9876 = the official blmcp default (its client reads BLENDER_MCP_PORT, same default).
# The old hardcode of 9877 desynced from every client default - the live add-on answered
# on 9876 while scripts/docs assumed 9877. Overridable via BLENDER_MCP_PORT.
prefs.port = int(os.environ.get('BLENDER_MCP_PORT', '9876'))
prefs.use_autostart = False

# Bind-wait: a just-killed previous instance leaves accepted connections in TIME_WAIT,
# and on macOS a bind without SO_REUSEADDR fails while any of those exist. Worse, a
# failed server_start leaves the addon half-started (its background thread binds later
# but the servicing timer is never registered), so the port LISTENS yet no request is
# ever answered - a silent wedge. Wait until the port is actually bindable first.
import socket as _socket
import time as _time
_port = int(prefs.port)
for _ in range(30):
    probe = _socket.socket()
    try:
        probe.bind((prefs.host or '127.0.0.1', _port))
        probe.close()
        break
    except OSError:
        probe.close()
        _time.sleep(3)

outcome = bpy.ops.blmcp.server_start()
print('LINGXI_OFFICIAL_MCP', outcome, bpy.app.version_string, flush=True)
bpy.ops.wm.save_userpref()  # persist the community-addon disable across launches
