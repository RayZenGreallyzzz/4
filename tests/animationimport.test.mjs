import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide} from '../src/autorig.js';
import {retargetAnimationClip,normalizeBoneName,clipNameForFile} from '../src/animationimport.js';

test('Mixamo name namespaces map to the fitted rig',()=>{
  assert.equal(normalizeBoneName('mixamorig:Hips'),'hips');
  assert.equal(normalizeBoneName('Armature|mixamorigRightForeArm'),'rightforearm');
  assert.equal(normalizeBoneName('mixamorig1:LeftUpLeg'),'leftupleg');
  assert.equal(clipNameForFile('Running.fbx','mixamo.com'),'Running');
});
test('retargets source quaternion to destination name/UUID and rest delta',()=>{
  const root=new THREE.Group(),src=new THREE.Bone();
  src.name='mixamorig:RightArm';src.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),.3);
  root.add(src);
  const target=new THREE.Bone();target.name='mixamorigRightArm';
  const targetRest=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.15);
  target.quaternion.copy(targetRest);
  const importedQ=src.quaternion.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.45));
  const clip=new THREE.AnimationClip('Wave',1,[
    new THREE.QuaternionKeyframeTrack(src.uuid+'.quaternion',[0,.5,1],
      [...src.quaternion.toArray(),...importedQ.toArray(),...src.quaternion.toArray()])
  ]);
  const input=retargetAnimationClip(clip,root,[target],new Map([[target.uuid,targetRest]]));
  assert.equal(input.matched,1);
  assert.equal(input.clip.tracks.length,1);
  assert.equal(input.clip.tracks[0].name,target.uuid+'.quaternion');
  const outputAt0=new THREE.Quaternion().fromArray(input.clip.tracks[0].values,0);
  assert.ok(outputAt0.angleTo(targetRest)<1e-5);
  const expected=targetRest.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.45));
  const outputMid=new THREE.Quaternion().fromArray(input.clip.tracks[0].values,4);
  assert.ok(outputMid.angleTo(expected)<1e-4);
  assert.equal(src.quaternion.angleTo(src.quaternion.clone()),0);
});
test('unmatched bones are skipped and no geometry imported',()=>{
  const src=new THREE.Bone();src.name='AlienTentacle';const root=new THREE.Group();root.add(src);
  const target=new THREE.Bone();target.name='mixamorigSpine';
  const clip=new THREE.AnimationClip('X',.5,[
    new THREE.QuaternionKeyframeTrack(src.uuid+'.quaternion',[0,.5],[0,0,0,1,0,.2,0,.98])
  ]);
  const result=retargetAnimationClip(clip,root,[target],new Map());
  assert.equal(result.clip,null);assert.equal(result.matched,0);
});
test('only rotations imported; unsafe root position and scale ignored',()=>{
  const rig=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const bone=rig.bones.get('mixamorigHips');const source=new THREE.Group();
  const hips=new THREE.Bone();hips.name='mixamorig:Hips';source.add(hips);
  const clip=new THREE.AnimationClip('Run',1,[
    new THREE.QuaternionKeyframeTrack(hips.name+'.quaternion',[0,1],[0,0,0,1,0,0,.2,.98]),
    new THREE.VectorKeyframeTrack(hips.name+'.position',[0,1],[0,1,0,1000,1,0]),
    new THREE.VectorKeyframeTrack(hips.name+'.scale',[0,1],[1,1,1,4,4,4])
  ]);
  const result=retargetAnimationClip(clip,source,[bone],new Map([[bone.uuid,bone.quaternion.clone()]]));
  assert.equal(result.matched,1);assert.equal(result.clip.tracks.length,1);
  assert.ok(result.clip.tracks[0].name.endsWith('.quaternion'));
});
