"""Reproducible red-mouth ROI mask, not a calibrated jaw-angle estimator."""
from PIL import Image
import numpy as np,json
from pathlib import Path
R=Path(__file__).resolve().parents[2]
cases=[('reference_yawn',R/'assets/characters/lingxi/reference/lingxi-ref-expressions.png',(250,900,410,1080),520),('round_h_yawn_f495',R/'assets/characters/lingxi/v6/round-i-check/faces/yawn/face.png',(380,560,520,640),700)]
o={}
for name,path,(x1,y1,x2,y2),head in cases:
 a=np.asarray(Image.open(path).convert('RGB'))[y1:y2,x1:x2];r,g,b=[a[:,:,i].astype(float) for i in range(3)]
 mask=(r>g*1.12)&(r>b*1.1)&(r<190)&(g<115)
 yy,xx=np.where(mask);rect=[int(xx.min()+x1),int(yy.min()+y1),int(xx.max()+x1),int(yy.max()+y1)]
 o[name]={'roi':[x1,y1,x2,y2],'red_bbox_px':rect,'aperture_height_px':rect[3]-rect[1]+1,'head_width_px_approx':head,'aperture_head':round((rect[3]-rect[1]+1)/head,3)}
Path(__file__).with_name('mouth-pixels.json').write_text(json.dumps(o,indent=2));print(json.dumps(o,indent=2))
