import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {rotationLimits,relativeBoneEuler,editedBoneQuaternion} from '../src/joint-rotation.js';
const deg=THREE.MathUtils.degToRad;
test('manual rotation zero means actual bind pose, including nonidentity bind',()=>{
 const bind=new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(25),deg(-15),deg(20)));
 const updated=editedBoneQuaternion(bind,bind,'x',0,'mixamorigHead');
 assert.ok(updated.angleTo(bind)<1e-7);
});
test('stage3 clamps unsafe chest pitch from video but allows advanced mode',()=>{
 const rest=new THREE.Quaternion();
 const before=rest.clone();
 const safe=editedBoneQuaternion(before,rest,'x',138,'mixamorigSpine2');
 assert.ok(Math.abs(THREE.MathUtils.radToDeg(relativeBoneEuler(safe,rest).x)-35)<.01);
 const free=editedBoneQuaternion(before,rest,'x',138,'mixamorigSpine2',false);
 assert.ok(Math.abs(THREE.MathUtils.radToDeg(relativeBoneEuler(free,rest).x)-138)<.01);
});
test('neck/head and other bones use independent limits',()=>{
 assert.equal(rotationLimits('mixamorigHead').y,60);
 assert.equal(rotationLimits('mixamorigNeck').x,30);
 assert.equal(rotationLimits('mixamorigLeftForeArm').x,180);
});
