// Russian display names only. Never rename the real bone objects:
// exported GLB/FBX and Mixamo animation tracks depend on their identifiers.
const BONE_LABELS={
  hips:'Таз',spine:'Позвоночник',spine1:'Позвоночник 2',
  spine2:'Грудная клетка',neck:'Шея',head:'Голова',
  headtopend:'Макушка',
  leftshoulder:'Левая ключица',rightshoulder:'Правая ключица',
  leftarm:'Левое плечо',rightarm:'Правое плечо',
  leftforearm:'Левый локоть (предплечье)',rightforearm:'Правый локоть (предплечье)',
  lefthand:'Левая кисть',righthand:'Правая кисть',
  leftupleg:'Левое бедро',rightupleg:'Правое бедро',
  leftleg:'Левое колено (голень)',rightleg:'Правое колено (голень)',
  leftfoot:'Левая стопа',rightfoot:'Правая стопа',
  lefttoebase:'Левый носок',righttoebase:'Правый носок',
  lefttoeend:'Конец левого носка',righttoeend:'Конец правого носка'
};
const SIDES={left:'Левой',right:'Правой'};
export function boneNameKey(value){
  const original=String(value||'').trim().split(/[|/\\]/).at(-1);
  const key=original.replace(/^mixamorig\d*[:_]?/i,'')
    .replace(/[^a-z0-9]/gi,'').toLowerCase();
  const aliases={leftlowerarm:'leftforearm',rightlowerarm:'rightforearm',
    leftthigh:'leftupleg',rightthigh:'rightupleg',
    leftcalf:'leftleg',rightcalf:'rightleg'};
  return aliases[key]||key;
}
export function boneLabel(value){
  const raw=String(value||'').trim();
  if(!raw)return 'Без названия';
  const key=boneNameKey(raw);
  if(BONE_LABELS[key])return BONE_LABELS[key];
  const tail=/^tail\d*_(\d{2})$/i.exec(raw);
  if(tail)return 'Хвост · кость '+Number(tail[1]);
  const ear=/^(left|right)ear(?:_?(\d+))?$/i.exec(key);
  if(ear)return (ear[1]==='left'?'Левое':'Правое')+' ухо'+(ear[2]?' · '+Number(ear[2]):'');
  const wing=/^(left|right)wing(?:_?(\d+))?$/i.exec(key);
  if(wing)return (wing[1]==='left'?'Левое':'Правое')+' крыло'+(wing[2]?' · '+Number(wing[2]):'');
  const finger=/^(left|right)hand(thumb|index|middle|ring|pinky)(\d+)$/i.exec(key);
  if(finger){
    const kind={thumb:'большой палец',index:'указательный палец',
      middle:'средний палец',ring:'безымянный палец',pinky:'мизинец'}[finger[2].toLowerCase()];
    return (finger[1].toLowerCase()==='left'?'Левая':'Правая')+
      ' кисть · '+kind+' '+Number(finger[3]);
  }
  return raw;
}
export function boneMatchesSearch(name,query){
  const q=String(query||'').trim().toLocaleLowerCase('ru-RU');
  return !q||boneLabel(name).toLocaleLowerCase('ru-RU').includes(q)||
    String(name||'').toLowerCase().includes(q);
}
