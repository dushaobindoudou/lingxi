"""Bake distinct actions on the original cat rig. Analytic leg IK keeps segment lengths."""
import bpy,math,json
from pathlib import Path
from mathutils import Vector,Matrix,Quaternion
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/characters/lingxi/v6'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'lingxi-v6-lookdev.blend'))
s=bpy.context.scene;s.render.fps=30;rig=bpy.data.objects['Lingxi_Rig_v6'];pb=rig.pose.bones
rest={b.name:b.matrix_local.copy() for b in rig.data.bones};heads={b.name:b.head_local.copy() for b in rig.data.bones}
raw=json.loads((OUT/'source-motion.json').read_text());oldrest={n:Matrix(m) for n,m in raw['rest'].items()}
groom=[];S=Matrix.Diagonal(Vector((.86,1.18,.80)))
rig.animation_data_clear()
for frame in raw['frames']:
 for p in pb:
  n=p.name;old=Matrix(frame[n]);delta=old.to_quaternion()@oldrest[n].to_quaternion().inverted()
  pos=S@old.translation+delta@(rest[n].translation-S@oldrest[n].translation)
  p.matrix=Matrix.LocRotScale(pos,old.to_quaternion(),Vector((1,1,1)));bpy.context.view_layer.update()
 groom.append({p.name:p.matrix_basis.copy() for p in pb})
sitbase=groom[1]
def find(part):return next(n for n in rest if part in n)
BODY='j_body_00';HEAD=find('j_head');NECK=find('j_neck_1');JAW=find('j_jaw');TAIL=[find(f'j_tail_{i}_') for i in range(1,7)]
def reset():
 for p in pb:p.matrix_basis.identity()
def update():bpy.context.view_layer.update()
def rot(name,axis,angle):
 p=pb[name];p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion(axis,angle)@p.rotation_quaternion
# All imported local axes happen to align with scene axes up to signs; use world rotations explicitly.
def worldrot(name,axis,angle):
 update();p=pb[name];m=p.matrix.copy();loc=m.translation.copy();m=Quaternion(axis,angle).to_matrix().to_4x4()@m;m.translation=loc;p.matrix=m;update()
def orient(name,position,quat):pb[name].matrix=Matrix.LocRotScale(position,quat,Vector((1,1,1)));update()
legs=[]
for side in ['l','r']:
 for kind,parts in [('front',['humerous','elbow','wrist','palm','finger']),('hind',['femur','knee','ankle','ball','toe'])]:
  names=[find(f'j_{side}_{p}_') for p in parts];legs.append((side,kind,names))
def solve_leg(names,foot,pitch=0):
 a,b,c,d,e=names;root=pb[a].head.copy();q=Quaternion((0,1,0),pitch)
 target=foot-q@(heads[d]-heads[c]);v=target-root;distance=v.length;L1=(heads[b]-heads[a]).length;L2=(heads[c]-heads[b]).length
 distance=max(abs(L1-L2)+.001,min(L1+L2-.001,distance));axis=v.normalized();along=(L1*L1-L2*L2+distance*distance)/(2*distance);height=math.sqrt(max(0,L1*L1-along*along))
 hint=Vector((-1,0,0)) if 'humerous' in a else Vector((1,0,0));bend=(hint-axis*hint.dot(axis)).normalized();joint=root+axis*along+bend*height
 for name,pos,nextpos,restnext in [(a,root,joint,b),(b,joint,target,c)]:
  delta=(heads[restnext]-heads[name]).rotation_difference(nextpos-pos);orient(name,pos,delta@rest[name].to_quaternion())
 orient(c,target,q@rest[c].to_quaternion());orient(d,foot,rest[d].to_quaternion())
 # Finger/toe rest orientation follows foot; no scale changes.

def smooth(*args):
 t=args[0] if len(args)==1 else (args[2]-args[0])/(args[1]-args[0]);t=max(0,min(1,t));return t*t*(3-2*t)
def pulse(t):return math.sin(math.pi*t)**2

