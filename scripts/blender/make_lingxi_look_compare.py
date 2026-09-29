"""Compose reference comparisons and estimate silhouette ratios from the front plate."""
import json, os
from pathlib import Path
from PIL import Image
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('LINGXI_OUT',ROOT/'assets/characters/lingxi/v5'))
ref=Image.open(ROOT/'assets/characters/lingxi/reference/turnaround-v1.png').convert('RGB')
w,h=ref.size;cuts=[(0,0,int(w*.393),int(h*.464)),(int(w*.393),0,w,int(h*.464)),(0,int(h*.464),int(w*.393),h),(int(w*.393),int(h*.464),w,h)]
widths=[520,800,520,800];positions=[0,520,1320,1840]
canvas=Image.new('RGB',(2640,1040),(205,202,202))
for i,(n,box) in enumerate(zip(['front','side','back','threequarter'],cuts)):
 canvas.paste(ref.crop(box).resize((widths[i],520)),(positions[i],0))
 canvas.paste(Image.open(OUT/f'look-{n}.png').convert('RGB'),(positions[i],520))
canvas.save(OUT/'turnaround-compare.png')
logo=Image.open(ROOT/'assets/brand/lingxi-icon-v3.png').convert('RGB').resize((520,520))
portrait=Image.open(OUT/'portrait.png').convert('RGB').resize((520,520))
c=Image.new('RGB',(1040,520));c.paste(logo,(0,0));c.paste(portrait,(520,0));c.save(OUT/'logo-compare.png')
# Segmentation excludes the approximately neutral studio plate and keeps dark/colored fur.
a=np.asarray(Image.open(OUT/'look-front.png').convert('RGB')).astype(float)
bg=np.median(np.concatenate([a[:35].reshape(-1,3),a[:,-35:].reshape(-1,3)]),axis=0)
diff=np.max(abs(a-bg),axis=2)
mask=diff>18
# The lit floor becomes a full-width band; remove it before measuring the cat.
full=np.where(mask.mean(axis=1)>.90)[0]
if len(full):mask[int(full[0]):]=False
ys,xs=np.where(mask)
if len(xs):
 x0,x1=np.percentile(xs,[1,99]);y0,y1=np.percentile(ys,[1,99]);height=y1-y0
 # Head and torso envelope measured across fixed vertical bands of the front silhouette.
 def width(ya,yb):
  q=np.where(mask[int(ya):int(yb)].any(axis=0))[0]
  return float(q[-1]-q[0]) if len(q)>1 else 0
 head_w=width(y0+height*.12,y0+height*.42)
 body_w=width(y0+height*.50,y0+height*.77)
 rows=mask.sum(axis=1)
 neck_lo=int(y0+height*.43);neck_hi=int(y0+height*.70)
 neck_y=neck_lo+int(np.argmin(np.convolve(rows[neck_lo:neck_hi],np.ones(13)/13,'same')[7:-7]))+7
 head_h=neck_y-y0
 center=int((x0+x1)/2)
 center_width=50
 occupancy=mask[:,center-center_width//2:center+center_width//2].mean(axis=1)
 start=int(y0+height*.60);end=int(y0+height*.90)
 low=np.where(np.convolve(occupancy,np.ones(9)/9,'same')[start:end]<.80)[0]
 belly_y=start+int(low[0]) if len(low) else end
 belly=(y1-belly_y)/height
 # Eye centers and visible diameters are measured from dark connected pixels near the upper face.
 yy,xx=np.indices(mask.shape)
 region=(a[:,:,0]<90)&(a[:,:,1]<95)&(yy<y0+height*.53)&(yy>y0+height*.22)
 eyes=[]
 for side in [xx<260,xx>=260]:
  ey,ex=np.where(region&side)
  if len(ex)>12:eyes.append((len(ex),float(ex.mean()),float(ey.mean()),float(np.percentile(ex,95)-np.percentile(ex,5))))
 eye_d=np.mean([q[3] for q in eyes]) if len(eyes)==2 else 0
 eye_sep=abs(eyes[1][1]-eyes[0][1]) if len(eyes)==2 else 0
 crown_rows=np.where(rows[int(y0):int(y0+height*.35)]>head_w*.55)[0]
 crown_y=int(y0)+int(crown_rows.min()) if len(crown_rows) else y0
 eye_z=(np.mean([q[2] for q in eyes])-crown_y)/max(1,neck_y-crown_y) if len(eyes)==2 else 0
 vals={'head_height_total_height':head_h/height,'head_width_body_width':head_w/body_w if body_w else 0,'belly_clearance_total_height':belly,'eye_center_separation_head_width':eye_sep/head_w if head_w else 0,'eye_visible_diameter_head_width':eye_d/head_w if head_w else 0,'eye_center_down_from_crown':eye_z}
 ranges={'head_height_total_height':(.42,.50),'head_width_body_width':(.95,1.15),'belly_clearance_total_height':(.13,.20),'eye_center_separation_head_width':(.30,.37),'eye_visible_diameter_head_width':(.12,.16),'eye_center_down_from_crown':(.50,.60)}
 report={k:{'value':round(v,3),'range':list(ranges[k]),'status':'PASS' if ranges[k][0]<=v<=ranges[k][1] else 'FAIL','method':'front render mask; head/chest separation and crown inferred from row width, eyes from dark pixels' } for k,v in vals.items()}
 (OUT/'look-report.json').write_text(json.dumps(report,indent=2))
