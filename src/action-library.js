// A rigged character can own any number of separate action clips.
// Adding a new one must not overwrite original imported animations.
// Works with Three.js AnimationClip instances without depending on the UI.
export function appendActionClip(library,clip,{maxActions=200}={}){
 if(!Array.isArray(library)||!clip?.isAnimationClip)throw new Error('Некорректное действие');
 if(!clip.tracks?.length)throw new Error('Нет анимированных костей: запиши хотя бы один ключ');
 if(library.length>=maxActions)throw new Error('Максимум '+maxActions+' действий на персонажа');
 const existing=new Set(library.map(c=>String(c.name||'').trim().toLowerCase()));
 const raw=String(clip.name||'').trim().slice(0,70)||'Новое действие';
 let name=raw;
 for(let i=2;existing.has(name.toLowerCase());i++){
   const suffix=' ('+i+')';
   name=raw.slice(0,70-suffix.length)+suffix;
 }
 const added=clip.clone();
 added.name=name;
 library.push(added);
 return {clip:added,index:library.length-1};
}