def stance(lower=0,t=0,resting=False,feet=None):
 reset();pb[BODY].location=rest[BODY].to_3x3().inverted()@Vector((0,0,lower));update()
 for side,kind,names in legs:
  foot=heads[names[3]].copy()
  if resting and kind=='front':foot.x+=4.2*float(resting)
  if feet and (side,kind) in feet:foot+=Vector(feet[(side,kind)])
  solve_leg(names,foot,-1.13*float(resting))
 # Tail hangs relaxed with a subtle lift at the end.
 for i,n in enumerate(TAIL):worldrot(n,(0,1,0),(-.07 if i<3 else .09))

def seated():
 for n,m in sitbase.items():pb[n].matrix_basis=m.copy()
 update();p=pb[HEAD];orient(HEAD,p.head.copy(),rest[HEAD].to_quaternion())

def resting(sleep=0):
 stance(-5.8,resting=True);worldrot(NECK,(0,1,0),.18+.20*sleep);worldrot(HEAD,(0,1,0),.08+.22*sleep)
 if sleep:blink(sleep)

def blink(v,left=True,right=True):
 for side,enabled in [('l',left),('r',right)]:
  if enabled:
   # Upper eyelid rotation sweeps the original weighted lid over the eye.
   worldrot(find(f'j_{side}_upper_eyelid'),(0,1,0),.63*v)
   worldrot(find(f'j_{side}_lower_eyelid'),(0,1,0),-.18*v)

def snapshot():return {p.name:p.matrix_basis.copy() for p in pb}
def blend(a,b,t):
 for n in a:
  la,qa,sa=a[n].decompose();lb,qb,sb=b[n].decompose();pb[n].matrix_basis=Matrix.LocRotScale(la.lerp(lb,t),qa.slerp(qb,t),sa.lerp(sb,t))
 update()
stance();standpose=snapshot();seated();sitpose=snapshot();resting();restpose=snapshot();resting(1);sleeppose=snapshot();groompose=groom[0];groomend=groom[-1]
# Side-lying from the same rest articulation, rigid roll followed by exact surface grounding.
resting();update();mats={p.name:p.matrix.copy() for p in pb};pivot=Vector((0,0,4));roll=Quaternion((1,0,0),math.pi/2).to_matrix().to_4x4()
for p in pb:
 m=roll@mats[p.name];m.translation=pivot+roll.to_3x3()@(mats[p.name].translation-pivot);p.matrix=m;update()
body=bpy.data.objects['Lingxi_Coat'];ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());minz=min((ev.matrix_world@v.co).z for v in ev.data.vertices);pb[BODY].location+=rest[BODY].to_3x3().inverted()@Vector((0,0,-minz+.03));update();sidepose=snapshot()
# Mild flank-only breathing shape; exported independently from bone rotations.
basis=body.shape_key_add(name='Basis');breath=body.shape_key_add(name='BellyBreath')
for v,k in zip(body.data.vertices,breath.data):
 p=body.matrix_world@v.co;weight=math.exp(-((p.x+1)/5)**2)*smooth(6,9,p.z)*(1-smooth(12,15,p.z));delta=Vector((0,p.y*.025*weight,0));k.co=v.co+body.matrix_world.to_3x3().inverted()@delta
# To avoid shape/fur separation the same displacement is applied to fur through shape keys.
fur=bpy.data.objects['Lingxi_ShortFur'];fur.shape_key_add(name='Basis');fb=fur.shape_key_add(name='BellyBreath')
for v,k in zip(fur.data.vertices,fb.data):
 p=fur.matrix_world@v.co;w=math.exp(-((p.x+1)/5)**2)*smooth(6,9,p.z)*(1-smooth(12,15,p.z));k.co=v.co+fur.matrix_world.to_3x3().inverted()@Vector((0,p.y*.025*w,0))
# Separate shape clips are not counted as distinct behaviors; runtime can drive the shared morph.
disabled=[]
for o in s.objects:
 if o.type=='MESH':
  for m in o.modifiers:
   if m.show_viewport:disabled.append(m);m.show_viewport=False
