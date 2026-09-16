import type { NodeSpec } from './skeleton.ts';

export const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
export type Face = typeof FACE_ORDER[number];
export type PixelRect = [number, number, number, number];
export type MappingMode = 'tile' | 'cover' | 'atlas';
export interface TextureConfig {
  format: 'lingxi-texture';
  schemaVersion: 1;
  rigId: string;
  textureSize: [number, number];
  mapping: { mode: MappingMode; tileSize: number };
  filter: 'nearest' | 'linear';
  /** Optional per-box, per-face overrides in top-left PNG pixels: x, y, width, height. */
  faces: Record<string, Partial<Record<Face, PixelRect>>>;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fail(message: string): never { throw new Error(message); }

/** Validate completely before touching any live mesh/material. No URLs or resource fetching. */
export function parseTextureConfig(value: unknown, nodes: readonly NodeSpec[], rigId: string, width: number, height: number): TextureConfig {
  // Accept the earlier exported skin manifest by using its explicit UV rectangles.
  if(object(value) && value.format==='lingxi-skin' && value.schemaVersion===1 && object(value.texture) && object(value.uv)){
    value={format:'lingxi-texture',schemaVersion:1,rigId:value.rigId,textureSize:[value.texture.width,value.texture.height],mapping:{mode:'cover',tileSize:8},filter:value.texture.filter??'nearest',faces:value.uv};
  }
  if (!object(value) || value.format !== 'lingxi-texture' || value.schemaVersion !== 1) fail('需要 format=lingxi-texture、schemaVersion=1 的贴图配置');
  if (value.rigId !== rigId) fail(`JSON 必须对应骨架 ${rigId}`);
  if (!Array.isArray(value.textureSize) || value.textureSize.length !== 2 || value.textureSize[0] !== width || value.textureSize[1] !== height) fail(`JSON textureSize 必须是 [${width}, ${height}]，与当前 PNG 一致`);
  const mapping = value.mapping;
  if (!object(mapping) || !['tile', 'cover', 'atlas'].includes(String(mapping.mode))) fail('mapping.mode 只能是 tile、cover 或 atlas');
  const tileSize = mapping.tileSize ?? 8;
  if (typeof tileSize !== 'number' || !Number.isFinite(tileSize) || tileSize < .25 || tileSize > 64) fail('tileSize 需要在 0.25–64 之间');
  if (value.filter !== 'nearest' && value.filter !== 'linear') fail('filter 只能是 nearest 或 linear');
  const faces = value.faces ?? {};
  if (!object(faces)) fail('faces 必须是按节点名组织的对象');
  const ids = new Set(nodes.map(n => n.id));
  const result: TextureConfig['faces'] = Object.create(null);
  for (const [id, nodeFaces] of Object.entries(faces)) {
    if (!ids.has(id) || !object(nodeFaces)) fail(`未知节点或无效面配置：${id}`);
    const validated: Partial<Record<Face, PixelRect>> = {};
    for (const [face, rect] of Object.entries(nodeFaces)) {
      if (!FACE_ORDER.includes(face as Face) || !Array.isArray(rect) || rect.length !== 4 || !rect.every(v => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v))) fail(`${id}.${face} 必须是四个整数 [x, y, width, height]`);
      const [x, y, w, h] = rect as number[];
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height) fail(`${id}.${face} 的 UV 矩形超出 PNG 边界`);
      validated[face as Face] = [x, y, w, h];
    }
    result[id] = validated;
  }
  return {
    format: 'lingxi-texture', schemaVersion: 1, rigId, textureSize: [width, height],
    mapping: { mode: mapping.mode as MappingMode, tileSize }, filter: value.filter, faces: result,
  };
}

/** Three.js BoxGeometry face vertex order: top-left, top-right, bottom-left, bottom-right. */
export function mappedUVs(node: NodeSpec, config: TextureConfig, atlasFaces?: Record<Face, PixelRect>): Float32Array {
  const [width, height] = config.textureSize;
  const [sx, sy, sz] = node.box.size;
  const sizes: Record<Face, [number, number]> = { px:[sz,sy], nx:[sz,sy], py:[sx,sz], ny:[sx,sz], pz:[sx,sy], nz:[sx,sy] };
  const values = new Float32Array(48);
  for (const [i, face] of FACE_ORDER.entries()) {
    const [fw, fh] = sizes[face];
    const rect = config.faces[node.id]?.[face] ?? (config.mapping.mode === 'atlas' ? atlasFaces?.[face] : undefined);
    let u0=0, u1=1, v0=1, v1=0;
    if (rect) {
      const [x,y,w,h]=rect;
      // Clamp to texel centres so a separately painted neighboring face cannot bleed in.
      u0=(x+.5)/width; u1=(x+w-.5)/width; v0=1-(y+.5)/height; v1=1-(y+h-.5)/height;
    } else if (config.mapping.mode === 'tile') {
      // Uniform physical texel density: tileSize is one source image's height in rig units.
      u1=fw/(config.mapping.tileSize*width/height); v1=1-fh/config.mapping.tileSize;
    } else if (config.mapping.mode === 'cover') {
      // Centre crop without stretching; each box face receives the source picture.
      const imageAspect=width/height, faceAspect=fw/fh;
      if(imageAspect>faceAspect){const span=faceAspect/imageAspect;u0=(1-span)/2;u1=1-u0;}
      else{const span=imageAspect/faceAspect;v1=(1-span)/2;v0=1-v1;}
    } else fail(`节点 ${node.id} 缺少 atlas UV`);
    values.set([u0,v0,u1,v0,u0,v1,u1,v1],i*8);
  }
  return values;
}

/** Inspect dimensions before decoding, to reject oversized images without a huge GPU upload. */
export function readPngSize(header: Uint8Array): [number,number] {
  if(header.length<24 || header.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10' || new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(8)!==13 || String.fromCharCode(...header.slice(12,16))!=='IHDR') fail('文件不是有效 PNG');
  const view=new DataView(header.buffer,header.byteOffset,header.byteLength);
  const w=view.getUint32(16),h=view.getUint32(20);
  if(w<1||h<1||w>4096||h>4096) fail('PNG 宽高需要在 1–4096 像素之间，长方形也可以');
  return [w,h];
}
