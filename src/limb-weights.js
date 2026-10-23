import * as THREE from 'three';

// Conservative repair: never reskin the full character or redistribute the
// existing good head, neck, torso, hip, or upper-leg weights.
export const LIMB_GROUPS=Object.freeze({
 leftArm:['LeftArm','LeftForeArm','LeftHand'],
 rightArm:['RightArm','RightForeArm','RightHand'],
 leftLeg:['LeftLeg','LeftFoot','LeftToeBase'],
 rightLeg:['RightLeg','RightFoot','RightToeBase']
});
const ORDER=Object.keys(LIMB_GROUPS);
const FRONTIER={leftArm:'LeftShoulder',rightArm:'RightShoulder',
 leftLeg:'LeftUpLeg',rightLeg:'RightUpLeg'};

export function normalBoneName(name=''){
 return String(name).replace(/^.*?(?:mixamorig\d*[:_]?)/i,'').replace(/^.*[:|]/,'')
  .replace(/[^a-z0-9]/gi,'').toLowerCase();
}

function segmentDistanceSquared(p,a,b){
 const vx=b.x-a.x,vy=b.y-a.y,vz=b.z-a.z;
 const wx=p.x-a.x,wy=p.y-a.y,wz=p.z-a.z;
 const len=vx*vx+vy*vy+vz*vz;
 const t=len>1e-12?Math.max(0,Math.min(1,(vx*wx+vy*wy+vz*wz)/len)):0;
 const dx=wx-t*vx,dy=wy-t*vy,dz=wz-t*vz;
 return dx*dx+dy*dy+dz*dz;
}
const dist=(a,b)=>a.distanceTo(b);
function groupFeatures(bones,names,indices){
 const segments=[];
 for(let i=0;i<names.length;i++){
  const bone=bones.get(names[i].toLowerCase());
  const a=bone.getWorldPosition(new THREE.Vector3());
  const child=i+1<names.length?bones.get(names[i+1].toLowerCase()):null;
  let b=child?.getWorldPosition(new THREE.Vector3());
  if(!b){
    const prev=i>0?bones.get(names[i-1].toLowerCase())?.getWorldPosition(new THREE.Vector3()):null;
    const direction=prev?a.clone().sub(prev):new THREE.Vector3(0,-1,0);
    if(direction.lengthSq()<1e-9)direction.set(0,-1,0);
    b=a.clone().add(direction.multiplyScalar(.35));
  }
  segments.push({index:indices.get(bone),a,b});
 }
 return segments;
}

export function buildLimbWeightContext(boneArray,height){
 if(!Array.isArray(boneArray)||!boneArray.length)return null;
 const boneIndices=new Map(boneArray.map((bone,i)=>[bone,i]));
 const byName=new Map(boneArray.map(b=>{
  b.updateWorldMatrix(true,false);
  return [normalBoneName(b.name),b];
 }));
 const groups={};
 for(const [group,names] of Object.entries(LIMB_GROUPS)){
  if(!names.every(name=>byName.has(name.toLowerCase())))continue;
  groups[group]=groupFeatures(byName,names,boneIndices);
 }
 if(Object.keys(groups).length<2)return null;
 const spineNames=['Hips','Spine','Spine1','Spine2','Neck','Head'];
 const central=spineNames.map(name=>byName.get(name.toLowerCase()))
   .filter(Boolean).map(b=>b.getWorldPosition(new THREE.Vector3()));
 // Don't use body-size bounds for skinny limbs; apply height-scaled maximums.
 return {groups,central,h:Math.max(height||2,.01),
  order:ORDER.filter(x=>groups[x]),byName,
  parent:Object.fromEntries(Object.entries(FRONTIER).map(([k,name])=>
   [k,boneIndices.get(byName.get(name.toLowerCase()))??-1]))};
}

