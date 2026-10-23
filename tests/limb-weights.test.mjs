import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LIMB_GROUPS,normalBoneName,buildLimbWeightContext,classifyLimbVertex,
  repairOneLimbVertex,repairLimbWeightsOnMesh,diagnoseCrossLimbWeights
} from '../src/limb-weights.js';

function makeSkeleton(){
 const specs=[
 ['Hips',null,0,1,0],['Spine','Hips',0,.18,0],['Spine1','Spine',0,.18,0],
 ['Spine2','Spine1',0,.17,0],['Neck','Spine2',0,.14,0],
 ['Head','Neck',0,.13,0],
 ['LeftShoulder','Spine2',.19,.04,0],
 ['LeftArm','LeftShoulder',.26,-.05,0],
 ['LeftForeArm','LeftArm',.32,-.02,0],
 ['LeftHand','LeftForeArm',.30,-.02,0],
 ['RightShoulder','Spine2',-.19,.04,0],
 ['RightArm','RightShoulder',-.26,-.05,0],
 ['RightForeArm','RightArm',-.32,-.02,0],
 ['RightHand','RightForeArm',-.30,-.02,0],
 ['LeftUpLeg','Hips',.20,-.12,0],
 ['LeftLeg','LeftUpLeg',0,-.40,0],
 ['LeftFoot','LeftLeg',0,-.30,.04],
 ['LeftToeBase','LeftFoot',0,-.03,.20],
 ['RightUpLeg','Hips',-.20,-.12,0],
 ['RightLeg','RightUpLeg',0,-.40,0],
 ['RightFoot','RightLeg',0,-.30,.04],
 ['RightToeBase','RightFoot',0,-.03,.20]
 ];
 const root=new THREE.Group(),map=new Map();
 for(const [name,parent,x,y,z] of specs){
  const b=new THREE.Bone();b.name='mixamorig'+name;b.position.set(x,y,z);
  (parent?map.get(parent):root).add(b);map.set(name,b);
 }
 root.updateMatrixWorld(true);
 const bones=[...map.values()];
 return {root,bones,map,ctx:buildLimbWeightContext(bones,2)};
}
const p=(x,y,z)=>new THREE.Vector3(x,y,z);

test('detects correct Mixamo branches without mutating bone userData',()=>{
 const {ctx,bones}=makeSkeleton();
 assert.deepEqual(Object.keys(ctx.groups),Object.keys(LIMB_GROUPS));
 assert.equal(normalBoneName('mixamorig2:LeftHand'),'lefthand');
 assert.equal(ctx.groups.leftArm[2].index,bones.findIndex(b=>b.name==='mixamorigLeftHand'));
 assert.equal(bones.some(b=>Object.hasOwn(b.userData,'skinIndex')),false);
});
test('isolates left and right hand and toe vertex ownership',()=>{
 const {ctx,map}=makeSkeleton();
 const leftHand=map.get('LeftHand').getWorldPosition(new THREE.Vector3());
 const rightHand=map.get('RightHand').getWorldPosition(new THREE.Vector3());
 const leftToe=map.get('LeftToeBase').getWorldPosition(new THREE.Vector3());
 const rightToe=map.get('RightToeBase').getWorldPosition(new THREE.Vector3());
 assert.equal(classifyLimbVertex(leftHand,ctx),'leftArm');
 assert.equal(classifyLimbVertex(rightHand,ctx),'rightArm');
 assert.equal(classifyLimbVertex(leftToe,ctx),'leftLeg');
 assert.equal(classifyLimbVertex(rightToe,ctx),'rightLeg');
 assert.equal(classifyLimbVertex(p(0,1.38,0),ctx),null,'torso protected');
});
test('claw follows its own distal hand and no foreign shoulder or foot',()=>{
 const {ctx,bones,map}=makeSkeleton();
 const claw=map.get('LeftHand').getWorldPosition(new THREE.Vector3()).add(p(.05,0,.01));
 const wrongHand=bones.findIndex(b=>b.name==='mixamorigRightHand');
 const ownHand=bones.findIndex(b=>b.name==='mixamorigLeftHand');
 const spine=bones.findIndex(b=>b.name==='mixamorigSpine2');
 const forearm=bones.findIndex(b=>b.name==='mixamorigLeftForeArm');
 const fix=repairOneLimbVertex(claw,[wrongHand,ownHand,spine,forearm],
  [.40,.20,.20,.20],ctx,'leftArm');
 assert.ok(fix);
 assert.equal(fix.group,'leftArm');
 assert.equal(fix.ids[0],ownHand);
 assert.ok(fix.weights[0]>.99);
 assert.equal(fix.wrongSide,.40);
});
test('refuses ambiguous crossing, torso and foreign selected side',()=>{
 const {ctx,map,bones}=makeSkeleton();
 const hand=map.get('RightHand').getWorldPosition(new THREE.Vector3());
 const id=bones.findIndex(b=>b.name==='mixamorigRightHand');
 assert.equal(repairOneLimbVertex(hand,[id,0,0,0],[1,0,0,0],ctx,'leftArm'),null);
 assert.equal(repairOneLimbVertex(p(0,1.3,0),[id,0,0,0],[1,0,0,0],ctx,'all'),null);
});
test('repairs normalized Uint8 weights on a skinned mesh and diagnoses foreign side',async()=>{
 const {root,bones,ctx,map}=makeSkeleton();
 const leftHand=map.get('LeftHand').getWorldPosition(new THREE.Vector3());
 const rightHand=map.get('RightHand').getWorldPosition(new THREE.Vector3());
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute(
   [...leftHand.toArray(),...rightHand.toArray(),0,1.3,0],3));
 const right=bones.indexOf(map.get('RightHand')),left=bones.indexOf(map.get('LeftHand'));
 const spine=bones.indexOf(map.get('Spine2'));
 geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(
   [right,left,spine,0,left,right,spine,0,spine,0,0,0],4));
 geo.setAttribute('skinWeight',new THREE.Uint8BufferAttribute(
   [178,51,26,0,179,51,25,0,255,0,0,0],4,true));
 const skin=new THREE.SkinnedMesh(geo,new THREE.MeshBasicMaterial());
 skin.bind(new THREE.Skeleton(bones));
 skin.updateWorldMatrix(true,true);
 const pre=await diagnoseCrossLimbWeights(skin,ctx);
 assert.ok(pre.foreign>=2,'both sides cross-contaminated');
 const repaired=await repairLimbWeightsOnMesh(skin,ctx);
 assert.ok(repaired.changed>=2);
 assert.equal(geo.getAttribute('skinIndex').getX(0),left);
 assert.equal(geo.getAttribute('skinIndex').getX(1),right);
 assert.equal(geo.getAttribute('skinIndex').getX(2),spine,'torso untouched');
 assert.ok(geo.getAttribute('skinWeight').getX(0)>.99);
 assert.ok(geo.getAttribute('skinWeight').getX(1)>.99);
 skin.geometry.dispose();skin.material.dispose();
});
