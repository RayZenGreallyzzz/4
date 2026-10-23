import * as THREE from 'three';
import {LIMB_GROUPS,normalBoneName} from './limb-weights.js';

/**
 * Display-only preview. Each mesh receives a lightweight geometry container
 * that SHARES source position/skin attributes, adds only temporary vertex
 * color, and swaps in an unlit material. Undo restores exact source objects;
 * no diagnostic color/geometry is written to a GLB export.
 */
export class LimbWeightHeatmap {
 constructor(){this.entries=[];this.active=false;this.group='all';}
 show(root,group='all',maxVertices=900000){
  this.hide();
  if(!root)return 0;
  const meshes=[];root.traverse(m=>{
   if(m.isSkinnedMesh && m.geometry?.getAttribute('position') &&
     m.geometry?.getAttribute('skinWeight'))meshes.push(m);
  });
  const total=meshes.reduce((n,m)=>n+m.geometry.getAttribute('position').count,0);
  if(total>maxVertices)throw Error('Слишком много вершин для карты весов на этом устройстве.');
  let count=0;
  try{
   for(const mesh of meshes){
    const geo=mesh.geometry,pos=geo.getAttribute('position'),
      indices=geo.getAttribute('skinIndex'),weights=geo.getAttribute('skinWeight');
    if(!indices||!weights)continue;
    const allowed=new Set((group==='all'?Object.values(LIMB_GROUPS).flat():
      LIMB_GROUPS[group]||[]).map(name=>name.toLowerCase()));
    const groupIds=new Set();
    mesh.skeleton?.bones?.forEach((bone,i)=>{
     if(allowed.has(normalBoneName(bone.name)))groupIds.add(i);
    });
    if(!groupIds.size)continue;
    const colors=new Float32Array(pos.count*3);
    const gets=['getX','getY','getZ','getW'];
    for(let i=0;i<pos.count;i++){
      let influence=0;
      for(let k=0;k<4;k++)if(groupIds.has(indices[gets[k]](i)))
        influence+=weights[gets[k]](i);
      influence=Math.min(1,Math.max(0,influence));
      // Blue: no weight; vivid yellow-red: strong weight. Selected
      // forearm/foot should not paint the opposite limb.
      colors[i*3]=.07+.93*influence;
      colors[i*3+1]=.18+.55*Math.sin(Math.PI*influence);
      colors[i*3+2]=.38*(1-influence);
    }
    const preview=new THREE.BufferGeometry();
    preview.name=geo.name;
    for(const [name,attribute] of Object.entries(geo.attributes))
      if(name!=='color')preview.setAttribute(name,attribute);
    preview.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    if(geo.index)preview.setIndex(geo.index);
    preview.groups=geo.groups.map(g=>({...g}));
    preview.drawRange={...geo.drawRange};
    preview.morphAttributes={...geo.morphAttributes};
    preview.morphTargetsRelative=geo.morphTargetsRelative;
    const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
    this.entries.push({mesh,geometry:geo,material:mesh.material,preview,previewMaterial:material});
    mesh.geometry=preview;
    mesh.material=material;
    count+=pos.count;
   }
   this.active=Boolean(this.entries.length);
   this.group=group;
   return count;
  }catch(e){this.hide();throw e}
 }
 hide(){
  for(const {mesh,geometry,material,preview,previewMaterial} of this.entries){
    mesh.geometry=geometry;mesh.material=material;
    preview.dispose();previewMaterial.dispose();
  }
  this.entries=[];
  this.active=false;
 }
}
