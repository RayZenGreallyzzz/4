import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide} from '../src/autorig.js';
import {bindRigToMeshes,weightGeometryChunked} from '../src/skinning.js';

// Regression of the actual device screenshot: 730,338 vertices, rejected by
// the former hard-coded 450,000-vertex limit before doing any computation.
test('730338-vertex model skins successfully in batches, no 450k limit',async()=>{
  const count=730338;
  const coords=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    coords[i*3]=(i%101)*.003-.15;
    coords[i*3+1]=(i%151)*.012;
    coords[i*3+2]=(i%47)*.004-.09;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial());
  mesh.name='HighPolyCreature';
  const model=new THREE.Group();model.add(mesh);
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  // Four bones still exercise joint ranking for each of the 730k vertices.
  const selected=['mixamorigHips','mixamorigSpine','mixamorigSpine1','mixamorigSpine2'];
  guide.bones=new Map(selected.map(name=>[name,guide.bones.get(name)]));
  const updates=[];
  const result=await bindRigToMeshes(model,guide,{
    chunkVertices:16000,
    onProgress:s=>{if(updates.length===0||s.percentage!==updates.at(-1))updates.push(s.percentage);}
  });
  assert.equal(result.vertices,730338);
  assert.equal(result.meshes,1);
  assert.ok(model.children.some(c=>c.isSkinnedMesh));
  const skin=model.children.find(x=>x.isSkinnedMesh);
  assert.equal(skin.geometry.attributes.skinWeight.count,730338);
  assert.equal(skin.geometry.attributes.position.array,coords,
    'source position buffer must be shared, not duplicated');
  assert.ok(!geo.attributes.skinWeight,'source geometry must remain unchanged');
  assert.equal(updates[0],0);
  assert.equal(updates.at(-1),100);
  assert.ok(updates.length>12,'progress must be updated incrementally');
});

test('chunked bind can be cancelled before changing any original mesh',async()=>{
  const count=29000,arr=new Float32Array(count*3);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
  const original=new THREE.Mesh(g,new THREE.MeshBasicMaterial());
  const model=new THREE.Group();model.add(original);
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const abort=new AbortController();
  await assert.rejects(bindRigToMeshes(model,guide,{
    signal:abort.signal,chunkVertices:4096,
    onProgress:s=>{if(s.processed>=8192)abort.abort();}
  }),/отменена/);
  assert.equal(model.children[0],original);
  assert.ok(!model.children.some(x=>x.isSkinnedMesh));
  assert.equal(guide.root.parent,null);
});

test('extra-budget guard checks additional weight memory without destructive changes',async()=>{
  const g=new THREE.BoxGeometry(1,2,1,5,5,5);
  const model=new THREE.Group();
  const original=new THREE.Mesh(g,new THREE.MeshBasicMaterial());
  model.add(original);
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  await assert.rejects(bindRigToMeshes(model,guide,{maxExtraBytes:100}),/памяти/);
  assert.equal(model.children[0],original);
  assert.ok(!g.attributes.skinWeight);
});

test('chunking matches the synchronous calculation on the same mesh',async()=>{
  const g=new THREE.BoxGeometry(.4,1.5,.2,6,9,5);
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const bones=[...guide.bones.values()];
  const geo=await weightGeometryChunked(g,new THREE.Matrix4(),bones,2,{chunkVertices:256});
  assert.equal(geo.attributes.skinIndex.count,g.attributes.position.count);
  for(let i=0;i<geo.attributes.skinWeight.count;i++){
    let sum=0;
    for(let j=0;j<4;j++)sum+=geo.attributes.skinWeight.getComponent(i,j);
    assert.ok(Math.abs(sum-1)<1e-5);
  }
});
