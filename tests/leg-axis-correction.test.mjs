import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,jointWorld,moveJointWorld} from '../src/autorig.js';
import {lowerLegCrossSection,centerLowerLegAxes} from '../src/leg-axis-correction.js';

function legPoints(cx,z=0){
 const out=[];
 for(let j=0;j<36;j++){
  const y=.12+j*.020;
  for(let a=0;a<22;a++){
   const t=a*Math.PI*2/22;
   out.push(new THREE.Vector3(cx+Math.cos(t)*.047,y,z+Math.sin(t)*.049));
  }
 }
 return out;
}
const info={height:2,lateralAxis:'x',lateralCenter:0,depthAxis:'z',forwardSign:1};
test('separate legs: kneecap stays centered even with opposite leg, claws and spikes',()=>{
 const pts=[...legPoints(.17,.025),...legPoints(-.17,-.025)];
 for(let j=0;j<150;j++)pts.push(new THREE.Vector3(.38+.01*j/150,.33,.15));
 const h=new THREE.Vector3(.16,.93,.02);
 const left=lowerLegCrossSection(pts,info,'left',h,.37);
 const right=lowerLegCrossSection(pts,info,'right',new THREE.Vector3(-.16,.93,-.02),.37);
 assert.equal(left.ok,true,left.reason);
 assert.equal(right.ok,true,right.reason);
 assert.ok(Math.abs(left.position.x-.17)<.025,'left knee centre');
 assert.ok(Math.abs(right.position.x+.17)<.025,'right knee centre');
 assert.ok(Math.abs(left.position.z-.025)<.03,'left knee depth');
});
test('no measured surface must not move any joint',()=>{
 const root=new THREE.Group();
 const g=new THREE.Mesh(new THREE.BoxGeometry(.42,1.5,.24),new THREE.MeshBasicMaterial());
 g.position.y=1;root.add(g);root.updateWorldMatrix(true,true);
 const guide=createGuide(new THREE.Box3().setFromObject(root));
 const names=[...guide.bones.keys()];
 const before=names.map(n=>jointWorld(guide,n).clone());
 assert.throws(()=>centerLowerLegAxes(guide,root),/Не удалось подтвердить/);
 names.forEach((n,i)=>assert.ok(jointWorld(guide,n).distanceTo(before[i])<1e-8,n+' moved despite no leg geometry'));
});
test('leg centering preserves original knee and ankle Y and hip/head/arms',()=>{
 const root=new THREE.Group();
 const mkCylinder=(x)=>{
  const m=new THREE.Mesh(new THREE.CylinderGeometry(.048,.052,.71,22,60),new THREE.MeshBasicMaterial());
  m.position.set(x,.48,0);root.add(m);
 };
 mkCylinder(.17);mkCylinder(-.17);
 const torso=new THREE.Mesh(new THREE.BoxGeometry(.28,.75,.15,14,40,10),new THREE.MeshBasicMaterial());
 torso.position.y=1.15;root.add(torso);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.1,12,12),new THREE.MeshBasicMaterial());
 head.position.y=1.66;root.add(head);
 root.updateWorldMatrix(true,true);
 const guide=createGuide(new THREE.Box3().setFromObject(root));
 // Position hips correctly but displace shins in the front/back axis.
 const beforeProtect=['mixamorigHips','mixamorigHead','mixamorigSpine2','mixamorigLeftArm','mixamorigRightArm']
   .map(n=>[n,jointWorld(guide,n).clone()]);
 for(const side of ['Left','Right']){
   const x=side==='Left'?.17:-.17;
   moveJointWorld(guide,'mixamorig'+side+'UpLeg',new THREE.Vector3(x,.91,0));
   moveJointWorld(guide,'mixamorig'+side+'Leg',new THREE.Vector3(x,.53,.14));
   moveJointWorld(guide,'mixamorig'+side+'Foot',new THREE.Vector3(x,.16,.14));
 }
 const heights=['LeftLeg','LeftFoot','RightLeg','RightFoot']
   .map(n=>[n,jointWorld(guide,'mixamorig'+n).y]);
 const r=centerLowerLegAxes(guide,root);
 assert.equal(r.changed.length,4,JSON.stringify(r.report));
 for(const [n,y] of heights)assert.ok(Math.abs(jointWorld(guide,'mixamorig'+n).y-y)<1e-7);
 for(const [n,p] of beforeProtect)assert.ok(jointWorld(guide,n).distanceTo(p)<1e-7,n);
 assert.ok(Math.abs(jointWorld(guide,'mixamorigLeftLeg').z)<.04);
 assert.ok(Math.abs(jointWorld(guide,'mixamorigRightFoot').z)<.04);
});
