import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createGuide, addGuideChain } from '../src/autorig.js';
import { bindRigToMeshes } from '../src/skinning.js';

// GLTFExporter uses browser FileReader even for raw binary GLB in Node.
class BinaryFileReader {
  constructor(){this.result=null;this.onloadend=null;this.onerror=null;}
  async readAsArrayBuffer(blob){
    try{this.result=await blob.arrayBuffer();this.onloadend?.();}
    catch(error){this.error=error;this.onerror?.(error);}
  }
}
globalThis.FileReader ??= BinaryFileReader;

test('exported GLB actually contains SKIN joints and weighted vertex attributes',async()=>{
  const model=new THREE.Group();
  model.name='Creature';
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,1.8,.4,4,6,4),new THREE.MeshBasicMaterial({color:'red'}));
  mesh.position.y=.9;mesh.name='Body';
  model.add(mesh);
  const guide=createGuide(new THREE.Box3(new THREE.Vector3(-.8,0,-.9),new THREE.Vector3(.8,1.8,.9)));
  const tail=addGuideChain(guide,'tail',4);
  const {bones}=await bindRigToMeshes(model,guide);
  assert.equal(bones.length,26);
  const scene=new THREE.Scene();scene.add(model);
  const binary=await new GLTFExporter().parseAsync(scene,{binary:true,trs:true,onlyVisible:true,animations:[]});
  assert.ok(binary instanceof ArrayBuffer);
  const view=new DataView(binary);
  assert.equal(view.getUint32(0,true),0x46546c67);
  const jsonLen=view.getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(binary,20,jsonLen)).trim());
  assert.ok(json.skins?.length,'GLB must include a real skins array');
  assert.ok(json.skins[0].joints.length>=26,'GLB skin must contain tail bones');
  const attrs=json.meshes.flatMap(m=>m.primitives.map(p=>p.attributes));
  assert.ok(attrs.some(a=>'JOINTS_0' in a && 'WEIGHTS_0' in a),'Skin indices/weights must survive GLB export');
  assert.ok(json.nodes.some(n=>n.name===tail.names.at(-1)),'Tail final joint must be exported');
});