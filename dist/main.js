import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createMaterials } from './materials.js';
import { createRoom } from './room.js';
import { createControls } from './controls.js';

const canvas=document.getElementById('scene');
const progress=document.getElementById('loadingProgress');
const label=document.getElementById('loadingText');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer,composer,controls,frameHandle,room,scene,camera;

function optimizeStaticGeometry(){
  scene.updateMatrixWorld(true);
  const groups=new Map();
  scene.traverse(object=>{
    if(!object.isMesh||Array.isArray(object.material)||object.material.transparent)return;
    const key=object.material.uuid+':'+object.castShadow+':'+object.receiveShadow;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(object);
  });
  for(const objects of groups.values()){
    if(objects.length<3)continue;
    const geometries=objects.map(object=>{
      const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);return geometry;
    });
    const combined=mergeGeometries(geometries,false);
    geometries.forEach(geometry=>geometry.dispose());
    if(!combined)continue;
    combined.computeBoundingBox();combined.computeBoundingSphere();
    const mesh=new THREE.Mesh(combined,objects[0].material);
    mesh.castShadow=objects[0].castShadow;mesh.receiveShadow=objects[0].receiveShadow;
    mesh.name='Static room surfaces';scene.add(mesh);
    objects.forEach(object=>object.removeFromParent());
  }
}

function windowView(){
  const view=new THREE.Group();
  const skyCanvas=document.createElement('canvas');skyCanvas.width=512;skyCanvas.height=512;
  const c=skyCanvas.getContext('2d');
  const g=c.createLinearGradient(0,0,0,512);g.addColorStop(0,'#233747');g.addColorStop(.55,'#455b69');g.addColorStop(1,'#67716d');c.fillStyle=g;c.fillRect(0,0,512,512);
  // A distant, out-of-focus tree is visible only through the bedroom window.
  c.strokeStyle='#263738';c.lineWidth=9;c.beginPath();c.moveTo(390,550);c.bezierCurveTo(361,350,366,260,350,90);c.stroke();
  for(let i=0;i<16;i++){
    const y=90+i*25,side=i%2?1:-1;
    c.lineWidth=Math.max(1,5-i*.2);c.beginPath();c.moveTo(355+i*1.7,y);c.quadraticCurveTo(350+side*70,y-45,350+side*(90+i*7),y-80);c.stroke();
  }
  const tex=new THREE.CanvasTexture(skyCanvas);tex.colorSpace=THREE.SRGBColorSpace;
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(12,9),new THREE.MeshBasicMaterial({map:tex,fog:false}));
  plane.position.set(.5,2.2,-7.15);view.add(plane);scene.add(view);
}

function addLighting(){
  RectAreaLightUniformsLib.init();
  scene.add(new THREE.HemisphereLight(0xb4c7dc,0x30281f,.34));
  const windowLight=new THREE.RectAreaLight(0xb3cfe8,3.3,1.56,1.48);
  windowLight.position.copy(room.windowPosition).add(new THREE.Vector3(0,0,.17));
  windowLight.lookAt(-.5,1.1,1.7);scene.add(windowLight);
  const moon=new THREE.DirectionalLight(0xb6cce4,1.7);
  moon.position.set(-1,4.2,-7.5);moon.target.position.set(.6,.2,1.8);
  moon.castShadow=true;moon.shadow.mapSize.set(2048,2048);
  moon.shadow.camera.left=-5;moon.shadow.camera.right=5;moon.shadow.camera.top=5;moon.shadow.camera.bottom=-5;
  moon.shadow.camera.near=.2;moon.shadow.camera.far=20;
  moon.shadow.bias=-.00025;moon.shadow.normalBias=.015;moon.shadow.radius=3;
  scene.add(moon,moon.target);
  const lamp=new THREE.PointLight(0xffbc78,22,7,2);
  lamp.position.copy(room.lampPosition);lamp.castShadow=true;lamp.shadow.mapSize.set(1024,1024);
  lamp.shadow.camera.near=.04;lamp.shadow.camera.far=8;lamp.shadow.normalBias=.012;lamp.shadow.bias=-.0002;
  lamp.shadow.radius=3;scene.add(lamp);
  // Reflected lamplight softens the ceiling and the nearby plaster.
  const bounce=new THREE.RectAreaLight(0xffd2a0,.65,.65,.45);
  bounce.position.set(.45,1.7,-2.45);bounce.lookAt(-.4,2.8,-1.8);scene.add(bounce);
  const coolBounce=new THREE.PointLight(0xa1bdd2,1.5,6,2);coolBounce.position.set(1.1,1.9,-1.1);scene.add(coolBounce);
}

