import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,moveJointWorld,jointWorld,addGuideChain} from '../src/autorig.js';
import {regionForJoint,anatomicalJointPlane,frontalJointPlane,RigPlaneOverlay} from '../src/rig-planes.js';

const build=()=>createGuide(new THREE.Box3(
  new THREE.Vector3(-1,0,-.3),new THREE.Vector3(1,2,.3)
));
const equal=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('independent regions for torso, head, left/right upper and lower limbs',()=>{
 const g=build();
 const table={
  mixamorigSpine:'torso',mixamorigHead:'head',
  mixamorigLeftArm:'leftUpperArm',mixamorigRightArm:'rightUpperArm',
  mixamorigLeftForeArm:'leftForearm',mixamorigRightHand:'rightForearm',
  mixamorigLeftUpLeg:'leftThigh',mixamorigRightUpLeg:'rightThigh',
  mixamorigLeftLeg:'leftShin',mixamorigRightFoot:'rightShin'
 };
 for(const [name,region] of Object.entries(table))
   assert.equal(regionForJoint(name,g),region,name);
});
test('independent plane passes through current joint, regardless of camera angle',()=>{
 const g=build(), name='mixamorigRightForeArm';
 const p=anatomicalJointPlane(g,name,'z+');
 assert.equal(p.region,'rightForearm');
 equal(p.plane.distanceToPoint(jointWorld(g,name)),0);
 equal(p.normal.length(),1);
 const sideways=frontalJointPlane(jointWorld(g,name),'x+');
 equal(sideways.normal.x,1);
 equal(sideways.plane.distanceToPoint(jointWorld(g,name)),0);
});
test('bent knee follows its own sagittal orientation and stays inside plane',()=>{
 const g=build(),name='mixamorigLeftLeg';
 const hip=jointWorld(g,'mixamorigLeftUpLeg');
 moveJointWorld(g,name,new THREE.Vector3(hip.x+.07, hip.y-.23,hip.z+.16));
 const plane=anatomicalJointPlane(g,name,'z+');
 equal(plane.plane.distanceToPoint(jointWorld(g,name)),0);
 assert.ok(Math.abs(plane.normal.x)>.2);
 assert.equal(plane.region,'leftShin');
 assert.notEqual(plane.region,regionForJoint('mixamorigRightLeg',g));
});
test('additional tail chain creates a private segment plane',()=>{
 const g=build(),chain=addGuideChain(g,'tail',5);
 const joint=chain.names[2];
 const p=anatomicalJointPlane(g,joint,'z+');
 assert.equal(p.region,chain.id);
 equal(p.plane.distanceToPoint(jointWorld(g,joint)),0);
});
test('overlay is only a helper and can be disposed without changing source rig',()=>{
 const scene=new THREE.Scene(),g=build(),original=jointWorld(g,'mixamorigHead');
 const overlay=new RigPlaneOverlay(scene);
 assert.equal(overlay.group.visible,false);
 const pose=overlay.update(g,'mixamorigHead','z+',true);
 assert.equal(pose.region,'head');
 assert.equal(overlay.group.visible,true);
 overlay.update(g,'mixamorigHead','z+',false);
 assert.equal(overlay.group.visible,false);
 equal(jointWorld(g,'mixamorigHead').distanceTo(original),0);
 overlay.dispose();
 assert.ok(!scene.children.includes(overlay.group));
});
test('android editor includes opt-in anatomically aligned drag planes',async()=>{
 const {readFileSync}=await import('node:fs');
 const main=readFileSync('src/main.js','utf8'),html=readFileSync('index.html','utf8');
 assert.ok(main.includes('anatomicalJointPlane(state.rigGuide,name'));
 assert.ok(main.includes('rigDragPlane.copy('));
 assert.ok(html.includes('id="autorig-plane-mode"'));
 assert.ok(html.includes('id="autorig-plane-visible"'));
});
