from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];rows=json.load(open(R/'assets/characters/lingxi/v6/round-i-check/measure.json'))['gait'];out=Path(__file__).parent
f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',21);small=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
im=Image.new('RGB',(1160,680),'#faf8f5');d=ImageDraw.Draw(im)
colors={'FrontPaw.L':'#c43b37','RearPaw.R':'#dd8f26','FrontPaw.R':'#286a9a','RearPaw.L':'#65a058'}
for idx,name in enumerate(['Walk','Run']):
 a=rows[name];top=48+idx*315;left=90;right=1100;bottom=top+210;maxh=85 if name=='Run' else 48
 d.text((left,top-34),f'{name} · paw tip above idle sole (mm)',font=f,fill='#292522')
 for val in [0,3,20,40,60,80]:
  if val>maxh:continue
  y=bottom-val/maxh*210;d.line((left,y,right,y),fill='#dcd5cd',width=1);d.text((28,y-8),str(val),font=small,fill='#6f675f')
 d.line((left,bottom-3/maxh*210,right,bottom-3/maxh*210),fill='#9f332b',width=2)
 for paw,color in colors.items():
  base=35 if paw.startswith('Front') else 36
  p=[(left+i/(len(a)-1)*(right-left),bottom-min(max((r['paws'][paw][2]-base),0),maxh)/maxh*210) for i,r in enumerate(a)]
  d.line(p,fill=color,width=3)
  d.text((left+list(colors).index(paw)*242,top+222),paw.replace('Paw',''),font=small,fill=color)
 d.text((right-245,top-34),'red rule = 3 mm contact',font=small,fill='#9f332b')
 d.text((left,bottom+43),f'frames {a[0]["f"]}–{a[-1]["f"]}',font=small,fill='#61594f')
im.save(out/'B4-gait-phases.png')
