"""Read-only probe of Claude's final Round R; never saves the input blend."""
import bpy, json, math
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

out = Path(__file__).parent
scene = bpy.context.scene
rig = bpy.data.objects['LX_Rig']
body = bpy.data.objects['LX_Body']
for ob in scene.objects:
    if 'Fur' in ob.name:
        ob.hide_viewport = True

def evaluated(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    co = np.array([ev.matrix_world @ v.co for v in me.vertices])
    polys = [list(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return co, polys

groups = {g.index:g.name for g in body.vertex_groups}
masks = {}
for pre, suf in [('Front','L'),('Front','R'),('Rear','L'),('Rear','R')]:
    names = {pre+'Paw.'+suf} | {pre+'Toe%d.'%i+suf for i in range(4)}
    masks[pre+'.'+suf] = np.array([v.co.z < .075 and sum(g.weight for g in v.groups if groups[g.group] in names) > .45 for v in body.data.vertices])

def tree(co, polys, mask=None):
    ps = polys if mask is None else [p for p in polys if all(mask[i] for i in p)]
    return BVHTree.FromPolygons([Vector(p) for p in co], ps)

def parts(pre, suf):
    names = [pre+'Pad.'+suf] + [pre+'Bean%d.'%i+suf for i in range(4)]
    return np.concatenate([evaluated(bpy.data.objects['LX_'+n])[0] for n in names])

report = {'file':bpy.data.filepath,'bones':len(rig.data.bones), 'paw_selection':'Body vertices with bind-space z < 0.075 m and total Paw+Toe weight > 0.45; excludes shank; pads and beans measured separately', 'frames':{},'skin_clip_minima':{}}
ground,_ = evaluated(bpy.data.objects['Studio ground'])
gz = float(ground[:,2].max())
report['ground_top_z_mm'] = gz*1000
for name, fr in [('Idle',19),('LieDown',236),('SideLie',284),('Sleep',350),('Lick',537)]:
    scene.frame_set(fr); bpy.context.view_layer.update()
    co, polys = evaluated(body)
    head, hpolys = evaluated(bpy.data.objects['LX_Head'])
    ht = tree(head,hpolys)
    data = {'frame':fr, 'body_ground_clearance_mm':round((co[:,2].min()-gz)*1000,2), 'paws':{}}
    for key,mask in masks.items():
        pre,suf = key.split('.')
        skin = co[mask]; pad = parts(pre,suf)
        data['paws'][key] = {'skin_min_z_mm':round(skin[:,2].min()*1000,2),'pads_min_z_mm':round(pad[:,2].min()*1000,2),'skin_span_mm':np.round(np.ptp(skin,axis=0)*1000,2).tolist()}
    if name == 'Sleep':
        low = head[head[:,2].argmin()]
        data['head_lowest_mm']=np.round(low*1000,2).tolist()
        for suf in ['L','R']:
            skin=co[masks['Front.'+suf]]
            data['paws']['Front.'+suf]['head_lowest_xy_distance_mm']=round(np.linalg.norm(skin[:,:2]-low[:2],axis=1).min()*1000,2)
    if name == 'Lick':
        pt=tree(co,polys,masks['Front.R'])
        data['head_paw_triangle_intersections']=len(ht.overlap(pt))
        tongue,tp=evaluated(bpy.data.objects['LX_Tongue'])
        distances=[pt.find_nearest(Vector(p))[3] for p in tongue]
        data['tongue_to_paw_skin_min_mm']=round(min(distances)*1000,2)
        for tag in ['Pad','Bean0','Bean1','Bean2','Bean3']:
            pc,pp=evaluated(bpy.data.objects['LX_Front'+tag+'.R'])
            padtree=tree(pc,pp)
            data['tongue_to_'+tag+'_min_mm']=round(min(padtree.find_nearest(Vector(p))[3] for p in tongue)*1000,2)
        data['tongue_keys']={k.name:float(k.value) for k in bpy.data.objects['LX_Tongue'].data.shape_keys.key_blocks}
        data['wrist_rotation_deg']=round(math.degrees(rig.pose.bones['FrontPaw.R'].rotation_euler.x),2)
    if name=='SideLie':
        lower=co[masks['Rear.L']];upper=co[masks['Rear.R']]
        lt=tree(co,polys,masks['Rear.L']);ut=tree(co,polys,masks['Rear.R'])
        data['rear_paw_triangle_intersections']=len(lt.overlap(ut))
        data['rear_paw_nearest_skin_mm']=round(min(lt.find_nearest(Vector(p))[3] for p in upper)*1000,2)
    report['frames'][name]=data

for name,start,end in [('LieDown',201,248),('SideLie',249,296),('Sleep',297,368)]:
    best = {'frame':None, 'body_z_mm':1e9}
    for fr in range(start,end+1):
        scene.frame_set(fr);bpy.context.view_layer.update()
        co,_=evaluated(body)
        z=co[:,2].min()*1000
        if z<best['body_z_mm']:
            vi=int(co[:,2].argmin());v=body.data.vertices[vi]
            best={'frame':fr,'body_z_mm':round(z,2),'ground_clearance_mm':round(z-gz*1000,2),'vertex':vi,'bind_position_mm':[round(float(q)*1000,2) for q in v.co],'weights':{groups[g.group]:round(g.weight,4) for g in v.groups}}
    report['skin_clip_minima'][name]=best
(out/'current-mesh-probe.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=float))
print(json.dumps(report,ensure_ascii=False,indent=2,default=float))
