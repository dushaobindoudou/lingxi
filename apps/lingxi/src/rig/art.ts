import {paintAtelier} from './atelier.ts';
import { computeAtlasLayout, faceRects } from './atlas.ts';
import type { NodeSpec, VoxelSkin } from './skeleton.ts';

export interface ArtSkin extends VoxelSkin { schemaVersion: number; description: string; pattern: string }
export const layers = {
  eye: ['slit', 'round', 'wide', 'side', 'half', 'happy', 'closed', 'heart', 'soft', 'wink-left', 'wink-right', 'sparkle', 'tearful'],
  brow: ['flat', 'none', 'furrow', 'raise', 'sad'],
  mouth: ['flat', 'cat', 'open', 'frown', 'hiss', 'tongue'],
  ear: ['neutral', 'forward', 'airplane', 'back'],
  symbol: ['none', 'sweat', 'question', 'exclaim', 'heart', 'sleep', 'anger'],
} as const;
export type FaceState = { [K in keyof typeof layers]: (typeof layers)[K][number] };
export const expressions: Record<string, FaceState> = {
  '安然': {eye:'slit',brow:'none',mouth:'cat',ear:'neutral',symbol:'none'},
  '好奇': {eye:'round',brow:'raise',mouth:'flat',ear:'forward',symbol:'question'},
  '满足': {eye:'happy',brow:'none',mouth:'cat',ear:'neutral',symbol:'none'},
  '警觉': {eye:'wide',brow:'raise',mouth:'flat',ear:'forward',symbol:'exclaim'},
  '不爽': {eye:'side',brow:'furrow',mouth:'frown',ear:'airplane',symbol:'none'},
  '惊吓': {eye:'wide',brow:'raise',mouth:'open',ear:'back',symbol:'sweat'},
  '困困': {eye:'half',brow:'sad',mouth:'flat',ear:'neutral',symbol:'sleep'},
  '玩心': {eye:'round',brow:'raise',mouth:'tongue',ear:'forward',symbol:'none'},
  '生气': {eye:'slit',brow:'furrow',mouth:'hiss',ear:'back',symbol:'anger'},
  '撒娇': {eye:'heart',brow:'raise',mouth:'cat',ear:'forward',symbol:'heart'},
  '闭眼休息': {eye:'closed',brow:'none',mouth:'cat',ear:'neutral',symbol:'sleep'},
  '开心': {eye:'happy',brow:'raise',mouth:'cat',ear:'forward',symbol:'none'},
  '放松': {eye:'soft',brow:'none',mouth:'cat',ear:'neutral',symbol:'none'},
  '认真': {eye:'slit',brow:'flat',mouth:'flat',ear:'forward',symbol:'none'},
  '陶醉': {eye:'closed',brow:'none',mouth:'cat',ear:'neutral',symbol:'heart'},
  '期待': {eye:'sparkle',brow:'raise',mouth:'cat',ear:'forward',symbol:'none'},
  '喵喵': {eye:'round',brow:'none',mouth:'cat',ear:'neutral',symbol:'none'},
  '清醒': {eye:'round',brow:'flat',mouth:'flat',ear:'forward',symbol:'none'},
  '安心': {eye:'soft',brow:'none',mouth:'cat',ear:'neutral',symbol:'heart'},
  '温柔': {eye:'soft',brow:'raise',mouth:'cat',ear:'forward',symbol:'none'},
  '委屈': {eye:'tearful',brow:'sad',mouth:'frown',ear:'back',symbol:'none'},
  '害羞': {eye:'half',brow:'sad',mouth:'cat',ear:'neutral',symbol:'heart'},
  '求抱抱': {eye:'round',brow:'sad',mouth:'cat',ear:'forward',symbol:'heart'},
  '困惑': {eye:'round',brow:'raise',mouth:'frown',ear:'neutral',symbol:'question'},
  '警惕': {eye:'side',brow:'raise',mouth:'flat',ear:'forward',symbol:'exclaim'},
  '嫌弃': {eye:'half',brow:'furrow',mouth:'frown',ear:'airplane',symbol:'none'},
  '得意': {eye:'half',brow:'raise',mouth:'cat',ear:'forward',symbol:'none'},
  '左眼眨': {eye:'wink-left',brow:'raise',mouth:'cat',ear:'neutral',symbol:'none'},
  '右眼眨': {eye:'wink-right',brow:'raise',mouth:'cat',ear:'neutral',symbol:'none'},
  '闪亮': {eye:'sparkle',brow:'none',mouth:'cat',ear:'forward',symbol:'heart'},
};

