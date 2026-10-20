"""Round ZZZ+1 (codex STAGE-ZZQ-AUDIT #7: take-off push): per frame of Jump, each hind leg's foot behind the hip (+ = behind, along the
cat's own back-axis, mm - the toe tip's world position minus the hip's, projected on the body's rest forward axis), the extension ratio
|hip - hock| / (femur + tibia) (codex: >= .95 and < .995 at take-off), and the toe tip's height. Env FRAMES=a,b,step (153,200,1)."""
import bpy, os, math
from mathutils import Vector
sc = bpy.context.scene; rig = bpy.data.objects['LX_Rig']; W = rig.matrix_world; pb = rig.pose.bones
a, b, st = [int(x) for x in os.environ.get('FRAMES', '153,200,1').split(',')]
toe = {s: next((n for n in (f'RearToe1.{s}', f'RearPaw.{s}', f'RearFoot.{s}') if n in pb), None) for s in 'LR'}
for f in range(a, b + 1, st):
    sc.frame_set(f); out = {}
    fwd = (W.to_3x3() @ (pb['Root'].matrix.to_3x3() @ Vector((0, 0, -1)))) if False else None
    for s in 'LR':
        hip = W @ pb[f'RearUpper.{s}'].head; hock = W @ pb[f'RearLower.{s}'].tail; tip = W @ pb[toe[s]].tail
        L = pb[f'RearUpper.{s}'].bone.length + pb[f'RearLower.{s}'].bone.length
        out[s] = {'behind_mm': round(1000 * (tip.y - hip.y)), 'ext': round((hock - hip).length / L, 3), 'toe_z': round(1000 * tip.z, 1)}
    print('JUMP', f, out, 'hip_z', round(1000 * (W @ pb['RearUpper.L'].head).z))
