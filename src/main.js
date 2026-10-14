import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { FPS, MAX_FRAMES, Timeline, boneLookup, compileClip, clampFrame } from './timeline.js';
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
  rafStamp: 0, frameCarry: 0, toastTimer: null
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
    selected:null,skeleton:null,frame:0,frames:90,clipName:'New Animation'
  });
  state.timeline.clear();
  state.clipboard = null;
}

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
  if (!main) return alertUser('Выбери GLB, GLTF или FBX со скелетом');
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
    if (!bones.length) throw new Error('Модель без скелета. Выбери риггированного персонажа.');
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
    state.mixer = new THREE.AnimationMixer(root);
    scene.add(root);
    state.skeleton = new THREE.SkeletonHelper(root);
    state.skeleton.visible = $('show-bones').checked;
    scene.add(state.skeleton);
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
    alertUser('Персонаж загружен: ' + main.name);
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
    const msg=document.createElement('p');msg.className='hint';msg.textContent='Совпадений нет';
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
  for(const id of ['save-glb','play','stop','to-start','to-end','step-minus','step-plus',
    'key-bone','key-pose','copy-pose','clear-keys','clip-name','duration','seek']) {
    $(id).disabled = !ready;
  }
  $('delete-key').disabled = !ready || !state.selected || !state.timeline.has(state.selected,state.frame);
  $('paste-pose').disabled = !ready || !state.clipboard;
  $('play').textContent = state.playing ? 'Ⅱ Пауза' : '▶ Играть';
}

function editAngle(axis, value) {
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
  const data=buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new TextEncoder().encode(String(buffer));
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
      const h=await window.showSaveFilePicker({
        suggestedName:name,types:[{description:'3D GLB',accept:{'model/gltf-binary':['.glb']}}]
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
  if(state.sourceIndex<0 && !state.timeline.count)return alertUser('Запиши хотя бы один ключ для новой анимации');
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
    const edited=exportClip();
    const sourceClips=state.sourceClips.slice();
    if(state.sourceIndex<0)sourceClips.push(edited);
    else sourceClips[state.sourceIndex]=edited;
    const clips=sourceClips.filter(c=>c.tracks.length);
    if(!clips.length)throw new Error('В анимации нет экспортируемых движений');
    exportScene.add(state.root);moved=true;
    const glb=await new GLTFExporter().parseAsync(exportScene,{
      binary:true,trs:true,onlyVisible:true,animations:clips
    });
    assertGlb(glb);
    scene.add(state.root);moved=false;
    const name=(state.modelName||'character').replace(/\.[^.]+$/,'')
      .replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,55)+'_animation.glb';
    $('save-info').textContent='GLB готов ('+(glb.byteLength/1048576).toFixed(1)+' МБ). Выбери папку.';
    const result=await saveFile(glb,name,'model/gltf-binary',p=>{
      $('save-info').textContent=p===100?'Открываем выбор папки…':'Передаём GLB: '+p+'%';
    });
    if(result.saved) {
      $('save-info').textContent='Сохранено. Теперь проверь GLB повторной загрузкой.';
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
  orbit.update();
  renderer.render(scene,camera);
}
animate();
buildClipMenu();
drawBoneList();
showFrame(0);
refreshControls();
report('ГОТОВО');