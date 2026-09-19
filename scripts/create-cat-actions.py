"""Author named, finite cat clips as readable JSON; no random mutation at runtime."""
import json
from pathlib import Path
p=Path('assets/characters/lingxi/voxel-style-kit/actions.json')
old=json.loads(p.read_text())['actions'][:8]
for a in old:a.update(category='互动',description=a['name']+'后恢复面向用户')
actions=old

def clip(id,name,category,expression,duration,tracks):
 actions.append(dict(id=id,name=name,category=category,description=name+'；动作结束回到面向用户的站姿',duration=duration,priority=30,expression=expression,tracks=[dict(channel=c,keys=k) for c,k in tracks.items()]))
def hold(d,v=1):return [[0,0],[d*.2,v],[d*.75,v],[d,0]]
def pulse(d,v=1,n=3):
 keys=[[0,0],[d*.15,0]]
 for i in range(n):keys.extend([[d*(.2+i*.55/n),v],[d*(.2+(i+.5)*.55/n),v*.45]])
 return keys+[[d*.85,0],[d,0]]
clip('sit','乖乖坐下','休息','安然',4,{'pose.sit':hold(4)})
clip('loaf','香箱揣手','休息','满足',5,{'pose.loaf':hold(5)})
clip('side-nap','侧卧小憩','休息','闭眼休息',5,{'pose.tuck':hold(5),'root.rotation.z':hold(5,1.4),'head.rotation.z':hold(5,-.18)})
clip('curled-sleep','蜷身睡觉','休息','闭眼休息',6,{'pose.loaf':hold(6),'pose.curl':hold(6),'face.blink':hold(6)})
clip('roll-left','向左打滚','玩耍','开心',6,{'pose.tuck':hold(6),'root.rotation.z':[[0,0],[1,-.5],[2,-1.5],[3,-2.9],[4,-1.5],[5,-.4],[6,0]],'root.position.x':[[0,0],[2,-1.5],[3,-2],[4,-1.5],[6,0]]})
clip('roll-right','向右打滚','玩耍','开心',6,{'pose.tuck':hold(6),'root.rotation.z':[[0,0],[1,.5],[2,1.5],[3,2.9],[4,1.5],[5,.4],[6,0]],'root.position.x':[[0,0],[2,1.5],[3,2],[4,1.5],[6,0]]})
clip('belly-up','翻肚撒娇','玩耍','撒娇',6,{'pose.tuck':hold(6),'root.rotation.z':hold(6,3.05),'upperFL.rotation.x':pulse(6,.25),'upperFR.rotation.x':pulse(6,-.2)})
clip('stretch-front','伸展前爪','伸展','满足',4.5,{'pose.stretch':hold(4.5),'head.rotation.x':hold(4.5,-.1)})
clip('stretch-back','伸展后腿','伸展','放松',4,{'pose.crouch':hold(4,.35),'thighL.rotation.x':hold(4,.65),'shinL.rotation.x':hold(4,-.55),'footL.rotation.x':hold(4,.3),'tail0.rotation.x':hold(4,.2)})
clip('play-bow','伏低邀玩','玩耍','玩心',3,{'pose.stretch':hold(3,.7),'tail0.rotation.y':pulse(3,.35)})
clip('lick-paw','舔爪爪','清洁','认真',6,{'pose.sit':hold(6),'groom.paw':hold(6),'head.rotation.x':pulse(6,.12,4),'face.tongue':pulse(6,1,4)})
clip('wash-face','抹脸洗脸','清洁','闭眼休息',6,{'pose.sit':hold(6),'groom.paw':pulse(6,1,3),'groom.wash':hold(6),'head.rotation.z':pulse(6,.08)})
clip('scratch-ear','挠挠耳朵','清洁','认真',5,{'pose.sit':hold(5),'thighL.rotation.z':hold(5,-.65),'thighL.rotation.x':hold(5,-.4),'shinL.rotation.x':pulse(5,-.5,5),'earL.rotation.z':pulse(5,-.1,5),'head.rotation.z':hold(5,-.15)})
clip('groom-chest','低头理胸毛','清洁','认真',5,{'pose.sit':hold(5),'head.rotation.x':hold(5,.55),'neck1.rotation.x':hold(5,.25),'face.tongue':pulse(5,1,4)})
clip('groom-side','侧身理毛','清洁','认真',5,{'pose.sit':hold(5),'head.rotation.y':hold(5,.45),'neck1.rotation.y':hold(5,.28),'head.rotation.x':pulse(5,.2),'face.tongue':pulse(5,1)})
clip('knead','交替踩奶','互动','陶醉',5,{'pose.crouch':hold(5,.35),'upperFL.rotation.x':[[0,0],[1,-.2],[1.5,.15],[2,-.2],[2.5,.15],[3,-.2],[3.5,.15],[4,-.2],[5,0]],'upperFR.rotation.x':[[0,0],[1,.15],[1.5,-.2],[2,.15],[2.5,-.2],[3,.15],[3.5,-.2],[4,.15],[5,0]],'lowerFL.rotation.x':pulse(5,.12,4),'lowerFR.rotation.x':pulse(5,-.12,4)})
clip('paw-wave','举爪招呼','互动','开心',4,{'pose.sit':hold(4),'upperFL.rotation.x':hold(4,-1.1),'lowerFL.rotation.x':hold(4,-.8),'pawFL.rotation.z':pulse(4,.35)})
clip('paw-reach','伸爪碰你','互动','期待',3.5,{'pose.sit':hold(3.5),'upperFL.rotation.x':hold(3.5,-1.35),'lowerFL.rotation.x':hold(3.5,-.3),'head.rotation.z':hold(3.5,-.08)})
clip('sniff-floor','低头闻闻','探索','认真',3.5,{'pose.crouch':hold(3.5,.7),'neck1.rotation.x':hold(3.5,.42),'head.rotation.x':pulse(3.5,.18)})
clip('sniff-air','嗅嗅空气','探索','好奇',3,{'head.rotation.x':hold(3,-.28),'neck1.rotation.x':hold(3,-.12),'nose.position.y':pulse(3,.03)})
clip('meow','朝你喵喵','互动','喵喵',3,{'face.open':pulse(3,1,2),'head.rotation.x':pulse(3,-.08,2)})
clip('yawn','打个哈欠','休息','困困',4,{'head.rotation.x':hold(4,-.17),'face.open':hold(4),'face.blink':hold(4)})
clip('hiss','哈气警告','互动','生气',3,{'pose.crouch':hold(3,.4),'earL.rotation.z':hold(3,.5),'earR.rotation.z':hold(3,-.5),'head.rotation.x':hold(3,.12)})
clip('shake-head','摇头拒绝','互动','不爽',2.5,{'head.rotation.y':[[0,0],[.4,.2],[.8,-.2],[1.2,.2],[1.6,-.2],[2,.1],[2.5,0]]})
clip('shake-fur','抖抖毛','清洁','清醒',3,{'hipC.rotation.z':[[0,0],[.5,.06],[.75,-.06],[1,.06],[1.25,-.06],[1.5,.05],[1.75,-.05],[2,.03],[3,0]],'head.rotation.z':pulse(3,-.06,5)})
clip('tail-greeting','竖尾问好','尾巴','开心',4,{'tail0.rotation.x':hold(4,.45),'tail4.rotation.x':hold(4,-.3),'tail5.rotation.x':hold(4,-.35),'head.rotation.x':hold(4,-.08)})
clip('tail-sweep','尾巴慢扫','尾巴','放松',5,{f'tail{i}.rotation.y':[[0,0],[1+i*.08,.15],[2.5+i*.06,-.18],[4+i*.04,.12],[5,0]] for i in range(7)})
clip('tail-tip','尾尖轻点','尾巴','好奇',4,{'tail5.rotation.y':pulse(4,.25,3),'tail6.rotation.y':pulse(4,-.3,3)})
clip('tail-wrap','尾巴绕脚','尾巴','安心',5,{'pose.sit':hold(5),**{f'tail{i}.rotation.y':hold(5,.38 if i<4 else .24) for i in range(7)},'tail0.rotation.x':hold(5,-.5)})
clip('tail-alert','尾巴警觉','尾巴','警觉',3,{'tail0.rotation.x':hold(3,.4),'tail3.rotation.y':pulse(3,.18,4),'tail4.rotation.y':pulse(3,-.22,4)})
clip('pounce','蓄力小扑','玩耍','玩心',3.5,{'pose.crouch':[[0,0],[.8,1],[1.2,1],[1.6,.2],[2.2,.6],[3.5,0]],'root.position.y':[[0,0],[1.2,0],[1.65,1.7],[2.2,0],[3.5,0]],'root.position.z':[[0,0],[1.2,0],[2,1.8],[2.5,1.8],[3.5,0]],'tail0.rotation.y':pulse(3.5,.18)})
clip('look-at-you','看着你','互动','温柔',3,{'head.rotation.x':hold(3,-.05),'earL.rotation.z':hold(3,-.12),'earR.rotation.z':hold(3,.12)})
assert len(actions)==40,len(actions)
p.write_text(json.dumps({'schemaVersion':2,'status':'playable-stylized','timeUnit':'seconds','rotationUnit':'radians','blend':'rest-relative','actions':actions},ensure_ascii=False,indent=2)+'\n')
print(len(actions),'playable action definitions')
