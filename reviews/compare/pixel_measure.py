"""Visible-fur side-view landmarks, manually placed on named PNGs; rerun with python3.
Coordinates in source pixels. The camera/pose differ; these are silhouette estimates,
not metric geometry. metrics_render.py measures colour statistics, not limb lengths.
"""
import json
from pathlib import Path
P=Path(__file__).parent
# nose_x, head_rear_x, rump_x, tail_tip_x, shoulder_top_y, chest_bottom_y, paw_floor_y
landmarks={
 'reference/turnaround-v1.png side panel':(595,815,1130,1288,202,425,518),
 'round-h/views/side.png':(865,600,250,60,342,580,740),
}
out={}
for n,(nose,head,rump,tail,shoulder,chest,floor) in landmarks.items():
 body=abs(nose-rump);height=floor-shoulder
 out[n]={'landmarks_px':{'nose_x':nose,'head_rear_x':head,'rump_x':rump,'tail_tip_x':tail,'shoulder_top_y':shoulder,'chest_bottom_y':chest,'paw_floor_y':floor},'head_body':round(abs(nose-head)/body,3),'shoulder_body':round(height/body,3),'foreleg_body':round((floor-chest)/body,3),'chest_shoulder':round((chest-shoulder)/height,3),'tail_body':round(abs(tail-rump)/body,3)}
(P/'pixel-measure.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
