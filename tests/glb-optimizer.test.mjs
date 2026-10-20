import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ANDROID_BALANCED, describeSource, parseGlb, validateAndroidGlb }
  from '../src/glb-optimizer.js';

// Three.js needs FileReader in Node even for a GLB without textures.
class TestFileReader {
  constructor() { this.result = null; this.onloadend = null; this.onerror = null; }
  async readAsArrayBuffer(blob) {
    try { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
    catch (e) { this.onerror?.(e); }
  }
}
globalThis.FileReader ??= TestFileReader;

function fixture(json, bin = new Uint8Array(0)) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonSize = Math.ceil(text.length / 4) * 4;
  const binSize = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonSize + (bin.length ? 8 + binSize : 0);
  const raw = new Uint8Array(total);
  const view = new DataView(raw.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonSize, true);
  view.setUint32(16, 0x4e4f534a, true);
  raw.fill(32, 20, 20 + jsonSize);
  raw.set(text, 20);
  if (bin.length) {
    const at = 20 + jsonSize;
    view.setUint32(at, binSize, true);
    view.setUint32(at + 4, 0x004e4942, true);
    raw.set(bin, at + 8);
  }
  return raw.buffer;
}

test('balanced preset keeps uncompressed geometry, animations and textures <= 1024', () => {
  assert.equal(ANDROID_BALANCED.maxTextureSize, 1024);
  assert.equal(ANDROID_BALANCED.onlyVisible, false);
  assert.equal(ANDROID_BALANCED.includeCustomExtensions, false);
});

test('GLB header corruption and external resources are rejected', () => {
  assert.throws(() => parseGlb(new Uint8Array(8)), /короткий/);
  const data = fixture({ asset: { version:'2.0' }, buffers: [{ byteLength: 12 }] });
  assert.throws(() => parseGlb(data), /неполные/);
});

test('loss of skins, rig weights or animation clips blocks saving', () => {
  const source = { meshes:1, skinnedMeshes:1, maxBones:2,
    animationNames:['Walk'], animationTrackCounts:[1] };
  const doc = { asset:{version:'2.0'}, meshes:[{primitives:[{attributes:{POSITION:0}}]}],
    nodes:[{mesh:0,skin:0}],skins:[{joints:[1,2]}],
    animations:[{name:'Walk',channels:[{sampler:0,target:{node:1,path:'rotation'}}],
      samplers:[{}]}] };
  assert.throws(() => validateAndroidGlb(fixture(doc),source), /веса/);
  doc.meshes[0].primitives[0].attributes.JOINTS_0=1;
  doc.meshes[0].primitives[0].attributes.WEIGHTS_0=2;
  assert.equal(validateAndroidGlb(fixture(doc),source).animations,1);
  doc.animations=[];
  assert.throws(() => validateAndroidGlb(fixture(doc),source), /потеряны анимации/);
  doc.animations=[{name:'Walk',channels:[{sampler:0,target:{node:1,path:'rotation'}}]}];
  doc.skins=[{joints:[1]}];
  assert.throws(() => validateAndroidGlb(fixture(doc),source), /кости/);
});

test('texture larger than 1024 pixels fails instead of silently exporting', () => {
  const png=new Uint8Array(24);
  png.set([137,80,78,71,13,10,26,10],0);
  new DataView(png.buffer).setUint32(16,2048);
  new DataView(png.buffer).setUint32(20,1024);
  const doc={asset:{version:'2.0'},buffers:[{byteLength:24}],
    images:[{mimeType:'image/png',bufferView:0}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:24}]};
  const src={meshes:0,skinnedMeshes:0,maxBones:0,animationNames:[],animationTrackCounts:[]};
  assert.throws(()=>validateAndroidGlb(fixture(doc,png),src),/превышает/);
  new DataView(png.buffer).setUint32(16,1024);
  assert.equal(validateAndroidGlb(fixture(doc,png),src).textures,1);
});

test('real GLTFExporter retains a skinned mesh and an animation in Android mode', async () => {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name='Spine';
  root.add(bone);
  const geom = new THREE.BoxGeometry(1,1,1);
  const vertices = geom.getAttribute('position').count;
  const skinIndices=new Uint16Array(vertices*4);
  const skinWeights=new Float32Array(vertices*4);
  for(let i=0;i<vertices;i++)skinWeights[i*4]=1;
  geom.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));
  geom.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeights,4));
  const mesh=new THREE.SkinnedMesh(geom,new THREE.MeshStandardMaterial());
  mesh.name='Body';
  root.add(mesh);
  mesh.bind(new THREE.Skeleton([bone]));
  const clip=new THREE.AnimationClip('Idle',1,[
    new THREE.QuaternionKeyframeTrack(bone.uuid+'.quaternion',[0,1],
      [0,0,0,1,0,0,0,1])
  ]);
  const shape=describeSource(root,[clip]);
  assert.equal(shape.skinnedMeshes,1);
  const scene=new THREE.Scene();
  scene.add(root);
  const glb=await new GLTFExporter().parseAsync(scene,{
    ...ANDROID_BALANCED, animations:[clip]
  });
  const result=validateAndroidGlb(glb,shape);
  assert.equal(result.animations,1);
  assert.equal(result.skinnedMeshes,1);
  assert.equal(result.meshes,1);
});
