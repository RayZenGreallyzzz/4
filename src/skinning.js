import * as THREE from 'three';
import {locateHeadRegion,reinforceSkullVertex} from './head-weights.js';

// Offline tablet AutoSkin. Work in small batches so large assets (700k+
// vertices) do not freeze the UI. The original mesh/geometry is preserved for
// rollback and buffer attributes are SHARED rather than deep-copied.
const DEFAULT_MAX_EXTRA_BYTES = 80*1024*1024; // weights+indices, ~3.5m verts
const DEFAULT_CHUNK_VERTICES = 8192;
const yieldToUI = () => new Promise(resolve=>setTimeout(resolve,0));

function collectSegments(bones){
  return bones.map(bone=>{
    const a=bone.getWorldPosition(new THREE.Vector3());
    const children=bone.children.filter(x=>x.isBone);
    const endpoints=children.length
      ? children.map(child=>child.getWorldPosition(new THREE.Vector3()))
      : [a.clone()];
    return {a,endpoints};
  });
}
function squareDistanceToLine(p,a,b){
  const abx=b.x-a.x,aby=b.y-a.y,abz=b.z-a.z;
  const apx=p.x-a.x,apy=p.y-a.y,apz=p.z-a.z;
  const len=abx*abx+aby*aby+abz*abz;
  const t=len>1e-12?Math.max(0,Math.min(1,(apx*abx+apy*aby+apz*abz)/len)):0;
  const dx=apx-abx*t,dy=apy-aby*t,dz=apz-abz*t;
  return dx*dx+dy*dy+dz*dz;
}

// Sort 4 strongest influences in place: no per-vertex Map / array / Vector3
// allocations. This matters on low-memory Android with high-poly GLBs.
function setInfluences(point,segments,smooth,indices,weights,offset,topIds,topStrength){
  topStrength.fill(-1);
  topIds.fill(0);
  for(let i=0;i<segments.length;i++){
    const seg=segments[i];
    let d2=Infinity;
    for(let j=0;j<seg.endpoints.length;j++){
      const d=squareDistanceToLine(point,seg.a,seg.endpoints[j]);
      if(d<d2)d2=d;
    }
    const base=d2+smooth;
    const score=1/(base*Math.sqrt(base));
    for(let j=0;j<4;j++){
      if(score<=topStrength[j])continue;
      for(let k=3;k>j;k--){
        topIds[k]=topIds[k-1];
        topStrength[k]=topStrength[k-1];
      }
      topIds[j]=i;
      topStrength[j]=score;
      break;
    }
  }
  let sum=0;
  for(let j=0;j<4;j++)if(topStrength[j]>0)sum+=topStrength[j];
  for(let j=0;j<4;j++){
    indices[offset+j]=topIds[j];
    weights[offset+j]=sum>0&&topStrength[j]>0?topStrength[j]/sum:0;
  }
}

function skinGeometryView(original,indices,weights){
  // BufferGeometry.clone() duplicates ALL position, normal, UV, indices and
  // morph buffers. For a 730k-vertex character this is a large memory spike.
  // A separate geometry container can safely reference unchanged buffers.
  const out=new THREE.BufferGeometry();
  out.name=original.name;
  for(const [name,attribute] of Object.entries(original.attributes)){
    if(name==='skinIndex'||name==='skinWeight')continue;
    out.setAttribute(name,attribute);
  }
  if(original.index)out.setIndex(original.index);
  out.morphAttributes={};
  for(const [name,attributes] of Object.entries(original.morphAttributes))
    out.morphAttributes[name]=attributes.slice();
  out.morphTargetsRelative=original.morphTargetsRelative;
  out.groups=original.groups.map(g=>({...g}));
  out.drawRange={...original.drawRange};
  out.boundingBox=original.boundingBox?.clone()??null;
  out.boundingSphere=original.boundingSphere?.clone()??null;
  out.userData={...original.userData};
  out.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  out.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  return out;
}
function createWeightTask(geometry,matrixWorld,bones,characterHeight){
  const pos=geometry?.attributes?.position;
  if(!geometry?.isBufferGeometry || !pos)throw Error('Меш не имеет вершин');
  const count=pos.count;
  if(!count)throw Error('Пустая геометрия');
  if(!bones?.length)throw Error('В скелете нет костей');
  if(bones.length>65535)throw Error('Слишком много костей');
  for(const bone of bones)bone.updateWorldMatrix(true,false);
  return {
    geometry,pos,count,matrixWorld:matrixWorld.clone(),
    segments:collectSegments(bones),
    indices:new Uint16Array(count*4),
    weights:new Float32Array(count*4),
    softness:Math.max(.0002,characterHeight*.018)**2,
    headRegion:locateHeadRegion(bones,characterHeight),
    temp:new THREE.Vector3(),
    topIds:new Uint16Array(4),
    topStrength:new Float64Array(4)
  };
}
function runWeightChunk(task,begin,end){
  const {pos,matrixWorld,segments,indices,weights,softness,temp,topIds,topStrength,headRegion}=task;
  for(let i=begin;i<end;i++){
    temp.fromBufferAttribute(pos,i).applyMatrix4(matrixWorld);
    setInfluences(temp,segments,softness,indices,weights,i*4,topIds,topStrength);
    if(headRegion)reinforceSkullVertex(temp,indices,weights,i*4,headRegion.headIndex,
      headRegion.neckIndex,headRegion.neck,headRegion.head,headRegion.height);
  }
}
function completeTask(task){
  return skinGeometryView(task.geometry,task.indices,task.weights);
}