function dust(){
  const count=95,positions=new Float32Array(count*3),phases=new Float32Array(count);
  for(let i=0;i<count;i++){
    positions[i*3]=Math.sin(i*127.1)*2.7;positions[i*3+1]=.2+((i*47)%97)/97*2.5;positions[i*3+2]=Math.cos(i*311.7)*2.7;phases[i]=i*1.21;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const material=new THREE.PointsMaterial({color:0xcbd1c4,size:.008,transparent:true,opacity:.16,depthWrite:false,sizeAttenuation:true});
  const points=new THREE.Points(geometry,material);scene.add(points);
  return t=>{
    if(reducedMotion)return;
    for(let i=0;i<count;i++)positions[i*3+1]=.25+(((i*47)%97)/97*2.5+t*.008)%2.5;
    geometry.attributes.position.needsUpdate=true;
  };
}

function setupPost(){
  const w=innerWidth,h=innerHeight;
  composer=new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  const ao=new GTAOPass(scene,camera,w,h);
  const aoExcluded=[];
  scene.traverse(object=>{if(object.isMesh&&[object.material].flat().some(material=>material.transparent))aoExcluded.push(object);});
  const renderGeometry=ao._renderOverride.bind(ao);
  ao._renderOverride=(...args)=>{
    const visibility=aoExcluded.map(object=>object.visible);
    aoExcluded.forEach(object=>{object.visible=false;});
    try{return renderGeometry(...args);}finally{aoExcluded.forEach((object,i)=>{object.visible=visibility[i];});}
  };
  ao.blendIntensity=.54;
  ao.updateGtaoMaterial({radius:.24,distanceExponent:1.6,thickness:.5,distanceFallOff:1,scale:1,samples:16});
  ao.updatePdMaterial({lumaPhi:10,depthPhi:3,normalPhi:4,radius:5,rings:2,samples:16});
  composer.addPass(ao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(w,h),.12,.45,1.35));
  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());
  const finish=new ShaderPass({
    uniforms:{tDiffuse:{value:null},time:{value:0}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      void main(){vec3 col=texture2D(tDiffuse,vUv).rgb;
      vec2 p=(vUv-.5)*vec2(1.0,.85);float edge=dot(p,p);
      col*=1.0-smoothstep(.10,.55,edge)*.18;
      float grain=fract(sin(dot(vUv+fract(time),vec2(12.9898,78.233)))*43758.5453)-.5;
      col+=grain*.006;gl_FragColor=vec4(col,1.0);}`
  });
  composer.addPass(finish);return finish;
}

async function init(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance',alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1.5:1.75));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene();scene.background=new THREE.Color('#293e4d');scene.fog=new THREE.FogExp2(0x34404a,.014);
  camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.06,35);
  camera.position.set(2.15,1.62,2.55);camera.lookAt(-.55,1.2,-1.3);
  const pmrem=new THREE.PMREMGenerator(renderer);const env=new RoomEnvironment();
  scene.environment=pmrem.fromScene(env,.04).texture;scene.environmentIntensity=.19;env.dispose();pmrem.dispose();
  const materials=await createMaterials(renderer,value=>{const n=Math.min(85,Math.round((value>1?value/100:value)*85));progress.style.width=n+'%';});
  label.textContent='Ajustando a iluminação...';progress.style.width='90%';
  room=createRoom(scene,materials);windowView();optimizeStaticGeometry();addLighting();
  controls=createControls(camera,canvas,room.colliders);
  const finish=setupPost(),updateDust=dust();
  renderer.compile(scene,camera);
  renderer.render(scene,camera);
  renderer.shadowMap.autoUpdate=false;
  const clock=new THREE.Clock();let elapsed=0;
  function frame(){
    const dt=Math.min(clock.getDelta(),.04);elapsed+=dt;controls.update(dt);updateDust(elapsed);
    for(const update of room.updates||[])update(elapsed,dt);
    finish.uniforms.time.value=reducedMotion?0:elapsed*.25;
    composer.render(dt);frameHandle=requestAnimationFrame(frame);
  }
  frame();progress.style.width='100%';
  document.getElementById('loading').classList.add('hidden');document.body.classList.add('ready');
  window.addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frameHandle);showError('A renderização foi interrompida. Recarregue a página para abrir o quarto novamente.');});
  // Public metadata for diagnostics; all scene interaction stays in the controls.
  window.Quarto01={version:'0.1.0',renderer:'WebGL2',materials:Object.keys(materials),meshes:renderer.info.render.triangles};
}

function showError(message){
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('errorPanel').classList.remove('hidden');
  document.getElementById('errorText').textContent=message;
}
init().catch(error=>{console.error(error);showError('Não foi possível abrir o quarto em 3D. Use Chrome ou Edge com a aceleração gráfica ativada e recarregue a página.');});
