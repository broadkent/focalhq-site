import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.f231b18ca7.js';
import { captureState, clamp } from './capture.js';
import { createPartRegistry } from './parts.js';
import { createHighlightFader } from './highlight_fader.js';
import { buildLensAssembly } from './lens_assembly.js';
import { CAMERA_LAYOUT } from './camera_layout.js';
import { createCameraPrintMaterial } from './camera_print_material.js';
import { createSceneDissolve } from './scene_dissolve.js';
import { createDslrVariant } from './dslr_variant.js';
import { createFilmVariant } from './film_variant.js';
import { filmExposureStrength } from './film_transport.js';
import { SensorExposureMaterial } from './sensor_exposure_material.js';
import { createSensorTexture,forIso,ISO_TEXTURE_BASE,ISO_TEXTURE_STOPS } from './sensor_texture.js';
import { createHostBridge,publishLoadingProgress } from './host_bridge.js';
import { createHeaderSampler,createInkSamplers } from './header_luminance.js';
import { applySceneTheme,styleContextLine,restyleContextLines } from './scene_theme.js';
import { cameraInteractions,nextCameraInteraction,interactionPrompts,canToggleInternalsLive } from './camera_interactions.js';
import { createLensMountCycle,lensMountPose } from './lens_mount_cycle.js';
import { pickLensTarget } from './lens_pick.js';
import { DEMOS,DEMO_SECONDS,DEMO_PAN,demoFrame,LESSONS,SHUTTER_MAX,ISO_MAX,SHUTTER_DEFAULT,LESSON_ISO_EXPOSURE,
  GAIN_SECONDS,shotOpen,shotSeconds,shotFrame,shotProgress,shotSweepScale,SHOT_LEAD,SHUTTER_CURTAIN_OPACITY,GLOW_OPEN_MAX } from './concept_demo.js';
import { SIDE_SECONDS,SIDE_REDUCED_SECONDS,SIDE_FILL,SIDE_FILL_Y,BEAM_OPACITY,sideViewDirection,sideViewPhase,beamBox,
  reducedCurtains,BEAM_LEAD,splitOffsets,biasedTarget } from './shutter_side_view.js';
import { BALANCE_DEMO,BALANCE_APERTURE_MAX,balanceShotFrame,balanceShotSeconds,balanceShotProgress,balanceExposure,
  balanceIntensity,balanceGlow,isBalanceSetting,BALANCE_CURTAIN_REST } from './balance_lesson.js';
import { stepAim,STEP_PART_FAR_SHARE,blendAim } from './framing_blend.js';
import { PART_NAMES,LABEL_ONLY_PARTS,tappablePartIds,TAP_LABEL_SECONDS,TAP_LABEL_FADE_SECONDS } from './part_names.js';
import { createGlideGroup,wrapDegrees } from './pose_glide.js';

const $ = id => document.getElementById(id);
// The marketing landing page embeds this page with its own overlay owning every
// gesture: no in-iframe chrome (scene.css) and no direct orbit, zoom or tap.
const landing = new URLSearchParams(location.search).get('landing') === '1';
document.documentElement.classList.toggle('landing',landing);
// This camera is procedural, rather than loaded from GLTF. Report its boot
// stages once the module dependencies arrive, then publish ready as before.
publishLoadingProgress('camera',{loaded:0,total:1});
document.documentElement.classList.toggle('embedded',new URLSearchParams(location.search).get('embedded')==='1');
let darkTheme = new URLSearchParams(location.search).get('theme') === 'dark';
// Flutter supplies its actual InkUI token. Standalone fallback mirrors InkUI.
const requestedInfo = new URLSearchParams(location.search).get('info');
const infoHex = /^[0-9a-f]{6}$/i.test(requestedInfo || '') ? requestedInfo : (darkTheme?'90cdf4':'5b8fb9');
const infoColor = new THREE.Color('#'+infoHex);
document.documentElement.style.setProperty('--accent','#'+infoHex);
// The warm light the shutter lesson's sensor builds toward: Flutter supplies
// InkUI's alert token (`warm`); the standalone fallback mirrors it.
const requestedWarm = new URLSearchParams(location.search).get('warm');
const warmColor = new THREE.Color('#'+(/^[0-9a-f]{6}$/i.test(requestedWarm || '') ? requestedWarm : (darkTheme?'fbd38d':'c9a227')));
// The shutter lesson's sensor blue: Flutter supplies InkUI's light a_infoFocus
// (`sensor`), the same blue as the 2D Shutter term's opening, in both themes.
const requestedSensor = new URLSearchParams(location.search).get('sensor');
const sensorBlue = /^[0-9a-f]{6}$/i.test(requestedSensor || '') ? '#'+requestedSensor : null;
if (darkTheme) {
  for (const [name, value] of Object.entries({bg:'#202322',fg:'#e1e4df',muted:'#9da39e',line:'#454b47'})) {
    document.documentElement.style.setProperty('--' + name, value);
  }
}
const hostTheme={};
for(const name of ['bg','fg','muted','line']){
  const value=new URLSearchParams(location.search).get(name);
  if(/^[0-9a-f]{6}$/i.test(value||'')){
    hostTheme[name]='#'+value;document.documentElement.style.setProperty('--'+name,hostTheme[name]);
  }
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const highlightFader=createHighlightFader(150);
let immediateHighlights=false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(hostTheme.bg||(darkTheme ? '#202322' : '#f5f5f4'));
const darkContextInk = new THREE.Color(hostTheme.fg || '#e5e5e5');
const camera = new THREE.PerspectiveCamera(35, 1, .1, 60);
camera.position.set(5.6, 3.4, 8.7);
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
// Flat printed parts: no scene lights, cast shadows or lighting-based tones.
renderer.shadowMap.enabled = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.domElement.setAttribute('aria-label','3D camera. Drag to rotate, or use Front and Angle buttons.');
renderer.domElement.setAttribute('role','img');
$('stage').prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
const BODY_TARGET = [0, .12, .4], BODY_MIN_DISTANCE = 4.2;
// Close enough for the blades to fill the view while staying in front of the
// lens's front element.
const LENS_MIN_DISTANCE = 1.6;
const LENS_FRONT_OFFSET = new THREE.Vector3(0, .18, 7.8);
controls.target.set(...BODY_TARGET);
controls.enablePan = false;
controls.enableZoom = true;
controls.minDistance = BODY_MIN_DISTANCE; controls.maxDistance = 20;
// Trackpad pinch uses Ctrl+wheel; ordinary wheel input should not resize the
// model while someone is trying to scroll the surrounding page.
renderer.domElement.addEventListener('wheel',event=>{
  if(!event.ctrlKey)event.stopImmediatePropagation();
},{capture:true,passive:true});
controls.minPolarAngle = .5; controls.maxPolarAngle = Math.PI * .62;
// Landing: the host's `viewport` commands still move the camera; direct input does not.
if(landing){controls.enableRotate=false;controls.enableZoom=false;}
controls.update();
// Part colors and instructional accents remain stable as the camera turns.
const material = color => createCameraPrintMaterial(color,infoColor);
const controlDialX=CAMERA_LAYOUT.opticalCenterX+
  CAMERA_LAYOUT.viewfinderWidth/2+CAMERA_LAYOUT.controlDialRadius+
  CAMERA_LAYOUT.controlDialClearance;
const bodyMat = material('#808080');
const gripMat = material('#555555');
const metalMat = material('#777777');
const barrelMat = material('#626262');
const glassMat = material('#4b4b4b');
const sensorMat = new SensorExposureMaterial('#b2b2b2',infoColor);
sensorMat.uniforms.exposureWarm.value.copy(warmColor);
// Exposure is the shutter lesson's additive white over the blue grain here too
// (Kent, October 11: the Lab's yellow wash was wrong). Only the concept loops
// and the ISO/balance lessons keep their own treatment (setDemo).
sensorMat.uniforms.exposureWhite.value=1;
if(sensorBlue)sensorMat.uniforms.sensorBlue.value.set(sensorBlue);
// The sensor's photosite texture (sensor_texture.js), one tile for every
// lesson; ISO brightens it and raises its contrast like grain.
{const {texture,mean}=createSensorTexture(THREE);sensorMat.setSensorTexture(texture,mean);}
// `gain` 0..1 spans ISO 100 ... 6400 (the lessons' and the Lab's gain).
function setSensorTextureGain(gain){
  const {brightness,contrast}=forIso(ISO_TEXTURE_BASE*2**(gain*ISO_TEXTURE_STOPS));
  sensorMat.uniforms.sensorTextureBrightness.value=brightness;sensorMat.uniforms.sensorTextureContrast.value=contrast;
}
const shutterMat = material('#393939', .6, .55);
// The sensor assembly's frame, housing and blades print the lens barrel's mid
// grey when not highlighted (Kent, October 11: they read black in the Lab).
// The highlighted blue state still follows each colour, so the lesson's
// striped curtains are unchanged.
const PRINT_GRAY_INK=.32; // domain: the lens barrel's printed grey
shutterMat.uniforms.grayInk.value=PRINT_GRAY_INK;

const model = new THREE.Group(); scene.add(model);
const registry=createPartRegistry();
const shell = registry.add('body','Camera body',model);
const lens = new THREE.Group(); model.add(lens);
const internals = new THREE.Group(); model.add(internals);
const lensBarrel=registry.add('lensBarrel','Lens barrel',lens);
const lensMountMark=registry.add('lensMountMark','Lens mounting mark',lensBarrel);
const shutterButton=registry.add('shutterButton','Shutter button',shell);
const controlDial=registry.add('controlDial','Control dial',shell);
const rearScreen=registry.add('rearScreen','Rear screen',shell);
const viewfinder=registry.add('viewfinder','Viewfinder',shell);
const rearControls=registry.add('rearControls','Rear controls',shell);
const lensMount=registry.add('lensMount','Lens mount',internals);
const mountMarks=registry.add('mountMarks','Mounting marks',lensMount);
const lensRelease=registry.add('lensRelease','Lens release',shell);
const sensor=registry.add('sensor','Sensor',internals);
const shutter=registry.add('shutter','Shutter',internals);
let dslr=null,film=null;
let onscreen=true,pausedAt=0,frameMetrics=null;
const isFilm=()=>Boolean(film)&&$('camera-model').value==='film';
const isSlr=()=>['dslr','film'].includes($('camera-model').value);
const recordingPart=()=>isFilm()?'filmStrip':'sensor';
const captureCaption=caption=>isFilm()?caption.replace(/sensor/gi,'film'):caption;
const smooth=value=>{const p=clamp(value);return p*p*p*(p*(p*6-15)+10);};
// Reduce the recording area and its curtain/frame together, without changing
// the optical axis or the sensor-to-shutter spacing inside the body.
sensor.scale.set(.8,.8,1);
shutter.scale.set(.8,.8,1);
// Keep the complete optical path clear of the forward grip.  The offset is
// shared by the lens, mount, sensor, shutter and release so reveal/capture
// animations continue to describe one aligned camera mechanism.
lens.position.x=CAMERA_LAYOUT.opticalCenterX;
internals.position.x=CAMERA_LAYOUT.opticalCenterX;
lensRelease.position.x=CAMERA_LAYOUT.opticalCenterX;
function mesh(geometry, mat, parent, x=0,y=0,z=0) {
  const m = new THREE.Mesh(geometry,mat); m.position.set(x,y,z);
  parent.add(m); return m;
}
function addTechnicalEdges(object,threshold=40) {
  const outline=new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry,threshold),
    new THREE.LineBasicMaterial({color:darkTheme?0xb8bdb8:0x303030,transparent:true,
      opacity:0,depthWrite:false}));
  outline.visible=false;outline.userData.contextOutline=true;object.add(outline);
  return object;
}
function addPrintedEdges(object,threshold=40){
  const outline=new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry,threshold),
    new THREE.LineBasicMaterial({color:0x242424,transparent:true,opacity:.88}));
  outline.userData.printOutline=true;object.add(outline);
  return object;
}
function roundedShape(w,h,r){
  const s = new THREE.Shape();
  s.moveTo(-w/2+r,-h/2); s.lineTo(w/2-r,-h/2);
  s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r); s.lineTo(w/2,h/2-r);
  s.quadraticCurveTo(w/2,h/2,w/2-r,h/2); s.lineTo(-w/2+r,h/2);
  s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r); s.lineTo(-w/2,-h/2+r);
  s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
  return s;
}
function printedPerimeter(shape,parent,z=0){
  const points=shape.getPoints(8),segments=[];
  for(let i=1;i<points.length;i++){
    segments.push(points[i-1].x,points[i-1].y,z,points[i].x,points[i].y,z);
  }
  const line=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute(segments,3)),new THREE.LineBasicMaterial({
      color:0x242424,transparent:true,opacity:.88,depthWrite:false,
    }));
  line.userData.printOutline=true;parent.add(line);
  return line;
}
function rounded(w,h,d,r,mat,parent,x=0,y=0,z=0) {
  const s=roundedShape(w,h,r);
  const mainBody=parent===shell && w===CAMERA_LAYOUT.bodyWidth;
  if(mainBody){
    const opening=new THREE.Path();
    opening.absarc(CAMERA_LAYOUT.opticalCenterX,0,CAMERA_LAYOUT.frontOpeningRadius,0,Math.PI*2,true);
    s.holes.push(opening);
  }
  const g = new THREE.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,steps:1,curveSegments:5});
  g.translate(0,0,-d/2);
  if(mainBody){
    // The rear is a separate single panel. Remove the duplicate rear cap
    // instead of covering it with another thick backing slab.
    const normals=g.attributes.normal,triangles=[];
    for(let i=0;i<normals.count;i+=3){
      if(normals.getZ(i)<-.999&&normals.getZ(i+1)<-.999&&normals.getZ(i+2)<-.999)continue;
      triangles.push(i,i+1,i+2);
    }
    g.setIndex(triangles);g.clearGroups();
  }
  const m=mesh(g,mat,parent,x,y,z);
  if(mainBody){
    printedPerimeter(roundedShape(w,h,r),m,d/2+.025).userData.slrFrontOutline=true;
  }else if(parent===shell || parent===viewfinder) {
    // Selective geometric edges, not a full-screen outline pass. Keep tiny
    // moving shutter blades and the sensor free of illustrative ink overlays.
    addPrintedEdges(m);
  }
  return m;
}
function cylinder(radius,depth,mat,parent,x=0,y=0,z=0) {
  const m = mesh(new THREE.CylinderGeometry(radius,radius,depth,48),mat,parent,x,y,z);
  m.rotation.x = Math.PI/2; return m;
}
function ring(radius,tube,mat,parent,x=0,y=0,z=0) {
  return mesh(new THREE.TorusGeometry(radius,tube,6,64),mat,parent,x,y,z);
}
function printedRing(radius,parent,x=0,y=0,z=0){
  const points=[];
  for(let i=0;i<64;i++)for(const step of [i,i+1]){
    const angle=step*Math.PI*2/64;
    points.push(Math.cos(angle)*radius,Math.sin(angle)*radius,0);
  }
  const line=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({
      color:0x303030,transparent:true,opacity:.55,depthWrite:false,
    }));
  line.position.set(x,y,z);parent.add(line);
  // Exterior detail only: omit these dense ridges from focused context views.
  return line;
}

const bodyZ=CAMERA_LAYOUT.bodyCenterZ;
const bodyRearZ=bodyZ-CAMERA_LAYOUT.bodyDepth/2-.025; // Include the shell bevel.
const body=rounded(CAMERA_LAYOUT.bodyWidth,2.45,CAMERA_LAYOUT.bodyDepth,.23,bodyMat,shell,0,0,bodyZ);
const grip=rounded(CAMERA_LAYOUT.gripWidth,2.2,.57,.18,gripMat,shell,CAMERA_LAYOUT.gripCenterX,-.06,.22);
const finderBody=rounded(CAMERA_LAYOUT.viewfinderWidth,.45,CAMERA_LAYOUT.bodyDepth,.12,bodyMat,viewfinder,CAMERA_LAYOUT.opticalCenterX,1.38,bodyZ);
rounded(.6,.12,.43,.025,metalMat,shell,CAMERA_LAYOUT.opticalCenterX,1.65,bodyZ);
// Extend the eyecup down over the rear body, keeping its top fixed. A taller
// rectangular window reads as a viewfinder rather than a narrow slot.
const finderEyecup=rounded(.82,.66,.06,.07,barrelMat,viewfinder,CAMERA_LAYOUT.opticalCenterX,1.205,bodyRearZ-.025);
const finderWindow=addTechnicalEdges(mesh(new THREE.BoxGeometry(.58,.40,.016),
  material('#303030'),viewfinder,CAMERA_LAYOUT.opticalCenterX,1.23,bodyRearZ-.076));
// Seat the release assembly on the top shell, behind the forward hand grip.
const releasePlate=rounded(.95,.08,.57,.08,bodyMat,shell,-1.43,1.25,bodyZ);
const release = addTechnicalEdges(cylinder(.17,.12,metalMat,shutterButton,-1.46,1.345,bodyZ));
release.rotation.x = 0;
const dial = addTechnicalEdges(cylinder(CAMERA_LAYOUT.controlDialRadius,.12,barrelMat,controlDial,controlDialX,1.32,bodyZ)); dial.rotation.x=0;
for(let i=0;i<28;i++) {
  const a=i*Math.PI*2/28;
  mesh(new THREE.BoxGeometry(.025,.12,.04),metalMat,controlDial,
    controlDialX+Math.cos(a)*.29,1.32,bodyZ+Math.sin(a)*.29);
}
// A simple rear screen makes the object legible when the learner rotates it.
const screenHousing=addPrintedEdges(rounded(2.3,1.5,.07,.07,barrelMat,rearScreen,CAMERA_LAYOUT.opticalCenterX,-.08,-.85));
addPrintedEdges(rounded(2.05,1.28,.025,.04,material('#202020'),rearScreen,CAMERA_LAYOUT.opticalCenterX,-.08,-.902));
// Photographer's right is negative model X when looking at the rear.
// These are illustrative controls, not a brand-specific button tutorial.
for(const y of [.73,.42]){
  addPrintedEdges(cylinder(.085,.055,barrelMat,rearControls,-1.46,y,-.902));
}
printedRing(.302,controlDial,controlDialX,1.381,bodyZ).rotation.x=-Math.PI/2;
addPrintedEdges(cylinder(.25,.055,barrelMat,rearControls,-1.46,-.18,-.902));
addPrintedEdges(cylinder(.09,.07,metalMat,rearControls,-1.46,-.18,-.924));
for(let i=0;i<4;i++){
  const a=i*Math.PI/2;
  cylinder(.025,.012,material('#b8b8b8'),rearControls,
    -1.46+Math.cos(a)*.17,-.18+Math.sin(a)*.17,-.941);
}
// One rear panel, with one meaningful perimeter in an internal view. The
// display and its surround remain separate parts attached to this panel.
const rearBacking=new THREE.Group(); shell.add(rearBacking);
const rearShape=roundedShape(CAMERA_LAYOUT.bodyWidth,2.45,.23);
const rearMaterial=bodyMat.clone();rearMaterial.side=THREE.DoubleSide;
const rearSkin=mesh(new THREE.ShapeGeometry(rearShape,8),rearMaterial,rearBacking,0,0,bodyRearZ);
printedPerimeter(rearShape,rearSkin);

// Bridge the front shell and barrel with a hollow mounting throat. Overlap
// both ends slightly so an inspection angle cannot reveal a floating gap.
const collarBack=bodyZ+CAMERA_LAYOUT.bodyDepth/2-.025;
const collarShape=new THREE.Shape();collarShape.absarc(0,0,1.10,0,Math.PI*2,false);
const collarBore=new THREE.Path();collarBore.absarc(0,0,.94,0,Math.PI*2,true);
collarShape.holes.push(collarBore);
const mountCollar=addPrintedEdges(mesh(new THREE.ExtrudeGeometry(collarShape,{
  depth:.25-collarBack,bevelEnabled:false,steps:1,curveSegments:48,
}),metalMat,lensMount,0,0,collarBack));
addTechnicalEdges(ring(1.06,.08,metalMat,lensMount,0,0,.19));
addTechnicalEdges(ring(.97,.035,barrelMat,lensMount,0,0,.22));
for(const a of [.6,2.2,3.7,5.3]) cylinder(.045,.045,metalMat,lensMount,Math.cos(a)*1.06,Math.sin(a)*1.06,.27);
// Schematic teaching cues: dot = insertion orientation, line = locked
// orientation. The second body cue is instructional, not a universal marking.
const insertAngle=Math.PI/3,lockedAngle=Math.PI/6,markRadius=1.23;
const markMaterial=material('#303030');
cylinder(.045,.006,markMaterial,mountMarks,
  Math.cos(insertAngle)*markRadius,Math.sin(insertAngle)*markRadius,.074);
const lockedMark=mesh(new THREE.BoxGeometry(.045,.12,.006),markMaterial,mountMarks,
  Math.cos(lockedAngle)*markRadius,Math.sin(lockedAngle)*markRadius,.074);
