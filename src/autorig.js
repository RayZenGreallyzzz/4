import * as THREE from 'three';

// Stage 1 of AutoRig: a positioned hierarchy only. This is deliberately
// NOT a SkinnedMesh or a claim of successful automatic weight calculation.
export const RIG_VERSION = 'animation-studio/fit-v1';

// Character left/right relative to a character facing the viewer (+Z).
// Pose is a relaxed A-stance, useful for hand-adjustment on scanned GLBs.
const specs = [
  ['Hips',null,0,.525,0],
  ['Spine','Hips',0,.64,0],
  ['Spine1','Spine',0,.71,0],
  ['Spine2','Spine1',0,.79,0],
  ['Neck','Spine2',0,.865,0],
  ['Head','Neck',0,.93,0],
  ['LeftShoulder','Spine2',+.20,.802,0],
  ['LeftArm','LeftShoulder',+.28,.758,0],
  ['LeftForeArm','LeftArm',+.40,.67,0],
  ['LeftHand','LeftForeArm',+.50,.585,0],
  ['RightShoulder','Spine2',-.20,.802,0],
  ['RightArm','RightShoulder',-.28,.758,0],
  ['RightForeArm','RightArm',-.40,.67,0],
  ['RightHand','RightForeArm',-.50,.585,0],
  ['LeftUpLeg','Hips',+.115,.49,0],
  ['LeftLeg','LeftUpLeg',+.12,.29,0],
  ['LeftFoot','LeftLeg',+.12,.075,.015],
  ['LeftToeBase','LeftFoot',+.12,.035,.075],
  ['RightUpLeg','Hips',-.115,.49,0],
  ['RightLeg','RightUpLeg',-.12,.29,0],
  ['RightFoot','RightLeg',-.12,.075,.015],
  ['RightToeBase','RightFoot',-.12,.035,.075]
];

export const JOINTS = specs.map(([part])=>'mixamorig'+part);
export const HUMANOID_TEMPLATE = specs.map(([part,parent,lateral,y,forward])=>({
  name:'mixamorig'+part,
  parent:parent?'mixamorig'+parent:null,lateral,y,forward
}));

export function guessPositions(bounds) {
  if (!(bounds instanceof THREE.Box3) || bounds.isEmpty()) throw Error('Нужна модель для определения размеров');
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (size.y <= 0 || !Number.isFinite(size.y)) throw Error('Невозможно определить высоту модели');
  const h = size.y;
  const spread = Math.max(Math.min(size.x, h*1.1), h*.40); // body width incl. arms
  const depth = Math.max(.06*h,Math.min(size.z,.6*h)*.14);
  const positions = new Map();
  for (const [part, parent, lateral, y, forward] of specs) {
    const name='mixamorig'+part;
    positions.set(name, {
      name,
      parent:parent?'mixamorig'+parent:null,
      position:new THREE.Vector3(center.x + lateral*spread, bounds.min.y+y*h,center.z+forward*depth)
    });
  }
  return {height:h,spread,positions};
}

export function createGuide(bounds) {
  const {height,positions} = guessPositions(bounds);
  const root = new THREE.Group();
  root.name = 'AutoRigFit_guide_not_skinned';
  // Anchor the guide at ground level, directly under the character centre.
  // Scaling now enlarges the skeleton around the body instead of world zero.
  const hip = positions.get('mixamorigHips').position;
  root.position.set(hip.x, bounds.min.y, hip.z);
  const bones = new Map();
  for (const name of JOINTS) {
    const spec=positions.get(name);
    const bone=new THREE.Bone();
    bone.name=name;
    const parent=spec.parent?bones.get(spec.parent):root;
    const worldPos=spec.position;
    const parentWorld=spec.parent?positions.get(spec.parent).position:root.position;
    bone.position.copy(worldPos).sub(parentWorld);
    parent.add(bone);
    bones.set(name,bone);
  }
  root.updateMatrixWorld(true);
  return {root,bones,height,chains:[]};
}

