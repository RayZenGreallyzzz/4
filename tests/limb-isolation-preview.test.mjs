import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LimbIsolationPreview} from '../src/limb-isolation-preview.js';

const bones=()=>['mixamorigLeftForeArm','mixamorigRightForeArm',
'mixamorigLeftLeg','mixamorigRightLeg','mixamorigHead'].map(name=>{
 const bone=new THREE.Bone();bone.name=name;return bone;
});
test('test animation moves one limb without touching opposite side or head',()=>{
 const rig=bones(),testRig=new LimbIsolationPreview();
 assert.equal(testRig.start(rig,'all'),true);
 const initial=rig.map(b=>b.quaternion.clone());
 const active=testRig.update(.625);
 assert.equal(active,'Левое предплечье');
 assert.ok(rig[0].quaternion.angleTo(initial[0])>.1);
 for(const bone of rig.slice(1))assert.equal(bone.quaternion.angleTo(initial[rig.indexOf(bone)]),0);
 testRig.update(2.5);
 assert.equal(rig[0].quaternion.angleTo(initial[0]),0);
 testRig.stop();
 for(let i=0;i<rig.length;i++)assert.equal(rig[i].quaternion.angleTo(initial[i]),0);
});
test('missing rig does not start and source quaternions survive cancellation',()=>{
 const tool=new LimbIsolationPreview(),rig=bones();
 assert.equal(tool.start([], 'leftArm'),false);
 assert.equal(tool.start(rig,'rightLeg'),true);
 tool.update(.25);tool.stop();
 assert.equal(rig[3].quaternion.angleTo(new THREE.Quaternion()),0);
});
