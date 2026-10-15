import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';

// One small WebGL renderer total, regardless of how many files are in a pack.
// Preview plays on the SOURCE mannequin, without touching the open character.
export class AnimationPreview {
  constructor(viewport){
    this.viewport=viewport;
    this.renderer=null;
    this.scene=null;
    this.model=null;
    this.mixer=null;
    this.camera=null;
    this.active=false;
    this.generation=0;
    this.acc=0;
    this.clock=0;
    this.normalMaterial=null;
  }
  createRenderer(){
    if(this.renderer)return;
    this.renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'low-power'});
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x0b1626);
    this.renderer.domElement.style.width='100%';
    this.renderer.domElement.style.height='100%';
    this.viewport.append(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(38,1,.01,1500);
    this.normalMaterial=new THREE.MeshNormalMaterial({side:THREE.DoubleSide});
  }
  clear(){
    this.generation++;
    this.active=false;
    if(this.mixer){
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.model);
    }
    if(this.model)this.model.traverse(node=>{
      if(node.geometry)node.geometry.dispose();
      if(node.material && node.material!==this.normalMaterial){
        for(const material of Array.isArray(node.material)?node.material:[node.material]){
          if(material!==this.normalMaterial){
            for(const value of Object.values(material))if(value?.isTexture)value.dispose();
            material.dispose();
          }
        }
      }
    });
    this.mixer=null;
    this.model=null;
    this.scene=null;
  }
  async load(fetchBlob,filename,onState=()=>{}){
    this.clear();
    const request=this.generation;
    onState('Загружаем предпросмотр…');
    if(typeof fetchBlob!=='function'){
      onState('Для этого клипа нет исходного файла предпросмотра.');
      return;
    }
    let url;
    try{
      const blob=await fetchBlob();
      if(request!==this.generation)return;
      url=URL.createObjectURL(blob);
      let model,animations;
      if(/\.fbx$/i.test(filename||'')){
        model=await new FBXLoader().loadAsync(url);
        animations=model.animations||[];
      }else{
        const loaded=await new GLTFLoader().loadAsync(url);
        model=loaded.scene;
        animations=loaded.animations||[];
      }
      if(request!==this.generation){
        model?.traverse?.(n=>n.geometry?.dispose?.());
        return;
      }
      this.createRenderer();
      this.scene=new THREE.Scene();
      this.scene.background=new THREE.Color('#0b1626');
      this.scene.add(model);
      this.model=model;
      // The provided black Mixamo silhouettes would blend into the panel.
      // Bright normal shading makes the movement readable on small screens.
      model.traverse(node=>{
        if(node.isMesh){node.material=this.normalMaterial;node.frustumCulled=false;}
      });
      model.updateWorldMatrix(true,true);
      const bounds=new THREE.Box3().setFromObject(model);
      if(bounds.isEmpty())throw Error('В файле нет 3D-геометрии для предпросмотра');
      this.center=bounds.getCenter(new THREE.Vector3());
      const size=bounds.getSize(new THREE.Vector3());
      const height=Math.max(.2,size.y);
      this.distance=Math.max(1,height*2.4,size.x*2.2,size.z*2.2);
      this.camera.near=Math.max(.001,this.distance/1000);
      this.camera.far=this.distance*20;
      this.camera.updateProjectionMatrix();
      this.mixer=new THREE.AnimationMixer(model);
      if(animations.length){
        this.mixer.clipAction(animations[0]).reset().play();
      }else onState('Нет анимации: показываем статичную модель.');
      this.clock=0;
      this.active=true;
      if(animations.length)onState('▶ Предпросмотр движения');
      this.update(0.1);
    }catch(error){
      if(request===this.generation){
        this.clear();
        onState('Ошибка предпросмотра: '+(error?.message||String(error)));
      }
    }finally{
      if(url)URL.revokeObjectURL(url);
    }
  }
  update(delta){
    if(!this.active||!this.renderer||!this.model||!this.camera)return;
    this.acc+=Math.min(.1,delta);
    if(this.acc<1/24)return;
    const tick=this.acc;this.acc=0;
    this.clock+=tick;
    this.mixer?.update(tick);
    const viewportW=Math.max(1,this.viewport.clientWidth);
    const viewportH=Math.max(1,this.viewport.clientHeight);
    const targetWidth=Math.min(256,Math.round(viewportW));
    const targetHeight=Math.min(256,Math.round(viewportH));
    if(!targetWidth||!targetHeight)return;
    this.renderer.setSize(targetWidth,targetHeight,false);
    this.camera.aspect=targetWidth/targetHeight;
    this.camera.updateProjectionMatrix();
    const orbitAngle=.25*Math.sin(this.clock*.6);
    this.camera.position.copy(this.center).add(new THREE.Vector3(
      Math.sin(orbitAngle)*this.distance,this.distance*.16,
      Math.cos(orbitAngle)*this.distance
    ));
    this.camera.lookAt(this.center);
    this.renderer.render(this.scene,this.camera);
  }
  dispose(){
    this.clear();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.renderer=null;
    this.normalMaterial?.dispose();
    this.normalMaterial=null;
  }
}
