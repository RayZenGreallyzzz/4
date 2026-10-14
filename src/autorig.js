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
  return {root,bones,height};
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

export function serializeFit(guide,modelName) {
  if(!guide)throw Error('Шаблон отсутствует');
  return {
    schema:RIG_VERSION,
    model:modelName || null,
    units:'original Three.js GLB scene units',
    boundToMesh:false,
    skinWeights:false,
    rootPosition:guide.root.position.toArray(),
    rootScale:guide.root.scale.toArray(),
    note:'This is a fit guide, not a rigged or animated character. Skin weights must be generated and verified separately.',
    joints:[...guide.bones.entries()].map(([name,bone])=>({
      name,
      parent:bone.parent?.isBone?bone.parent.name:null,
      worldPosition:jointWorld(guide,name).toArray(),
      localPosition:bone.position.toArray()
    }))
  };
}