manifest=[]
def record(id,label,duration,category,entry,exit,loop,fn,notes=''):
 rig.animation_data_clear();reset();action=bpy.data.actions.new(id);action.use_fake_user=True;rig.animation_data_create();rig.animation_data.action=action
 frames=round(duration*30)
 for f in range(frames+1):
  t=f/frames;s.frame_set(f+1);reset();fn(t);update()
  # Ground using actual deformed sole geometry, not a bone-origin approximation.
  arm=next(m for m in body.modifiers if m.type=='ARMATURE');arm.show_viewport=True;update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());low=min((ev.matrix_world@v.co).z for v in ev.data.vertices);arm.show_viewport=False
  correction=.015-low if id!='jump_in_place' or low<.015 else 0
  root=pb['_rootJoint'];matrix=root.matrix.copy();matrix.translation.z+=correction;root.matrix=matrix;update()
  for p in pb:
   p.rotation_mode='QUATERNION';p.keyframe_insert('location',frame=f+1,group=p.name);p.keyframe_insert('rotation_quaternion',frame=f+1,group=p.name);p.keyframe_insert('scale',frame=f+1,group=p.name)
 # Sampled curves must not overshoot the IK or floor between keys.
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for k in fc.keyframe_points:k.interpolation='LINEAR'
 manifest.append({'id':id,'label':label,'category':category,'entry':entry,'exit':exit,'duration':duration,'fps':30,'loop':loop,'rootMotion':'in_place','review':'draft','notes':notes})
 print('ACTION',id,flush=True)
def lie_down(t):
 amount=smooth(.24,.93,t);feet={}
 for side,begin,end in [('l',.08,.48),('r',.24,.64)]:
  q=max(0,min(1,(t-begin)/(end-begin)));feet[(side,'front')]=(4.2*(smooth(q)-amount),0,.85*math.sin(math.pi*q))
 stance(-5.8*amount,resting=amount,feet=feet);worldrot(NECK,(0,1,0),.18*amount);worldrot(HEAD,(0,1,0),.08*amount)
def transition(a,b):
 if a is standpose and b is restpose:return lie_down
 if a is restpose and b is standpose:return lambda t:lie_down(1-t)
 blend(a,a,0);aw={p.name:p.matrix.copy() for p in pb};blend(b,b,0);bw={p.name:p.matrix.copy() for p in pb}
 def fn(t):
  t=smooth(t)
  for p in pb:
   la,qa,sa=aw[p.name].decompose();lb,qb,sb=bw[p.name].decompose();p.matrix=Matrix.LocRotScale(la.lerp(lb,t),qa.slerp(qb,t),sa.lerp(sb,t));update()
 return fn
def idle(t):
 stance();worldrot(HEAD,(0,0,1),.035*math.sin(t*math.tau));worldrot(TAIL[-1],(0,0,1),.10*math.sin(t*math.tau))
record('stand_idle','站立观察',4,'body','stand','stand',True,idle)
def gait(t,run=False):
 feet={};stance_fraction=.42 if run else .66;stride=10 if run else 6;lift=2.5 if run else 1.35
 for side,kind,names in legs:
  phase=({'lfront':0,'rfront':.07,'lhind':.5,'rhind':.57} if run else {'lfront':0,'rfront':.5,'lhind':.75,'rhind':.25})[side+kind]
  p=(t+phase)%1
  if p<stance_fraction:x=stride*(.5-p/stance_fraction);z=0
  else:q=(p-stance_fraction)/(1-stance_fraction);x=stride*(-.5+smooth(q));z=lift*math.sin(math.pi*q)**1.5
  feet[(side,kind)]=(x,0,z)
 stance(-.6+(.35 if run else .10)*math.cos(t*math.tau*2),feet=feet)
 for i,n in enumerate(TAIL):worldrot(n,(0,0,1),.025*math.sin(t*math.tau-i*.4))
record('walk_loop','四拍慢走',1.4,'locomotion','walk','walk',True,lambda t:gait(t), 'Stride 6 source units; match world movement to contact phase.')
record('run_loop','轻快跑动',.8,'locomotion','run','run',True,lambda t:gait(t,True),'Distinct paired front/back timing; draft gallop.')
def jump(t):
 h=0;crouch=0
 if t<.22:crouch=-2.0*smooth(t/.22)
 elif t<.76:h=8*math.sin(math.pi*(t-.22)/.54);crouch=-2*(1-smooth((t-.22)/.08))
 else:crouch=-1.7*math.sin(math.pi*(t-.76)/.24)
 feet={(side,kind):(0,0,h) for side,kind,n in legs};stance(h+crouch,feet=feet)
