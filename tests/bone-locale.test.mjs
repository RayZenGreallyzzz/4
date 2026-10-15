import test from 'node:test';
import assert from 'node:assert/strict';
import {boneLabel,boneNameKey,boneMatchesSearch} from '../src/bone-locale.js';

test('localized forearms are actual elbow controls, legs are knee controls',()=>{
 assert.equal(boneLabel('mixamorigLeftForeArm'),'Левый локоть (предплечье)');
 assert.equal(boneLabel('mixamorigRightForeArm'),'Правый локоть (предплечье)');
 assert.equal(boneLabel('mixamorig:LeftLeg'),'Левое колено (голень)');
 assert.equal(boneLabel('mixamorig1:RightLeg'),'Правое колено (голень)');
});
test('Russian search and original Mixamo bone names both work',()=>{
 assert.ok(boneMatchesSearch('mixamorigLeftForeArm','локоть'));
 assert.ok(boneMatchesSearch('mixamorigRightLeg','колено'));
 assert.ok(boneMatchesSearch('mixamorigRightLeg','rightleg'));
 assert.ok(!boneMatchesSearch('mixamorigHead','колено'));
 assert.equal(boneNameKey('mixamorig:LeftLowerArm'),'leftforearm');
});
test('external bone identifiers remain unchanged, with fallback for custom rigs',()=>{
 assert.equal(boneLabel('Tail_05'),'Хвост · кость 5');
 assert.equal(boneLabel('AlienTentacleX'),'AlienTentacleX');
 assert.equal(boneLabel('mixamorig:LeftHandIndex2'),'Левая кисть · указательный палец 2');
});
