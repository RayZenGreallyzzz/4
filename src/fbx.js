// Genuine FBX 7.4 binary exporter. Loaded only when the user taps "FBX";
// importing/editing a GLB does not carry the FBX writer in the initial bundle.
// Package: @comfyorg/fbx-exporter-three (MIT), compatible with Three.js r170.
export const FBX_VERSION = 7400;
const MAGIC = 'Kaydara FBX Binary  \0\x1a\0';
export function verifyFbxBinary(bytes) {
  if(!(bytes instanceof Uint8Array) || bytes.byteLength<64)
    throw new Error('Пустой либо повреждённый файл FBX');
  for(let i=0;i<MAGIC.length;i++)
    if(bytes[i]!==MAGIC.charCodeAt(i))throw new Error('Неверная сигнатура FBX');
  const version=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(23,true);
  if(version!==FBX_VERSION)
    throw new Error('Неожиданная версия FBX: '+version);
  return {bytes:bytes.byteLength, version};
}
export function countVertices(root) {
  let count=0;
  root?.traverse?.(obj=>{if(obj.isMesh && obj.geometry?.attributes?.position)
    count+=obj.geometry.attributes.position.count;});
  return count;
}
export async function exportFbxBinary(root, clips=[], {preset='blender'}={}) {
  if(!root?.isObject3D)throw new Error('Модель для экспорта FBX отсутствует');
  const {FBXExporter}=await import('@comfyorg/fbx-exporter-three');
  // The actual animation data is passed explicitly: GLTFLoader and our
  // editing timeline store clips separately from the scene object.
  const options={
    version:FBX_VERSION,
    preset,
    fps:30,
    embedTextures:true,
    animations:clips.filter(x=>x?.isAnimationClip),
    onlyVisible:false
  };
  root.updateWorldMatrix(true,true);
  const bytes=await new FBXExporter().parseAsync(root,options);
  verifyFbxBinary(bytes);
  return bytes;
}
