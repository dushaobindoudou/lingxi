import type { SkeletonData } from './skeleton.ts';

/** Same joint topology, authored proportions for a compact companion. UV gets a new layout ID. */
export const SOFT_LAYOUT_ID='lingxi-cat-v1-soft-body-4tpu-v2';
export function refineSkeleton(input:SkeletonData):SkeletonData {
  const data=structuredClone(input);
  for(const node of data.nodes){
    const id=node.id;
    if(/^spine[123]$/.test(id)){
      // Overlap at bending joints; the pivot spacing stays independent of the visible shell.
      node.box.size[2]*=1.12;node.box.size[0]*=1.04;
    }
    if(id==='hipC'){node.box.size[0]*=1.08;node.box.size[2]*=1.08;}
    if(/^neck/.test(id)){
      node.box.size[0]*=1.16;node.box.size[2]*=1.25;
      node.pivot[2]*=.72;node.pivot[1]*=.7;
    }
    if(id==='head'){node.pivot[2]*=.72;node.pivot[1]*=.8;}
    if(/^scap/.test(id)){node.box.size[0]*=1.1;node.box.size[2]*=1.3;}
    // Shorter limbs; child anchors and segment lengths scale together, not just the meshes.
    if(/^(upper|lower|thigh|shin|foot|paw)/.test(id)){
      node.pivot[1]*=.88;node.box.offset[1]*=.88;node.box.size[1]*=.88;
      if(node.segmentLength)node.segmentLength*=.88;
      if(!/^paw/.test(id))node.box.size[1]*=1.1;
    }
    if(/^tail/.test(id)){
      if(id!=='tail0')node.pivot[2]*=.78;
      node.box.offset[2]*=.78;node.box.size[2]=node.box.size[2]*.78+.24;
      if(node.segmentLength)node.segmentLength*=.78;
      node.box.size[0]*=1.08;node.box.size[1]*=1.08;
    }
  }
  const tail=[.75,.26,.08,-.08,-.23,-.34,-.38];
  tail.forEach((angle,i)=>{data.restPose[`tail${i}`]=[angle,0,0];});
  return data;
}
