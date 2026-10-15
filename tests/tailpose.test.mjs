import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Timeline,compileClip,boneLookup,FPS} from '../src/timeline.js';
import {createGuide,addGuideChain} from '../src/autorig.js';
import {tailPoseQuaternion,tailWagQuaternion,tailWagFrames} from '../src/tailpose.js';

const approx=(a,b,epsilon=1e-5)=>Math.abs(a-b)<epsilon;

test('tail pose rotates tail bone without altering original quaternion or body',()=>{
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const chain=addGuideChain(guide,'tail',5);
  const bone=guide.bones.get(chain.names[0]);
  const hip=guide.bones.get('mixamorigHips');
  const hipBefore=hip.quaternion.clone(),before=bone.quaternion.clone();
  const left=tailPoseQuaternion(before,0,5,38,12);
  const right=tailPoseQuaternion(before,0,5,-38,12);
  assert.ok(left.angleTo(right)>.2);
  assert.ok(before.equals(bone.quaternion),'preview calculation may not mutate fitted rig');
  assert.ok(hipBefore.equals(hip.quaternion),'hips must not be modified');
  const tip=tailPoseQuaternion(before,4,5,38,12);
  assert.ok(tip.angleTo(before)<left.angleTo(before),'distal joint uses smaller bend');
});

test('tail wag generates smooth loop and never requires mesh skin recalculation',()=>{
  const base=new THREE.Quaternion();
  const frames=tailWagFrames(90);
  assert.equal(frames[0],0);assert.equal(frames.at(-1),90);
  assert.ok(frames.length>10);
  for(let i=0;i<5;i++){
    const start=tailWagQuaternion(base,i,0,90,{side:10,lift:8});
    const end=tailWagQuaternion(base,i,90,90,{side:10,lift:8});
    assert.ok(approx(start.angleTo(end),0,1e-6),'loop must have seamless end');
  }
});

test('baked tail motion is compilable to animation tracks without torso keys',()=>{
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const chain=addGuideChain(guide,'tail',5);
  const bones=chain.names.map(name=>guide.bones.get(name));
  const timeline=new Timeline();
  for(const frame of tailWagFrames(90)){
    bones.forEach((bone,i)=>timeline.set(bone,frame,tailWagQuaternion(bone.quaternion,i,frame,90),90));
  }
  const clip=compileClip({name:'Tail wag',durationFrames:90,sourceClip:null,timeline,lookup:boneLookup([...guide.bones.values()]),
    sample:(frame,bs)=>new Map(bs.map(b=>[b.uuid,timeline.pose(b,frame,b.quaternion,false)]))
  });
  assert.equal(clip.tracks.length,5);
  assert.ok(clip.tracks.every(track=>track.name.endsWith('.quaternion')));
  assert.ok(clip.tracks.every(track=>track.times.length===91));
  assert.ok(clip.duration>=90/FPS);
  assert.equal(timeline.forBone(guide.bones.get('mixamorigHips')).size,0);
});
