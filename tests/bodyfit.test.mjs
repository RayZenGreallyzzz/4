import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGuide,jointWorld} from '../src/autorig.js';
import {sampleGeometry,analyzeBodyGeometry,calculateHumanPose,fitGuideToGeometry} from '../src/bodyfit.js';
function addBox(group,name,size,position,segments=[8,8,8]){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size,...segments));
  mesh.position.set(...position);mesh.name=name;group.add(mesh);return mesh;
}
test('hair curtain BEHIND body does not pull spine out of torso',()=>{
  const model=new THREE.Group();
  addBox(model,'chest',[.50,1.1,.34],[0,1.27,0]);
  addBox(model,'pelvis',[.44,.38,.31],[0,.76,0]);
  addBox(model,'hair',[.85,1.45,.1],[0,1.24,-.9],[14,14,14]);
  addBox(model,'leftleg',[.2,.72,.22],[.16,.35,0]);
  addBox(model,'rightleg',[.2,.72,.22],[-.16,.35,0]);
  const guide=createGuide(new THREE.Box3().setFromObject(model));
  const oldSpine=jointWorld(guide,'mixamorigSpine1').z;
  const stats=fitGuideToGeometry(guide,model,'z+');
  const spine=jointWorld(guide,'mixamorigSpine1');
  assert.ok(spine.z>-.17 && spine.z<.17,'spine must be inside torso, got '+spine.z);
  assert.ok(spine.z>oldSpine+.18,'spine must move forward from behind hair');
  assert.ok(Math.abs(guide.root.position.z-spine.z)<.1,'rig anchor should follow torso depth');
  assert.ok(stats.sampleCount>20);
});
test('negative Z-facing models fit without moving bones into hair behind',()=>{
  const model=new THREE.Group();
  addBox(model,'torso',[.48,1.1,.3],[0,1.25,0]);
  addBox(model,'hair',[.65,1.3,.08],[0,1.3,.8]);
  addBox(model,'legs',[.35,.6,.22],[0,.3,0]);
  const guide=createGuide(new THREE.Box3().setFromObject(model));
  fitGuideToGeometry(guide,model,'z-');
  const spine=jointWorld(guide,'mixamorigSpine2');
  assert.ok(spine.z>-.17&&spine.z<.17,'spine z '+spine.z);
  assert.ok(jointWorld(guide,'mixamorigLeftHand').x<jointWorld(guide,'mixamorigRightHand').x);
});
test('rotated orientation +X and offset world model calculate true positions',()=>{
  const model=new THREE.Group();
  addBox(model,'torso',[.3,1.1,.5],[0,1.25,0]);
  addBox(model,'hair',[.07,1.25,.55],[-.8,1.3,0]);
  model.position.set(8,3,-5);
  const result=calculateHumanPose(model,'x+');
  const spine=result.positions.get('mixamorigSpine1');
  assert.ok(spine.x>7.80&&spine.x<8.2,'spine x '+spine.x);
  assert.ok(Math.abs(spine.z+5)<.5);
  assert.equal(result.positions.size,22);
});
test('invalid directions and empty model have understandable errors',()=>{
  const model=new THREE.Group();
  assert.throws(()=>analyzeBodyGeometry(model),/геометрии/);
  addBox(model,'torso',[1,2,1],[0,0,0]);
  assert.throws(()=>analyzeBodyGeometry(model,'hello'),/направление/);
  assert.ok(sampleGeometry(model).length>12);
});