lockedMark.rotation.z=lockedAngle-Math.PI/2;
addTechnicalEdges(rounded(.15,.3,.08,.06,metalMat,lensRelease,1.25,-.45,.12));
// Seat the recording assembly near the rear shell. Keep both curtains and
// their frame at the same offset, immediately in front of the sensor.
const sensorCenterZ=bodyRearZ+.0575;
shutter.position.z=sensorCenterZ+.0725;
const sensorSurface=addTechnicalEdges(rounded(1.65,1.1,.02,.015,sensorMat,sensor,0,0,sensorCenterZ));
const sensorFrontZ=()=>{const g=sensorSurface.geometry;if(!g.boundingBox)g.computeBoundingBox();return g.boundingBox.max.z;};
const frameMat = material('#202020',.7,.3);
frameMat.uniforms.grayInk.value=PRINT_GRAY_INK;
// The bars' inner edges overlap the blades' edges by .005, so a closed
// curtain leaves no slot at any angle (Kent, October 11: a gap showed light
// along the top and bottom of the opening in the side view).
for (const [w,h,x,y] of [[1.86,.135,0,.6125],[1.86,.135,0,-.6125],[.14,1.15,-.89,0],[.14,1.15,.89,0]]) {
  addPrintedEdges(mesh(new THREE.BoxGeometry(w,h,.04),frameMat,shutter,x,y,.025));
}
// Each curtain is a stack of horizontal slats, as a real focal-plane shutter's
// blades are (Kent, October 7): alternate slats print one ink lighter, so the
// stripes read and travel with the curtain.
const shutterSlatMat = material('#5c5c5c');
shutterSlatMat.uniforms.grayInk.value=PRINT_GRAY_INK;
const blades = [[],[]];
for(let curtain=0;curtain<2;curtain++) {
  for(let i=0;i<6;i++) {
    blades[curtain].push(addPrintedEdges(mesh(new THREE.BoxGeometry(1.65,1,.008),
      i%2?shutterSlatMat:shutterMat,shutter,0,0,curtain*.015)));
  }
}
function setExposure(value, updateCaption=true,recordFilm=false) {
  // Only an executing shutter cycle records stock. Scrubbing, fitting and
  // inspection call this without recordFilm and remain purely observational.
  if(recordFilm&&value>.1&&isFilm())film.exposeGate(filmExposureStrength(value));
  if(recordFilm&&!isFilm())sensorSurface.material.uniforms.sensorExposure.value=filmExposureStrength(value);
  else if(!recordFilm&&value===0)sensorSurface.material.uniforms.sensorExposure.value=0;
  const state=setShutter(value);lightOnSensor(state);
  $('time').value=value;
  if(updateCaption) {
    $('caption').textContent=captureCaption(state.caption);
    highlightPart(interactionId==='mirror'?'reflexMirror':value>=.3 && value<.65?recordingPart():'shutter');
  }
  renderer.domElement.setAttribute('aria-label','3D camera. '+captureCaption(state.caption));
}
// The digital model's light overlay outside the lessons' own shots: white
// light lies on the sensor wherever the curtains leave it uncovered, so the
// Lab, the aperture lesson and the concept loops show light arriving the same
// way the shutter lesson does. The recording still develops evenly (z = 0).
function lightOnSensor(curtains){
  const u=sensorSurface.material.uniforms,open=curtains.first>curtains.second;
  u.sensorSweep.value.set(open?curtains.first:0,open?curtains.second:0,0);
  u.sensorGlow.value=open&&!reduced.matches?GLOW_OPEN_MAX:0;
}
// Release, mirror and curtains only: concept loops drive these every frame
// without touching the timeline input, captions or sensor. Lesson shots pass
// their own curtain positions so a fast slit can cross with both curtains.
function setShutter(value,curtains) {
  const state = captureState(value), h=1.1, top=h/2, step=h/6;
  curtains??=state;
  release.position.y=1.345-.035*smooth(value/.035)*(1-smooth((value-.07)/.06));
  // The reflex mirror clears before the first curtain moves and returns
  // only after the second curtain has covered the recording area.
  dslr?.setMirrorRaised(smooth(value/.08)*(1-smooth((value-.9)/.1)));
  for(let c=0;c<2;c++) for(let i=0;i<6;i++) {
    // Crop each physical blade at the frame opening. Curtains travel in the
    // same direction, not two halves opening away from one another.
    const start = c===0 ? top-curtains.first*h-i*step : top+h-curtains.second*h-i*step;
    // Adjacent blades touch (no seam for light to pass at an angle).
    const hi = Math.min(top,start), lo = Math.max(-top,start-step);
    const b=blades[c][i]; b.visible=hi>lo;
    // Mechanism state owns this flag; highlighting must never restore an old
    // curtain arrangement from the material/context snapshot.
    b.userData.mechanismVisible=b.visible;
    if(b.visible) { b.scale.y=hi-lo; b.position.y=(hi+lo)/2; }
  }
  return state;
}
setExposure(0,false);
const barrelBody=addTechnicalEdges(cylinder(1,.92,barrelMat,lensBarrel,0,0,.66));
for(let i=0;i<15;i++){
  ring(1.015,.018,barrelMat,lensBarrel,0,0,.3+i*.053);
  printedRing(1.034,lensBarrel,0,0,.3+i*.053);
}
// A printed stripe hugs the lens barrel and its shallow ridges. It belongs
// to the lens, so a future mounting interaction can turn it with the lens.
const markVertices=[],markIndices=[];
for(let i=0;i<=48;i++){
  const z=.27+i*.14/48;
  let radius=1;
  for(let ridge=0;ridge<15;ridge++){
    const distance=z-(.3+ridge*.053);
    if(Math.abs(distance)<.018)radius=Math.max(radius,1.015+Math.sqrt(.018**2-distance**2));
  }
  for(const offset of [-.035,.035]){
    const angle=lockedAngle+offset;
    markVertices.push(Math.cos(angle)*(radius+.002),Math.sin(angle)*(radius+.002),z);
  }
  if(i<48){const a=i*2;markIndices.push(a,a+1,a+2,a+1,a+3,a+2);}
}
const lensMarkGeometry=new THREE.BufferGeometry().setAttribute('position',
  new THREE.Float32BufferAttribute(markVertices,3)).setIndex(markIndices);
lensMarkGeometry.computeVertexNormals();
const lensMarkMaterial=markMaterial.clone();lensMarkMaterial.side=THREE.DoubleSide;
mesh(lensMarkGeometry,lensMarkMaterial,lensMountMark);
ring(.98,.038,metalMat,lensBarrel,0,0,1.16);
printedRing(1.019,lensBarrel,0,0,1.16);
addTechnicalEdges(cylinder(.86,.14,barrelMat,lensBarrel,0,0,1.19));
cylinder(.74,.022,glassMat,lensBarrel,0,0,1.276);
ring(.65,.009,metalMat,lensBarrel,0,0,1.293);
cylinder(.51,.014,material('#282828',.17,.55),lensBarrel,0,0,1.294);
// One lens rig for the lab and the landing page: the landing shows the lab's solid
// ring, blades, aperture roll and focus pull exactly as the lab draws them.
const lensRig=buildLensAssembly(registry,lens,material);
lensRig.focus.visible=false;lensRig.zoom.visible=false;lensRig.iris.visible=false;
dslr=createDslrVariant({registry,shell,internals,lens,lensMount,lensRelease,grip,
  finderBody,material,addPrintedEdges});
film=createFilmVariant({registry,model,shell,body,rearBacking,rearScreen,rearControls,
  sensor,filmZ:sensorCenterZ,material,addPrintedEdges});

let inside=false,revealing=false,study='camera',focusedPart='shutterButton',animation=null,raf=0,disposed=false,renderedFrames=0;
let interactionLocked=false,manualViewEpoch=0;
let revealAmount=0,dissolve=null,sceneTransition=null,filmDoorMoving=null,zoomAnimation=null,solidRevealState=null;
let hostBridge=null,lastHostState='',lastHostStatus='',lastHostPublish=-Infinity;
// The host's `poseTo` glide (see pose_glide.js); its state rides every host publish.
const glides=createGlideGroup(()=>publishHost(true)),poseGlide=glides.channel('pose');
// Landing only (r9, Kent: "Add zoom controls for the labs."): the visitor's zoom is the projection's zoom (about the
// view's center, so the tour's orbit, dolly and view offset run on under it), on its own glide group.
const landingZoomGroup=createGlideGroup(),landingZoomGlide=landingZoomGroup.channel('viewZoom');
const LANDING_VIEW_ZOOM=[.5,3]; // domain: landing view zoom bounds, a multiplier on the tour's framing
function setLandingViewZoom(z){camera.zoom=z;camera.updateProjectionMatrix();}
// Landing only: the tour's lens, mm on a full frame (24 mm tall; the lab's own 35 degree view is about 38 mm). The host
// dollies out to match (timeline.js K.CAMERA_LENS_MM), so the dolly limit moves out with the lens and a pinch out still
// pulls back from the tour's framing.
const VIEW_FOV=camera.fov,VIEW_MAX_DISTANCE=controls.maxDistance;
function setLandingFocalLength(mm){
  if(typeof mm!=='number'||!Number.isFinite(mm)||mm<=0)return;
  camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(12/mm));camera.updateProjectionMatrix();
  controls.maxDistance=VIEW_MAX_DISTANCE*Math.tan(THREE.MathUtils.degToRad(VIEW_FOV/2))/Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  invalidate();
}
function landingZoomTo(value){
  const z=value?.zoom,ms=value?.ms;
  if(typeof z!=='number'||!Number.isFinite(z))return;
  const to=THREE.MathUtils.clamp(z,...LANDING_VIEW_ZOOM),dur=typeof ms==='number'&&Number.isFinite(ms)&&ms>0&&!reduced.matches?ms:0;
  if(!dur){landingZoomGlide.cancel();setLandingViewZoom(to);invalidate();return;}
  landingZoomGlide.start({z:camera.zoom},{z:to},dur,performance.now());invalidate();
}
let hostPaused=false;
let viewPreset='angle';
// Exploration never advances the tutorial or changes its orbit framing.
let explorationInternals=false;
let interactionId=null,interactionStatus='intro',interactionPhase=null,restoreInteraction=null;
let mountCycle=null,mountProgress=0;
// Concept loop ('shutter' | 'iso'): a fixed x-ray pose replaying one story.
// Lesson ('shutter-lesson' | 'iso-lesson'): the same pose, driven by `setting`.
let demoKind=null,demoComplete=false,demoPoints=[],lessonViewAnimation=null;
const demoSample={value:0,light:0,exposure:0,gain:0,pan:0};
let lessonSetting=0,lessonElapsed=0,lessonShotGeneration=0,lessonCurtainOpacity=1,shotStartExposure=0;
const shotSample={value:0,first:0,second:0,front:0,back:0,light:0,exposure:0,opacity:1,share:0,glow:0,scale:0},
  isLesson=()=>LESSONS.includes(demoKind)||demoKind===BALANCE_DEMO,isBalance=()=>demoKind===BALANCE_DEMO;
// Balance lesson ('balance-lesson'): the iris and the shutter speed the host
// shows (lesson indices, balance_lesson.js) and the pair the last shot used.
const balance={a:3,s:7,shotA:3,shotS:7};
// Distinguishes a replacement page so the host can resend its setting.
const hostInstance=Math.random().toString(36).slice(2);
// The callout target is a single phase-specific part. Film lesson sections
// can keep several controls visually highlighted while that target changes.
// Keep this separate so animation samples do not make the blue ink flicker.
let visualHighlightIds=[];
// The host can turn the blue treatment off while keeping the part solid (the
// aperture lesson's f-number page shows the iris in its plain grey).
let blueHighlight=true;
const filmMacroPhases={
  load:{thread:['filmBack',interactionPrompts.load],close:['filmBack',interactionPrompts.close],
    advance:['filmAdvance',interactionPrompts.advance],release:['shutterButton',interactionPrompts.release]},
  rewind:{release:['filmRewindRelease',interactionPrompts.rewind],unfold:['filmRewind',interactionPrompts.unfold],
    wind:['filmRewind',interactionPrompts.wind],open:['filmBack',interactionPrompts.unload]},
};
const isFilmMacro=()=>isFilm()&&Boolean(filmMacroPhases[interactionId]);
function currentInteraction(){
  const step=cameraInteractions($('camera-model').value).find(step=>step.id===interactionId)??null;
  const phase=filmMacroPhases[interactionId]?.[interactionPhase];
  return step&&phase?{...step,phase:interactionPhase,target:phase[0],prompt:phase[1]}:step;
}
// The lens pose (apertureRect, pose) changes with every orbit frame, and only a host that
// places things on the iris reads it: the aperture lesson, which sends the lessonViewport command.
// The lab never asks, so its state stays still while the camera orbits.
let lensPoseRequested=false;
// Landing (r9, Kent: "a flicker jump at the very beginning of the camera lab"): the frame count when the host's
// lensView last set the pose; the state's posed is true once a frame has been drawn after it, so the page swaps its
// poster for this canvas only when the canvas shows the act's opening pose, never this page's default view.
let landingPosedFrame=-1;
// The view distance to 1e-3, so float noise from orbit damping is not a new state.
const roundView=n=>Math.round(n*1000)/1000;
// Whether the cutaway toggle may switch under the motion now playing.
const internalsToggleLive=()=>canToggleInternalsLive({status:interactionStatus,locked:interactionLocked,
  animating:animation,dissolving:sceneTransition||solidRevealState,revealing});
// Switches the cutaway under a running exploration demo: the same state the
// dissolving toggle ends in, set at once. The animation (its clock, its done
// callback and the lock) is not touched, so the motion plays on uninterrupted.
function applyInternalsState(next){
  explorationInternals=next;inside=next;
  immediateHighlights=true;
  try{showContextGeometry();highlightPart(focusedPart);highlightFader.finish();}finally{immediateHighlights=false;}
}
// The cutaway crossfades on its own clock (`internalsFade`), the same 500 ms
// smooth dissolve as when idle. The motion never writes it: render() composes
// both passes over whatever pose the motion has drawn this frame. A second tap
// mid-fade reverses from the amount now shown. Reduced motion cuts.
const INTERNALS_FADE_MS=500;
let internalsFade=null;
function internalsFadeAmount(now=performance.now()){
  if(!internalsFade)return 0;
  const f=internalsFade,p=clamp((now-f.start)/INTERNALS_FADE_MS);
  return THREE.MathUtils.lerp(f.from,f.to,smooth(p));
}
function finishInternalsFade(){
  if(!internalsFade)return;
  const to=internalsFade.to;internalsFade=null;disposeDissolve();applyInternalsState(to===1);invalidate();
}
function setInternalsLive(next){
  if(reduced.matches){internalsFade=null;disposeDissolve();applyInternalsState(next);invalidate();return;}
  const from=internalsFade?internalsFadeAmount():(explorationInternals?1:0);
  internalsFade={from,to:next?1:0,start:performance.now()};
  explorationInternals=next;
  dissolve??=createSceneDissolve(renderer,scene);
  invalidate();
}
function getHostState(){
  const time=Number($('time').value);
  const capture=$('capture').textContent==='Pause'?'playing':
    ($('capture').textContent==='Take a photo'?'idle':(time>=1?'complete':'paused'));
  const interaction=currentInteraction();
  // The landing page swaps its poster for this page the moment it is ready, so it must have drawn a frame first.
  return {ready:!disposed&&$('loading').hidden&&(!landing||renderedFrames>0),
    ...(landing?{posed:landingPosedFrame>=0&&renderedFrames>landingPosedFrame}:{}),busy:interactionLocked||interactionStatus==='running',
    solidReveal:Boolean(solidRevealState),glide:glides.state(),
    canSkipMirror:canSkipMirrorObservation(),
    ...(headerSampler.value===null?{}:{headerLuminance:headerSampler.value}),
    ...(inkSampler.values?{inkLuminance:inkSampler.values}:{}),
    internalsVisible:explorationInternals,canToggleInternals:internalsToggleLive(),orbitTarget:controls.target.toArray(),
    interaction,interactionStatus,interactions:cameraInteractions($('camera-model').value),callout:getCallout(),
    ...(study==='lens'&&lensPoseRequested?getLensPoseState():{}),
    model:$('camera-model').value,view:viewPreset,study,inside,capture,time,
    aperture:Number($('aperture').value),focus:Number($('focus').value),
    zoom:Number($('zoom').value),part:focusedPart,
    zoomDistance:roundView(controls.getDistance()),canZoomIn:controls.getDistance()>controls.minDistance+.001,
    canZoomOut:controls.getDistance()<controls.maxDistance-.001,demo:demoKind,demoComplete,
    ...(isLesson()?{setting:lessonSetting,instance:hostInstance}:{}),
    ...(demoKind==='iso-lesson'?getSensorRectState():{}),
    ...(isBalance()?{...getSensorRectState(),...getBalanceState()}:{}),
    ...(demoKind==='shutter-lesson'?{...getShutterRectState(),...getSensorRectState(),lessonShotGeneration,
      sideView:side.phase,sideViewDone:side.phase==='side',
      exposureProgress:lessonShotGeneration===0?1:shotProgress(lessonSetting,lessonElapsed)}:{}),
    ...(isFilm()?{film:film.getState()}:{})};
}
function publishHost(immediate=false){
  if(!hostBridge)return;
  const state=getHostState(),encoded=JSON.stringify(state);
  if(encoded===lastHostState)return;
  const {time,film:filmState,...status}=state;
  if(filmState){const {travel,leader,load,backOpen,progress,wrap,exposureStrengths,...filmStatus}=filmState;status.film=filmStatus;}
  const statusKey=JSON.stringify(status),now=performance.now();
  // Callout projection and view distance are part of status: every changed
  // rendered pose passes immediately, including zoom in the label-free intro.
  // Only timeline progression is throttled, never moving labels or gestures.
  if(!immediate&&statusKey===lastHostStatus&&now-lastHostPublish<100)return;
  lastHostState=encoded;lastHostStatus=statusKey;lastHostPublish=now;
  hostBridge.publish();
}
function onHostCommand({action,value}){
  // Aperture lesson: where its touch box sits in this (larger) canvas, and
  // its start pose of the lens study. Nothing else sends these.
  if(action==='headerBand'){if(!disposed&&headerSampler.setBand(value))invalidate();return;}
  if(action==='inkBands'){if(!disposed&&inkSampler.setBands(value))invalidate();return;}
  if(action==='lessonViewport'){if(!disposed)setLessonViewport(value);return;}
  if(action==='lensView'){if(!disposed&&!demoKind)lensView(value);publishHost(true);return;}
  // The shutter and ISO lessons' first camera pages reveal their part the
  // same way.
  if(action==='solidReveal'){if(!disposed&&(!demoKind||isLesson()))solidReveal(value);publishHost(true);return;}
  // Landing page: glide the orbit to a pose, and freeze or continue the frames
  // (any glide, reveal or fade holds where it is, then picks up).
  if(action==='poseTo'){if(!disposed)poseTo(value);publishHost(true);return;}
  if(action==='viewZoom'&&landing){if(!disposed)landingZoomTo(value);return;}
  if(action==='focalLength'&&landing){if(!disposed)setLandingFocalLength(value);return;}
  // Landing only: the visitor's body choice swaps the body in place, the tour's view kept.
  if(action==='model'&&landing){if(!disposed)landingModel(value);publishHost(true);return;}
  // Landing only: the lens study's body from solid (0) to its wire sketch (1), as the tour's clock says.
  if(action==='xray'&&landing){if(!disposed)setLandingXray(value);return;}
  // Landing only: the tour step's part (solid inside the wire body), its shutter cycle and its
  // lens groups, set directly (no lab caption, and the slider never moves the part).
  if(action==='part'&&landing){if(!disposed)setLandingPart(value);return;}
  if(landing&&['exposure','aperture','focus','zoom'].includes(action)&&typeof value==='number'&&Number.isFinite(value)){
    if(!disposed)setLandingScalar(action,clamp(value));return;
  }
  if(action==='pause'||action==='resume'){setHostPaused(action==='pause');publishHost(true);return;}
  if(action==='highlight'&&typeof value==='boolean'){
    if(!disposed){blueHighlight=value;setVisualHighlights([focusedPart]);}
    publishHost(true);return;
  }
  // A concept loop owns the scene until the host sends demo:null. Lessons
  // also take the learner's `setting` detent.
  if(action==='demo'){if(!disposed)setDemo(value);return;}
  if(action==='setting'&&isLesson()&&!isBalance()){if(!disposed)applySetting(value);return;}
  // Balance lesson: `balance` {a, s} shows the iris (and records the linked
  // shutter speed) without a shot; `fire` {a, s} takes one shot at that pair
  // on a cleared sensor.
  if(action==='balance'&&isBalance()){if(!disposed)setBalance(value);publishHost(true);return;}
  if(action==='fire'&&isBalance()){if(!disposed)fireBalance(value);return;}
  if(isLesson()&&!disposed){
    if(action==='viewport'&&['orbit','zoom'].includes(value?.kind)){handleViewport(value);return false;}
    if(action==='zoomView'&&['in','out'].includes(value)){zoomView(value);return;}
    if(action==='view'&&['front','angle','rear'].includes(value)){lessonFrontView();return;}
    // The shutter lesson's side view: true turns to it, false returns.
    if(action==='shutterSideView'&&typeof value==='boolean'){setSideView(value);publishHost(true);return;}
  }
  if(demoKind)return;
  if(!disposed&&action==='explore'){
    if(mountCycle){animation=null;restoreMountCycle();lockInteraction(false);}
    settleInteraction();abandonFilmMacro();lockInteraction(false);
    transitionScene(configureIntro,700,()=>publishHost(true));return;
  }
  if(!disposed&&(action==='interaction'||action==='next'||action==='start')){
    if(action==='interaction')selectInteraction(value);
    else if(action==='next'&&!interactionLocked&&currentInteraction()?.slider)advanceInteraction();
    else if(action==='start'&&!interactionLocked&&interactionStatus==='intro')selectInteraction(cameraInteractions($('camera-model').value)[0].id);
    publishHost(true);return;
  }
  if(disposed)return;
  if(action==='viewport'){
    handleViewport(value);
    // Orbit/pinch bursts share the renderer's existing invalidation RAF, so
    // Flutter receives only the pose actually drawn, not intermediate poses.
    if(value?.kind==='orbit'||value?.kind==='zoom')return false;
    publishHost(true);return;
  }
  if(action==='zoomView'&&['in','out'].includes(value)){zoomView(value);publishHost(true);return;}
  // The cutaway also switches while an exploration demo plays.
  if(action==='internals'&&internalsToggleLive()){
    setInternalsLive(typeof value==='boolean'?value:!explorationInternals);
    publishHost(true);return;
  }
  // The iris keeps following the host's detent while a reveal flies in.
  if(interactionLocked&&!(solidRevealState&&action==='aperture'))return;
  if(action==='internals'&&interactionStatus==='intro'){
    transitionScene(()=>{
      explorationInternals=typeof value==='boolean'?value:!explorationInternals;inside=explorationInternals;
      if(explorationInternals&&isFilm()&&!film.getState().loaded)seedFilmStep('capture');
      showContextGeometry();highlightPart(null);
    },500,()=>publishHost(true));return;
  }
  if(action==='activate'){
    if(interactionStatus==='ready')triggerInteraction();
    publishHost(true);return;
  }
  const click=id=>{if(!$(id).disabled)$(id).click();};
  const input=(id,next,event='input')=>{
    if($(id).disabled)return;
    $(id).value=next;$(id).dispatchEvent(new Event(event,{bubbles:true}));
  };
  if(action==='model'&&['mirrorless','dslr','film'].includes(value))input('camera-model',value,'change');
  else if(action==='study'&&['camera','lens','mount',...(isFilm()?['film']:[])].includes(value))click('study-'+value);
  else if(action==='view'&&['front','angle','rear'].includes(value))click(value);
  else if(action==='lensPart'&&study==='lens'&&['aperture','focus','zoom'].includes(value)){
    const part={aperture:'aperture',focus:'focusGroup',zoom:'zoomGroup'}[value];
    if(focusedPart!==part)transitionScene(()=>highlightPart(part),400);
  }
  else if(action==='reveal'&&study==='camera')click('open');
  else if(action==='capture'&&study==='camera')click('capture');
  else if(['time','aperture','focus','zoom'].includes(action)&&typeof value==='number'&&Number.isFinite(value)){
    if(action==='time'?(study==='camera'&&inside):study==='lens')input(action,clamp(value));
  }else if(action==='mount'&&study==='mount'&&['marks','release'].includes(value)){
    click(value==='marks'?'mount-mark':'mount-release');
  }else if(action==='film'&&isFilm()&&study==='film'&&['load','advance','rewind','back','release'].includes(value)){
    click('film-'+value);
  }
  publishHost(true);
}
function render() {
  if(disposed || document.hidden) return;
  // A reveal whose animation was cancelled elsewhere lands on its focus view.
  if(solidRevealState&&animation?.reveal!==solidRevealState)finishSolidReveal(solidRevealState);
  const fadeAmount=internalsFade?internalsFadeAmount():-1;
  if(internalsFade&&fadeAmount===internalsFade.to)finishInternalsFade();
  if(inside||revealing||study!=='camera')lensRig.updateContextOutlines(camera);
  if(internalsFade){
    const target=internalsFade.to===1;
    dissolve??=createSceneDissolve(renderer,scene);
    dissolve.render(scene,camera,fadeAmount,
      ()=>{applyInternalsState(false);lensRig.updateContextOutlines(camera);},
      ()=>{applyInternalsState(true);lensRig.updateContextOutlines(camera);});
    explorationInternals=inside=target;
    invalidate();
  }else if(solidRevealState&&solidRevealState.amount<1){
    // Both passes draw the revealed part solid; only the body changes.
    const s=solidRevealState;
    if(s.amount<=0){applyPartContext(null,0);renderer.render(scene,camera);}
    else (dissolve??=createSceneDissolve(renderer,scene)).render(scene,camera,s.amount,
      ()=>applyPartContext(null,0),()=>applyPartContext(s.part,1));
  }else if(sceneTransition){
    dissolve??=createSceneDissolve(renderer,scene);
    const a=sceneTransition;
    dissolve.render(scene,camera,a.amount,
      ()=>{a.before();lensRig.updateContextOutlines(camera);},
      ()=>{a.after();lensRig.updateContextOutlines(camera);});
  }else if(landingPartFade){
    const a=landingPartFade,p=landingPartFadeAmount();
    if(p>=1){finishLandingPartFade();lensRig.updateContextOutlines(camera);renderer.render(scene,camera);}
    else{
      (dissolve??=createSceneDissolve(renderer,scene)).render(scene,camera,p,
        ()=>{a.before();lensRig.updateContextOutlines(camera);},
        ()=>{a.after();lensRig.updateContextOutlines(camera);});
      invalidate();
    }
  }else if(landing&&landingXray!==null&&landingXray<1&&study==='lens'){
    // The landing's x-ray beat: the reveal's own two-pass dissolve, driven by the tour.
    const part=focusedPart??'aperture';
    if(landingXray<=0){applyPartContext(null,0);renderer.render(scene,camera);}
    else (dissolve??=createSceneDissolve(renderer,scene)).render(scene,camera,landingXray,
      ()=>applyPartContext(null,0),()=>applyPartContext(part,1));
  }else if(revealing&&revealAmount>0&&revealAmount<1){
    dissolve??=createSceneDissolve(renderer,scene);
    dissolve.render(scene,camera,revealAmount,
      ()=>{applyPartContext(null,0);setCameraGeometryVisibility();},
      ()=>{showContextGeometry();applyPartContext('shutter');});
  }else renderer.render(scene,camera);
  headerSampler.sample();
  inkSampler.sample();
  // Concept loops publish only at start and finish. Two may run on one phone
  // screen, so skip the per-frame inspection metrics and host state.
  if(demoKind){renderedFrames++;if(isLesson())publishHost();hostBridge?.flush();return;}
  syncZoomControls();
  // `context` and `rendering` walk the whole scene; they are computed only
  // when the metrics are read (tests and authoring), not on every frame.
  frameMetrics={renderedFrames:++renderedFrames,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,
    geometries:renderer.info.memory.geometries,pixelRatio:renderer.getPixelRatio(),inside,study,
    cameraQuaternion:camera.quaternion.toArray(),cameraPosition:camera.position.toArray(),cameraTarget:controls.target.toArray(),
    viewRadius:camera.position.distanceTo(controls.target),transitioning:Boolean(sceneTransition)||revealing,
    internalsFade:internalsFade?fadeAmount:null,
    focusedPart,visualHighlightIds:[...visualHighlightIds],
    partIds:registry.ids(),apertureOpening:lensRig.iris.userData.opening,
    focusPosition:lensRig.focus.position.z,zoomPosition:lensRig.zoom.position.z};
  publishHost();hostBridge?.flush();
}
Object.defineProperty(window,'focal3dMetrics',{configurable:true,enumerable:true,
  get(){return frameMetrics&&{...frameMetrics,rendering:getRenderState(),context:getContextState(),
    filmStrip:isFilm()?getPartRenderState('filmStrip'):null};}});
