import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,JOINTS} from '../src/autorig.js';
import {
  normalizeBoneName,retargetAnimationClip,clipNameForFile,findTrackNode
} from '../src/animationimport.js';

const close=(a,b,limit=1e-3)=>a.angleTo(b)<limit;
const mixamoParts=[
  'LeftToe_End','LeftToeBase','LeftFoot','LeftLeg','LeftUpLeg',
  'RightToe_End','RightToeBase','RightFoot','RightLeg','RightUpLeg',
  'LeftHandIndex4','LeftHandIndex3','LeftHandIndex2','LeftHandIndex1',
  'LeftHandThumb4','LeftHandThumb3','LeftHandThumb2','LeftHandThumb1',
  'LeftHand','LeftForeArm','LeftArm','LeftShoulder','HeadTop_End',
  'Head','Neck','RightHandIndex4','RightHandIndex3','RightHandIndex2',
  'RightHandIndex1','RightHandThumb4','RightHandThumb3',
  'RightHandThumb2','RightHandThumb1','RightHand','RightForeArm',
  'RightArm','RightShoulder','Spine2','Spine1','Spine','Hips'
];
function sampleMixamo(){
  const scene=new THREE.Group(),bones=[];
  for(const part of mixamoParts){
    const bone=new THREE.Bone();
    bone.name='mixamorig:'+part;
    scene.add(bone);bones.push(bone);
  }
  const tracks=bones.map((b,i)=>new THREE.QuaternionKeyframeTrack(
    b.uuid+'.quaternion',[0,.5,1],
    [0,0,0,1, 0,Math.sin(.02*(i+1)),0,Math.cos(.02*(i+1)), 0,0,0,1]
  ));
  return {scene,bones,clip:new THREE.AnimationClip('Animation',1,tracks)};
}
test('real Mixamo source names and GLB converted namespace normalize correctly',()=>{
  assert.equal(normalizeBoneName('mixamorig:Hips'),'hips');
  assert.equal(normalizeBoneName('Mixamo_Rig|mixamorig:LeftHandThumb4'),'lefthandthumb4');
  assert.equal(normalizeBoneName('mixamorig1:LeftUpLeg'),'leftupleg');
  assert.equal(normalizeBoneName('mixamorigRightForeArm'),'rightforearm');
  assert.equal(normalizeBoneName('LeftLowerArm'),'leftforearm');
  assert.equal(normalizeBoneName('Armature\\mixamorig:RightToe_End'),'righttoeend');
  assert.equal(clipNameForFile('032_Бег вперёд.glb','Animation'),'032_Бег вперёд');
});

test('retarget all 41 Mixamo joints when the target actually HAS 41 joints',()=>{
  const {scene,clip}=sampleMixamo();
  const target=mixamoParts.map(part=>{
    const b=new THREE.Bone();b.name='mixamorig'+part;return b;
  });
  const keep=target.map(b=>b.quaternion.clone());
  const result=retargetAnimationClip(clip,scene,target,new Map(target.map(b=>[b.uuid,b.quaternion.clone()])));
  assert.equal(result.total,41);
  assert.equal(result.matched,41);
  assert.equal(result.clip.tracks.length,41);
  assert.equal(result.profile,'Mixamo 41+');
  assert.equal(result.warning,null);
  assert.ok(result.clip.tracks.every((track,i)=>track.name===target[i].uuid+'.quaternion'));
  assert.ok(target.every((b,i)=>b.quaternion.equals(keep[i])),'re-targeting must not mutate the target model');
});

test('fitted 22-joint AutoRig gets 22 named joints; absent fingers are reported, not invented',()=>{
  const {scene,clip}=sampleMixamo();
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,2,1)));
  const target=[...guide.bones.values()];
  assert.equal(target.length,22);
  assert.equal(JOINTS.length,22);
  const r=retargetAnimationClip(clip,scene,target,new Map(target.map(b=>[b.uuid,b.quaternion.clone()])));
  assert.equal(r.matched,22);
  assert.equal(r.total,41);
  assert.ok(r.warning?.includes('22 из 41'));
  assert.equal(r.clip.tracks.length,22);
});

