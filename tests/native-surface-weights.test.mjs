import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {toBase64,fromBase64,bytesOf,buildTriangleEdges,
 prepareLimbMesh,solveNativeSurface} from '../src/native-surface-weights.js';

const point=(x,y=1,z=0)=>new THREE.Vector3(x,y,z);
const s=(index,a,b)=>({index,a:point(a),b:point(b)});
const context={
 groups:{
  leftArm:[s(0,.2,.4),s(1,.4,.6),s(2,.6,.75)],
  rightArm:[s(3,-.2,-.4),s(4,-.4,-.6),s(5,-.6,-.75)]
 },
 order:['leftArm','rightArm'],central:[point(0)],h:2
};
function meshFixture(){
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute([
 .45,1,0, .55,1,0, .64,1,.02, -0.5,1,0
 ],3));
 geo.setIndex([0,1,2,0,2,3]);
 geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([
 3,4,5,0, 3,4,5,0, 3,4,5,0, 3,4,5,0
 ],4));
 geo.setAttribute('skinWeight',new THREE.Uint8BufferAttribute([
 255,0,0,0, 255,0,0,0, 255,0,0,0,255,0,0,0
 ],4,true));
 const m=new THREE.SkinnedMesh(geo,new THREE.MeshBasicMaterial());
 m.updateWorldMatrix(true,true);
 return m;
}
test('typed array chunks preserve binary payload on Android bridge',()=>{
 const input=new Float32Array([0,0.5,1,2.25]);
 const clone=fromBase64(toBase64(bytesOf(input)));
 assert.deepEqual(Array.from(new Float32Array(clone.buffer)),Array.from(input));
});
test('triangle adjacency uses topology instead of nearby spatial parts',()=>{
 const mesh=meshFixture();
 const edges=buildTriangleEdges(mesh.geometry);
 assert.ok(edges.length>=10);
 assert.deepEqual([...new Set(edges)].sort((a,b)=>a-b),[0,1,2,3]);
 mesh.geometry.dispose();mesh.material.dispose();
});
test('native bridge allows replacing wrong-side weights even if old left influence is zero',async()=>{
 const mesh=meshFixture();
 const prepared=prepareLimbMesh(mesh,context,'leftArm');
 assert.ok(prepared.count>=2,prepared.reason);
 assert.equal(prepared.belongs[3],0,'right side must remain untouched');
 const native={
  async solve(data){
   assert.equal(data.passes,34);
   assert.equal(fromBase64(data.values).length,mesh.geometry.getAttribute('position').count*12);
   assert.ok(fromBase64(data.edges).length>0);
   return {values:data.values,engine:'mock-harmonic'};
  }
 };
 const result=await solveNativeSurface(native,mesh,context,'leftArm');
 assert.ok(result.changed>=2);
 const id=mesh.geometry.getAttribute('skinIndex');
 assert.notEqual(id.getX(0),3,'left arm no longer right arm');
 assert.equal(id.getX(3),3,'right arm weights unchanged');
 mesh.geometry.dispose();mesh.material.dispose();
});
test('missing topology is skipped safely',()=>{
 const mesh=meshFixture();mesh.geometry.setIndex(null);
 const p=prepareLimbMesh(mesh,context,'leftArm');
 assert.match(p.reason,/индексы/);
 mesh.geometry.dispose();mesh.material.dispose();
});
