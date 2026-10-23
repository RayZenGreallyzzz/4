import * as THREE from 'three';

const clamp=(value,lo=0,hi=1)=>Math.min(hi,Math.max(lo,value));
const smooth=(lo,hi,v)=>{const t=clamp((v-lo)/(hi-lo));return t*t*(3-2*t)};

/**
 * A conservative skull zone (in world space) oriented along the fitted
 * neck->head axis. A nearly rigid cranium prevents face vertices from
 * blending with neck, chest and nearby limb bones. No semantic mesh labels
 * are assumed, so this is intentionally a narrow, opt-in repair.
 */
export function skullInfluence(point,neck,head,characterHeight=2){
  if(!point?.isVector3 || !neck?.isVector3 || !head?.isVector3)return 0;
  const axis=head.clone().sub(neck);
  const length=axis.length();
  const h=Math.max(0.0001,Number(characterHeight)||2);
  if(length<h*.009)return 0;
  axis.multiplyScalar(1/length);
  const offset=point.clone().sub(neck);
  const along=offset.dot(axis)/length;
  if(along<.16)return 0;
  const radial=offset.addScaledVector(axis,-offset.dot(axis)).length();
  // Keep hands near a face, broad horns and large hairstyles out of the
  // automatic skull mask. They need their own manual or connected weights.
  const radius=h*.19;
  if(radial>radius)return 0;
  return smooth(.16,.48,along)* (1-smooth(radius*.86,radius,radial));
}

export function reinforceSkullVertex(point,indices,weights,offset,headIndex,neckIndex,neck,head,height){
  const skull=skullInfluence(point,neck,head,height);
  if(skull<=.002)return false;
  let headNeckInfluence=0, foreignInfluence=0;
  for(let k=0;k<4;k++){
    const id=indices[offset+k],w=weights[offset+k]||0;
    if(id===headIndex||id===neckIndex)headNeckInfluence+=w;
    else foreignInfluence=Math.max(foreignInfluence,w);
  }
  // Only override vertices already recognized as head/neck candidates by
  // the base skinning algorithm. Avoid re-binding a raised hand to the skull.
  if(headNeckInfluence<.075 || foreignInfluence>.56)return false;
  indices[offset]=headIndex;
  weights[offset]=skull;
  indices[offset+1]=neckIndex;
  weights[offset+1]=1-skull;
  for(let k=2;k<4;k++){indices[offset+k]=0;weights[offset+k]=0}
  return true;
}

export function locateHeadRegion(bones,height){
  const headIndex=bones.findIndex(b=>/^(?:mixamorig\\d*[:_]?)?head$/i.test(b.name));
  const neckIndex=bones.findIndex(b=>/^(?:mixamorig\\d*[:_]?)?neck$/i.test(b.name));
  if(headIndex<0||neckIndex<0)return null;
  return {
    headIndex,neckIndex,
    head:bones[headIndex].getWorldPosition(new THREE.Vector3()),
    neck:bones[neckIndex].getWorldPosition(new THREE.Vector3()),
    height
  };
}

/**
 * Reinforce already-skinned GLB/AutoRig meshes on a per-mesh basis. The
 * caller controls undo snapshots and yields between chunks for Android.
 */
export async function reinforceSkinnedHead(mesh,region,{chunkVertices=4096,onChunk=()=>{},signal}={}){
  const geometry=mesh?.geometry;
  const pos=geometry?.getAttribute('position');
  const si=geometry?.getAttribute('skinIndex'),sw=geometry?.getAttribute('skinWeight');
  const bones=mesh?.skeleton?.bones;
  if(!pos||!si||!sw||!bones?.length)return 0;
  const own=locateHeadRegion(bones,region.height);
  if(!own)return 0;
  const map=mesh.matrixWorld;
  const temp=new THREE.Vector3();let affected=0;
  for(let start=0;start<pos.count;start+=chunkVertices){
    if(signal?.aborted)throw Error('Исправление весов отменено');
    const end=Math.min(start+chunkVertices,pos.count);
    for(let i=start;i<end;i++){
      temp.fromBufferAttribute(pos,i).applyMatrix4(map);
      if(reinforceSkullVertex(temp,si.array,sw.array,i*4,own.headIndex,own.neckIndex,
        own.neck,own.head,region.height))affected++;
    }
    onChunk(end,pos.count);
    if(end<pos.count)await new Promise(resolve=>setTimeout(resolve,0));
  }
  si.needsUpdate=true;sw.needsUpdate=true;
  if(affected)mesh.normalizeSkinWeights();
  return affected;
}