// Pause while the iframe is scrolled away or covered: stop the frame loop,
// hold every running animation, and resume it where it stopped.
function invalidate() { if(!raf && !document.hidden && onscreen && !hostPaused && !disposed) raf=requestAnimationFrame(tick); }
// The brightness of the frame behind the lab's header (the host sends its band).
const headerSampler=createHeaderSampler(renderer,{onDue:()=>invalidate(),onValue:()=>publishHost()});
// The same, for each plateless control (the host sends `inkBands`).
const inkSampler=createInkSamplers(renderer,{onDue:()=>invalidate(),onValue:()=>publishHost()});
// Frames run only while the page is on screen and the host has not paused it.
let framesRunning=true;
function syncFrames(){
  const run=onscreen&&!hostPaused;
  if(run===framesRunning||disposed)return;
  framesRunning=run;
  if(!run){pausedAt=performance.now();highlightFader.pause(pausedAt);if(raf)cancelAnimationFrame(raf);raf=0;return;}
  const gap=performance.now()-pausedAt;
  // Shift each animation by only the time it was actually paused: one begun
  // before the pause lost `gap`; one begun while hidden starts from now.
  const resumedAt=performance.now();
  highlightFader.resume(resumedAt);
  for(const running of [animation,zoomAnimation,lessonViewAnimation,internalsFade]){
    if(!running)continue;
    running.start=running.start>=pausedAt?resumedAt:running.start+gap;
  }
  glides.shiftAll(pausedAt,resumedAt);landingZoomGroup.shiftAll(pausedAt,resumedAt);
  invalidate();
}
function setHostPaused(next){hostPaused=next;syncFrames();}
new IntersectionObserver(entries=>{
  const next=entries[entries.length-1].isIntersecting;
  if(next===onscreen||disposed)return;
  onscreen=next;syncFrames();
}).observe(document.documentElement);
// Feedback mode draws this view into its app snapshots, which cannot see
// iframes: render now and hand back the canvas, read in the same task.
window.focalSnapshotCanvas=()=>{if(disposed||document.hidden)return null;render();return renderer.domElement;};
function getRenderState(){
  let lights=0,litMaterials=0;
  scene.traverse(object=>{
    if(object.isLight)lights++;
    if(object.isMesh&&!object.material.isMeshBasicMaterial)litMaterials++;
  });
  return {lights,litMaterials,shadowMapEnabled:renderer.shadowMap.enabled};
}
function getModelLayout(){
  model.updateMatrixWorld(true);
  const bounds=object=>{
    const box=new THREE.Box3().setFromObject(object,true);
    return {min:box.min.toArray(),max:box.max.toArray()};
  };
  return {variant:dslr.getLayout(),film:film.getLayout(),body:bounds(body),grip:bounds(grip),releasePlate:bounds(releasePlate),release:bounds(release),
    dial:bounds(controlDial),viewfinder:bounds(finderBody),viewfinderWindow:bounds(finderWindow),
    viewfinderEyecup:bounds(finderEyecup),
    sensor:bounds(sensorSurface),sensorExposure:sensorSurface.material.uniforms.sensorExposure.value,shutter:bounds(shutter),rearSkin:bounds(rearSkin),
    mountCollar:bounds(mountCollar),barrel:bounds(barrelBody),
    collarBlocksAxis:new THREE.Raycaster(new THREE.Vector3(lens.position.x,0,2),
      new THREE.Vector3(0,0,-1)).intersectObject(mountCollar,false).length>0,
    screen:bounds(screenHousing),rearControls:bounds(rearControls),lensRelease:bounds(lensRelease),
    opticalCenterX:lens.position.x};
}
function getLensMountState(){
  model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const position=object=>object.getWorldPosition(new THREE.Vector3()).toArray();
  const stripeMesh=lensMountMark.children[0],attribute=stripeMesh.geometry.attributes.position;
  const stripe=new THREE.Vector3();
  for(let i=0;i<attribute.count;i++)stripe.add(new THREE.Vector3().fromBufferAttribute(attribute,i));
  stripe.divideScalar(attribute.count).applyMatrix4(stripeMesh.matrixWorld);
  const points=[...partWorldPoints(lens,false),...partWorldPoints(shell,false),
    ...(isFilm()?partWorldPoints(film.filmBody,false):[])].map(point=>point.project(camera));
  return {progress:mountProgress,...lensMountPose(mountProgress,{angle:insertAngle-lockedAngle}),
    lensPosition:lens.position.toArray(),lensQuaternion:lens.quaternion.toArray(),releasePosition:lensRelease.position.toArray(),
    mountPosition:position(lensMount),stripe:stripe.toArray(),insertMark:position(mountMarks.children[0]),lockedMark:position(lockedMark),
    optics:[lensRig.iris,lensRig.focus,lensRig.zoom].map(object=>({position:position(object),quaternion:object.getWorldQuaternion(new THREE.Quaternion()).toArray()})),
    barrelHighlight:barrelBody.material.uniforms.highlight.value,
    stripeHighlight:stripeMesh.material.uniforms.highlight.value,
    bodyMarkHighlights:mountMarks.children.filter(object=>object.isMesh).map(object=>object.material.uniforms.highlight.value),
    projected:{left:(Math.min(...points.map(p=>p.x))+1)/2,right:(Math.max(...points.map(p=>p.x))+1)/2,
      top:(1-Math.max(...points.map(p=>p.y)))/2,bottom:(1-Math.min(...points.map(p=>p.y)))/2}};
}
// An authoring hook supports exact, same-pose visual comparisons in the
// browser regression test. It has no learner-facing control or copy.
window.focal3dAuthor=Object.freeze({command:(action,value)=>onHostCommand({action,value}),getProgramCount:()=>renderer.info.programs.length,getContextState,getModelLayout,getLensMountState,getPartOutlineCount,getShutterCoverage,
  // The camera as last drawn (degrees, scene units) and the frame count: the landing's motion probe reads it per frame.
  getPose:()=>{
    const o=camera.position.clone().sub(controls.target),d=o.length()||1,v=camera.view;
    return {frame:renderedFrames,azimuth:THREE.MathUtils.radToDeg(Math.atan2(o.x,o.z)),
      elevation:THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(o.y/d,-1,1))),distance:d,
      target:controls.target.toArray(),offsetX:v?.enabled?v.offsetX/v.fullWidth:0,zoom:camera.zoom};
  },
  // The curtain opening's four corners and the middle of the shutter-sensor
  // gap, in the canvas's CSS pixels (the closed-curtain pixel check).
  // Turns the view to `deg` degrees off the lens axis at the same distance and
  // height (the closed-curtain pixel check sweeps it).
  setViewYaw:deg=>{
    const d=camera.position.clone().sub(controls.target),r=Math.hypot(d.x,d.z),a=THREE.MathUtils.degToRad(deg);
    camera.position.set(controls.target.x+Math.sin(a)*r,camera.position.y,controls.target.z+Math.cos(a)*r);
    controls.update();invalidate();render();
  },
  getShutterOpeningQuad:()=>{
    const w=$('stage').clientWidth,h=$('stage').clientHeight;
    model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const px=v=>{v.project(camera);return [(v.x+1)/2*w,(1-v.y)/2*h];};
    const f=beamFrame();
    return {corners:[[-1,1],[1,1],[1,-1],[-1,-1]].map(([sx,sy])=>px(shutter.parent.localToWorld(
      new THREE.Vector3(sx*f.halfWidth,f.centerY+sy*f.halfHeight,f.shutterZ)))),
      gap:px(shutter.parent.localToWorld(new THREE.Vector3(0,f.centerY,(f.shutterZ+f.sensorZ)/2))),stage:{w,h}};
  },
  // The iris's projected bounds as fractions of the canvas.
  getApertureFrame:()=>{
    model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const p=partWorldPoints(registry.get('aperture'),false).map(point=>point.clone().project(camera));
    const xs=p.map(v=>(v.x+1)/2),ys=p.map(v=>(1-v.y)/2);
    return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys),
      viewport:lessonViewport,view:viewPreset,study};
  },
  getSensorState:()=>{
    model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    const corners=[[-.825,-.55],[.825,-.55],[.825,.55],[-.825,.55]].map(([x,y])=>
      // Project on the bevelled front face the pixels are drawn on.
      new THREE.Vector3(x,y,sensorFrontZ()).applyMatrix4(sensorSurface.matrixWorld).project(camera));
    const u=sensorSurface.material.uniforms;
    return {exposure:u.sensorExposure.value,gain:u.sensorGain.value,lessonIso:u.lessonIso.value,
      corners:corners.map(p=>({x:(p.x+1)/2,y:(1-p.y)/2})),
      rect:{left:(Math.min(...corners.map(p=>p.x))+1)/2,right:(Math.max(...corners.map(p=>p.x))+1)/2,
        top:(1-Math.max(...corners.map(p=>p.y)))/2,bottom:(1-Math.min(...corners.map(p=>p.y)))/2}};
  },
  getPartRenderState,getInkOutlineState,
  getDemoState:()=>({kind:demoKind,complete:demoComplete,renderedFrames,yaw:model.rotation.y,shutter:getShutterCoverage(),
    sensorExposure:sensorSurface.material.uniforms.sensorExposure.value,sensorGain:sensorSurface.material.uniforms.sensorGain.value,
    span:(()=>{
      // Projected shutter + sensor bounds as fractions of the canvas.
      model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
      const p=lessonFramePoints().map(point=>point.project(camera)),xs=p.map(v=>v.x),ys=p.map(v=>v.y);
      return {left:(Math.min(...xs)+1)/2,right:(Math.max(...xs)+1)/2,top:(1-Math.max(...ys))/2,bottom:(1-Math.min(...ys))/2};
    })(),
    ...(isBalance()?{elapsed:lessonElapsed,...getBalanceState(),duration:balanceShotSeconds(balance.shotS),
      curtains:[shotSample.first,shotSample.second],curtainOpacity:lessonCurtainOpacity,
      glow:sensorSurface.material.uniforms.sensorGlow.value,intensity:balanceIntensity(balance.shotA),
      finalExposure:balanceExposure(balance.shotA,balance.shotS),lightStrength:balanceGlow(balance.shotA),
      irisOpening:lensRig.iris.userData.opening,irisLabel:lensRig.iris.userData.apertureLabel,
      irisRect:(()=>{
        model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
        const p=irisRingPoints().map(point=>point.project(camera)),xs=p.map(v=>v.x),ys=p.map(v=>v.y);
        return {left:(Math.min(...xs)+1)/2,right:(Math.max(...xs)+1)/2,top:(1-Math.max(...ys))/2,bottom:(1-Math.min(...ys))/2};
      })()}:
    isLesson()?{setting:lessonSetting,elapsed:lessonElapsed,
      ...(demoKind==='shutter-lesson'?{open:shotOpen(lessonSetting),duration:shotSeconds(lessonSetting),
        curtains:[shotSample.first,shotSample.second],light:shotSample.light,
        curtainOpacity:lessonCurtainOpacity,glow:sensorSurface.material.uniforms.sensorGlow.value,
        side:{phase:side.phase,split:side.split,beam:side.box&&{...side.box},
          // Light volumes drawn now (always one mesh; visible only while open).
          lightVolumes:internals.children.filter(o=>o.isMesh&&o.name==='shutterLightVolume'&&o.visible).length,
          // Body meshes and lines other than the shutter and sensor still drawn.
          bodyVisible:visualEntries.filter(e=>!sideKept().has(e.object)&&isVisibleInScene(e.object)&&
            e.material.visible&&e.material.opacity>.001).length}}:{duration:GAIN_SECONDS})}:{})}),
  // Read-only pixel probe: renders one frame, optionally without the shutter
  // (to see the sensor behind a closed curtain) and without the slit glow
  // (the recorded signal only), reads it back, then restores both and redraws
  // the real frame, even if reading fails.
  readPixels:({shutter:showShutter=true,glow:showGlow=true}={})=>{
    const glow=sensorSurface.material.uniforms.sensorGlow,savedGlow=glow.value,savedShutter=shutter.visible;
    try{
      shutter.visible=savedShutter&&showShutter;if(!showGlow)glow.value=0;render();
      const canvas=renderer.domElement,gl=renderer.getContext(),rgba=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
      return {width:canvas.width,height:canvas.height,rgba};
    }finally{shutter.visible=savedShutter;glow.value=savedGlow;render();}
  },
  getHighlightStrength:id=>{
    const values=[];
    // During a scene dissolve the displayed highlight is the blend of the two
    // snapshots (the live uniform holds whichever state rendered last).
    const t=sceneTransition;
    registry.get(id).traverse(object=>{
      if(!object.isMesh||!object.material?.uniforms?.highlight)return;
      const from=t?.before.highlights.get(object),to=t?.after.highlights.get(object);
      values.push(from!==undefined&&to!==undefined?THREE.MathUtils.lerp(from,to,t.amount):object.material.uniforms.highlight.value);
    });
    return values.length?Math.max(...values):0;
  },
  getProjectionGeometry(id=currentInteraction()?.target,visibleOnly=true){
    if(!id||!registry.ids().includes(id))return null;
    model.updateMatrixWorld(true);
    return {position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),
      projection:camera.projectionMatrix.toArray(),points:partWorldPoints(registry.get(id),visibleOnly).map(point=>point.toArray())};
  },
  getCaptureHighlights:()=>({sensor:sensorSurface.material.uniforms.highlight.value,
    ...(isFilm()?{film:film.filmSurface.material.uniforms.highlight.value}:{}),
    shutters:blades.flat().every(blade=>blade.material.uniforms.highlight.value===1)}),
  // Author inspection only; keep the learner's simple Front/Angle controls.
  setInspectionView(position){
    animation=null;camera.position.fromArray(position);controls.update();invalidate();
  },
});
function tick(now) {
  raf=0;
  if(animation) {
    const a=animation, p=clamp((now-a.start)/a.duration), ease=smooth(p);
    a.update(ease,p);
    if(p===1) { animation=null; a.done?.(); }
  }
  if(zoomAnimation){
    const a=zoomAnimation,p=clamp((now-a.start)/180);
    camera.position.sub(controls.target).setLength(THREE.MathUtils.lerp(a.from,a.to,smooth(p))).add(controls.target);
    controls.update();if(p===1)zoomAnimation=null;
  }
  if(lessonViewAnimation){
    const a=lessonViewAnimation,p=clamp((now-a.start)/300);
    a.update(smooth(p));if(p===1)lessonViewAnimation=null;
  }
  const glide=poseGlide.step(now);
  if(glide){applyPose(glide.values);glides.flush();}
  const zoomStep=landing?landingZoomGlide.step(now):null;
  if(zoomStep)setLandingViewZoom(zoomStep.values.z);
  if(reduced.matches)highlightFader.finish();else highlightFader.tick(now);
  render(); if(animation||zoomAnimation||lessonViewAnimation||poseGlide.active||landingZoomGlide.active||highlightFader.active) invalidate();
}
function animate(duration,update,done,{still=false}={}) {
  animation=null;
  if(reduced.matches&&!still) { update(1,1); done?.(); invalidate(); return; }
  animation={start:performance.now(),duration,update,done}; invalidate();
}
function orbitBetween(fromPosition,toPosition,fromTarget=controls.target.clone(),toTarget=controls.target.clone()){
  const epoch=manualViewEpoch;
  const from=new THREE.Spherical().setFromVector3(fromPosition.clone().sub(fromTarget));
  const to=new THREE.Spherical().setFromVector3(toPosition.clone().sub(toTarget));
  const turn=THREE.MathUtils.euclideanModulo(to.theta-from.theta+Math.PI,Math.PI*2)-Math.PI;
  const pose=new THREE.Spherical(),manualOffset=new THREE.Vector3();
  return p=>{
    if(epoch!==manualViewEpoch){
      // Keep the learner's current angle and zoom, but finish moving the pivot.
      manualOffset.copy(camera.position).sub(controls.target);
      controls.target.lerpVectors(fromTarget,toTarget,p);
      camera.position.copy(controls.target).add(manualOffset);controls.update();return;
    }
    controls.target.lerpVectors(fromTarget,toTarget,p);
    pose.set(THREE.MathUtils.lerp(from.radius,to.radius,p),THREE.MathUtils.lerp(from.phi,to.phi,p),from.theta+turn*p);
    camera.position.setFromSpherical(pose).add(controls.target);controls.update();
  };
}
function lockInteraction(locked){
  interactionLocked=locked;
  for(const id of ['open','capture','front','angle','rear','time','camera-model',
    'study-camera','study-lens','study-mount','study-film','mount-mark','mount-release'])$(id).disabled=locked;
  syncFilmControls();syncZoomControls();
}
function snapshotVisuals(cloneDynamic=false){
  const entries=[],clones=[];
  model.traverse(object=>{
    const mat=object.material;
    const geometry=cloneDynamic&&object.userData.dynamicGeometry?object.geometry.clone():object.geometry;
    if(geometry&&geometry!==object.geometry)clones.push(geometry);
    entries.push({object,geometry,parent:object.parent,visible:object.visible,position:object.position.clone(),
      quaternion:object.quaternion.clone(),scale:object.scale.clone(),
      material:mat?{visible:mat.visible,opacity:mat.opacity,transparent:mat.transparent,
        depthWrite:mat.depthWrite,color:mat.color?.clone(),
        highlight:mat.uniforms?.highlight?.value,filmTravel:mat.uniforms?.filmTravel?.value,
        exposureCount:mat.uniforms?.exposureCount?.value,
        exposureStrengths:mat.uniforms?.exposureStrengths?.value.slice(),
        sensorExposure:mat.uniforms?.sensorExposure?.value,sensorGain:mat.uniforms?.sensorGain?.value,
        exposureRanges:mat.uniforms?.exposureRanges?.value.map(range=>range.clone())}:null});
  });
  const restore=()=>{
    for(const e of entries){
      const o=e.object,m=o.material;
      // The film variant re-parents the control dial as its rewind base.
      if(e.parent&&o.parent!==e.parent)e.parent.add(o);
      o.visible=e.visible;o.position.copy(e.position);
      if(e.geometry)o.geometry=e.geometry;
      o.quaternion.copy(e.quaternion);o.scale.copy(e.scale);
      if(m){
        if(m.transparent!==e.material.transparent){m.transparent=e.material.transparent;m.needsUpdate=true;}
        m.visible=e.material.visible;m.opacity=e.material.opacity;m.depthWrite=e.material.depthWrite;
        if(e.material.color)m.color.copy(e.material.color);
        if(m.uniforms?.opacity)m.uniforms.opacity.value=m.opacity;
        if(m.uniforms?.highlight)m.uniforms.highlight.value=e.material.highlight;
        if(m.uniforms?.filmTravel)m.uniforms.filmTravel.value=e.material.filmTravel;
        if(m.uniforms?.exposureCount)m.uniforms.exposureCount.value=e.material.exposureCount;
        if(m.uniforms?.exposureStrengths)m.uniforms.exposureStrengths.value.splice(0,m.uniforms.exposureStrengths.value.length,...e.material.exposureStrengths);
        if(m.uniforms?.sensorExposure)m.uniforms.sensorExposure.value=e.material.sensorExposure;
        if(m.uniforms?.sensorGain)m.uniforms.sensorGain.value=e.material.sensorGain;
        if(m.uniforms?.exposureRanges)e.material.exposureRanges.forEach((range,i)=>m.uniforms.exposureRanges.value[i].copy(range));
      }
    }
  };
  restore.dispose=()=>clones.forEach(geometry=>geometry.dispose());
  restore.highlights=new Map(entries.filter(e=>e.material?.highlight!==undefined).map(e=>[e.object,e.material.highlight]));
  return restore;
}
function transitionScene(change,duration=700,done){
  if(interactionLocked)return;
  finishInternalsFade();
  animation=null;zoomAnimation=null;
  const leavingMirror=interactionId==='mirror';
  const before=snapshotVisuals(true),from=camera.position.clone(),fromTarget=controls.target.clone();
  // The scene dissolve already blends the two highlight states. Capture a
  // settled destination instead of running a second fade against snapshots.
  immediateHighlights=true;
  try{change();highlightFader.finish();}finally{immediateHighlights=false;}
  const after=snapshotVisuals(),to=camera.position.clone();
  if(reduced.matches){before.dispose();invalidate();done?.();return;}
  const move=orbitBetween(from,to,fromTarget,controls.target.clone());
  sceneTransition={before,after,amount:0,mirrorObservation:leavingMirror&&interactionId==='aperture'};lockInteraction(true);move(0);
  animate(duration,p=>{sceneTransition.amount=p;move(p);},()=>{
    after();before.dispose();sceneTransition=null;disposeDissolve();lockInteraction(false);done?.();
  });
}
function view(front=false,rear=false) {
  if(interactionLocked)return;
  animation=null;zoomAnimation=null;stepAimPoints=null;
  viewPreset=rear?'rear':front?'front':'angle';
  if($('capture').textContent==='Pause')$('capture').textContent='Resume';
  const from=camera.position.clone(), to=front&&study==='lens'?controls.target.clone().add(LENS_FRONT_OFFSET):
    new THREE.Vector3(...(rear?[.5,.5,-10.3]:front?[0,.3,10.3]:[5.6,3.4,8.7]));
  const move=orbitBetween(from,to);lockInteraction(true);
  animate(700,move,()=>lockInteraction(false));
}
function reveal(next,after) {
  zoomAnimation=null;
  viewPreset='free';
  lockInteraction(true);
  for(const id of ['open','capture','front','angle','rear','time','camera-model'])$(id).disabled=true;
  inside=next;revealing=true;
  const activePart=inside?'shutter':'shutterButton';
  const highlightFrom=visualEntries.map(({material})=>material.uniforms?.highlight?.value??0);
  immediateHighlights=true;
  try{highlightPart(activePart,false);highlightFader.finish();}finally{immediateHighlights=false;}
  const highlightTo=visualEntries.map(({material})=>material.uniforms?.highlight?.value??0);
  $('open').textContent=inside?'Close camera':'Look inside';
  $('timeline').hidden=!inside;
  $('hint').textContent=inside?'Camera shown faintly for context':'Drag to look around';
  const move=orbitBetween(camera.position.clone(),new THREE.Vector3(5.6,3.4,8.7));
  // Orbit around the body, including from a rear view. A straight chord can
  // plunge through the model and produce an abrupt zoom halfway through.
  $('caption').textContent=inside?captureCaption('The shutter sits in front of the sensor.'):'Press it to start the capture.';
  showContextGeometry();
  const update=p=>{
    revealAmount=inside?p:1-p;
    if(revealAmount===0){applyPartContext(null,0);setCameraGeometryVisibility();}
    else{showContextGeometry();applyPartContext('shutter');}
    visualEntries.forEach(({material},i)=>{
      if(material.uniforms?.highlight)material.uniforms.highlight.value=
        THREE.MathUtils.lerp(highlightFrom[i],highlightTo[i],p);
    });
    move(p);
  };
  update(0);
  animate(1000,update,()=>{
    revealing=false;disposeDissolve();
    applyPartContext(inside?'shutter':null,inside?1:0);
    if(!inside)setCameraGeometryVisibility();
    lockInteraction(false);
    for(const id of ['open','capture','front','angle','rear','time','camera-model'])$(id).disabled=false;
    syncFilmControls();
    after?.();
  });
}
// Clone every material before focus treatments. A focused mechanism stays
// solid while a few silhouette and key-boundary edges retain the camera's
// location around it. Context ink follows the theme; hidden fills neither write
// depth nor cast shadows over the active geometry.
const visualEntries=[];
registry.isolateMaterials(model);
model.traverse(object=>{
  if(object.isMesh||object.isLineSegments)visualEntries.push({
    object,material:object.material,opacity:object.material.opacity,
    color:object.material.color?.clone(),
    transparent:object.material.transparent,depthWrite:object.material.depthWrite,
    materialVisible:object.material.visible,castShadow:object.castShadow,visible:object.visible,
  });
});
// The landing draws the wire cutaway exactly as the app does: the theme's grey
// context hairline (Kent, October 18, 2026: black lines on the landing "is weird").
const contextLineStyle=styleContextLine;
const stateVisibility=entry=>entry.object.userData.slrFrontOutline&&isSlr()?false:
  entry.object.userData.mechanismVisible??entry.visible;
