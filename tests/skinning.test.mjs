import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,addGuideChain} from '../src/autorig.js';
import {weightGeometry,bindRigToMeshes} from '../src/skinning.js';

test('computed skin attributes have four normalized influences and valid indices',()=>{
 const g=new THREE.BoxGeometry(1,2,.4,3,4,2);
 const bounds=new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1));
 const guide=createGuide(bounds);
 const geo=weightGeometry(g,new THREE.Matrix4(),[...guide.bones.values()],2);
 assert.ok(geo.attributes.skinIndex);
 assert.ok(geo.attributes.skinWeight);
 assert.equal(geo.attributes.skinWeight.itemSize,4);
 for(let i=0;i<geo.attributes.position.count;i++){
   let sum=0;
   for(let j=0;j<4;j++){
     const weight=geo.attributes.skinWeight.getComponent(i,j);
     assert.ok(weight>=0 && Number.isFinite(weight));
     sum+=weight;
     assert.ok(geo.attributes.skinIndex.getComponent(i,j)<guide.bones.size);
   }
   assert.ok(Math.abs(sum-1)<1e-5, 'weight sum '+sum);
 }
 assert.ok(!g.attributes.skinWeight,'original mesh geometry must not be modified');
});

test('bind creates actual SkinnedMeshes and preserves node transformation',async()=>{
 const model=new THREE.Group();
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,1,.3,4,4,4),new THREE.MeshBasicMaterial());
 mesh.name='Armour';mesh.position.set(3,1,-2);mesh.scale.set(1.1,.9,1);
 model.add(mesh);
 const bounds=new THREE.Box3(new THREE.Vector3(2,0,-3),new THREE.Vector3(4,2,-1));
 const guide=createGuide(bounds);
 const progress=[];
 const result=await bindRigToMeshes(model,guide,{onProgress:x=>progress.push(x.percentage)});
 assert.equal(result.meshes,1);
 assert.ok(model.children.some(x=>x.isSkinnedMesh));
 const bound=model.children.find(x=>x.isSkinnedMesh);
 assert.equal(bound.name,'Armour');
 assert.ok(bound.geometry.attributes.skinWeight);
 assert.equal(bound.skeleton.bones.length,22);
 assert.equal(guide.root.parent,model);
 assert.ok(bound.position.equals(new THREE.Vector3(3,1,-2)));
 assert.ok(progress.at(-1)===100);
});

test('additional tail bones are part of actual skin binding',async()=>{
 const model=new THREE.Group();
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,2,.6,5,5,5),new THREE.MeshBasicMaterial());
 mesh.position.y=1;model.add(mesh);
 const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
 const tail=addGuideChain(guide,'tail',5);
 const result=await bindRigToMeshes(model,guide);
 assert.equal(result.bones.length,27);
 assert.ok(result.skeleton.bones.some(x=>x.name===tail.names.at(-1)));
});

test('skinned vertices change world position when a weighted bone rotates',async()=>{
 const model=new THREE.Group();
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,2,.5,4,4,4),new THREE.MeshBasicMaterial());
 mesh.position.y=1;model.add(mesh);
 const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
 const result=await bindRigToMeshes(model,guide);
 const skin=model.children.find(x=>x.isSkinnedMesh);
 const before=new THREE.Vector3(),after=new THREE.Vector3();
 skin.getVertexPosition(0,before);
 guide.bones.get('mixamorigSpine2').rotateZ(.4);
 result.skeleton.update();
 skin.getVertexPosition(0,after);
 assert.ok(before.distanceTo(after)>.00001,'vertex should be changed by skeletal rotation');
});
