import * as THREE from 'three';
import type {Rig,SkeletonData} from '../rig/skeleton.ts';
import {POSES} from './poses.ts';

export function createBodyController(rig:Rig,data:SkeletonData){
  const original=data.nodes.map(n=>({node:rig.node(n.id),position:rig.node(n.id).position.clone(),rotation:rig.node(n.id).rotation.clone()}));
  const meshes:THREE.Mesh[]=[];
  rig.root.traverse(o=>{if(o instanceof THREE.Mesh && o.visible){o.geometry.computeBoundingBox();meshes.push(o);}});
  const box=new THREE.Box3(),part=new THREE.Box3();
  const end=new THREE.Vector3(),jointPos=new THREE.Vector3(),toEnd=new THREE.Vector3(),toTarget=new THREE.Vector3();
  const worldQ=new THREE.Quaternion(),delta=new THREE.Quaternion(),parentQ=new THREE.Quaternion();
  const head=data.nodes.find(n=>n.id==='head')!;
  const startPaw=rig.node('pawFL').getWorldPosition(new THREE.Vector3());
  const target=new THREE.Vector3();
  function solvePaw(weight:number,wash:number){
    if(weight<=0)return;
    rig.root.updateMatrixWorld(true);
    const paw=rig.node('pawFL');
    paw.getWorldPosition(startPaw);
    // The standoff is measured from the FRONT FACE of the head, and it has to clear the paw's
    // own half-depth or the paw ends up inside the skull. It used to be 0.35 against a paw
    // ~3 voxels deep, which put roughly 1.2 voxels of paw inside the head - the grooming clips
    // were the worst offenders in the clip-interpenetration probe for exactly this reason.
    const pawClearance=data.nodes.find(n=>n.id==='pawFL')!.box.size[2]*.5+.35;
    // Lateral offset on BOTH grooming poses, not just the face-wash. Bringing the paw straight
    // up the midline runs the forearm through the chin and the skull (measured 2.6-3.1 voxels);
    // approaching from the paw's own side keeps the elbow outside the head, which is also how a
    // cat actually holds a paw it is licking. pawFL is the front-left paw, and the cat's left
    // is +x.
    target.set(head.box.size[0]*(wash?.24:.34),head.box.offset[1]+(wash?head.box.size[1]*.03:-head.box.size[1]*.32),head.box.offset[2]+head.box.size[2]*.5+pawClearance);
    rig.node('head').localToWorld(target);target.lerpVectors(startPaw,target,weight);
    for(let pass=0;pass<10;pass++)for(const id of ['lowerFL','upperFL','scapL']){
      const joint=rig.node(id);paw.getWorldPosition(end);joint.getWorldPosition(jointPos);
      toEnd.copy(end).sub(jointPos).normalize();toTarget.copy(target).sub(jointPos).normalize();
      delta.setFromUnitVectors(toEnd,toTarget);
      joint.getWorldQuaternion(worldQ);joint.parent!.getWorldQuaternion(parentQ).invert();
      joint.quaternion.copy(parentQ.multiply(delta.multiply(worldQ)));
      joint.rotation.x=THREE.MathUtils.clamp(joint.rotation.x,-2.7,2.7);
      joint.rotation.y=THREE.MathUtils.clamp(joint.rotation.y,-1.2,1.2);
      joint.rotation.z=THREE.MathUtils.clamp(joint.rotation.z,-1.4,1.4);
      rig.root.updateMatrixWorld(true);
    }
    paw.rotation.x=-.7*weight;
  }
  return {
    reset(){rig.root.position.set(0,0,0);rig.root.rotation.set(0,0,0);for(const frame of original){frame.node.position.copy(frame.position);frame.node.rotation.copy(frame.rotation);}},
    apply(offsets:Record<string,number>){
      const expanded={...offsets};
      for(const [channel,weight] of Object.entries(offsets))if(channel.startsWith('pose.'))for(const [target,value] of Object.entries(POSES[channel.slice(5)]??{}))expanded[target]=(expanded[target]??0)+value*weight;
      for(const [channel,value] of Object.entries(expanded)){
        const [id,kind,axis]=channel.split('.');
        if((kind==='rotation'||kind==='position')&&(axis==='x'||axis==='y'||axis==='z')){
          const node=id==='root'?rig.root:rig.node(id);node[kind][axis]+=value;
        }
      }
      solvePaw(offsets['groom.paw']??0,offsets['groom.wash']??0);

      // --- ground contact -----------------------------------------------------------------
      // Measured straight off the posed body again. This used to need the gait subtracted
      // first, because the old rotation-only walk swung its paws below the floor line and the
      // contact rule answered by shoving the whole cat upward - 0.70 voxels of travel per
      // step, all of it inherited by the head. gait.ts removed the cause rather than the
      // symptom: its paws are SOLVED to sit on the floor line through stance, so the lowest
      // point of the body is now genuinely constant while walking and this measurement is
      // stable on its own. (probe-gait.html is the regression check.)
      rig.root.updateMatrixWorld(true);box.makeEmpty();
      for(const mesh of meshes){if(!mesh.visible)continue;part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);box.union(part);}
      // Contact with the floor also applies to rolls and crouches; explicit positive lift = jump.
      if(!box.isEmpty())rig.root.position.y+=-box.min.y+Math.max(0,offsets['root.position.y']??0);
    },
  };
}
