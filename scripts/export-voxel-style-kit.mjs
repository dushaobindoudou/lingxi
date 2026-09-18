// node --experimental-strip-types scripts/export-voxel-style-kit.mjs /path/to/@napi-rs/canvas/index.js
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { createCanvas, Path2D, GlobalFonts } = await import(process.argv[2] ?? '@napi-rs/canvas');
GlobalFonts.registerFromPath('/System/Library/Fonts/PingFang.ttc','Lingxi CJK');
globalThis.document={createElement(tag){if(tag!=='canvas')throw new Error(tag);return createCanvas(256,256);}};
globalThis.Path2D=Path2D;
const {paintSkin,paintFace,expressions}=await import('../apps/lingxi/src/style-lab/art.ts');
const {refineSkeleton,SOFT_LAYOUT_ID}=await import('../apps/lingxi/src/style-lab/anatomy.ts');
const {faceRects}=await import('../apps/lingxi/src/rig/atlas.ts');
const root=new URL('../',import.meta.url);
const skins=JSON.parse(await readFile(new URL('apps/lingxi/src/style-lab/skins.json',root),'utf8'));
const skeleton=refineSkeleton(JSON.parse(await readFile(new URL('apps/lingxi/src/data/skeleton.json',root),'utf8')));
const output=new URL('assets/characters/lingxi/voxel-style-kit/',root);await mkdir(output,{recursive:true});
const board=createCanvas(1440,1300),ctx=board.getContext('2d');
ctx.fillStyle='#F6F1E8';ctx.fillRect(0,0,1440,1300);
ctx.fillStyle='#594B3F';ctx.font='26px sans-serif';ctx.fillText('LINGXI / THE SOFT COLOUR COLLECTION',56,60);
for(let i=0;i<skins.length;i++){
  const skin=skins[i];const {canvas,layout}=paintSkin(skeleton.nodes,skin);
  await writeFile(new URL(`${skin.id}.png`,output),canvas.toBuffer('image/png'));
  const face=createCanvas(256,256);paintFace(face,skin,expressions['安然']);
  await writeFile(new URL(`${skin.id}-face.png`,output),face.toBuffer('image/png'));
  const manifest={...skin,format:'lingxi-skin',layoutId:SOFT_LAYOUT_ID,texture:{file:`${skin.id}.png`,width:layout.size,height:layout.size,colorSpace:'srgb',filter:'nearest',origin:'top-left'},uv:Object.fromEntries(Object.entries(layout.regions).map(([id,r])=>[id,faceRects(r)])),face:{file:`${skin.id}-face.png`,width:256,height:256,state:expressions['安然'],attachTo:'head',forward:'+Z'}};
  await writeFile(new URL(`${skin.id}.json`,output),JSON.stringify(manifest,null,2)+'\n');
  const x=40+(i%3)*464,y=94+Math.floor(i/3)*390;
  ctx.fillStyle='#FFFCF7';ctx.beginPath();ctx.roundRect(x,y,432,365,24);ctx.fill();
  // Stylized swatch portrait: illustration of the face design, not a 3D render.
  ctx.fillStyle=skin.materials.fur;ctx.beginPath();ctx.roundRect(x+126,y+70,180,175,12);ctx.fill();
  for(const ex of [x+126,x+266]){ctx.beginPath();ctx.moveTo(ex,y+84);ctx.lineTo(ex+8,y+30);ctx.lineTo(ex+40,y+80);ctx.fill();}
  ctx.drawImage(face,x+126,y+70,180,175);
  ctx.fillStyle='#594B3F';ctx.font='23px Lingxi CJK';ctx.fillText(skin.name,x+28,y+291);
  ctx.font='15px sans-serif';ctx.fillStyle='#978474';ctx.fillText(skin.id,x+28,y+321);
  ['fur','pattern','cream','iris'].forEach((k,j)=>{ctx.fillStyle=skin.materials[k];ctx.beginPath();ctx.arc(x+300+j*26,y+302,10,0,Math.PI*2);ctx.fill();});
}
await writeFile(new URL('collection.png',output),board.toBuffer('image/png'));
await writeFile(new URL('expressions.json',output),JSON.stringify({schemaVersion:1,presets:expressions},null,2)+'\n');
console.log(fileURLToPath(output));console.log(`Exported ${skins.length} skin PNGs + ${skins.length} face PNGs + manifests + collection board.`);
