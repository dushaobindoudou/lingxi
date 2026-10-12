// Deterministic, dev-only audit. No production renderer or asset settings are changed.
import * as THREE from 'three';
import skeletonData from './data/skeleton.json';
import {buildRig, type SkeletonData, type Rig} from './rig/skeleton.ts';
import {refineSkeleton} from './rig/anatomy.ts';
import {paintSkin, paintFace, expressions, type ArtSkin, type FaceState} from './rig/art.ts';
import {createBodyController} from './anim/body-controller.ts';
import {createIdleAnimator} from './anim/idle.ts';
import {createDirector} from './anim/director.ts';
import {POSES} from './anim/poses.ts';

Math.random = () => .5; // Only this standalone audit page.
const data=refineSkeleton(skeletonData as unknown as SkeletonData);
const skin:ArtSkin={schemaVersion:1,id:'deepseek-whale',name:'深寻蓝鲸',description:'当前桌面运行皮肤的审计快照',rigId:data.id,pattern:'tabby',materials:{fur:'#4D6BFE',pattern:'#3A54E8',cream:'#EAF0FF',iris:'#A9DCFF',pupil:'#12205C',nose:'#D092A4',paw:'#EAF0FF',mouth:'#33418F',whisker:'#EAF0FF',tongue:'#E393AC'}};
const faceBox=/^(eye|pupil|brow|nose|mouth|whisker|jaw|tongue)/;
const measurements:Record<string, unknown>[]=[];
function measure(rig:Rig){
  rig.root.updateMatrixWorld(true);
  const parts:Record<string, unknown>={};
  for(const id of ['hipC','spine1','spine2','head','upperFL','lowerFL','pawFL','pawFR','pawBL','pawBR']){
    const n=rig.node(id),mesh=n.children.find(c=>(c as THREE.Mesh).isMesh)!;
    const b=new THREE.Box3().setFromObject(mesh);
    const q=n.getWorldQuaternion(new THREE.Quaternion());
    parts[id]={minY:b.min.y,maxY:b.max.y,pivot:n.getWorldPosition(new THREE.Vector3()).toArray(),soleNormal:new THREE.Vector3(0,-1,0).applyQuaternion(q).toArray(),worldEuler:new THREE.Euler().setFromQuaternion(q).toArray()};
  }
  return parts;
}
type Card={id:string;title:string;clip?:string;pose?:string;view?:'front'|'side'|'three';bones?:boolean;face?:FaceState;close?:boolean;candidate?:boolean;pawOnly?:boolean;note:string;offsets?:Record<string,number>};
const cards:Card[]=[
  {id:'stand',title:'01 · 当前站姿 / 侧面',view:'side',note:'基础站姿的前后爪高度不一致；整体最低点落地并不代表四爪落地。'},
  {id:'loaf',title:'02 · 当前香箱 / 侧面',clip:'loaf',view:'side',bones:true,note:'胸腹仍被腿撑高；前肘朝头部突出，腕部没有随折腿补偿。'},
  {id:'candidate',title:'03 · 诊断候选 / 侧面',candidate:true,view:'side',bones:true,note:'仅改变腿部 FK 和肩胛位置，保持父子层级。用于验证折腿/接触影响，仍有穿插，不能作为成品。'},
  {id:'loaf-front',title:'04 · 当前香箱 / 正面',clip:'loaf',view:'front',bones:true,note:'爪子仍然显露且前臂缺少收拢；揣手语义未实现。'},
  {id:'side-nap',title:'05 · 当前侧卧 / 前方',clip:'side-nap',view:'front',bones:true,note:'左右腿对称折叠后整体旋转 1.4 rad；缺少下侧承重与上侧放松。'},
  {id:'curled-sleep',title:'06 · 当前蜷睡 / 斜侧',clip:'curled-sleep',view:'three',bones:true,note:'叠加香箱和脊柱转向，沿用香箱的离地与腕部问题。'},
  {id:'mouth-closed',title:'07 · 当前闭嘴 / 正面近景',face:expressions['安然'],view:'front',close:true,note:'鼻口、胡须绘在同一张平面贴图上；没有独立口鼻体积。'},
  {id:'mouth-open',title:'08 · 当前张嘴 / 正面近景',face:{...expressions['安然'],mouth:'open'},view:'front',close:true,note:'张嘴是切换到固定尺寸的椭圆；下颌不移动。'},
  {id:'mouth-side',title:'09 · 当前张嘴 / 侧面近景',face:{...expressions['安然'],mouth:'open'},view:'side',close:true,note:'侧面几乎看不见嘴；head 方块仍完整封闭口腔。'},
  {id:'paw-detail',title:'10 · 当前前爪 / 斜侧近景',pawOnly:true,view:'three',note:'一个长方体就是整个脚掌；没有独立趾团、肉垫厚度、爪尖。'},
  {id:'paw-bottom',title:'11 · 当前前爪 / 掌底近景',pawOnly:true,view:'front',note:'掌底只有一个方形色块；肉垫未区分趾垫与主掌垫。'},
  {id:'groom',title:'12 · 当前舔爪 / 斜侧',view:'three',bones:true,offsets:{'pose.sit':1,'groom.paw':1},face:{...expressions['安然'],mouth:'tongue'},note:'CCD 使用爪骨原点作为目标，末尾再改腕部旋转；未控制实际舔舐点与肉垫朝向。'},
];
for(const card of cards){
  const element=document.createElement('div');element.className='card';element.dataset.id=card.id;
  const title=document.createElement('h2');title.textContent=card.title;element.appendChild(title);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f5f3ed');
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(450,280);renderer.setPixelRatio(2);renderer.outputColorSpace=THREE.SRGBColorSpace;element.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x78716b,1.8));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(-20,35,25);scene.add(light);
  const rig=buildRig(skin,data);scene.add(rig.root);
  const atlas=paintSkin(data.nodes,skin);const texture=new THREE.CanvasTexture(atlas.canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=texture.magFilter=THREE.NearestFilter;
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:1});
  rig.root.traverse(o=>{if(o instanceof THREE.Mesh)o.material=material;});
  for(const n of data.nodes)if(faceBox.test(n.id))for(const c of rig.node(n.id).children)if(c instanceof THREE.Mesh)c.visible=false;
  const fc=document.createElement('canvas');fc.width=fc.height=256;
  const ft=new THREE.CanvasTexture(fc);ft.colorSpace=THREE.SRGBColorSpace;
  const head=data.nodes.find(n=>n.id==='head')!;
  const face=new THREE.Mesh(new THREE.PlaneGeometry(head.box.size[0],head.box.size[1]),new THREE.MeshBasicMaterial({map:ft,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  face.position.set(...head.box.offset);face.position.z+=head.box.size[2]/2+.025;rig.node('head').add(face);
  const ctrl=createBodyController(rig,data),idle=createIdleAnimator(rig);
  ctrl.reset();idle.update(rig,0,1/60,0,0);
  let offsets=card.offsets??{},state=card.face??expressions['安然'];
  if(card.clip){const d=createDirector(data.nodes.map(n=>n.id));d.play(card.clip);let f=d.update(1/60,'idle',false);for(let i=1;i<120;i++)f=d.update(1/60,'idle',false);offsets=f.offsets;state=f.face;}
  if(card.pose)offsets={['pose.'+card.pose]:1};
  if(card.candidate){
    // Single diagnostic intervention: replace fold/contact targets, keep hierarchy and geometry.
    offsets={...POSES.loaf};
    for(const side of ['L','R']){
      offsets['scap'+side+'.position.y']=1;
      offsets['upperF'+side+'.rotation.x']=1.55;
      offsets['lowerF'+side+'.rotation.x']=-2.8;
      offsets['pawF'+side+'.rotation.x']=1.25;
      offsets['thigh'+side+'.rotation.x']=-1.15;
      offsets['shin'+side+'.rotation.x']=1.85;
      offsets['foot'+side+'.rotation.x']=-1.4;
      offsets['pawB'+side+'.rotation.x']=.7;
    }
  }
  ctrl.apply(offsets);paintFace(fc,skin,state,false);ft.needsUpdate=true;
  const parts=measure(rig);measurements.push({id:card.id,offsets,parts});
  if(card.bones){
    const points:THREE.Vector3[]=[];
    for(const n of data.nodes){if(!n.parent||faceBox.test(n.id)||/^ear/.test(n.id))continue;points.push(rig.node(n.id).getWorldPosition(new THREE.Vector3()),rig.node(n.parent).getWorldPosition(new THREE.Vector3()));}
    const line=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xea7517,depthTest:false,transparent:true,opacity:.85}));line.renderOrder=10;scene.add(line);
  }
  const grid=new THREE.GridHelper(80,40,0xc1bbb1,0xe3ddd3);scene.add(grid);
  // Common scale/target for body panels, common head target for mouth panels.
  const focus=card.close?rig.node('head').localToWorld(new THREE.Vector3(0,1.7,2)):new THREE.Vector3(0,7,-1);
  const halfH=card.close?5.8:15.5;
  const camera=new THREE.OrthographicCamera(-halfH*450/280,halfH*450/280,halfH,-halfH,.1,300);
  const theta=card.view==='side'?Math.PI/2:card.view==='front'?0:Math.PI/4;
  camera.position.copy(focus).add(new THREE.Vector3(Math.sin(theta)*80,card.view==='three'?24:0,Math.cos(theta)*80));camera.lookAt(focus);renderer.render(scene,camera);
  if(card.pawOnly){
    // Isolate the actual production box and UVs; no invented replacement mesh.
    const paw=rig.node('pawFL').children.find(o=>o instanceof THREE.Mesh) as THREE.Mesh;
    const isolated=paw.clone();isolated.position.set(0,0,0);isolated.rotation.set(0,0,0);rig.root.visible=false;grid.visible=false;scene.add(isolated);
    camera.left=-3.5*450/280;camera.right=3.5*450/280;camera.top=3.5;camera.bottom=-3.5;camera.updateProjectionMatrix();
    camera.position.set(card.view==='front'?0:6,card.view==='front'?-10:-4,card.view==='front'?0:6);camera.up.set(0,0,1);camera.lookAt(0,0,0);renderer.render(scene,camera);
  }
  const note=document.createElement('div');note.className='note';note.textContent=card.note;element.appendChild(note);document.getElementById('grid')!.appendChild(element);
}
const sleepDirector=createDirector(data.nodes.map(n=>n.id));sleepDirector.play('curled-sleep');
const sleepSamples:unknown[]=[];
for(let frame=1;frame<=480;frame++){
  // Same restart condition used by main.ts while the life engine is asleep.
  if(!sleepDirector.playing)sleepDirector.play('curled-sleep');
  const f=sleepDirector.update(1/60,'sleep',false);
  if([120,270,330,345,360,375,390,420,480].includes(frame))sleepSamples.push({time:frame/60,loaf:f.offsets['pose.loaf']??0,curl:f.offsets['pose.curl']??0,playing:sleepDirector.playing?.id??null});
}
// Inspectable from the repeatable headless capture script.
(window as unknown as {modelAudit:unknown}).modelAudit={skin,measurements,sleepSamples};