function disposeDissolve(){dissolve?.dispose();dissolve=null;}
function isVisibleInScene(object){
  for(let current=object;current;current=current.parent)if(!current.visible)return false;
  return true;
}
function getPartRenderState(id){
  let meshes=0,solidMeshes=0;
  registry.get(id).traverse(object=>{
    if(!object.isMesh||!isVisibleInScene(object))return;
    meshes++;
    if(object.material.visible&&object.material.opacity===1&&object.material.depthWrite)solidMeshes++;
  });
  return {meshes,solidMeshes};
}
function partWorldPoints(group,visibleOnly=true,minOpacity=.5,onlyName=null){
  const points=[];
  group.traverse(object=>{
    if(onlyName&&object.name!==onlyName)return;
    if(!object.isMesh||(visibleOnly&&(!isVisibleInScene(object)||!object.material.visible||object.material.opacity<=minOpacity)))return;
    object.geometry.computeBoundingBox();const box=object.geometry.boundingBox;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])
      points.push(new THREE.Vector3(x,y,z).applyMatrix4(object.matrixWorld));
  });return points;
}
// The lens study's iris as the host needs to place things on it: its projected
// bounds in this canvas's CSS pixels (`apertureRect`, with the canvas size in
// `stage`), and the orbit as degrees/units around the target (`pose`). It is
// part of every published state, so a label follows the iris while the learner
// orbits or zooms. Rounded so a still camera publishes nothing new.
function getLensPoseState(){
  const w=$('stage').clientWidth,h=$('stage').clientHeight;
  if(!w||!h)return {};
  model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  // Only the fixed outer housing ring: the blades swing as the stop changes,
  // and a label on their bounds would shift with the ruler (Kent, October 6).
  const points=partWorldPoints(registry.get('aperture'),false,.5,'apertureHousing').map(point=>point.project(camera));
  if(!points.length)return {};
  const r=n=>Math.round(n*10)/10,xs=points.map(p=>(p.x+1)/2*w),ys=points.map(p=>(1-p.y)/2*h);
  const offset=camera.position.clone().sub(controls.target),distance=offset.length()||1;
  return {apertureRect:{left:r(Math.min(...xs)),top:r(Math.min(...ys)),right:r(Math.max(...xs)),bottom:r(Math.max(...ys))},
    stage:{w,h},
    pose:{azimuth:r(THREE.MathUtils.radToDeg(Math.atan2(offset.x,offset.z))),
      elevation:r(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(offset.y/distance,-1,1)))),
      distance:Math.round(distance*100)/100}};
}
// The ISO lesson's sensor face as the host needs to hang a callout from it:
// its projected bounds in this canvas's CSS pixels (`sensorRect`, with the
// canvas size in `stage`), rounded so a still camera publishes nothing new.
function getSensorRectState(){
  const w=$('stage').clientWidth,h=$('stage').clientHeight;
  if(!w||!h)return {};
  model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const corners=[[-.825,-.55],[.825,-.55],[.825,.55],[-.825,.55]].map(([x,y])=>
    new THREE.Vector3(x,y,sensorFrontZ()).applyMatrix4(sensorSurface.matrixWorld).project(camera));
  const r=n=>Math.round(n*10)/10,xs=corners.map(p=>(p.x+1)/2*w),ys=corners.map(p=>(1-p.y)/2*h);
  return {sensorRect:{left:r(Math.min(...xs)),top:r(Math.min(...ys)),right:r(Math.max(...xs)),bottom:r(Math.max(...ys))},
    stage:{w,h}};
}
// The shutter lesson's curtain frame as the host needs to hang a callout from
// it while the learner orbits and zooms: its projected bounds in this canvas's
// CSS pixels (`shutterRect`, with the canvas size in `stage`), rounded so a
// still camera publishes nothing new. The frame is fixed; the curtains move.
function getShutterRectState(){
  const w=$('stage').clientWidth,h=$('stage').clientHeight;
  if(!w||!h)return {};
  model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const r=n=>Math.round(n*10)/10;
  if(side.phase==='side'){
    // The side view anchors the callout in the gap between the shutter and the
    // sensor (Kent, October 11): one point, the middle of the gap, projected
    // every frame, so it stays put under the zoom buttons and a pinch.
    // Kent (18:35): the hint sits just below the two models, not over them
    // where the learner is looking, so the point is the gap's middle at the
    // lowest edge of the shutter and the sensor.
    const frame=beamFrame(),p=new THREE.Vector3(0,frame.centerY,(frame.shutterZ+frame.sensorZ)/2);
    shutter.parent.localToWorld(p).project(camera);
    let lowest=-Infinity;
    for(const z of [frame.shutterZ,frame.sensorZ])for(const sy of [-1,1])for(const sx of [-1,1]){
      const q=new THREE.Vector3(sx*frame.halfWidth,frame.centerY+sy*frame.halfHeight,z);
      shutter.parent.localToWorld(q).project(camera);
      lowest=Math.max(lowest,(1-q.y)/2*h);
    }
    const x=r((p.x+1)/2*w),y=r(lowest);
    return {shutterRect:{left:x,top:y,right:x,bottom:y},stage:{w,h}};
  }
  const corners=[[-.96,-.68],[.96,-.68],[.96,.68],[-.96,.68]].map(([x,y])=>
    new THREE.Vector3(x,y,.025).applyMatrix4(shutter.matrixWorld).project(camera));
  const xs=corners.map(p=>(p.x+1)/2*w),ys=corners.map(p=>(1-p.y)/2*h);
  return {shutterRect:{left:r(Math.min(...xs)),top:r(Math.min(...ys)),right:r(Math.max(...xs)),bottom:r(Math.max(...ys))},
    stage:{w,h}};
}
// A tapped part's name (Kent, October 11): a passive callout under the part,
// pointing up at it, through the same host `callout` the lessons' steps use.
let tapLabel=null,tapLabelTimer=0;
function clearTapLabel(){clearTimeout(tapLabelTimer);tapLabel=null;}
function showTapLabel(id){
  clearTimeout(tapLabelTimer);
  tapLabel={id,fading:false};
  tapLabelTimer=setTimeout(()=>{
    tapLabel.fading=true;publishHost(true);
    tapLabelTimer=setTimeout(()=>{tapLabel=null;publishHost(true);},TAP_LABEL_FADE_SECONDS*1000);
  },TAP_LABEL_SECONDS*1000);
  publishHost(true);
}
function getTapCallout(){
  if(!tapLabel||!PART_NAMES[tapLabel.id])return null;
  const group=registry.get(tapLabel.id);
  if(!isVisibleInScene(group))return null;
  camera.updateMatrixWorld(true);model.updateMatrixWorld(true);
  const points=partWorldPoints(group).map(point=>point.project(camera));
  if(!points.length||points.every(point=>point.z>1||point.z<-1))return null;
  const left=(Math.min(...points.map(p=>p.x))+1)/2,right=(Math.max(...points.map(p=>p.x))+1)/2;
  const top=(1-Math.max(...points.map(p=>p.y)))/2,bottom=(1-Math.min(...points.map(p=>p.y)))/2;
  if(right<0||left>1||bottom<0||top>1)return null;
  return {message:PART_NAMES[tapLabel.id],passive:true,placement:'below',pointer:true,fading:tapLabel.fading,
    x:left,y:top,width:right-left,height:bottom-top};
}
function getCallout(){
  const tapped=getTapCallout();
  if(tapped)return tapped;
  const step=currentInteraction();
  const passive=step?.automatic&&['watching','running'].includes(interactionStatus);
  if(!step||step.slider||(!passive&&(interactionStatus!=='ready'||animation||interactionLocked)))return null;
  const group=registry.get(step.target);
  if(!isVisibleInScene(group))return null;
  // Host state can be requested between paints, after controls changed the
  // pose. Vector3.project must use that pose's inverse, not the last render's.
  camera.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  // Project each mesh's own box. A world-axis box around an open hinged door
  // invents near-camera corners and can put the callout far outside the view.
  const points=partWorldPoints(group).map(point=>point.project(camera));
  if(!points.length)return null;
  if(points.every(point=>point.z>1||point.z<-1))return null;
  const left=(Math.min(...points.map(p=>p.x))+1)/2,right=(Math.max(...points.map(p=>p.x))+1)/2;
  const top=(1-Math.max(...points.map(p=>p.y)))/2,bottom=(1-Math.min(...points.map(p=>p.y)))/2;
  if(right<0||left>1||bottom<0||top>1)return null;
  if(step.target==='filmBack'){
    // An open door is allowed beyond the viewport. Anchor its instruction to
    // the visible door/hinge region so the learner can still tap to close it.
    const x=Math.max(0,left),y=Math.max(0,top);
    return {message:step.prompt||interactionPrompts[step.id],x,y,
      width:Math.min(1,right)-x,height:Math.min(1,bottom)-y};
  }
  return {message:step.prompt||interactionPrompts[step.id],passive:Boolean(passive),x:left,y:top,width:right-left,height:bottom-top};
}
function getInkOutlineState(){
  model.updateMatrixWorld(true);
  const count=(root,minZ=-Infinity)=>{
    let segments=0;
    root.traverse(object=>{
      if(!object.isLineSegments||!object.userData.printOutline||!isVisibleInScene(object)||
        !object.material.visible||object.material.opacity<.5)return;
      const points=object.geometry.attributes.position;
      for(let i=0;i<points.count;i+=2){
        const a=new THREE.Vector3().fromBufferAttribute(points,i).applyMatrix4(object.matrixWorld);
        const b=new THREE.Vector3().fromBufferAttribute(points,i+1).applyMatrix4(object.matrixWorld);
        if(a.z>=minZ&&b.z>=minZ)segments++;
      }
    });
    return segments;
  };
  return {front:count(isFilm()?film.filmBody:body,.005),
    back:count(isFilm()?film.back:rearBacking),mirrorBox:count(dslr.housing)};
}
function getPartOutlineCount(id){
  let count=0;
  registry.get(id).traverse(object=>{
    if(object.isLineSegments&&isVisibleInScene(object)&&object.material.visible&&
      object.material.opacity>0)count++;
  });
  return count;
}
function focusedObjects(id){
  const active=new Set();
  // 'balance' names the balance lesson's x-ray parts (its solid reveal).
  const ids=id==='balance'?['aperture',recordingPart(),'shutter','shutterButton']:
    id==='mountMarks'?['mountMarks','lensMountMark']:
    ((inside||revealing)&&study==='camera'&&[recordingPart(),'shutter','shutterButton'].includes(id)?
      [recordingPart(),'shutter','shutterButton',...(isSlr()?['reflexMirror']:[])]:
      (study==='film'&&id==='filmStrip'?['filmStrip','filmCartridge','filmTakeup','filmGate','filmSprocket','filmAdvance','filmRewind','filmRewindRelease']:[id]));
  if(id==='lensRelease'&&interactionId==='lensRelease')ids.push('mountMarks','lensMountMark');
  if(id)for(const part of ids){
    registry.get(part).traverse(object=>active.add(object));
  }
  return active;
}
function solidObjects(id){
  const solid=focusedObjects(id),parts=[];
  // Show the entire shutter mechanism, but reserve the teaching highlight
  // and orbit anchor for the mirror during its observation.
  // The balance lesson draws the lens iris solid beside the sensor.
  if(isBalance()&&id)parts.push('aperture');
  if(interactionId==='mirror')parts.push('shutter','shutterButton',recordingPart(),
    'focusingScreen','pentaprism','opticalFinder');
  if(explorationInternals&&interactionStatus==='intro')parts.push(
    'aperture','focusGroup','zoomGroup','shutter','shutterButton','lensRelease',recordingPart(),
    ...(isSlr()?['reflexMirror','focusingScreen','pentaprism','opticalFinder']:[]),
    ...(isFilm()?['filmCartridge','filmTakeup','filmGate','filmSprocket','filmAdvance','filmRewind','filmRewindRelease']:[]));
  if(interactionId==='lensRelease'&&study==='mount'){
    lens.traverse(object=>solid.add(object));parts.push('lensMount');
  }
  // The mirror is solid only when it is the active mechanism. Elsewhere its
  // technical outline preserves location without hiding the selected part.
  if(isFilm()&&study==='film'){
    parts.push('filmStrip','filmCartridge','filmTakeup','filmGate','filmSprocket',
      'filmAdvance','filmRewind','filmRewindRelease','controlDial','shutter','shutterButton');
    if(filmDoorMoving||film.getState().backOpen>0)parts.push('filmBack');
  }
  for(const part of parts)registry.get(part).traverse(object=>solid.add(object));
  return solid;
}
function getShutterCoverage(){
  model.updateMatrixWorld(true);
  return blades.map(curtain=>{
    const visible=curtain.filter(blade=>isVisibleInScene(blade)&&blade.material.visible&&blade.material.opacity>0);
    if(!visible.length)return 0;
    const bounds=visible.map(blade=>new THREE.Box3().setFromObject(blade,true));
    return Math.max(...bounds.map(box=>box.max.y))-Math.min(...bounds.map(box=>box.min.y));
  });
}
function showContextGeometry(){
  shell.visible=true;lens.visible=true;internals.visible=true;lensBarrel.visible=true;
  lensRig.focus.visible=true;lensRig.zoom.visible=true;lensRig.iris.visible=true;
}
function setCameraGeometryVisibility(){
  shell.visible=true;lens.visible=true;internals.visible=true;lensBarrel.visible=true;
  lensRig.focus.visible=false;lensRig.zoom.visible=false;lensRig.iris.visible=false;
}
// Last treatment, so a theme change can recompute it in place.
let lastContext={id:null,amount:0};
function applyPartContext(id,amount=1){
  lastContext={id,amount};
  const active=solidObjects(id);
  for(const entry of visualEntries){
    const {object,material}=entry,isActive=active.has(object);
    const contextLine=object.isLineSegments&&
      (object.userData.printOutline||object.userData.contextOutline);
    const contextual=!isActive&&amount>0;
    const opacity=contextLine?contextLineStyle(entry,{dark:darkTheme,ink:darkContextInk,active:isActive,amount}):
      isActive?entry.opacity:THREE.MathUtils.lerp(entry.opacity,0,amount);
    material.opacity=opacity;
    if(material.uniforms?.opacity)material.uniforms.opacity.value=opacity;
    material.visible=isActive?entry.materialVisible:
      (contextual?(object.isLineSegments?contextLine:opacity>.001):entry.materialVisible);
    const transparent=entry.transparent||contextual;
    if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
    material.depthWrite=contextual?false:entry.depthWrite;
    object.castShadow=contextual?false:entry.castShadow;
    object.visible=isActive?stateVisibility(entry):
      (contextual?(object.isLineSegments?contextLine:(object.userData.mechanismVisible??true)):stateVisibility(entry));
  }
}
function getContextState(){
  const active=solidObjects(focusedPart);
  const contextual=inside||study!=='camera';
  const surrounding=visualEntries.filter(entry=>!active.has(entry.object));
  const restored=visualEntries.every(entry=>entry.object.visible===stateVisibility(entry)&&
    (!entry.color||entry.material.color.equals(entry.color))&&
    entry.material.opacity===entry.opacity&&entry.material.visible===entry.materialVisible&&
    entry.material.transparent===entry.transparent&&
    entry.material.depthWrite===entry.depthWrite&&entry.object.castShadow===entry.castShadow);
  if(!contextual)return {active:false,visibleContextLines:0,visibleContextFills:0,
    contextShadowCasters:0,contextDepthWriters:0,restored};
  return {
    active:true,
    visibleContextLines:surrounding.filter(entry=>entry.object.isLineSegments&&
      isVisibleInScene(entry.object)&&entry.material.opacity>0).length,
    visibleContextFills:surrounding.filter(entry=>entry.object.isMesh&&
      entry.object.visible&&entry.material.opacity>.001).length,
    contextShadowCasters:surrounding.filter(entry=>entry.object.isMesh&&entry.object.castShadow).length,
    contextDepthWriters:surrounding.filter(entry=>entry.object.isMesh&&entry.material.depthWrite).length,
    restored,
  };
}
// Named part groups allow lesson beats to direct attention without recoloring
// shared materials elsewhere in the model. Labels carry meaning independently
// of color. No expensive outline or postprocessing pass is required.
function setVisualHighlights(ids=[]){
  visualHighlightIds=blueHighlight?[...new Set(ids.filter(Boolean))]:[];
  const targets=new Map();
  model.traverse(object=>{
    if(object.material?.uniforms?.highlight)targets.set(object.material.uniforms.highlight,0);
  });
  for(const id of visualHighlightIds){
    if(!registry.ids().includes(id))continue;
    registry.get(id).traverse(object=>{
      if(object.material?.uniforms?.highlight)targets.set(object.material.uniforms.highlight,1);
    });
    // Optical and capture studies retain their existing related highlights.
    // Only film loading/unloading restrict blue to the clickable control.
    if(!(isFilm()&&study==='film'))for(const object of focusedObjects(id)){
      if(object.material?.uniforms?.highlight)targets.set(object.material.uniforms.highlight,1);
    }
  }
  // Stock colors belong to the moving film, never to the blue instructional
  // ink. The stock shader ignores this flag but retaining it keeps transitions
  // and the existing capture contract stable.
  if(isFilm()&&(study==='film'||inside||revealing))for(const {object,material} of visualEntries){
    if(object.userData.filmStockColor&&material.uniforms?.highlight)targets.set(material.uniforms.highlight,1);
  }
  highlightFader.set(targets,performance.now(),immediateHighlights||reduced.matches||document.hidden);
  if(highlightFader.active)invalidate();
}
function filmVisualHighlights(action=null){
  if(!isFilm())return [];
  if(action==='load'||action==='back')return ['filmBack'];
  if(action==='advance')return ['filmAdvance'];
  if(action==='release')return ['shutterButton'];
  if(action==='rewind'){
    if(isFilmMacro()&&interactionId==='rewind'&&interactionPhase==='open')return ['filmBack'];
    if(isFilmMacro()&&interactionId==='rewind'&&interactionPhase==='release')return ['filmRewindRelease'];
    return ['filmRewind'];
  }
  if(isFilmMacro()){
    if(interactionId==='load'){
      if(['thread','close'].includes(interactionPhase))return ['filmBack'];
      if(interactionPhase==='advance')return ['filmAdvance'];
      if(interactionPhase==='release')return ['shutterButton'];
    }
    if(interactionId==='rewind'){
      if(interactionPhase==='release')return ['filmRewindRelease'];
      if(['unfold','wind'].includes(interactionPhase))return ['filmRewind'];
      if(interactionPhase==='open')return ['filmBack'];
    }
  }
  return visualHighlightIds;
}
function highlightFilmAction(action){
  const ids=filmVisualHighlights(action);
  if(ids.length)setVisualHighlights(ids);
}
function highlightPart(id,updateContext=true) {
  focusedPart=id;
  $('part-label').textContent=id?registry.get(id).userData.label:'';
  setVisualHighlights([id]);
  if(updateContext){
    if(inside||study!=='camera'){
      showContextGeometry();applyPartContext(id);
    }else applyPartContext(null,0);
  }
}
function inspect(mode) {
  if(interactionLocked)return;
  const leavingLens=study==='lens'&&mode!=='lens';
  animation=null;study=mode;inside=false;revealing=false;interactionLocked=false;
  disposeDissolve();
  for(const id of ['open','capture','front','angle','rear','time','camera-model'])$(id).disabled=false;
  applyPartContext(null,0);
  if(mode==='camera')setCameraGeometryVisibility();else showContextGeometry();
  for(const name of ['camera','lens','mount','film'])$('study-'+name).setAttribute('aria-pressed',String(mode===name));
  $('open').parentElement.hidden=mode!=='camera';$('timeline').hidden=true;
  $('lens-controls').hidden=mode!=='lens';$('mount-controls').hidden=mode!=='mount';
  $('film-controls').hidden=mode!=='film';
  $('open').textContent='Look inside';$('capture').textContent='Take a photo';
  setExposure(0,false);
  // The lens study orbits and dollies around the iris itself; leaving it
  // returns to the body pivot and distance limit.
  controls.minDistance=mode==='lens'?LENS_MIN_DISTANCE:BODY_MIN_DISTANCE;
  if(mode==='lens')controls.target.copy(apertureCenter());
  else if(leavingLens)controls.target.set(...BODY_TARGET);
  // Leave room for the camera context around the iris, including portrait
  // screens. The old isolated-part close-up cropped the surrounding body.
  if(mode==='lens')camera.position.copy(controls.target).add(LENS_FRONT_OFFSET);
  else camera.position.set(...(mode==='film'?[3.6,2.6,-12.6]:[5.6,3.4,8.7]));
  controls.update();
  viewPreset=mode==='film'?'rear':mode==='lens'?'front':'angle';
  $('hint').textContent=mode==='camera'?'Drag to look around':'Camera shown faintly for context';
  highlightPart(mode==='film'?'filmStrip':mode==='lens'?'aperture':mode==='mount'?'lensMount':'shutterButton');
  $('caption').textContent=mode==='lens'?'The iris changes the opening inside the lens.':
    mode==='mount'?'The mount connects lens and body.':mode==='film'?'Load film to trace its path through the camera.':'Press it to start the capture.';
  syncFilmControls();
  invalidate();
}
for(const mode of ['camera','lens','mount','film'])$('study-'+mode).onclick=()=>{
  if(mode!==study&&(mode!=='film'||isFilm()))transitionScene(()=>inspect(mode));
};
// Landing only (Kent, October 19, 2026: "The user can change the camera type on the
// Option between Mirrorless, DSLR, and Film SLR"): the body swaps under a scene
// dissolve while the turntable runs on, in the lens study with the view kept. Before
// the lens study is up (the page priming off stage) it swaps at once. A swap asked for
// while a dissolve or reveal owns the scene waits for it.
// The landing's x-ray (Kent, October 19, 2026: the camera act goes through the lab's
// sequence by itself): null until the tour sends it; below 1 the render blends the
// solid body into its wire sketch round the lens; at 1 the lens study draws as usual.
let landingXray=null;
// Landing (Kent, October 20, 2026: "make all of the models look like" the app's Explore wireframe): past the
// solid opening the body is the app's own Explore cutaway, the state the cube toggle sets (explorationInternals:
// solidObjects keeps every internal part solid inside the outlined shell, and a loaded roll in the film body).
function landingExplore(on){
  explorationInternals=inside=on;
  if(on&&isFilm()&&!film.getState().loaded)seedFilmStep('capture');
}
function setLandingXray(value){
  if(typeof value!=='number'||!Number.isFinite(value))return;
  const was=landingXray;landingXray=clamp(value);
  landingExplore(landingXray>0);
  if(landingXray<1)finishLandingPartFade(); // the loop's solid opening owns the render again
  if(landingXray>=1&&(was===null||was<1)&&study==='lens'){disposeDissolve();applyPartContext(focusedPart??'aperture',1);}
  invalidate();
}
const LANDING_PARTS=['shutter','aperture','focusGroup','zoomGroup'];
let landingPartTimer=0;
function setLandingPart(part){
  clearTimeout(landingPartTimer);
  if(!LANDING_PARTS.includes(part)||study!=='lens'||focusedPart===part)return;
  // Solid body: the part is only remembered (the x-ray dissolve shows it). Wire body: a crossfade to it (landingCrossfadePart).
  if(landingXray===null||landingXray<1){highlightPart(part,false);invalidate();return;}
  if(sceneTransition||solidRevealState||landingPartFade){landingPartTimer=setTimeout(()=>setLandingPart(part),120);return;}
  landingCrossfadePart(part);
}
// Landing only (r8, Kent: "as individual components become solid or wireframe sketch on the camera, can we
// have them fade?"): the outgoing part fades back to the wire sketch as the incoming one fades to solid, one
// two-pass crossfade on its own clock. Unlike transitionScene it never moves the camera, so the turntable runs on.
const LANDING_PART_FADE_MS=900; // domain: landing part crossfade
let landingPartFade=null;
function landingCrossfadePart(part){
  const before=snapshotVisuals(true);
  immediateHighlights=true;
  try{highlightPart(part);highlightFader.finish();}finally{immediateHighlights=false;}
  const after=snapshotVisuals();
  if(reduced.matches){before.dispose();invalidate();return;}
  landingPartFade={before,after,start:performance.now()};
  invalidate();
}
function landingPartFadeAmount(now=performance.now()){return landingPartFade?smooth(clamp((now-landingPartFade.start)/LANDING_PART_FADE_MS)):1;}
function finishLandingPartFade(){
  const f=landingPartFade;if(!f)return;
  landingPartFade=null;f.after();f.before.dispose();disposeDissolve();
}
function setLandingScalar(action,value){
  if(study!=='lens')return;
  if(action==='exposure')setExposure(value,false,value>0);
  else ({aperture:lensRig.setAperture,focus:lensRig.setFocus,zoom:lensRig.setZoom})[action](value);
  invalidate();
}
let landingModelWanted=null,landingModelTimer=0;
const LANDING_MODEL_SWAP_MS=500; // domain: landing body swap dissolve
function swapBody(next){
  abandonFilmMacro();
  dslr.setVariant(next==='film'?'dslr':next);film.setEnabled(next==='film');
  $('study-film').hidden=next!=='film';$('camera-model').value=next;
}
function landingModel(next){
  if(!['mirrorless','dslr','film'].includes(next))return;
  landingModelWanted=next;clearTimeout(landingModelTimer);applyLandingModel();
}
function applyLandingModel(){
  const next=landingModelWanted;
  if(!next||disposed)return;
  if($('camera-model').value===next){landingModelWanted=null;return;}
  if(study!=='lens'){landingModelWanted=null;swapBody(next);invalidate();return;}
  if(interactionLocked||solidRevealState||sceneTransition||landingPartFade){landingModelTimer=setTimeout(applyLandingModel,120);return;}
  landingModelWanted=null;
  const offset=camera.position.clone().sub(controls.target),ax=lessonViewport?.ax,part=focusedPart;
  transitionScene(()=>{
    swapBody(next);
    immediateHighlights=true;
    try{inspect('lens');highlightFader.finish();}finally{immediateHighlights=false;}
    camera.position.copy(controls.target).add(offset);controls.update();viewPreset='lens-angle';
    // inspect('lens') re-selects the aperture: the tour's current part stays the one shown.
    // The film is loaded inside this change, before the dissolve's "after" snapshot: a roll loaded later (the x-ray ticking on
    // mid-dissolve) would be overwritten by the snapshot restore, which left the strip invisible on the Film SLR.
    if(isFilm()&&!film.getState().loaded)seedFilmStep('capture');
    landingExplore(landingXray!==null&&landingXray>0);
    if(landingXray!==null&&landingXray>=1){if(part&&LANDING_PARTS.includes(part))highlightPart(part);applyPartContext(focusedPart??'aperture',1);}
    if(Number.isFinite(ax)&&lessonViewport){lessonViewport.ax=ax;applyCameraFrame();}
  },LANDING_MODEL_SWAP_MS);
}
$('camera-model').onchange=e=>{
  if(interactionLocked)return;
  const next=e.target.value;
  transitionScene(()=>{
    abandonFilmMacro();
    dslr.setVariant(next==='film'?'dslr':next);film.setEnabled(next==='film');
    $('study-film').hidden=next!=='film';
    configureIntro();
  });
};
for(const [id,part,apply,caption] of [
  ['aperture','aperture',lensRig.setAperture,'The iris changes the opening inside the lens.'],
  ['focus','focusGroup',lensRig.setFocus,'Glass elements move along the lens axis for focus.'],
  ['zoom','zoomGroup',lensRig.setZoom,'A separate glass group moves in this zoom illustration.'],
])$(id).oninput=e=>{
  showContextGeometry();
  $('hint').textContent='Camera shown faintly for context';
  const applied=apply(Number(e.target.value));
  if(id==='aperture')e.target.value=applied;
  highlightPart(part);$('caption').textContent=caption;invalidate();
};
$('mount-mark').onclick=()=>transitionScene(()=>{highlightPart('mountMarks');$('caption').textContent='Lens mark to dot: insert. Lens mark to line: locked. These are teaching cues.';},400);
$('mount-release').onclick=()=>transitionScene(()=>{highlightPart('lensRelease');$('caption').textContent='The release unlocks the lens. Follow the procedure for your camera.';},400);
function shoot(done,{revealInternals=true}={}) {
  if(interactionLocked||(isFilm()&&!film.getState().canCapture))return;
  const from=$('capture').textContent==='Resume'?Number($('time').value):0;
  $('capture').textContent='Pause';
  const play=()=>{
    if(done)lockInteraction(true);
    animate(Math.max(1,(1-from)*2400),(_p,raw)=>setExposure(from+(1-from)*raw,true,from<.85),()=>{$('capture').textContent='Replay';done?.();});
  };
  if(!inside&&revealInternals) { setExposure(0); reveal(true,()=>{
    if(reduced.matches){setExposure(.5,true,true);if(isFilm())film.exposeGate(1);else sensorSurface.material.uniforms.sensorExposure.value=1;$('capture').textContent='Replay';done?.();}else play();
  }); }
  else if(reduced.matches){setExposure(.5,true,true);if(isFilm())film.exposeGate(1);else sensorSurface.material.uniforms.sensorExposure.value=1;$('capture').textContent='Replay';invalidate();done?.();}
  else play();
}
$('open').onclick=()=>{animation=null;$('capture').textContent='Take a photo';reveal(!inside);setExposure(0,false);};
$('capture').onclick=()=>{
  if(animation && $('capture').textContent==='Pause') {animation=null;$('capture').textContent='Resume';invalidate();}
  else shoot();
};
$('time').oninput=e=>{animation=null;$('capture').textContent=Number(e.target.value)<1?'Resume':'Replay';setExposure(Number(e.target.value));invalidate();};
$('front').onclick=()=>view(true); $('angle').onclick=()=>view(false);
$('rear').onclick=()=>view(false,true);
function syncFilmControls(){
  const s=film.getState(),busy=interactionLocked;
  $('film-load').disabled=busy||!s.canLoad;
  $('film-advance').disabled=busy||!s.canAdvance;
  $('film-rewind').disabled=busy||!s.canRewind;
  $('film-release').disabled=busy||!s.canRelease;
  $('film-back').disabled=busy||(!s.canOpen&&s.backOpen===0);
  $('film-back').textContent=s.backOpen>0?'Close back':'Open back';
  $('capture').disabled=busy||(isFilm()&&!s.canCapture);
  $('time').disabled=busy||(isFilm()&&!s.canCapture);
  $('film-status').textContent=s.phase==='empty'?'No film':s.phase==='rewound'?'Rewound':
    s.phase==='loaded'?(s.backOpen>0?'Leader at mark · close the back':s.releaseDue?'Release the shutter, then wind again':!s.prepared?'Wind past the exposed leader':`Frame ${s.frame}`):
    s.phase==='releasing'?'Releasing shutter':
    s.phase==='loading'?'Loading':s.phase==='advancing'?'Advancing':'Rewinding';
}
function syncZoomControls(){
  $('zoom-in').disabled=disposed||!controls.enabled||controls.getDistance()<=controls.minDistance+.001;
  $('zoom-out').disabled=disposed||!controls.enabled||controls.getDistance()>=controls.maxDistance-.001;
}
function takeViewControl(){manualViewEpoch++;zoomAnimation=null;lessonViewAnimation=null;poseGlide.cancel();viewPreset='free';}
// The host's `poseTo` {azimuth, elevation, distance, ms}: glide the orbit around
// the current target from wherever it is (degrees, the same pose the lens study
// reports). A reveal flight or a locked interaction owns the camera: ignored.
function currentOrbitPose(){
  const offset=camera.position.clone().sub(controls.target),distance=offset.length()||1;
  return {azimuth:THREE.MathUtils.radToDeg(Math.atan2(offset.x,offset.z)),
    elevation:THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(offset.y/distance,-1,1))),distance};
}
// Landing only: `poseTo {path:[{at, azimuth, elevation, distance, anchorX?}]}` runs
// one continuous move through timed keys (pose_glide.js preparePath) from the view
// on screen, the iris anchor riding the same curve. Sent while the reveal flight
// still owns the camera, it starts as the flight lands.
let pendingLandingPath=null;
function landingPath(value){
  const keys=value.path,anchored=keys.every(k=>Number.isFinite(k?.anchorX))&&Boolean(lessonViewport);
  if(!keys.length||!keys.every(k=>['at','azimuth','elevation','distance'].every(n=>Number.isFinite(k?.[n])))||
    keys.some((k,i)=>k.at<=(i?keys[i-1].at:0)))return;
  if(solidRevealState){pendingLandingPath=value;return;}
  if(interactionLocked)return;
  takeViewControl();
  const pose=key=>({azimuth:key.azimuth,
    elevation:THREE.MathUtils.clamp(key.elevation,90-THREE.MathUtils.radToDeg(controls.maxPolarAngle),90-THREE.MathUtils.radToDeg(controls.minPolarAngle)),
    distance:THREE.MathUtils.clamp(key.distance,controls.minDistance,controls.maxDistance),...(anchored?{anchorX:key.anchorX}:{})});
  const start={...currentOrbitPose(),...(anchored?{anchorX:lessonViewport.ax}:{})};
  const timed=[{at:0,values:start},...keys.map(k=>({at:k.at,values:pose(k)}))];
  if(reduced.matches){applyPose(timed[timed.length-1].values);invalidate();return;}
  poseGlide.path(timed,performance.now(),['azimuth']);
  invalidate();
}
function poseTo(value){
  if(landing&&Array.isArray(value?.path)){landingPath(value);return;}
  const finite=key=>typeof value?.[key]==='number'&&Number.isFinite(value[key]);
  if(!['azimuth','elevation','distance','ms'].every(finite)||value.ms<0)return;
  if(solidRevealState||interactionLocked)return;
  takeViewControl();
  const from=currentOrbitPose();
  // The polar limits bound the elevation the orbit can reach.
  const to={azimuth:wrapDegrees(value.azimuth),
    elevation:THREE.MathUtils.clamp(value.elevation,90-THREE.MathUtils.radToDeg(controls.maxPolarAngle),
      90-THREE.MathUtils.radToDeg(controls.minPolarAngle)),
    distance:THREE.MathUtils.clamp(value.distance,controls.minDistance,controls.maxDistance)};
  poseGlide.start(from,to,reduced.matches?0:value.ms,performance.now(),['azimuth']);
  invalidate();
}
function applyPose({azimuth,elevation,distance,anchorX}){
  const a=THREE.MathUtils.degToRad(azimuth),e=THREE.MathUtils.degToRad(elevation);
  camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),
    Math.cos(a)*Math.cos(e)).multiplyScalar(distance));
  controls.update();
  // A landing path's iris anchor, moved in the same frame as the orbit.
  if(Number.isFinite(anchorX)&&lessonViewport){lessonViewport.ax=anchorX;applyCameraFrame();}
}
function zoomView(direction){
  if(disposed||!controls.enabled)return;
  const from=controls.getDistance(),to=THREE.MathUtils.clamp(from*(direction==='in'?.82:1/.82),controls.minDistance,controls.maxDistance);
  takeViewControl();
  if(reduced.matches){camera.position.sub(controls.target).setLength(to).add(controls.target);controls.update();}
  else zoomAnimation={start:performance.now(),from,to};
  invalidate();
}
$('zoom-in').onclick=()=>zoomView('in');$('zoom-out').onclick=()=>zoomView('out');
function filmAction(action,done){
  if(!isFilm()||(study!=='film'&&interactionStatus!=='intro')||interactionLocked)return;
  if((action==='back'||action==='load')&&!filmDoorMoving){
    const state=film.getState();
    if(action==='load'?!state.canLoad:(!state.canOpen&&state.backOpen===0))return;
    transitionScene(()=>{filmDoorMoving=action;highlightFilmAction(action);},240,()=>filmAction(action,done));
    return;
  }
  const from=film.getState().backOpen;
  const removeAfterOpening=action==='back'&&from===0&&film.getState().phase==='rewound';
  if(action==='back'){
    if(!film.setBackOpen(from>0?from:Math.min(1,from+.001)))return;
  }else if(!film.begin(action))return;
  lockInteraction(true);
  syncFilmControls();publishHost(true);
  const complete=()=>{
    lockInteraction(false);
    filmDoorMoving=removeAfterOpening?'remove':null;
    if(removeAfterOpening){setVisualHighlights([]);done?.();}
    else if(action==='back'&&film.getState().backOpen===0)
      transitionScene(()=>highlightFilmAction(action),240,done);
    else {highlightFilmAction(action);done?.();}
    syncFilmControls();publishHost(true);
    $('caption').textContent=action==='load'?'Film threaded. Close the back before advancing.':
      action==='rewind'?'Film returned to the cartridge. The back can now be opened.':
      action==='release'?'The shutter has released. Wind again to bring fresh film over the gate.':
      action==='advance'?(film.getState().prepared?'Fresh film covers the gate. Ready to take a photo.':'Release the shutter, then wind again to move the exposed brown leader past the gate.'):
      removeAfterOpening?'The rewound cartridge is clear of the open back.':
      'The pressure plate holds the film flat behind the shutter.';
  };
  animate(action==='load'?3800:action==='rewind'?4400:action==='release'?1200:action==='back'?700:1800,(_p,raw)=>{
    if(action==='back')film.setBackOpen(THREE.MathUtils.lerp(from,from>0?0:1,_p));
    else film.update(action==='release'?raw:_p);
    if(action==='release')setExposure(raw,false,true);
    const progress=film.getState().progress;
    if(action==='load'&&progress>=.20)setVisualHighlights([]);
    else highlightFilmAction(action);
    syncFilmControls();
  },()=>{
    if(removeAfterOpening){
      filmDoorMoving='remove';setVisualHighlights([]);
      animate(1100,p=>{film.setCartridgeRemoval(p);syncFilmControls();},complete);
    }else complete();
  });
}
for(const action of ['load','advance','rewind','back','release'])$('film-'+action).onclick=()=>filmAction(action);
function settleInteraction(){
  for(let i=0;i<6&&animation;i++){
    const a=animation;animation=null;a.update(1,1);a.done?.();
  }
  zoomAnimation=null;
}
function canSkipMirrorObservation(){
  // Include the final aperture dissolve: the destination is selected before
  // its animation releases the controls.
  return !demoKind&&(interactionLocked||interactionStatus==='running')&&
    (interactionId==='mirror'||sceneTransition?.mirrorObservation===true);
}
function seedFilmStep(id){
  const perform=action=>{if(film.begin(action))film.update(1);};
  if(id==='load'){film.reset();return;}
  if(!film.getState().loaded){film.reset();perform('load');}
  film.setBackOpen(0);
  for(let i=0;i<6&&!film.getState().prepared;i++)perform(film.getState().canRelease?'release':'advance');
}
function abandonFilmMacro(){
  // A staged rewind deliberately leaves transport.begin active between taps.
  // Restore its original checkpoint before inspecting a different mechanism.
  if(filmMacroPhases[interactionId]&&interactionStatus!=='complete')restoreInteraction?.();
  interactionPhase=null;filmDoorMoving=null;
}
// The landing opens on the Film SLR with its roll loaded (Kent, October 20, 2026: the film camera first and the default), so the
// solid opening, the posters and the first live frame all show it; the tour's model command then finds it already chosen.
if(landing){swapBody('film');seedFilmStep('capture');}
// Use world-space geometry, including the current film phase, so the orbit
// follows the mechanism rather than the body origin or a clickable button.
function setInteractionAnchor(){
  const step=currentInteraction();if(!step)return;
  const id=step.id==='capture'?(isFilm()?'filmGate':'sensor'):step.id==='lensRelease'?'lensMount':step.target;
  model.updateMatrixWorld(true);
  const points=partWorldPoints(registry.get(id),false);
  if(!points.length)return;
  const part=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  // Not exactly on the part but toward it: far out the aim sits most of the way
  // from the body to the part and the body stays in frame; dolly in and it lands
  // on the part (see applyStepAim). The film macros frame their own rear view.
  if(isFilmMacro()){stepAimPoints=null;controls.target.copy(part);return;}
  stepAimPoints={body:BODY_TARGET,part:part.toArray(),far:0};
  controls.target.fromArray(blendAim(BODY_TARGET,stepAimPoints.part,STEP_PART_FAR_SHARE));
}
// The step aim (framing_blend.js) follows the dolly: shifts the camera and its
// target together, so only the aim moves, never the distance or the angle.
let stepAimPoints=null,stepAiming=false;
function applyStepAim(){
  if(!stepAimPoints||stepAiming||sceneTransition||stepAimPoints.far<=0)return;
  const aim=stepAim(stepAimPoints.body,stepAimPoints.part,camera.position.distanceTo(controls.target),
    controls.minDistance,stepAimPoints.far);
  const shift=new THREE.Vector3(...aim).sub(controls.target);
  if(shift.lengthSq()<1e-12)return;
  stepAiming=true;controls.target.add(shift);camera.position.add(shift);controls.update();stepAiming=false;
}
function apertureCenter(){
  model.updateMatrixWorld(true);
  return new THREE.Box3().setFromPoints(partWorldPoints(registry.get('aperture'),false)).getCenter(new THREE.Vector3());
}
function fitInteractionRadius(direction,points,start){
  let radius;
  for(radius=start;radius<controls.maxDistance;radius+=.25){
    camera.position.copy(direction).multiplyScalar(radius).add(controls.target);controls.update();camera.updateMatrixWorld(true);
    if(points.every(point=>{const p=point.clone().project(camera);return Math.abs(p.x)<=.84&&Math.abs(p.y)<=.56&&p.z>=-1&&p.z<=1;}))break;
  }
  return radius;
}
function interactionPose(){
  const rear=isFilmMacro();
  const advancing=rear&&interactionId==='load'&&['advance','release'].includes(interactionPhase);
  const rewinding=rear&&interactionId==='rewind'&&interactionPhase!=='open';
  const direction=rear&&!advancing&&!rewinding?new THREE.Vector3(0,0,-1):
    new THREE.Vector3(...(advancing?[-8,8,-10]:rewinding?[6,5,-10]:[5.6,3.4,8.7])).sub(controls.target).normalize();
  let radius=8;
  if(!rear){
    model.updateMatrixWorld(true);
    const step=currentInteraction();
    const ids=['capture','mirror'].includes(step?.id)?['shutterButton','shutter',recordingPart(),...(isSlr()?['reflexMirror']:[])]:step?[step.target]:[];
    radius=fitInteractionRadius(direction,ids.flatMap(id=>partWorldPoints(registry.get(id),false)),radius);
  }
  if(rear){
    // Door phases face the main body squarely and fit its closed dimensions.
    // The open door may extend offscreen; it must not shrink/recenter the body.
    // Advance and rewind retain their separate elevated rear sides.
    const doorQuaternion=film.back.quaternion.clone(),points=[];
    film.back.rotation.set(0,0,0);model.updateMatrixWorld(true);
    const fitParts=advancing||rewinding?
      ['filmBody','filmBack','filmAdvance','filmRewind','filmRewindRelease','shutterButton','filmStrip','filmCartridge']:
      ['filmBody','filmBack'];
    for(const id of fitParts)
      points.push(...partWorldPoints(registry.get(id),false));
    film.back.quaternion.copy(doorQuaternion);model.updateMatrixWorld(true);
    if(rewinding){
      // Fit the deployed crank before the first release-button prompt. Cover
      // its complete rotation, not just the orientation sampled at this frame.
      const restore=film.checkpoint();
      if(film.getState().phase==='rewinding'||film.begin('rewind')){
        film.update(.30);model.updateMatrixWorld(true);
        const pivot=new THREE.Vector3().fromArray(film.getLayout().rewindPivot);
        const crankPoints=partWorldPoints(registry.get('filmRewind'),false);
        const radius=Math.max(...crankPoints.map(point=>Math.hypot(point.x-pivot.x,point.z-pivot.z)));
        const low=Math.min(...crankPoints.map(point=>point.y)),high=Math.max(...crankPoints.map(point=>point.y));
        for(const x of [-radius,radius])for(const z of [-radius,radius])for(const y of [low,high])
          points.push(new THREE.Vector3(pivot.x+x,y,pivot.z+z));
      }
      restore();model.updateMatrixWorld(true);
    }
    for(radius=advancing||rewinding?9:controls.minDistance;radius<controls.maxDistance;radius+=.25){
      camera.position.copy(direction.clone().multiplyScalar(radius).add(controls.target));controls.update();
      camera.updateMatrixWorld(true);
      if(points.every(point=>{const p=point.clone().project(camera);return Math.abs(p.x)<=.92&&Math.abs(p.y)<=.68&&p.z>=-1&&p.z<=1;}))break;
    }
  }
  camera.position.copy(direction.multiplyScalar(radius).add(controls.target));controls.update();
  viewPreset=advancing?'rear-angle':rewinding?'rewind-angle':rear?'rear':'angle';
}
function introPose(){
  const direction=new THREE.Vector3(5.6,3.4,8.7).sub(controls.target).normalize();
  model.updateMatrixWorld(true);
  const points=partWorldPoints(model);
  let radius;
  for(radius=10;radius<controls.maxDistance;radius+=.25){
    camera.position.copy(direction.clone().multiplyScalar(radius).add(controls.target));controls.update();
    if(points.every(point=>{const p=point.clone().project(camera);return Math.abs(p.x)<=.9&&Math.abs(p.y)<=.6;}))break;
  }
  camera.position.copy(direction.multiplyScalar(radius).add(controls.target));controls.update();viewPreset='angle';
}
function restoreMountCycle(){
  mountCycle?.restore();mountCycle=null;mountProgress=0;
}
function fitLensMountView(){
  const savedPosition=lens.position.clone(),savedQuaternion=lens.quaternion.clone(),savedRelease=lensRelease.position.clone();
  mountCycle?.restore();
  const sample=createLensMountCycle({lens,release:lensRelease,angle:insertAngle-lockedAngle}),points=[];
  for(const progress of [0,.30,.50,.80,1]){
    sample.update(progress);model.updateMatrixWorld(true);
    points.push(...partWorldPoints(lens,false),...partWorldPoints(shell,false));
    if(isFilm())points.push(...partWorldPoints(film.filmBody,false));
  }
  sample.restore();lens.position.copy(savedPosition);lens.quaternion.copy(savedQuaternion);lensRelease.position.copy(savedRelease);
  model.updateMatrixWorld(true);
  const direction=new THREE.Vector3(4.5,7,10).sub(controls.target).normalize();
  const radius=fitInteractionRadius(direction,points,9);
  camera.position.copy(direction.multiplyScalar(radius).add(controls.target));controls.update();viewPreset='mount-angle';
}
function configureIntro(){
  restoreMountCycle();
  explorationInternals=false;controls.target.set(...BODY_TARGET);stepAimPoints=null;
  interactionId=null;interactionStatus='intro';interactionPhase=null;restoreInteraction=null;filmDoorMoving=null;
  film.reset();dslr.setMirrorRaised(0);inspect('camera');highlightPart(null);introPose();
  $('caption').textContent='Look around the camera, then start exploring its mechanisms.';
}
// Concept loops: mirrorless internals in a fixed 3/4 pose, without chrome or
// input. Translucent curtains keep the recorded pixels visible once closed.
// Each command replays one shot that holds its last frame; nothing renders
// afterwards until the host restarts it or the frame resizes. Lessons start
// still and play one shot or gain change per `setting`.
const DEMO_VIEW=new THREE.Vector3(5,2.9,9).normalize(),DEMO_CURTAIN=.4;
// The balance lesson looks across the optical axis from the front right, so
// the iris (nearer, on the left) and the sensor (behind, on the right) sit
// side by side with no overlap and light reads left to right.
const BALANCE_VIEW=new THREE.Vector3(8.2,2.6,5.4).normalize();
// The shutter lab's three-quarter look (Kent, October 11, 18:34: "it's still at a
// three-quarters angle horizontally, but the vertical angle should have no
// tilt"): 29 degrees round from the lens axis, pitch 0, level with the shutter,
// so the swing to the side view (also pitch 0) is only a turn around it.
const SHUTTER_YAW=Math.atan2(5,9),SHUTTER_VIEW=new THREE.Vector3(Math.sin(SHUTTER_YAW),0,Math.cos(SHUTTER_YAW));
// Tight: the shutter and sensor fill most of the width (LESSON_FILL was .57).
const SHUTTER_FILL=.88;
const demoView=()=>isBalance()?BALANCE_VIEW:demoKind==='shutter-lesson'?SHUTTER_VIEW:DEMO_VIEW;
function setDemo(kind){
  const next=DEMOS.includes(kind)||LESSONS.includes(kind)||kind===BALANCE_DEMO?kind:null;
  if(next&&next===demoKind){(isLesson()?startLesson:playDemo)();return;}
  if(!next&&!demoKind)return;
  clearTapLabel();
  if(demoKind)animation=null;
  else{if(mountCycle){animation=null;restoreMountCycle();}settleInteraction();abandonFilmMacro();}
  resetSide();
  sceneTransition=null;revealing=false;disposeDissolve();highlightFader.finish();lockInteraction(false);
  demoKind=next;demoComplete=false;demoPoints=[];lessonViewAnimation=null;zoomAnimation=null;
  document.documentElement.classList.toggle('demo',Boolean(next));
  controls.enabled=!next||isLesson();controls.maxDistance=20;
  model.rotation.y=0;sensorSurface.material.uniforms.sensorGain.value=0;
  sensorSurface.material.uniforms.lessonIso.value=next==='iso-lesson'?1:0;
  // The shutter lesson lifts dim stops into view; the balance lesson shows
  // its one balanced level as the plain signal.
  sensorSurface.material.uniforms.lessonLift.value=demoKind==='shutter-lesson'?1:0;
  // The shutter lesson's light on the sensor is near white (Kent, October 11), and so is the Lab's.
  sensorSurface.material.uniforms.exposureWhite.value=demoKind==='shutter-lesson'||!demoKind?1:0;
  setSensorTextureGain(0);
  sensorSurface.material.uniforms.sensorSweep.value.set(0,0,0);sensorSurface.material.uniforms.sensorGlow.value=0;
  if(next){dslr.setVariant('mirrorless');film.setEnabled(false);$('camera-model').value='mirrorless';$('study-film').hidden=true;}
  configureIntro();
  if(!next){publishHost(true);invalidate();return;}
  // Fit the exterior, at both ends of any pan, before it becomes x-ray context.
  // Lessons fit the shutter and sensor instead, closer, with the body around them.
  for(const yaw of new Set([0,next==='shutter'?DEMO_PAN:0])){
    model.rotation.y=yaw;model.updateMatrixWorld(true);
    demoPoints.push(...(isLesson()?lessonFramePoints():partWorldPoints(model)));
  }
  model.rotation.y=0;model.updateMatrixWorld(true);
  inside=true;viewPreset=isLesson()?'front':'demo';
  immediateHighlights=true;
  try{
    highlightPart('shutter');
    // Balance: the iris and the shutter are the mechanism, both in blue ink.
    if(isBalance())setVisualHighlights(['shutter','aperture']);
    highlightFader.finish();
  }finally{immediateHighlights=false;}
  if(isLesson())setLessonCurtainOpacity(next==='iso-lesson'?1:SHUTTER_CURTAIN_OPACITY);
  else for(const blade of blades.flat()){
    const m=blade.material;
    if(!m.transparent){m.transparent=true;m.needsUpdate=true;}
    m.opacity=m.uniforms.opacity.value=DEMO_CURTAIN;m.depthWrite=false;
  }
  demoPose();(isLesson()?startLesson:playDemo)();
  if(isLesson())warmReveal();
}
// The first-page reveal blends two passes (scene_dissolve.js), whose programs
// are new to the GPU: built on the reveal's first frame they block the page
// for a beat, and the host (which lifts its cover as it posts the reveal)
// shows the stale close-up pose. Draw one throwaway blend per reveal pose
// here, while the host still covers the frame, so the reveal starts warm.
function warmReveal(){
  if(reduced.matches||disposed)return;
  const saved={position:camera.position.clone(),target:controls.target.clone(),context:{...lastContext}};
  const warm=createSceneDissolve(renderer,scene);
  try{
    for(const pose of [headOnView(),saved]){
      controls.target.copy(pose.target);camera.position.copy(pose.position);controls.update();
      warm.render(scene,camera,.5,()=>applyPartContext(null,0),()=>applyPartContext('shutter',1));
      // The plain canvas draws that open and close the reveal.
      applyPartContext(null,0);renderer.render(scene,camera);
      applyPartContext('shutter',1);renderer.render(scene,camera);
    }
  }finally{
    warm.dispose();
    controls.target.copy(saved.target);camera.position.copy(saved.position);controls.update();
    applyPartContext(saved.context.id,saved.context.amount);invalidate();
  }
}
// The Lab's first Look inside dissolves two passes (scene_dissolve.js) whose
// programs are new to the GPU: compiled on that first toggle they cost a
// ~190 ms frame at 4x CPU. Draw one throwaway blend of the same two states
// once the Lab is up and idle, then put the scene back and redraw it plainly in
// the same task, so no blended frame is ever presented.
function warmLabDissolve(){
  if(disposed||demoKind||reduced.matches||document.hidden)return;
  if(inside||revealing||study!=='camera'||animation||sceneTransition||solidRevealState||interactionLocked)return;
  const parts=[shell,lens,internals,lensBarrel,lensRig.focus,lensRig.zoom,lensRig.iris];
  const visible=parts.map(part=>part.visible),saved={...lastContext};
  const warm=createSceneDissolve(renderer,scene);
  try{
    warm.render(scene,camera,.5,()=>{applyPartContext(null,0);setCameraGeometryVisibility();},
      ()=>{showContextGeometry();applyPartContext('shutter');lensRig.updateContextOutlines(camera);});
  }finally{
    warm.dispose();
    parts.forEach((part,i)=>{part.visible=visible[i];});
    applyPartContext(saved.id,saved.amount);renderer.render(scene,camera);
  }
}
// Lesson curtains are opaque at rest and while they move. After an exposure
// they turn translucent (never clear) so the recorded light shows through.
function setLessonCurtainOpacity(opacity){
  lessonCurtainOpacity=opacity;
  for(const blade of blades.flat()){
    const m=blade.material,transparent=opacity<1;
    if(m.transparent!==transparent){m.transparent=transparent;m.needsUpdate=true;}
    m.opacity=m.uniforms.opacity.value=opacity;m.depthWrite=!transparent;
  }
}
// The shutter lesson's side view (shutter_side_view.js, Kent, October 11):
// the same shutter and sensor meshes, the rest of the body faded out, the two
// split apart along the lens axis and seen from a slightly angled side pose,
// with one light volume through the curtain window while a shot is open.
// `phase` is 'front' | 'turning' | 'side'; `end` the pose it lands on.
const side={phase:'front',split:0,end:null,points:[],epoch:0,box:null};
const shutterRestZ=shutter.position.z,sensorRestZ=sensor.position.z;
const SIDE_VIEW=new THREE.Vector3(...sideViewDirection());
// One mesh, one material: a box re-placed every frame on the curtain window.
const beam=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({
  color:warmColor.clone(),transparent:true,opacity:BEAM_OPACITY,depthWrite:false}));
