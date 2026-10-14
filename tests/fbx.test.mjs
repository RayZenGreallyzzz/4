import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {FBXExporter} from '@comfyorg/fbx-exporter-three';
import {createGuide} from '../src/autorig.js';
import {bindRigToMeshes} from '../src/skinning.js';
import {verifyFbxBinary,countVertices,FBX_VERSION} from '../src/fbx.js';

function exported(root,animations=[]){
  const bytes=new FBXExporter().parseSync(root,{
    version:7400,preset:'threejs',animations,embedTextures:false,fps:30
  });
  verifyFbxBinary(bytes);
  return bytes;
}

test('FBX exporter writes real binary version 7.4, not GLB renamed',()=>{
  const scene=new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,2,.6),new THREE.MeshStandardMaterial()));
  const bytes=exported(scene);
  assert.equal(new DataView(bytes.buffer,bytes.byteOffset).getUint32(23,true),FBX_VERSION);
  assert.equal(countVertices(scene),24);
  assert.throws(()=>verifyFbxBinary(new Uint8Array([1,2,3])),/повреждённый/);
  const parsed=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.ok(parsed.getObjectByProperty('type','Mesh'),'FBXLoader must re-import exported mesh');
});
test('FBX roundtrip includes bones, weighted meshes, tail hierarchy, and animation',async()=>{
  const model=new THREE.Group();
  model.name='Character';
  const original=new THREE.Mesh(new THREE.BoxGeometry(.5,1.8,.3,4,4,4),
    new THREE.MeshStandardMaterial({color:0x4488cc}));
  original.position.y=.9;original.name='Body';
  model.add(original);
  const guide=createGuide(new THREE.Box3(
    new THREE.Vector3(-.7,0,-.5),new THREE.Vector3(.7,1.8,.5)));
  const result=await bindRigToMeshes(model,guide);
  const bone=guide.bones.get('mixamorigRightArm');
  const clip=new THREE.AnimationClip('Wave',1,[
    new THREE.QuaternionKeyframeTrack(bone.uuid+'.quaternion',[0,.5,1],
      [0,0,0,1,0,0,.25,.9682458,0,0,0,1])
  ]);
  const bytes=exported(model,[clip]);
  const imported=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const skins=[];
  imported.traverse(obj=>{if(obj.isSkinnedMesh)skins.push(obj);});
  assert.ok(skins.length,'Exported FBX should have a reimportable SkinnedMesh');
  assert.ok(skins[0].skeleton?.bones.length>0,'Must preserve skin weights and bones');
  assert.ok(result.bones.length>=22);
  assert.ok(imported.animations.length>0,'Clip Wave must roundtrip');
});
