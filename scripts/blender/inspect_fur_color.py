"""Inspect fur color data + strand material wiring to explain the white coat."""
import bpy
import numpy as np

# 1) strand material wiring
mat = bpy.data.materials['LX_ShortFur_Strand']
nt = mat.node_tree
sh = next(n for n in nt.nodes if n.type == 'BSDF_HAIR_PRINCIPLED')
print('=== strand material ===')
print('parametrization:', getattr(sh, 'parametrization', 'N/A'))
for inp in sh.inputs:
    if not inp.is_linked and hasattr(inp, 'default_value') and not hasattr(inp.default_value, '__len__'):
        print(f'  {inp.name} = {inp.default_value}')
print('linked inputs:', [i.name for i in sh.inputs if i.is_linked])
for n in nt.nodes:
    if n.type == 'ATTRIBUTE':
        print('attribute node:', n.attribute_name, '-> links:', [l.to_node.name + '.' + l.to_socket.name for l in n.outputs['Color'].links])

# 2) actual coat_color data on render curves
print('=== curves data ===')
for ob in bpy.context.scene.objects:
    if ob.type == 'CURVES' and 'Body' in ob.name:
        a = ob.data.attributes.get('coat_color')
        if a is None:
            print(ob.name, 'NO coat_color'); continue
        arr = np.empty(len(a.data) * 4, dtype='f')
        a.data.foreach_get('color', arr)
        c = arr.reshape(-1, 4)[:, :3]
        print(ob.name, 'domain', a.domain, 'mean rgb', c.mean(0).round(3), 'min', c.min(0).round(3), 'max', c.max(0).round(3))

# 3) body mesh fur_color corner attribute
body = bpy.data.objects.get('LX_Body')
if body:
    a = body.data.attributes.get('fur_color')
    if a:
        arr = np.empty(len(a.data) * 4, dtype='f')
        a.data.foreach_get('color', arr)
        c = arr.reshape(-1, 4)[:, :3]
        print('LX_Body fur_color CORNER mean', c.mean(0).round(3))

# 4) which objects carry the strand material / visibility
print('=== fur objects ===')
for ob in bpy.context.scene.objects:
    if ob.name.startswith(('LX_Fur_', 'LX_RenderFur')):
        mats = [m.name if m else None for m in ob.data.materials] if hasattr(ob.data, 'materials') else []
        print(ob.name, ob.type, 'hide_render', ob.hide_render, 'mats', mats)
print('INSPECT DONE')
