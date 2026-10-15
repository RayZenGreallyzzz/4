import * as THREE from 'three';

// Animation-only Mixamo retargeter. Keeps source skeleton and meshes out of the
// destination scene; copies only compatible joint rotation tracks.
export function normalizeBoneName(input){
  let name=String(input||'').trim().split(/[|/\\]/).pop();
  name=name.replace(/^mixamorig\d*[:_]?/i,'');
  name=name.replace(/[^a-z0-9]/gi,'').toLowerCase();
  const aliases={
    pelvis:'hips',roothips:'hips',leftthigh:'leftupleg',
    rightthigh:'rightupleg',leftcalf:'leftleg',rightcalf:'rightleg',
    leftlowerarm:'leftforearm',rightlowerarm:'rightforearm',
    leftupperarm:'leftarm',rightupperarm:'rightarm',
    lefttoe:'lefttoebase',righttoe:'righttoebase'
  };
  return aliases[name]||name;
}

export function findTrackNode(track,root){
  if(!track?.name?.endsWith('.quaternion')||!root)return null;
  let binding;
  try{binding=THREE.PropertyBinding.parseTrackName(track.name);}catch{return null;}
  if(binding.propertyName!=='quaternion')return null;
  const key=binding.objectIndex||binding.nodeName||'';
  let found=null;
  root.traverse(node=>{
    if(found)return;
    if(node.uuid===key||node.name===key)found=node;
  });
  // Some exporters emit a full node path instead of the direct bone name.
  if(!found){
    const normalized=normalizeBoneName(key);
    root.traverse(node=>{
      if(!found && node.isBone && normalizeBoneName(node.name)===normalized)found=node;
    });
  }
  return {binding,key,source:found};
}

function restWorldQuaternion(node,bind){
  const parents=[];
  for(let object=node;object;object=object.parent)parents.unshift(object);
  const world=new THREE.Quaternion();
  for(const object of parents){
    const rest=bind?.get(object.uuid)||object.quaternion;
    if(rest)world.multiply(rest);
  }
  return world.normalize();
}
function validTrack(track){
  if(typeof track.getValueSize!=='function'||track.getValueSize()!==4||
    !track.times?.length||track.values?.length!==track.times.length*4)return false;
  for(const t of track.times)if(!Number.isFinite(t)||t<0)return false;
  for(let i=0;i<track.times.length;i++){
    if(i && track.times[i]<=track.times[i-1])return false;
    const j=i*4,values=track.values;
    const len2=values[j]**2+values[j+1]**2+values[j+2]**2+values[j+3]**2;
    if(!Number.isFinite(len2)||len2<1e-8)return false;
  }
  return true;
}

// "auto" chooses world-space bind-basis correction only when needed.
// "local" keeps original Mixamo local deltas; "world" forces world correction.
export function retargetAnimationClip(clip,sourceRoot,targetBones,targetBind,{
  name=clip?.name||'Animation',mode='auto'
}={}){
  if(!Array.isArray(clip?.tracks)||!sourceRoot?.isObject3D||!targetBones?.length)
    throw Error('Нет анимации либо скелета');
  if(!['auto','local','world'].includes(mode))throw Error('Неверный режим переноса');
  const targets=new Map();
  for(const b of targetBones){
    if(!b.isBone||!b.name)continue;
    const normalized=normalizeBoneName(b.name);
    if(!targets.has(normalized))targets.set(normalized,b);
  }
  const tracks=[],used=new Set(),skipped=[];
  let total=0,corrected=0,maximum=0;
  const srcQ=new THREE.Quaternion(),resultQ=new THREE.Quaternion();
  const identity=new THREE.Quaternion();
  for(const track of clip.tracks){
    if(!track.name.endsWith('.quaternion'))continue;
    total++;
    const node=findTrackNode(track,sourceRoot);
    if(!node){skipped.push(track.name);continue;}
    const sourceName=node.source?.name||node.key;
    const target=targets.get(normalizeBoneName(sourceName));
    if(!target||used.has(target.uuid)||!validTrack(track)){
      skipped.push(track.name);continue;
    }
    const sourceRest=node.source?.quaternion||identity;
    const targetRest=targetBind?.get(target.uuid)||target.quaternion;
    const localToWorld=restWorldQuaternion(target,targetBind).invert()
      .multiply(node.source?restWorldQuaternion(node.source,null):sourceRest);
    const worldDifference=localToWorld.angleTo(identity);
    const convertSpace=mode==='world'||(mode==='auto'&&worldDifference>.45);
    if(convertSpace)corrected++;
    const invSource=sourceRest.clone().invert();
    const invBasis=localToWorld.clone().invert();
    const values=new Float32Array(track.values.length);
    for(let i=0;i<track.times.length;i++){
      srcQ.fromArray(track.values,i*4).normalize();
      // Express source animation as delta from its OWN bind pose.
      resultQ.copy(invSource).multiply(srcQ);
      // World correction only when rest axes meaningfully differ.
      if(convertSpace)resultQ.premultiply(localToWorld).multiply(invBasis);
      resultQ.premultiply(targetRest).normalize();
      resultQ.toArray(values,i*4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(target.uuid+'.quaternion',track.times,values));
    maximum=Math.max(maximum,track.times[track.times.length-1]);
    used.add(target.uuid);
  }
  const matched=tracks.length;
  const matchFraction=total?matched/total:0;
  // A 41-joint Mixamo clip with only 1 matching joint would otherwise look
  // like successful import while animating nearly none of the body.
  const usable=matched>0 && (total<12||matched>=Math.max(6,Math.ceil(total*.25)));
  const profile=total>=35?'Mixamo 41+':total>=18?'Humanoid':'Custom';
  const warning=total>0&&matchFraction<.85
    ? 'Перенесено '+matched+' из '+total+' суставов; отсутствующие кости пропущены'
    : null;
  if(!usable)return {
    clip:null,matched,total,corrected,skipped,profile,
    warning:'Недостаточно совместимых костей ('+matched+'/'+total+')'
  };
  const output=new THREE.AnimationClip(name,Math.max(.01,maximum,clip.duration||0),tracks);
  output.userData={
    importedFrom:clip.name,retargeted:true,
    matched,total,corrected,rootMotion:false,profile
  };
  return {clip:output,matched,total,corrected,skipped,profile,warning};
}

export function clipNameForFile(filename,clipName,part=0){
  const stem=String(filename||'Animation').replace(/\.(fbx|glb|gltf)$/i,'')
    .replace(/[^\p{L}\p{N}_ .-]/gu,'_').trim()||'Animation';
  const name=String(clipName||'').trim();
  const generic=/^(mixamo\.com|animationstack|take 001|default|animation)$/i.test(name);
  return (name&&!generic&&name!==stem?stem+' · '+name:stem)
    +(part?' #'+(part+1):'');
}
