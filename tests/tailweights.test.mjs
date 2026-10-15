import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,addGuideChain} from '../src/autorig.js';
import {bindRigToMeshes} from '../src/skinning.js';
import {findTailChains,calculateTailRegion,commitTailRegion,restoreTailRegion} from '../src/tailweights.js';

function makeModel(){
  const root=new THREE.Group();
  const torso=new THREE.Mesh(new THREE.BoxGeometry(.45,1,.34,5,8,5),
    new THREE.MeshStandardMaterial({color:0x8866ff}));
  torso.position.y=1.1;torso.name='Torso';
  const tail=new THREE.Mesh(new THREE.BoxGeometry(.15,.14,.80,4,4,24),
    new THREE.MeshStandardMaterial({color:0xffaaff}));
  tail.position.set(0,1.03,-.48);tail.name='TailMesh';
  root.add(torso,tail);
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-.8,0,-1),new THREE.Vector3(.8,2,.5)));
  const chain=addGuideChain(guide,'tail',5);
  return {root,guide,chain};
}

test('tail editor discovers named chains and does not conflate with body',async()=>{
  const {root,guide}=makeModel();
  const {bones}=await bindRigToMeshes(root,guide);
  const chains=findTailChains(bones);
  assert.equal(chains.length,1);
  assert.equal(chains[0].bones.length,5);
  assert.equal(chains[0].id,'Tail');
  assert.equal(findTailChains(bones.filter(b=>b.name.startsWith('mixamorig'))).length,0);
});

test('reweight only tail mesh, preserve body buffers, support undo',async()=>{
  const {root,guide}=makeModel();
  await bindRigToMeshes(root,guide);
  const skins=[];root.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});
  const body=skins.find(s=>s.name==='Torso');
  const tail=skins.find(s=>s.name==='TailMesh');
  const bodyIndex=body.geometry.attributes.skinIndex;
  const bodyWeight=body.geometry.attributes.skinWeight;
  const originalIndex=tail.geometry.attributes.skinIndex;
  const originalWeight=tail.geometry.attributes.skinWeight;
  const bones=findTailChains(tail.skeleton.bones)[0].bones;
  const dry=await calculateTailRegion(tail,bones,{radiusWorld:.11,dryRun:true,chunkVertices:256});
  assert.ok(dry.affected>0, 'tail vertices found near tail bone chain');
  assert.equal(dry.indices,null,'preview must not allocate replacement buffers');
  assert.equal(tail.geometry.attributes.skinIndex,originalIndex,'preview must never mutate model');
  const region=await calculateTailRegion(tail,bones,{radiusWorld:.11,chunkVertices:256});
  assert.equal(region.affected,dry.affected);
  const backup=commitTailRegion(tail,region);
  assert.equal(backup.index,originalIndex);
  assert.equal(backup.weight,originalWeight);
  assert.equal(body.geometry.attributes.skinIndex,bodyIndex,'body skinIndex stays intact');
  assert.equal(body.geometry.attributes.skinWeight,bodyWeight,'body skinWeight stays intact');
  let changed=false;
  const boneIds=new Set(bones.map(b=>tail.skeleton.bones.indexOf(b)));
  for(let i=0;i<tail.geometry.attributes.position.count;i++){
    let sum=0;
    for(let k=0;k<4;k++){
      const influence=tail.geometry.attributes.skinWeight.getComponent(i,k);
      assert.ok(Number.isFinite(influence) && influence>=0);
      sum+=influence;
      const index=tail.geometry.attributes.skinIndex.getComponent(i,k);
      if(influence>.2 && boneIds.has(index))changed=true;
    }
    assert.ok(Math.abs(sum-1)<1e-5);
  }
  assert.ok(changed,'tail bones must receive substantial influence');
  const skinNew=tail.geometry.attributes.skinWeight;
  const redo=await calculateTailRegion(tail,bones,{radiusWorld:.12,source:backup,chunkVertices:256});
  assert.ok(redo.affected>=region.affected);
  assert.equal(tail.geometry.attributes.skinWeight,skinNew,'computing alternative radius is atomic');
  restoreTailRegion(tail,backup);
  assert.equal(tail.geometry.attributes.skinIndex,originalIndex);
  assert.equal(tail.geometry.attributes.skinWeight,originalWeight);
});

test('nothing is changed when the selected geometry is far from the tail',async()=>{
  const {root,guide}=makeModel();
  await bindRigToMeshes(root,guide);
  const body=root.getObjectByName('Torso');
  const bones=findTailChains(body.skeleton.bones)[0].bones;
  const old=body.geometry.attributes.skinIndex;
  const region=await calculateTailRegion(body,bones,{radiusWorld:.013,dryRun:false,chunkVertices:256});
  assert.equal(region.affected,0);
  assert.throws(()=>commitTailRegion(body,region),/Не найдены/);
  assert.equal(body.geometry.attributes.skinIndex,old);
});

test('aborting an expensive preview leaves original skin data unchanged',async()=>{
  const {root,guide}=makeModel();
  await bindRigToMeshes(root,guide);
  const tail=root.getObjectByName('TailMesh');
  const bones=findTailChains(tail.skeleton.bones)[0].bones;
  const old=tail.geometry.attributes.skinWeight;
  const abort=new AbortController();
  await assert.rejects(calculateTailRegion(tail,bones,{radiusWorld:.09,chunkVertices:256,signal:abort.signal,
    onProgress:()=>abort.abort()}),/отменено/);
  assert.equal(tail.geometry.attributes.skinWeight,old);
});
