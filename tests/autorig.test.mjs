import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {JOINTS,createGuide,guessPositions,jointWorld,moveJointWorld,serializeFit} from '../src/autorig.js';

test('template contains coherent named Mixamo-style A-stance humanoid hierarchy',()=>{
  const box=new THREE.Box3(new THREE.Vector3(-.6,0,-.22),new THREE.Vector3(.6,2,.22));
  const guide=createGuide(box);
  assert.equal(guide.bones.size,22);
  assert.ok(guide.bones.has('mixamorigRightForeArm'));
  assert.equal(guide.bones.get('mixamorigLeftHand').parent.name,'mixamorigLeftForeArm');
  const head=jointWorld(guide,'mixamorigHead');
  const foot=jointWorld(guide,'mixamorigLeftFoot');
  assert.ok(head.y>foot.y);
  assert.ok(jointWorld(guide,'mixamorigLeftHand').x>jointWorld(guide,'mixamorigRightHand').x);
  assert.equal(JOINTS.length,22);
});

test('moving one joint preserves hierarchy and shifts children with it',()=>{
  const box=new THREE.Box3(new THREE.Vector3(5,1,2),new THREE.Vector3(6,3,3));
  const guide=createGuide(box);
  const before=jointWorld(guide,'mixamorigRightHand').clone();
  const elbow=jointWorld(guide,'mixamorigRightForeArm');
  moveJointWorld(guide,'mixamorigRightForeArm',elbow.clone().add(new THREE.Vector3(.2,.1,0)));
  const after=jointWorld(guide,'mixamorigRightHand');
  assert.ok(after.distanceTo(before.clone().add(new THREE.Vector3(.2,.1,0)))<1e-6);
});

test('guide serialization clearly indicates no mesh binding and retains coordinates',()=>{
  const box=new THREE.Box3(new THREE.Vector3(-1,-2,-1),new THREE.Vector3(1,2,1));
  const guide=createGuide(box);
  const data=serializeFit(guide,'unrigged.glb');
  assert.equal(data.skinWeights,false);
  assert.equal(data.boundToMesh,false);
  assert.equal(data.joints.length,22);
  assert.deepEqual(data.joints.find(x=>x.name==='mixamorigHips').worldPosition,
    jointWorld(guide,'mixamorigHips').toArray());
});

test('empty model bounds are rejected',()=>{
  assert.throws(()=>guessPositions(new THREE.Box3()),/размеров/);
});
