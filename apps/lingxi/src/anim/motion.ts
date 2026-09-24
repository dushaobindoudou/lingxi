/**
 * How a track moves between its keys.
 *
 *   smooth     (default) smoothstep: zero velocity at both ends of every segment. Right for a
 *              pose settling into place - a head turn, a rear-up, a crouch.
 *   linear     constant velocity. Right for a sweep that should not ease.
 *   ballistic  a real parabola: the segment that RISES decelerates to zero at its top, the
 *              segment that FALLS accelerates from zero. Right for anything leaving the floor.
 *
 * `ballistic` exists because smoothstep gets a jump exactly backwards. Under smoothstep the cat
 * leaves the ground at zero vertical speed, speeds up in mid-air, stops dead at the apex and is
 * lowered back down - it reads as being lifted on a string, which is what it is. Every airborne
 * clip in the built-in library was authored that way, and the implied gravity of the worst of
 * them was about a tenth of Earth's.
 */
export type MotionInterp = 'smooth' | 'linear' | 'ballistic';

/** Sample rest-relative action offsets. Caller applies them after its base pose each frame. */
export interface MotionTrack { channel:string; keys:number[][]; interp?:MotionInterp }
export interface Motion { id:string; name:string; duration:number; priority:number; expression:string; tracks:MotionTrack[]; category?:string; description?:string }
export function sampleMotion(motion:Motion, elapsed:number): Record<string,number> {
  const result:Record<string,number>={};
  const time=Math.min(motion.duration,Math.max(0,elapsed));
  for(const track of motion.tracks){
    const keys=track.keys;
    if(!keys.length)continue;
    let value=keys[keys.length-1][1];
    if(time<=keys[0][0])value=keys[0][1];
    else for(let i=1;i<keys.length;i++)if(time<=keys[i][0]){
      const [t0,v0]=keys[i-1], [t1,v1]=keys[i];
      const u=(time-t0)/(t1-t0);
      // Ballistic: ease-out on the way up (fast off the floor, stopped at the apex) and ease-in
      // on the way down. Those are the two halves of one parabola, so a rise key followed by a
      // fall key of equal duration traces a genuine ballistic arc through the apex - and the
      // implied gravity is then 2*height/riseTime^2, which is a number an author can check.
      const e = track.interp==='linear' ? u
        : track.interp==='ballistic' ? (v1>=v0 ? u*(2-u) : u*u)
        : u*u*(3-2*u);
      value=v0+(v1-v0)*e;break;
    }
    result[track.channel]=value;
  }
  return result;
}

/** External clips are data only; supported channels are explicitly enumerated. */
export function parseMotions(value:unknown,nodeIds:readonly string[],expressionNames:readonly string[],poseNames:readonly string[]):Motion[]{
  if(!value||typeof value!=='object')throw new Error('动作 JSON 必须是对象');
  const data=value as {schemaVersion?:unknown;actions?:unknown};
  if(![1,2].includes(Number(data.schemaVersion))||!Array.isArray(data.actions)||data.actions.length<1||data.actions.length>100)throw new Error('动作库需要 schemaVersion 1/2，以及 1–100 个动作');
  const nodes=new Set([...nodeIds,'root']);const ids=new Set<string>();
  return data.actions.map(raw=>{
    const m=raw as Motion;
    if(!m||typeof m.id!=='string'||!/^[-a-z0-9]{1,60}$/.test(m.id)||ids.has(m.id)||typeof m.name!=='string'||m.name.length>40)throw new Error('动作 ID 重复或名称不合法');
    ids.add(m.id);
    if(!Number.isFinite(m.duration)||m.duration<.2||m.duration>30||!Number.isFinite(m.priority)||m.priority<0||m.priority>100||!expressionNames.includes(m.expression))throw new Error(`${m.id} 时长、优先级或表情不合法`);
    if(!Array.isArray(m.tracks)||m.tracks.length>100)throw new Error(`${m.id} tracks 不合法`);
    const channels=new Set<string>();
    for(const track of m.tracks){
      if(!track||typeof track.channel!=='string'||channels.has(track.channel))throw new Error(`${m.id} 通道重复或无效`);
      channels.add(track.channel);
      const [id,kind,axis,...extra]=track.channel.split('.');
      const special=['face.blink','face.tongue','face.open','groom.paw','groom.wash'].includes(track.channel)||(id==='pose'&&poseNames.includes(kind)&&axis===undefined);
      if(!special&&(!nodes.has(id)||!['rotation','position'].includes(kind)||!['x','y','z'].includes(axis)||extra.length))throw new Error(`不支持动作通道 ${track.channel}`);
      if(track.interp!==undefined&&!['smooth','linear','ballistic'].includes(track.interp))throw new Error(`${m.id} 的 ${track.channel} 插值方式只能是 smooth / linear / ballistic`);
      if(!Array.isArray(track.keys)||track.keys.length<2||track.keys.length>128)throw new Error('每条轨道需 2–128 个关键帧');
      let previous=-1;
      for(const key of track.keys){
        if(!Array.isArray(key)||key.length!==2||!key.every(Number.isFinite)||key[0]<=previous||key[0]<0||key[0]>m.duration||Math.abs(key[1])>(special?1:kind==='rotation'?Math.PI*2:10)||(special&&key[1]<0))throw new Error(`${m.id} 关键帧时间或数值超出范围`);
        previous=key[0];
      }
      if(track.keys[0][0]!==0||track.keys[track.keys.length-1][0]!==m.duration||track.keys[0][1]!==0||track.keys[track.keys.length-1][1]!==0)throw new Error(`${m.id} 轨道必须从 0 开始，在 duration 结束并归零`);
    }
    return structuredClone(m);
  });
}
