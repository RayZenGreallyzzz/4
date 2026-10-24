import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,jointWorld} from '../src/autorig.js';
import {calculateAdaptiveFit,fitAdaptiveLimbs} from '../src/adaptive-geometry-fit.js';

function mannequin(){
 const group=new THREE.Group();
 const body=new THREE.Mesh(new THREE.BoxGeometry(.42,.92,.23,9,55,9),new THREE.MeshBasicMaterial());
 body.position.set(0,1.20,0);group.add(body);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.145,16,16),new THREE.MeshBasicMaterial());
 head.position.set(0,1.81,0);group.add(head);
 for(const side of [-1,1]){
  const leg=new THREE.Mesh(new THREE.BoxGeometry(.18,.83,.19,8,70,8),new THREE.MeshBasicMaterial());
  leg.position.set(side*.14,.48,0);group.add(leg);
  const foot=new THREE.Mesh(new THREE.BoxGeometry(.18,.13,.40,8,9,15),new THREE.MeshBasicMaterial());
  foot.position.set(side*.14,.075,.12);group.add(foot);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(.14,.7,.14,8,66,8),new THREE.MeshBasicMaterial());
  arm.position.set(side*.39,1.29,0);arm.rotation.z=-side*.18;group.add(arm);
 }
 group.updateWorldMatrix(true,true);
 return group;
}
function snapshot(guide,names){
 return names.map(name=>[name,jointWorld(guide,name).clone()]);
}
function unchanged(before,guide){
 for(const [name,p] of before)assert.ok(p.distanceTo(jointWorld(guide,name))<1e-8,'moved protected '+name);
}
test('adaptive positions map has all canonical joints, finite, even with no detected limbs',()=>{
 const root=new THREE.Group();
 const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,12,12),new THREE.MeshBasicMaterial());
 mesh.scale.set(.4,.95,.3);mesh.position.y=1;root.add(mesh);
 const {positions,info,sampleCount}=calculateAdaptiveFit(root,'z+');
 assert.equal(positions.size,22);
 assert.ok(sampleCount>=120);
 assert.ok(info.height>1);
 for(const p of positions.values())assert.ok([p.x,p.y,p.z].every(Number.isFinite));
});
test('adaptive fit never alters hips/spine/neck/head or any skin weights',()=>{
 const root=mannequin();
 const guide=createGuide(new THREE.Box3().setFromObject(root));
 const protectedBones=['mixamorigHips','mixamorigSpine','mixamorigSpine1','mixamorigSpine2','mixamorigNeck','mixamorigHead'];
 const before=snapshot(guide,protectedBones);
 const originals=[];
 root.traverse(obj=>{if(obj.isMesh){originals.push([obj,obj.geometry.attributes.position.array.slice()]);}});
 try {
   const result=fitAdaptiveLimbs(guide,root,'z+');
   assert.ok(result.affected.every(x=>/Left|Right/.test(x)));
   assert.ok(result.affected.length<=16);
 }catch(error){
   assert.match(String(error),/не распознана/);
 }
 unchanged(before,guide);
 for(const [mesh,data] of originals)assert.deepEqual(mesh.geometry.attributes.position.array,data);
});
test('x-facing adaptive geometry values remain finite and do not throw',()=>{
 const root=mannequin();
 root.rotation.y=Math.PI/2;
 root.updateWorldMatrix(true,true);
 const {positions}=calculateAdaptiveFit(root,'x+');
 assert.equal(positions.size,22);
 for(const p of positions.values())assert.ok([p.x,p.y,p.z].every(Number.isFinite));
});
test('adaptive fit refuses absent skeleton before modifying model',()=>{
 const root=mannequin();
 assert.throws(()=>fitAdaptiveLimbs(null,root),/скелет/);
});
