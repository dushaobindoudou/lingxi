import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';d=OUT/'poses';d.mkdir(exist_ok=True)
s=bpy.context.scene;s.render.resolution_x=480;s.render.resolution_y=480;s.cycles.samples=12;s.camera.data.ortho_scale=1.5
for c in json.loads((OUT/'animations.json').read_text()):
 frac=.25 if c['name'] in ['Lick','Bite','Walk','Run'] else .55;s.frame_set(c['start']+round((c['end']-c['start'])*frac));s.render.filepath=str(d/(c['name']+'.png'));bpy.ops.render.render(write_still=True)
result={'poses':15}
