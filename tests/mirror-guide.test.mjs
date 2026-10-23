import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,moveJointWorld,jointWorld,mirrorGuideJoint,oppositeGuideJointName,addGuideChain} from '../src/autorig.js';

function setup(){
 const guide=createGuide(new THREE.Box3(new THREE.Vector3(-1,0,-.4),new THREE.Vector3(1,2,.4)));
 return guide;
}
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,a+' ≠ '+b);
test('moving LEFT elbow places RIGHT elbow symmetrically about torso center',()=>{
 const g=setup(),L='mixamorigLeftForeArm',R='mixamorigRightForeArm';
 const center=jointWorld(g,'mixamorigHips');
 const original=jointWorld(g,R);
 moveJointWorld(g,L,new THREE.Vector3(center.x+.73,1.34,.3));
 assert.equal(mirrorGuideJoint(g,L),true);
 const right=jointWorld(g,R);
 approx(right.x,center.x-.73);approx(right.y,1.34);approx(right.z,.3);
 assert.ok(right.distanceTo(original)>.03);
});
test('right knee mirrors onto left, independently from T or A stance',()=>{
 const g=setup();const H=jointWorld(g,'mixamorigHips');
 moveJointWorld(g,'mixamorigRightLeg',new THREE.Vector3(H.x-.28,.65,-.22));
 assert.equal(mirrorGuideJoint(g,'mixamorigRightLeg'),true);
 const L=jointWorld(g,'mixamorigLeftLeg');
 approx(L.x,H.x+.28);approx(L.y,.65);approx(L.z,-.22);
});
test('mirroring respects models facing +X with Z as lateral axis',()=>{
 const g=setup();g.lastFit={direction:'x+'};
 const H=jointWorld(g,'mixamorigHips');
 moveJointWorld(g,'mixamorigLeftArm',new THREE.Vector3(.18,1.6,H.z+.48));
 assert.equal(mirrorGuideJoint(g,'mixamorigLeftArm'),true);
 const R=jointWorld(g,'mixamorigRightArm');
 approx(R.x,.18);approx(R.y,1.6);approx(R.z,H.z-.48);
});
test('mirror handles transformed guide root and independent attached chains',()=>{
 const g=setup();g.root.position.set(.3,.2,-.3);g.root.scale.setScalar(1.2);
 addGuideChain(g,'earLeft',3);addGuideChain(g,'earRight',3);
 const A='LeftEar_02',B='RightEar_02',C=jointWorld(g,'mixamorigHips');
 const pos=jointWorld(g,A).add(new THREE.Vector3(.13,.12,.04));
 moveJointWorld(g,A,pos);
 assert.equal(mirrorGuideJoint(g,A),true);
 const localA=g.root.worldToLocal(jointWorld(g,A));
 const localB=g.root.worldToLocal(jointWorld(g,B));
 const localC=g.root.worldToLocal(C);
 approx(localA.x+localB.x,2*localC.x);
 approx(localA.y,localB.y);approx(localA.z,localB.z);
});
test('unpaired bones and root do not modify hierarchy',()=>{
 const g=setup();
 assert.equal(mirrorGuideJoint(g,'mixamorigHips'),false);
 assert.equal(mirrorGuideJoint(g,'__root__'),false);
 assert.equal(oppositeGuideJointName('mixamorigLeftArm'),'mixamorigRightArm');
 assert.equal(oppositeGuideJointName('mixamorigRightUpLeg'),'mixamorigLeftUpLeg');
 assert.equal(oppositeGuideJointName('Tail_01'),null);
});
test('app offers opt-in mirror for touch drag, gizmo, XYZ and snap',async()=>{
 const {readFileSync}=await import('node:fs');
 const main=readFileSync('src/main.js','utf8'),html=readFileSync('index.html','utf8');
 assert.ok(html.includes('id="autorig-mirror"'));
 assert.ok(main.includes('state.rigMirror=event.target.checked'));
 assert.ok(main.includes('if(state.rigMirror)mirrorGuideJoint'));
 assert.ok(main.includes("moveFittedJoint(rigDrag.name"));
 assert.ok(main.includes("moveFittedJoint(part,snap.point)"));
 assert.ok(main.includes("moveFittedJoint(state.rigSelected,point)"));
});
