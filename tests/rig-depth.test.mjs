import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {characterDepthAxis,chooseJointSnapPoint,preserveJointDepth} from '../src/rig-depth.js';

test('model-forward depth lock does not depend on camera view',()=>{
 assert.equal(characterDepthAxis('z+'),'z');
 assert.equal(characterDepthAxis('z-'),'z');
 assert.equal(characterDepthAxis('x+'),'x');
 const v = preserveJointDepth(new THREE.Vector3(5,7,9),new THREE.Vector3(1,2,3),'x-');
 assert.deepEqual(v.toArray(),[1,7,9]);
});
test('front and rear of the same limb are centered',()=>{
 const mesh = {}, ray = new THREE.Vector3(0,0,-1);
 const front=[{object:mesh,point:new THREE.Vector3(1,2,1)}];
 const rear=[{object:mesh,point:new THREE.Vector3(1,2,.7)}];
 const result=chooseJointSnapPoint(front,rear,2,'mixamorigLeftForeArm',ray);
 assert.equal(result.method,'midpoint');
 assert.ok(Math.abs(result.point.z-.85)<1e-9);
});
test('ambiguous far rear body part is not treated as arm thickness',()=>{
 const mesh={},ray=new THREE.Vector3(0,0,-1);
 const f=[{object:mesh,point:new THREE.Vector3(0,1,1)}];
 const b=[{object:mesh,point:new THREE.Vector3(0,1,-1)}];
 const result=chooseJointSnapPoint(f,b,2,'mixamorigLeftForeArm',ray);
 assert.equal(result.method,'surface-fallback');
 assert.ok(result.point.z>.9);
});
test('other mesh behind hand is not used as the rear surface',()=>{
 const frontMesh={}, torsoMesh={},ray=new THREE.Vector3(0,0,-1);
 const f=[{object:frontMesh,point:new THREE.Vector3(0,1,1)}];
 const b=[{object:torsoMesh,point:new THREE.Vector3(0,1,.9)}];
 assert.equal(chooseJointSnapPoint(f,b,2,'mixamorigHand',ray).method,'surface-fallback');
});
