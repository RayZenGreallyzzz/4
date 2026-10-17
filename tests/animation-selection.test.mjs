import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {AnimationSelection} from '../src/animation-selection.js';

const clip=name=>new THREE.AnimationClip(name,1,[
  new THREE.QuaternionKeyframeTrack('.quaternion',[0,1],[0,0,0,1,0,0,0,1])
]);
test('initial model animations stay included, newly imported movements do not export automatically',()=>{
 const base=['Idle','Walk','Attack'].map(clip),more=['Run','Death',...Array.from({length:154},(_,i)=>'Imported_'+i)].map(clip);
 const selection=new AnimationSelection(base),library=[...base,...more];
 assert.equal(selection.selected(library).length,3);
 assert.deepEqual(selection.selected(library).map(c=>c.name),['Idle','Walk','Attack']);
 assert.equal(selection.counts(library).pending,156);
 selection.mark(more[0],true);selection.mark(more[1],true);
 assert.equal(selection.selected(library).length,3,'checking before commit does not export');
 assert.equal(selection.isDirty(),true);
 selection.commit(library);
 assert.deepEqual(selection.selected(library).map(c=>c.name),['Idle','Walk','Attack','Run','Death']);
});
test('a loaded GLB with 159 existing animations can be reduced to precisely five actions',()=>{
 const library=Array.from({length:159},(_,i)=>clip(i===0?'Idle':i===1?'Walk':i===2?'Attack':i===5?'Run':i===9?'Death':'Other_'+i));
 const selection=new AnimationSelection(library);
 assert.equal(selection.counts(library).saved,159);
 selection.markAll(library,false);
 for(const i of [0,1,2,5,9])selection.mark(library[i],true);
 assert.equal(selection.selected(library).length,159,'unchecked but not yet confirmed');
 selection.commit(library);
 assert.deepEqual(selection.selected(library).map(x=>x.name),['Idle','Walk','Attack','Run','Death']);
});
test('checkbox changes must be committed before taking effect on export',()=>{
 const library=[clip('Idle'),clip('Walk')];const selection=new AnimationSelection(library);
 selection.mark(library[1],false);
 assert.equal(selection.isDirty(),true);
 assert.equal(selection.selected(library).length,2);
 selection.commit(library);
 assert.equal(selection.isDirty(),false);
 assert.deepEqual(selection.selected(library).map(c=>c.name),['Idle']);
});
test('a saved manual Death action joins set without including unrelated imported clips',()=>{
 const library=[clip('Idle'),clip('Walk'),clip('Attack')];
 const selection=new AnimationSelection(library);
 const other=clip('RandomImported');library.push(other);
 const death=clip('Death');library.push(death);selection.addManual(death);
 assert.deepEqual(selection.selected(library).map(x=>x.name),['Idle','Walk','Attack','Death']);
});
test('zero confirmed actions is a valid static GLB export, not all 159 again',()=>{
 const library=['Idle','Walk','Attack'].map(clip);
 const selection=new AnimationSelection(library);
 selection.markAll(library,false);selection.commit(library);
 assert.equal(selection.selected(library).length,0);
 assert.equal(selection.counts(library).saved,0);
});
test('source export UI uses only selected subset in both GLB and FBX',()=>{
 const html=readFileSync('index.html','utf8');
 const main=readFileSync('src/main.js','utf8');
 assert.ok(html.includes('id="actions-check-none"'));
 assert.ok(html.includes('id="actions-save-checked"'));
 assert.ok(html.includes('id="preview-clip-check"'));
 assert.ok(main.includes('state.animationSelection.selected(state.sourceClips)'));
 assert.ok(main.includes('const clips=selectedAnimationClipsForExport();'));
 assert.ok(!main.includes('const sourceClips = state.sourceClips.slice();'));
});
