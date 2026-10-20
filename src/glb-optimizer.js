// Android GLB "Balance" preset: keep geometry, skeleton and animation keys verbatim.
// Textures are resized by Three.js GLTFExporter, not by changing live materials.
// No Draco, Meshopt, KTX2 or WebP requirement is introduced: Godot can import a
// standard self-contained glTF 2.0 binary file without special decoders.
export const ANDROID_BALANCED = Object.freeze({
  maxTextureSize: 1024,
  onlyVisible: false,
  binary: true,
  trs: true,
  includeCustomExtensions: false
});

function fail(message) {
  throw new Error('Проверка Android GLB: ' + message);
}

export function describeSource(root, animations = []) {
  if (!root?.traverse) fail('модель не загружена');
  const stats = { meshes: 0, skinnedMeshes: 0, maxBones: 0,
    animationNames: [], animationTrackCounts: [] };
  root.traverse(object => {
    if (!object.isMesh && !object.isSkinnedMesh) return;
    stats.meshes++;
    if (object.isSkinnedMesh) {
      stats.skinnedMeshes++;
      stats.maxBones = Math.max(stats.maxBones, object.skeleton?.bones?.length || 0);
    }
  });
  for (const clip of animations) {
    stats.animationNames.push(clip.name || '');
    stats.animationTrackCounts.push(clip.tracks?.length || 0);
  }
  return stats;
}

function viewBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail('ожидался двоичный файл');
}

export function parseGlb(buffer) {
  const bytes = viewBytes(buffer);
  if (bytes.byteLength < 20) fail('слишком короткий файл');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2)
    fail('неверный заголовок glTF 2.0');
  if (dv.getUint32(8, true) !== bytes.byteLength) fail('размер файла не совпадает с заголовком');
  let offset = 12, json = null, bin = null;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail('обрезан заголовок блока');
    const size = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    offset += 8;
    if (size % 4 || offset + size > bytes.byteLength) fail('повреждён блок GLB');
    const chunk = bytes.subarray(offset, offset + size);
    if (type === 0x4e4f534a) {
      if (json) fail('несколько JSON-блоков');
      try { json = JSON.parse(new TextDecoder().decode(chunk).trim()); }
      catch { fail('невозможно прочесть JSON glTF'); }
    } else if (type === 0x004e4942) {
      if (bin) fail('несколько BIN-блоков');
      bin = chunk;
    }
    offset += size;
  }
  if (!json || json.asset?.version !== '2.0') fail('нет корректного glTF 2.0 JSON');
  if (json.buffers?.length > 1) fail('внешние двоичные ресурсы не поддерживаются');
  if (json.buffers?.length && (!bin || json.buffers[0].byteLength > bin.byteLength))
    fail('двоичные данные неполные');
  return { json, bin, byteLength: bytes.byteLength };
}

function pngDimensions(data) {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 ||
      data[2] !== 0x4e || data[3] !== 0x47) fail('повреждён PNG');
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return [d.getUint32(16), d.getUint32(20)];
}

function jpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) fail('повреждён JPEG');
  let i = 2;
  while (i < data.length) {
    if (data[i++] !== 0xff) continue;
    while (data[i] === 0xff) i++;
    if (i >= data.length) break;
    const marker = data[i++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > data.length) break;
    const length = data[i] * 256 + data[i + 1];
    if (length < 2 || i + length > data.length) break;
    const isSof = (marker >= 0xc0 && marker <= 0xcf) &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && length >= 7)
      return [data[i + 5] * 256 + data[i + 6], data[i + 3] * 256 + data[i + 4]];
    i += length;
  }
  fail('не найден размер JPEG');
}

export function validateAndroidGlb(buffer, source, maxTextureSize = 1024) {
  const { json: doc, bin, byteLength } = parseGlb(buffer);
  const prohibited = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression',
    'KHR_texture_basisu', 'EXT_texture_webp'];
  const extensions = [...(doc.extensionsUsed || []), ...(doc.extensionsRequired || [])];
  if (extensions.some(ext => prohibited.includes(ext)))
    fail('требуются расширения сжатия, не входящие в базовый glTF 2.0');
  const meshes = doc.meshes || [];
  const nodes = doc.nodes || [];
  if (meshes.length < source.meshes)
    fail('потеряна геометрия: ' + meshes.length + ' из ' + source.meshes);
  if (source.skinnedMeshes) {
    const skinnedNodes = nodes.filter(n => n.skin !== undefined);
    const skins = doc.skins || [];
    if (skinnedNodes.length < source.skinnedMeshes)
      fail('потерян привязанный к скелету меш');
    if (Math.max(0, ...skins.map(s => s.joints?.length || 0)) < source.maxBones)
      fail('скелет потерял кости');
    for (const node of skinnedNodes) {
      const skin = skins[node.skin];
      const mesh = meshes[node.mesh];
      if (!skin?.joints?.length || !mesh?.primitives?.length)
        fail('неверная привязка меша к скелету');
      for (const prim of mesh.primitives) {
        if (prim.attributes?.JOINTS_0 === undefined ||
            prim.attributes?.WEIGHTS_0 === undefined)
          fail('потеряны индексы костей или веса вершин');
      }
    }
  }
  const animations = doc.animations || [];
  if (animations.length !== source.animationNames.length)
    fail('потеряны анимации: ' + animations.length + ' из ' + source.animationNames.length);
  animations.forEach((clip, index) => {
    if (clip.name !== source.animationNames[index])
      fail('изменилось имя анимации ' + (index + 1));
    if ((clip.channels?.length || 0) < source.animationTrackCounts[index])
      fail('у анимации ' + clip.name + ' потеряны ключевые дорожки');
  });
  const images = doc.images || [];
  for (const img of images) {
    if (!['image/png', 'image/jpeg'].includes(img.mimeType) ||
        img.bufferView === undefined || !bin)
      fail('изображение не встроено как стандартный PNG/JPEG');
    const slice = doc.bufferViews?.[img.bufferView];
    if (!slice || (slice.buffer ?? 0) !== 0 ||
        (slice.byteOffset || 0) + slice.byteLength > bin.byteLength)
      fail('повреждены данные текстуры');
    const data = bin.subarray(slice.byteOffset || 0,
      (slice.byteOffset || 0) + slice.byteLength);
    const [width, height] = img.mimeType === 'image/png'
      ? pngDimensions(data) : jpegDimensions(data);
    if (width < 1 || height < 1 || width > maxTextureSize || height > maxTextureSize)
      fail('текстура превышает ' + maxTextureSize + 'px: ' + width + '×' + height);
  }
  return {
    byteLength, meshes: meshes.length, skinnedMeshes: source.skinnedMeshes,
    animations: animations.length, textures: images.length,
    maxTextureSize, godotProfile: 'glTF 2.0, embedded PNG/JPEG, no required mesh compression'
  };
}