beam.name='shutterLightVolume';beam.visible=false;beam.renderOrder=2;internals.add(beam);
let sideKeep=null;
const sideKept=()=>{
  if(!sideKeep){sideKeep=new Set();for(const id of ['shutter','sensor'])registry.get(id).traverse(o=>sideKeep.add(o));}
  return sideKeep;
};
// The shutter holds still; the sensor slides back the gap (splitOffsets).
function setSplit(p){
  const o=splitOffsets(p);
  side.split=p;shutter.position.z=shutterRestZ+o.shutter;sensor.position.z=sensorRestZ+o.sensor;
}
// The lesson's x-ray treatment, then everything but the shutter and the
// sensor faded by `f` (hidden at 1).
function applySideFade(f){
  applyPartContext('shutter',1);
  if(f<=0)return;
  const keep=sideKept();
  for(const {object,material:m} of visualEntries){
    if(keep.has(object))continue;
    if(f>=1){object.visible=false;continue;}
    m.opacity*=1-f;if(m.uniforms?.opacity)m.uniforms.opacity.value=m.opacity;
    if(!m.transparent){m.transparent=true;m.needsUpdate=true;}
    m.depthWrite=false;
  }
}
// Where the light runs, in the shutter's parent frame: the frame opening, the
// shutter plane between the curtains and the sensor's front face.
const beamFrame=()=>({halfWidth:.825*shutter.scale.x,halfHeight:.55*shutter.scale.y,centerY:shutter.position.y,
  shutterZ:shutter.position.z+.0075,sensorZ:sensor.position.z+sensorCenterZ+sensorFrontZ()+.002,lead:BEAM_LEAD});
