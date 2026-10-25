import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

test('Tripo Meshopt decoder bundled with Three.js initializes offline',async()=>{
  await MeshoptDecoder.ready;
  assert.equal(MeshoptDecoder.supported,true);
  assert.equal(typeof MeshoptDecoder.decodeGltfBuffer,'function');
});

test('model importer configures decoder on its GLTFLoader before loading',()=>{
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const dec=source.indexOf('gltfLoader.setMeshoptDecoder(MeshoptDecoder)');
 const load=source.indexOf('await gltfLoader.loadAsync(url)');
 assert.ok(dec>=0,'decoder registration is required');
 assert.ok(load>dec,'must configure Meshopt before loading');
});
