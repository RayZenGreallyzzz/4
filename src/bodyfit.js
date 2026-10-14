import * as THREE from 'three';
import { HUMANOID_TEMPLATE, moveJointWorld } from './autorig.js';

// Initial fit based on real torso geometry, not the entire model bounds.
// Hair, capes and accessories behind the body should not move its spine.
export const DIRECTIONS = Object.freeze({
  'z+': {axis:'z',sign:1}, 'z-': {axis:'z',sign:-1},
  'x+': {axis:'x',sign:1}, 'x-': {axis:'x',sign:-1}
});
function quantile(values,q){
  if(!values.length)return 0;
  const s=values.slice().sort((a,b)=>a-b),i=q*(s.length-1),a=Math.floor(i),b=Math.ceil(i);
  return a===b?s[a]:s[a]*(b-i)+s[b]*(i-a);
}
export function sampleGeometry(model,maxPerMesh=1800,maxTotal=36000){
  const meshes=[];
  model.updateWorldMatrix(true,true);
  model.traverse(node=>{if(node.isMesh&&node.geometry?.attributes?.position&&node.visible!==false)meshes.push(node);});
  const limit=Math.max(24,Math.min(maxPerMesh,Math.floor(maxTotal/Math.max(1,meshes.length))));
  const points=[],tmp=new THREE.Vector3();
  for(const mesh of meshes){
    const attr=mesh.geometry.attributes.position,count=attr.count,quota=Math.min(count,limit);
    for(let j=0;j<quota;j++){
      const idx=Math.min(count-1,Math.floor((j+.5)*count/quota));
      tmp.fromBufferAttribute(attr,idx).applyMatrix4(mesh.matrixWorld);
      if(Number.isFinite(tmp.x)&&Number.isFinite(tmp.y)&&Number.isFinite(tmp.z))points.push(tmp.clone());
    }
  }
  return points;
}
export function analyzeBodyGeometry(model,direction='z+'){
  const face=DIRECTIONS[direction];
  if(!face)throw Error('Неверное направление персонажа');
  const bounds=new THREE.Box3().setFromObject(model);
  if(bounds.isEmpty())throw Error('Не удалось определить размеры геометрии');
  const height=bounds.max.y-bounds.min.y;
  if(!Number.isFinite(height)||height<=0)throw Error('Неверная высота модели');
  const points=sampleGeometry(model);
  if(points.length<12)throw Error('В модели слишком мало вершин для анализа тела');
  const lateralAxis=face.axis==='z'?'x':'z';
  const fullCenter=(bounds.min[lateralAxis]+bounds.max[lateralAxis])*.5;
  const normalizedY=p=>(p.y-bounds.min.y)/height;
  const chest=points.filter(p=>normalizedY(p)>.43&&normalizedY(p)<.81);
  const base=chest.length>=12?chest:points;
  const coreRadius=Math.min(height*.19,(bounds.max[lateralAxis]-bounds.min[lateralAxis])*.31);
  const centerCandidates=base.filter(p=>Math.abs(p[lateralAxis]-fullCenter)<coreRadius);
  const torso=centerCandidates.length>=12?centerCandidates:base;
  const lateralCenter=quantile(torso.map(p=>p[lateralAxis]),.5);
  const depths=torso.map(p=>p[face.axis]);
  const surface=quantile(depths,face.sign>0?.92:.08);
  const rear=quantile(depths,face.sign>0?.10:.90);
  const thickness=Math.abs(surface-rear);
  const inset=Math.max(height*.038,Math.min(height*.102,thickness*.19));
  const coreDepth=surface-face.sign*inset;
  const armBand=points.filter(p=>normalizedY(p)>.48&&normalizedY(p)<.79);
  const lateralRange=(armBand.length>=12?armBand:base).map(p=>p[lateralAxis]);
  const width=quantile(lateralRange,.90)-quantile(lateralRange,.10);
  const span=Math.max(.46*height,Math.min(.87*height,width));
  return {height,bounds,lateralAxis,lateralCenter,depthAxis:face.axis,forwardSign:face.sign,coreDepth,frontSurface:surface,span,sampleCount:points.length};
}
export function calculateHumanPose(model,direction='z+'){
  const info=analyzeBodyGeometry(model,direction);
  const {height,bounds,lateralAxis,lateralCenter,depthAxis,coreDepth,forwardSign,span}=info;
  const positions=new Map();
  for(const {name,lateral,y,forward} of HUMANOID_TEMPLATE){
    const p=new THREE.Vector3();
    p[lateralAxis]=lateralCenter+lateral*span*(depthAxis==='x'?-forwardSign:forwardSign);
    p.y=bounds.min.y+height*y;
    p[depthAxis]=coreDepth+forward*height*.035*forwardSign;
    if(/Foot|ToeBase/.test(name))p[depthAxis]+=.042*height*forwardSign;
    if(/Head|Neck/.test(name))p[depthAxis]+=.015*height*forwardSign;
    if(/Hand/.test(name))p[depthAxis]+=.015*height*forwardSign;
    positions.set(name,p);
  }
  return {positions,info};
}
export function fitGuideToGeometry(guide,model,direction='z+'){
  if(!guide?.bones?.size)throw Error('Сначала добавь скелет');
  const {positions,info}=calculateHumanPose(model,direction);
  guide.root.scale.setScalar(1);
  // Keep the rig anchor itself INSIDE the torso, not at the model-wide
  // bounding-box centre (which may include long hair behind the back).
  guide.root.position[info.lateralAxis]=info.lateralCenter;
  guide.root.position[info.depthAxis]=info.coreDepth;
  guide.root.position.y=info.bounds.min.y;
  guide.root.updateWorldMatrix(true,true);
  for(const [name,target] of positions){
    if(guide.bones.has(name))moveJointWorld(guide,name,target);
  }
  guide.lastFit={direction,samples:info.sampleCount,depth:info.coreDepth,span:info.span};
  return info;
}