function updateBeam(curtains){
  const box=side.phase==='side'?beamBox(curtains.first,curtains.second,beamFrame()):null;
  side.box=box;beam.visible=Boolean(box);
  if(!box)return;
  beam.position.set((box.x0+box.x1)/2,(box.y0+box.y1)/2,(box.z0+box.z1)/2);
  beam.scale.set(box.x1-box.x0,box.y1-box.y0,box.z1-box.z0);
  beam.material.color.copy(sensorSurface.material.uniforms.exposureWarm.value);
}
// The side pose framing the split shutter and sensor, closer than the front
// view (SIDE_FILL) and centred toward the sensor (SIDE_SENSOR_BIAS).
function sidePose(){
  const position=camera.position.clone(),target=controls.target.clone(),split=side.split;
  setSplit(1);model.updateMatrixWorld(true);
  side.points=lessonFramePoints();
  side.sensorCentre=new THREE.Box3().setFromPoints(partWorldPoints(sensor,false)).getCenter(new THREE.Vector3());
  demoPose(side.points,SIDE_VIEW);
  const end={position:camera.position.clone(),target:controls.target.clone()};
  setSplit(split);model.updateMatrixWorld(true);
  camera.position.copy(position);controls.target.copy(target);controls.update();
  return end;
}
function setSideView(on){
  if(demoKind!=='shutter-lesson')return;
  if(on){startSide();return;}
  if(side.phase==='front')return;
  resetSide();applyPartContext('shutter',1);viewPreset='front';demoPose();
}
// Fade, then turn (the sensor still against the shutter), then the sensor
// slides back: one eased tween per phase, never concurrent. The learner's
// orbit stays live throughout. Reduced motion cross-fades to the side pose.
function startSide(){
  if(side.phase!=='front')return;
  if(animation&&!demoComplete){
    // A shot still running lands on its last frame first.
    animation=null;shotUpdate(shotSeconds(lessonSetting));demoComplete=true;lockInteraction(false);
  }
  const from={position:camera.position.clone(),target:controls.target.clone()};
  side.phase='turning';side.epoch=manualViewEpoch;side.end=sidePose();
  if(reduced.matches){crossFadeSide(from);return;}
  const move=orbitBetween(from.position,side.end.position,from.target,side.end.target),sample={};
  animation={start:performance.now(),duration:SIDE_SECONDS*1000,side:true,
    update:(_ease,p)=>{sideViewPhase(p*SIDE_SECONDS,sample);applySideFade(sample.fade);setSplit(sample.split);move(sample.turn);},
    done:finishSide};
  invalidate();
}
function crossFadeSide(from){
  const before=snapshotVisuals();
  applySideFade(1);setSplit(1);
  const after=snapshotVisuals(),to=side.end;
  const pose=p=>{camera.position.copy(p.position);controls.target.copy(p.target);controls.update();};
  dissolve??=createSceneDissolve(renderer,scene);
  sceneTransition={before:()=>{before();pose(from);},after:()=>{after();pose(to);},amount:0};
  animation={start:performance.now(),duration:SIDE_REDUCED_SECONDS*1000,side:true,
    update:(_ease,p)=>{if(sceneTransition)sceneTransition.amount=p;},
    done:()=>{before.dispose();finishSide();}};
  invalidate();
}
function finishSide(){
  if(side.phase!=='turning')return;
  if(animation?.side)animation=null;
  if(sceneTransition){sceneTransition=null;disposeDissolve();}
  applySideFade(1);setSplit(1);
  if(side.epoch===manualViewEpoch){camera.position.copy(side.end.position);controls.target.copy(side.end.target);viewPreset='front';}
  else{
    // The learner took the view mid-turn: keep their angle and distance.
    const offset=camera.position.clone().sub(controls.target);
    controls.target.copy(side.end.target);camera.position.copy(controls.target).add(offset);
  }
  controls.update();side.phase='side';
  publishHost(true);invalidate();
}
function resetSide(){
  if(animation?.side)animation=null;
  if(side.phase==='turning'&&sceneTransition){sceneTransition=null;disposeDissolve();}
  side.phase='front';side.end=null;side.points=[];side.box=null;side.sensorCentre=null;
  setSplit(0);beam.visible=false;
}
// The shutter lesson rests closed and opaque over a clean sensor; only a shot
// moves the curtains. The ISO lesson never teaches the shutter: its curtains
// stay open over the recorded image.
function startLesson(){
  animation=null;lockInteraction(false);demoComplete=true;lessonElapsed=0;lessonShotGeneration=0;
  if(isBalance()){startBalance();return;}
  // A restart returns from the side view to the front.
  if(side.phase!=='front'){resetSide();applyPartContext('shutter',1);viewPreset='front';demoPose();}
  const iso=demoKind==='iso-lesson',u=sensorSurface.material.uniforms;
  lessonSetting=iso?0:SHUTTER_DEFAULT;shotFrame(lessonSetting,0,shotSample);shotStartExposure=0;
  setLessonCurtainOpacity(iso?1:SHUTTER_CURTAIN_OPACITY);
  setShutter(iso?.5:0,iso?{first:1,second:0}:shotSample);
  u.sensorSweep.value.set(0,0,0);u.sensorGlow.value=0;u.sensorExposure.value=iso?LESSON_ISO_EXPOSURE:0;u.sensorGain.value=0;
  setSensorTextureGain(0);
  publishHost(true);invalidate();
}
// Every shutter setting takes one shot at that speed: the first curtain opens,
// the second closes, and the closed shutter then turns translucent. ISO eases
// the gain over the recorded image. Both then hold still.
function applySetting(value){
  if(!Number.isInteger(value)||value<0||value>(demoKind==='iso-lesson'?ISO_MAX:SHUTTER_MAX))return;
  // A shot arriving mid-turn lands the side view first.
  if(side.phase==='turning')finishSide();
  animation=null;lessonSetting=value;lessonElapsed=0;demoComplete=false;lockInteraction(true);
  const done=()=>{demoComplete=true;lockInteraction(false);publishHost(true);};
  if(demoKind==='iso-lesson'){
    const gain=sensorSurface.material.uniforms.sensorGain,from=gain.value,to=value/ISO_MAX;
    animate(GAIN_SECONDS*1000,(p,raw)=>{
      lessonElapsed=raw*GAIN_SECONDS;gain.value=THREE.MathUtils.lerp(from,to,p);setSensorTextureGain(gain.value);
    },done);
  }else{
    // The last recording fades from the sensor before the first curtain moves.
    lessonShotGeneration++;shotStartExposure=lessonRecordedExposure();
    const seconds=shotSeconds(value);shotUpdate(0);
    // Reduced motion lands on the last frame, except in the side view, where
    // the beam still stands for the shot's open time (without the sweep).
    animate(seconds*1000,(_p,raw)=>shotUpdate(raw*seconds),done,{still:side.phase==='side'});
  }
  publishHost(true);
}
// The sensor's whole-frame exposure now: the sweep's uniform final once a
// shot is over, else the plain exposure.
function lessonRecordedExposure(){
  const u=sensorSurface.material.uniforms;
  return u.sensorSweep.value.z>0?shotSample.exposure:u.sensorExposure.value;
}
function shotUpdate(seconds){
  const s=shotFrame(lessonSetting,seconds,shotSample),u=sensorSurface.material.uniforms;
  // Reduced motion in the side view: the whole window open, no sweep.
  const plain=reduced.matches&&side.phase==='side',curtains=plain?reducedCurtains(s.front,s.back):s;
  lessonElapsed=seconds;setShutter(s.value,curtains);setLessonCurtainOpacity(s.opacity);
  // Light arriving glows in the open gap. Reduced motion jumps to the final
  // frame, where no light is arriving, so it never shows a glow.
  u.sensorGlow.value=reduced.matches?0:s.glow;
  updateBeam(curtains);
  if(plain&&s.front>0){u.sensorSweep.value.set(0,0,0);u.sensorExposure.value=s.exposure;return;}
  if(s.front<=0){
    // Before the first curtain moves, the last recording fades to dark
    // behind the translucent curtains.
    u.sensorSweep.value.set(0,0,0);
    u.sensorExposure.value=shotStartExposure*(1-smooth(seconds/SHOT_LEAD));
    return;
  }
  // Each row builds toward the final exposure while it lies in the open gap,
  // so the slit paints the frame.
  u.sensorSweep.value.set(s.front,s.back,shotSweepScale(lessonSetting));u.sensorExposure.value=s.exposure;
}
// The balance lesson rests at the anchor (f/8, 1/125) over a clean sensor,
// closed and translucent, until the host fires a shot.
function startBalance(){
  const u=sensorSurface.material.uniforms;
  Object.assign(balance,{a:3,s:7,shotA:3,shotS:7});setBalanceIris(balance.a);
  balanceShotFrame(balance.a,balance.s,0,shotSample);shotStartExposure=0;
  setLessonCurtainOpacity(BALANCE_CURTAIN_REST);setShutter(0,shotSample);
  u.sensorSweep.value.set(0,0,0);u.sensorGlow.value=0;u.sensorExposure.value=0;u.sensorGain.value=0;
  publishHost(true);invalidate();
}
// Lesson aperture index (0 = f/2.8) to the rig's value (1 = wide open).
function setBalanceIris(a){lensRig.setAperture(1-a/BALANCE_APERTURE_MAX);invalidate();}
const balancePair=value=>{
  const a=value?.a,s=value?.s;
  return isBalanceSetting(a,s)?{a,s}:null;
};
// The host's ruler moved: the iris follows at once; a running shot keeps
// the light it started with.
function setBalance(value){
  const pair=balancePair(value);if(!pair)return;
  balance.a=pair.a;balance.s=pair.s;setBalanceIris(pair.a);
}
// One shot: the last recording fades from the sensor, the curtains cross at
// the shutter speed, and the light that arrives through the iris builds
// the yellow as intensity x time. Reduced motion lands on the end state.
function fireBalance(value){
  const pair=balancePair(value);if(!pair)return;
  setBalance(pair);
  animation=null;balance.shotA=pair.a;balance.shotS=pair.s;lessonElapsed=0;demoComplete=false;
  lessonShotGeneration++;shotStartExposure=lessonRecordedExposure();
  const seconds=balanceShotSeconds(pair.s);balanceUpdate(0);
  animate(seconds*1000,(_p,raw)=>balanceUpdate(raw*seconds),()=>{demoComplete=true;publishHost(true);});
  publishHost(true);
}
function balanceUpdate(seconds){
  const s=balanceShotFrame(balance.shotA,balance.shotS,seconds,shotSample),u=sensorSurface.material.uniforms;
  lessonElapsed=seconds;setShutter(s.value,s);setLessonCurtainOpacity(s.opacity);
  u.sensorGlow.value=reduced.matches?0:s.glow;
  if(s.front<=0){
    u.sensorSweep.value.set(0,0,0);
    u.sensorExposure.value=shotStartExposure*(1-smooth(seconds/SHOT_LEAD));
    return;
  }
  u.sensorSweep.value.set(s.front,s.back,s.scale);u.sensorExposure.value=s.exposure;
}
// What the host needs: the pair shown and shot, the shot count, how far the
// shot has run, the yellow level it has left (the sensor's mean displayed
// signal) and the white light's strength now.
function getBalanceState(){
  const u=sensorSurface.material.uniforms;
  return {balance:{a:balance.a,s:balance.s},shot:{a:balance.shotA,s:balance.shotS},lessonShotGeneration,
    exposureProgress:lessonShotGeneration===0?1:balanceShotProgress(balance.shotS,lessonElapsed),
    exposureLevel:Math.round(u.sensorExposure.value*1e4)/1e4,
    lightLevel:Math.round(u.sensorGlow.value*1e4)/1e4};
}
function playDemo(){
  demoComplete=false;lockInteraction(true);demoUpdate(0);
  animate(DEMO_SECONDS*1000,(_p,raw)=>demoUpdate(raw*DEMO_SECONDS),()=>{
    demoComplete=true;lockInteraction(false);publishHost(true);
  });
  publishHost(true);
}
function demoUpdate(seconds){
  const s=demoFrame(demoKind,seconds,demoSample),u=sensorSurface.material.uniforms;
  lightOnSensor(setShutter(s.value));u.sensorExposure.value=s.exposure;u.sensorGain.value=s.gain;model.rotation.y=s.pan;
  setSensorTextureGain(s.gain||0);
}
// Closed-form fit along the fixed direction: the nearest radius keeping every
// exterior point within 93% x 90% of the frame, re-centred on its projection.
// Lessons keep the shutter and sensor within 57% so the light on the pixels
// reads on a phone; the cropped body and lens rings remain as context.
const demoRight=new THREE.Vector3(),demoUp=new THREE.Vector3(),demoRel=new THREE.Vector3(),LESSON_FILL=.57;
// The balance lesson frames the iris and the sensor together, a wider pair.
const BALANCE_FILL=.8;
// Balance frames the iris by its housing ring (the leaves' bounding boxes
// reach past it) beside the shutter and sensor.
const IRIS_RING=Array.from({length:48},(_,i)=>[Math.cos(i*Math.PI/24)*.835,Math.sin(i*Math.PI/24)*.835]);
const irisRingPoints=()=>{
  lensRig.iris.updateMatrixWorld(true);
  return IRIS_RING.flatMap(([x,y])=>[0,.07].map(z=>lensRig.iris.localToWorld(new THREE.Vector3(x,y,z))));
};
const lessonFramePoints=()=>[...partWorldPoints(shutter,false),...partWorldPoints(sensor,false),
  ...(isBalance()?irisRingPoints():[])];