// Keep synchronous API for small-model callers / diagnostic tests.
export function weightGeometry(geometry,matrixWorld,bones,characterHeight=2){
  const task=createWeightTask(geometry,matrixWorld,bones,characterHeight);
  runWeightChunk(task,0,task.count);
  return completeTask(task);
}
export async function weightGeometryChunked(geometry,matrixWorld,bones,characterHeight,{
  chunkVertices=DEFAULT_CHUNK_VERTICES,onChunk=()=>{},signal
}={}){
  const task=createWeightTask(geometry,matrixWorld,bones,characterHeight);
  const batch=Math.max(256,Math.min(32768,Math.floor(chunkVertices)||DEFAULT_CHUNK_VERTICES));
  for(let start=0;start<task.count;start+=batch){
    if(signal?.aborted)throw Error('Привязка отменена');
    const end=Math.min(task.count,start+batch);
    runWeightChunk(task,start,end);
    onChunk(end,task.count);
    if(end<task.count)await yieldToUI();
  }
  return completeTask(task);
}

function skinnedCopy(mesh,geometry){
  const skin=new THREE.SkinnedMesh(geometry,mesh.material);
  skin.name=mesh.name;
  skin.uuid=mesh.uuid;
  skin.position.copy(mesh.position);
  skin.quaternion.copy(mesh.quaternion);
  skin.scale.copy(mesh.scale);
  skin.matrixAutoUpdate=mesh.matrixAutoUpdate;
  if(!mesh.matrixAutoUpdate)skin.matrix.copy(mesh.matrix);
  skin.visible=mesh.visible;
  skin.renderOrder=mesh.renderOrder;
  skin.castShadow=mesh.castShadow;
  skin.receiveShadow=mesh.receiveShadow;
  skin.frustumCulled=false;
  skin.userData={...mesh.userData};
  if(mesh.morphTargetInfluences){
    skin.morphTargetInfluences=[...mesh.morphTargetInfluences];
    skin.morphTargetDictionary={...mesh.morphTargetDictionary};
  }
  return skin;
}
function replaceMesh(original,replacement){
  const parent=original.parent;
  if(!parent)throw Error('Меш без родителя');
  const index=parent.children.indexOf(original);
  parent.add(replacement);
  parent.remove(original);
  const inserted=parent.children.indexOf(replacement);
  parent.children.splice(inserted,1);
  parent.children.splice(index,0,replacement);
}

export async function bindRigToMeshes(modelRoot,guide,{
  onProgress=()=>{},maxVertices=Infinity,maxExtraBytes=DEFAULT_MAX_EXTRA_BYTES,
  chunkVertices=DEFAULT_CHUNK_VERTICES,signal
}={}){
  if(!modelRoot||!guide?.root||!guide?.bones?.size)
    throw Error('Загрузи модель и подгони скелет');
  if(guide.root===modelRoot||modelRoot.getObjectById(guide.root.id))
    throw Error('Этот скелет уже привязан');
  const meshes=[];
  modelRoot.traverse(obj=>{
    if(obj.isSkinnedMesh)throw Error('Персонаж уже содержит привязанные меши');
    if(obj.isMesh&&obj.geometry?.attributes?.position)meshes.push(obj);
  });
  const total=meshes.reduce((sum,m)=>sum+m.geometry.attributes.position.count,0);
  if(!total)throw Error('У модели нет геометрии для привязки');
  // 4 uint16 indices + 4 float32 weights = 24 extra bytes/vertex.
  const needed=total*24;
  if(total>maxVertices||needed>maxExtraBytes)
    throw Error('Слишком большая модель: '+total.toLocaleString('ru-RU')+
      ' вершин. Для весов нужно примерно '+Math.ceil(needed/1048576)+
      ' МБ памяти. Облегчи модель перед привязкой.');
  const bones=[...guide.bones.values()];
  if(bones.length>65535)throw Error('Слишком много костей');
  modelRoot.updateWorldMatrix(true,true);
  guide.root.updateWorldMatrix(true,true);
  const skeleton=new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  const replacements=[];
  let processed=0,attached=false;
  const oldGuideParent=guide.root.parent;
  try{
    onProgress({processed,total,percentage:0});
    for(const mesh of meshes){
      const geometry=await weightGeometryChunked(mesh.geometry,mesh.matrixWorld,bones,guide.height,{
        chunkVertices,signal,
        onChunk:(localCount,localTotal)=>{
          onProgress({
            processed:processed+localCount,total,
            percentage:Math.floor((processed+localCount)/total*100)
          });
        }
      });
      if(signal?.aborted){geometry.dispose();throw Error('Привязка отменена');}
      const bound=skinnedCopy(mesh,geometry);
      replaceMesh(mesh,bound);
      bound.updateWorldMatrix(true,false);
      bound.bind(skeleton,bound.matrixWorld.clone());
      bound.normalizeSkinWeights();
      replacements.push({original:mesh,bound,geometry});
      processed+=geometry.attributes.position.count;
      await yieldToUI();
    }
    // Attach armature only AFTER successfully generating all skin attributes.
    modelRoot.attach(guide.root);
    attached=true;
    modelRoot.updateWorldMatrix(true,true);
    skeleton.calculateInverses();
    for(const {bound} of replacements)bound.bind(skeleton,bound.matrixWorld.clone());
    onProgress({processed,total,percentage:100});
    return {skeleton,bones,vertices:total,meshes:replacements.length,armature:guide.root};
  }catch(error){
    for(const {original,bound,geometry} of replacements.reverse()){
      replaceMesh(bound,original);
      geometry.dispose();
    }
    if(attached){
      if(oldGuideParent)oldGuideParent.attach(guide.root);
      else guide.root.removeFromParent();
    }
    throw error;
  }
}
