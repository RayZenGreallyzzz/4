import * as THREE from 'three';

export const FPS = 30;
export const MAX_FRAMES = 1200;
export const clampFrame = (value, duration = MAX_FRAMES) =>
  Math.max(0, Math.min(duration, Math.round(Number(value) || 0)));

export function boneLookup(bones) {
  const lookup = new Map();
  for (const bone of bones) {
    if (bone.name && !lookup.has(bone.name)) lookup.set(bone.name, bone);
    lookup.set(bone.uuid, bone);
  }
  return lookup;
}

export function boneForTrack(track, lookup) {
  let binding;
  try { binding = THREE.PropertyBinding.parseTrackName(track.name); }
  catch { return null; }
  if (binding.propertyName !== 'quaternion') return null;
  return lookup.get(binding.objectIndex || binding.nodeName) || null;
}

export class Timeline {
  constructor() { this.keys = new Map(); }
  forBone(bone) { return this.keys.get(bone?.uuid)?.frames || new Map(); }
  get count() { return [...this.keys.values()].reduce((n, entry) => n + entry.frames.size, 0); }
  has(bone, frame) { return this.forBone(bone).has(frame); }
  set(bone, frame, quaternion, limit = MAX_FRAMES) {
    if (!bone?.isBone) return;
    if (!this.keys.has(bone.uuid)) this.keys.set(bone.uuid, { bone, frames: new Map() });
    this.keys.get(bone.uuid).frames.set(clampFrame(frame, limit), quaternion.clone().normalize());
  }
  delete(bone, frame) {
    const entry = this.keys.get(bone?.uuid);
    if (!entry) return;
    entry.frames.delete(frame);
    if (!entry.frames.size) this.keys.delete(bone.uuid);
  }
  clear() { this.keys.clear(); }
  framesFor(bone) { return [...this.forBone(bone).keys()].sort((a, b) => a - b); }
  allFrames() { return [...new Set([...this.keys.values()].flatMap(v => [...v.frames.keys()]))].sort((a, b) => a - b); }

  // Interpolate manually placed keys. With an imported source animation,
  // a lone edited key affects the immediate neighborhood only, not the
  // whole clip. With a new animation, poses are held at the ends.
  pose(bone, frame, baseline, source = false) {
    const frames = this.framesFor(bone);
    if (!frames.length) return baseline.clone();
    const keys = this.forBone(bone);
    const first = frames[0], last = frames[frames.length - 1];
    if (!source) {
      if (frame <= first) return keys.get(first).clone();
      if (frame >= last) return keys.get(last).clone();
    } else {
      const blend = 3;
      if (frame < first) {
        if (frame <= first - blend) return baseline.clone();
        return baseline.clone().slerp(keys.get(first), (frame - (first - blend)) / blend);
      }
      if (frame > last) {
        if (frame >= last + blend) return baseline.clone();
        return keys.get(last).clone().slerp(baseline, (frame - last) / blend);
      }
    }
    const end = frames.findIndex(f => f >= frame);
    if (end <= 0) return keys.get(first).clone();
    const right = frames[end];
    if (right === frame) return keys.get(right).clone();
    const left = frames[end - 1];
    return keys.get(left).clone().slerp(keys.get(right), (frame - left) / (right - left)).normalize();
  }
}

export function compileClip({ name, durationFrames, sourceClip, timeline, lookup, sample }) {
  const frames = clampFrame(durationFrames);
  const tracks = sourceClip ? sourceClip.tracks.filter(track => {
    const bone = boneForTrack(track, lookup);
    return !(bone && timeline.keys.has(bone.uuid));
  }).map(track => track.clone()) : [];
  const entries = [...timeline.keys.values()];
  if (entries.length) {
    const arrays = entries.map(() => []);
    const times = [];
    // The single sample call per frame updates the source animation ONCE,
    // regardless of the number of bones being edited.
    for (let frame = 0; frame <= frames; frame++) {
      times.push(frame / FPS);
      const poses = sample(frame, entries.map(entry => entry.bone));
      entries.forEach(({ bone }, index) => {
        const q = poses.get(bone.uuid);
        if (!q) throw new Error('Отсутствует поза кости: ' + bone.name);
        arrays[index].push(q.x, q.y, q.z, q.w);
      });
    }
    entries.forEach(({ bone }, index) => {
      tracks.push(new THREE.QuaternionKeyframeTrack(bone.uuid + '.quaternion', times, arrays[index]));
    });
  }
  return new THREE.AnimationClip(name || 'New Animation', frames / FPS, tracks);
}