/** Top-left pixel rectangles, explicit six-face layout exported alongside every PNG. */
export function paintSkin(nodes: NodeSpec[], skin: ArtSkin) {
  const layout = computeAtlasLayout(nodes);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = layout.size;
  const ctx = canvas.getContext('2d')!;
  const c = skin.materials;
  for (const n of nodes) {
    const r = layout.regions[n.id];
    const faces = faceRects(r);
    const fill = (face: keyof typeof faces, color: string, u=0, v=0, w=1, h=1) => {
      const [x,y,fw,fh] = faces[face];
      ctx.fillStyle = color;
      ctx.fillRect(x+Math.round(u*fw),y+Math.round(v*fh),Math.ceil(w*fw),Math.ceil(h*fh));
    };
    let base = c[n.slot] ?? c.fur;
    // Large, quiet fields of colour. Markings are localized, never repeated on each joint.
    if (/ear/.test(n.id)) base = skin.pattern==='point' ? c.pattern : c.fur;
    if (/^(tail|foot|paw)/.test(n.id) && skin.pattern==='point') base=c.pattern;
    for (const f of Object.keys(faces) as Array<keyof typeof faces>) fill(f,base);
    if (/^(hipC|spine\d|chest)$/.test(n.id)) {
      fill('ny',c.cream);
      if (n.id==='chest') fill('pz',c.cream,.18,.35,.64,.65);
      if(skin.pattern==='tabby' && ['spine1','spine3'].includes(n.id)) {
        fill('px',c.pattern,.12,.1,.6,.13); fill('nx',c.pattern,.12,.1,.6,.13);
      }
      if(skin.pattern==='bicolor' && ['spine2','spine3','hipC'].includes(n.id)) fill('py',c.pattern);
    }
    if(n.id==='head') {
      if(skin.pattern==='point') for(const f of ['pz','px','nx'] as const) fill(f,c.pattern);
      if(skin.pattern==='bicolor') {fill('py',c.pattern);fill('px',c.pattern);fill('pz',c.pattern,0,0,.3,.45);}
      if(skin.pattern==='tabby') for(const u of [.25,.47,.69]) fill('py',c.pattern,u,.15,.07,.5);
    }
    if(/^tail[246]$/.test(n.id) && skin.pattern==='tabby') for(const f of ['px','nx','py','ny'] as const) fill(f,c.pattern,.1,.1,.75,.22);
    if(/^ear/.test(n.id)) fill('pz',c.nose,.24,.18,.52,.65);
    if(/^(paw|toe|foot)/.test(n.id)) {fill('ny',c.nose,.25,.25,.5,.5);}
  }
  if(skin.pattern.startsWith('atelier-'))paintAtelier(ctx,nodes,layout,c,skin.pattern);
  return {canvas,layout};
}

/** Transparent face decal, one canvas reused. Skin controls all colours, including lids. */
export function paintFace(canvas: HTMLCanvasElement, skin: ArtSkin, state: FaceState, blink=false) {
  const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,256,256);
  const c=skin.materials;
  const round=(x:number,y:number,w:number,h:number,r:number,color:string)=>{ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
  const path=(d:string,color:string,stroke=false,width=4)=>{const p=new Path2D(d);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';if(stroke)ctx.stroke(p);else ctx.fill(p);};
  const ellipse=(x:number,y:number,rx:number,ry:number,color:string)=>{ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();};
  round(85,166,86,48,16,c.cream);
  for(const x of [70,186]) {
    const eye=blink?'closed':state.eye==='wink-left'?(x<128?'closed':'round'):state.eye==='wink-right'?(x>128?'closed':'round'):state.eye;
    if(eye==='happy'||eye==='closed') path(eye==='happy'?`M${x-19} 128 Q${x} 99 ${x+19} 128`:`M${x-19} 119 Q${x} 137 ${x+19} 119`,c.pupil,true,5);
    else if(eye==='heart') path(`M${x} 143 C${x-45} 117 ${x-12} 94 ${x} 117 C${x+12} 94 ${x+45} 117 ${x} 143`,'#CE7888');
    else {
      const half=eye==='half'||eye==='soft'; const wide=eye==='wide';
      round(x-22,half?119:99,44,half?23:wide?49:43,9,c.iris);
      if(eye==='slit') round(x-5,103,10,34,5,c.pupil);
      else ellipse(x+(eye==='side'?9:0),half?130:121,wide?7:11,half?8:13,c.pupil);
      if(!half) ellipse(x-3+(eye==='side'?9:0),113,3,3,c.cream);
      if(eye==='sparkle'){ellipse(x+5,128,3,3,c.cream);ellipse(x-6,113,5,5,c.cream);}
      if(eye==='tearful')ellipse(x+13,142,4,7,'#93C3CF');
    }
    if(state.brow!=='none') {
      const inward=x<128?1:-1;
      const tilt=state.brow==='furrow'?8*inward:state.brow==='sad'?-8*inward:0;
      const y=state.brow==='raise'?79:86;
      path(`M${x-18} ${y-tilt} Q${x} ${y-4} ${x+18} ${y+tilt}`,c.pattern,true,4);
    }
  }
  path('M119 174 Q128 171 137 174 L128 183 Z',c.nose);
  if(state.mouth==='cat') path('M109 193 Q117 204 128 194 Q139 204 147 193',c.pupil,true,3);
  if(state.mouth==='flat') round(119,196,18,3,1.5,c.pupil);
  if(state.mouth==='frown') path('M113 203 Q128 187 143 203',c.pupil,true,3);
  if(['open','tongue','hiss'].includes(state.mouth)) {
    ellipse(128,202,12,14,c.mouth);
    if(state.mouth==='tongue') round(121,203,14,18,7,c.tongue);
    if(state.mouth==='hiss') {path('M118 190 L124 190 L121 199 Z',c.cream);path('M132 190 L138 190 L135 199 Z',c.cream);}
  }
  for(const direction of [-1,1]) for(const dy of [-7,7]) path(`M${128+direction*47} ${185+dy} L${128+direction*88} ${185+dy*1.8}`,c.cream,true,2);
  const symbol=state.symbol;
  if(symbol==='heart')path('M226 52 C196 33 215 18 226 32 C237 18 256 33 226 52','#CE7888');
  if(symbol==='sweat')path('M228 23 Q247 49 228 53 Q209 49 228 23','#86B7C4');
  if(symbol==='anger')path('M213 27 L224 35 L213 43 M239 27 L228 35 L239 43','#BB7866',true,3);
  if(['question','exclaim','sleep'].includes(symbol)) {ctx.fillStyle=symbol==='sleep'?'#8E9DA8':c.pattern;ctx.font='bold 28px system-ui';ctx.fillText(symbol==='question'?'?':symbol==='exclaim'?'!':'zZ',213,48);}
}
