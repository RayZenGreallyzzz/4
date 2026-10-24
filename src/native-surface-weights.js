import * as THREE from 'three';
import {buildLimbWeightContext,classifyLimbVertex,computeLimbVertexWeights} from './limb-weights.js';

const BYTE_CHUNK=0x6000;
export function toBase64(bytes){
 let result='';
 for(let i=0;i<bytes.length;i+=BYTE_CHUNK)
  result+=String.fromCharCode(...bytes.subarray(i,i+BYTE_CHUNK));
 return btoa(result);
}
export function fromBase64(str){
 const decoded=atob(str),out=new Uint8Array(decoded.length);
 for(let i=0;i<decoded.length;i++)out[i]=decoded.charCodeAt(i);
 return out;
}
export function bytesOf(array){
 return new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
}
export function buildTriangleEdges(geometry,maxEdges=700000){
 const pos=geometry?.getAttribute('position');
 const ids=geometry?.index;
 if(!pos||!ids||ids.count%3!==0)return null;
 if(pos.count>150000)return null;
 const seen=new Set(),edges=[];
 const add=(a,b)=>{
  if(a===b||a>=pos.count||b>=pos.count)return;
  if(a>b){const t=a;a=b;b=t;}
  const key=a*pos.count+b;
  if(seen.has(key))return;
  seen.add(key);edges.push(a,b);
 };
 for(let i=0;i<ids.count;i+=3){
  const a=ids.getX(i),b=ids.getX(i+1),c=ids.getX(i+2);
  add(a,b);add(b,c);add(c,a);
  if(edges.length/2>maxEdges)throw Error('Слишком много рёбер для нативной обработки планшета');
 }
 return new Uint32Array(edges);
}

const getters=['getX','getY','getZ','getW'];
function previousInfluence(index,weight,i,ids){
 let foreign=0,protectedWeight=0,own=0;
 const ownSet=new Set(ids);
 for(let k=0;k<4;k++){
  const bone=index[getters[k]](i),w=weight[getters[k]](i);
  if(ownSet.has(bone))own+=w;
  else protectedWeight+=w;
 }
 return {own,protectedWeight};
}

/**
 * Prepare ONE anatomical limb group. Geometric ownership is independent of
 * previous erroneous skin weights. Connected edges, not Euclidean distance,
 * control interpolation. Outside limb domain is fixed: no diffusion across
 * open space to the opposite limb.
 */
export function prepareLimbMesh(mesh,context,group,maxVertices=150000){
 const geo=mesh?.geometry,position=geo?.getAttribute('position'),
  skinIndex=geo?.getAttribute('skinIndex'),skinWeight=geo?.getAttribute('skinWeight');
 if(!mesh?.isSkinnedMesh||!position||!skinIndex||!skinWeight ||
    skinIndex.itemSize!==4||skinWeight.itemSize!==4||
    skinIndex.isInterleavedBufferAttribute||skinWeight.isInterleavedBufferAttribute)
  return {reason:'неподдерживаемые атрибуты меша'};
 if(position.count>maxVertices)return {reason:'меш слишком тяжёлый'};
 const edges=buildTriangleEdges(geo);
 if(!edges?.length)return {reason:'отсутствуют индексы треугольников'};
 const limb=context.groups[group];
 if(!limb?.length)return {reason:'нет подходящих костей конечности'};
 const ids=limb.map(seg=>seg.index);
 const values=new Float32Array(position.count*3);
 const fixed=new Uint8Array(position.count).fill(1);
 const belongs=new Uint8Array(position.count);
 const p=new THREE.Vector3();
 let count=0,seeds=0,protectedCount=0,unclassified=0;
 const localMask=new Set(ids);
 // Existing body/head influence remains a safeguard for uncertain
 // geometry, but doesn't block a definite distal claw owned by this limb.
 for(let i=0;i<position.count;i++){
  p.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);
  const owner=classifyLimbVertex(p,context,group);
  if(owner!==group){unclassified++;continue}
  const candidate=computeLimbVertexWeights(p,context,group);
  if(!candidate?.length)continue;
  let protect=0;
  for(let k=0;k<4;k++){
   const id=skinIndex[getters[k]](i),w=skinWeight[getters[k]](i);
   if(!localMask.has(id) && !context.order.some(g=>context.groups[g].some(x=>x.index===id)))
    protect+=w;
  }
  // Strong body/head weights: skip. Distal tips that are clearly beyond the
  // hand or foot axis may be claimed even when weighted to the other side.
  const rigid=candidate.length===1&&candidate[0].weight>=.99;
  if(protect>.75 && !rigid){protectedCount++;continue}
  belongs[i]=1;count++;
  for(let k=0;k<3;k++)
   values[i*3+k]=candidate.find(x=>x.id===ids[k])?.weight||0;
  if(rigid||Math.max(...candidate.map(x=>x.weight))>.89){
   fixed[i]=1;seeds++;
  }else fixed[i]=0;
 }
 if(!count)return {reason:'геометрия конечности не определена',count:0};
 if(seeds===0) {
  // No Dirichlet anchors; weakly fix highest-confidence vertices.
  for(let i=0;i<position.count;i++)
   if(belongs[i] && i%7===0){fixed[i]=1;seeds++}
 }
 return {values,fixed,belongs,edges,ids,count,seeds,protectedCount,unclassified};
}

export function applyLimbMeshSolution(mesh,prepared,resultBytes){
 const floats=new Float32Array(resultBytes.buffer,resultBytes.byteOffset,resultBytes.byteLength/4);
 if(floats.length!==prepared.values.length)throw Error('Неверный размер данных C++');
 const index=mesh.geometry.getAttribute('skinIndex'),
  weight=mesh.geometry.getAttribute('skinWeight');
 let changed=0;
 for(let i=0;i<prepared.belongs.length;i++){
  if(!prepared.belongs[i])continue;
  const a=Math.max(0,floats[i*3]),b=Math.max(0,floats[i*3+1]),
   c=Math.max(0,floats[i*3+2]),total=a+b+c;
  if(!Number.isFinite(total)||total<.05)continue;
  index.setXYZW(i,prepared.ids[0],prepared.ids[1],prepared.ids[2],0);
  weight.setXYZW(i,a/total,b/total,c/total,0);
  changed++;
 }
 index.needsUpdate=true;weight.needsUpdate=true;
 if(changed)mesh.normalizeSkinWeights();
 return changed;
}

export async function solveNativeSurface(nativePlugin,mesh,context,group){
 const prepared=prepareLimbMesh(mesh,context,group);
 if(!prepared.values)return {...prepared,changed:0};
 const response=await nativePlugin.solve({
  values:toBase64(bytesOf(prepared.values)),
  edges:toBase64(bytesOf(prepared.edges)),
  fixed:toBase64(prepared.fixed),
  passes:34
 });
 const result=fromBase64(response.values);
 // JS and Android are little-endian; explicit copy keeps alignment stable.
 const copy=new Uint8Array(result.length);copy.set(result);
 const changed=applyLimbMeshSolution(mesh,prepared,copy);
 return {changed,seeds:prepared.seeds,protectedCount:prepared.protectedCount,
   regionVertices:prepared.count,engine:response.engine};
}
