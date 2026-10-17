import * as THREE from 'three';

// Inverse bind matrices are authoritative for the skeleton's rest pose.
// Importing a GLB while its bones were animated is NOT a valid way to
// determine the rest joint quaternions. Reconstruct them from skin data.
export function recoverSkinBindQuaternions(root,bones){
 const map=new Map();
 if(!root?.isObject3D || !Array.isArray(bones))return map;
 root.updateWorldMatrix(true,true);
 const bindWorld=new Map();
 root.traverse(node=>{
  if(!node.isSkinnedMesh || !node.skeleton?.bones?.length)return;
  node.skeleton.bones.forEach((b,i)=>{
   if(!b?.uuid || bindWorld.has(b.uuid))return;
   const inv=node.skeleton.boneInverses[i];
   if(!inv?.isMatrix4)return;
   const world=inv.clone().invert();
   if(world.elements.every(Number.isFinite))bindWorld.set(b.uuid,world);
  });
 });
 for(const bone of bones){
  if(!bone?.isBone)continue;
  const world=bindWorld.get(bone.uuid);
  if(!world){
   map.set(bone.uuid,bone.quaternion.clone());
   continue;
  }
  const parent=bone.parent;
  const parentWorld=bindWorld.get(parent?.uuid) ||
    (parent?.isObject3D?parent.matrixWorld:null);
  if(!parentWorld){
   map.set(bone.uuid,bone.quaternion.clone());
   continue;
  }
  try{
   const restLocal=new THREE.Matrix4().copy(parentWorld).invert().multiply(world);
   const position=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
   restLocal.decompose(position,q,scale);
   if(![q.x,q.y,q.z,q.w].every(Number.isFinite)){
    map.set(bone.uuid,bone.quaternion.clone());continue;
   }
   map.set(bone.uuid,q.normalize());
  }catch{
   map.set(bone.uuid,bone.quaternion.clone());
  }
 }
 return map;
}

// Before GLTFExporter snapshot, restore the rest rotations on GLB nodes.
// AnimationClip tracks hold the animated quaternion values separately;
// reverting the bone's CURRENT quaternion does not change their samples.
export function applySkinRestQuaternions(bones,bind){
 if(!Array.isArray(bones)||!bind)return 0;
 let count=0;
 for(const bone of bones){
  const q=bind.get(bone.uuid);
  if(!q)continue;
  bone.quaternion.copy(q);
  count++;
 }
 if(count)bones[0]?.updateWorldMatrix(true,true);
 return count;
}
