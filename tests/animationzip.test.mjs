import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {collectAnimationSources} from '../src/animationbatch.js';

test('ZIP pack is catalogued without unpacking all models in advance',async()=>{
  const zip=new JSZip();
  zip.file('01_Стойки/001_Стойка.glb',new Uint8Array([0x67,0x6c,0x54,0x46,1]));
  zip.file('02_Передвижение/002_Бег.glb',new Uint8Array([0x67,0x6c,0x54,0x46,2]));
  zip.file('инструкция.txt','Это тестовый пакет');
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  bytes.name='mixamo.zip';
  bytes.size=bytes.length;
  const out=await collectAnimationSources([bytes]);
  assert.equal(out.sources.length,2);
  assert.deepEqual(out.sources.map(x=>x.name),['001_Стойка.glb','002_Бег.glb']);
  const first=await out.sources[0].fetchBlob();
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())],[0x67,0x6c,0x54,0x46,1]);
});
test('archive traversal paths and non-GLB entries do not become clips',async()=>{
  const zip=new JSZip();
  zip.file('good/move.glb',new Uint8Array([1,2,3]));
  zip.file('readme.md','hello');
  zip.file('other/model.fbx',new Uint8Array([1,2,3]));
  const bytes=await zip.generateAsync({type:'uint8array'});
  bytes.name='set.zip';bytes.size=bytes.length;
  const out=await collectAnimationSources([bytes]);
  assert.deepEqual(out.sources.map(s=>s.name),['move.glb']);
});
test('standalone GLB and FBX files remain supported alongside ZIP',async()=>{
  const a=new Blob([new Uint8Array([1])]);a.name='Pose.glb';
  const b=new Blob([new Uint8Array([2])]);b.name='Walk.fbx';
  const out=await collectAnimationSources([a,b]);
  assert.equal(out.sources.length,2);
  assert.equal(out.sources[1].name,'Walk.fbx');
});