function bestDistance(p,segments){
 let d=Infinity;
 for(const seg of segments)d=Math.min(d,
   segmentDistanceSquared(p,seg.a,seg.b));
 return Math.sqrt(d);
}
export function classifyLimbVertex(p,context,selection='all'){
 if(!context)return null;
 const candidates=context.order.map(name=>({
  name,dist:bestDistance(p,context.groups[name])
 })).sort((a,b)=>a.dist-b.dist);
 if(!candidates.length)return null;
 const best=candidates[0],other=candidates[1];
 const radius=context.h*(best.name.endsWith('Arm') ? .092 : .075);
 if(best.dist>radius)return null;
 // A point behind the beginning of an upper arm or shin often belongs
 // to the torso/hip. Don't steal nearby clothing from these stable regions.
 const proximal=context.groups[best.name][0];
 const along=proximal.b.clone().sub(proximal.a);
 const len2=along.lengthSq();
 if(len2>1e-10){
   const t=p.clone().sub(proximal.a).dot(along)/len2;
   if(t<-.12)return null;
 }
 // Crossed limbs or overlapping meshes: DO NOT guess ownership.
 if(other && best.dist+context.h*.014>other.dist*.86)return null;
 // Near the chest/hips we should not seize vertices from working skin areas.
 if(context.central.length){
  let center=Infinity;
  for(const q of context.central)center=Math.min(center,dist(p,q));
  if(center<best.dist+context.h*.02)return null;
 }
 if(selection!=='all'&&selection!==best.name)return null;
 return best.name;
}

export function computeLimbVertexWeights(p,context,group){
 const segments=context.groups[group];
 if(!segments)return null;
 // Promote distal hands/feet/tips to rigid influence when a vertex projects
 // past the joint: long claws should not stretch between hand and forearm.
 const end=segments[segments.length-1];
 const previous=segments[segments.length-2];
 const start=previous.a,tip=previous.b;
 const axis=tip.clone().sub(start),length2=axis.lengthSq();
 if(length2>1e-10){
  const t=p.clone().sub(start).dot(axis)/length2;
  const lineDist=Math.sqrt(segmentDistanceSquared(p,start,tip));
  if(t>=.88&&lineDist<context.h*.065)
   return [{id:end.index,weight:1}];
 }
 const scores=segments.map(seg=>{
  const d2=segmentDistanceSquared(p,seg.a,seg.b);
  return {id:seg.index,score:1/Math.pow(d2+Math.pow(context.h*.017,2),1.5)};
 }).sort((a,b)=>b.score-a.score);
 const total=scores.reduce((sum,s)=>sum+s.score,0);
 if(!Number.isFinite(total)||total<=0)return null;
 return scores.map(s=>({id:s.id,weight:s.score/total}));
}

export function repairOneLimbVertex(p,oldIds,oldWeights,context,selection='all'){
 const group=classifyLimbVertex(p,context,selection);
 if(!group)return null;
 const targetIds=new Set(context.groups[group].map(s=>s.index));
 const members=context.order.flatMap(g=>context.groups[g].map(s=>s.index));
 const family=new Set(members);
 let hasLimb=false,wrongSide=0, protectedWeight=0;
 for(let k=0;k<4;k++){
  const id=oldIds[k],w=oldWeights[k];
  if(family.has(id)&&w>.015)hasLimb=true;
  if(family.has(id)&&!targetIds.has(id))wrongSide+=w;
  if(!family.has(id))protectedWeight+=w;
 }
 // This is a repair, not a full rebinder. If a vertex has no limb influence,
 // do not steal it from an established head/chest region.
 if(!hasLimb)return null;
 const newWeights=computeLimbVertexWeights(p,context,group);
 if(!newWeights)return null;
 // Don't rewrite correct non-target regions except clearly distal extremities.
 const rigid=newWeights.length===1&&newWeights[0].weight===1;
 if(protectedWeight>.8 || (!rigid&&protectedWeight>.55))return null;
 if(!rigid && wrongSide<.015 && protectedWeight>.4)return null;
 const ids=new Uint16Array(4),weights=new Float32Array(4);
 newWeights.slice(0,4).forEach((w,i)=>{ids[i]=w.id;weights[i]=w.weight});
 return {group,ids,weights,wrongSide,rigid};
}

