import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {createGuide} from '../src/autorig.js';
import {bindRigToMeshes} from '../src/skinning.js';
import {exportFbxBinary} from '../src/fbx.js';

test('the real app FBX export pathway preserves supplied animation clips',async()=>{
  const root=new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(.5,1,.5),new THREE.MeshStandardMaterial()));
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const {bones}=await bindRigToMeshes(root,guide);
  const bone=bones.find(b=>b.name==='mixamorigRightArm');
  const clip=new THREE.AnimationClip('Wave',.9,[
    new THREE.QuaternionKeyframeTrack(bone.uuid+'.quaternion',[0,.45,.9],
      [0,0,0,1,0,0,.258819,.965926,0,0,0,1])
  ]);
  const bytes=await exportFbxBinary(root,[clip]);
  const restored=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.ok(restored.animations.length>0,'real FBX export must include passed animation, not only rig and mesh');
  assert.ok(restored.animations.some(a=>a.tracks.some(t=>t.name.endsWith('.quaternion'))));
});
