import * as THREE from 'three';

export function rotationLimits(name,protectedMode=true){
 const full={x:180,y:180,z:180};
 if(!protectedMode)return full;
 const n=String(name||'').replace(/^mixamorig[0-9]*[:_]?/i,'').toLowerCase();
 // These are deliberately conservative per-axis editing guards, NOT
 // anatomical hinge detection: bone-local axes differ between rigs.
 if(n==='head')return {x:40,y:60,z:40};
 if(n==='neck')return {x:30,y:45,z:30};
 if(n==='spine'||n==='spine1'||n==='spine2')return {x:35,y:45,z:35};
 return full;
}

export function relativeBoneEuler(actualQuaternion,restQuaternion){
 const bind=restQuaternion?.isQuaternion?restQuaternion:new THREE.Quaternion();
 const delta=bind.clone().invert().multiply(actualQuaternion).normalize();
 return new THREE.Euler().setFromQuaternion(delta,'XYZ');
}

export function editedBoneQuaternion(actual,rest,axis,value,name,protectedMode=true){
 if(!['x','y','z'].includes(axis))throw Error('Неверная ось вращения');
 const bind=rest?.isQuaternion?rest:new THREE.Quaternion();
 const current=relativeBoneEuler(actual,bind);
 const limits=rotationLimits(name,protectedMode);
 const degree=THREE.MathUtils.clamp(Number(value)||0,-limits[axis],limits[axis]);
 current[axis]=THREE.MathUtils.degToRad(degree);
 return bind.clone().multiply(new THREE.Quaternion().setFromEuler(current)).normalize();
}
