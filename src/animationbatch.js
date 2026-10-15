import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {retargetAnimationClip,clipNameForFile} from './animationimport.js';

const DIRECT=/\.(glb|gltf|fbx)$/i;
const BUNDLE=/\.zip$/i;
const MAX_FILES=200;
const MAX_ZIP_BYTES=80*1024*1024;
const MAX_EXPANDED_BYTES=240*1024*1024;
const MAX_ENTRY_BYTES=12*1024*1024;

// This is intentionally lazy: the ZIP is indexed once, and each GLB is
// decompressed and discarded before the next one is processed.
export async function collectAnimationSources(files,{
  zipLoader=()=>import('jszip')
}={}){
  const accepted=[...(files||[])].filter(f=>DIRECT.test(f.name)||BUNDLE.test(f.name));
  if(!accepted.length)throw Error('Выбери GLB/FBX или ZIP с анимациями');
  const sources=[],warnings=[];
  let totalExpanded=0;
  for(const file of accepted){
    if(DIRECT.test(file.name)){
      sources.push({name:file.name,fetchBlob:async()=>file});
      continue;
    }
    if(file.size>MAX_ZIP_BYTES){
      warnings.push(file.name+': архив больше 80 МБ, пропущен');
      continue;
    }
    const {default:JSZip}=await zipLoader();
    const zip=await JSZip.loadAsync(file,{checkCRC32:false});
    for(const entry of Object.values(zip.files)){
      if(entry.dir)continue;
      if(!/\.glb$/i.test(entry.name))continue;
      if(/(^|\/)\.\.(\/|$)/.test(entry.name))continue;
      const size=entry._data?.uncompressedSize??0;
      if(size>MAX_ENTRY_BYTES){
        warnings.push(entry.name+': файл больше 12 МБ, пропущен');
        continue;
      }
      totalExpanded+=size;
      if(totalExpanded>MAX_EXPANDED_BYTES)
        throw Error('Архивы слишком большие после распаковки (больше 240 МБ)');
      const name=entry.name.split('/').at(-1);
      sources.push({
        name,
        category:entry.name.includes('/')?entry.name.split('/')[0]:'',
        fetchBlob:async()=>entry.async('blob')
      });
      if(sources.length>MAX_FILES)
        throw Error('Загружай не больше 200 анимаций за один раз');
    }
  }
  return {sources,warnings};
}

// Source models are NEVER added to the user's scene. Source glTF/FBX rigs are
// temporary; only target-UUID quaternion tracks are retained.
export async function importAnimationBatch(files,{
  bones,bind,mode='auto',onProgress=()=>{},onClip=()=>{},
  yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0))
}={}){
  if(!bones?.length)throw Error('У персонажа должен быть скелет');
  const {sources,warnings}=await collectAnimationSources(files);
  if(!sources.length)throw Error('В выбранных файлах нет GLB/FBX-анимаций');
  const report={files:sources.length,loaded:0,failed:0,unmatched:0,partial:0,
    full:0,bestMatched:0,bestTotal:0,warnings:[...warnings]};
  for(let i=0;i<sources.length;i++){
    const source=sources[i];
    onProgress({index:i+1,total:sources.length,name:source.name,...report});
    await yieldUI();
    let url=null;
    try{
      const blob=await source.fetchBlob();
      if(blob.size>MAX_ENTRY_BYTES)
        throw Error('Анимация больше 12 МБ — пропущена для экономии памяти');
      url=URL.createObjectURL(blob);
      let scene,animations;
      if(/\.fbx$/i.test(source.name)){
        scene=await new FBXLoader().loadAsync(url);
        animations=scene.animations||[];
      }else{
        const loaded=await new GLTFLoader().loadAsync(url);
        scene=loaded.scene;animations=loaded.animations||[];
      }
      if(!animations.length)throw Error('В файле нет анимаций');
      for(let clipIndex=0;clipIndex<animations.length;clipIndex++){
        const clip=animations[clipIndex];
        const name=clipNameForFile(source.name,clip.name,animations.length>1?clipIndex:0);
        const outcome=retargetAnimationClip(clip,scene,bones,bind,{name,mode});
        if(!outcome.clip){
          report.unmatched++;
          report.warnings.push(source.name+': не совпали кости');
          continue;
        }
        onClip(outcome.clip,outcome,source.fetchBlob,source.name);
        report.loaded++;
        if(outcome.matched===outcome.total)report.full++;
        if(outcome.matched>report.bestMatched){
          report.bestMatched=outcome.matched;
          report.bestTotal=outcome.total;
        }
        if(outcome.warning){
          report.partial++;
          report.warnings.push(source.name+': совпало '+outcome.matched+'/'+outcome.total+' костей');
        }
      }
    }catch(error){
      report.failed++;
      report.warnings.push(source.name+': '+(error?.message||String(error)));
    }finally{
      if(url)URL.revokeObjectURL(url);
    }
  }
  onProgress({index:sources.length,total:sources.length,name:'Готово',...report});
  return report;
}
