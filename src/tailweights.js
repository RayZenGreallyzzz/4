import * as THREE from 'three';

// Opt-in reversible tail weight editor. Rebinds neither body nor armature.
export function findTailChains(bones) {
  const groups=new Map();
  for(const bone of bones || []){
    const m=/^(Tail\d*)_(\d{2})$/i.exec(bone.name||'');
    if(!m)continue;
    const id=m[1],ord=Number(m[2]);
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push({bone,ord});
  }
  return [...groups].map(([id,list])=>({
    id, bones:list.sort((a,b)=>a.ord-b.ord).map(x=>x.bone)
  })).filter(x=>x.bones.length>=2);
}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=t=>{const x=clamp(t,0,1);return x*x*(3-2*x);};
function segmentsFromBones(bones){
  for(const bone of bones)bone.updateWorldMatrix(true,false);
  const points=bones.map(b=>b.getWorldPosition(new THREE.Vector3()));
  const segs=[];let total=0;
  for(let i=0;i<points.length-1;i++){
    const from=points[i],to=points[i+1],difference=to.clone().sub(from);
    const len=difference.length();
    if(len<1e-7)continue;
    segs.push({a:from,d:difference,length2:len*len,length:len,along:total,fromIndex:i});
    total+=len;
  }
  if(total<1e-7)throw new Error('Кости хвоста совпадают по координатам. Сначала выставь суставы вдоль хвоста.');
  return {segs,total,firstLength:segs[0].length};
}
function closestTube(point,segs){
  let bestSq=Infinity,closest=null,u=0;
  for(const seg of segs){
    const dx=point.x-seg.a.x,dy=point.y-seg.a.y,dz=point.z-seg.a.z;
    const t=clamp((dx*seg.d.x+dy*seg.d.y+dz*seg.d.z)/seg.length2,0,1);
    const ex=dx-t*seg.d.x,ey=dy-t*seg.d.y,ez=dz-t*seg.d.z;
    const dist=ex*ex+ey*ey+ez*ez;
    if(dist<bestSq){bestSq=dist;closest=seg;u=t;}
  }
  return {distSq:bestSq,seg:closest,u};
}
function mergeInfluences(srcIndex,srcWeight,vertex,boneA,boneB,u,alpha,dstI,dstW){
  const ids=new Int32Array(6),weights=new Float64Array(6);
  let n=0;
  for(let j=0;j<4;j++){
    const w=srcWeight.getComponent(vertex,j)*(1-alpha);
    const id=Math.round(srcIndex.getComponent(vertex,j));
    if(w<=0)continue;
    let found=-1;for(let k=0;k<n;k++)if(ids[k]===id){found=k;break;}
    if(found>=0)weights[found]+=w;
    else {ids[n]=id;weights[n]=w;n++;}
  }
  for(const [bone,w] of [[boneA,(1-u)*alpha],[boneB,u*alpha]]){
    if(w<=0)continue;
    let found=-1;for(let j=0;j<n;j++)if(ids[j]===bone){found=j;break;}
    if(found>=0)weights[found]+=w;
    else {ids[n]=bone;weights[n]=w;n++;}
  }
  for(let i=0;i<4;i++){
    for(let j=i+1;j<n;j++)if(weights[j]>weights[i]){
      const tw=weights[i];weights[i]=weights[j];weights[j]=tw;
      const ti=ids[i];ids[i]=ids[j];ids[j]=ti;
    }
  }
  let sum=0;for(let i=0;i<Math.min(4,n);i++)sum+=weights[i];
  if(sum<=0)return;
  for(let i=0;i<4;i++){
    dstI[vertex*4+i]=i<n?ids[i]:0;
    dstW[vertex*4+i]=i<n?weights[i]/sum:0;
  }
}
const yieldUI=()=>new Promise(r=>setTimeout(r,0));

