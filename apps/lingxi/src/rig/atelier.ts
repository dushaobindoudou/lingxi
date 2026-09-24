import type { NodeSpec } from './skeleton.ts';
import { faceRects, type AtlasLayout } from './atlas.ts';

/** Deliberately authored anatomical zones, packed into ONE PNG; not one image tiled on all boxes. */
export function paintAtelier(ctx:CanvasRenderingContext2D,nodes:NodeSpec[],layout:AtlasLayout,c:Record<string,string>,style:string){
  const calico=style==='atelier-calico';
  const formal=style==='atelier-formal';
  for(const node of nodes){
    const id=node.id,r=layout.regions[id];
    for(const [face,[x,y,w,h]] of Object.entries(faceRects(r))){
      ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.translate(x,y);ctx.scale(w,h);
      const rect=(a:number,b:number,sw:number,sh:number,col:string)=>{ctx.fillStyle=col;ctx.fillRect(a,b,sw,sh);};
      const path=(points:number[][],col:string)=>{ctx.beginPath();points.forEach(([a,b],i)=>i?ctx.lineTo(a,b):ctx.moveTo(a,b));ctx.closePath();ctx.fillStyle=col;ctx.fill();};

      if(formal){
        // A formal human-inspired silhouette: dark jacket/hair, a pale shirt and trousers,
        // and black leather shoes. The face decal supplies the human face; these painted zones
        // keep the shared voxel rig coherent even though it is still animated by the cat engine.
        rect(0,0,1,1,c.fur);
        if(/^head$/.test(id)){
          if(face==='py')rect(0,0,1,1,c.fur);
          if(face==='pz')rect(0,0,1,1,c.fur);
        }else if(/^(hipC|spine[123])$/.test(id)){
          if(face==='pz'){
            path([[.08,.04],[.38,.04],[.49,.23],[.38,.54],[.08,.35]],c.accent);
            path([[.92,.04],[.62,.04],[.51,.23],[.62,.54],[.92,.35]],c.accent);
            path([[.39,.10],[.61,.10],[.69,.92],[.31,.92]],c.cream);
            path([[.39,.10],[.50,.27],[.61,.10],[.58,.43],[.50,.56],[.42,.43]],c.paw);
          }
          if(face==='ny')rect(0,0,1,1,c.fur);
        }else if(/^neck/.test(id)){
          if(face==='pz')rect(.18,.30,.64,.70,c.cream);
        }else if(/^ear/.test(id)){
          if(face==='pz')path([[.18,.88],[.32,.15],[.68,.15],[.82,.88]],c.nose);
        }else if(/^(scap|upperF|lowerF)/.test(id)){
          if(face==='pz')rect(.08,.08,.84,.84,c.accent);
        }else if(/^(thigh|shin)/.test(id)){
          rect(0,0,1,1,c.cream);
          if(face==='pz')rect(.08,.06,.14,.88,c.paw);
        }else if(/^(foot|pawB)/.test(id)){
          rect(0,0,1,1,c.pattern);
          if(face==='pz')rect(.08,.10,.84,.18,c.accent);
        }else if(/^tail/.test(id)){
          rect(0,0,1,1,c.fur);
        }else if(/^pawF/.test(id)){
          rect(0,0,1,1,c.paw);
        }
        ctx.restore();
        continue;
      }

      rect(0,0,1,1,c.fur);
      if(/^head$/.test(id)){
        if(calico){
          if(face==='px'||face==='py')rect(0,0,1,1,c.accent);
          if(face==='nx')rect(0,0,1,1,c.pattern);
          if(face==='pz'){
            path([[0,0],[.39,0],[.37,.28],[.24,.5],[0,.46]],c.accent);
            path([[.64,0],[1,0],[1,.6],[.85,.55],[.69,.26]],c.pattern);
          }
        }else{
          if(face==='py')for(const u of [.23,.45,.67])rect(u,.05,.08,.78,c.pattern);
          if(face==='pz'){
            // Forehead M, eyes remain on an uncluttered field below it.
            path([[.25,0],[.34,0],[.4,.2],[.49,.07],[.58,.21],[.66,0],[.75,0],[.63,.31],[.49,.19],[.36,.31]],c.pattern);
            for(const u of [0,.85]){rect(u,.43,.15,.04,c.accent);rect(u,.55,.15,.035,c.pattern);}
          }
          if(face==='px'||face==='nx')for(const v of [.38,.57,.75])path([[0,v],[.58,v+.07],[.64,v+.11],[0,v+.06]],c.pattern);
        }
        if(face==='pz')path([[.26,.77],[.4,.68],[.6,.68],[.74,.77],[.69,1],[.31,1]],c.cream);
      }else if(/^ear/.test(id)){
        rect(0,0,1,1,calico?(id==='earL'?c.pattern:c.accent):c.pattern);
        if(face==='pz')path([[.18,.88],[.32,.15],[.68,.15],[.82,.88]],c.nose);
      }else if(/^(spine|hipC|neck)/.test(id)){
        if(face==='ny')rect(0,0,1,1,c.cream);
        if(face==='px'||face==='nx'){
          rect(0,.70,1,.30,c.cream);
          if(calico){
            if((id==='spine2'&&face==='px')||(id==='hipC'&&face==='nx'))path([[.1,0],[.95,0],[.94,.38],[.77,.58],[.35,.63],[.1,.36]],c.accent);
            if(id==='spine3'&&face==='nx')path([[.04,.06],[.8,0],[1,.35],[.76,.63],[.23,.54]],c.pattern);
          }else{
            for(const a of [.12,.55])path([[a,0],[a+.1,0],[a+.18,.32],[a+.1,.53],[a+.04,.35]],c.pattern);
          }
        }
        if(face==='py'){
          if(calico)rect(0,0,1,1,id==='spine3'?c.pattern:c.accent);
          else rect(.40,0,.2,1,c.pattern);
        }
        if(/^neck/.test(id)&&face==='pz')rect(.12,.45,.76,.55,c.cream);
      }else if(/^tail/.test(id)){
        const i=Number(id.slice(4));
        const base=calico?c.accent:c.fur;rect(0,0,1,1,i===6?c.pattern:base);
        if(i!==6){
          if(face==='px'||face==='nx'||face==='py'||face==='ny')rect(.4,0,.22,1,c.pattern);
        }
      }else if(/^(paw|foot|lower)/.test(id)){
        if(/^paw/.test(id)){
          rect(0,0,1,1,c.cream);
          if(face==='ny'){rect(.28,.38,.44,.40,c.nose);for(const u of [.13,.4,.67])rect(u,.12,.18,.18,c.nose);}
          if(face==='pz')for(const u of [.30,.66])rect(u,.58,.035,.18,c.accent);
        }else{rect(0,.55,1,.45,c.cream);if(!calico)rect(0,.16,1,.09,c.accent);}
      }else if(/^(upper|thigh|shin|scap)/.test(id)){
        if(calico){if(id.endsWith('L'))rect(0,0,1,.48,c.accent);}
        else for(const v of [.2,.48])rect(0,v,1,.075,c.pattern);
      }else rect(0,0,1,1,c[node.slot]??c.fur);
      ctx.restore();
    }
  }
}
