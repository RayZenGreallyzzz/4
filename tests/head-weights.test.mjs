import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {skullInfluence,reinforceSkullVertex,locateHeadRegion} from '../src/head-weights.js';
const neck=new THREE.Vector3(0,1.7,0);
const head=new THREE.Vector3(0,1.82,0);
test('facial skull points become rigid, neck transition stays soft',()=>{
  assert.ok(skullInfluence(new THREE.Vector3(.07,1.83,.11),neck,head,2)>.95);
  assert.equal(skullInfluence(new THREE.Vector3(0,1.65,0),neck,head,2),0);
  const transition=skullInfluence(new THREE.Vector3(0,1.738,0),neck,head,2);
  assert.ok(transition>0&&transition<1,transition);
});
test('raised hand far from skull centre is not reweighted',()=>{
 const indices=new Uint16Array([3,4,1,2]),weights=new Float32Array([.75,.15,.08,.02]);
 const original=Array.from(indices);
 const changed=reinforceSkullVertex(new THREE.Vector3(.05,1.84,.11),indices,weights,0,1,2,neck,head,2);
 assert.equal(changed,false);assert.deepEqual(Array.from(indices),original);
});
test('true face with head/neck influences cannot deform into chest',()=>{
 const ids=new Uint16Array([1,2,0,3]),weights=new Float32Array([.4,.35,.15,.1]);
 const updated=reinforceSkullVertex(new THREE.Vector3(0,1.85,.03),ids,weights,0,1,2,neck,head,2);
 assert.equal(updated,true);assert.equal(ids[0],1);
 assert.ok(weights[0]>.99);
 assert.equal(weights[2],0);assert.equal(weights[3],0);
});
test('head without neck bones never guesses foreign joint IDs',()=>{
 const bones=[new THREE.Bone()];bones[0].name='mixamorigHead';
 assert.equal(locateHeadRegion(bones,2),null);
});