// Source attributes let us retry different radii without cumulative changes.
// No mesh mutation occurs until commitTailRegion is explicitly called.
export async function calculateTailRegion(mesh,chainBones,{
  radiusWorld,dryRun=false,source=null,chunkVertices=8192,onProgress=()=>{},signal
}={}){
  if(!mesh?.isSkinnedMesh||!mesh.geometry?.attributes?.position)
    throw new Error('Нужен уже привязанный к скелету меш');
  if(!Array.isArray(chainBones)||chainBones.length<2)throw new Error('Выбери цепочку хвоста');
  if(!Number.isFinite(radiusWorld)||radiusWorld<=0)throw new Error('Укажи радиус области хвоста');
  const pos=mesh.geometry.attributes.position;
  const idx=source?.index||mesh.geometry.getAttribute('skinIndex');
  const weight=source?.weight||mesh.geometry.getAttribute('skinWeight');
  if(!idx||!weight||idx.itemSize!==4||weight.itemSize!==4||
    idx.count!==pos.count||weight.count!==pos.count)
    throw new Error('У меша отсутствуют корректные веса скелета');
  const skeleton=mesh.skeleton?.bones||[];
  const ids=chainBones.map(b=>skeleton.indexOf(b));
  if(ids.some(i=>i<0))throw new Error('Кости хвоста не принадлежат этому мешу');
  mesh.updateWorldMatrix(true,false);
  const {segs,total,firstLength}=segmentsFromBones(chainBones);
  const outI=dryRun?null:new Uint16Array(pos.count*4);
  const outW=dryRun?null:new Float32Array(pos.count*4);
  const worldPos=new THREE.Vector3();
  const batch=clamp(Math.floor(chunkVertices)||8192,256,32768);
  let affected=0,core=0;
  for(let start=0;start<pos.count;start+=batch){
    if(signal?.aborted)throw new Error('Редактирование хвоста отменено');
    const end=Math.min(pos.count,start+batch);
    for(let i=start;i<end;i++){
      if(!dryRun){
        for(let j=0;j<4;j++){
          outI[i*4+j]=idx.getComponent(i,j);
          outW[i*4+j]=weight.getComponent(i,j);
        }
      }
      worldPos.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
      const {distSq,seg,u}=closestTube(worldPos,segs);
      if(distSq>radiusWorld*radiusWorld)continue;
      const distance=Math.sqrt(distSq);
      const radial=1-smooth((distance/radiusWorld-.6)/.4);
      const along=seg.along+seg.length*u;
      const rootFade=smooth(along/Math.max(firstLength*.75,total*.15));
      const alpha=radial*rootFade;
      if(alpha<.06)continue;
      affected++;
      if(alpha>.8)core++;
      if(dryRun)continue;
      mergeInfluences(idx,weight,i,ids[seg.fromIndex],ids[seg.fromIndex+1],
        u,alpha,outI,outW);
    }
    onProgress({processed:end,total:pos.count,percentage:Math.floor(end/pos.count*100),affected});
    if(end<pos.count)await yieldUI();
  }
  return {indices:outI,weights:outW,affected,core,totalVertices:pos.count,
    radiusWorld,chain:chainBones[0].name};
}
export function commitTailRegion(mesh,region){
  if(!mesh?.isSkinnedMesh||!region?.indices||!region.weights)
    throw new Error('Нет рассчитанных весов хвоста');
  if(region.affected===0)throw new Error('Не найдены вершины хвоста. Увеличь радиус или поправь кости.');
  const geometry=mesh.geometry;
  if(geometry.attributes.position.count!==region.totalVertices)
    throw new Error('Количество вершин модели изменилось');
  const original={
    index:geometry.getAttribute('skinIndex'),
    weight:geometry.getAttribute('skinWeight')
  };
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(region.indices,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(region.weights,4));
  return original;
}
export function restoreTailRegion(mesh,backup){
  if(!mesh?.isSkinnedMesh||!backup?.index||!backup.weight)
    throw new Error('Нет сохранённых исходных весов');
  mesh.geometry.setAttribute('skinIndex',backup.index);
  mesh.geometry.setAttribute('skinWeight',backup.weight);
}