test('adaptive world-basis compensation rotates source delta into target axes',()=>{
  const scene=new THREE.Group();
  const sourceParent=new THREE.Group();
  sourceParent.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);
  scene.add(sourceParent);
  const src=new THREE.Bone();src.name='mixamorig:RightArm';sourceParent.add(src);
  const dest=new THREE.Bone();dest.name='mixamorigRightArm';
  const rest=new THREE.Quaternion();
  const motion=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.5);
  const clip=new THREE.AnimationClip('Turn',1,[
    new THREE.QuaternionKeyframeTrack(src.uuid+'.quaternion',[0,1],
      [...rest.toArray(),...motion.toArray()])
  ]);
  const input=retargetAnimationClip(clip,scene,[dest],new Map([[dest.uuid,rest]]),{mode:'auto'});
  assert.equal(input.corrected,1);
  const result=new THREE.Quaternion().fromArray(input.clip.tracks[0].values,4);
  const expected=sourceParent.quaternion.clone().multiply(motion).multiply(
    sourceParent.quaternion.clone().invert());
  assert.ok(close(result,expected));
  const local=retargetAnimationClip(clip,scene,[dest],new Map([[dest.uuid,rest]]),{mode:'local'});
  const localResult=new THREE.Quaternion().fromArray(local.clip.tracks[0].values,4);
  assert.ok(close(localResult,motion));
});

test('rest pose offsets preserved and converted motion does not snap at first frame',()=>{
  const scene=new THREE.Group(),src=new THREE.Bone();
  src.name='mixamorig:RightArm';
  src.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),.3);
  scene.add(src);
  const target=new THREE.Bone();target.name='mixamorigRightArm';
  const targetRest=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.15);
  target.quaternion.copy(targetRest);
  const animated=src.quaternion.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.45));
  const clip=new THREE.AnimationClip('Wave',1,[
    new THREE.QuaternionKeyframeTrack(src.uuid+'.quaternion',[0,.5,1],
      [...src.quaternion.toArray(),...animated.toArray(),...src.quaternion.toArray()])
  ]);
  const result=retargetAnimationClip(clip,scene,[target],new Map([[target.uuid,targetRest]]));
  assert.equal(result.matched,1);
  assert.equal(result.corrected,0);
  assert.ok(close(new THREE.Quaternion().fromArray(result.clip.tracks[0].values),targetRest));
  assert.ok(close(new THREE.Quaternion().fromArray(result.clip.tracks[0].values,4),
    targetRest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.45))));
});

test('incompatible 41-bone sources are rejected rather than reporting 1/41 success',()=>{
  const {scene,clip}=sampleMixamo();
  const target=new THREE.Bone();target.name='mixamorigHips';
  const result=retargetAnimationClip(clip,scene,[target],new Map());
  assert.equal(result.matched,1);
  assert.equal(result.total,41);
  assert.equal(result.clip,null);
  assert.match(result.warning,/Недостаточно/);
});

test('position/scale tracks are excluded and invalid quaternions skipped',()=>{
  const root=new THREE.Group(),hip=new THREE.Bone();hip.name='mixamorig:Hips';root.add(hip);
  const b=new THREE.Bone();b.name='mixamorigHips';
  const clip=new THREE.AnimationClip('Danger',1,[
    new THREE.QuaternionKeyframeTrack(hip.name+'.quaternion',[0,1],[0,0,0,1,0,0,.2,.98]),
    new THREE.VectorKeyframeTrack(hip.name+'.position',[0,1],[0,0,0,100,100,100]),
    new THREE.VectorKeyframeTrack(hip.name+'.scale',[0,1],[1,1,1,7,7,7])
  ]);
  assert.equal(findTrackNode(clip.tracks[0],root).source,hip);
  const result=retargetAnimationClip(clip,root,[b],new Map());
  assert.equal(result.total,1);
  assert.equal(result.matched,1);
  assert.equal(result.clip.tracks.length,1);
  assert.equal(result.clip.tracks[0].name,b.uuid+'.quaternion');
});
