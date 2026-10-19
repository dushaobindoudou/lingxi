import * as THREE from 'three';

/** A desktop jump owns its launch point; baked forward travel would bypass the input keep-out. */
export function stationaryJump(source: THREE.AnimationClip): THREE.AnimationClip {
  const clip = source.clone(); clip.name = 'WandJump';
  for (const track of clip.tracks) {
    if (!(track instanceof THREE.VectorKeyframeTrack) || !/(^|\b)Root\.position$/.test(track.name)) continue;
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = track.values[0]; track.values[i + 2] = track.values[2];
    }
  }
  return clip;
}

/** Hold a fully rolled pose long enough to move from the management button to the cat. */
export function holdBellyPose(source: THREE.AnimationClip, at = 0.95, seconds = 6): THREE.AnimationClip {
  const clip = source.clone(); clip.name = 'PetBelly';
  clip.tracks = source.tracks.map(track => {
    const size = track.getValueSize();
    const sample = Array.from(track.InterpolantFactoryMethodLinear().evaluate(at));
    const times: number[] = [], values: number[] = [];
    for (let i = 0; i < track.times.length; i++) {
      if (track.times[i] >= at) break;
      times.push(track.times[i]); values.push(...track.values.slice(i * size, (i + 1) * size));
    }
    times.push(at, at + seconds); values.push(...sample, ...sample);
    for (let i = 0; i < track.times.length; i++) {
      if (track.times[i] <= at) continue;
      times.push(track.times[i] + seconds); values.push(...track.values.slice(i * size, (i + 1) * size));
    }
    const result = track.clone();
    result.times = new Float32Array(times); result.values = new Float32Array(values);
    return result;
  });
  clip.duration = source.duration + seconds;
  return clip;
}
