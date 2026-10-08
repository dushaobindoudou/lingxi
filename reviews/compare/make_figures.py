from PIL import Image,ImageDraw,ImageFont,ImageOps
from pathlib import Path
import json
R=Path('/Users/liepin/workspace/lingxi-v5fix');O=R/'reviews/compare';H=R/'assets/characters/lingxi/v6/round-h';C=R/'assets/characters/lingxi/v6/round-i-check';REF=R/'assets/characters/lingxi/reference'
F='/System/Library/Fonts/Supplemental/Arial.ttf'
font=lambda n:ImageFont.truetype(F,n)
def panel(src,box=None,size=(560,560)):
 im=Image.open(src).convert('RGB');im=im.crop(box) if box else im
 return ImageOps.contain(im,size)
def sheet(name,left,right,lbl1,lbl2,notes,lines=None):
 w,h=1160,720;im=Image.new('RGB',(w,h),'#f2f0ed');d=ImageDraw.Draw(im)
 for p,x in [(left,20),(right,590)]:
  q=panel(*p) if isinstance(p,tuple) else panel(p)
  im.paste(q,(x+(550-q.width)//2,54+(550-q.height)//2))
 d.rectangle((20,54,570,604),outline='#b8b0a8',width=2);d.rectangle((590,54,1140,604),outline='#b8b0a8',width=2)
 d.text((22,16),lbl1,font=font(24),fill='#252321');d.text((592,16),lbl2,font=font(24),fill='#252321')
 for i,t in enumerate(notes):d.text((30,615+i*28),t,font=font(19),fill='#3d3430')
 if lines:
  for x1,y1,x2,y2,color,label in lines:
   d.line((x1,y1,x2,y2),fill=color,width=3);d.text((x1+5,y1+5),label,font=font(18),fill=color)
 im.save(O/name)
expr=REF/'lingxi-ref-expressions.png';paw=REF/'lingxi-ref-lick-paw.png';face=REF/'lingxi-ref-face-closeup.png';turn=REF/'turnaround-v1.png'
def src(n):
 p=C/'faces'/n/'face.png';return p if p.exists() else H/'faces'/('yawn' if n=='yawn' else 'happy')+'.png'
def facep(n):return C/'faces'/n/'face.png'
side_src=C/'views/side.png' if (C/'views/side.png').exists() else H/'views/side.png'
ImageOps.mirror(Image.open(side_src).convert('RGB')).save(O/'side-mirror.png')
walk_side=C/'gait-views/walk/side.png'
if walk_side.exists(): ImageOps.mirror(Image.open(walk_side).convert('RGB')).save(O/'walk-side-mirror.png')
# Each comparison uses matching subject scale within its pair; reference crops preserve full face/paw.
sheet('A1-yawn.png',(expr,(0,627,627,1254)),facep('yawn'),'REFERENCE · yawning','ROUND H · Yawn f495',['Reference mouth aperture 133 px / head 520 px = 0.256','Rig: jaw −77.3°; visible slit 26 px / head 700 px = 0.037','Visible opening is 6.9× too small.'],[(368,301,368,417,'#d34d45','133px'),(900,409,900,425,'#d34d45','26px')])
sheet('A2-bite.png',(expr,(0,627,627,1254)),facep('bite'),'REFERENCE · open mouth','ROUND H · Bite f585',['Rig jaw −18.3°; upper canine meshes 2, lower 2, incisors 0.','Reference shows 2 upper canines; lower teeth obscured.','Bite: tooth tips lie 19.4–22.6 mm behind head skin.'],[(830,427,900,427,'#d34d45','4 teeth')])
sheet('A3-lick.png',(paw,(180,0,770,700)),facep('lick'),'REFERENCE · tongue touches paw','ROUND H · Lick f537',['Tongue to raised paw pad: 77.7 mm (vertex/surface).','Rig tongue Out = 0.999; paw and tongue overlap in Z.','Tongue intersects Jaw mesh: 93 triangle pairs.'],[(842,395,902,395,'#d34d45','mouth hidden')])
if facep('happy').exists(): sheet('A4-happy.png',(expr,(0,0,627,627)),facep('happy'),'REFERENCE · happy closed eyes','ROUND H · Happy f454',['Jaw −2.3°; almost closed, acceptable for this expression.','Reference upper lip follows smile; rig fur obscures lip detail.'],[(842,425,905,425,'#579268','−2.3°')])
if facep('curious').exists(): sheet('A5-curious.png',face,facep('curious'),'REFERENCE · neutral face','ROUND H · Curious f390',['Jaw 0°; mouth closed.','Reference round muzzle; rig mouth line largely buried by fur.'],[(842,425,905,425,'#bd8f37','0°')])
sheet('B1-gait-walk.png',(turn,(516,0,1312,556)),(O/'walk-side-mirror.png' if (O/'walk-side-mirror.png').exists() else H/'poses/Walk.png'),'REFERENCE · side stance','ROUND H · Walk f79 (mirrored)',['Walk planted-foot step: 5.5–7.1 mm/frame (>3 mm).','Same-side swing overlap 8–9 frames; no all-air frames.'],[(775,490,1050,490,'#d34d45','5.5–7.1 mm/frame')])
sheet('B2-proportion.png',(turn,(516,0,1312,556)),O/'side-mirror.png','REFERENCE · side','ROUND H · side f1 (mirrored)',['Pixel front-leg/body: 0.174 vs 0.260 (+49%).','Vertex head/body: 287/682=0.42; tail/body: 284/682=0.42.','Pixel landmarks are approximate; geometry takes priority.'],[(75,510,444,510,'#1d6c80','535 px body'),(611,510,987,510,'#1d6c80','615 px body')])
sheet('B3-run-jump.png',H/'poses/Run.png',H/'poses/Jump.png','ROUND H · Run f149','ROUND H · Jump f177',['Run: front paws contact 0/32 frames; 9 all-air frames.','Jump: all-air 44/48 frames as intended.','Head pitch range 0° through both clips.'],[(70,485,485,485,'#d34d45','0/32 front contacts')])
