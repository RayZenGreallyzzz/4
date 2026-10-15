import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { FPS, MAX_FRAMES, Timeline, boneLookup, compileClip, clampFrame } from './timeline.js';
import { JOINTS, createGuide, jointWorld, moveJointWorld, serializeFit, restoreFit, addGuideChain, removeGuideChain } from './autorig.js';
import { bindRigToMeshes } from './skinning.js';
import { findTailChains, calculateTailRegion, commitTailRegion, restoreTailRegion } from './tailweights.js';
import { exportFbxBinary, countVertices } from './fbx.js';
import { fitGuideToGeometry } from './bodyfit.js';
import './style.css';

const $ = id => document.getElementById(id);
const NativeFileSaver = registerPlugin('NativeFileSaver');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0c1524');
const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 1200);
camera.position.set(3, 2, 5);
const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
$('viewport').prepend(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = .075;
orbit.target.set(0,1,0);
orbit.minDistance = .01;
orbit.maxDistance = 400;
orbit.update();
// The rig fit manipulator is independent from the character's animation.
// No underlying mesh is skinned or modified during the fitting stage.
const rigTransform = new TransformControls(camera,renderer.domElement);
rigTransform.setMode('translate');
rigTransform.setSpace('world');
rigTransform.setSize(.7);
scene.add(rigTransform.getHelper());
rigTransform.getHelper().visible = false;
rigTransform.addEventListener('dragging-changed',event=>{orbit.enabled=!event.value;});
rigTransform.addEventListener('objectChange',()=>{
  syncRigMarkers();
  refreshRigFields();
});
scene.add(new THREE.HemisphereLight(0xc8e6ff,0x1b253b,2.35));
const sun = new THREE.DirectionalLight(0xffe7d0,3.1);
sun.position.set(3,7,5); scene.add(sun);
const rim = new THREE.DirectionalLight(0x7d96ff,2.4);
rim.position.set(-4,4,-3); scene.add(rim);
const grid = new THREE.GridHelper(20,20,0x54638f,0x283756);
grid.material.transparent = true;
grid.material.opacity = .3;
scene.add(grid);

const state = {
  root: null, modelName: null, bones: [], lookup: new Map(), bind: new Map(),
  sourceClips: [], sourceIndex: -1, mixer: null, action: null,
  timeline: new Timeline(), selected: null, skeleton: null,
  frame: 0, frames: 90, playing: false, loop: true, speed: 1,
  clipName: 'New Animation', clipboard: null, busy: false, loading: false,
  rafStamp: 0, frameCarry: 0, toastTimer: null,
  rigGuide:null, rigVisual:null, rigMarkers:[], rigSelected:'mixamorigHips',
  rigEnabled:true, rigEditMode:'touch', rigSnapMode:false, rigBound:false,
  tailMeshes:[], tailChains:[], tailUndo:new Map(), tailWag:null
};
const alertUser = msg => {
  const e = $('toast');
  e.textContent = msg;
  e.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(()=>e.classList.remove('visible'),3600);
};
const report = s => { $('status').textContent = '● ' + s; };
const onButton = (id, fn) => $(id).addEventListener('click',fn);

function disposeModel() {
  stopTailWag();
  state.tailUndo.clear();
  state.tailMeshes=[];
  state.tailChains=[];
  disposeRigGuide();
  state.playing = false;
  if (state.mixer) { state.mixer.stopAllAction(); state.mixer.uncacheRoot(state.root); }
  if (state.skeleton) {
    scene.remove(state.skeleton);
    state.skeleton.geometry.dispose();
    state.skeleton.material.dispose();
  }
  if (state.root) {
    scene.remove(state.root);
    state.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      }
    });
  }
  Object.assign(state, {
    root:null,modelName:null,bones:[],lookup:new Map(),bind:new Map(),
    sourceClips:[],sourceIndex:-1,mixer:null,action:null,
    selected:null,skeleton:null,frame:0,frames:90,clipName:'New Animation',rigBound:false
  });
  state.timeline.clear();
  state.clipboard = null;
}

// AutoRig stage 1: fit guide only, intentionally not an animated/weighted mesh.
function disposeRigGuide(keepRoot=false) {
  state.rigSnapMode=false;
  rigTransform.detach();
  rigTransform.getHelper().visible=false;
  if (state.rigVisual) {
    scene.remove(state.rigVisual);
    state.rigVisual.geometry.dispose();
    state.rigVisual.material.dispose();
    state.rigVisual=null;
  }
  for (const marker of state.rigMarkers) {
    scene.remove(marker);
    marker.geometry.dispose();
    marker.material.dispose();
  }
  state.rigMarkers=[];
  if (state.rigGuide) {
    if(!keepRoot)state.rigGuide.root.removeFromParent();
    state.rigGuide=null;
  }
  updateChainMenu();
}

function refreshRigFields() {
  const rig=state.rigGuide;
  const has=Boolean(rig);
  const selected=has ? jointWorld(rig,state.rigSelected) : null;
  $('autorig-selected').value=has ? state.rigSelected : '';
  $('autorig-scale').disabled=!has;
  $('autorig-direction').disabled=!has;
  $('autorig-geometry-fit').disabled=!has || state.busy;
  $('autorig-bind').disabled=!has || state.busy;
  $('autorig-recover').disabled=!state.root || !!state.bones.length || state.busy || !hasFitBackup();
  $('autorig-load-file').disabled=!state.root || !!state.bones.length || state.busy;
  $('autorig-snap').disabled=!has || state.busy;
  $('autorig-snap').textContent=state.rigSnapMode
    ? '× Отменить выбор точки'
    : '◎ Поставить сустав касанием тела';
  $('autorig-snap').classList.toggle('active',state.rigSnapMode);
  $('autorig-scale').value=has ? String(Math.round(rig.root.scale.x*100)) : '100';
  $('autorig-scale-value').textContent=has ? Math.round(rig.root.scale.x*100)+'%' : '100%';
  $('autorig-front').disabled=!has;
  $('autorig-side').disabled=!has;
  $('autorig-arrows').disabled=!has;
  for(const axis of ['x','y','z']) {
    const field=$('autorig-'+axis);
    field.disabled=!has;
    if (document.activeElement!==field) field.value=selected ? selected[axis].toFixed(4) : '0';
    if(has)field.step=String(Math.max(.0001,rig.height*.005).toPrecision(3));
  }
  $('autorig-selected').disabled=!has;
  $('autorig-reset').disabled=!has;
  $('autorig-remove').disabled=!has;
  $('autorig-save').disabled=!has;
  $('autorig-visible').disabled=!has;
  $('autorig-add').disabled=!state.root||!!state.bones.length||state.busy;
  $('autorig-add').textContent=has?'↺ Перестроить шаблон':'✦ Добавить скелет';
  $('chain-add').disabled=!has || state.busy;
  $('chain-count').disabled=!has || state.busy;
  $('chain-type').disabled=!has || state.busy;
  const hasChains=!!rig?.chains?.length;
  $('chain-remove').disabled=!hasChains || state.busy;
  const chosen=rig?.chains?.find(chain=>chain.names.includes(state.rigSelected));
  if(chosen)$('chain-list').value=chosen.id;
  else if(hasChains&&!rig.chains.some(chain=>chain.id===$('chain-list').value))$('chain-list').value=rig.chains[0].id;
  $('chain-list').disabled=!hasChains || state.busy;
  $('chain-count-label').textContent=$('chain-count').value+' костей';
  $('chain-status').textContent=has ? (hasChains
    ? 'Дополнительных цепочек: '+rig.chains.length+'. Все суставы включены в сохранение JSON.'
    : 'Добавь хвост, уши, крылья или волосы с отдельными костями.')
    : 'Сначала подгони основное тело, затем добавляй новые цепочки.';
  $('autorig-fit-state').textContent=!state.root?'Сначала загрузи модель GLB/FBX.'
    :state.bones.length?'У персонажа уже есть кости — шаблон не нужен.'
    :has?(rig.lastFit
      ? rig.bones.size+' костей · подгонка готова. Нажми «Привязать модель к скелету» перед экспортом GLB.'
      : rig.bones.size+' суставов по шаблону. Подгони их, затем привяжи модель.')
    :'Модель без скелета. После добавления AutoRig анализирует реальную геометрию корпуса.';
  $('autorig-fit-state').classList.toggle('autorig-ready',has);
  $('autorig-arrows').checked=state.rigEditMode==='arrows';
  $('autorig-drag-tip').textContent=state.rigEditMode==='touch'
    ? 'Режим пальца: коснись цветной точки и перетаскивай её по модели. Для глубины поверни вид сбоку.'
    : 'Режим стрелок: двигай оси выбранного сустава. Выбор сустава — в списке.';
}

