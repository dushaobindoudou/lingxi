import * as THREE from 'three';
import data from '../data/skeleton.json';
import catalogue from '../data/skins.json';
import {refineSkeleton, SOFT_LAYOUT_ID} from '../rig/anatomy.ts';
import {createBodyController} from '../anim/body-controller.ts';
import {POSES} from '../anim/poses.ts';
import honeyPNG from '../../../../assets/characters/lingxi/voxel-style-kit/honey-mittens.png';
import silverPNG from '../../../../assets/characters/lingxi/voxel-style-kit/silver-brook.png';
import calicoPNG from '../../../../assets/characters/lingxi/voxel-style-kit/calico-poem.png';
import motionData from '../data/actions.json';
import {sampleMotion, parseMotions, type Motion} from '../anim/motion.ts';
import { buildRig, type SkeletonData } from '../rig/skeleton.ts';
import { createIdleAnimator } from '../anim/idle.ts';
import { faceRects, applyAtlasUVs } from '../rig/atlas.ts';
import { mappedUVs, parseTextureConfig, readPngSize, type TextureConfig, type MappingMode } from '../rig/texture-import.ts';
import { paintSkin, paintFace, expressions, layers, type FaceState, type ArtSkin } from '../rig/art.ts';

const skeleton=refineSkeleton(data as unknown as SkeletonData);
const skins=catalogue as ArtSkin[];
const $=(id:string)=>document.getElementById(id)!;
let skin=skins.find(s=>s.id==='honey-mittens')??skins[0];
try { skin=skins.find(s=>s.id===localStorage.getItem('lingxi-style-lab-skin'))??skin; } catch { /* storage optional */ }
let state:FaceState={...expressions['安然']};
const stage=$('stage');
const scene=new THREE.Scene();scene.background=new THREE.Color('#EEE5D8');
const camera=new THREE.OrthographicCamera(-25,25,25,-25,.1,500);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NoToneMapping;
stage.append(renderer.domElement);
scene.add(new THREE.HemisphereLight('#ffffff','#C6B69F',2));
scene.add(new THREE.AmbientLight('#ffffff',.7));
const key=new THREE.DirectionalLight('#FFF8ED',1.4);key.position.set(-30,60,50);scene.add(key);
const rig=buildRig(skin,skeleton);scene.add(rig.root);
const atlas=paintSkin(skeleton.nodes,skin);
const bodyTexture=new THREE.CanvasTexture(atlas.canvas);
bodyTexture.colorSpace=THREE.SRGBColorSpace;bodyTexture.magFilter=bodyTexture.minFilter=THREE.NearestFilter;bodyTexture.generateMipmaps=false;
const bodyMaterial=new THREE.MeshStandardMaterial({map:bodyTexture,roughness:1,metalness:0});
rig.root.traverse(o=>{if(o instanceof THREE.Mesh)o.material=bodyMaterial;});
// Hide geometry only, not child pivots. The atlas-based face replaces the legacy face boxes.
for(const n of skeleton.nodes) if(/^(eye|pupil|brow|nose|mouth|whisker|jaw|tongue)/.test(n.id)) {
  for(const child of rig.node(n.id).children) if(child instanceof THREE.Mesh)child.visible=false;
}
const faceCanvas=$('face') as HTMLCanvasElement;
const faceTexture=new THREE.CanvasTexture(faceCanvas);faceTexture.colorSpace=THREE.SRGBColorSpace;
faceTexture.generateMipmaps=false;faceTexture.minFilter=faceTexture.magFilter=THREE.LinearFilter;
const headSpec=skeleton.nodes.find(n=>n.id==='head')!;
const [hx,hy,hz]=headSpec.box.size;
const faceGeometry=new THREE.PlaneGeometry(hx,hy);
const faceMaterial=new THREE.MeshBasicMaterial({map:faceTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
const faceMesh=new THREE.Mesh(faceGeometry,faceMaterial);
faceMesh.position.set(headSpec.box.offset[0],headSpec.box.offset[1],headSpec.box.offset[2]+hz/2+.025);
rig.node('head').add(faceMesh);
const ground=new THREE.Mesh(new THREE.CircleGeometry(25,64),new THREE.MeshBasicMaterial({color:'#DED2C0'}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.08;scene.add(ground);
const bounds=new THREE.Box3().setFromObject(rig.root);
const focus=bounds.getCenter(new THREE.Vector3());
const radius=bounds.getBoundingSphere(new THREE.Sphere()).radius*1.2;
let angle=.18,spin=false,walking=false,t=0,last=performance.now(),phase=0;
const animator=createIdleAnimator();
const originalHead=rig.node('head').rotation.clone();
let blink=false,nextBlink=2.5,blinkEnd=0;
let earAngle=0,headAngle=0;
let importRevision=0;
let imported: {canvas:HTMLCanvasElement; texture:THREE.CanvasTexture; config:TextureConfig; name:string}|null=null;
const bodyMeshes = new Map(skeleton.nodes.map(n => [n.id, rig.node(n.id).children.find(o => o instanceof THREE.Mesh) as THREE.Mesh<THREE.BoxGeometry>]));
let activeMotion:{motion:Motion;elapsed:number}|null=null;
let actionLibrary:Motion[]=parseMotions(motionData,skeleton.nodes.map(n=>n.id),Object.keys(expressions),Object.keys(POSES));
let paused=false,blendTime=1,lastOffsets:Record<string,number>={},blendFrom:Record<string,number>={};
let actionFace:{mouth?:FaceState['mouth']}={};
const bodyController=createBodyController(rig,skeleton);
function stopMotion(){blendFrom={...lastOffsets};blendTime=0;activeMotion=null;paused=false;}
function playMotion(motion:Motion){
  blendFrom={...lastOffsets};blendTime=0;activeMotion={motion,elapsed:0};paused=false;walking=false;$('walk').textContent='散步';
  spin=false;angle=.18;state={...expressions[motion.expression]};updateLayers();redraw();
  for(const b of $('expressions').children)b.setAttribute('aria-pressed',String(b.textContent===motion.expression));
}
function renderMotions(){
  $('motions').replaceChildren();const category=($('motion-category') as HTMLSelectElement).value;
  for(const motion of actionLibrary){if(category!=='all'&&motion.category!==category)continue;
    const button=document.createElement('button');button.textContent=motion.name;button.title=motion.description??motion.name;button.onclick=()=>playMotion(motion);$('motions').append(button);
  }
  $('motion-count').textContent=`${actionLibrary.length} 个可播放动作 · 默认朝向你`;
}
$('motion-category').onchange=renderMotions;
$('stop-motion').onclick=stopMotion;
$('pause-motion').onclick=()=>{paused=!paused;$('pause-motion').textContent=paused?'继续播放':'暂停动作';};
$('motion-progress').oninput=()=>{if(activeMotion){paused=true;activeMotion.elapsed=Number(($('motion-progress') as HTMLInputElement).value)*activeMotion.motion.duration;$('pause-motion').textContent='继续播放';}};
$('import-motion').onchange=async()=>{
  const input=$('import-motion') as HTMLInputElement;const file=input.files?.[0];input.value='';if(!file)return;
  try{const parsed=parseMotions(await readConfigFile(file),skeleton.nodes.map(n=>n.id),Object.keys(expressions),Object.keys(POSES));
    stopMotion();actionLibrary=parsed;($('motion-category') as HTMLSelectElement).value='all';renderMotions();$('motion-status').textContent=`已导入 ${parsed.length} 个自定义动作`;
  }catch(error){$('motion-status').textContent=String(error);}
};
$('export-motion').onclick=()=>download(new Blob([JSON.stringify({schemaVersion:2,actions:actionLibrary},null,2)],{type:'application/json'}),'cat-actions.json');
renderMotions();
function redraw(){paintFace(faceCanvas,skin,{...state,...actionFace},blink);faceTexture.needsUpdate=true;}
function updateLayers(){for(const k of Object.keys(layers) as Array<keyof FaceState>)(document.querySelector(`[data-layer="${k}"]`) as HTMLSelectElement).value=state[k];}
function selectSkin(next:ArtSkin){
  importRevision++;skin=next;
  if(imported){imported.texture.dispose();imported=null;}
  bodyMaterial.map=bodyTexture;bodyMaterial.needsUpdate=true;
  for(const [id,mesh] of bodyMeshes)applyAtlasUVs(mesh.geometry,atlas.layout.regions[id],atlas.layout.size);
  $('status').textContent='已使用预设毛色。选择任意 PNG，即可覆盖全身。';
  ($('clear-config') as HTMLButtonElement).disabled=true;
  ($('texture-mode') as HTMLSelectElement).value='tile';
  ($('tile-size') as HTMLInputElement).disabled=false;
  const request=importRevision;
  const pngURLs:Record<string,string>={'honey-mittens':honeyPNG,'silver-brook':silverPNG,'calico-poem':calicoPNG};
  const painted=paintSkin(skeleton.nodes,skin);
  if(pngURLs[skin.id]){const image=new Image();image.onload=()=>{if(request!==importRevision)return;const ctx=atlas.canvas.getContext('2d')!;ctx.clearRect(0,0,atlas.canvas.width,atlas.canvas.height);ctx.drawImage(image,0,0);bodyTexture.needsUpdate=true;};image.onerror=()=>{if(request===importRevision)$('status').textContent='PNG 加载失败，正在使用同图案的程序生成版本';};image.src=pngURLs[skin.id];}
  atlas.canvas.getContext('2d')!.clearRect(0,0,atlas.canvas.width,atlas.canvas.height);
  atlas.canvas.getContext('2d')!.drawImage(painted.canvas,0,0);
  bodyTexture.needsUpdate=true;
  $('skin-name').textContent=skin.name;$('skin-description').textContent=skin.description;
  document.querySelectorAll<HTMLButtonElement>('[data-skin]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.skin===skin.id)));
  try{localStorage.setItem('lingxi-style-lab-skin',skin.id);}catch{/* storage optional */}
  redraw();
}
for(const s of skins){
  const b=document.createElement('button');b.dataset.skin=s.id;
  b.innerHTML=`${['fur','pattern','cream','iris'].map(k=>`<span class="swatch" style="background:${s.materials[k]}"></span>`).join('')}<strong>${s.name}</strong><span>${s.description}</span>`;
  b.onclick=()=>selectSkin(s);$('skins').append(b);
}
for(const [name,expression] of Object.entries(expressions)){
  const b=document.createElement('button');b.textContent=name;b.setAttribute('aria-pressed',String(name==='安然'));
  b.onclick=()=>{stopMotion();state={...expression};updateLayers();redraw();for(const item of $('expressions').children)item.setAttribute('aria-pressed',String(item===b));};$('expressions').append(b);
}
const labels={eye:'眼睛',brow:'眉毛',mouth:'嘴巴',ear:'耳朵',symbol:'情绪符号'};
for(const k of Object.keys(layers) as Array<keyof FaceState>){
  const label=document.createElement('label');label.className='layer';label.textContent=labels[k];
  const select=document.createElement('select');select.dataset.layer=k;
  for(const v of layers[k]){const option=document.createElement('option');option.value=option.textContent=v;select.append(option);}
  select.onchange=()=>{stopMotion();state={...state,[k]:select.value};redraw();for(const b of $('expressions').children)b.setAttribute('aria-pressed','false');};label.append(select);$('layers').append(label);
}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function png(canvas:HTMLCanvasElement,name:string){canvas.toBlob(b=>{if(b)download(b,name);},'image/png');}
$('export-png').onclick=()=>png(imported?.canvas??atlas.canvas,imported?.name??`${skin.id}.png`);
$('export-face').onclick=()=>{paintFace(faceCanvas,skin,state,false);faceTexture.needsUpdate=true;png(faceCanvas,`${skin.id}-face.png`);};
$('export-json').onclick=()=>download(new Blob([JSON.stringify(imported?.config??{
  ...skin,format:'lingxi-skin',layoutId:SOFT_LAYOUT_ID,
  texture:{file:`${skin.id}.png`,width:atlas.layout.size,height:atlas.layout.size,colorSpace:'srgb',filter:'nearest',origin:'top-left'},
  uv:Object.fromEntries(Object.entries(atlas.layout.regions).map(([id,r])=>[id,faceRects(r)])),
  face:{file:`${skin.id}-face.png`,width:256,height:256,state,attachTo:'head',forward:'+Z'},
},null,2)],{type:'application/json'}),imported?imported.name.replace(/\.png$/i,'.json'):`${skin.id}.json`);
function makeConfig(width:number,height:number):TextureConfig {
  return {format:'lingxi-texture',schemaVersion:1,rigId:skeleton.id,textureSize:[width,height],
    mapping:{mode:($('texture-mode') as HTMLSelectElement).value as MappingMode,tileSize:Number(($('tile-size') as HTMLInputElement).value)},
    filter:($('texture-filter') as HTMLSelectElement).value as TextureConfig['filter'],faces:{}};
}
function prepareMapping(config:TextureConfig) {
  if(config.mapping.mode==='atlas'&&(config.textureSize[0]!==atlas.layout.size||config.textureSize[1]!==atlas.layout.size))throw new Error(`专用展开图模式需要 ${atlas.layout.size} × ${atlas.layout.size}；普通图片请选择全身平铺或整图铺面`);
  return skeleton.nodes.map(n=>({mesh:bodyMeshes.get(n.id)!,uv:mappedUVs(n,config,faceRects(atlas.layout.regions[n.id]))}));
}
function showImported() {
  if(!imported)return;
  const {config,name}=imported;
  const count=Object.values(config.faces).reduce((n,faces)=>n+Object.keys(faces).length,0);
  ($('texture-mode') as HTMLSelectElement).value=config.mapping.mode;
  ($('texture-filter') as HTMLSelectElement).value=config.filter;
  ($('tile-size') as HTMLInputElement).value=String(config.mapping.tileSize);
  ($('tile-size') as HTMLInputElement).disabled=config.mapping.mode!=='tile';
  ($('clear-config') as HTMLButtonElement).disabled=count===0;
  $('skin-name').textContent='自定义 PNG 皮肤';
  $('skin-description').textContent=name;
  document.querySelectorAll('[data-skin]').forEach(b=>b.setAttribute('aria-pressed','false'));
  $('status').textContent=`已覆盖全身：${name}（${config.textureSize.join(' × ')}）。${count?`JSON 指定了 ${count} 个面，其余部位自动覆盖。`:'可调整覆盖方式与图案大小。'}刷新后恢复预设。`;
}
function applyConfig(config:TextureConfig) {
  if(!imported)return;
  const prepared=prepareMapping(config);
  for(const {mesh,uv} of prepared){mesh.geometry.attributes.uv.array.set(uv);mesh.geometry.attributes.uv.needsUpdate=true;}
  imported.config=config;
  imported.texture.wrapS=imported.texture.wrapT=config.mapping.mode==='tile'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
  imported.texture.magFilter=imported.texture.minFilter=config.filter==='nearest'?THREE.NearestFilter:THREE.LinearFilter;
  imported.texture.needsUpdate=true;
  bodyMaterial.map=imported.texture;bodyMaterial.needsUpdate=true;
  showImported();
}
async function readConfigFile(file:File) {
  if(file.size>256*1024)throw new Error('JSON 配置不能超过 256 KB');
  return JSON.parse(await file.text()) as unknown;
}
async function importFiles(files:File[]) {
  const revision=++importRevision;
  try {
    const pngFiles=files.filter(f=>/\.png$/i.test(f.name)||f.type==='image/png');
    const jsonFiles=files.filter(f=>/\.json$/i.test(f.name));
    if(pngFiles.length>1||jsonFiles.length>1||pngFiles.length+jsonFiles.length!==files.length||!files.length)throw new Error('一次请选择一张 PNG，可同时附带一份 JSON');
    const pngFile=pngFiles[0],jsonFile=jsonFiles[0];
    if(!pngFile){
      if(!imported)throw new Error('先导入 PNG，或同时选择 PNG 和 JSON');
      const raw=await readConfigFile(jsonFile);
      if(revision!==importRevision)return;
      applyConfig(parseTextureConfig(raw,skeleton.nodes,skeleton.id,imported.canvas.width,imported.canvas.height));
      return;
    }
    if(pngFile.size>8*1024*1024)throw new Error('PNG 不能超过 8 MB');
    const [width,height]=readPngSize(new Uint8Array(await pngFile.slice(0,24).arrayBuffer()));
    const raw=jsonFile?await readConfigFile(jsonFile):null;
    if(revision!==importRevision)return;
    const config=jsonFile?parseTextureConfig(raw,skeleton.nodes,skeleton.id,width,height):makeConfig(width,height);
    // A newly chosen ordinary image always starts with automatic mapping, even after an atlas.
    if(!jsonFile&&config.mapping.mode==='atlas')config.mapping.mode='tile';
    prepareMapping(config);
    const bitmap=await createImageBitmap(pngFile);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    try {
      if(revision!==importRevision)return;
      if(bitmap.width!==width||bitmap.height!==height)throw new Error('PNG 解码尺寸与文件头不符');
      // Alpha is composited over the selected fur colour; transparent pixels do not cut holes.
      const ctx=canvas.getContext('2d')!;ctx.fillStyle=skin.materials.fur;ctx.fillRect(0,0,width,height);ctx.drawImage(bitmap,0,0);
    } finally {bitmap.close();}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;
    const previous=imported;
    imported={canvas,texture,config,name:pngFile.name};
    applyConfig(config);previous?.texture.dispose();
  }catch(error){if(revision===importRevision)$('status').textContent=String(error);}
}
for(const id of ['import-png','import-config']){
  const input=$(id) as HTMLInputElement;
  input.onchange=()=>{const files=Array.from(input.files??[]);input.value='';if(files.length)void importFiles(files);};
  input.parentElement!.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};
}
const drop=$('texture-drop');
drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};
drop.ondragleave=()=>drop.classList.remove('dragging');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');void importFiles(Array.from(e.dataTransfer?.files??[]));};
for(const id of ['texture-mode','tile-size','texture-filter']) $(id).addEventListener('input',()=>{
  importRevision++;
  if(!imported)return;
  const config={...makeConfig(imported.canvas.width,imported.canvas.height),faces:imported.config.faces};
  try{applyConfig(config);}catch(error){showImported();$('status').textContent=String(error);}
});
$('clear-config').onclick=()=>{importRevision++;if(imported)applyConfig({...imported.config,faces:{}});};
$('keep-face').onchange=()=>{faceMesh.visible=($('keep-face') as HTMLInputElement).checked;};
$('rotate').onclick=()=>{spin=!spin;};$('walk').onclick=()=>{walking=!walking;$('walk').textContent=walking?'停下来':'散步';};
$('front').onclick=()=>{spin=false;angle=.18;};$('three').onclick=()=>{spin=false;angle=.45;};
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);const aspect=w/h;camera.left=-radius*aspect;camera.right=radius*aspect;camera.top=radius;camera.bottom=-radius;camera.updateProjectionMatrix();}
window.addEventListener('resize',resize);resize();updateLayers();selectSkin(skin);
let raf=0;
function frame(now:number){
  const dt=Math.min(.05,(now-last)/1000);last=now;t+=dt;phase+=dt*7;
  bodyController.reset();
  animator.update(rig,t,dt,phase,walking?1:0);
  // Idle first, expression second. Do not accumulate additive offsets over previous frames.
  const targetEar={neutral:0,forward:.13,airplane:.8,back:-.48}[state.ear];
  const blend=1-Math.exp(-dt/0.16);earAngle+=(targetEar-earAngle)*blend;
  for(const [id,sign] of [['earL',-1],['earR',1]] as const)rig.node(id).rotation.z+=sign*earAngle;
  const targetHead=state.symbol==='question'?.12:state.eye==='half'?.07:0;
  headAngle+=(targetHead-headAngle)*blend;
  rig.node('head').rotation.set(originalHead.x,originalHead.y,originalHead.z+headAngle);
  if(t>=nextBlink){blinkEnd=t+.13;nextBlink=t+2.4+Math.random()*3.8;}
  if(activeMotion&&!paused)activeMotion.elapsed=Math.min(activeMotion.motion.duration,activeMotion.elapsed+dt);
  const targetOffsets=activeMotion?sampleMotion(activeMotion.motion,activeMotion.elapsed):{};
  blendTime=Math.min(1,blendTime+dt/.22);const blendWeight=blendTime*blendTime*(3-2*blendTime);
  const offsets:Record<string,number>={};
  for(const channel of new Set([...Object.keys(blendFrom),...Object.keys(targetOffsets)]))offsets[channel]=(blendFrom[channel]??0)*(1-blendWeight)+(targetOffsets[channel]??0)*blendWeight;
  if(!activeMotion&&blendTime===1)for(const channel of Object.keys(offsets))delete offsets[channel];
  lastOffsets=offsets;bodyController.apply(offsets);
  if(activeMotion){
    ($('motion-progress') as HTMLInputElement).value=String(activeMotion.elapsed/activeMotion.motion.duration);
    $('motion-status').textContent=`${activeMotion.motion.name} · ${activeMotion.elapsed.toFixed(1)} / ${activeMotion.motion.duration.toFixed(1)} 秒${paused?' · 已暂停':''}`;
    if(activeMotion.elapsed>=activeMotion.motion.duration&&!paused){activeMotion=null;$('motion-status').textContent='动作完成 · 已恢复面向你';}
  }
  const next=offsets['face.blink']!==undefined?offsets['face.blink']>.5:t<blinkEnd;
  const nextMouth:FaceState['mouth']|undefined=offsets['face.tongue']!==undefined?(offsets['face.tongue']>.55?'tongue':'cat'):offsets['face.open']!==undefined?(offsets['face.open']>.3?'open':'cat'):undefined;
  if(next!==blink||nextMouth!==actionFace.mouth){blink=next;actionFace=nextMouth?{mouth:nextMouth}:{};redraw();}
  if(spin)angle+=dt*.3;
  camera.position.set(focus.x+Math.sin(angle)*80,focus.y+5,focus.z+Math.cos(angle)*80);camera.lookAt(focus);
  renderer.render(scene,camera);raf=requestAnimationFrame(frame);
}
raf=requestAnimationFrame(frame);
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);importRevision++;imported?.texture.dispose();rig.dispose();bodyTexture.dispose();bodyMaterial.dispose();faceTexture.dispose();faceMaterial.dispose();faceGeometry.dispose();ground.geometry.dispose();ground.material.dispose();renderer.dispose();});
