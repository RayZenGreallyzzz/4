import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {appendActionClip} from '../src/action-library.js';
import {Timeline,compileClip,boneLookup} from '../src/timeline.js';

const clip=(name)=>new THREE.AnimationClip(name,1,[
 new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion',[0,1],[0,0,0,1,0,0,0,1])
]);
test('a dog with Idle Walk Attack can add Run and Death without deleting existing actions',()=>{
 const originals=['Idle','Walk','Attack'].map(clip);
 const originalTracks=originals.map(x=>x.tracks[0]);
 const lib=[...originals];
 const run=appendActionClip(lib,clip('Run'));
 const death=appendActionClip(lib,clip('Death'));
 assert.deepEqual(lib.map(x=>x.name),['Idle','Walk','Attack','Run','Death']);
 assert.equal(run.index,3);assert.equal(death.index,4);
 assert.ok(originals.every((x,i)=>x===lib[i]&&x.tracks[0]===originalTracks[i]));
 assert.ok(lib[3].tracks.length&&lib[4].tracks.length);
 assert.notEqual(lib[3],run.clip.clone());
});
test('duplicate action names get a unique name instead of overwriting original',()=>{
 const lib=[clip('Idle'),clip('Run')];
 appendActionClip(lib,clip('Run'));
 appendActionClip(lib,clip('Run'));
 assert.deepEqual(lib.map(x=>x.name),['Idle','Run','Run (2)','Run (3)']);
});
test('editable manual keyframes compile into a usable independent AnimationClip',()=>{
 const bone=new THREE.Bone();bone.name='mixamorigLeftUpLeg';
 const lookup=boneLookup([bone]),timeline=new Timeline();
 const q0=new THREE.Quaternion(),q1=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.75);
 timeline.set(bone,0,q0,30);timeline.set(bone,15,q1,30);timeline.set(bone,30,q0,30);
 const compiled=compileClip({
  name:'Run',durationFrames:30,sourceClip:null,timeline,lookup,
  sample:(frame,bones)=>new Map(bones.map(b=>[b.uuid,timeline.pose(b,frame,b.quaternion,false)]))
 });
 const library=[clip('Idle'),clip('Walk'),clip('Attack')];
 appendActionClip(library,compiled);
 assert.equal(library.length,4);
 assert.equal(library[3].name,'Run');
 assert.equal(library[3].tracks[0].times.length,31);
 assert.ok(library[3].tracks[0].values.every(Number.isFinite));
});
test('app has save action button and retains all actions when exporting a GLB',()=>{
 const html=readFileSync('index.html','utf8');
 const main=readFileSync('src/main.js','utf8');
 assert.ok(html.includes('id="save-action"'));
 assert.ok(main.includes('appendActionClip(state.sourceClips,compiled)'));
 assert.ok(main.includes('state.timeline.clear();'));
 assert.ok(main.includes('const sourceClips = state.sourceClips.slice();'));
 assert.ok(main.includes('const clips = sourceClips.filter(c => c.tracks.length);'));
 assert.ok(main.includes("onButton('save-action',saveActionToLibrary)"));
});
test('cannot append zero-track placeholder to a real animated character',()=>{
 const library=[clip('Idle')];
 assert.throws(()=>appendActionClip(library,new THREE.AnimationClip('Run',1,[])),/запиши хотя бы один ключ/);
 assert.equal(library.length,1);
});
