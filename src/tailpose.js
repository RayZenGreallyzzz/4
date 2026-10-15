import * as THREE from 'three';

// Tail posing uses bone rotations, never translations or new skin weights.
// That preserves inverse bind matrices and the fitted tail geometry.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
export const TAIL_SIDE_LIMIT=60;
export const TAIL_LIFT_LIMIT=40;
export const TAIL_WAG_CYCLES=2;
export const TAIL_WAG_STEP=5;

export function tailPoseQuaternion(base,index,count,sideDegrees=0,liftDegrees=0){
  if(!base?.isQuaternion || !Number.isInteger(index)||index<0||index>=count)
    throw new Error('Некорректная кость хвоста');
  const side=THREE.MathUtils.degToRad(clamp(sideDegrees,-TAIL_SIDE_LIMIT,TAIL_SIDE_LIMIT));
  const lift=THREE.MathUtils.degToRad(clamp(liftDegrees,-TAIL_LIFT_LIMIT,TAIL_LIFT_LIMIT));
  // The proximal segment steers the entire tail. Gradual additional motion
  // at subsequent joints creates a curve without sharply folding the tip.
  const influence=index===0?.78:.32*Math.pow(.73,index-1);
  const aroundUp=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),side*influence);
  const aroundSide=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),lift*influence);
  return base.clone().multiply(aroundUp).multiply(aroundSide).normalize();
}

// Same staggered sine motion as the temporary wag test, sampled at discrete
// frames for real timeline keys and GLB/FBX animation export.
export function tailWagQuaternion(base,index,frame,durationFrames,{side=0,lift=0,amplitude=11}={}){
  const angle=THREE.MathUtils.degToRad(clamp(amplitude,0,25))
    *Math.sin((frame/Math.max(1,durationFrames))*Math.PI*2*TAIL_WAG_CYCLES-index*.62);
  const bias=tailPoseQuaternion(base,index,Math.max(index+1,2),side,lift);
  const bend=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
  return bias.multiply(bend).normalize();
}

export function tailWagFrames(durationFrames,step=TAIL_WAG_STEP){
  const duration=Math.max(1,Math.round(Number(durationFrames)||1));
  const stride=Math.max(1,Math.round(Number(step)||1));
  const result=[];
  for(let f=0;f<duration;f+=stride)result.push(f);
  result.push(duration);
  return result;
}
