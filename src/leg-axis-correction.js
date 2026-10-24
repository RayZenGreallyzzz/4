import * as THREE from 'three';
import {sampleGeometry,analyzeBodyGeometry} from './bodyfit.js';
import {moveJointWorld,jointWorld} from './autorig.js';

// Stage 9: correct knee and ankle X/Z only using measured surface geometry.
// Existing hip, joint heights, spine, arm, toes, skin weights are protected.
// Regions are independent: refusing a side never changes its bones.
const median=values=>{
 if(!values.length)return NaN;
 const a=values.slice().sort((x,y)=>x-y),m=Math.floor(a.length/2);
 return a.length%2?a[m]:(a[m-1]+a[m])*.5;
};
const quantile=(values,t)=>{
 if(!values.length)return NaN;
 const a=values.slice().sort((x,y)=>x-y),p=(a.length-1)*t,l=Math.floor(p),u=Math.ceil(p);
 return l===u?a[l]:a[l]*(u-p)+a[u]*(p-l);
};
const safe=v=>v?.isVector3&&[v.x,v.y,v.z].every(Number.isFinite);

/**
 * Find centre of a lower-limb cross section, rather than average of a
 * nearby hand, foot claws or armour. The hip's lateral position anchors
 * a narrowly bounded search (never shares vertices across left/right).
 */
export function lowerLegCrossSection(points,info,side,hip,sliceY){
 if(!safe(hip)||!Number.isFinite(sliceY))return {ok:false,reason:'нет опорной точки бедра'};
 const h=info.height,axis=info.lateralAxis,depth=info.depthAxis;
 const sign=(info.depthAxis==='x'?-info.forwardSign:info.forwardSign)*(side==='left'?1:-1);
 const origin=info.lateralCenter;
 const hipOffset=(hip[axis]-origin)*sign;
 if(hipOffset<.025*h || hipOffset>.42*h)return {ok:false,reason:'бедро вне допустимой зоны'};
 const slab=.018*h,maxX=.115*h;
 // Limit lateral radius around hip. A dense tail/hand can be much further.
 const candidates=points.filter(p=>
  Math.abs(p.y-sliceY)<=slab &&
  (p[axis]-origin)*sign>.016*h &&
  Math.abs(p[axis]-hip[axis])<maxX &&
  Number.isFinite(p[depth])
 );
 if(candidates.length<16)return {ok:false,reason:'мало вершин на срезе ('+candidates.length+')'};
 // Choose dense leg shell near the hip trajectory, reject spike outliers:
 // nearest 85% laterally, not the distant maximum-width geometry.
 const near=candidates.map(p=>({
    p,dx:Math.abs(p[axis]-hip[axis])
 })).sort((a,b)=>a.dx-b.dx);
 const pool=near.slice(0,Math.min(near.length,Math.max(20,Math.ceil(near.length*.85)))).map(x=>x.p);
 const centerX=median(pool.map(p=>p[axis]));
 const centerZ=median(pool.map(p=>p[depth]));
 const wX=quantile(pool.map(p=>p[axis]),.85)-quantile(pool.map(p=>p[axis]),.15);
 const wZ=quantile(pool.map(p=>p[depth]),.85)-quantile(pool.map(p=>p[depth]),.15);
 if(![centerX,centerZ,wX,wZ].every(Number.isFinite)||
   wX<.006*h||wZ<.006*h||wX>.22*h||wZ>.22*h)
  return {ok:false,reason:'срез слишком узкий либо смешан с другой геометрией'};
 if((centerX-origin)*sign<.02*h)return {ok:false,reason:'неправильно определена сторона ноги'};
 const position=new THREE.Vector3().copy(hip);
 position[axis]=centerX;position[depth]=centerZ;position.y=sliceY;
 return {ok:true,position,support:pool.length,width:[wX,wZ]};
}
export function calculateLowerLegCenters(model,guide,direction='z+'){
 const info=analyzeBodyGeometry(model,direction);
 const points=sampleGeometry(model,18000,60000);
 const output={};
 const ymin=info.bounds.min.y;
 for(const side of ['left','right']){
  const name=side==='left'?'Left':'Right';
  const hip=jointWorld(guide,'mixamorig'+name+'UpLeg');
  const knee=jointWorld(guide,'mixamorig'+name+'Leg');
  const ankle=jointWorld(guide,'mixamorig'+name+'Foot');
  if(!safe(hip)||!safe(knee)||!safe(ankle)){
   output[side]={ok:false,reason:'нет основных костей'};continue;
  }
  // Keep all current Y positions: the user's knee height is working.
  const kneeSection=lowerLegCrossSection(points,info,side,hip,knee.y);
  // Sample shin ABOVE the foot/claws: feet are too broad for a shin axis.
  const shinY=Math.min(knee.y-.05*info.height,ankle.y+.038*info.height);
  const ankleSection=lowerLegCrossSection(points,info,side,hip,shinY);
  if(!kneeSection.ok||!ankleSection.ok){
   output[side]={ok:false,reason:'колено: '+(kneeSection.reason||'ок')+
     '; голень: '+(ankleSection.reason||'ок')};continue;
  }
  const newKnee=knee.clone(),newAnkle=ankle.clone();
  newKnee[info.lateralAxis]=kneeSection.position[info.lateralAxis];
  newKnee[info.depthAxis]=kneeSection.position[info.depthAxis];
  newAnkle[info.lateralAxis]=ankleSection.position[info.lateralAxis];
  newAnkle[info.depthAxis]=ankleSection.position[info.depthAxis];
  if(newKnee.distanceTo(knee)>.19*info.height||
     newAnkle.distanceTo(ankle)>.19*info.height){
   output[side]={ok:false,reason:'слишком большой сдвиг — нужна ручная проверка'};continue;
  }
  const minBone=.06*info.height;
  if(hip.distanceTo(newKnee)<minBone || newKnee.distanceTo(newAnkle)<minBone){
   output[side]={ok:false,reason:'получается слишком короткая кость'};continue;
  }
  output[side]={ok:true,knee:newKnee,ankle:newAnkle,support:[kneeSection.support,ankleSection.support]};
 }
 return {output,samples:points.length,info};
}

export function centerLowerLegAxes(guide,model,direction='z+'){
 if(!guide?.bones?.size||!model)throw Error('Сначала создай скелет');
 const {output,samples}=calculateLowerLegCenters(model,guide,direction);
 const changed=[],report={};
 for(const side of ['left','right']){
  const r=output[side],name=side==='left'?'Left':'Right';
  if(!r.ok){report[side]=r.reason;continue;}
  // Capture the toe world point before updating ankle's parent transform,
  // so toes do not jump away from the real toe/foot surface.
  const toe=jointWorld(guide,'mixamorig'+name+'ToeBase')?.clone();
  moveJointWorld(guide,'mixamorig'+name+'Leg',r.knee);
  moveJointWorld(guide,'mixamorig'+name+'Foot',r.ankle);
  if(toe)moveJointWorld(guide,'mixamorig'+name+'ToeBase',toe);
  changed.push('mixamorig'+name+'Leg','mixamorig'+name+'Foot');
  report[side]='колено и голень по '+r.support.join('/')+' вершинам';
 }
 if(!changed.length)throw Error('Не удалось подтвердить геометрию голеней: '+
   Object.entries(report).map(([k,v])=>k+': '+v).join('; '));
 guide.lastLegCenterFit={samples,report,direction};
 return {changed,report,samples};
}