export function moveJointWorld(guide,name,world) {
  if (!guide || !world?.isVector3) return false;
  if (name === '__root__') {
    guide.root.position.copy(world);
    guide.root.updateMatrixWorld(true);
    return true;
  }
  const bone=guide.bones.get(name);
  if (!bone) return false;
  const p=bone.parent;
  p.updateWorldMatrix(true,false);
  bone.position.copy(p.worldToLocal(world.clone()));
  guide.root.updateMatrixWorld(true);
  return true;
}

export function jointWorld(guide,name) {
  if (guide && name === '__root__') return guide.root.getWorldPosition(new THREE.Vector3());
  const bone=guide?.bones.get(name);
  if(!bone) return null;
  bone.updateWorldMatrix(true,false);
  return bone.getWorldPosition(new THREE.Vector3());
}


/**
 * Mirror a manually placed skeleton joint across the character's mid-plane.
 * A humanoid facing +/-Z uses X as its left-right axis; one facing +/-X
 * uses Z instead. Mirror joint POSITION, not quaternion/animation/mesh skin.
 * This is opt-in and never overwrites intentionally asymmetric poses unless
 * the user enables the "Зеркально" checkbox.
 */
export function oppositeGuideJointName(name){
 if(typeof name!=='string'||name==='__root__')return null;
 if(name.includes('Left'))return name.replace('Left','Right');
 if(name.includes('Right'))return name.replace('Right','Left');
 return null;
}
export function mirrorGuideJoint(guide,name){
 if(!guide?.root||!guide.bones)return false;
 const opposite=oppositeGuideJointName(name);
 if(!opposite||!guide.bones.has(opposite)||!guide.bones.has(name))return false;
 const reference=jointWorld(guide,name);
 const pivot=jointWorld(guide,'mixamorigHips');
 if(!reference||!pivot)return false;
 guide.root.updateWorldMatrix(true,true);
 const local=guide.root.worldToLocal(reference.clone());
 const centre=guide.root.worldToLocal(pivot.clone());
 const axis=/^x[+-]$/.test(guide.lastFit?.direction||'z+')?'z':'x';
 local[axis]=2*centre[axis]-local[axis];
 return moveJointWorld(guide,opposite,guide.root.localToWorld(local));
}

const customTypes = {
  tail: {base:'Tail',parent:'mixamorigHips',start:[0,-.025,-.10],end:[0,-.16,-.47]},
  earLeft: {base:'LeftEar',parent:'mixamorigHead',start:[+.06,+.015,0],end:[+.11,+.16,0]},
  earRight: {base:'RightEar',parent:'mixamorigHead',start:[-.06,+.015,0],end:[-.11,+.16,0]},
  wingLeft: {base:'LeftWing',parent:'mixamorigSpine2',start:[+.13,0,-.07],end:[+.51,+.03,-.16]},
  wingRight: {base:'RightWing',parent:'mixamorigSpine2',start:[-.13,0,-.07],end:[-.51,+.03,-.16]},
  hair: {base:'Hair',parent:'mixamorigHead',start:[0,+.065,-.045],end:[0,-.25,-.13]},
  tentacle: {base:'Tentacle',parent:'mixamorigHips',start:[+.09,-.02,-.06],end:[+.2,-.26,-.44]}
};
export const EXTRA_CHAIN_TYPES = Object.keys(customTypes);

// Places a chain as true nested THREE.Bones inside the existing guide.
// It deliberately does not bind any mesh to the newly introduced bones.
export function addGuideChain(guide,type='tail',count=5) {
  if(!guide?.root || !guide?.bones?.size) throw new Error('Сначала добавь гуманоидный скелет');
  const spec=customTypes[type];
  if(!spec) throw new Error('Неизвестный тип цепочки');
  const amount=Number(count);
  if(!Number.isInteger(amount)||amount<2||amount>12)throw new Error('Количество костей: от 2 до 12');
  const parent=guide.bones.get(spec.parent);
  if(!parent)throw new Error('Не найдена родительская кость: '+spec.parent);
  const base=spec.base;
  let number=1;
  const prefix=()=>base+(number===1?'':number)+'_';
  while([...guide.bones.keys()].some(name=>name.startsWith(prefix())))number++;
  const id=base+(number===1?'':number);
  const anchor=jointWorld(guide,spec.parent);
  const start=anchor.clone().add(new THREE.Vector3(...spec.start).multiplyScalar(guide.height));
  const end=anchor.clone().add(new THREE.Vector3(...spec.end).multiplyScalar(guide.height));
  const names=[];
  let owner=parent;
  for(let i=0;i<amount;i++){
    const name=id+'_'+String(i+1).padStart(2,'0');
    const bone=new THREE.Bone();
    bone.name=name;
    const desired=start.clone().lerp(end,i/(amount-1));
    owner.add(bone);
    owner.updateWorldMatrix(true,false);
    bone.position.copy(owner.worldToLocal(desired));
    guide.bones.set(name,bone);
    names.push(name);
    owner=bone;
  }
  guide.root.updateMatrixWorld(true,true);
  const chain={id,type,parent:spec.parent,names};
  if(!guide.chains)guide.chains=[];
  guide.chains.push(chain);
  return chain;
}

