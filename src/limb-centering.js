import * as THREE from 'three';

// Stage 4: conservative volumetric checks for nonstandard limbs. The body,
// hips, chest, neck and head are deliberately excluded.
export const LIMB_CHAINS=Object.freeze({
 leftArm:['mixamorigLeftArm','mixamorigLeftForeArm','mixamorigLeftHand'],
 rightArm:['mixamorigRightArm','mixamorigRightForeArm','mixamorigRightHand'],
 leftLeg:['mixamorigLeftLeg','mixamorigLeftFoot','mixamorigLeftToeBase'],
 rightLeg:['mixamorigRightLeg','mixamorigRightFoot','mixamorigRightToeBase']
});

export function limbNames(selection='all'){
 if(selection==='all')return [...new Set(Object.values(LIMB_CHAINS).flat())];
 if(!Object.hasOwn(LIMB_CHAINS,selection))throw Error('Неизвестная конечность');
 return [...LIMB_CHAINS[selection]];
}

export function getLimbJoints(bones,selection='all'){
 const names=limbNames(selection), found=new Map();
 for(const name of names){if(bones.has(name))found.set(name,bones.get(name));}
 return found;
}

function findWorld(bone){return bone?.getWorldPosition(new THREE.Vector3())??null}
export function axesAtJoint(bone) {
 if(!bone?.isBone)return null;
 const parent=bone.parent?.isBone ? findWorld(bone.parent):null;
 const children=bone.children.filter(child=>child.isBone);
 const a=findWorld(bone);
 const distal=children.length?findWorld(children[0]):null;
 const direction=distal&&parent?distal.clone().sub(parent):
   distal?distal.clone().sub(a):parent?a.clone().sub(parent):null;
 if(!direction || direction.lengthSq()<1e-9)return null;
 const length=direction.length();
 const tangent=direction.normalize();
 const reference=Math.abs(tangent.y)<.88?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
 const u=new THREE.Vector3().crossVectors(tangent,reference).normalize();
 const v=new THREE.Vector3().crossVectors(tangent,u).normalize();
 const neighbour=Math.min(
   parent?a.distanceTo(parent):Infinity,
   distal?a.distanceTo(distal):Infinity
 );
 return {tangent,u,v,spacing:Number.isFinite(neighbour)?neighbour:length};
}

function withDoubleSide(meshes,fn){
 const seen=new Map();
 try{
  for(const mesh of meshes){
   for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    if(!material||seen.has(material))continue;
    seen.set(material,material.side);
    material.side=THREE.DoubleSide;
   }
  }
  return fn();
 }finally{
  for(const [material,side] of seen)material.side=side;
 }
}

/**
 * Scan through a joint on a transversal axis. Entrance/exit pairs are
 * computed PER mesh (never pair a sleeve's entrance to a torso's exit).
 * Reject overly wide volumes, intersections beyond scan radius, and
 * near-zero thickness, which are signs of ambiguous/open surfaces.
 */
export function crossSection(point,axis,meshes,radius,height){
 const dir=axis.clone().normalize(),start=point.clone().addScaledVector(dir,-radius);
 const caster=new THREE.Raycaster(start,dir,.00001,2*radius+.00001);
 const hits=withDoubleSide(meshes,()=>caster.intersectObjects(meshes,false));
 const byMesh=new Map();
 for(const hit of hits){
  if(!byMesh.has(hit.object))byMesh.set(hit.object,[]);
  const value=hit.point.clone().sub(start).dot(dir);
  if(value>=0&&value<=2*radius+.001)byMesh.get(hit.object).push(value);
 }
 const proposals=[];
 for(const [mesh,distances] of byMesh){
  distances.sort((a,b)=>a-b);
  // Coincident triangles can report duplicate hits at the same location.
  const unique=[];
  for(const distance of distances)
   if(!unique.length||distance-unique[unique.length-1]>Math.max(1e-5,height*.00008))unique.push(distance);
  if(unique.length%2!==0)continue; // open/ambiguous surface
  for(let i=0;i+1<unique.length;i+=2){
    const near=unique[i],far=unique[i+1],width=far-near;
    if(width<height*.0025 || width>Math.min(2*radius,height*.24))continue;
    const midpoint=(near+far)/2;
    const offset=midpoint-radius;
    const inside=near<=radius+.00001&&far>=radius-.00001;
    proposals.push({mesh,offset,width,inside,quality:Math.abs(offset)+(inside?0:height*.006)});
  }
 }
 proposals.sort((a,b)=>a.quality-b.quality);
 return proposals[0]??null;
}

/**
 * Alternate the two axes: an off-mesh joint may miss the first ray,
 * but the second ray can intersect the limb and bring it into the volume.
 * Never silently move a joint when both transverse cross-sections cannot
 * eventually be verified as containing the joint.
 */
export function centerJointInMesh(bone,meshes,height){
 const basis=axesAtJoint(bone);
 if(!basis)return {status:'uncertain',reason:'нет направления кости'};
 const initial=findWorld(bone);
 const radius=Math.min(height*.22,Math.max(height*.045,basis.spacing*.86));
 if(!(radius>0))return {status:'uncertain',reason:'нет радиуса'};
 const p=initial.clone();
 let passes=0;
 for(let attempt=0;attempt<3;attempt++){
  for(const axis of [basis.u,basis.v]){
   const section=crossSection(p,axis,meshes,radius,height);
   if(section){
    p.addScaledVector(axis,section.offset);
    passes++;
   }
  }
 }
 // Prove proposed position lies within valid bounded sections of the same
 // local limb after re-centering. Both transverse directions must intersect.
 const a=crossSection(p,basis.u,meshes,radius,height);
 const b=crossSection(p,basis.v,meshes,radius,height);
 if(!a?.inside||!b?.inside||a.mesh!==b.mesh)
  return {status:'uncertain',reason:'не найдено единое замкнутое сечение конечности'};
 const jump=p.distanceTo(initial);
 const maxJump=Math.min(height*.18,basis.spacing*.65);
 if(jump>maxJump)return {status:'uncertain',reason:'слишком большое смещение'};
 if(jump<height*.001)return {status:'inside',point:initial,offset:0,passes};
 return {status:'recentered',point:p,offset:jump,passes};
}

export async function scanLimbJoints(bones,modelRoot,selection='all',{
 height,onProgress=()=>{},signal
}={}){
 if(!modelRoot)throw Error('Модель не загружена');
 modelRoot.updateWorldMatrix(true,true);
 const h=height||new THREE.Box3().setFromObject(modelRoot).getSize(new THREE.Vector3()).y;
 if(!Number.isFinite(h)||h<=0)throw Error('Неизвестный рост модели');
 const meshes=[];
 modelRoot.traverse(node=>{
  if(node.isMesh&&node.visible&&node.geometry?.attributes?.position)meshes.push(node);
 });
 if(!meshes.length)throw Error('Нет видимой геометрии для анализа');
 const result=new Map(),joints=getLimbJoints(bones,selection);
 let done=0;
 for(const [name,bone] of joints){
  if(signal?.aborted)throw Error('Проверка отменена');
  const value=centerJointInMesh(bone,meshes,h);
  result.set(name,value);
  onProgress(++done,joints.size,name,value);
  // Yield between joints; never allocate per-vertex weight maps.
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 return result;
}
