import * as THREE from 'three';
import {sampleGeometry,analyzeBodyGeometry} from './bodyfit.js';
import {calculateAdaptiveFit} from './adaptive-geometry-fit.js';
import {moveJointWorld,jointWorld} from './autorig.js';

// Experimental Stage 8 medial-axis refinement. Does NOT edit mesh, skin
// weights, animation, legs or the existing torso/head guide.
// Each limb is independently assessed; no unsafe "best guess" if missing.
const N=18;
const SIDE_NAMES={left:'Left',right:'Right'};
const groups={
 left:['LeftArm','LeftForeArm','LeftHand'],
 right:['RightArm','RightForeArm','RightHand']
};
const finite=p=>p?.isVector3&&[p.x,p.y,p.z].every(Number.isFinite);
const med=a=>{if(!a.length)return NaN;const x=a.slice().sort((a,b)=>a-b),m=x.length>>1;return x.length%2?x[m]:(x[m-1]+x[m])*.5;};
const q=(a,t)=>{if(!a.length)return NaN;const s=a.slice().sort((a,b)=>a-b);const f=(s.length-1)*t,lo=Math.floor(f),hi=Math.ceil(f);return lo===hi?s[lo]:s[lo]*(hi-f)+s[hi]*(f-lo);};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const along=(a,b,t)=>a.clone().lerp(b,t);

function toWorld(info,obj){
 if(!obj)return null;
 const p=new THREE.Vector3();
 p[info.lateralAxis]=obj.x;
 p.y=obj.y;
 p[info.depthAxis]=obj.z;
 return finite(p)?p:null;
}
function perpendicular(direction){
 const seed=Math.abs(direction.y)<.88?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1);
 const u=new THREE.Vector3().crossVectors(direction,seed).normalize();
 const v=new THREE.Vector3().crossVectors(direction,u).normalize();
 return [u,v];
}

/**
 * Return a robust 2D cross-section centre near a predicted point.
 * The candidate pool is bounded in a slab along the arm, then clipped by
 * radial distance from the predicted medial axis. Using trimmed quantiles
 * avoids a long claw, a spike, or an accidental torse sample dominating.
 */
function section(points,anchor,unit,length,t,info,sign,previous,audit={}){
 const height=info.height;
 const [u,v]=perpendicular(unit);
 const p0=anchor.clone().addScaledVector(unit,length*t);
 const predict=previous??p0;
 const slab=Math.max(.013*height,length*.041);
 const searchRadius=Math.max(.055*height,Math.min(.14*height,length*.29));
 const minOutside=Math.max(.085*height,Math.abs(anchor[info.lateralAxis]-info.lateralCenter)*.54);
 const candidates=[];
 for(const p of points){
  if((p[info.lateralAxis]-info.lateralCenter)*sign<minOutside)continue;
  const d=p.clone().sub(anchor);
  const projected=d.dot(unit),delta=projected-t*length;
  if(Math.abs(delta)>slab)continue;
  const perp=d.addScaledVector(unit,-projected);
  // Reject points far from the modeled arm, such as capes/torso/wings.
  if(perp.lengthSq()>searchRadius*searchRadius)continue;
  const dd=p.distanceToSquared(predict);
  if(dd>searchRadius*searchRadius*1.5)continue;
  candidates.push({p,dd});
 }
 if(candidates.length<9){audit.sparse=(audit.sparse||0)+1;return null;}
 candidates.sort((a,b)=>a.dd-b.dd);
 // Keep a local dense cloud. This protects against merged adjacent objects.
 const keep=candidates.slice(0,Math.min(candidates.length,Math.max(24,Math.ceil(candidates.length*.76))));
 const medianPoint=new THREE.Vector3(
   med(keep.map(v=>v.p.x)),med(keep.map(v=>v.p.y)),med(keep.map(v=>v.p.z))
 );
 const pU=keep.map(v=>v.p.dot(u)),pV=keep.map(item=>item.p.dot(v));
 const center=p0.clone()
   .addScaledVector(u,med(pU)-p0.dot(u))
   .addScaledVector(v,med(pV)-p0.dot(v));
 // A small step along axis lets the estimate follow curved geometry.
 center.addScaledVector(unit,clamp(medianPoint.clone().sub(center).dot(unit),-slab*.5,slab*.5));
 const ru=(q(pU,.84)-q(pU,.16))*.5;
 const rv=(q(pV,.84)-q(pV,.16))*.5;
 const radius=Math.hypot(ru,rv);
 if(!finite(center)||radius<height*.002||radius>height*.17){audit.radius=(audit.radius||0)+1;audit.value=radius;audit.debug={ru,rv,pU0:pU[0],pV0:pV[0],keep:keep.length,p0:keep[0].p.toArray(),axis:unit.toArray(),u:u.toArray(),v:v.toArray()};return null;}
 return {point:center,radius,count:keep.length,t,cloud:keep.map(x=>x.p)};
}
function interpolateProfile(profile,target){
 if(!profile.length)return null;
 if(target<=profile[0].t)return profile[0].point.clone();
 if(target>=profile[profile.length-1].t)return profile[profile.length-1].point.clone();
 for(let i=1;i<profile.length;i++){
  const a=profile[i-1],b=profile[i];
  if(target<=b.t)return along(a.point,b.point,(target-a.t)/(b.t-a.t));
 }
 return null;
}
function validCrossSupport(entry,direction,height){
 if(!entry||entry.cloud.length<9)return false;
 const [u,v]=perpendicular(direction);
 for(const axis of [u,v]){
  const xs=entry.cloud.map(p=>p.clone().sub(entry.point).dot(axis));
  if(q(xs,.16)>height*.008||q(xs,.84)<-height*.008)return false;
 }
 return true;
}
function localAngle(a,b,c){
 const d1=b.clone().sub(a).normalize(),d2=c.clone().sub(b).normalize();
 return Math.acos(clamp(d1.dot(d2),-1,1));
}
function pickElbow(profile){
 let best=null,score=0;
 for(let i=2;i<profile.length-2;i++){
  const t=profile[i].t;
  if(t<.28||t>.70)continue;
  const gap=profile[i+1].t-profile[i-1].t;
  if(gap>.22)continue;
  const amount=localAngle(profile[i-1].point,profile[i].point,profile[i+1].point);
  const prominence=amount * (1-Math.abs(.48-t));
  if(prominence>score){score=prominence;best=profile[i];}
 }
 // A bend measured from noisy sparse samples is unreliable.
 return score>.17?best?.point.clone():null;
}

