import * as THREE from 'three';

// Model placement affects the wrapper group, NEVER a Mixamo bone. It stays
// constant through all keyframes and is exported with the model as its TRS.
export function readModelPlacement(root) {
 if(!root?.isObject3D)return null;
 const euler=new THREE.Euler().setFromQuaternion(root.quaternion,'XYZ');
 return {
  position:[root.position.x,root.position.y,root.position.z],
  rotation:[euler.x,euler.y,euler.z].map(THREE.MathUtils.radToDeg),
  scale:root.scale.x
 };
}
export function setModelPlacement(root,{position,rotation,scale}={}) {
 if(!root?.isObject3D)return false;
 if(position!==undefined){
  if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))return false;
  root.position.fromArray(position.map(n=>THREE.MathUtils.clamp(n,-10000,10000)));
 }
 if(rotation!==undefined){
  if(!Array.isArray(rotation)||rotation.length!==3||!rotation.every(Number.isFinite))return false;
  root.quaternion.setFromEuler(new THREE.Euler(...rotation.map(
   n=>THREE.MathUtils.degToRad(n)),'XYZ'));
 }
 if(scale!==undefined){
  if(!Number.isFinite(scale)||scale<.01||scale>100)return false;
  root.scale.setScalar(scale);
 }
 root.updateWorldMatrix(true,true);
 return true;
}
export function resetModelPlacement(root){
 return setModelPlacement(root,{position:[0,0,0],rotation:[0,0,0],scale:1});
}
