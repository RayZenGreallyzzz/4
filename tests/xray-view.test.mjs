import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {XRayView} from '../src/xray-view.js';

test('x-ray uses material clones and restores original surfaces',()=>{
 const material=new THREE.MeshStandardMaterial({color:0xffaa00});
 const root=new THREE.Group();
 const a=new THREE.Mesh(new THREE.BoxGeometry(),material);
 const b=new THREE.Mesh(new THREE.BoxGeometry(),material);
 root.add(a,b);
 const xray=new XRayView();
 xray.setRoot(root);xray.setEnabled(true);
 assert.notEqual(a.material,material);
 assert.equal(a.material,b.material,'shared materials remain shared');
 assert.equal(a.material.transparent,true);
 assert.equal(a.material.depthWrite,false);
 xray.setOpacity(20);
 assert.ok(Math.abs(a.material.opacity-.2)<1e-8);
 xray.setEnabled(false);
 assert.equal(a.material,material);
 assert.equal(b.material,material);
 assert.equal(material.transparent,false);
 xray.setRoot(null);
 a.geometry.dispose();b.geometry.dispose();material.dispose();
});
