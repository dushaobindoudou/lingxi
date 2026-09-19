"""Render native animation frames; run with Blender background for long renders."""
import bpy,json,math,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v5';frames=OUT/'demo-frames';frames.mkdir(exist_ok=True)
s=bpy.context.scene;s.render.resolution_x=480;s.render.resolution_y=480;s.render.resolution_percentage=100;s.cycles.samples=8;s.cycles.use_denoising=True;s.camera.data.ortho_scale=1.45
clips=json.loads((OUT/'animations.json').read_text());index=[]
only=set(os.environ.get('LINGXI_RENDER_CLIPS','').split(','))-{''}
for i,c in enumerate(clips):
 for j in range(16):
  frame=c['start']+round((c['end']-c['start'])*j/15);s.frame_set(frame);path=frames/f'{i*16+j:04d}.png';s.render.filepath=str(path);
  if not only or c['name'] in only:bpy.ops.render.render(write_still=True)
  index.append({'image':path.name,'clip':c['name'],'frame':frame})
(OUT/'demo-index.json').write_text(json.dumps(index,indent=2));result={'frames':len(index)}