/**
 * Build a centreline from 18 plane slabs. We never use the most distal
 * 15-20% of the long-tip chord for wrist, because it may contain claws.
 * No torso/head/leg or existing skin-weight data is touched.
 */
export function traceArmMedialAxis(points,info,side,roughShoulder,roughTip){
 if(!['left','right'].includes(side))return {ok:false,reason:'неизвестная сторона'};
 if(!finite(roughShoulder)||!finite(roughTip))return {ok:false,reason:'нет опорных точек'};
 const sign=(info.depthAxis==='x'?-info.forwardSign:info.forwardSign)*(side==='left'?1:-1);
 const axis=roughTip.clone().sub(roughShoulder);
 const length=axis.length(),height=info.height;
 if(!(length>height*.13 && length<height*.85))return {ok:false,reason:'неверная длина руки'};
 const unit=axis.normalize(),profile=[],audit={};
 // Avoid joining torso at 0 and claws at 1. Points lie on actual arm surface.
 for(let j=1;j<N-1;j++){
  const t=j/(N-1);
  if(t<.105||t>.89)continue;
  let current=null;
  for(let pass=0;pass<2;pass++){
   const result=section(points,roughShoulder,unit,length,t,info,sign,current?.point,audit);
   if(!result)break;
   current=result;
  }
  if(current)profile.push(current);
 }
 if(profile.length<6)return {ok:false,reason:'недостаточно сечений руки ('+profile.length+', sparse '+(audit.sparse||0)+', radius '+(audit.radius||0)+', value '+audit.value+', debug '+JSON.stringify(audit.debug)+')'};
 const mid=profile.filter(x=>x.t>.25&&x.t<.70);
 if(mid.length<3)return {ok:false,reason:'недостаточно данных предплечья'};
 const majorGaps=profile.slice(1).filter((x,i)=>x.t-profile[i].t>.17);
 if(majorGaps.length)return {ok:false,reason:'ось руки имеет большие разрывы'};
 const elbow=pickElbow(profile)||interpolateProfile(profile,.49);
 // Distal claws have sharply smaller radii; stop before the digit area.
 const forearmRadius=med(mid.map(x=>x.radius));
 const distal=profile.filter(x=>x.t>=.73&&x.t<=.88);
 const narrow=distal.some(x=>x.radius<forearmRadius*.48);
 const wristT=narrow ? 0.69 : 0.77;
 const wrist=interpolateProfile(profile,wristT);
 // The initial shoulder can be on the surface. Use first stable arm slab
 // and extrapolate only a short step toward the torso, never to a far claw.
 const first=profile.find(x=>x.t>=.12&&x.t<=.24)??profile[0];
 const second=profile.find(x=>x.t>=.26&&x.t<=.36)??profile[1];
 let shoulder=roughShoulder.clone();
 if(first&&second&&second.t>first.t){
   const backwards=first.point.clone().sub(second.point)
     .multiplyScalar(clamp(first.t/(second.t-first.t),.15,1));
   const predicted=first.point.clone().add(backwards);
   if(predicted.distanceTo(roughShoulder)<height*.15)
    shoulder=predicted;
   else shoulder=first.point.clone();
 }
 const centerAt=(t)=>profile.reduce((best,p)=>Math.abs(p.t-t)<Math.abs(best.t-t)?p:best);
 const a=centerAt(.25),e=centerAt(.5),w=centerAt(wristT);
 if(!a||!e||!w||!validCrossSupport(a,unit,height)||
    !validCrossSupport(e,unit,height)||!validCrossSupport(w,unit,height))
  return {ok:false,reason:'недостаточно подтверждений, что ось проходит внутри руки'};
 // Prevent sudden jumps from model accessories or a wrong rough template.
 if(shoulder.distanceTo(roughShoulder)>height*.16 ||
    elbow.distanceTo(along(roughShoulder,roughTip,.49))>height*.14 ||
    wrist.distanceTo(along(roughShoulder,roughTip,wristT))>height*.14)
  return {ok:false,reason:'осевая линия резко ушла от конечности'};
 if(shoulder.distanceTo(elbow)<height*.045||elbow.distanceTo(wrist)<height*.04)
  return {ok:false,reason:'кости руки получились слишком короткими'};
 return {ok:true,shoulder,elbow,wrist,
  line:profile.map(x=>x.point.clone()),sections:profile.length,clawExcluded:narrow,
  confidence:profile.length/N,source:'medial'};
}