function syncRigMarkers() {
  if(!state.rigGuide)return;
  state.rigGuide.root.updateWorldMatrix(true,true);
  for(const marker of state.rigMarkers){
    const name=marker.userData.jointName;
    const position=jointWorld(state.rigGuide,name);
    if(position)marker.position.copy(position);
    marker.material.color.setHex(name===state.rigSelected?0xff6ad8:name==='__root__'?0xffb854:0x16e7f5);
    marker.scale.setScalar(name===state.rigSelected?1.45:1);
    marker.visible=state.rigEnabled;
  }
  if(state.rigVisual)state.rigVisual.visible=state.rigEnabled;
  rigTransform.enabled=state.rigEnabled && state.rigEditMode==='arrows';
  rigTransform.getHelper().visible=rigTransform.enabled && Boolean(rigTransform.object);
}

function chooseRigJoint(name) {
  if(!state.rigGuide || (name!=='__root__'&&!state.rigGuide.bones.has(name)))return;
  state.rigSelected=name;
  $('autorig-selected').value=name;
  rigTransform.attach(name==='__root__'?state.rigGuide.root:state.rigGuide.bones.get(name));
  syncRigMarkers();
  refreshRigFields();
}

function makeRigMarker(name) {
  const rig=state.rigGuide;
  if(!rig)return;
  const radius=Math.max(.004,rig.height*.009);
  const marker=new THREE.Mesh(
    new THREE.SphereGeometry(name==='__root__'?radius*1.5:radius,12,9),
    new THREE.MeshBasicMaterial({color:0x16e7f5,depthTest:false,transparent:true,opacity:.94})
  );
  marker.name='GuideMarker_'+name;
  marker.userData.jointName=name;
  marker.renderOrder=999;
  scene.add(marker);
  state.rigMarkers.push(marker);
}
function refreshGuideSkeletonHelper() {
  if(!state.rigGuide)return;
  if(state.rigVisual){
    scene.remove(state.rigVisual);
    state.rigVisual.geometry.dispose();
    state.rigVisual.material.dispose();
  }
  const helper=new THREE.SkeletonHelper(state.rigGuide.root);
  helper.material.depthTest=false;
  helper.material.transparent=true;
  helper.material.opacity=.9;
  helper.renderOrder=970;
  helper.visible=state.rigEnabled;
  state.rigVisual=helper;
  scene.add(helper);
}
function updateChainMenu() {
  const select=$('chain-list');
  select.replaceChildren();
  const chains=state.rigGuide?.chains||[];
  for(const chain of chains) select.add(new Option(chain.id+' · '+chain.names.length+' костей',chain.id));
  if(!chains.length)select.add(new Option('Цепочек пока нет',''));
  select.disabled=!chains.length;
}
function createCustomChain() {
  if(!state.rigGuide)return alertUser('Сначала добавь основной скелет');
  try{
    const type=$('chain-type').value;
    const amount=Number($('chain-count').value);
    const chain=addGuideChain(state.rigGuide,type,amount);
    for(const name of chain.names) {
      makeRigMarker(name);
      $('autorig-selected').add(new Option(name,name));
    }
    refreshGuideSkeletonHelper();
    updateChainMenu();
    $('chain-list').value=chain.id;
    chooseRigJoint(chain.names[0]);
    refreshRigFields();
    saveFitDraft();
    alertUser('Цепочка '+chain.id+' создана. Перемещай суставы пальцем, каждый отдельно.');
  }catch(error){alertUser('Ошибка цепочки: '+(error?.message||String(error)));}
}
function deleteCustomChain() {
  if(!state.rigGuide)return;
  const id=$('chain-list').value;
  const found=state.rigGuide.chains?.find(c=>c.id===id);
  if(!found)return;
  if(!window.confirm('Удалить цепочку '+id+'? Основной скелет и модель сохранятся.'))return;
  if(found.names.includes(state.rigSelected))chooseRigJoint('mixamorigHips');
  if(!removeGuideChain(state.rigGuide,id))return;
  const names=new Set(found.names);
  for(const option of [...$('autorig-selected').options]){
    if(names.has(option.value))option.remove();
  }
  state.rigMarkers=state.rigMarkers.filter(marker=>{
    if(!names.has(marker.userData.jointName))return true;
    scene.remove(marker);
    marker.geometry.dispose();marker.material.dispose();
    return false;
  });
  refreshGuideSkeletonHelper();
  updateChainMenu();
  syncRigMarkers();
  refreshRigFields();
  saveFitDraft();
  alertUser('Цепочка '+id+' удалена.');
}

function addRigGuide(ask=false) {
  if(!state.root||state.bones.length)return alertUser('Шаблон доступен только для модели без костей');
  if(ask && state.rigGuide && !window.confirm('Заменить текущую подгонку скелета новым шаблоном?'))return;
  try{
    // Bounds use mesh geometry, including model offsets in GLB coordinates.
    state.root.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(state.root);
    const guide=createGuide(bounds);
    disposeRigGuide();
    // Retain only the canonical 22 body joints after rebuilding the template.
    for(const option of [...$('autorig-selected').options]){
      if(option.value && option.value!=='__root__' && !JOINTS.includes(option.value)) option.remove();
    }
    state.rigGuide=guide;
    scene.add(guide.root);
    refreshGuideSkeletonHelper();
    for(const name of ['__root__',...JOINTS])makeRigMarker(name);
    updateChainMenu();
    state.rigEnabled=true;
    state.rigEditMode='touch';
    try {
      const fit=fitGuideToGeometry(guide,state.root,$('autorig-direction').value);
      alertUser('Скелет размещён по '+fit.sampleCount+' вершинам модели. Проверь вид сбоку!');
    }catch(fitError){
      console.warn('Geometry fit fallback',fitError);
      alertUser('Геометрию не удалось проанализировать. Оставлен шаблон: '+fitError.message);
    }
    $('autorig-visible').checked=true;
    chooseRigJoint('mixamorigHips');
    refreshRigFields();
    // Fit status above reports whether geometry-aware placement succeeded.
    saveFitDraft();
  }catch(error){
    alertUser('Не удалось построить шаблон: '+(error?.message||String(error)));
  }
}

function applyGeometryFit(ask=true) {
  if(!state.rigGuide||!state.root)return;
  if(ask && !window.confirm('Автоматически заново подогнать основной скелет по геометрии? Ручные изменения положения тела будут заменены. Дополнительные цепочки сохранятся.')){
    $('autorig-direction').value=state.rigGuide.lastFit?.direction||'z+';
    return;
  }
  try{
    const info=fitGuideToGeometry(state.rigGuide,state.root,$('autorig-direction').value);
    $('autorig-scale').value='100';
    syncRigMarkers();
    refreshRigFields();
    saveFitDraft();
    alertUser('Центр корпуса исправлен ('+info.sampleCount+' вершин). Проверь его спереди и сбоку.');
  }catch(error){
    console.error('Geometry fitting failed',error);
    alertUser('Не удалось подогнать скелет: '+(error?.message||String(error)));
  }
}

