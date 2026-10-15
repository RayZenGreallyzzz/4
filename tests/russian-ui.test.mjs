import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

test('Russian pose guide, frame navigation and joint shortcuts have wired controls',()=>{
  for(const id of ['frame-number','new-clip','key-pose','key-bone','bone-search']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  for(const key of ['leftforearm','rightforearm','leftleg','rightleg']){
    assert.ok(html.includes('data-joint="'+key+'"'));
    assert.ok(code.includes("b.dataset.joint"));
  }
  for(const frame of [0,10,20,30])assert.ok(html.includes('data-frame-jump="'+frame+'"'));
  assert.ok(code.includes("showFrame(Number(b.dataset.frameJump))"));
  assert.ok(code.includes("showFrame(Number(event.target.value))"));
  assert.match(html,/Как создать свою анимацию/);
});
test('rotation writes bone key; whole-pose button writes all bones',()=>{
  assert.match(code,/function editAngle\(axis, value\)[\s\S]*?state\.timeline\.set\(bone,state\.frame,bone\.quaternion,state\.frames\)/);
  assert.match(code,/function keyPose\(\)[\s\S]*?for\(const bone of state\.bones\) state\.timeline\.set/);
  assert.match(code,/boneMatchesSearch\(b\.name,query\)/);
  assert.match(code,/name\.textContent = boneLabel\(bone\.name\)/);
});
