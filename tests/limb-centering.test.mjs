import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,jointWorld,moveJointWorld} from '../src/autorig.js';
import {LIMB_CHAINS,limbNames,axesAtJoint,crossSection,centerJointInMesh} from '../src/limb-centering.js';

test('only arms and lower legs are eligible; protects hip, torso, head',()=>{
 const names=limbNames('all');
 assert.equal(names.length,12);
 assert.ok(!names.some(name=>/Spine|Hips|Head|Neck|UpLeg/.test(name)));
 assert.deepEqual(limbNames('leftLeg'),LIMB_CHAINS.leftLeg);
});
test('closed cylinder cross-section finds its real interior center',()=>{
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,1.2,24),
  new THREE.MeshBasicMaterial({side:THREE.FrontSide}));
 mesh.position.set(.08,.8,-.04);
 mesh.updateWorldMatrix(true,true);
 const q=crossSection(new THREE.Vector3(.19,.8,-.04),
   new THREE.Vector3(1,0,0),[mesh],.45,2);
 assert.ok(q,'cylinder should intersect');
 assert.ok(Math.abs(q.offset+.11)<.015,q.offset);
 assert.equal(mesh.material.side,THREE.FrontSide,'material restored after ray scan');
 mesh.geometry.dispose();mesh.material.dispose();
});
test('centering an offset elbow inside synthetic mesh does not move bones itself',()=>{
 const guide=createGuide(new THREE.Box3(
  new THREE.Vector3(-1,0,-.3),new THREE.Vector3(1,2,.3)));
 const name='mixamorigLeftForeArm',bone=guide.bones.get(name);
 const p=jointWorld(guide,name);
 const shape=new THREE.Mesh(new THREE.SphereGeometry(.10,24,16),
   new THREE.MeshBasicMaterial());
 shape.position.copy(p).add(new THREE.Vector3(0,0,.055));
 shape.updateWorldMatrix(true,true);
 const r=centerJointInMesh(bone,[shape],2);
 assert.ok(['inside','recentered'].includes(r.status),r.reason);
 assert.ok(r.point);
 assert.ok(jointWorld(guide,name).distanceTo(p)<1e-8,'analysis must not move bone');
 shape.geometry.dispose();shape.material.dispose();
});
test('empty/open ray scans are not treated as proven interior',()=>{
 const guide=createGuide(new THREE.Box3(
   new THREE.Vector3(-1,0,-.3),new THREE.Vector3(1,2,.3)));
 const bone=guide.bones.get('mixamorigLeftForeArm');
 assert.equal(centerJointInMesh(bone,[],2).status,'uncertain');
});