export function removeGuideChain(guide,id) {
  const idx=guide?.chains?.findIndex(entry=>entry.id===id)??-1;
  if(idx<0)return false;
  const [chain]=guide.chains.splice(idx,1);
  guide.bones.get(chain.names[0])?.removeFromParent();
  for(const name of chain.names)guide.bones.delete(name);
  guide.root.updateMatrixWorld(true,true);
  return true;
}

export function restoreFit(guide,data) {
  if(!guide?.bones?.size)throw Error('Сначала создай шаблон');
  if(!data || data.schema!==RIG_VERSION || !Array.isArray(data.joints))
    throw Error('Это не файл подгонки Animation Studio');
  if(data.joints.length<JOINTS.length)throw Error('В файле отсутствуют основные суставы');
  const requested=new Map(data.joints.map(item=>[item.name,item]));
  for(const name of JOINTS){
    const item=requested.get(name);
    if(!item || !Array.isArray(item.localPosition)||item.localPosition.length!==3 ||
      !item.localPosition.every(Number.isFinite))throw Error('Не хватает координат '+name);
  }
  for(const chain of data.chains||[]){
    if(!chain || !Array.isArray(chain.bones)||chain.bones.length<2||chain.bones.length>12)
      throw Error('В файле некорректная цепочка');
    const built=addGuideChain(guide,chain.type,chain.bones.length);
    if(built.id!==chain.id || built.names.some((n,i)=>n!==chain.bones[i]))
      throw Error('Названия цепочки не совпадают с шаблоном');
  }
  if(Array.isArray(data.rootPosition) && data.rootPosition.length===3 &&
    data.rootPosition.every(Number.isFinite))guide.root.position.fromArray(data.rootPosition);
  if(Array.isArray(data.rootScale)&&data.rootScale.length===3 &&
    data.rootScale.every(x=>Number.isFinite(x)&&x>0&&x<20))
    guide.root.scale.fromArray(data.rootScale);
  for(const [name,bone] of guide.bones){
    const item=requested.get(name);
    if(item && Array.isArray(item.localPosition) && item.localPosition.length===3 &&
      item.localPosition.every(Number.isFinite))bone.position.fromArray(item.localPosition);
  }
  guide.lastFit=data.geometryFit || null;
  guide.root.updateWorldMatrix(true,true);
  return {joints:guide.bones.size,chains:guide.chains?.length||0};
}

export function serializeFit(guide,modelName) {
  if(!guide)throw Error('Шаблон отсутствует');
  return {
    schema:RIG_VERSION,
    model:modelName || null,
    units:'original Three.js GLB scene units',
    boundToMesh:false,
    skinWeights:false,
    geometryFit:guide.lastFit||null,
    rootPosition:guide.root.position.toArray(),
    rootScale:guide.root.scale.toArray(),
    chains:(guide.chains||[]).map(chain=>({id:chain.id,type:chain.type,parent:chain.parent,bones:[...chain.names]})),
    note:'This is a fit guide, not a rigged or animated character. Skin weights must be generated and verified separately.',
    joints:[...guide.bones.entries()].map(([name,bone])=>({
      name,
      parent:bone.parent?.isBone?bone.parent.name:null,
      worldPosition:jointWorld(guide,name).toArray(),
      localPosition:bone.position.toArray()
    }))
  };
}