export async function repairLimbWeightsOnMesh(mesh,context,{
 selection='all',chunkVertices=4096,onProgress=()=>{},signal
}={}){
 const geo=mesh?.geometry, pos=geo?.getAttribute('position');
 const index=geo?.getAttribute('skinIndex'),weight=geo?.getAttribute('skinWeight');
 if(!mesh?.isSkinnedMesh||!pos||!index||!weight||
  index.itemSize!==4||weight.itemSize!==4||
  index.isInterleavedBufferAttribute||weight.isInterleavedBufferAttribute)
  return {processed:0,changed:0,crossSide:0,rigid:0,unclassified:0};
 // Read/write using normalized aware BufferAttribute accessors for imported
 // GLBs (Uint8 and Uint16 normalized skin weights).
 const count=pos.count, point=new THREE.Vector3(),oldIds=new Uint16Array(4),
  oldWeights=new Float32Array(4);
 const reads=['getX','getY','getZ','getW'];
 const stats={processed:0,changed:0,crossSide:0,rigid:0,unclassified:0};
 for(let start=0;start<count;start+=Math.max(128,chunkVertices|0)){
  if(signal?.aborted)throw Error('Авто-веса отменены');
  const end=Math.min(count,start+Math.max(128,chunkVertices|0));
  for(let i=start;i<end;i++){
   point.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
   for(let k=0;k<4;k++){
    oldIds[k]=index[reads[k]](i);
    oldWeights[k]=weight[reads[k]](i);
   }
   const repaired=repairOneLimbVertex(point,oldIds,oldWeights,context,selection);
   if(!repaired){stats.unclassified++;continue}
   index.setXYZW(i,...repaired.ids);
   weight.setXYZW(i,...repaired.weights);
   stats.changed++;
   if(repaired.wrongSide>.02)stats.crossSide++;
   if(repaired.rigid)stats.rigid++;
  }
  stats.processed=end;
  onProgress(stats,count);
  if(end<count)await new Promise(resolve=>setTimeout(resolve,0));
 }
 index.needsUpdate=true;weight.needsUpdate=true;
 if(stats.changed)mesh.normalizeSkinWeights();
 return stats;
}

// Read-only diagnostic: detect significant influence of the selected
// bone(s) on vertices closest to another physical limb.
export async function diagnoseCrossLimbWeights(mesh,context,{
 selection='all',chunkVertices=8192,onProgress=()=>{}
}={}){
 const geo=mesh.geometry,pos=geo?.getAttribute('position'),
  si=geo?.getAttribute('skinIndex'),sw=geo?.getAttribute('skinWeight');
 if(!pos||!si||!sw)return {scanned:0,foreign:0,ambiguous:0};
 const reads=['getX','getY','getZ','getW'],p=new THREE.Vector3();
 const stats={scanned:0,foreign:0,ambiguous:0};
 for(let start=0;start<pos.count;start+=chunkVertices){
  const end=Math.min(pos.count,start+chunkVertices);
  for(let i=start;i<end;i++){
   p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
   const region=classifyLimbVertex(p,context,selection);
   if(!region){stats.ambiguous++;continue}
   const target=new Set(context.groups[region].map(s=>s.index));
   const other=new Set(context.order.filter(g=>g!==region)
     .flatMap(g=>context.groups[g].map(s=>s.index)));
   let foreign=0;
   for(let k=0;k<4;k++)
    if(other.has(si[reads[k]](i))&&!target.has(si[reads[k]](i)))
      foreign+=sw[reads[k]](i);
   if(foreign>.07)stats.foreign++;
  }
  stats.scanned=end;onProgress(stats,pos.count);
  if(end<pos.count)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return stats;
}