function editRigCoordinate(axis,raw) {
  if(!state.rigGuide||state.busy)return;
  const value=Number(raw);
  if(!Number.isFinite(value))return;
  const point=jointWorld(state.rigGuide,state.rigSelected);
  if(!point)return;
  point[axis]=value;
  moveJointWorld(state.rigGuide,state.rigSelected,point);
  syncRigMarkers();
  refreshRigFields();
  saveFitDraft();
}

// Autosaved fitting data are local to this Android installation. Export JSON
// for a portable backup before changing or reinstalling the app.
function fitKey(){return 'animation-studio:fit:'+String(state.modelName||'').toLowerCase();}
function hasFitBackup(){
  try{return !!state.modelName && !!localStorage.getItem(fitKey());}
  catch{return false;}
}
function saveFitDraft(){
  if(!state.rigGuide || !state.modelName)return;
  try{localStorage.setItem(fitKey(),JSON.stringify(serializeFit(state.rigGuide,state.modelName)));}
  catch(error){console.warn('Fit autosave unavailable',error);}
}
function applyFitData(data) {
  if(!state.root || state.bones.length)throw Error('Загрузи исходную модель без скелета');
  const temp=createGuide(new THREE.Box3().setFromObject(state.root));
  const details=restoreFit(temp,data); // validate before discarding current fit
  disposeRigGuide();
  state.rigGuide=temp;
  scene.add(temp.root);
  refreshGuideSkeletonHelper();
  for(const name of ['__root__',...temp.bones.keys()])makeRigMarker(name);
  const select=$('autorig-selected');
  for(const option of [...select.options])
    if(option.value && option.value!=='__root__' && !JOINTS.includes(option.value))option.remove();
  for(const name of temp.bones.keys())if(!JOINTS.includes(name))select.add(new Option(name,name));
  updateChainMenu();
  state.rigEnabled=true;
  state.rigEditMode='touch';
  $('autorig-visible').checked=true;
  if(temp.lastFit?.direction)$('autorig-direction').value=temp.lastFit.direction;
  chooseRigJoint('mixamorigHips');
  refreshRigFields();
  saveFitDraft();
  return details;
}
async function openFitJSON(files){
  const file=files?.[0];
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.model && state.modelName && data.model!==state.modelName &&
      !window.confirm('Подгонка для '+data.model+'. Применить к '+state.modelName+'?'))return;
    const d=applyFitData(data);
    alertUser('Подгонка восстановлена: '+d.joints+' костей и '+d.chains+' цепочек.');
  }catch(e){console.error('Restore fit',e);alertUser('Ошибка JSON: '+(e?.message||String(e)));}
}

async function bindFittedRig(){
  if(!state.rigGuide || !state.root || state.busy)return;
  if(!window.confirm('Создать привязку вершин к выставленным костям? Первые веса автоматические, броня/хвост требуют проверки. Продолжить?'))return;
  saveFitDraft();
  state.busy=true;
  state.playing=false;
  $('autorig-bind-info').textContent='Рассчитываем веса, подожди…';
  refreshControls();
  report('AUTOSKIN');
  try{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const output=await bindRigToMeshes(state.root,state.rigGuide,{
      onProgress:p=>$('autorig-bind-info').textContent=
        'Рассчитано '+p.percentage+'% ('+p.processed+' / '+p.total+' вершин)'
    });
    const bones=output.bones;
    disposeRigGuide(true); // preserve armature now nested under the GLB model
    state.rigBound=true;
    state.bones=bones;
    state.lookup=boneLookup(bones);
    state.bind=new Map(bones.map(b=>[b.uuid,b.quaternion.clone()]));
    state.selected=bones.find(b=>/rightarm/i.test(b.name))||bones[0];
    state.timeline.clear();
    if(state.mixer)state.mixer.stopAllAction();
    state.mixer=new THREE.AnimationMixer(state.root);
    state.action=null;
    state.skeleton=new THREE.SkeletonHelper(state.root);
    state.skeleton.visible=$('show-bones').checked;
    scene.add(state.skeleton);
    $('show-bones').disabled=false;
    $('rig-status').textContent='✓ Реальный скелет: '+bones.length+' костей, '+output.meshes+
      ' мешей с весами. Проверь сгибы, затем экспортируй GLB.';
    $('rig-status').classList.remove('no-rig');
    $('autorig-bind-info').textContent='Готово! '+output.vertices+' вершин. Проверь плечи, колени и хвост.';
    $('save-info').textContent='Скелет привязан к телу. Можно сохранить GLB даже без ключей или создать анимацию.';
    drawBoneList();
    showFrame(0);
    buildClipMenu();
    syncTailEditor();
    alertUser('Модель привязана к костям! Проверь вращение суставов.');
  }catch(e){
    console.error('AutoSkin',e);
    $('autorig-bind-info').textContent='Ошибка привязки: '+(e?.message||String(e))+
      '. Подгонка сохранена в черновике.';
    alertUser('Ошибка привязки: '+(e?.message||String(e)));
  }finally{
    state.busy=false;
    report('ГОТОВО');
    refreshControls();
  }
}
async function saveRigGuide() {
  if(!state.rigGuide||state.busy)return;
  state.busy=true;
  refreshControls();
  try{
    const data=JSON.stringify(serializeFit(state.rigGuide,state.modelName),null,2);
    const filename=(state.modelName||'character').replace(/\.[^.]+$/,'')
      .replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,50)+'_rigfit.json';
    const result=await saveFile(data,filename,'application/json');
    alertUser(result.saved?'Позиции скелета сохранены в JSON':result.cancelled?'Сохранение отменено':'JSON передан браузеру');
  }catch(error){
    alertUser('Ошибка сохранения шаблона: '+(error?.message||String(error)));
  }finally{
    state.busy=false;
    refreshControls();
  }
}

