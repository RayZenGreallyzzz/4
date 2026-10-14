import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Timeline, FPS, boneLookup, boneForTrack, compileClip } from '../src/timeline.js';
const bone = new THREE.Bone(); bone.name = 'mixamorigRightArm';
const pose = radians => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, radians));

test('30 fps timeline and quaternion interpolation', () => {
  assert.equal(FPS, 30);
  const timeline = new Timeline();
  timeline.set(bone, 0, pose(0));
  timeline.set(bone, 30, pose(1));
  assert.equal(timeline.count, 2);
  assert.ok(timeline.pose(bone, 15, pose(0)).angleTo(pose(.5)) < 0.001);
  timeline.delete(bone, 30);
  assert.equal(timeline.count, 1);
  timeline.clear();
  assert.equal(timeline.count, 0);
});
test('source animation is preserved away from a single edited key', () => {
  const timeline = new Timeline();
  timeline.set(bone, 15, pose(1));
  assert.ok(timeline.pose(bone, 0, pose(.3), true).angleTo(pose(.3)) < 0.001);
  assert.ok(timeline.pose(bone, 15, pose(.3), true).angleTo(pose(1)) < 0.001);
  assert.ok(timeline.pose(bone, 25, pose(.3), true).angleTo(pose(.3)) < 0.001);
});
test('export replaces only touched bone, keeps other tracks', () => {
  const other = new THREE.Bone(); other.name = 'mixamorigLeftArm';
  const lookup = boneLookup([bone, other]);
  const trackA = new THREE.QuaternionKeyframeTrack(bone.uuid + '.quaternion', [0, 1], [0,0,0,1,0,0,0,1]);
  const trackB = new THREE.QuaternionKeyframeTrack(other.uuid + '.quaternion', [0, 1], [0,0,0,1,0,0,0,1]);
  const source = new THREE.AnimationClip('Run', 1, [trackA, trackB]);
  const timeline = new Timeline(); timeline.set(bone, 15, pose(.4));
  const clip = compileClip({name:'Run edited', durationFrames:30, sourceClip:source, timeline, lookup,
    sample: (frame, bones) => new Map(bones.map(b => [b.uuid,timeline.pose(b,frame,pose(0),true)]))});
  assert.equal(clip.tracks.length,2);
  assert.equal(clip.tracks.find(t=>boneForTrack(t,lookup)===bone).times.length,31);
  assert.equal(clip.tracks.find(t=>boneForTrack(t,lookup)===other).times.length,2);
  assert.equal(source.tracks[0].times.length,2);
});