// The side view frames its own split pose from its own direction, closer
// (SIDE_FILL), then moves its orbit centre toward the sensor.
function demoPose(points=side.phase==='front'?demoPoints:side.points,view=side.phase==='front'?demoView():SIDE_VIEW){
  if(!points.length)return;
  const sidePoints=points===side.points;
  const fill=isBalance()?BALANCE_FILL:demoKind==='shutter-lesson'?SHUTTER_FILL:LESSON_FILL;
  // The side pair is tall and narrow at the side angle: its width is what
  // fills SIDE_FILL, with room to stand taller (SIDE_FILL_Y).
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),
    [fx,fy]=sidePoints?[SIDE_FILL,SIDE_FILL_Y]:isLesson()?[fill,fill]:[.93,.9];
  const sx=tan*camera.aspect*fx,sy=tan*fy;
  demoRight.crossVectors(camera.up,view).normalize();demoUp.crossVectors(view,demoRight);
  controls.target.copy(new THREE.Box3().setFromPoints(points).getCenter(demoRel));
  let radius=0;
  for(let pass=0;;pass++){
    radius=0;
    for(const p of points){
      const z=demoRel.subVectors(p,controls.target).dot(view);
      radius=Math.max(radius,z+Math.abs(demoRel.dot(demoRight))/sx,z+Math.abs(demoRel.dot(demoUp))/sy);
    }
    if(pass===2)break;
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    for(const p of points){
      const depth=radius-demoRel.subVectors(p,controls.target).dot(view);
      const x=demoRel.dot(demoRight)/depth/sx,y=demoRel.dot(demoUp)/depth/sy;
      left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y);
    }
    controls.target.addScaledVector(demoRight,(left+right)/2*radius*sx).addScaledVector(demoUp,(bottom+top)/2*radius*sy);
  }
  if(sidePoints&&side.sensorCentre){
    // The orbit centre (and with it the camera) moves toward the sensor; the
    // radius is refitted around it so both plates stay inside the fill.
    controls.target.fromArray(biasedTarget(controls.target.toArray(),side.sensorCentre.toArray()));
    radius=0;
    for(const p of points){
      const z=demoRel.subVectors(p,controls.target).dot(view);
      radius=Math.max(radius,z+Math.abs(demoRel.dot(demoRight))/sx,z+Math.abs(demoRel.dot(demoUp))/sy);
    }
  }
  camera.position.copy(controls.target).addScaledVector(view,radius);camera.lookAt(controls.target);
  if(isLesson()){controls.minDistance=radius*.55;controls.maxDistance=radius*2.5;controls.update();}
  invalidate();
}
// View motion is independent of the shutter/gain timeline. Returning to Front
// must neither restart a shot nor mark it complete.
function lessonFrontView(){
  takeViewControl();
  const from=camera.position.clone(),target=controls.target.clone();
  demoPose();
  const to=camera.position.clone(),toTarget=controls.target.clone();
  viewPreset='front';
  if(reduced.matches){publishHost(true);return;}
  camera.position.copy(from);controls.target.copy(target);controls.update();
  lessonViewAnimation={start:performance.now(),update:orbitBetween(from,to,target,toTarget)};
  invalidate();
}
function configureInteraction(id){
  explorationInternals=false;
  restoreMountCycle();
  interactionId=id;interactionStatus='ready';interactionPhase=isFilmMacro()?(id==='load'?'thread':'release'):null;
  filmDoorMoving=null;
  if(isFilm()&&['load','capture','mirror','rewind'].includes(id))seedFilmStep(id);
  const step=currentInteraction();
  inspect(step.slider?'lens':['mountMarks','lensRelease'].includes(id)?'mount':isFilmMacro()?'film':'camera');
  if(id==='capture'||id==='mirror')inside=true;
  if(id==='mirror')setExposure(0,false);
  if(id==='load')filmDoorMoving='ready';
  showContextGeometry();highlightPart(step.target);
  setInteractionAnchor();
  if(id==='lensRelease')fitLensMountView();else interactionPose();
  if(stepAimPoints)stepAimPoints.far=camera.position.distanceTo(controls.target);
  restoreInteraction=isFilm()?film.checkpoint():null;
}
function selectInteraction(id){
  clearTapLabel();
  if(!cameraInteractions($('camera-model').value).some(step=>step.id===id))return;
  // Cancelling a lens demonstration restores its checkpoint directly rather
  // than playing its completion callback and resetting the whole sequence.
  if(mountCycle){animation=null;restoreMountCycle();lockInteraction(false);}
  settleInteraction();abandonFilmMacro();
  transitionScene(()=>configureInteraction(id),700,beginInteraction);
}
function beginInteraction(){
  if(!currentInteraction()?.automatic){publishHost(true);return;}
  interactionStatus='watching';lockInteraction(true);publishHost(true);
  // The pause is reading time, including when motion is reduced. It shares
  // the animation lifecycle so changing steps cannot leave a delayed action.
  animate(500,()=>{},()=>{
    lockInteraction(false);interactionStatus='running';publishHost(true);
    shoot(()=>{
      const finish=()=>{setExposure(1,false);finishInteraction();};
      if(reduced.matches){lockInteraction(true);animate(600,()=>{},finish,{still:true});}
      else finish();
    });
  },{still:true});
}
function readyFilmPhase(phase){
  const changeAngle=interactionId==='load'&&interactionPhase==='close'&&phase==='advance'&&viewPreset==='rear'||
    interactionId==='rewind'&&interactionPhase==='wind'&&phase==='open'&&viewPreset==='rewind-angle';
  interactionPhase=phase;interactionStatus='ready';lockInteraction(false);
  transitionScene(()=>{
    const offset=camera.position.clone().sub(controls.target);
    highlightPart(currentInteraction().target);setInteractionAnchor();
    if(changeAngle)interactionPose();
    else {camera.position.copy(controls.target).add(offset);controls.update();}
  },700,()=>publishHost(true));
  syncFilmControls();publishHost(true);invalidate();
}