// Tablet-first positioning: invisible camera-facing plane at joint depth.
// Intercepts the touch before OrbitControls starts orbiting the camera.
const rigRaycaster=new THREE.Raycaster();
const rigPointer=new THREE.Vector2();
const rigDragPlane=new THREE.Plane();
let rigDrag=null;
const dom=renderer.domElement;
function pointerRay(x,y) {
  const rect=dom.getBoundingClientRect();
  rigPointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);
  rigRaycaster.setFromCamera(rigPointer,camera);
  return rigRaycaster.ray;
}
function closestGuidePoint(x,y,touch) {
  if(!state.rigGuide || !state.rigEnabled) return null;
  const rect=dom.getBoundingClientRect();
  const maxDistance=touch?46:30;
  let closest=null, distance=maxDistance;
  for(const marker of state.rigMarkers) {
    if(!marker.visible)continue;
    const screen=marker.position.clone().project(camera);
    if(screen.z < -1 || screen.z > 1)continue;
    const px=rect.left+(screen.x+1)*rect.width/2;
    const py=rect.top+(1-screen.y)*rect.height/2;
    const d=Math.hypot(x-px,y-py);
    if(d<distance) {distance=d;closest=marker.userData.jointName;}
  }
  return closest;
}
function dragRelease(event) {
  if (!rigDrag || event.pointerId!==rigDrag.id) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  rigDrag=null;
  saveFitDraft();
  try{if(dom.hasPointerCapture(event.pointerId))dom.releasePointerCapture(event.pointerId);}catch{}
  orbit.enabled=true;
  refreshRigFields();
}
// Capture-phase handler runs before OrbitControls and TransformControls.
dom.addEventListener('pointerdown',event=>{
  if(state.rigSnapMode && state.rigGuide && state.root && !state.busy){
    event.preventDefault();
    event.stopImmediatePropagation();
    if(event.button!==0)return;
    pointerRay(event.clientX,event.clientY);
    const meshes=[];
    state.root.traverse(obj=>{if(obj.isMesh && obj.visible)meshes.push(obj);});
    const hits=rigRaycaster.intersectObjects(meshes,false);
    if(!hits.length){
      alertUser('На этом месте модели нет. Нажми прямо на нужную часть тела.');
      return;
    }
    const h=state.rigGuide.height;
    const part=state.rigSelected;
    const inside=/Arm|Hand|Leg|Foot|Toe|Shoulder|Ear|Tail|Wing/i.test(part)
      ? .025*h : .048*h;
    const target=hits[0].point.clone().addScaledVector(rigRaycaster.ray.direction,inside);
    if(moveJointWorld(state.rigGuide,part,target)){
      state.rigSnapMode=false;
      syncRigMarkers();
      refreshRigFields();
      alertUser('Сустав установлен по поверхности тела. При необходимости уточни X/Y/Z.');
    }
    return;
  }
  if(rigDrag){
    event.stopImmediatePropagation();
    event.preventDefault();
    return;
  }
  if(!state.rigGuide || !state.rigEnabled || state.rigEditMode!=='touch' ||
    event.button!==0 || state.busy)return;
  const name=closestGuidePoint(event.clientX,event.clientY,event.pointerType==='touch');
  if(!name)return; // empty viewport still rotates/zooms normally
  chooseRigJoint(name);
  const point=jointWorld(state.rigGuide,name);
  const normal=new THREE.Vector3();
  camera.getWorldDirection(normal);
  rigDragPlane.setFromNormalAndCoplanarPoint(normal,point);
  const intersection=pointerRay(event.clientX,event.clientY).intersectPlane(rigDragPlane,new THREE.Vector3());
  if(!intersection)return;
  rigDrag={id:event.pointerId,name,offset:point.clone().sub(intersection)};
  event.preventDefault();
  event.stopImmediatePropagation();
  orbit.enabled=false;
  dom.setPointerCapture(event.pointerId);
},true);
dom.addEventListener('pointermove',event=>{
  if(!rigDrag || event.pointerId!==rigDrag.id)return;
  event.preventDefault();event.stopImmediatePropagation();
  const intersection=pointerRay(event.clientX,event.clientY).intersectPlane(rigDragPlane,new THREE.Vector3());
  if(!intersection)return;
  moveJointWorld(state.rigGuide,rigDrag.name,intersection.add(rigDrag.offset));
  syncRigMarkers();
  // Avoid rebuilding full panel on every high-frequency pointer event.
  for(const axis of ['x','y','z']) {
    const value=jointWorld(state.rigGuide,rigDrag.name)[axis];
    if(document.activeElement!==$('autorig-'+axis))$('autorig-'+axis).value=value.toFixed(4);
  }
},true);
dom.addEventListener('pointerup',dragRelease,true);
dom.addEventListener('pointercancel',dragRelease,true);

function resourceManager(files) {
  const urls = [], byName = new Map();
  for(const f of files) {
    const url = URL.createObjectURL(f);
    urls.push(url);
    byName.set(f.name.toLowerCase(),url);
    byName.set(f.name.replace(/\\/g,'/').split('/').pop().toLowerCase(),url);
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(value => {
    const cleaned = decodeURIComponent(value.split('?')[0].split('#')[0]).replace(/\\/g,'/');
    return byName.get(cleaned.toLowerCase()) ||
      byName.get(cleaned.split('/').pop().toLowerCase()) || value;
  });
  return { manager, urls, byName };
}

async function importCharacter(files) {
  if (!files?.length || state.loading || state.busy) return;
  const main = files.find(f => /\.(glb|gltf|fbx)$/i.test(f.name));
  if (!main) return alertUser('Выбери GLB, GLTF или FBX');
  state.loading = true;
  $('loading-overlay').classList.remove('hidden');
  $('loading-name').textContent = main.name;
  report('ЗАГРУЗКА');
  await new Promise(r => requestAnimationFrame(()=>requestAnimationFrame(r)));
  const refs = resourceManager(files);
  try {
    const url = refs.byName.get(main.name.toLowerCase());
    let model, clips;
    if (/\.fbx$/i.test(main.name)) {
      model = await new FBXLoader(refs.manager).loadAsync(url);
      clips = model.animations || [];
    } else {
      const result = await new GLTFLoader(refs.manager).loadAsync(url);
      model = result.scene;
      clips = result.animations || [];
    }
    const root = new THREE.Group();
    root.name = main.name;
    root.add(model);
    const bones = [];
    root.traverse(o => {
      if (o.isBone) bones.push(o);
      if (o.isMesh) o.frustumCulled = false;
    });
    // Non-rigged geometry is valid: preview and save it without joint editing.
    const hasRig = bones.length > 0;
    disposeModel();
    state.root = root;
    state.modelName = main.name;
    state.bones = bones;
    state.lookup = boneLookup(bones);
    state.bind = new Map(bones.map(b=>[b.uuid,b.quaternion.clone()]));
    state.sourceClips = clips;
    state.sourceIndex = clips.length ? 0 : -1;
    state.frames = clips.length ? Math.min(MAX_FRAMES,Math.max(1,Math.round(clips[0].duration*FPS))) : 90;
    state.clipName = clips[0]?.name || 'New Animation';
    state.selected = bones.find(b=>/right(arm|forearm|hand)/i.test(b.name)) || bones[0];
    state.mixer = clips.length ? new THREE.AnimationMixer(root) : null;
    scene.add(root);
    if (hasRig) {
      state.skeleton = new THREE.SkeletonHelper(root);
      state.skeleton.visible = $('show-bones').checked;
      scene.add(state.skeleton);
    }
    $('show-bones').disabled = !hasRig;
    $('rig-status').textContent = hasRig
      ? '✓ Скелет найден: ' + bones.length + ' костей. Можно создавать ключи.'
      : '◇ Режим просмотра: скелета нет. Для анимации суставов нужен риг.';
    $('rig-status').classList.toggle('no-rig', !hasRig);
    refreshRigFields();
    $('file-label').textContent = main.name;
    $('clip-name').value = state.clipName;
    $('duration').value = String(state.frames);
    $('empty-view').classList.add('hidden');
    closeMenu();
    buildClipMenu();
    drawBoneList();
    frameCamera();
    showFrame(0);
    refreshControls();
    syncTailEditor();
    alertUser(hasRig ? 'Персонаж загружен: ' + main.name
      : 'Модель загружена без скелета. Доступны просмотр и сохранение GLB.');
  } catch (e) {
    console.error('Model import',e);
    alertUser('Ошибка загрузки: ' + (e?.message || String(e)));
  } finally {
    state.loading = false;
    report('ГОТОВО');
    $('loading-overlay').classList.add('hidden');
    setTimeout(()=>refs.urls.forEach(u=>URL.revokeObjectURL(u)),45000);
  }
}

function frameCamera() {
  if (!state.root) return;
  state.root.updateWorldMatrix(true,true);
  const bounds = new THREE.Box3().setFromObject(state.root);
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length()*.5,.1);
  const distance = radius/Math.sin(THREE.MathUtils.degToRad(camera.fov*.5))*1.25;
  camera.position.copy(center).add(new THREE.Vector3(distance*.6,distance*.3,distance*.87));
  camera.near = Math.max(.001,distance/400);
  camera.far = Math.max(1000,distance*100);
  camera.updateProjectionMatrix();
  orbit.minDistance=Math.max(.001,distance/100);
  orbit.maxDistance=Math.max(25,distance*80);
  orbit.target.copy(center);
  orbit.update();
}

function basePose(frame) {
  for (const bone of state.bones) bone.quaternion.copy(state.bind.get(bone.uuid));
  if (state.sourceIndex < 0 || !state.mixer) return;
  const clip = state.sourceClips[state.sourceIndex];
  if (!state.action || state.action.getClip() !== clip) {
    state.mixer.stopAllAction();
    state.action = state.mixer.clipAction(clip);
    state.action.reset().play();
    state.action.setLoop(THREE.LoopRepeat,Infinity);
  }
  state.mixer.setTime(Math.min(frame/FPS,clip.duration));
}

function preview(frame) {
  if (!state.root) return;
  basePose(frame);
  for (const {bone} of state.timeline.keys.values()) {
    const q = state.timeline.pose(bone,frame,bone.quaternion,state.sourceIndex>=0);
    bone.quaternion.copy(q);
  }
  state.root.updateMatrixWorld(true);
}

