import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {recoverSkinBindQuaternions,applySkinRestQuaternions} from '../src/skin-bind-rest.js';
function sampleRig(){
 const root=new THREE.Group();
 const guide=new THREE.Group();guide.position.y=-1;root.add(guide);
 const hip=new THREE.Bone();hip.name='mixamorigHips';hip.position.y=1;guide.add(hip);
 const shoulder=new THREE.Bone();shoulder.name='mixamorigLeftShoulder';shoulder.position.set(.1,.5,0);hip.add(shoulder);
 const arm=new THREE.Bone();arm.name='mixamorigLeftArm';arm.position.set(.15,0,0);shoulder.add(arm);
 const elbow=new THREE.Bone();elbow.name='mixamorigLeftForeArm';elbow.position.set(.3,0,0);arm.add(elbow);
 const hand=new THREE.Bone();hand.name='mixamorigLeftHand';hand.position.set(.2,0,0);elbow.add(hand);
 const geometry=new THREE.BoxGeometry(.2,.2,.2);
 const count=geometry.attributes.position.count;
 const indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
 for(let i=0;i<count;i++)weights[i*4]=1;
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());root.add(mesh);
 root.updateWorldMatrix(true,true);
 const bones=[hip,shoulder,arm,elbow,hand];
 mesh.bind(new THREE.Skeleton(bones));
 return {root,bones,mesh};
}
test('actual skin bind rest beats currently bent/downward arm rotations',()=>{
 const {root,bones,mesh}=sampleRig();
 bones[2].quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.PI/3);
 bones[3].quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.54);
 root.updateWorldMatrix(true,true);
 const bind=recoverSkinBindQuaternions(root,bones);
 assert.equal(bind.size,bones.length);
 assert.ok(bind.get(bones[2].uuid).angleTo(new THREE.Quaternion())<1e-8);
 assert.ok(bind.get(bones[3].uuid).angleTo(new THREE.Quaternion())<1e-8);
 assert.ok(mesh.skeleton.boneInverses[2].isMatrix4);
 assert.equal(applySkinRestQuaternions(bones,bind),bones.length);
 for(const bone of bones)assert.ok(bone.quaternion.angleTo(new THREE.Quaternion())<1e-8);
});
test('rest correction also works when the model wrapper is moved and rotated after load',()=>{
 const {root,bones}=sampleRig();
 const bind=recoverSkinBindQuaternions(root,bones);
 root.position.set(2,3,-1);root.rotation.y=.72;
 bones[2].quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),.5);
 applySkinRestQuaternions(bones,bind);
 assert.ok(bones[2].quaternion.angleTo(new THREE.Quaternion())<1e-8);
 assert.ok(Math.abs(root.rotation.y-.72)<1e-8);
 assert.deepEqual(root.position.toArray(),[2,3,-1]);
});
test('native saved animated GLBs no longer define bind pose from current playing frame',()=>{
 const code=readFileSync('src/main.js','utf8');
 assert.ok(code.includes('state.bind = recoverSkinBindQuaternions(root,bones);'));
 assert.ok(code.includes('state.bind=recoverSkinBindQuaternions(state.root,bones);'));
 assert.ok(code.includes('applySkinRestQuaternions(state.bones,state.bind);'));
 assert.ok(code.includes('const clips=selectedAnimationClipsForExport();'));
});
test('non-skinned guide falls back to visible skeleton bone orientation',()=>{
 const root=new THREE.Group(),bone=new THREE.Bone();
 root.add(bone);bone.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.23);
 const res=recoverSkinBindQuaternions(root,[bone]);
 assert.ok(res.get(bone.uuid).angleTo(bone.quaternion)<1e-6);
});
