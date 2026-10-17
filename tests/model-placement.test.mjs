import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {readModelPlacement,setModelPlacement,resetModelPlacement} from '../src/model-placement.js';

function riggedScene(){
 const root=new THREE.Group();
 const imported=new THREE.Group();root.add(imported);
 const hips=new THREE.Bone();hips.name='mixamorigHips';hips.position.y=1;imported.add(hips);
 const leg=new THREE.Bone();leg.name='mixamorigLeftUpLeg';leg.position.x=.12;hips.add(leg);
 const shin=new THREE.Bone();shin.name='mixamorigLeftLeg';shin.position.y=-.5;leg.add(shin);
 const geometry=new THREE.BoxGeometry(.3,1,.3);
 const skinIndices=new Uint16Array(geometry.attributes.position.count*4);
 const skinWeights=new Float32Array(geometry.attributes.position.count*4);
 for(let i=0;i<geometry.attributes.position.count;i++)skinWeights[i*4]=1;
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeights,4));
 root.updateWorldMatrix(true,true);
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());
 imported.add(mesh);mesh.bind(new THREE.Skeleton([hips,leg,shin]));
 root.updateWorldMatrix(true,true);
 return {root,hips,leg,shin,mesh};
}
test('model translate moves mesh and ALL bones together without changing any local animation pose',()=>{
 const {root,hips,leg,shin,mesh}=riggedScene();
 const boneStart=[hips,leg,shin].map(b=>b.quaternion.clone());
 const world=shin.getWorldPosition(new THREE.Vector3());
 assert.ok(setModelPlacement(root,{position:[2.5,1,-4]}));
 const moved=shin.getWorldPosition(new THREE.Vector3());
 assert.ok(moved.distanceTo(world.clone().add(new THREE.Vector3(2.5,1,-4)))<1e-7);
 assert.ok(mesh.parent.parent===root);
 [hips,leg,shin].forEach((b,i)=>assert.ok(b.quaternion.angleTo(boneStart[i])<1e-7));
});
test('model rotation/scaling preserve bone hierarchy and pose keys',()=>{
 const {root,hips,leg,shin}=riggedScene();
 leg.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),.52);
 const original=leg.quaternion.clone();
 assert.ok(setModelPlacement(root,{rotation:[0,90,0],scale:1.75}));
 assert.ok(Math.abs(readModelPlacement(root).rotation[1]-90)<1e-5);
 assert.equal(readModelPlacement(root).scale,1.75);
 assert.ok(leg.quaternion.angleTo(original)<1e-7);
 const v=shin.getWorldPosition(new THREE.Vector3());
 assert.ok(v.length()>0);
 assert.ok(root.children.includes(hips.parent));
});
test('reset placement resets only parent group, not bones',()=>{
 const {root,leg}=riggedScene();
 leg.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),.33);
 setModelPlacement(root,{position:[3,-2,6],rotation:[30,45,0],scale:2});
 assert.equal(resetModelPlacement(root),true);
 assert.deepEqual(readModelPlacement(root).position,[0,0,0]);
 assert.ok(readModelPlacement(root).rotation.every(angle=>Math.abs(angle)<1e-10));
 assert.equal(readModelPlacement(root).scale,1);
 assert.ok(Math.abs(leg.quaternion.angleTo(new THREE.Quaternion())-.33)<1e-7);
});
test('reject invalid model transforms rather than corrupting skinned mesh',()=>{
 const {root}=riggedScene();
 assert.equal(setModelPlacement(root,{position:[NaN,1,1]}),false);
 assert.equal(setModelPlacement(root,{scale:0}),false);
 assert.equal(setModelPlacement(root,{rotation:[0,Infinity,0]}),false);
 assert.deepEqual(readModelPlacement(root).position,[0,0,0]);
});
test('whole model UI cannot record animation keys and AutoRig has its own gizmo',()=>{
 const html=readFileSync('index.html','utf8');
 const main=readFileSync('src/main.js','utf8');
 assert.ok(html.includes('data-model-mode="translate"'));
 assert.ok(html.includes('data-model-mode="rotate"'));
 assert.ok(html.includes('data-model-mode="scale"'));
 assert.ok(main.includes('modelTransform.attach(state.root)'));
 assert.ok(main.includes('rigTransform.attach(name'));
 assert.ok(main.includes('if(!canMoveModel())return'));
 assert.ok(main.includes('setModelPlacement(state.root'));
 assert.ok(main.includes('resetModelPlacement(state.root)'));
 assert.ok(!main.includes('state.timeline.set(state.root'));
});