function showFrame(value, repaint=true) {
  state.frame = clampFrame(value,state.frames);
  $('seek').max = String(state.frames);
  $('seek').value = String(state.frame);
  $('current-frame').textContent = String(state.frame);
  $('current-time').textContent = (state.frame/FPS).toFixed(2);
  preview(state.frame);
  if (repaint) { refreshAngles(); drawKeys(); refreshControls(); }
}

function buildClipMenu() {
  const menu = $('clip-select');
  menu.replaceChildren();
  for(let i=0;i<state.sourceClips.length;i++) {
    const clip = state.sourceClips[i];
    menu.add(new Option((clip.name || 'Анимация '+(i+1))+' · '+clip.duration.toFixed(2)+' с',String(i)));
  }
  menu.add(new Option('✦ Создать новую анимацию','new'));
  menu.value = state.sourceIndex<0 ? 'new' : String(state.sourceIndex);
}

function switchClip(value) {
  const next = value === 'new' ? -1 : Number(value);
  if (next>=0 && !state.sourceClips[next]) return;
  if (state.timeline.count && !window.confirm('Текущие несохранённые ключи будут сброшены. Продолжить?')) {
    buildClipMenu(); return;
  }
  state.playing = false;
  state.timeline.clear();
  state.sourceIndex = next;
  state.action = null;
  state.clipName = next<0 ? 'New Animation' : state.sourceClips[next].name || 'Edited Animation';
  state.frames = next<0 ? 90 : Math.min(MAX_FRAMES,Math.max(1,Math.round(state.sourceClips[next].duration*FPS)));
  $('clip-name').value = state.clipName;
  $('duration').value = String(state.frames);
  showFrame(0);
  drawBoneList();
}

function drawBoneList() {
  const list = $('bone-list');
  list.replaceChildren();
  const query = $('bone-search').value.trim().toLowerCase();
  const filtered = state.bones.filter(b=>b.name.toLowerCase().includes(query));
  $('bones-count').textContent = filtered.length+' / '+state.bones.length;
  for (const bone of filtered.slice(0,250)) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bone-item'+(bone===state.selected?' selected':'');
    const marker = document.createElement('span');
    marker.textContent = state.timeline.forBone(bone).size ? '◆' : '◇';
    marker.className = 'bone-mark';
    const name = document.createElement('span');
    name.textContent = bone.name || '(bone)';
    el.append(marker,name);
    el.addEventListener('click',()=>{
      state.selected = bone;
      state.playing = false;
      drawBoneList();refreshAngles();drawKeys();refreshControls();
    });
    list.append(el);
  }
  if (filtered.length>250) {
    const msg=document.createElement('p');msg.className='hint';msg.textContent='Показаны первые 250 костей. Введи название в поиск.';
    list.append(msg);
  }
  if (!filtered.length) {
    const msg = document.createElement('p');
    msg.className = 'hint';
    msg.textContent = !state.root ? 'Загрузи модель' : !state.bones.length
      ? 'Модель без скелета: для суставных анимаций нужен риг.' : 'Совпадений нет';
    list.append(msg);
  }
}

function refreshAngles() {
  const bone = state.selected;
  $('bone-title').textContent = bone?.name || 'Выбери кость';
  const angle = bone ? new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ') : new THREE.Euler();
  for(const axis of ['x','y','z']) {
    const number = Math.round(THREE.MathUtils.radToDeg(angle[axis])*10)/10;
    $('rotate-'+axis).disabled = !bone;
    $('angle-'+axis).disabled = !bone;
    $('rotate-'+axis).value = String(THREE.MathUtils.clamp(number,-180,180));
    if (document.activeElement!==$('angle-'+axis)) $('angle-'+axis).value = String(number);
  }
}

function drawKeys() {
  const holder = $('markers');
  holder.replaceChildren();
  const selectedFrames = state.selected ? state.timeline.framesFor(state.selected) : [];
  for(const frame of state.timeline.allFrames()) {
    if (frame>state.frames) continue;
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'key-marker'+(selectedFrames.includes(frame)?' bright':'');
    mark.style.left = (100 * frame / Math.max(1,state.frames)) + '%';
    mark.title = 'Ключ: кадр '+frame;
    mark.setAttribute('aria-label','Перейти к кадру '+frame);
    mark.addEventListener('click',()=>{state.playing=false;showFrame(frame);});
    holder.append(mark);
  }
  $('total-frame').textContent = String(state.frames);
  $('total-time').textContent = (state.frames/FPS).toFixed(2);
  $('keys-summary').textContent = state.timeline.count+' ключей';
  $('selected-keys').textContent = selectedFrames.length+' ключей у кости';
}

function refreshControls() {
  const ready = !!state.root && !state.busy;
  const rigged = ready && state.bones.length > 0;
  const hasAnimation = ready && (state.sourceIndex >= 0 || state.timeline.count > 0);
  for(const id of ['save-glb','save-fbx','stop','to-start','to-end','step-minus','step-plus',
    'clip-name','duration','seek']) $(id).disabled = !ready;
  for(const id of ['key-bone','key-pose','copy-pose','clear-keys'])
    $(id).disabled = !rigged;
  $('play').disabled = !hasAnimation;
  $('delete-key').disabled = !rigged || !state.selected || !state.timeline.has(state.selected,state.frame);
  $('paste-pose').disabled = !rigged || !state.clipboard;
  $('play').textContent = state.playing ? 'Ⅱ Пауза' : '▶ Играть';
  refreshRigFields();
  refreshTailEditor();
}

function editAngle(axis, value) {
  stopTailWag();
  const bone = state.selected;
  const number = Number(value);
  if (!bone || state.busy || !Number.isFinite(number)) return;
  state.playing = false;
  const e = new THREE.Euler().setFromQuaternion(bone.quaternion,'XYZ');
  e[axis] = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(number,-180,180));
  bone.quaternion.setFromEuler(e);
  state.timeline.set(bone,state.frame,bone.quaternion,state.frames);
  preview(state.frame);
  drawKeys();drawBoneList();refreshAngles();refreshControls();
}

function keyBone() {
  if (!state.selected) return alertUser('Выбери кость');
  state.playing = false;
  state.timeline.set(state.selected,state.frame,state.selected.quaternion,state.frames);
  drawKeys();drawBoneList();refreshControls();
  alertUser('Ключ записан в кадр '+state.frame);
}

function keyPose() {
  if (!state.bones.length) return alertUser('Загрузи персонажа');
  state.playing = false;
  for(const bone of state.bones) state.timeline.set(bone,state.frame,bone.quaternion,state.frames);
  drawKeys();drawBoneList();refreshControls();
  alertUser('Полная поза записана: кадр '+state.frame);
}

function deleteKey() {
  if (!state.selected) return;
  state.playing = false;
  state.timeline.delete(state.selected,state.frame);
  showFrame(state.frame);drawBoneList();
}

function copyPose() {
  if (!state.root) return;
  state.clipboard = new Map(state.bones.map(b=>[b.name,b.quaternion.clone()]));
  refreshControls();alertUser('Поза скопирована');
}

function pastePose() {
  if (!state.clipboard) return;
  state.playing = false;
  let count=0;
  for(const bone of state.bones) {
    const q = state.clipboard.get(bone.name);
    if (!q) continue;
    state.timeline.set(bone,state.frame,q,state.frames);count++;
  }
  showFrame(state.frame);drawBoneList();
  alertUser('Позу вставлено: '+count+' костей');
}

function exportClip() {
  const original = state.sourceIndex>=0 ? state.sourceClips[state.sourceIndex] : null;
  const before = state.frame;
  const clip = compileClip({
    name:state.clipName,durationFrames:state.frames,sourceClip:original,
    timeline:state.timeline,lookup:state.lookup,
    sample:(frame,bones)=>{
      basePose(frame);
      const out=new Map();
      for(const bone of bones){
        out.set(bone.uuid,state.timeline.pose(bone,frame,bone.quaternion,!!original));
      }
      return out;
    }
  });
  preview(before);
  return clip;
}

