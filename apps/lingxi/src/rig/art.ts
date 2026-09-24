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
/** The built-in expression set. A user-supplied expressions.json replaces it at runtime via
 *  `setExpressions` - everything downstream reads `expressions`, so one swap covers the
 *  director, the debug console and the capability report. */
export const BUILT_IN_EXPRESSIONS: Record<string, FaceState> = {
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

export let expressions: Record<string, FaceState> = { ...BUILT_IN_EXPRESSIONS };

/** Swap in a validated custom expression set (see rig/custom-assets.ts). */
export function setExpressions(next: Record<string, FaceState>) {
  expressions = next;
}

/** Back to the built-in set. */
export function resetExpressions() {
  expressions = { ...BUILT_IN_EXPRESSIONS };
}

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
/**
 * Everything about the face that is geometry rather than colour or expression.
 *
 * The face used to be drawn from numbers written directly into paintFace, which meant a user who
 * wanted wider-set eyes or longer whiskers had to edit and rebuild the app. Colours were already
 * themeable and expressions were already data; the shapes were the one part that was not. These
 * are in the 256x256 face-texture space, same as the literals they replaced.
 */
export interface FaceGeometry {
  /** The lighter muzzle patch behind the nose and mouth. */
  muzzle: { x: number; y: number; width: number; height: number; radius: number };
  /** `spacing` is the distance of each eye's centre from the midline (128). */
  eyes: {
    spacing: number; top: number; width: number; height: number; radius: number;
    pupilRadiusX: number; pupilRadiusY: number; browY: number; browRaisedY: number;
  };
  nose: { y: number; halfWidth: number; depth: number };
  mouth: { y: number; halfWidth: number; openRadiusX: number; openRadiusY: number };
  /** `rows` whiskers per side, `spread` apart vertically, `length` long. */
  whiskers: { rows: number; spread: number; length: number; width: number; droop: number; y: number };
}

export const DEFAULT_FACE_GEOMETRY: FaceGeometry = {
  muzzle: { x: 85, y: 166, width: 86, height: 48, radius: 16 },
  eyes: {
    spacing: 58, top: 99, width: 44, height: 43, radius: 9,
    pupilRadiusX: 11, pupilRadiusY: 13, browY: 86, browRaisedY: 79,
  },
  nose: { y: 174, halfWidth: 9, depth: 9 },
  mouth: { y: 193, halfWidth: 19, openRadiusX: 12, openRadiusY: 14 },
  whiskers: { rows: 2, spread: 7, length: 41, width: 2, droop: 0.8, y: 185 },
};

export function paintFace(
  canvas: HTMLCanvasElement,
  skin: ArtSkin,
  state: FaceState,
  blink = false,
  geometry: FaceGeometry = DEFAULT_FACE_GEOMETRY,
) {
  const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,256,256);
  const c=skin.materials;
  const g=geometry;
  const round=(x:number,y:number,w:number,h:number,r:number,color:string)=>{ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
  const path=(d:string,color:string,stroke=false,width=4)=>{const p=new Path2D(d);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';if(stroke)ctx.stroke(p);else ctx.fill(p);};
  const ellipse=(x:number,y:number,rx:number,ry:number,color:string)=>{ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();};
  round(g.muzzle.x,g.muzzle.y,g.muzzle.width,g.muzzle.height,g.muzzle.radius,c.cream);
  const eyeHalfW=g.eyes.width/2, eyeMidY=g.eyes.top+g.eyes.height/2;
  for(const x of [128-g.eyes.spacing,128+g.eyes.spacing]) {
    const eye=blink?'closed':state.eye==='wink-left'?(x<128?'closed':'round'):state.eye==='wink-right'?(x>128?'closed':'round'):state.eye;
    if(eye==='happy'||eye==='closed') path(eye==='happy'?`M${x-19} ${eyeMidY+7} Q${x} ${eyeMidY-22} ${x+19} ${eyeMidY+7}`:`M${x-19} ${eyeMidY-2} Q${x} ${eyeMidY+16} ${x+19} ${eyeMidY-2}`,c.pupil,true,5);
    else if(eye==='heart') path(`M${x} ${eyeMidY+22} C${x-45} ${eyeMidY-4} ${x-12} ${eyeMidY-27} ${x} ${eyeMidY-4} C${x+12} ${eyeMidY-27} ${x+45} ${eyeMidY-4} ${x} ${eyeMidY+22}`,'#CE7888');
    else {
      const half=eye==='half'||eye==='soft'; const wide=eye==='wide';
      const top=half?g.eyes.top+20:g.eyes.top;
      const height=half?23:wide?g.eyes.height+6:g.eyes.height;
      round(x-eyeHalfW,top,g.eyes.width,height,g.eyes.radius,c.iris);
      if(eye==='slit') round(x-5,g.eyes.top+4,10,34,5,c.pupil);
      else ellipse(x+(eye==='side'?9:0),half?eyeMidY+9:eyeMidY,wide?7:g.eyes.pupilRadiusX,half?8:g.eyes.pupilRadiusY,c.pupil);
      if(!half) ellipse(x-3+(eye==='side'?9:0),eyeMidY-8,3,3,c.cream);
      if(eye==='sparkle'){ellipse(x+5,eyeMidY+7,3,3,c.cream);ellipse(x-6,eyeMidY-8,5,5,c.cream);}
      if(eye==='tearful')ellipse(x+13,eyeMidY+21,4,7,'#93C3CF');
    }
    if(state.brow!=='none') {
      const inward=x<128?1:-1;
      const tilt=state.brow==='furrow'?8*inward:state.brow==='sad'?-8*inward:0;
      const y=state.brow==='raise'?g.eyes.browRaisedY:g.eyes.browY;
      path(`M${x-18} ${y-tilt} Q${x} ${y-4} ${x+18} ${y+tilt}`,c.pattern,true,4);
    }
  }
  path(`M${128-g.nose.halfWidth} ${g.nose.y} Q128 ${g.nose.y-3} ${128+g.nose.halfWidth} ${g.nose.y} L128 ${g.nose.y+g.nose.depth} Z`,c.nose);
  const mw=g.mouth.halfWidth, my=g.mouth.y;
  if(state.mouth==='cat') path(`M${128-mw} ${my} Q${128-mw+8} ${my+11} 128 ${my+1} Q${128+mw-8} ${my+11} ${128+mw} ${my}`,c.pupil,true,3);
  if(state.mouth==='flat') round(128-9,my+3,18,3,1.5,c.pupil);
  if(state.mouth==='frown') path(`M${128-15} ${my+10} Q128 ${my-6} ${128+15} ${my+10}`,c.pupil,true,3);
  if(['open','tongue','hiss'].includes(state.mouth)) {
    ellipse(128,my+9,g.mouth.openRadiusX,g.mouth.openRadiusY,c.mouth);
    if(state.mouth==='tongue') round(121,my+10,14,18,7,c.tongue);
    if(state.mouth==='hiss') {path(`M118 ${my-3} L124 ${my-3} L121 ${my+6} Z`,c.cream);path(`M132 ${my-3} L138 ${my-3} L135 ${my+6} Z`,c.cream);}
  }
  // Whiskers: `rows` per side, spread symmetrically about the muzzle line and drooping outward.
  const rows=Math.max(0,Math.round(g.whiskers.rows));
  for(const direction of [-1,1]) for(let i=0;i<rows;i+=1) {
    const offset=(i-(rows-1)/2)*g.whiskers.spread*2;
    path(
      `M${128+direction*47} ${g.whiskers.y+offset} L${128+direction*(47+g.whiskers.length)} ${g.whiskers.y+offset*(1+g.whiskers.droop)}`,
      c.whisker ?? c.cream,true,g.whiskers.width,
    );
  }
  const symbol=state.symbol;
  if(symbol==='heart')path('M226 52 C196 33 215 18 226 32 C237 18 256 33 226 52','#CE7888');
  if(symbol==='sweat')path('M228 23 Q247 49 228 53 Q209 49 228 23','#86B7C4');
  if(symbol==='anger')path('M213 27 L224 35 L213 43 M239 27 L228 35 L239 43','#BB7866',true,3);
  if(['question','exclaim','sleep'].includes(symbol)) {ctx.fillStyle=symbol==='sleep'?'#8E9DA8':c.pattern;ctx.font='bold 28px system-ui';ctx.fillText(symbol==='question'?'?':symbol==='exclaim'?'!':'zZ',213,48);}
}