record('jump_in_place','蓄力原地跳',1.8,'body','stand','stand',False,jump)
for id,label,a,b,entry,exit,d in [('sit_to_groom','准备舔爪',sitpose,groompose,'sit','groom_sit',1.3),('groom_to_sit','舔爪后抬头',groomend,sitpose,'groom_sit','sit',1.5),('stand_to_sit','坐下',standpose,sitpose,'stand','sit',1.8),('sit_to_stand','坐姿起身',sitpose,standpose,'sit','stand',1.6),('stand_to_rest','伏下',standpose,restpose,'stand','rest',2.0),('rest_to_stand','伏姿起身',restpose,standpose,'rest','stand',1.8),('rest_to_sleep','低头入睡',restpose,sleeppose,'rest','sleep',2.0),('sleep_to_rest','睡醒抬头',sleeppose,restpose,'sleep','rest',2.4),('rest_to_side','侧躺',restpose,sidepose,'rest','side',2.2),('side_to_rest','侧躺翻回',sidepose,restpose,'side','rest',2.2)]:record(id,label,d,'transition',entry,exit,False,transition(a,b))
for id,label,pose,entry in [('sit_idle','坐姿安静陪伴',sitpose,'sit'),('rest_loop','伏卧休息',restpose,'rest'),('sleep_loop','伏睡',sleeppose,'sleep'),('side_loop','侧卧休息',sidepose,'side')]:
 def fn(t,pose=pose):
  blend(pose,pose,0);worldrot(TAIL[-1],(0,0,1),.035*math.sin(math.tau*t))
 record(id,label,4,'body',entry,entry,True,fn,'BellyBreath is a shared separately driven morph.')
def groom_fn(t):
 for n,m in groom[round(t*144)].items():pb[n].matrix_basis=m.copy()
record('groom_paw','原作坐姿舔爪',6,'body','groom_sit','groom_sit',False,groom_fn,'Preserved supplied animation, not newly generated.')
def stretch(t):
 stance(-2*pulse(t));worldrot(find('j_spine_4'),(0,1,0),.16*pulse(t));worldrot(HEAD,(0,1,0),-.20*pulse(t))
record('stretch_bow','前身伸展',3,'body','stand','stand',False,stretch)
def arch(t):
 stance();worldrot(find('j_spine_2'),(0,1,0),-.10*pulse(t));worldrot(find('j_spine_4'),(0,1,0),.18*pulse(t))
record('back_arch','拱背舒展',2.8,'body','stand','stand',False,arch)
for side,cn in [('l','左'),('r','右')]:
 def paw(t,side=side):stance(feet={(side,'front'):(1.2*pulse(t),0,2.8*pulse(t))})
 record('paw_lift_'+side,cn+'前爪试探',2.2,'body','stand','stand',False,paw)
def knead(t):
 resting()
 for side,phase in [('l',0),('r',.5)]:
  names=next(n for ss,kind,n in legs if ss==side and kind=='front');foot=heads[names[3]].copy();foot.x+=4.2;foot.z+=.6*(.5-.5*math.cos(t*math.tau*2+phase*math.tau))*math.sin(math.pi*t)
  solve_leg(names,foot,-1.13)
record('knead_rest','伏姿交替踩奶',4,'body','rest','rest',False,knead)
# Micro-actions return to neutral; joint masks are included for additive conversion at runtime.
def micro(id,label,d,fn,mask):
 def f(t):stance();fn(t)
 record(id,label,d,'micro','stand','stand',False,f);manifest[-1]['mask']=mask
micro('blink_slow','慢眨眼',2.2,lambda t:blink(pulse(t)),['eyelid'])
micro('blink_left','左眼轻眨',.7,lambda t:blink(pulse(t),right=False),['l_eyelid'])
micro('blink_right','右眼轻眨',.7,lambda t:blink(pulse(t),left=False),['r_eyelid'])
for side,cn in [('l','左'),('r','右')]:
 micro('ear_flick_'+side,cn+'耳轻弹',1,lambda t,side=side:worldrot(find(f'j_{side}_ear'),(1,0,0),(.24 if side=='l' else -.24)*math.sin(t*math.pi*4)*math.sin(t*math.pi)),[side+'_ear'])
