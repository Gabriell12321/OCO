import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,nextResolve){
 if(specifier==='three')return {url:new URL('./dist/vendor/three.module.js',import.meta.url).href,shortCircuit:true};
 if(specifier.startsWith('three/addons/'))return {url:new URL('./dist/vendor/addons/'+specifier.slice(13),import.meta.url).href,shortCircuit:true};
 return nextResolve(specifier,context);
}});
const THREE=await import('three');
const {createRoom}=await import('./dist/room.js');
const gradient={addColorStop(){}};
const context=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(target,key)=>target[key]??(()=>{})});
globalThis.document={createElement:()=>({width:128,height:128,getContext:()=>context})};
const scene=new THREE.Scene();
const keys=['floor','wall','ceiling','wood','woodDark','linen','blanket','rug','metal','brass','glass','curtain','trim','paper'];
const materials=Object.fromEntries(keys.map(key=>[key,new THREE.MeshStandardMaterial({color:0xaaaaaa})]));
const room=createRoom(scene,materials);scene.updateMatrixWorld(true);
let meshes=0,vertices=0,triangles=0;
scene.traverse(object=>{
 for(const number of object.matrixWorld.elements)assert.ok(Number.isFinite(number),`Transformação finita: ${object.name||object.type}`);
 if(!object.isMesh)return;meshes++;
 for(const material of [object.material].flat())assert.ok(material?.isMaterial,'Material válido');
 const position=object.geometry.getAttribute('position');vertices+=position.count;
 for(const number of position.array)assert.ok(Number.isFinite(number),'Geometria deve conter apenas coordenadas finitas');
 const normal=object.geometry.getAttribute('normal');if(normal)for(const number of normal.array)assert.ok(Number.isFinite(number),'Normais finitas');
 triangles+=object.geometry.index?object.geometry.index.count/3:position.count/3;
});
assert.ok(meshes>100);assert.ok(triangles>20000);
for(const collider of room.colliders){
 for(const key of ['minX','maxX','minZ','maxZ'])assert.ok(Number.isFinite(collider[key]));
 assert.ok(collider.minX<collider.maxX&&collider.minZ<collider.maxZ);
 assert.ok(!(2.15>collider.minX-.18&&2.15<collider.maxX+.18&&2.55>collider.minZ-.18&&2.55<collider.maxZ+.18),'Ponto inicial livre');
 assert.ok(!(1.5>collider.minX-.22&&1.5<collider.maxX+.22&&1.2>collider.minZ-.22&&1.2<collider.maxZ+.22),'Personagem inicia em espaço livre');
}
const solidMeshes=[];scene.traverse(o=>{if(o.isMesh&&!o.material.transparent)solidMeshes.push(o);});
const windowRay=new THREE.Raycaster(new THREE.Vector3(.65,2.15,-3.14),new THREE.Vector3(0,0,-1),.08,1);
assert.equal(windowRay.intersectObjects(solidMeshes,false).length,0,'A janela deve ter uma abertura física');
const viewDirection=new THREE.Vector3(-.55,1.2,-1.3).sub(new THREE.Vector3(2.15,1.45,2.55)).normalize();
const viewRay=new THREE.Raycaster(new THREE.Vector3(2.15,1.45,2.55),viewDirection,.05,20);
const hits=viewRay.intersectObjects(solidMeshes,false);assert.ok(hits.length>0&&hits[0].distance>1,'A câmera deve enxergar o interior do quarto');
// Keep the chest camera's near field clear around the room's real furniture.
// Extreme offset samples include more motion than the controller permits.
const chestCamera=new THREE.PerspectiveCamera(76,1900/977,.045,45);
let bodycamClearanceSamples=0;
for(const pose of [
 [1.5,1.2,.6868176498,-.12], [.85,.3,.77,-.4],
 [1.5,-1.6,-2.299,0], [.7,-.8,-2.975,-1.38], [2.75,1.65,-Math.PI/2,0],
]) for(const offset of [[0,0,0],[.04,.036,.04],[-.04,-.036,-.04]]) {
 chestCamera.position.set(pose[0]+offset[0],1.45+offset[1],pose[1]+offset[2]);
 chestCamera.rotation.set(pose[3],pose[2],0,'YXZ');chestCamera.updateMatrixWorld(true);
 for(const x of [-1,0,1])for(const y of [-1,0,1]){
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x,y),chestCamera);ray.far=.10;
  assert.equal(ray.intersectObjects(solidMeshes,false).length,0,'Câmera corporal não atravessa móveis nem paredes no campo próximo');
  bodycamClearanceSamples++;
 }
}
function verifyAssets(directory){
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())verifyAssets(file);
  else assert.ok(fs.statSync(file).size>1000,`Asset válido: ${file}`);
 }
}
verifyAssets('dist/assets');
console.log(JSON.stringify({meshes,vertices,triangles,colliders:room.colliders.length,windowOpening:'OK',initialView:'OK',bodycamClearanceSamples,assets:'OK'}));