function runFilmMacro(){
  const phase=interactionPhase;
  if(interactionId==='load'){
    const action={thread:'load',close:'back',advance:'advance',release:'release'}[phase];
    filmAction(action,()=>{
      const s=film.getState();
      if(s.prepared){finishInteraction();return;}
      readyFilmPhase(phase==='thread'?'close':s.releaseDue?'release':'advance');
    });return;
  }
  if(phase==='open'){filmDoorMoving='ready';filmAction('back',finishInteraction);return;}
  const range={release:[0,.12,650,'unfold'],unfold:[.12,.30,900,'wind'],wind:[.30,1,3000,'open']}[phase];
  if(phase==='release'&&!film.begin('rewind')){interactionStatus='ready';publishHost(true);return;}
  lockInteraction(true);
  animate(range[2],p=>{film.update(THREE.MathUtils.lerp(range[0],range[1],p));highlightPart(currentInteraction().target);},
    ()=>readyFilmPhase(range[3]));
}
function finishInteraction(){
  // Keep the completed motion visible briefly, then continue without another
  // button press. Reduced motion skips the dwell along with other animations.
  interactionStatus='complete';lockInteraction(true);publishHost(true);
  animate(600,()=>{},()=>{lockInteraction(false);advanceInteraction();});
}
function advanceInteraction(){
  const next=nextCameraInteraction($('camera-model').value,interactionId);
  if(next)selectInteraction(next);
  else transitionScene(configureIntro,700,()=>publishHost(true));
}
function triggerInteraction(){
  if(interactionLocked||interactionStatus!=='ready')return;
  const step=currentInteraction();
  if(!step||step.slider||step.automatic)return;
  interactionStatus='running';publishHost(true);
  if(isFilmMacro()){runFilmMacro();return;}
  if(step.id==='capture'){shoot(finishInteraction);return;}
  if(step.id==='lensRelease'){
    mountCycle=createLensMountCycle({lens,release:lensRelease,angle:insertAngle-lockedAngle});
    lockInteraction(true);animate(7000,(_p,raw)=>{
      mountProgress=raw;const pose=mountCycle.update(raw);
      $('caption').textContent={press:'Press the release to unlock the lens.',unlock:'Turn the lens stripe to the removal dot.',
        withdraw:'Withdraw the aligned lens from the mount.',removed:'Keep the lens stripe aligned with the dot.',
        insert:'Seat the lens fully while the marks remain aligned.',lock:'Turn the stripe back to the locked line.',seated:'The lens is seated and locked.'}[pose.phase];
    },()=>{restoreMountCycle();finishInteraction();});return;
  }
  // Mount-mark steps are observations, not unverified mounting procedures.
  lockInteraction(true);animate(450,()=>{},finishInteraction);
}
function hitInteractionTarget(step,event){
  const ids=step.id==='mountMarks'?['mountMarks','lensMountMark']:[step.target];
  const rect=renderer.domElement.getBoundingClientRect();
  for(const id of ids){
    const group=registry.get(id),meshes=[];
    group.traverse(object=>{if(object.isMesh&&isVisibleInScene(object)&&object.material.visible&&object.material.opacity>.5)meshes.push(object);});
    if(raycaster.intersectObjects(meshes,false).length)return true;
    // Small mechanical controls retain a 44px touch target around the visible
    // geometry, instead of requiring a fingertip to hit a six-pixel button.
    for(const object of meshes){
      const box=new THREE.Box3().setFromObject(object,true),center=box.getCenter(new THREE.Vector3()).project(camera);
      const a=box.min.clone().project(camera),b=box.max.clone().project(camera);
      if(center.z<-1||center.z>1||Math.abs(a.x-b.x)*rect.width/2>44||Math.abs(a.y-b.y)*rect.height/2>44)continue;
      const x=rect.left+(center.x+1)*rect.width/2,y=rect.top+(1-center.y)*rect.height/2;
      if(Math.hypot(event.clientX-x,event.clientY-y)<=22)return true;
    }
  }
  return false;
}
function handleViewport(value){
  if(!value||typeof value!=='object'||!controls.enabled||disposed)return;
  // The visitor took the view: a glide in flight stops exactly where it is.
  if(value.kind==='orbit'||value.kind==='zoom')poseGlide.cancel();
  const finite=(...keys)=>keys.every(key=>typeof value[key]==='number'&&Number.isFinite(value[key]));
  if(value.kind==='tap'){
    if(!finite('x','y')||value.x<0||value.x>1||value.y<0||value.y>1)return;
    const rect=renderer.domElement.getBoundingClientRect();
    tapViewport({clientX:rect.left+value.x*rect.width,clientY:rect.top+value.y*rect.height});
  }else if(value.kind==='orbit'){
    if(!finite('dx','dy','height')||value.height<=0)return;
    if(value.dx===0&&value.dy===0)return;
    takeViewControl();
    const pose=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    pose.theta-=2*Math.PI*value.dx/value.height*controls.rotateSpeed;
    pose.phi=THREE.MathUtils.clamp(pose.phi-2*Math.PI*value.dy/value.height*controls.rotateSpeed,
      controls.minPolarAngle,controls.maxPolarAngle);
    pose.makeSafe();camera.position.setFromSpherical(pose).add(controls.target);controls.update();invalidate();
  }else if(value.kind==='zoom'){
    if(!finite('distance')||value.distance<=0)return;
    takeViewControl();
    camera.position.sub(controls.target).setLength(THREE.MathUtils.clamp(value.distance,controls.minDistance,controls.maxDistance)).add(controls.target);
    controls.update();invalidate();
  }
}
controls.addEventListener('change',()=>{applyStepAim();invalidate();});
renderer.domElement.addEventListener('wheel',takeViewControl,{capture:true,passive:true});
const raycaster=new THREE.Raycaster(); let down=null;
const activePointers=new Set();
let rawDragging=false;
renderer.domElement.addEventListener('pointerdown',e=>{
  activePointers.add(e.pointerId);
  if(activePointers.size===1)rawDragging=false;
  // Once a second pointer joins, this gesture cannot become a tap again,
  // even if one finger stays still or is released before the other.
  down=activePointers.size===1&&e.isPrimary&&e.button===0
    ?{id:e.pointerId,x:e.clientX,y:e.clientY}:null;
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(activePointers.size>1)rawDragging=true;
  if(down?.id===e.pointerId&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>7){down=null;rawDragging=true;}
  if(rawDragging&&activePointers.size)takeViewControl();
});
renderer.domElement.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);down=null;if(!activePointers.size)rawDragging=false;});
window.addEventListener('blur',()=>{activePointers.clear();down=null;rawDragging=false;});
renderer.domElement.addEventListener('pointerup',e=>{
  activePointers.delete(e.pointerId);
  if(!activePointers.size)rawDragging=false;
  const tap=down;down=null;
  if(!tap||tap.id!==e.pointerId||e.button!==0||activePointers.size||Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>7)return;
  tapViewport(e);
});
// A tap on a part names it, then does whatever that part does (some only name).
function tapPart(id){
  showTapLabel(id);
  if(!LABEL_ONLY_PARTS.includes(id))explorePart(id);
}
function explorePart(id){
  const finish=()=>{
    if(id==='shutterButton')setExposure(1,false);
    lockInteraction(false);highlightPart(null);publishHost(true);invalidate();
  };
  // Seed a usable film roll only when a free-exploration control needs it.
  if(isFilm()&&['shutterButton','filmAdvance','filmRewind','filmRewindRelease'].includes(id)&&!film.getState().loaded)seedFilmStep('capture');
  if(id==='shutterButton'){shoot(finish,{revealInternals:explorationInternals});return;}
  if(id==='filmAdvance'){filmAction('advance',finish);return;}
  if(id==='filmRewind'||id==='filmRewindRelease'){filmAction('rewind',finish);return;}
  highlightPart(id);lockInteraction(true);
  if(id==='reflexMirror'){
    animate(2000,p=>dslr.setMirrorRaised(Math.sin(Math.PI*p)),finish);
  }else if(id==='lensRelease'){
    mountCycle=createLensMountCycle({lens,release:lensRelease,angle:insertAngle-lockedAngle});
    animate(7000,(_p,raw)=>mountCycle.update(raw),()=>{restoreMountCycle();finish();});
  }else{
    const name={aperture:'aperture',focusGroup:'focus',zoomGroup:'zoom'}[id];
    const apply={aperture:lensRig.setAperture,focus:lensRig.setFocus,zoom:lensRig.setZoom}[name];
    const initial=Number($(name).value);
    animate(1800,p=>apply(THREE.MathUtils.lerp(initial,initial>.5?0:1,Math.sin(Math.PI*p))),finish);
  }
}
function hitExteriorControl(ids,event){
  // Include the skin in the ray test: a control on the far side of the camera
  // must not respond through the body, even inside its enlarged touch target.
  model.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const meshes=[];
  model.traverse(object=>{if(object.isMesh&&isVisibleInScene(object)&&object.material.visible&&object.material.opacity>.5)meshes.push(object);});
  const owner=object=>{
    for(let part=object;part;part=part.parent)if(ids.includes(part.name))return part.name;
    return null;
  };
  const nearest=ray=>ray.intersectObjects(meshes,false)[0];
  const direct=nearest(raycaster);
  const directId=direct?owner(direct.object):null;
  if(directId)return directId;
  const rect=renderer.domElement.getBoundingClientRect(),probe=new THREE.Raycaster();
  const candidates=[];
  for(const id of ids)registry.get(id).traverse(object=>{
    if(!meshes.includes(object))return;
    const box=new THREE.Box3().setFromObject(object,true),point=box.getCenter(new THREE.Vector3()).project(camera);
    const a=box.min.clone().project(camera),b=box.max.clone().project(camera);
    if(point.z<-1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1||Math.abs(a.x-b.x)*rect.width/2>44||Math.abs(a.y-b.y)*rect.height/2>44)return;
    const distance=Math.hypot(event.clientX-(rect.left+(point.x+1)*rect.width/2),event.clientY-(rect.top+(1-point.y)*rect.height/2));
    if(distance>22)return;
    probe.setFromCamera(new THREE.Vector2(point.x,point.y),camera);
    const hit=nearest(probe);
    if(hit&&owner(hit.object)===id)candidates.push({id,distance});
  });
  return candidates.sort((a,b)=>a.distance-b.distance)[0]?.id;
}
function hitExploreLens(event){
  const rect=renderer.domElement.getBoundingClientRect(),bounds=[];
  model.updateMatrixWorld(true);
  for(const id of ['aperture','focusGroup','zoomGroup']){
    const points=partWorldPoints(registry.get(id),true,.05).map(point=>point.project(camera))
      .filter(point=>point.z>=-1&&point.z<=1);
    if(!points.length)continue;
    const left=rect.left+(Math.min(...points.map(p=>p.x))+1)*rect.width/2;
    const right=rect.left+(Math.max(...points.map(p=>p.x))+1)*rect.width/2;
    const top=rect.top+(1-Math.max(...points.map(p=>p.y)))*rect.height/2;
    const bottom=rect.top+(1-Math.min(...points.map(p=>p.y)))*rect.height/2;
    if(right<rect.left||left>rect.right||bottom<rect.top||top>rect.bottom)continue;
    bounds.push({id,left,right,top,bottom,depth:Math.min(...points.map(p=>p.z))});
  }
  return pickLensTarget(bounds,{x:event.clientX,y:event.clientY});
}
function tapViewport(e){
  if(landing||!controls.enabled||disposed)return;
  if(canSkipMirrorObservation()){
    // Run the same terminal frames and callbacks as an untouched observation,
    // including snapshot restoration, exposure, aperture framing and unlock.
    settleInteraction();publishHost(true);invalidate();return;
  }
  if(interactionLocked)return;
  camera.updateMatrixWorld(true);
  const rect=renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
  if(interactionStatus==='intro'){
    if(!explorationInternals){
      const id=hitExteriorControl(tappablePartIds({film:isFilm()}),e);
      if(id)tapPart(id);
      return;
    }
    const ids=tappablePartIds({internals:true,slr:isSlr(),film:isFilm()});
    const lensIds=['aperture','focusGroup','zoomGroup'];
    // The glass is intentionally translucent. It is a touch surface in the
    // open internals view, rather than requiring an exact hit on its thin rim.
    const hits=ids.flatMap(id=>raycaster.intersectObject(registry.get(id),true)
      .filter(hit=>hit.object.isMesh&&isVisibleInScene(hit.object)&&hit.object.material.visible&&hit.object.material.opacity>(lensIds.includes(id)?.05:.5))
      .map(hit=>({...hit,id}))).sort((a,b)=>a.distance-b.distance);
    const id=hits[0]?.id??ids.filter(id=>!lensIds.includes(id)).find(id=>hitInteractionTarget({id,target:id},e))??hitExploreLens(e);
    if(id)tapPart(id);
    return;
  }
  const step=currentInteraction();
  if(step&&!step.slider){
    if(hitInteractionTarget(step,e)){triggerInteraction();return;}
  }
  if(isFilmMacro())return;
  if(isFilm()&&study==='film'){
    const targets=['filmAdvance','shutterButton','filmBack','filmRewind','filmRewindRelease'];
    const hits=targets.flatMap(id=>raycaster.intersectObject(registry.get(id),true)
      .filter(hit=>hit.object.isMesh&&isVisibleInScene(hit.object)&&hit.object.material.visible&&hit.object.material.opacity>.5)
      .map(hit=>({...hit,id}))).sort((a,b)=>a.distance-b.distance);
    const hit=hits[0];
    if(hit?.id==='filmAdvance')filmAction('advance');
    else if(hit?.id==='shutterButton'){
      if(film.getState().canRelease)filmAction('release');
      else if(film.getState().canCapture)transitionScene(()=>inspect('camera'),700,shoot);
    }else if(hit?.id==='filmBack'&&film.getState().backOpen>0)filmAction('back');
    else if(hit?.id==='filmRewind'||hit?.id==='filmRewindRelease')filmAction('rewind');
    return;
  }
  if(study==='camera' && shell.visible && raycaster.intersectObject(release).length)shoot();
}
// A host may paint this canvas larger than its touch box and name the box
// (fractions of the canvas). The projection then frames the box exactly as a
// canvas of the box's size would, and the rest of the canvas shows what lies
// beyond it, so the model keeps its place and size instead of refitting.
let lessonViewport=null;
function applyCameraFrame(){
  const w=$('stage').clientWidth,h=$('stage').clientHeight;
  if(!w||!h)return;
  const v=lessonViewport;
  // `ax`/`ay` place the orbit target (the iris) within the box, as fractions
  // of it (.5,.5 is the centre): the view offset shifts by the difference.
  // The shutter lab's box may not be square (the speed page's hero): frame it
  // with its own aspect so the fit (SHUTTER_FILL) is of the box's width.
  if(v&&demoKind==='shutter-lesson')camera.aspect=v.width*w/(v.height*h);
  if(v)camera.setViewOffset(v.width*w,v.height*h,v.width*w*(.5-v.ax)-v.x*w,v.height*h*(.5-v.ay)-v.y*h,w,h);
  else{camera.clearViewOffset();camera.aspect=w/h;camera.updateProjectionMatrix();}
}
function setLessonViewport(value){
  lensPoseRequested=true;
  const finite=key=>typeof value?.[key]==='number'&&Number.isFinite(value[key]);
  const unit=key=>finite(key)&&value[key]>=0&&value[key]<=1?value[key]:.5;
  lessonViewport=['x','y','width','height'].every(finite)&&value.width>0&&value.height>0&&
    value.width<=1&&value.height<=1?{x:value.x,y:value.y,width:value.width,height:value.height,
      ax:unit('anchorX'),ay:unit('anchorY')}:null;
  applyCameraFrame();
  // A new box re-frames an untouched shutter view at once (no animation).
  if(demoKind==='shutter-lesson'&&viewPreset==='front'&&!animation&&!lessonViewAnimation)demoPose();
  invalidate();
}
// Instantly (no dissolve from the camera study) shows the lens study from
// `azimuth`/`elevation` degrees around the iris at `distance`.
function lensView(value){
  const finite=key=>typeof value?.[key]==='number'&&Number.isFinite(value[key]);
  if(!['azimuth','elevation','distance'].every(finite))return;
  if(interactionLocked)settleInteraction();
  if(interactionLocked)return;
  if(study!=='lens'){
    immediateHighlights=true;
    try{inspect('lens');highlightFader.finish();}finally{immediateHighlights=false;}
  }
  if(study!=='lens')return;
  animation=null;zoomAnimation=null;
  const azimuth=THREE.MathUtils.degToRad(value.azimuth),elevation=THREE.MathUtils.degToRad(value.elevation);
  const distance=THREE.MathUtils.clamp(value.distance,controls.minDistance,controls.maxDistance);
  camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(azimuth)*Math.cos(elevation),
    Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation)).multiplyScalar(distance));
  controls.update();viewPreset='lens-angle';invalidate();
  if(landing)landingPosedFrame=renderedFrames;
}
// The first time a lesson shows the camera (Kent, October 6): the whole body
// solid and head-on, held for `hold` ms, then one `flight` ms move into the
// part's focus view while the body dissolves to its wire sketch. The part
// stays solid throughout: both dissolve passes draw it. The host sends the
// eased progress of the move (`travel`) and of the dissolve (`wire`) as
// sample tables over the flight. `view` is the focus view; each part names
// how to reach it (the shutter and sensor lessons add theirs here).
const REVEAL_FOCUS={aperture:view=>{lensView(view);return study==='lens';},
  // The shutter lesson's focus view is its own framed pose of the shutter and
  // sensor (the `demo` command must already be 'shutter-lesson').
  shutter:()=>{if(demoKind!=='shutter-lesson')return false;lessonViewAnimation=null;demoPose();return true;},
  // The ISO lesson's sensor: its lesson pose (shutter and sensor framed in the
  // x-ray view), entered here if the host has not started it yet.
  sensor:()=>{if(demoKind!=='iso-lesson')setDemo('iso-lesson');else demoPose();return demoKind==='iso-lesson';},
  // The balance lesson's iris and sensor, side by side in its own pose.
  balance:()=>{if(!isBalance())setDemo(BALANCE_DEMO);else{lessonViewAnimation=null;demoPose();}return isBalance();}};
// How much of the touch box the whole head-on body fills.
const REVEAL_FILL=.82;
function solidReveal(value){
  const part=value?.part,focus=REVEAL_FOCUS[part];
  if(!focus)return;
  pendingLandingPath=null;
  if(solidRevealState)finishSolidReveal(solidRevealState);
  // Landing (`fromCurrent`): fly from the view already on screen (the poster's
  // three-quarter body) instead of cutting to head-on first.
  // `from` {azimuth, elevation, distance} names that view about the current orbit
  // target, so the flight starts there even if a pose sent just before has not
  // been drawn yet.
  const fromPose=['azimuth','elevation','distance'].every(k=>Number.isFinite(value.from?.[k]))?value.from:null;
  const current=fromPose?(()=>{
    const target=controls.target.clone(),a=THREE.MathUtils.degToRad(fromPose.azimuth),e=THREE.MathUtils.degToRad(fromPose.elevation);
    return {target,position:target.clone().add(new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)).multiplyScalar(fromPose.distance))};
  })():value.fromCurrent===true?{position:camera.position.clone(),target:controls.target.clone()}:null;
  // The focus view first: the end state, exactly as the host's plain view.
  if(!focus(value.view))return;
  const ms=key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>0?value[key]:0;
  const hold=ms('hold'),flight=ms('flight');
  if(reduced.matches||!flight)return;
  const end={position:camera.position.clone(),target:controls.target.clone()};
  applyPartContext(null,0);
  const start=current??headOnView();
  controls.target.copy(start.target);camera.position.copy(start.position);controls.update();
  const state={part,amount:0,end,epoch:manualViewEpoch};
  const move=orbitBetween(start.position,end.position,start.target,end.target);
  // Prepare the blend's programs now, on the still head-on frame, so the
  // dissolve does not compile (and stutter) as it starts.
  dissolve??=createSceneDissolve(renderer,scene);
  solidRevealState=state;lockInteraction(true);
  // Landing: the iris anchor eases from [from, to] with the travel, in the same frame.
  const anchor=landing&&lessonViewport&&Array.isArray(value.anchor)&&value.anchor.length===2&&value.anchor.every(Number.isFinite)?value.anchor:null;
  animate(hold+flight,(_ease,p)=>{
    const f=clamp((p*(hold+flight)-hold)/flight),travel=sampleTable(value.travel,f);
    if(anchor&&lessonViewport){lessonViewport.ax=THREE.MathUtils.lerp(anchor[0],anchor[1],travel);applyCameraFrame();}
    move(travel);state.amount=sampleTable(value.wire,f);
  },()=>finishSolidReveal(state));
  if(animation)animation.reveal=state;
  // Draw the solid head-on frame before the host is told the lens study is up.
  render();
}
function finishSolidReveal(state){
  if(solidRevealState!==state)return;
  solidRevealState=null;disposeDissolve();
  applyPartContext(state.part,1);
  // Land exactly on the focus view unless the learner took the camera.
  if(state.epoch===manualViewEpoch)camera.position.copy(state.end.position);
  controls.target.copy(state.end.target);controls.update();
  lockInteraction(false);invalidate();publishHost(true);
  // Landing: the tour's next move, sent during the flight, runs on from the landing.
  const next=pendingLandingPath;pendingLandingPath=null;
  if(next&&state.epoch===manualViewEpoch)landingPath(next);
}
// Linear interpolation in an evenly spaced table of eased values over 0..1.
function sampleTable(table,t){
  if(!Array.isArray(table)||table.length<2||!table.every(Number.isFinite))return t;
  const x=clamp(t)*(table.length-1),i=Math.min(Math.floor(x),table.length-2);
  return THREE.MathUtils.lerp(table[i],table[i+1],x-i);
}
// Straight on to the front of the camera, near enough that the whole body
// fills REVEAL_FILL of the touch box around the orbit anchor.
function headOnView(){
  model.updateMatrixWorld(true);
  const points=partWorldPoints(model),dir=new THREE.Vector3(0,0,1);
  const right=new THREE.Vector3(1,0,0),up=new THREE.Vector3(0,1,0),rel=new THREE.Vector3();
  const v=lessonViewport,ax=v?.ax??.5,ay=v?.ay??.5;
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  const sx=tan*camera.aspect*REVEAL_FILL*2*Math.min(ax,1-ax),sy=tan*REVEAL_FILL*2*Math.min(ay,1-ay);
  const target=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  let radius=0;
  for(let pass=0;;pass++){
    radius=0;
    for(const p of points){
      const z=rel.subVectors(p,target).dot(dir);
      radius=Math.max(radius,z+Math.abs(rel.dot(right))/sx,z+Math.abs(rel.dot(up))/sy);
    }
    if(pass===2)break;
    // Centre the projected body, not its bounding box.
    let left=Infinity,rightmost=-Infinity,bottom=Infinity,top=-Infinity;
    for(const p of points){
      const depth=radius-rel.subVectors(p,target).dot(dir);
      const x=rel.dot(right)/depth/sx,y=rel.dot(up)/depth/sy;
      left=Math.min(left,x);rightmost=Math.max(rightmost,x);bottom=Math.min(bottom,y);top=Math.max(top,y);
    }
    target.addScaledVector(right,(left+rightmost)/2*radius*sx).addScaledVector(up,(bottom+top)/2*radius*sy);
  }
  radius=THREE.MathUtils.clamp(radius,controls.minDistance,controls.maxDistance);
  return {target,position:target.clone().addScaledVector(dir,radius)};
}
const resize=new ResizeObserver(()=>{
  const w=$('stage').clientWidth,h=$('stage').clientHeight;
  renderer.setSize(w,h);applyCameraFrame();
  // Default Back framing must continue to fit an open door after a layout
  // change. A learner's explicit orbit/pinch/zoom remains their chosen view.
  if(demoKind&&(!isLesson()||viewPreset==='front')){lessonViewAnimation=null;demoPose();}
  else if(isFilmMacro()&&['rear','rear-angle','rewind-angle'].includes(viewPreset))interactionPose();
  else if(interactionId==='lensRelease'&&viewPreset==='mount-angle')fitLensMountView();
  else if(interactionStatus==='intro'&&viewPreset==='angle')introPose();
  else if(currentInteraction()&&viewPreset==='angle')interactionPose();
  invalidate();
});resize.observe($('stage'));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    if(raf)cancelAnimationFrame(raf);raf=0;
    // Settle a view transition before suspending so its disabled controls cannot
    // strand the learner after returning to this tab.
    if(animation && interactionLocked)settleInteraction();
    if(lessonViewAnimation)lessonViewAnimation.update(1);
    // A side view turning lands rather than stopping halfway.
    if(side.phase==='turning')finishSide();
    animation=null;zoomAnimation=null;lessonViewAnimation=null;highlightFader.finish();if($('capture').textContent==='Pause')$('capture').textContent='Resume';
  }
  else invalidate();
  publishHost(true);
});
renderer.domElement.addEventListener('webglcontextlost',e=>{
  e.preventDefault();animation=null;$('loading').hidden=false;
  $('loading').textContent='The 3D view was interrupted. Reload to continue.';
  $('capture').disabled=true;$('open').disabled=true;
  publishHost(true);
});
window.addEventListener('pagehide',()=>{
  disposed=true;headerSampler.dispose();inkSampler.dispose();cancelAnimationFrame(raf);resize.disconnect();controls.dispose();
  hostBridge?.dispose();
  disposeDissolve();
  scene.traverse(o=>{if(o.isMesh || o.isLineSegments){o.geometry.dispose();o.material.dispose();}});
  renderer.dispose();
});
$('loading').hidden=true;$('open').disabled=false;$('capture').disabled=false;
configureIntro();
hostBridge=createHostBridge({kind:'camera',getState:getHostState,onCommand:onHostCommand,coalesce:true,
  // Orbit/zoom drags and slider ticks may reply with the next frame; taps, steps and every other
  // command are acknowledged at once.
  deferAck:({action,value})=>(action==='viewport'&&(value?.kind==='orbit'||value?.kind==='zoom'))||
    ['focus','aperture','zoom'].includes(action),
  onTheme:tokens=>{
    if(/^[0-9a-f]{6}$/i.test(tokens?.warm||''))sensorSurface.material.uniforms.exposureWarm.value.set('#'+tokens.warm);
    if(/^[0-9a-f]{6}$/i.test(tokens?.sensor||''))sensorSurface.material.uniforms.sensorBlue.value.set('#'+tokens.sensor);
    applySceneTheme(scene,tokens,{accent:infoColor,contextInk:darkContextInk,
      contextEntries:visualEntries,onDark:value=>{darkTheme=value;},
      onApplied:()=>restyleContextLines(visualEntries,{active:solidObjects(lastContext.id),
        amount:lastContext.amount,dark:darkTheme,ink:darkContextInk}),invalidate});
  }});
setDemo(new URLSearchParams(location.search).get('demo'));
// Standalone controls remain the same state adapter used by the Flutter host.
// Bubble listeners run after their existing handlers, including native input.
for(const event of ['click','input','change'])document.addEventListener(event,()=>publishHost(true));
publishHost(true);
invalidate();
// The lab warms the dissolve while idle, after the first frame, so the first Look inside is smooth.
if(!demoKind)(window.requestIdleCallback??(cb=>setTimeout(cb,300)))(warmLabDissolve,{timeout:2000});
