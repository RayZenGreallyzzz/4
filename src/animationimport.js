import * as THREE from 'three';

// Safe animation-only importer for an existing character. Meshes and armatures
// from source files NEVER replace the destination model.
export function normalizeBoneName(input){
  let name=String(input||'').trim();
  name=name.split(/[|/]/).at(-1);
  name=name.replace(/^mixamorig\d*:*/i,'');
  name=name.replace(/[^A-Za-z0-9]/g,'').toLowerCase();
  return name.replace(/^pelvis$/,'hips');
}
export function findTrackNode(track,root){
  if(!track?.name?.endsWith('.quaternion'))return null;
  let binding;
  try{binding=THREE.PropertyBinding.parseTrackName(track.name);}catch{return null;}
  if(binding.propertyName!=='quaternion')return null;
  const key=binding.objectIndex||binding.nodeName||'';
  let found=null;
  root.traverse(node=>{
    if(found)return;
    if(node.uuid===key||node.name===key)found=node;
  });
  return {binding,key,source:found};
}
const hasFiniteValues=a=>a&&a.every(Number.isFinite);
export function retargetAnimationClip(clip,sourceRoot,targetBones,targetBind,{
  name=clip?.name||'Animation'
}={}){
  if(!clip?.isAnimationClip||!sourceRoot?.isObject3D||!targetBones?.length)
    throw Error('Нет анимации либо скелета');
  const targets=new Map();
  for(const b of targetBones)if(b.isBone&&b.name)targets.set(normalizeBoneName(b.name),b);
  const tracks=[];
  const importedBones=new Set(), skipped=[];
  let totalRotations=0;
  for(const track of clip.tracks){
    if(!track.name.endsWith('.quaternion'))continue;
    totalRotations++;
    const node=findTrackNode(track,sourceRoot);
    if(!node){skipped.push(track.name);continue;}
    const sourceName=node.source?.name || node.key;
    const target=targets.get(normalizeBoneName(sourceName));
    if(!target){skipped.push(track.name);continue;}
    if(track.getValueSize()!==4 || !track.times?.length ||
      track.values.length!==track.times.length*4 ||
      !hasFiniteValues(track.values)||!hasFiniteValues(track.times)){
      skipped.push(track.name);continue;
    }
    if(importedBones.has(target.uuid)){skipped.push(track.name);continue;}
    importedBones.add(target.uuid);
    const sourceRest=node.source?.quaternion?.clone()||new THREE.Quaternion();
    const targetRest=targetBind?.get(target.uuid)?.clone()||target.quaternion.clone();
    const inverseSource=sourceRest.invert();
    const values=new Float32Array(track.values.length);
    const sourceQ=new THREE.Quaternion();
    const out=new THREE.Quaternion();
    for(let at=0;at<track.times.length;at++){
      sourceQ.fromArray(track.values,at*4).normalize();
      out.copy(targetRest).multiply(inverseSource).multiply(sourceQ).normalize();
      out.toArray(values,at*4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(target.uuid+'.quaternion',track.times,values));
  }
  if(!tracks.length)return {
    clip:null, matched:0,total:totalRotations,skipped,warning:'Не найдены совместимые кости — проверь скелет Mixamo'
  };
  // Unsafe root position/scale tracks are omitted to prevent huge jumps.
  const output=new THREE.AnimationClip(name,Math.max(.01,clip.duration),tracks);
  output.userData={importedFrom:clip.name,retargeted:true,rootMotion:false};
  return {clip:output,matched:tracks.length,total:totalRotations,skipped,
    warning:tracks.length<Math.min(8,totalRotations)?'Часть костей не совпала; проверь движение':null};
}
export function clipNameForFile(filename,clipName,part=0){
  const stem=String(filename||'Animation').replace(/\.(fbx|glb|gltf)$/i,'')
    .replace(/[^\p{L}\p{N}_ .-]/gu,'_').trim()||'Animation';
  const name=String(clipName||'').trim();
  const normalized=/^(mixamo\.com|animationstack|take 001|default|animation)$/i.test(name)?'':name;
  return (normalized&&normalized!==stem ? stem+' · '+normalized : stem)
    +(part?' #'+(part+1):'');
}
