import * as THREE from 'three';
import {jointWorld} from './autorig.js';

// Guides are independent editing aids: never skin geometry or rotate bones.
const standard = Object.freeze({
  torso: {label:'Туловище',refs:['mixamorigHips','mixamorigSpine1','mixamorigSpine2'],kind:'front'},
  head: {label:'Голова и шея',refs:['mixamorigSpine2','mixamorigNeck','mixamorigHead'],kind:'front'},
  leftUpperArm: {label:'Левое плечо',refs:['mixamorigLeftShoulder','mixamorigLeftArm','mixamorigLeftForeArm'],kind:'front'},
  leftForearm: {label:'Левое предплечье',refs:['mixamorigLeftArm','mixamorigLeftForeArm','mixamorigLeftHand'],kind:'front'},
  rightUpperArm: {label:'Правое плечо',refs:['mixamorigRightShoulder','mixamorigRightArm','mixamorigRightForeArm'],kind:'front'},
  rightForearm: {label:'Правое предплечье',refs:['mixamorigRightArm','mixamorigRightForeArm','mixamorigRightHand'],kind:'front'},
  leftThigh: {label:'Левое бедро',refs:['mixamorigLeftUpLeg','mixamorigLeftLeg','mixamorigLeftFoot'],kind:'sagittal'},
  leftShin: {label:'Левая голень',refs:['mixamorigLeftLeg','mixamorigLeftFoot','mixamorigLeftToeBase'],kind:'sagittal'},
  rightThigh: {label:'Правое бедро',refs:['mixamorigRightUpLeg','mixamorigRightLeg','mixamorigRightFoot'],kind:'sagittal'},
  rightShin: {label:'Правая голень',refs:['mixamorigRightLeg','mixamorigRightFoot','mixamorigRightToeBase'],kind:'sagittal'}
});

export function regionForJoint(name,guide) {
  const n = String(name||'').replace(/^mixamorig\d*[:_]?/i,'');
  if (n==='__root__') return 'torso';
  // Additional joint chains may have independent orientations, never alter
  // core humanoid guides to fit wings, tails or extra limbs.
  const chain=guide?.chains?.find(entry=>entry.names?.includes(name));
  if(chain) return chain.id;
  if (/^(Left|Right)(ForeArm|Hand)/.test(n)) return n.startsWith('Left')?'leftForearm':'rightForearm';
  if (/^(Left|Right)(Shoulder|Arm)/.test(n)) return n.startsWith('Left')?'leftUpperArm':'rightUpperArm';
  if (/^(Left|Right)(Leg|Foot|ToeBase)/.test(n)) return n.startsWith('Left')?'leftShin':'rightShin';
  if (/^(Left|Right)UpLeg/.test(n)) return n.startsWith('Left')?'leftThigh':'rightThigh';
  if (/^(Head|Neck)/.test(n)) return 'head';
  return 'torso';
}

export function facingNormal(direction='z+') {
  const sign=direction.endsWith('-')?-1:1;
  return String(direction).startsWith('x')
    ? new THREE.Vector3(sign,0,0) : new THREE.Vector3(0,0,sign);
}

export function frontalJointPlane(point,direction='z+') {
  const normal=facingNormal(direction);
  return {point:point.clone(),normal,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point)};
}

function chainPoints(guide,name) {
  const chain=guide?.chains?.find(c=>c.names?.includes(name));
  if(!chain)return null;
  const index=chain.names.indexOf(name);
  const get=n=>jointWorld(guide,n);
  const first=Math.max(0,Math.min(index-1,chain.names.length-3));
  const refs=chain.names.slice(first,first+3);
  return refs.map(get);
}

export function anatomicalJointPlane(guide,name,direction='z+') {
  const point=jointWorld(guide,name);
  if(!point) return null;
  const region=regionForJoint(name,guide);
  const spec=standard[region];
  const front=facingNormal(direction);
  // The sagittal default allows knees to move forward/back in 3D.
  const fallback=(spec?.kind==='sagittal')
    ? new THREE.Vector3(front.z,0,-front.x).normalize() : front;
  const refs=spec ? spec.refs.map(n=>jointWorld(guide,n)) : chainPoints(guide,name);
  let normal=fallback.clone(),estimated=false;
  if(refs?.length===3 && refs.every(Boolean)) {
    const ab=refs[1].clone().sub(refs[0]),bc=refs[2].clone().sub(refs[1]);
    const denom=ab.length()*bc.length();
    if(denom>1e-12) {
      const cross=ab.cross(bc);
      const bend=cross.length()/denom;
      if(bend>=.18) {
        normal.copy(cross.normalize());
        if(normal.dot(fallback)<0)normal.negate();
        estimated=true;
      }
    }
  }
  const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point);
  return {
    region,label:spec?.label || (guide?.chains?.find(c=>c.id===region)?.type||region),
    point,normal,plane,estimated
  };
}

// A translucent overlay for the CURRENT anatomical editing plane.
// No per-frame allocations and no changes to mesh materials or skeleton.
export class RigPlaneOverlay {
  constructor(scene) {
    this.scene=scene;
    this.group=new THREE.Group();
    this.group.name='XR_AnatomicalGuide_NotExported';
    const base=new THREE.PlaneGeometry(1,1);
    this.mesh=new THREE.Mesh(base,new THREE.MeshBasicMaterial({
      color:0x45d5da,transparent:true,opacity:.15,depthWrite:false,depthTest:false,
      side:THREE.DoubleSide
    }));
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(base),new THREE.LineBasicMaterial({
      color:0x81fff0,transparent:true,opacity:.8,depthTest:false,depthWrite:false
    }));
    const segments=[-.5,0,.5];
    const vertices=[];
    for(const value of segments){
      vertices.push(value,-.5,0,value,.5,0,-.5,value,0,.5,value,0);
    }
    const grid=new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)),
      new THREE.LineBasicMaterial({color:0x7ddbd2,transparent:true,opacity:.55,depthTest:false,depthWrite:false})
    );
    this.group.add(this.mesh,edge,grid);
    this.group.traverse(node=>{node.renderOrder=960;});
    this.group.visible=false;
    scene.add(this.group);
  }
  update(guide,name,direction,show=true){
    const pose=guide&&name?anatomicalJointPlane(guide,name,direction):null;
    this.group.visible=Boolean(show && pose);
    if(!this.group.visible)return pose;
    const h=Math.max(.2,guide.height||1);
    const upper=/torso/.test(pose.region),head=pose.region==='head';
    const x=h*(upper?.38:head?.20:.22);
    const y=h*(upper?.60:head?.30:.33);
    this.group.position.copy(pose.point);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),pose.normal);
    this.group.scale.set(x,y,1);
    return pose;
  }
  dispose(){
    this.scene.remove(this.group);
    this.mesh.geometry.dispose();
    const used=new Set();
    this.group.traverse(obj=>{
      if(obj.isLineSegments && obj.geometry!==this.mesh.geometry)obj.geometry.dispose();
      if(obj.material&&!used.has(obj.material)){used.add(obj.material);obj.material.dispose();}
    });
  }
}
