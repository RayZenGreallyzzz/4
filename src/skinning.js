import * as THREE from 'three';

// First-pass LOCAL auto-weighting. No GPU compute, no external service.
// Bind to already fitted bones, retaining mesh materials and transforms.
// Geometry is never modified in place: a failed bind can be rolled back.
const MAX_VERTICES = 450000;

function collectSegments(bones, world) {
  return bones.map((bone,i)=>{
    const a=world[i];
    const children=bone.children.filter(child=>child.isBone);
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
function boneScores(point, segments, softness) {
  const topIdx=[0,0,0,0],topScore=[-1,-1,-1,-1];
  const smooth=softness*softness;
  for(let i=0;i<segments.length;i++){
    const seg=segments[i];
    let d2=Number.POSITIVE_INFINITY;
    for(const end of seg.endpoints)
      d2=Math.min(d2,squareDistanceToLine(point,seg.a,end));
    // A short-range radial falloff. Rigid plating near one bone remains
    // mostly rigid; joints between two bones receive smooth blending.
    const strength=1/((d2+smooth)*(Math.sqrt(d2+smooth)));
    for(let j=0;j<4;j++)if(strength>topScore[j]){
      for(let k=3;k>j;k--){topIdx[k]=topIdx[k-1];topScore[k]=topScore[k-1];}
      topIdx[j]=i;topScore[j]=strength;break;
    }
  }
  const denom=topScore.reduce((sum,s)=>sum+Math.max(0,s),0);
  const weights=topScore.map((s,j)=>j<segments.length&&denom>0?Math.max(0,s)/denom:0);
  return {indices:topIdx,weights};
}

export function weightGeometry(geometry, matrixWorld, bones, characterHeight=2) {
  if(!geometry?.isBufferGeometry||!geometry.attributes.position)throw Error('Меш не имеет вершин');
  const count=geometry.attributes.position.count;
  if(!count)throw Error('Пустая геометрия');
  if(!bones?.length)throw Error('В скелете нет костей');
  for(const bone of bones)bone.updateWorldMatrix(true,false);
  const world=bones.map(b=>b.getWorldPosition(new THREE.Vector3()));
  const segments=collectSegments(bones,world);
  const indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
  const source=geometry.attributes.position;
  const point=new THREE.Vector3();
  const softness=Math.max(.0002,characterHeight*.018);
  for(let i=0;i<count;i++){
    point.fromBufferAttribute(source,i).applyMatrix4(matrixWorld);
    const result=boneScores(point,segments,softness);
    for(let j=0;j<4;j++){
      indices[i*4+j]=result.indices[j];
      weights[i*4+j]=result.weights[j];
    }
  }
  const copy=geometry.clone();
  copy.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
  copy.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  return copy;
}

function skinnedCopy(mesh,geometry){
  const skin=new THREE.SkinnedMesh(geometry,mesh.material);
  skin.name=mesh.name;
  skin.uuid=mesh.uuid; // preserve animation node references if present
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
  skin.userData=structuredClone(mesh.userData||{});
  if(mesh.morphTargetInfluences){
    skin.morphTargetInfluences=[...mesh.morphTargetInfluences];
    skin.morphTargetDictionary={...mesh.morphTargetDictionary};
  }
  return skin;
}

function replaceMesh(oldMesh,newMesh){
  const parent=oldMesh.parent;
  if(!parent)throw Error('Меш без родителя');
  const index=parent.children.indexOf(oldMesh);
  parent.add(newMesh);
  parent.remove(oldMesh);
  // Keep mesh ordering stable for glTF exporters and transparent armor.
  const newIndex=parent.children.indexOf(newMesh);
  parent.children.splice(newIndex,1);
  parent.children.splice(index,0,newMesh);
}

export async function bindRigToMeshes(modelRoot,guide,{onProgress=()=>{},maxVertices=MAX_VERTICES}={}) {
  if(!modelRoot || !guide?.root || !guide?.bones?.size)throw Error('Загрузи модель и подгони скелет');
  if(guide.root===modelRoot || modelRoot.getObjectById(guide.root.id))
    throw Error('Этот скелет уже привязан');
  const meshes=[];
  modelRoot.traverse(obj=>{
    if(obj.isSkinnedMesh)throw Error('Персонаж уже содержит привязанные меши');
    if(obj.isMesh && obj.geometry?.attributes?.position)meshes.push(obj);
  });
  const total=meshes.reduce((sum,m)=>sum+m.geometry.attributes.position.count,0);
  if(!total)throw Error('У модели нет геометрии для привязки');
  if(total>maxVertices)throw Error('Слишком сложная модель ('+total+' вершин). Лимит '+maxVertices+' для планшета.');
  // Include nested custom tail, ear, wing and hair chains.
  const bones=[...guide.bones.values()];
  if(bones.length>65535)throw Error('Слишком много костей');
  modelRoot.updateWorldMatrix(true,true);
  guide.root.updateWorldMatrix(true,true);
  const skeleton=new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  const replacements=[];
  let processed=0, attached=false;
  try {
    for(const mesh of meshes){
      const geometry=weightGeometry(mesh.geometry,mesh.matrixWorld,bones,guide.height);
      const bound=skinnedCopy(mesh,geometry);
      replaceMesh(mesh,bound);
      bound.updateWorldMatrix(true,false);
      bound.bind(skeleton,bound.matrixWorld.clone());
      bound.normalizeSkinWeights();
      replacements.push({original:mesh,bound,geometry});
      processed+=geometry.attributes.position.count;
      onProgress({processed,total,percentage:Math.round(processed/total*100)});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    // Skin and armature must share one GLB export hierarchy.
    modelRoot.attach(guide.root);
    attached=true;
    modelRoot.updateWorldMatrix(true,true);
    skeleton.calculateInverses();
    for(const {bound} of replacements){
      bound.bind(skeleton,bound.matrixWorld.clone());
      bound.normalizeSkinWeights();
    }
    onProgress({processed,total,percentage:100});
    return {skeleton,bones,vertices:total,meshes:replacements.length,armature:guide.root};
  }catch(err){
    for(const {original,bound,geometry} of replacements.reverse()){
      replaceMesh(bound,original);
      geometry.dispose();
    }
    // In the normal flow attachment is last; an exception after attach is
    // reported while leaving the fitted guide intact for inspection.
    if(attached)modelRoot.remove(guide.root);
    throw err;
  }
}
