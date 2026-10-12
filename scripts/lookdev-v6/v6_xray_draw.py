# Skeleton x-ray, part 2 (round X): python3 v6_xray_draw.py dump.npz FRAMES LABELS out.png - the bald skin coloured by the bone each
# vertex mostly follows, the posed bones over it, side (top row) and top (bottom row) views.
import numpy as np, sys, math
from PIL import Image, ImageDraw, ImageFont
z=np.load(sys.argv[1]);frames=[int(f) for f in sys.argv[2].split(',')];labels=sys.argv[3].split(',');out=sys.argv[4]
names=list(z['names']);bones=list(z['bones'])
def col(n):
 if n.startswith('Pelvis'):return (214,140,60)
 if n=='LoinB':return (230,200,40)
 if n.startswith('Loin'):return (190,170,60)
 if n=='Chest':return (90,200,120)
 if n.startswith('Spine'):return (120,170,90)
 if n=='NeckB':return (250,120,230)
 if n.startswith('Neck'):return (200,40,160)
 if n.startswith('Head') or n in('Jaw','LipUpper'):return (110,140,220)
 if n.startswith('Scap'):return (60,180,180)
 if n.startswith('Front'):return (150,110,200) if n.endswith('L') else (200,120,160)
 if n.startswith('Rear'):return (90,150,200) if n.endswith('L') else (110,190,150)
 if n.startswith('Tail'):return (170,130,110)
 return (180,180,180)
C=np.array([col(n) for n in names])
S=360
try:font=ImageFont.truetype('/System/Library/Fonts/PingFang.ttc',16)   # labels may be Chinese
except Exception:font=ImageFont.load_default()
def panel(fr,view):
 im=Image.new('RGB',(S,S),(250,248,246));dr=ImageDraw.Draw(im)
 pts=[];cols=[]
 for o in ('LX_Body','LX_Head','LX_Tail'):
  co=z['co_%s_%d'%(o,fr)];pts.append(co);cols.append(C[z['dom_'+o]])
 P=np.concatenate(pts);K=np.concatenate(cols)
 if view=='side':u,v,d=P[:,1],P[:,2],P[:,0]
 else:u,v,d=P[:,1],-P[:,0],P[:,2]
 BN=z['bn_%d'%fr];
 cu=(u.min()+u.max())/2;cv=(v.min()+v.max())/2 if view=='top' else None
 sc=S*.9/max(.9,u.max()-u.min(),(v.max()-v.min()))
 def px(a,b):return (S/2+(a-cu)*sc, (S*.92-(b-0)*sc) if view=='side' else (S/2-(b-cv)*sc))
 o=np.argsort(d) if view=='side' else np.argsort(d)   # far first
 for i in o[::3]:
  x,y=px(u[i],v[i]);dr.point((x,y),fill=tuple(int(c) for c in K[i]))
 if view=='side':dr.line([px(-2,0),px(2,0)],fill=(120,120,120))
 for bi,bn in enumerate(bones):
  if any(bn.startswith(p) for p in ('Lid','Eye','Whisker','Ear','Nose','Lip','Tongue','Jaw')):continue
  h=BN[bi,:3];t=BN[bi,3:]
  a=px(h[1],h[2]) if view=='side' else px(h[1],-h[0]);b=px(t[1],t[2]) if view=='side' else px(t[1],-t[0])
  dr.line([a,b],fill=(20,20,20),width=3);dr.ellipse([a[0]-3,a[1]-3,a[0]+3,a[1]+3],fill=(220,30,30))
 return im
W=len(frames);sheet=Image.new('RGB',(W*S,2*S+20),(255,255,255));d=ImageDraw.Draw(sheet)
for i,(fr,lb) in enumerate(zip(frames,labels)):
 sheet.paste(panel(fr,'side'),(i*S,20));sheet.paste(panel(fr,'top'),(i*S,S+20));d.text((i*S+6,4),'%s  f%d'%(lb,fr),fill=(0,0,0),font=font)
sheet.save(out)