for id,label,axis,amount in [('look_left','向左看',(0,0,1),.40),('look_right','向右看',(0,0,1),-.40),('look_up','抬头看',(0,1,0),-.25),('look_down','低头嗅闻',(0,1,0),.30),('head_tilt','歪头好奇',(1,0,0),.19)]:
 micro(id,label,2.4,lambda t,axis=axis,amount=amount:worldrot(HEAD,axis,amount*pulse(t)),['head'])
for side,cn in [('l','左'),('r','右')]:
 micro('eye_glance_'+side,'眼球'+cn+'瞥',1.6,lambda t,side=side:[worldrot(find(f'j_{d}_eye_'),(0,0,1),(.14 if side=='l' else -.14)*pulse(t)) for d in ['l','r']],['eyes'])
micro('jaw_open','张嘴再闭合',1.5,lambda t:worldrot(JAW,(0,1,0),.26*pulse(t)),['jaw'])
def yawn(t):
 worldrot(JAW,(0,1,0),.48*pulse(t));worldrot(HEAD,(0,1,0),-.10*pulse(t));blink(.7*pulse(t))
micro('yawn','困倦哈欠',3.2,yawn,['jaw','head','eyelids'])
def lick(t):
 worldrot(JAW,(0,1,0),.12*pulse(t));worldrot(find('j_tongue_back'),(0,1,0),-.25*pulse(t));worldrot(find('j_tongue_mid'),(0,1,0),-.35*pulse(t));worldrot(find('j_tongue_tip'),(0,1,0),-.3*pulse(t))
micro('tongue_lick','伸舌舔嘴',1.5,lick,['jaw','tongue'])
micro('nose_sniff','鼻口轻嗅',1.4,lambda t:worldrot(HEAD,(0,1,0),.035*math.sin(t*math.pi*6)*math.sin(math.pi*t)),['head'])
for id,label,amp,frequency in [('tail_sway','尾巴缓摆',.08,1),('tail_tip_flick','尾尖轻弹',.22,2)]:
 micro(id,label,3,lambda t,id=id,amp=amp,frequency=frequency:[worldrot(n,(0,0,1),amp*math.sin(t*math.tau*frequency-i*.2)*math.sin(math.pi*t)) for i,n in enumerate(TAIL if id=='tail_sway' else TAIL[-2:])],['tail'])
def pet(t):worldrot(HEAD,(0,1,0),-.14*pulse(t));worldrot(HEAD,(1,0,0),.10*pulse(t));blink(.7*pulse(t))
micro('pet_reaction','眯眼迎接抚摸',2.6,pet,['head','eyelids'])
# Reusable skin/animation contract, grounded in the linked project's terminology.
(OUT/'animations.json').write_text(json.dumps({'schemaVersion':1,'character':'lingxi-v6','rig':'original-61-bone-cat','clips':manifest,'morphs':{'BellyBreath':{'range':[0,1],'periodSeconds':3.8,'targets':['Lingxi_Coat','Lingxi_ShortFur']}},'status':'visual-review-required'},ensure_ascii=False,indent=2))
for m in disabled:m.show_viewport=True
rig.animation_data.action=bpy.data.actions['rest_loop'];rig.animation_data.action_slot=rig.animation_data.action.slots[0];s.frame_set(1);s.frame_end=120
for img in bpy.data.images:
 if img.has_data and not img.packed_file:img.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lingxi-v6.blend'))
s.cycles.samples=20;s.render.resolution_x=640;s.render.resolution_y=560
for id,frame in [('stand_idle',1),('rest_loop',1),('sit_idle',1),('sleep_loop',1),('side_loop',1),('walk_loop',12),('run_loop',9),('jump_in_place',26),('blink_slow',34),('yawn',49),('groom_paw',70)]:
 rig.animation_data.action=bpy.data.actions[id];rig.animation_data.action_slot=rig.animation_data.action.slots[0];s.frame_set(frame);s.render.filepath=str(OUT/(id+'.png'));bpy.ops.render.render(write_still=True)
print('ANIMATION_DONE',len(manifest))