function assertGlb(buffer) {
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<28)throw new Error('Экспорт GLB пуст');
  const view=new DataView(buffer);
  if(view.getUint32(0,true)!==0x46546c67 ||
    view.getUint32(4,true)!==2 ||
    view.getUint32(8,true)!==buffer.byteLength)throw new Error('Повреждённый GLB');
}

function browserDownload(bytes,name,mime) {
  const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
  const a=document.createElement('a');a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function saveFile(buffer,name,mime,progress=()=>{}) {
  const data=buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
    : buffer instanceof Uint8Array ? buffer
    : new TextEncoder().encode(String(buffer));
  if(Capacitor.getPlatform()==='android'&&Capacitor.isNativePlatform()){
    await NativeFileSaver.beginFile({filename:name,mimeType:mime});
    try{
      const chunkSize=96*1024;
      for(let at=0;at<data.byteLength;at+=chunkSize){
        const bytes=data.subarray(at,Math.min(at+chunkSize,data.byteLength));
        let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
        await NativeFileSaver.appendChunk({data:btoa(binary)});
        if(at%(chunkSize*8)===0){
          progress(Math.round((at+bytes.length)*100/data.byteLength));
          await new Promise(r=>setTimeout(r,0));
        }
      }
      progress(100);
      const result=await NativeFileSaver.finishFile();
      return {saved:!!result.saved,cancelled:!!result.cancelled};
    } catch(e) {
      await NativeFileSaver.cancelFile().catch(()=>{});
      throw e;
    }
  }
  if(typeof window.showSaveFilePicker==='function'){
    try{
      const isJson=name.toLowerCase().endsWith('.json');
      const isFbx=name.toLowerCase().endsWith('.fbx');
      const h=await window.showSaveFilePicker({
        suggestedName:name,types:[isJson
          ? {description:'JSON',accept:{'application/json':['.json']}}
          : isFbx
            ? {description:'Autodesk FBX',accept:{'application/octet-stream':['.fbx']}}
            : {description:'3D GLB',accept:{'model/gltf-binary':['.glb']}}]
      });
      const out=await h.createWritable();
      await out.write(data);await out.close();
      return {saved:true};
    }catch(e){
      if(e?.name==='AbortError')return {saved:false,cancelled:true};
      if(e?.name!=='SecurityError'&&e?.name!=='NotAllowedError')throw e;
    }
  }
  browserDownload(data,name,mime);
  return {saved:false,browserDownload:true};
}

async function exportGLB() {
  if (!state.root || state.busy) return;
  stopTailWag();
  if (state.rigGuide && !state.rigBound){
    alertUser('Кости ещё НЕ привязаны. Нажми «Привязать модель к скелету»!');
    return;
  }
  if (state.bones.length && !state.rigBound && state.sourceIndex < 0 && !state.timeline.count)
    return alertUser('Запиши хотя бы один ключ для новой анимации');
  state.busy=true;
  const wasPlaying=state.playing;
  state.playing=false;
  refreshControls();
  report('ЭКСПОРТ');
  $('save-info').textContent='Готовим анимации…';
  const exportScene=new THREE.Scene();
  let moved=false;
  try{
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const sourceClips = state.sourceClips.slice();
    if (state.bones.length && (state.timeline.count || state.sourceIndex>=0)) {
      const edited = exportClip();
      if (state.sourceIndex < 0) sourceClips.push(edited);
      else sourceClips[state.sourceIndex] = edited;
    }
    const clips = sourceClips.filter(c => c.tracks.length);
    // The fitted guide lives outside the model root, so geometry-only
    // exports never pretend to contain a skinned Mixamo character.
    // Geometry-only models have no joint keys, but are valid GLB exports.
    exportScene.add(state.root);moved=true;
    const glb=await new GLTFExporter().parseAsync(exportScene,{
      binary:true,trs:true,onlyVisible:true,animations:clips
    });
    assertGlb(glb);
    scene.add(state.root);moved=false;
    const name=(state.modelName||'character').replace(/\.[^.]+$/,'')
      .replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,55)+
      (state.rigBound?'_rigged.glb':'_animation.glb');
    $('save-info').textContent='GLB готов ('+(glb.byteLength/1048576).toFixed(1)+' МБ). Выбери папку.';
    const result=await saveFile(glb,name,'model/gltf-binary',p=>{
      $('save-info').textContent=p===100?'Открываем выбор папки…':'Передаём GLB: '+p+'%';
    });
    if(result.saved) {
      $('save-info').textContent=state.rigBound
        ? 'Скелет и привязанные меши сохранены. Проверь GLB повторной загрузкой.'
        : state.bones.length
          ? 'Сохранено. Проверь анимацию повторной загрузкой.'
          : 'Сохранён обычный GLB без скелета.';
      alertUser('GLB сохранён!');
    } else if(result.cancelled) {
      $('save-info').textContent='Сохранение отменено — анимация осталась в редакторе.';
      alertUser('Сохранение отменено');
    } else {
      $('save-info').textContent='Файл передан браузеру для скачивания.';
      alertUser('GLB отправлен в загрузки');
    }
  }catch(e){
    console.error('Export GLB',e);
    $('save-info').textContent='Ошибка: '+(e?.message||String(e));
    alertUser('Ошибка экспорта: '+(e?.message||String(e)));
  }finally{
    if(moved)scene.add(state.root);
    if(state.root)preview(state.frame);
    state.busy=false;state.playing=wasPlaying;
    report('ГОТОВО');refreshControls();
  }
}


async function exportFBX() {
  if(!state.root || state.busy)return;
  stopTailWag();
  if(state.rigGuide && !state.rigBound){
    alertUser('Сначала привяжи модель к скелету в AutoSkin — иначе кости не будут управлять телом.');
    return;
  }
  const vertices=countVertices(state.root);
  if(vertices>350000 && !window.confirm(
    'Модель содержит '+vertices.toLocaleString('ru-RU')+
    ' вершин. Экспорт FBX с текстурами может потребовать много оперативной памяти. '+
    'Рекомендуется сохранить GLB перед операцией. Продолжить?'))return;
  state.busy=true;
  const wasPlaying=state.playing;
  state.playing=false;
  refreshControls();
  report('FBX ЭКСПОРТ');
  $('save-info').textContent='Подготавливаем FBX 7.4 (2014/2015). Это может занять время…';
  try{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const clips=state.sourceClips.slice();
    if(state.bones.length && (state.timeline.count||state.sourceIndex>=0)){
      const edited=exportClip();
      if(state.sourceIndex<0)clips.push(edited);
      else clips[state.sourceIndex]=edited;
    }
    const bytes=await exportFbxBinary(state.root,clips.filter(c=>c?.tracks?.length));
    const name=(state.modelName||'character').replace(/\.[^.]+$/,'')
      .replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,55)+
      (state.bones.length?'_rigged.fbx':'_model.fbx');
    $('save-info').textContent='FBX 7.4 создан ('+(bytes.byteLength/1048576).toFixed(1)+
      ' МБ). Выбери место сохранения.';
    const result=await saveFile(bytes,name,'application/octet-stream',percent=>{
      $('save-info').textContent=percent===100?'Открываем выбор папки для FBX…':
        'Записываем FBX: '+percent+'%';
    });
    if(result.saved){
      $('save-info').textContent='FBX 7.4 сохранён. Проверь импорт в Blender. FBX 2013 для старого Mixamo пока не поддерживается.';
      alertUser('Настоящий FBX сохранён!');
    }else if(result.cancelled){
      $('save-info').textContent='Сохранение FBX отменено; модель осталась в редакторе.';
      alertUser('Сохранение FBX отменено');
    }else{
      $('save-info').textContent='FBX передан браузеру для скачивания.';
      alertUser('FBX отправлен в загрузки');
    }
  }catch(error){
    console.error('FBX export',error);
    $('save-info').textContent='Ошибка экспорта FBX: '+(error?.message||String(error));
    alertUser('FBX не сохранён: '+(error?.message||String(error)));
  }finally{
    if(state.root)preview(state.frame);
    state.busy=false;
    state.playing=wasPlaying;
    report('ГОТОВО');
    refreshControls();
  }
}