export function calculateArmMedialFit(model,guide,direction='z+'){
 const base=calculateAdaptiveFit(model,direction);
 const info=base.info;
 const points=sampleGeometry(model,4000,48000);
 const proposals={},directionFacing=direction;
 for(const side of ['left','right']){
  const tag=SIDE_NAMES[side],coarse=base.detection?.arms?.[side];
  const guideArm=jointWorld(guide,'mixamorig'+tag+'Arm');
  const guideHand=jointWorld(guide,'mixamorig'+tag+'Hand');
  const modelShoulder=toWorld(info,coarse?.shoulder);
  const modelTip=toWorld(info,coarse?.tip);
  const seedShoulder=modelShoulder||guideArm;
  const seedTip=modelTip||guideHand;
  // Strongly prefer geometry anchors, but use the user's hand-adjusted
  // joints as a fallback when a complex creature fails Stage 7 detection.
  proposals[side]=traceArmMedialAxis(points,info,side,seedShoulder,seedTip);
 }
 return {proposals,samples:points.length,direction:directionFacing,info};
}

export function fitArmMedialAxes(guide,model,direction='z+'){
 if(!guide?.bones?.size||!model)throw Error('Сначала загрузи модель и создай скелет');
 const result=calculateArmMedialFit(model,guide,direction),affected=[],details={};
 for(const side of ['left','right']){
  const prop=result.proposals[side],tag=SIDE_NAMES[side];
  if(!prop.ok){details[side]=prop.reason;continue;}
  const toApply=[
   ['mixamorig'+tag+'Arm',prop.shoulder],
   ['mixamorig'+tag+'ForeArm',prop.elbow],
   ['mixamorig'+tag+'Hand',prop.wrist]
  ];
  if(toApply.some(([name,p])=>!guide.bones.has(name)||!finite(p))){
   details[side]='отсутствуют суставы';continue;
  }
  // Shoulder/clavicle marker remains as-is, avoiding unnecessary movement
  // of the chest-to-shoulder attachment and head/spine.
  for(const [name,p] of toApply){
   moveJointWorld(guide,name,p);
   affected.push(name);
  }
  details[side]='ось: '+prop.sections+' сечений'+(prop.clawExcluded?', когти исключены':'');
 }
 if(!affected.length)throw Error('Ни одна рука не подтверждена геометрией: '+Object.entries(details).map(([k,v])=>k+' '+v).join('; '));
 guide.lastArmMedialFit={direction,samples:result.samples,details};
 return {affected,samples:result.samples,details,proposals:result.proposals};
}
