import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {retargetAnimationClip,clipNameForFile} from './animationimport.js';

// Never add source models to the scene; import only mapped quaternion tracks.
// Files are parsed sequentially to bound peak RAM on Android devices.
export async function importAnimationBatch(files,{
  bones,bind,onProgress=()=>{},onClip=()=>{},yieldUI=()=>new Promise(r=>setTimeout(r,0))
}={}){
  if(!bones?.length)throw Error('У персонажа должен быть скелет');
  const accepted=[...(files||[])].filter(f=>/\.(glb|gltf|fbx)$/i.test(f.name));
  if(!accepted.length)throw Error('Выбери FBX или GLB анимации');
  if(accepted.length>200)throw Error('Загружай максимум 200 файлов за один раз');
  const report={files:accepted.length,loaded:0,failed:0,unmatched:0,partial:0,warnings:[]};
  for(let i=0;i<accepted.length;i++){
    const file=accepted[i];
    onProgress({index:i+1,total:accepted.length,name:file.name,...report});
    await yieldUI();
    const url=URL.createObjectURL(file);
    try{
      let scene,animations;
      if(/\.fbx$/i.test(file.name)){
        scene=await new FBXLoader().loadAsync(url);
        animations=scene.animations||[];
      }else{
        const loaded=await new GLTFLoader().loadAsync(url);
        scene=loaded.scene;animations=loaded.animations||[];
      }
      if(!animations.length)throw Error('В файле нет анимаций');
      animations.forEach((clip,index)=>{
        const name=clipNameForFile(file.name,clip.name,animations.length>1?index:0);
        const outcome=retargetAnimationClip(clip,scene,bones,bind,{name});
        if(!outcome.clip){
          report.unmatched++;
          report.warnings.push(file.name+': не совпали кости');
          return;
        }
        onClip(outcome.clip,outcome);
        report.loaded++;
        if(outcome.warning){
          report.partial++;
          report.warnings.push(file.name+': совпало '+outcome.matched+'/'+outcome.total+' костей');
        }
      });
    }catch(error){
      report.failed++;
      report.warnings.push(file.name+': '+(error?.message||String(error)));
    }finally{
      URL.revokeObjectURL(url);
    }
  }
  onProgress({index:accepted.length,total:accepted.length,name:'Готово',...report});
  return report;
}