// Optional tail-only skinning adjustment. Original skinIndex/skinWeight
// BufferAttributes are kept verbatim for one-click undo. Never auto-applied.
function syncTailEditor(){
  const oldMesh=$('tail-mesh-select').value;
  const oldChain=$('tail-chain-select').value;
  const meshes=[];
  state.root?.traverse?.(obj=>{if(obj.isSkinnedMesh)meshes.push(obj);});
  state.tailMeshes=meshes;
  state.tailChains=findTailChains(state.bones);
  const meshSelect=$('tail-mesh-select'),chainSelect=$('tail-chain-select');
  meshSelect.replaceChildren();
  chainSelect.replaceChildren();
  meshes.forEach((m,i)=>meshSelect.add(new Option(
    (m.name||'Меш '+(i+1))+' · '+m.geometry.attributes.position.count.toLocaleString('ru-RU')+' вершин',m.uuid)));
  state.tailChains.forEach(chain=>chainSelect.add(new Option(
    chain.id+' · '+chain.bones.length+' костей',chain.id)));
  const named=meshes.find(m=>/tail|хвост/i.test(m.name||''));
  meshSelect.value=meshes.some(m=>m.uuid===oldMesh)?oldMesh:(named?.uuid||meshes[0]?.uuid||'');
  chainSelect.value=state.tailChains.some(c=>c.id===oldChain)?oldChain:(state.tailChains[0]?.id||'');
  if(!meshes.length)meshSelect.add(new Option('Нет привязанных мешей',''));
  if(!state.tailChains.length)chainSelect.add(new Option('Нет костей Tail_01…',''));
  refreshTailEditor();
}
function activeTailSelection(){
  const mesh=state.tailMeshes.find(m=>m.uuid===$('tail-mesh-select').value);
  const chain=state.tailChains.find(c=>c.id===$('tail-chain-select').value);
  return {mesh,chain};
}
function refreshTailEditor(){
  const {mesh,chain}=activeTailSelection();
  const usable=Boolean(mesh&&chain&&!state.busy);
  for(const id of ['tail-mesh-select','tail-chain-select','tail-radius','tail-preview','tail-apply'])
    $(id).disabled=!usable;
  $('tail-wag').disabled=!usable;
  $('tail-undo').disabled=!usable || !state.tailUndo.has(mesh.uuid);
  $('tail-wag').textContent=state.tailWag?'■ Остановить виляние':'▶ Тест виляния хвоста';
  $('tail-radius-label').textContent=$('tail-radius').value+'% роста';
  if(!state.tailMeshes.length)$('tail-weights-status').textContent=
    'Сначала нажми «Привязать модель к скелету» или открой GLB с готовым ригом.';
  else if(!state.tailChains.length)$('tail-weights-status').textContent=
    'Не найдены кости Tail_01...Tail_05. Добавь цепочку хвоста в AutoRig.';
}
function stopTailWag(){
  if(!state.tailWag)return;
  for(const {bone,q} of state.tailWag.originals)bone.quaternion.copy(q);
  state.root?.updateMatrixWorld?.(true);
  state.tailWag=null;
  $('tail-wag').textContent='▶ Тест виляния хвоста';
}
function toggleTailWag(){
  if(state.tailWag){stopTailWag();refreshTailEditor();return;}
  if(state.busy)return;
  const {mesh,chain}=activeTailSelection();
  if(!mesh||!chain)return alertUser('Выбери меш и цепочку хвоста');
  state.playing=false;
  showFrame(0);
  state.tailWag={time:0,originals:chain.bones.map(b=>({bone:b,q:b.quaternion.clone()}))};
  refreshTailEditor();
}
function updateTailWag(dt){
  const wag=state.tailWag;
  if(!wag||!state.root)return;
  wag.time+=dt;
  const rotation=new THREE.Quaternion();
  const axis=new THREE.Vector3(0,1,0);
  wag.originals.forEach(({bone,q},i)=>{
    const angle=.19*Math.sin(wag.time*3.8-i*.62);
    rotation.setFromAxisAngle(axis,angle);
    bone.quaternion.copy(q).multiply(rotation);
  });
  state.root.updateMatrixWorld(true);
}
async function processTailWeight(apply){
  if(state.busy||!state.root)return;
  const {mesh,chain}=activeTailSelection();
  if(!mesh||!chain)return alertUser('Сначала выбери привязанный меш и хвост');
  stopTailWag();
  state.playing=false;
  showFrame(0);
  const original=state.tailUndo.get(mesh.uuid)?.original||null;
  const height=Math.max(.001,new THREE.Box3().setFromObject(state.root)
    .getSize(new THREE.Vector3()).y);
  const radiusWorld=height*Number($('tail-radius').value)/100;
  state.busy=true;
  refreshControls();
  const output=$('tail-weights-status');
  try{
    const region=await calculateTailRegion(mesh,chain.bones,{
      radiusWorld,dryRun:!apply,source:original,
      onProgress:p=>{if(p.percentage%10===0||p.percentage===100)
        output.textContent='Анализ хвоста: '+p.percentage+'% · затронуто '+p.affected+' вершин';}
    });
    const percentage=(region.affected/region.totalVertices*100).toFixed(1);
    if(!apply){
      output.textContent='Найдено '+region.affected+' из '+region.totalVertices+
        ' вершин ('+percentage+'%). Пока ничего не изменено.';
      return;
    }
    if(region.affected===0)throw new Error('В выбранном меше нет вершин возле хвоста. Проверь меш и увеличь радиус.');
    if(!window.confirm('Изменить веса '+region.affected+' вершин выбранного меша '+
      (mesh.name||'без имени')+'? Остальные меши не затронем. Будет доступна отмена.'))return;
    const previous=commitTailRegion(mesh,region);
    if(!state.tailUndo.has(mesh.uuid))state.tailUndo.set(mesh.uuid,{mesh,original:previous});
    output.textContent='Готово: '+region.affected+' вершин настроены для хвоста. '+
      'Нажми «Тест виляния хвоста», оцени тело и при необходимости отмени.';
    alertUser('Веса хвоста обновлены. Тело остальных мешей не менялось.');
  }catch(error){
    console.error('Tail weights',error);
    output.textContent='Ошибка: '+(error?.message||String(error));
    alertUser('Коррекция хвоста: '+(error?.message||String(error)));
  }finally{
    state.busy=false;refreshControls();
  }
}
function undoTailWeights(){
  if(state.busy)return;
  stopTailWag();
  const {mesh}=activeTailSelection();
  const data=state.tailUndo.get(mesh?.uuid);
  if(!data)return;
  restoreTailRegion(mesh,data.original);
  state.tailUndo.delete(mesh.uuid);
  $('tail-weights-status').textContent='Исходные веса этого меша восстановлены.';
  alertUser('Веса хвоста отменены!');
  refreshTailEditor();
}
function closeMenu() {$('welcome').classList.add('hidden');}
function openMenu() {$('welcome').classList.remove('hidden');}

