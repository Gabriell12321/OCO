import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: new URL('../dist/vendor/three.module.js', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const THREE = await import('three');
const { createControls } = await import('../dist/controls.js');

class Surface extends EventTarget {
  constructor() { super(); this.classList={toggle(){},remove(){}}; this.style={}; }
  focus() {} setPointerCapture() {} hasPointerCapture(){return false;} setAttribute(key,value){this[key]=value;}
}
const doc=new Surface(),win=new Surface(),canvas=new Surface();
const buttons={resetBtn:new Surface(),fullscreenBtn:new Surface(),viewBtn:new Surface()};
doc.body=new Surface(); doc.getElementById=id=>buttons[id]||null; doc.querySelectorAll=()=>[];
doc.documentElement=new Surface();
globalThis.document=doc; globalThis.window=win;
let lockRequests=0,raycasts=0;
canvas.requestPointerLock=()=>{lockRequests++;doc.pointerLockElement=canvas;doc.dispatchEvent(new Event('pointerlockchange'));};
doc.exitPointerLock=()=>{doc.pointerLockElement=null;doc.dispatchEvent(new Event('pointerlockchange'));};
const originalRaycast=THREE.Raycaster.prototype.intersectObjects;
THREE.Raycaster.prototype.intersectObjects=function(...args){raycasts++;return originalRaycast.apply(this,args);};
const legacyAvatar={object:new THREE.Group()};
const unusedScene={traverse(){throw new Error('Walking controls must not inspect scene triangles.');}};
const camera=new THREE.PerspectiveCamera(62,1,.05,30);
const controls=createControls(camera,canvas,[{minX:-3,maxX:3,minZ:0,maxZ:.2}],legacyAvatar,unusedScene);
function emit(target,type,values={}) {
  const event=new Event(type,{cancelable:true});
  for(const [key,value] of Object.entries(values))Object.defineProperty(event,key,{value});
  target.dispatchEvent(event); return event;
}
const key=(type,code)=>emit(doc,type,{code});
function checkCamera() {
  assert.ok(Math.abs(camera.position.y-1.45)<=.036,'Chest motion stays within 36 mm of its 1.45 m mount');
  assert.ok(Math.hypot(camera.position.x-controls.position.x,camera.position.z-controls.position.z)<=.025,'Chest translation stays within 25 mm of the collision body');
  assert.equal(controls.mode,'first-person');
}
const tick=(n=1)=>{for(let i=0;i<n;i++){controls.update(1/60);checkCamera();}};
tick();assert.equal(controls.changed,true);tick();assert.equal(controls.changed,false);
assert.equal(legacyAvatar.object.visible,false);
assert.equal('toggleView' in controls,false);
const originalQuaternion=camera.quaternion.clone(),originalPosition=camera.position.clone();
for(let i=0;i<12;i++){key('keydown','KeyV');key('keyup','KeyV');emit(buttons.viewBtn,'click');tick();}
assert.ok(camera.quaternion.angleTo(originalQuaternion)<1e-8);assert.ok(camera.position.distanceTo(originalPosition)<1e-8);
assert.equal(controls.changed,false);assert.equal(controls.mode,'first-person');
key('keydown','KeyW');tick(180);key('keyup','KeyW');
assert.ok(controls.position.z>=.419999,'Player cannot cross a furniture collider');
assert.ok(controls.position.x<1.5,'Movement slides along the blocking furniture');
tick(100);assert.equal(controls.moving,false);assert.equal(controls.changed,false);
controls.reset();key('keydown','KeyS');tick(30);const walkDistance=controls.position.distanceTo(new THREE.Vector3(1.5,0,1.2));
controls.reset();key('keydown','ShiftLeft');key('keydown','KeyS');tick(30);
const runDistance=controls.position.distanceTo(new THREE.Vector3(1.5,0,1.2));assert.ok(runDistance>walkDistance*1.4);assert.equal(controls.running,true);
tick(600);assert.ok(controls.position.x<=2.75&&controls.position.z<=2.9,'Room boundary collision');

// Natural gait is tied to travelled distance, with a gradual start and no
// residual stepping when a collider prevents the player from moving.
assert.equal(controls.setDiagnosticPose({position:[0,2.5],yaw:0,pitch:0}),true);
assert.equal(controls.gait.phase,0);assert.equal(controls.gait.blend,0);assert.equal(camera.position.y,1.45);
const gaitReference=controls.gait,heights=[];
key('keydown','KeyW');tick();const firstStepSpeed=controls.speed;
assert.ok(firstStepSpeed>0&&firstStepSpeed<.3,'Walking transfers weight before reaching full speed');
const firstDistance=2.5-controls.position.z;
assert.ok(Math.abs(controls.gait.phase-firstDistance/1.24*Math.PI*2)<1e-8,'Step phase follows real distance');
for(let i=0;i<99;i++){tick();heights.push(camera.position.y);}
assert.equal(controls.gait,gaitReference,'Shared gait does not allocate a new object per frame');
assert.ok(controls.speed>1.1&&controls.speed<1.13,'Walking reaches the intended human pace');
assert.ok(Math.max(...heights)-Math.min(...heights)>.025,'Chest-mounted walking has visible torso travel');
assert.ok(Math.abs(heights.reduce((sum,y)=>sum+y,0)/heights.length-1.45)<.006,'Walking preserves mean chest height');
key('keyup','KeyW');const releasedAt=controls.position.clone();tick(90);
assert.ok(controls.position.distanceTo(releasedAt)<.11,'Stopping does not slide more than 11 cm');
assert.equal(controls.gait.blend,0);assert.equal(camera.position.y,1.45);assert.equal(controls.changed,false);
assert.equal(controls.setDiagnosticPose({position:[0,.43],yaw:0,pitch:0}),true);
key('keydown','KeyW');tick(90);const blockedPhase=controls.gait.phase;tick(30);
assert.equal(controls.gait.phase,blockedPhase,'Walking into furniture never advances footsteps');
assert.equal(controls.gait.speed,0);assert.equal(controls.gait.blend,0);assert.equal(camera.position.y,1.45);
assert.equal(controls.setDiagnosticPose({position:[0,1],yaw:.5,pitch:-.1}),true);
assert.equal(controls.gait.phase,0);assert.equal(controls.gait.blend,0);assert.equal(controls.gait.runBlend,0);
assert.equal(camera.position.y,1.45,'Diagnostic poses start with a settled chest camera');
controls.diagnosticLook(0,10000);assert.equal(controls.pitch,-1.42,'Mouse can look down far enough to inspect feet');
controls.diagnosticLook(0,-20000);assert.equal(controls.pitch,1.15,'Upward mouse limit stays unchanged');
assert.equal(controls.setDiagnosticPose({position:[0,1],yaw:0,pitch:-2}),true);
assert.equal(controls.pitch,-1.42,'Diagnostic poses use the same downward limit as mouse look');
assert.equal(controls.setDiagnosticPose({position:[0,1],yaw:0,pitch:2}),true);
assert.equal(controls.pitch,1.15,'Diagnostic poses preserve the upward limit');
emit(buttons.resetBtn,'click');tick(2);
assert.ok(controls.position.distanceTo(new THREE.Vector3(1.5,0,1.2))<1e-8);assert.equal(controls.moving,false);assert.equal(controls.running,false);
assert.ok(camera.quaternion.angleTo(originalQuaternion)<1e-8,'Reset restores look direction');
emit(canvas,'pointerdown',{button:0,pointerId:1,pointerType:'touch',clientX:0,clientY:0});
emit(canvas,'pointermove',{pointerId:1,clientX:120,clientY:45});tick();
assert.ok(camera.quaternion.angleTo(originalQuaternion)>.1);assert.equal(controls.changed,true);
emit(canvas,'pointerup',{pointerId:1});tick(45);assert.equal(controls.changed,false);
assert.equal(lockRequests,0,'No pointer lock before a mouse click');
emit(canvas,'pointerdown',{button:0,pointerId:3,pointerType:'mouse',clientX:0,clientY:0});assert.equal(lockRequests,1,'A single mouse click requests pointer lock');
const dragQuaternion=camera.quaternion.clone();
emit(canvas,'pointermove',{movementX:40,movementY:-15});tick();assert.ok(camera.quaternion.angleTo(dragQuaternion)>.02);
doc.exitPointerLock();
key('keydown','KeyW');tick();win.dispatchEvent(new Event('blur'));
const stoppedAt=controls.position.clone();tick(3);assert.ok(controls.position.distanceTo(stoppedAt)<1e-8);
const f11=key('keydown','F11');assert.equal(f11.defaultPrevented,false,'Native app F11 remains available');
controls.reset();
emit(canvas,'pointerdown',{button:0,pointerId:2,pointerType:'touch',clientX:0,clientY:0});
key('keydown','KeyD');
const timings=[];
for(let i=0;i<1200;i++){
 emit(canvas,'pointermove',{pointerId:2,clientX:i*2,clientY:Math.sin(i/60)*100});
 const started=performance.now();controls.update(1/60);timings.push(performance.now()-started);
 checkCamera();
}
controls.dispose();const disposedAt=controls.position.clone();
key('keydown','KeyW');tick(10);assert.ok(controls.position.distanceTo(disposedAt)<1e-8,'Disposed listeners no longer move the player');
assert.equal(raycasts,0);
THREE.Raycaster.prototype.intersectObjects=originalRaycast;
const mean=timings.reduce((a,b)=>a+b,0)/timings.length;timings.sort((a,b)=>a-b);
console.log(JSON.stringify({firstPersonOnly:'OK',vHasNoAction:'OK',legacyViewButtonHasNoAction:'OK',chestMountHeight:1.45,maxVerticalSwayMeters:.036,maxHorizontalSwayMeters:.025,naturalAcceleration:'OK',distanceDrivenGait:'OK',blockedGaitStops:'OK',idleCameraSettles:'OK',collisionAndSliding:'OK',walkingAndRunning:'OK',roomBounds:'OK',resetClearsKeys:'OK',dragAndPointerLock:'OK',nativeF11:'OK',dispose:'OK',sceneRaycasts:raycasts,controllerMeanMs:+mean.toFixed(5),controllerP95Ms:+timings[Math.floor(timings.length*.95)].toFixed(5)}));
