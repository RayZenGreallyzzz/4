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


test('template anchored under off-origin model can be scaled and moved as a whole',()=>{
  const box=new THREE.Box3(new THREE.Vector3(9,4,-3),new THREE.Vector3(11,8,-1));
  const guide=createGuide(box);
  assert.ok(guide.root.position.distanceTo(new THREE.Vector3(10,4,-2))<1e-6);
  const start=jointWorld(guide,'mixamorigHead').clone();
  const rootStart=jointWorld(guide,'__root__').clone();
  guide.root.scale.setScalar(1.25);
  guide.root.updateMatrixWorld(true);
  const scaled=jointWorld(guide,'mixamorigHead').clone();
  assert.ok(Math.abs(scaled.y-rootStart.y-(start.y-rootStart.y)*1.25)<1e-5);
  assert.ok(moveJointWorld(guide,'__root__',rootStart.clone().add(new THREE.Vector3(.4,0,0))));
  assert.ok(Math.abs(jointWorld(guide,'mixamorigHead').x-scaled.x-.4)<1e-5);
  const result=serializeFit(guide,'elf.glb');
  assert.equal(result.rootScale[0],1.25);
  assert.ok(Math.abs(result.rootPosition[0]-10.4)<1e-5);
});


test('extra tail bone chain follows hips, survives fitting and serializes',async()=>{
  const {addGuideChain,removeGuideChain}=await import('../src/autorig.js');
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-.6,0,-.4),new THREE.Vector3(.6,2,.4)));
  const tail=addGuideChain(guide,'tail',5);
  assert.equal(tail.names.length,5);
  assert.equal(guide.bones.size,27);
  assert.equal(guide.bones.get(tail.names[0]).parent,guide.bones.get('mixamorigHips'));
  for(let i=1;i<5;i++)assert.equal(guide.bones.get(tail.names[i]).parent,guide.bones.get(tail.names[i-1]));
  const tip=jointWorld(guide,tail.names[4]).clone();
  const hip=jointWorld(guide,'mixamorigHips');
  moveJointWorld(guide,'mixamorigHips',hip.add(new THREE.Vector3(.13,0,0)));
  assert.ok(Math.abs(jointWorld(guide,tail.names[4]).x-tip.x-.13)<1e-5);
  const serialized=serializeFit(guide,'cat.glb');
  assert.equal(serialized.chains[0].id,'Tail');
  assert.equal(serialized.chains[0].bones.length,5);
  assert.equal(serialized.boundToMesh,false);
  assert.ok(removeGuideChain(guide,tail.id));
  assert.equal(guide.bones.size,22);
  assert.equal(guide.chains.length,0);
});

test('two separate chains have unique names and can be removed independently', async()=>{
  const {addGuideChain,removeGuideChain}=await import('../src/autorig.js');
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const a=addGuideChain(guide,'tail',3);
  const b=addGuideChain(guide,'tail',4);
  assert.notEqual(a.id,b.id);
  assert.equal(guide.bones.size,29);
  assert.ok(removeGuideChain(guide,a.id));
  assert.equal(guide.bones.size,26);
  assert.deepEqual(guide.chains.map(x=>x.id),[b.id]);
  assert.throws(()=>addGuideChain(guide,'tail',13),/от 2 до 12/);
  assert.throws(()=>addGuideChain(guide,'unrecognized',5),/Неизвестный/);
});

test('extra ears/wing chain attaches to requested parent', async()=>{
  const {addGuideChain}=await import('../src/autorig.js');
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-.5),new THREE.Vector3(1,2,.5)));
  const ear=addGuideChain(guide,'earLeft',2);
  const wing=addGuideChain(guide,'wingRight',6);
  assert.equal(guide.bones.get(ear.names[0]).parent.name,'mixamorigHead');
  assert.equal(guide.bones.get(wing.names[0]).parent.name,'mixamorigSpine2');
  assert.equal(serializeFit(guide,'a.glb').joints.length,30);
});
