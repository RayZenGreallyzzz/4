import * as THREE from 'three';

const ANIMATED=[
 ['Левое предплечье','leftArm','leftforearm','z'],
 ['Правая рука','rightArm','rightforearm','z'],
 ['Левая голень','leftLeg','leftleg','x'],
 ['Правая голень','rightLeg','rightleg','x']
];
const normalize=s=>String(s||'').replace(/^.*?mixamorig\d*[:_]?/i,'').toLowerCase();

export class LimbIsolationPreview {
 constructor(){this.active=false;this.elapsed=0;this.bones=[];this.plan=[];this.pose=new Map();this.label='';}
 start(bones,selection='all'){
  this.stop();
  const candidates=ANIMATED.filter(([,group])=>selection==='all'||group===selection);
  this.plan=candidates.map(([label,group,name,axis])=>{
   const bone=bones.find(b=>normalize(b.name)===name);
   return bone?{label,group,bone,axis}:null;
  }).filter(Boolean);
  if(!this.plan.length)return false;
  this.bones=[...bones];
  this.pose=new Map(bones.map(b=>[b.uuid,b.quaternion.clone()]));
  this.elapsed=0;this.active=true;this.label=this.plan[0].label;
  return true;
 }
 update(delta){
  if(!this.active)return null;
  this.elapsed+=Math.max(0,Math.min(delta||0,.2));
  const secondsPerLimb=2.5;
  const i=Math.floor(this.elapsed/secondsPerLimb);
  if(i>=this.plan.length){this.stop();return null}
  // Restore all bones on each frame so only ONE extremity moves at a time.
  for(const bone of this.bones){
    const rest=this.pose.get(bone.uuid);
    if(rest)bone.quaternion.copy(rest);
  }
  const candidate=this.plan[i];
  const stage=(this.elapsed-i*secondsPerLimb)/secondsPerLimb;
  const angle=THREE.MathUtils.degToRad(20)*Math.sin(stage*Math.PI*2);
  const q=new THREE.Quaternion().setFromAxisAngle(
    candidate.axis==='x'?new THREE.Vector3(1,0,0):new THREE.Vector3(0,0,1),angle);
  candidate.bone.quaternion.copy(this.pose.get(candidate.bone.uuid)).multiply(q);
  candidate.bone.updateWorldMatrix(true,true);
  this.label=candidate.label;
  return candidate.label;
 }
 stop(){
  if(this.active){
   for(const bone of this.bones){
    const pose=this.pose.get(bone.uuid);
    if(pose)bone.quaternion.copy(pose);
   }
   this.bones[0]?.updateWorldMatrix(true,true);
  }
  this.active=false;this.elapsed=0;this.bones=[];this.pose.clear();this.plan=[];this.label='';
 }
}
