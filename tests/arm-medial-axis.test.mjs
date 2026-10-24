import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,jointWorld} from '../src/autorig.js';
import {traceArmMedialAxis,fitArmMedialAxes} from '../src/arm-medial-axis.js';
function V(x,y,z=0){return new THREE.Vector3(x,y,z)}
const info={height:2,lateralAxis:'x',lateralCenter:0,depthAxis:'z',forwardSign:1};
function tube(start,end,radius,count=42){
 const out=[],delta=end.clone().sub(start).normalize();
 const ref=new THREE.Vector3(0,0,1);
 const u=new THREE.Vector3().crossVectors(delta,ref).normalize();
 const v=new THREE.Vector3().crossVectors(delta,u).normalize();
 for(let i=0;i<count;i++)for(let j=0;j<28;j++){
  const t=(i+.5)/count,ang=j*Math.PI*2/28;
  out.push(start.clone().lerp(end,t)
    .addScaledVector(u,Math.cos(ang)*radius)
    .addScaledVector(v,Math.sin(ang)*radius));
 }
 return out;
}
function createTestArm(side=1,kind='a'){
 const shoulder=V(side*.3,1.68,0);
 const elbow=kind==='t'?V(side*.55,1.68,.03):V(side*.41,1.37,.045);
 const wrist=kind==='t'?V(side*.79,1.68,.03):V(side*.52,1.05,.065);
 const claw=kind==='t'?V(side*1.02,1.68,.03):V(side*.61,.77,.08);
 const body=[],arm=[
   ...tube(shoulder,elbow,.047,45),...tube(elbow,wrist,.036,44),
   ...tube(wrist,claw,.009,26)
 ];
 // Torso surface distractions near the shoulder: should not shift entire axis.
 for(let j=0;j<360;j++){
   const x=side*(.145+(j%10)*.005);
   const y=1.05+(Math.floor(j/10)/36)*.65;
   const z=(j%9-4)*.015;
   body.push(V(x,y,z));
 }
 return {shoulder,elbow,wrist,claw,points:[...arm,...body]};
}
test('Stage8 follows medial A-pose arm and excludes long claw',()=>{
 const f=createTestArm(1,'a');
 const result=traceArmMedialAxis(f.points,info,'left',f.shoulder,f.claw);
 assert.equal(result.ok,true,result.reason);
 assert.ok(result.shoulder.distanceTo(f.shoulder)<.26,'shoulder is near actual insertion');
 assert.ok(result.elbow.distanceTo(f.elbow)<.25,'elbow follows bending arm');
 assert.ok(result.wrist.distanceTo(f.wrist)<.25,'wrist is near palm base');
 assert.ok(result.wrist.distanceTo(f.claw)>.19,'wrist is not at end of claw');
 assert.ok(result.sections>=6);
});
test('Stage8 works for symmetric opposite arm and T-pose',()=>{
 for(const side of [-1,1]){
  const f=createTestArm(side,'t');
  const result=traceArmMedialAxis(f.points,info,side===1?'left':'right',f.shoulder,f.claw);
  assert.equal(result.ok,true,result.reason);
  assert.ok(result.wrist.distanceTo(f.wrist)<.25,'wrist stays before claws');
 }
});
test('does not invent joints on empty/incomplete geometry',()=>{
 const f=createTestArm(1);
 const result=traceArmMedialAxis(f.points.slice(0,3),info,'left',f.shoulder,f.claw);
 assert.equal(result.ok,false);
 assert.match(result.reason,/сечени/);
});
test('Stage8 leaves guide unchanged when no geometric hand is accepted',()=>{
 const root=new THREE.Group();
 const sphere=new THREE.Mesh(new THREE.SphereGeometry(.5,14,14));
 sphere.position.y=1;root.add(sphere);
 const guide=createGuide(new THREE.Box3().setFromObject(root));
 const before=[...guide.bones].map(([name])=>[name,jointWorld(guide,name).clone()]);
 assert.throws(()=>fitArmMedialAxes(guide,root),/не подтверждена/);
 for(const [name,p] of before)
  assert.ok(p.distanceTo(jointWorld(guide,name))<1e-8,'model changed despite rejected fit '+name);
});