$('model-file').addEventListener('change',event=>{
  const files=[...(event.target.files||[])];
  event.target.value='';
  importCharacter(files);
});
for(const id of ['menu-open-model','toolbar-open'])onButton(id,()=>$('model-file').click());
onButton('menu-start',()=>{closeMenu();if(!state.root)$('model-file').click();});
onButton('menu-editor',()=>closeMenu());
onButton('menu-about',()=>{$('welcome-info').classList.toggle('hidden');});
onButton('show-menu',openMenu);
onButton('menu-dismiss',closeMenu);
onButton('camera-frame',frameCamera);
onButton('autorig-add',()=>addRigGuide(true));
onButton('autorig-reset',()=>addRigGuide(true));
onButton('autorig-remove',()=>{
  if(!state.rigGuide)return;
  if(!window.confirm('Удалить подогнанный шаблон суставов?'))return;
  disposeRigGuide();
  refreshRigFields();
  alertUser('Шаблон удалён. Модель не изменена.');
});
onButton('autorig-save',saveRigGuide);
onButton('autorig-bind',bindFittedRig);
onButton('autorig-load-file',()=>$('fit-file').click());
onButton('autorig-recover',()=>{
  try{
    const saved=localStorage.getItem(fitKey());
    if(!saved)throw Error('Нет сохранённой подгонки');
    const d=applyFitData(JSON.parse(saved));
    alertUser('Черновик восстановлен: '+d.joints+' суставов, '+d.chains+' цепочек.');
  }catch(e){alertUser('Не удалось восстановить: '+(e?.message||String(e)));}
});
$('fit-file').addEventListener('change',event=>{
  const files=[...event.target.files];
  event.target.value='';
  openFitJSON(files);
});
onButton('autorig-geometry-fit',()=>applyGeometryFit(true));
onButton('autorig-snap',()=>{
  if(!state.rigGuide)return;
  state.rigSnapMode=!state.rigSnapMode;
  refreshRigFields();
  if(state.rigSnapMode)alertUser('Теперь коснись нужного места персонажа в 3D.');
});
$('autorig-direction').addEventListener('change',()=>{
  if(state.rigGuide)applyGeometryFit(true);
});
onButton('chain-add',createCustomChain);
onButton('chain-remove',deleteCustomChain);
$('chain-count').addEventListener('input',event=>{
  $('chain-count-label').textContent=event.target.value+' костей';
});
$('chain-list').addEventListener('change',event=>{
  const found=state.rigGuide?.chains?.find(c=>c.id===event.target.value);
  if(found)chooseRigJoint(found.names[0]);
});
$('autorig-scale').addEventListener('change',saveFitDraft);
rigTransform.addEventListener('dragging-changed',event=>{
  if(!event.value)saveFitDraft();
});
$('autorig-scale').addEventListener('input',event=>{
  if(!state.rigGuide || state.busy)return;
  const percent=THREE.MathUtils.clamp(Number(event.target.value)||100,50,175);
  state.rigGuide.root.scale.setScalar(percent/100);
  state.rigGuide.root.updateMatrixWorld(true);
  $('autorig-scale-value').textContent=Math.round(percent)+'%';
  syncRigMarkers();
  refreshRigFields();
});
function showRigView(side=false) {
  if(!state.root)return;
  const box=new THREE.Box3().setFromObject(state.root);
  if(box.isEmpty())return;
  const center=box.getCenter(new THREE.Vector3());
  const length=Math.max(box.getSize(new THREE.Vector3()).length(),.1);
  const d=length/Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*1.0;
  orbit.target.copy(center);
  camera.position.copy(center).add(side?new THREE.Vector3(d,0,0):new THREE.Vector3(0,0,d));
  orbit.update();
  syncRigMarkers();
}
onButton('autorig-front',()=>showRigView(false));
onButton('autorig-side',()=>showRigView(true));
$('autorig-arrows').addEventListener('change',event=>{
  state.rigEditMode=event.target.checked?'arrows':'touch';
  syncRigMarkers();
  refreshRigFields();
});
$('autorig-selected').addEventListener('change',event=>chooseRigJoint(event.target.value));
$('autorig-visible').addEventListener('change',event=>{
  state.rigEnabled=event.target.checked;
  syncRigMarkers();
});
for(const axis of ['x','y','z'])
  $('autorig-'+axis).addEventListener('change',event=>editRigCoordinate(axis,event.target.value));

onButton('new-clip',()=>switchClip('new'));
$('bone-search').addEventListener('input',drawBoneList);
$('clip-select').addEventListener('change',e=>switchClip(e.target.value));
$('clip-name').addEventListener('change',e=>{
  state.clipName=e.target.value.trim().slice(0,70)||'New Animation';
  e.target.value=state.clipName;
});
$('duration').addEventListener('change',e=>{
  state.frames=Math.max(1,Math.min(MAX_FRAMES,Math.round(Number(e.target.value)||90)));
  e.target.value=String(state.frames);
  showFrame(state.frame);
});
$('seek').addEventListener('input',e=>{state.playing=false;showFrame(Number(e.target.value));});
onButton('play',()=>{
  if(!state.root)return;
  state.playing=!state.playing;
  if(state.playing&&state.frame>=state.frames)showFrame(0);
  state.frameCarry=0;
  refreshControls();
});
onButton('stop',()=>{state.playing=false;showFrame(0);});
onButton('to-start',()=>{state.playing=false;showFrame(0);});
onButton('to-end',()=>{state.playing=false;showFrame(state.frames);});
onButton('step-minus',()=>{state.playing=false;showFrame(state.frame-1);});
onButton('step-plus',()=>{state.playing=false;showFrame(state.frame+1);});
$('play-speed').addEventListener('change',e=>state.speed=Number(e.target.value)||1);
$('repeat').addEventListener('change',e=>state.loop=e.target.checked);
onButton('key-bone',keyBone);
onButton('key-pose',keyPose);
onButton('delete-key',deleteKey);
onButton('copy-pose',copyPose);
onButton('paste-pose',pastePose);
onButton('clear-keys',()=>{
  if(!state.timeline.count)return;
  if(!window.confirm('Удалить все добавленные ключи текущей анимации?'))return;
  state.playing=false;state.timeline.clear();
  showFrame(state.frame);drawBoneList();alertUser('Добавленные ключи удалены');
});
for(const axis of ['x','y','z']){
  $('rotate-'+axis).addEventListener('input',e=>editAngle(axis,e.target.value));
  $('angle-'+axis).addEventListener('change',e=>editAngle(axis,e.target.value));
}
$('show-bones').addEventListener('change',e=>{
  if(state.skeleton)state.skeleton.visible=e.target.checked;
});
$('show-grid').addEventListener('change',e=>grid.visible=e.target.checked);
onButton('save-glb',exportGLB);
onButton('save-fbx',exportFBX);
onButton('tail-preview',()=>processTailWeight(false));
onButton('tail-apply',()=>processTailWeight(true));
onButton('tail-undo',undoTailWeights);
onButton('tail-wag',toggleTailWag);
$('tail-radius').addEventListener('input',()=>{
  $('tail-radius-label').textContent=$('tail-radius').value+'% роста';
  $('tail-weights-status').textContent='Радиус изменён. Сначала проверь область, затем применяй.';
});
$('tail-mesh-select').addEventListener('change',refreshTailEditor);
$('tail-chain-select').addEventListener('change',refreshTailEditor);

function resize(){
  const v=$('viewport');
  if(v.clientWidth<2||v.clientHeight<2)return;
  camera.aspect=v.clientWidth/v.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(v.clientWidth,v.clientHeight,false);
}
new ResizeObserver(resize).observe($('viewport'));
window.addEventListener('resize',resize);
resize();
const clock=new THREE.Clock();
let uiAcc=0;
function animate(){
  requestAnimationFrame(animate);
  const delta=Math.min(.1,clock.getDelta());
  if(state.playing&&state.root&&!state.busy){
    state.frameCarry+=delta*FPS*state.speed;
    const steps=Math.floor(state.frameCarry);
    if(steps>0){
      state.frameCarry-=steps;
      let next=state.frame+steps;
      if(next>=state.frames){
        if(state.loop)next=next%Math.max(1,state.frames);
        else {next=state.frames;state.playing=false;}
      }
      showFrame(next,false);
      uiAcc+=delta;
      if(uiAcc>=.075){refreshAngles();drawKeys();refreshControls();uiAcc=0;}
    }
  }
  if(state.rigGuide)syncRigMarkers();
  updateTailWag(delta);
  orbit.update();
  renderer.render(scene,camera);
}
animate();
buildClipMenu();
drawBoneList();
showFrame(0);
refreshControls();
refreshRigFields();
report('ГОТОВО');