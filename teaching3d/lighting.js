import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {OrbitControls} from './vendor/OrbitControls.f231b18ca7.js';
import {buildBust,BUST_MODELS,FACE_PILOT_MODELS,STYLED_FACE_PILOT_MODEL} from './bust.js';
import {createAreaLight} from './area_light.js';
import {createPlacementControls} from './lighting_controls.js';
import {createLightingSession,brightnessIntensity} from './lighting_session.js';
import {createSourceOcclusion} from './source_occlusion.js';
import {createHostBridge,publishLoadingProgress} from './host_bridge.js';
import {applySceneTheme,softboxEdgeColor,recolourSoftboxEdges,levelPreimage,grayOf} from './scene_theme.js';
import {createLightingCamera,AUTO_LISTS} from './lighting_camera.js';
import {stepAuto,AUTO_STEP_MS} from './auto_step.js';
import {createLightingOptics} from './lighting_optics.js';
import {createLightingMeter} from './lighting_meter.js';
import {createBackdropSampler} from './lighting_backdrop.js';
import {createHeaderSampler,createInkSamplers} from './header_luminance.js';
import {handheldShake} from './lighting_effects.js';
import {lightingAim,overflow,eyeSide,eyeLevel,eyeShift,followAim} from './framing_blend.js';
import {DOLLY_IN,dollyInAngles,dollyInZoom,startZoom} from './lighting_orbit_in.js';
import {sheetWindow} from './lighting_sheet_window.js';
import {createMoveClock,LIFT_SETTLE_MS,renderQuality,createLiftFade,liftEase,LIFT_CROSSFADE_ENABLED,LIFT_WAVE_CELLS,movingScreen,MOVING_PIXEL_RATIO,MOVING_LOOK,MOVING_SCALE,meterIsDue} from './lighting_quality.js';
import {dragRenderIndex,dragRenderQuality,createDragScene} from './lighting_drag_render.js';
import {createGlideGroup,wrapDegrees} from './pose_glide.js';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
let dark=params.get('theme')==='dark';
const embedded=params.get('embedded')==='1';
// The marketing landing page embeds this page with its own overlay owning every
// gesture: no in-iframe chrome (lighting_controls.css) and no direct orbit, zoom or key input.
const landing=params.get('landing')==='1';
// Landing: the lamp is drawn so its move round the head reads (?lamp=0 hides it).
const landingLamp=params.get('lamp')!=='0';
// Studio lessons (lesson=1): extra bridge commands, all in lesson_studio.js, loaded only here. Unset, nothing below changes.
const lesson=params.get('lesson')==='1';
let lessonStudio=null,stillCapture=false,contextLost=false;
document.documentElement.classList.toggle('landing',landing);
const facePilot=params.get('facePilot')==='1';
// Review captures can hide the teaching indicator meshes while retaining the
// real area lights and shadows. This is deliberately opt-in for portrait capture.
const portraitCapture=params.get('portraitCapture')==='1';
document.documentElement.classList.toggle('embedded',embedded);
document.body.classList.toggle('is-embedded',embedded);
const hex=value=>/^[0-9a-f]{6}$/i.test(value||'')?'#'+value:null;
// Ink and paper (Kent, October 16, 2026): black is 0x121212, white 0xF5F5F5 in both themes.
const defaults=dark?{bg:'#121212',fg:'#f5f5f5',muted:'#9da39e',line:'#454b47'}:
  {bg:'#f5f5f5',fg:'#121212',muted:'#7b807e',line:'#d9ddda'};
const tokens=Object.fromEntries(Object.keys(defaults).map(key=>[key,hex(params.get(key))||defaults[key]]));
for(const [key,value]of Object.entries(tokens))document.documentElement.style.setProperty('--'+key,value);
const info=/^[0-9a-f]{6}$/i.test(params.get('info')||'')?params.get('info'):(dark?'90cdf4':'5b8fb9');
document.documentElement.style.setProperty('--accent','#'+info);
// The picture's black and white points on screen (0..1); the host passes them lifted for the paper laid over its iframe.
const levels={black:grayOf(hex(params.get('black'))||'#121212'),white:grayOf(hex(params.get('white'))||'#f5f5f5')};
const scene=new THREE.Scene();scene.background=new THREE.Color(levelPreimage(tokens.bg,levels.black,levels.white));
const target=new THREE.Vector3(0,.55,0);
const FOCAL_LENGTHS=Object.freeze([24,35,50,85,105,135]);
const DEFAULT_FOCAL_LENGTH=50;
const cameraSettings=createLightingCamera({lesson});
const worldUnitsPerMeter=3.2/.6;
let meterState={scene:0,iso:0,aperture:0,shutter:0,total:0};
let focusDistance=1;
const initialState=(id,label,position,width,powerStops)=>({id,label,position:[...position],target:target.toArray(),width,height:width*1.25,powerStops,brightnessPercent:Math.min(100,50*2**powerStops),enabled:true,
  referenceDistance:new THREE.Vector3(...position).distanceTo(target),referenceWidth:width,referenceHeight:width*1.25});
const session=createLightingSession({
  maxLights:3,
  createLight:(id,label,index)=>{
    const defaults=[
      [1.79,2.35,2.55,.8,0],[-1.8,1.45,2.7,1.2,-1],
      [2.4,1.1,-2.2,1,-2],[ -2.4,2.7,-1.8,.7,-3],
    ][Math.min(index-1,3)];
    return initialState(id,label,defaults.slice(0,3),defaults[3],defaults[4]);
  },
  initialLight:initialState('light-1','Light 1',[1.79,2.35,2.55],.8,0),
});
let {lights:sourceStates,selectedId}=session.getState();
let lightState=sourceStates[0];
const exposureMode='physical';
const sources=[];
let bridge=null,framing=embedded?'portrait':'setup';
// Controls are present but disabled even if asset loading fails.
const placement=createPlacementControls({root:$('placement'),onChange:next=>setLight(next),onSessionChange:changeSession});
placement.setState(lightState);
const camera=new THREE.PerspectiveCamera(33,1,.1,40);
let focalLength=DEFAULT_FOCAL_LENGTH;
camera.filmGauge=36;
camera.setFocalLength(focalLength);
camera.position.set(0,.2,6.9);camera.lookAt(0,.15,0);
const baseBustModels=Array.isArray(BUST_MODELS)&&BUST_MODELS.length?BUST_MODELS:[{id:'vitruvian',label:'Vitruvian'}];
const bustModels=facePilot?[...baseBustModels,...FACE_PILOT_MODELS]:baseBustModels;
const requestedModel=params.get('model');
const pilotDefault=STYLED_FACE_PILOT_MODEL?.id??FACE_PILOT_MODELS.at(-1).id;
const initialModel=facePilot&&FACE_PILOT_MODELS.some(model=>model.id===requestedModel)?requestedModel:(facePilot?pilotDefault:bustModels[0].id);
publishLoadingProgress('lighting',{loaded:0,total:0});
let selectedModel=initialModel, bust=await buildBust(selectedModel,{facePilot,
  onProgress:event=>publishLoadingProgress('lighting',{loaded:event.loaded,total:event.total})});scene.add(bust);
// Playtest only: keep the drawing buffer so the host can snapshot the canvas.
const playtestFrames=new URLSearchParams(location.search).get('playtest')==='1';
const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'low-power',preserveDrawingBuffer:playtestFrames});
// A frame still pending (the canvas was just resized, which clears it) is drawn
// before the snapshot, so a capture never reads an empty picture.
if(playtestFrames)window.focalSnapshotCanvas=()=>{if(document.hidden)return null;drawNow();return renderer.domElement;};
// Measurement only (?perf=1): each draw waits for the GPU (a one-pixel readback) so lastDrawMs is the frame's real cost, not its submission.
const perfSync=params.get('perf')==='1',perfPixel=new Uint8Array(4);
// The 3D scene draws at LIT_PIXEL_RATIO; the finished picture (dots, grain) draws at the device's own ratio (up to 3) so the dot lattice sits on the pixel grid instead of being resampled by the browser (the moire grid).
const LIT_PIXEL_RATIO=Math.min(devicePixelRatio,1.5),SCREEN_PIXEL_RATIO=Math.min(devicePixelRatio,3);
renderer.setPixelRatio(SCREEN_PIXEL_RATIO);renderer.shadowMap.enabled=true;
// Each map is a different point on the source. PCF only antialiases each map;
// geometric source extent, rather than shadow blur, creates the penumbra.
renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
renderer.outputColorSpace=THREE.SRGBColorSpace;
const optics=createLightingOptics(renderer);
optics.setShadeColors(tokens.fg,levelPreimage(tokens.bg,levels.black,levels.white));optics.setLevels(levels.black,levels.white);
const exposureMeter=createLightingMeter(renderer,{onReading:()=>meterResolved()});
// Luminance strips of the frame behind the Flutter meter (see lighting_backdrop.js).
const backdrop=createBackdropSampler(renderer,{onStrips:()=>meterResolved()});
// The brightness of the frame behind the lab's header (the host sends its band).
const headerSampler=createHeaderSampler(renderer,{onDue:()=>invalidate(false),onValue:()=>publishState()});
// The same, for each plateless control (the host sends `inkBands`).
const inkSampler=createInkSamplers(renderer,{onDue:()=>invalidate(false),onValue:()=>publishState()});
renderer.domElement.setAttribute('role','img');renderer.domElement.tabIndex=0;
renderer.domElement.style.cursor='grab';
renderer.domElement.setAttribute('aria-label','Bust and softbox. Drag or use arrow keys to rotate. Pinch, scroll, or use plus and minus to zoom.');
$('stage').prepend(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,.15,0);controls.enablePan=false;controls.enableZoom=true;
controls.enableDamping=false;controls.rotateSpeed=.65;
controls.minPolarAngle=.15;controls.maxPolarAngle=Math.PI-.15;
if(landing){controls.enableRotate=false;controls.enableZoom=false;renderer.domElement.style.cursor='default';}
controls.update();controls.saveState();
// The head-on pose the host's `poseTo` measures from: azimuth 0, elevation 0.
const HEAD_PHI=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)).phi;
// Each source keeps its declared output when position or size changes. The
// initial rig is the reference exposure; distance produces natural falloff.
let area;
// The adjustable sources are the illumination. An always-on ambient fill
// would create exposure even when every light is set to zero.

// A thin, matte softbox: white emitting face and a dark back. Neither its
// housing nor its outline casts an extra shadow over the sampled light source.
// The landing embed only (landing review 3, must 2): the lab's twelve 1 px
// housing edges, half-blended, read as a gray dithered blade at landing size.
// There the lamp is its lit face inside one thin border ring, drawn in the app's
// own line treatment (Kent, October 18, 2026: the landing's lines match the app's
// grey, not black): the housing edge color blended .7 toward the paper, exactly
// as the app's edges, and flagged .7 so the optics pass draws it as an unscreened
// line, seen from either side. Only the weight differs, so it reads at landing size.
const LANDING_STROKE=.04; // domain: landing lamp stroke, share of the panel
// The landing lamp face, sRGB before the page levels: about #CCCCCC on either paper, a highlight just under the bust's lit side.
const LANDING_PLATE=.835; // domain: landing lamp plate tone
function landingLampStroke(){
  const o=.5,i=.5-LANDING_STROKE,ring=new THREE.Shape([[-o,-o],[o,-o],[o,o],[-o,o]].map(([x,y])=>new THREE.Vector2(x,y)));
  ring.holes.push(new THREE.Path([[-i,-i],[-i,i],[i,i],[i,-i]].map(([x,y])=>new THREE.Vector2(x,y))));
  return new THREE.Mesh(new THREE.ShapeGeometry(ring),new THREE.MeshBasicMaterial({color:softboxEdgeColor(dark),side:THREE.DoubleSide,
    transparent:true,opacity:.7,blending:THREE.CustomBlending,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.ZeroFactor,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-4}));
}
function buildSoftbox(){
const softbox=new THREE.Group();softbox.name='softbox';scene.add(softbox);
const casing=new THREE.Mesh(new THREE.BoxGeometry(1,1,.08),
  new THREE.MeshBasicMaterial({color:0x808080}));
casing.position.z=-.045;softbox.add(casing);
const face=new THREE.Mesh(new THREE.PlaneGeometry(.96,.96),
  new THREE.MeshBasicMaterial({color:0x808080,side:landing?THREE.DoubleSide:THREE.FrontSide}));
face.position.z=.002;softbox.add(face);
for(const mesh of [casing,face]){
  // The landing lamp's face is flagged as a drawn plate (.7, as its stroke): one flat tone, never screened.
  const flag=landing&&mesh===face?'0.7':'0.5';
  mesh.material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
      '#include <opaque_fragment>\ngl_FragColor.a='+flag+';');
  };
  mesh.material.customProgramCacheKey=()=> flag==='0.7'?'focal-landing-lamp-plate-v1':'focal-panel-indicator-v1';
}
// The HDR buffer alpha carries the line's own opacity (.24 outline, .7 housing) as a marker: the optics pass draws these pixels as plain ink lines, unscreened.
const boxEdges=landing?landingLampStroke():new THREE.LineSegments(new THREE.EdgesGeometry(casing.geometry),
  new THREE.LineBasicMaterial({color:softboxEdgeColor(dark),transparent:true,opacity:.7,blending:THREE.CustomBlending,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.ZeroFactor}));
boxEdges.position.copy(landing?face.position:casing.position);softbox.add(boxEdges);
return {softbox,casing,face,boxEdges};
}
let sourceOcclusion=createSourceOcclusion(bust);
let sourceIsOutline=false;
function updateSourceVisibility(){
  for(const source of sources){
  const {softbox,casing,face,boxEdges}=source;
  const occluding=sourceOcclusion.isOccluding(camera,softbox);
  // Landing (r8 review): the lamp is always the one flat plate; it never drops to the see-through outline in front of the bust.
  const outline=!source.state.enabled||(!landing&&occluding);
  source.outline=outline;source.occluding=occluding;
  if(source.state.id===selectedId)sourceIsOutline=outline;
  // The landing page crops the stage tight on the bust: the panel would show as a stray mark on its edge.
  casing.visible=face.visible=!outline&&!portraitCapture&&(!landing||landingLamp);
  // The landing lamp is its face alone, seen from either side, inside its stroke: no housing hides the stroke from behind.
  if(landing)casing.visible=false;
  // Keep only the housing's outer technical edges over the bust. This is a
  // drawing treatment; the light samples and their shadows stay intact.
  boxEdges.material.opacity=outline?.24:.7;
  boxEdges.material.depthTest=!outline;
  boxEdges.material.depthWrite=false;
  boxEdges.renderOrder=outline?20:0;
  boxEdges.visible=!portraitCapture&&(!landing||landingLamp);
  if(lessonStudio?.hidesLamps())casing.visible=face.visible=boxEdges.visible=false;
  }
}
function syncSource(source){
  const state=source.state;
  const level=state.enabled?state.brightnessPercent/100:0;
  source.area.update({...state,powerStops:0,intensityScale:state.enabled?brightnessIntensity(state.brightnessPercent):0,exposureMode});source.area.group.visible=state.enabled;
  // A panel is a brightness-setting indicator; the sampled lights still
  // produce the actual linear radiometric output in the scene.
  // On the landing page the panel is a light, not a setting: one flat highlight plate inside the gray stroke, the same tone in
  // both themes (round 7 review 1: white on the light paper vanished, white on the dark paper outshone the headline).
  const shown=landing&&state.enabled?LANDING_PLATE:level;
  for(const mesh of [source.face,source.casing])mesh.material.color.setRGB(shown,shown,shown,THREE.SRGBColorSpace);
  source.softbox.position.fromArray(state.position);source.softbox.scale.set(state.width,state.height,1);
  const m=source.area.metrics;
  source.softbox.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(m.right,m.up,m.normal));
}
// Shadow maps are static between edits (autoUpdate is off). Each light keeps
// its own flag, so moving or resizing one source refreshes only its maps and
// the others stay frozen, as during an orbit. Anything that changes the
// casters or the light set marks every source.
function markShadows(due=sources){
  renderer.shadowMap.needsUpdate=true;
  for(const source of sources)for(const {light} of source.area.samples)light.shadow.autoUpdate=false;
  for(const source of due)for(const {light} of source.area.samples){light.shadow.needsUpdate=true;shadowMapMarks++;}
}
function rebuildSources(){
  for(const source of sources){
    scene.remove(source.area.group,source.softbox);source.area.dispose();
    source.softbox.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
  }
  sources.length=0;
  for(const state of sourceStates){
    const source={state,...buildSoftbox(),area:createAreaLight({...state,powerStops:0,
      intensityScale:state.enabled?brightnessIntensity(state.brightnessPercent):0,
      // The textured pilot exposed self-shadow patches under the wide PCF
      // kernel. A controlled shadow/unlit comparison verified this depth bias
      // removes those patches without offsetting thin ears via normalBias.
      shadowBias:facePilot?-.0004:-.00008,
      target,referenceIlluminance:3,exposureMode,sampleCount:sourceStates.length===1?9:4})};
    sources.push(source);scene.add(source.area.group);syncSource(source);
  }
  selectSource(selectedId);markShadows();
}
function selectSource(id){
  if(!sourceStates.some(state=>state.id===id))return;
  session.select(id);refreshSessionState();lightState=sourceStates.find(state=>state.id===id);
  area=sources.find(source=>source.state.id===id)?.area;
  placement.setSession({...session.getState(),exposureMode});
  placement.setState(lightState);
}
function changeSession(action){
  const previousBrightness=lightState.brightnessPercent;
  if(action.type==='select'){selectSource(action.id);invalidate();publishState();return;}
  if(action.type==='add'){if(!session.add())return;refreshSessionState();lightState=sourceStates.find(state=>state.id===selectedId);rebuildSources();}
  if(action.type==='remove'){if(!session.remove())return;refreshSessionState();lightState=sourceStates.find(state=>state.id===selectedId);rebuildSources();}
  if(action.type==='power'||action.type==='brightness'){
    const brightnessPercent=THREE.MathUtils.clamp(action.type==='brightness'?action.brightnessPercent:50*2**action.powerStops,0,100);
    session.update({brightnessPercent,powerStops:brightnessPercent>0?Math.log2(brightnessPercent/50):null});
  }
  if(action.type==='toggle')session.update({enabled:!lightState.enabled});
  refreshSessionState();lightState=sourceStates.find(state=>state.id===selectedId);
  for(const source of sources)syncSource(source);
  selectSource(selectedId);
  if(['add','remove','toggle'].includes(action.type)||(previousBrightness===0&&lightState.brightnessPercent>0))markShadows();
  invalidate();
  publishState();
}
function refreshSessionState(){
  const next=session.getState();
  sourceStates=next.lights;selectedId=next.selectedId;
  if(typeof sources!=='undefined')for(const source of sources){
    const state=sourceStates.find(light=>light.id===source.state.id);
    if(state)source.state=state;
  }
}
let framingPoints=[];
function updateFramingPoints(){
  const bounds=new THREE.Box3().setFromObject(bust);framingPoints=[];
  for(const x of [bounds.min.x,bounds.max.x])
    for(const y of [bounds.min.y,bounds.max.y])
      for(const z of [bounds.min.z,bounds.max.z])framingPoints.push(new THREE.Vector3(x,y,z));
}
updateFramingPoints();
let frame=0,renderedFrames=0,shadowUpdates=0,shadowMapMarks=0,disposed=false,style=facePilot?'smooth':'print',lastDrawMs=0,bustRequest=0,bustBusy=false,modelError=null;
for(const option of ['print','smooth'])$(option).setAttribute('aria-pressed',String(option===style));
let sceneDirty=true;
// The page is leaving (the host's `pause`): the last frame stays under the host's fading cover and nothing draws, so the close animation owns the main thread.
let paused=false;
let zoomScale=1,fitDistance=6.9,lastCameraDistance=camera.position.distanceTo(controls.target),fitting=false;
// The embedded Studio boots at the final angle with the camera a little back (see lighting_orbit_in.js), so the first visible frame is never head-on; ?orbitIn=0 or ?dollyIn=0 keeps the plain head-on view.
const dollyEnabled=embedded&&params.get('orbitIn')!=='0'&&params.get('dollyIn')!=='0';
if(dollyEnabled){
  const head=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const angles=dollyInAngles(head,{minPhi:controls.minPolarAngle,maxPhi:controls.maxPolarAngle});
  head.theta=angles.theta;head.phi=angles.phi;
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(head));
  controls.update();controls.saveState();
  zoomScale=startZoom();lastCameraDistance=camera.position.distanceTo(controls.target);
}
// The close end lets a 24mm lens fill the frame with the head (about a sixth of
// the whole-bust fit distance); the head-clearance clamp in fitView keeps the eye outside it.
// A lesson dollies far enough to hold the head size at 200 mm (equalFraming).
const zoomBounds=lesson?[.1,5]:[.2,2.5];
// Where the framing wants the aim, and where the followed aim is now (see fitView).
let landingAimY=0; // landing only: see fitView and the reframe command's aimY
let aimGoal=null;const aimFollow={value:null,velocity:[0,0,0],at:0,settling:false};
function setFocalLength(next){
  if(!cameraSettings.set('focalLength',next))return false;
  focalLength=cameraSettings.state.focalLength;camera.setFocalLength(focalLength);camera.updateProjectionMatrix();
  invalidate();publishState();return true;
}
function fitView(){
  // Portrait framing is subject-only and stable while changing a light. Whole
  // setup also includes sources without moving them for cosmetic reasons.
  // Both retain the learner's orbit orientation and chosen magnification.
  // Fit with a reference 50mm lens. Changing lenses changes magnification;
  // it must not silently dolly the camera to cancel the optical zoom.
  const inverse=camera.quaternion.clone().invert(),tan=camera.getFilmHeight()/(2*DEFAULT_FOCAL_LENGTH);
  const points=[...framingPoints];
  if(framing==='setup')for(const source of sources)for(const x of [-.5,.5])for(const y of [-.5,.5]){
    points.push(source.area.metrics.position.clone().addScaledVector(source.area.metrics.right,x*source.state.width)
      .addScaledVector(source.area.metrics.up,y*source.state.height));
  }
  const center=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  if(portraitCapture){
    const bustSize=new THREE.Box3().setFromPoints(framingPoints).getSize(new THREE.Vector3());
    center.y+=bustSize.y*.14;
  }
  const offset=camera.position.clone().sub(controls.target);
  let distance=6.9;
  for(const point of points){
    const local=point.clone().sub(center).applyQuaternion(inverse);
    distance=Math.max(distance,local.z+Math.abs(local.y)/(tan*.84),
      local.z+Math.abs(local.x)/(tan*camera.aspect/viewFrame.fit*.88));
  }
  fitDistance=distance;
  // Never closer than the head's depth plus a margin: the eye stays outside it.
  const clearance=new THREE.Box3().setFromPoints(framingPoints).getSize(new THREE.Vector3()).z/2+.3; // domain: head clearance, scene units
  controls.minDistance=Math.max(fitDistance*zoomBounds[0],clearance);controls.maxDistance=fitDistance*zoomBounds[1];
  // Lesson equal framing: the lens sets the dolly, so the head holds its size.
  const equalZoom=lessonStudio?.fitZoom(fitDistance,focalLength);
  if(equalZoom!=null)zoomScale=THREE.MathUtils.clamp(equalZoom,...zoomBounds);
  distance*=zoomScale;
  // Landing (r9): the visitor's zoom divides the tour's own framing distance; it never rewrites the tour's zoomScale.
  if(landing)distance=Math.max(controls.minDistance,distance/landingViewZoom);
  if(distance<controls.minDistance){distance=controls.minDistance;zoomScale=distance/fitDistance;}
  // The aim blends by camera distance (the dolly, not the lens): the whole bust
  // from the fit distance outward, the eye line at the closest.
  const eyePoints=framing==='portrait'?(bust.userData.getEyeLandmarks?.().all??[]):[];
  // Lessons aim at the face itself, the same point at every lens and distance (Kent, lesson 8
  // playtest, October 19, 2026: "every time it zooms in, suddenly it shifts vertically"). The
  // portrait aim below sits on the bust's centre blended toward the eyes by the dolly, then
  // shifts so the eye line lands in a clear box measured at the lens's own field of view, so
  // each lens change re-aimed the camera and the face jumped up or down the frame.
  const lessonAim=lessonStudio&&!landing&&eyePoints.length?lessonStudio.faceAim(eyePoints.map(point=>point.world)):null;
  if(lessonAim)center.fromArray(lessonAim);
  else if(eyePoints.length){
    const eyeLine=eyePoints.reduce((sum,point)=>sum.map((value,index)=>value+point.world[index]/eyePoints.length),[0,0,0]);
    const eye=new THREE.Vector3(...eyeLine),f=eyeFraming(center,offset,distance);
    center.fromArray(lightingAim(center.toArray(),eyeLine,distance,controls.minDistance,fitDistance));
    // Then sideways and up or down only, so the eye line sits where the clear box wants it.
    const v=eye.clone().sub(center),depth=v.dot(f.forward)+distance;
    // The bust never turns and faces +z: head-on, the eye line sits dead center (see eyeSide).
    const facing=Math.max(0,-f.forward.z/(Math.hypot(f.forward.x,f.forward.z)||1));
    const side=eyeShift(v.dot(f.right),depth,eyeSide(f.ndcRight(eye,center),f.half,f.q,facing),f.tan*camera.aspect);
    const rise=eyeShift(v.dot(f.up),depth,eyeLevel(f.ndcUp(eye,center),f.box.center,f.box.half,f.q),f.tan);
    center.addScaledVector(f.right,side).addScaledVector(f.up,rise);
  }
  // Landing only (r8, Kent: "tilted down a little bit, looking at the face"): the orbit's aim rises by the host's aimY,
  // scene units, toward the face, so a look-down orbits round the face rather than the bust's middle.
  if(landing)center.y+=landingAimY;
  // The aim follows its goal, critically damped over the standard duration, so a quick
  // pinch never snaps the composition (Kent, October 12, 2026: "Dolly also needs to
  // make sure transition is *smooth*").
  aimGoal=center.toArray();
  const now=performance.now();
  if(aimFollow.value&&framing==='portrait'&&!stillCapture){
    const step=followAim(aimFollow.value,aimFollow.velocity,aimGoal,Math.min(.1,(now-aimFollow.at)/1000));
    aimFollow.value=step.value;aimFollow.velocity=step.velocity;aimFollow.settling=!step.settled;
    center.fromArray(step.value);
  }else{aimFollow.value=aimGoal;aimFollow.velocity=[0,0,0];aimFollow.settling=false;}
  aimFollow.at=now;
  const far=Math.max(100,distance+50+(lessonStudio?.farExtra()??0));
  if(Math.abs(camera.far-far)>.001){camera.far=far;camera.updateProjectionMatrix();}
  if(Math.abs(offset.length()-distance)>.001||controls.target.distanceToSquared(center)>.000001){
    fitting=true;
    controls.target.copy(center);
    camera.position.copy(controls.target).add(offset.setLength(distance));controls.update();
    fitting=false;
  }
  lastCameraDistance=camera.position.distanceTo(controls.target);
}
// How far along the bust-to-eye line the aim must sit for the eyes to stay framed
// (see framing_blend.js) with the camera [offset] direction and [distance] fitView is
// about to use, at the lens's real field of view and the host's reframing. Each view
// axis is measured in the clear box the subject is framed in (Kent's drawing, October
// 12, 2026): the canvas's full width, and from under the header row down to the meter.
// The overflow is the larger of the two axes': the head outgrowing either tightens both.
const FRAMING_UP=new THREE.Vector3(0,1,0);
function eyeFraming(whole,offset,distance){
  const forward=offset.clone().normalize().negate();
  const right=new THREE.Vector3().crossVectors(forward,FRAMING_UP).normalize();
  const up=new THREE.Vector3().crossVectors(right,forward);
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),{zoom,fit,shiftY,floor}=viewFrame;
  // ndc of [point] on [axis] with the camera aimed at [aim] from [distance] along -forward.
  const ndc=(axis,scale)=>(point,aim)=>{const v=point.clone().sub(aim);return v.dot(axis)/((v.dot(forward)+distance)*scale);};
  const ndcRight=ndc(right,tan*camera.aspect),ndcUp=ndc(up,tan);
  // The visible canvas is -2 shiftY/zoom +- 1/zoom in ndc; the box's top is the header's
  // foot (2 fit - 1 on the canvas) and its bottom the meter's top (2 floor - 1).
  const box={center:-2*shiftY/zoom+(fit+floor-1)/zoom,half:Math.max(.05,fit-floor)/zoom};
  const half=1/zoom;
  const qRight=overflow(framingPoints.map(point=>ndcRight(point,whole)),half);
  const qUp=overflow(framingPoints.map(point=>ndcUp(point,whole)),box.half);
  return {q:Math.max(qRight,qUp),half,box,forward,right,up,tan,ndcRight,ndcUp};
}
function resetView(){
  zoomScale=1;fitting=true;controls.reset();fitting=false;
  lastCameraDistance=camera.position.distanceTo(controls.target);invalidate();publishState();
}
// The bust's vertical extent as drawn now (window included), as fractions of the canvas height from its top: what the browser test reads.
// The camera and the lights as last set (the landing's motion probe reads it per frame).
window.focalLightingPose=()=>({...currentPose(),distance:camera.position.distanceTo(controls.target),target:controls.target.toArray(),
  lights:sourceStates.map(state=>[...state.position]),...(landing?{viewZoom:landingViewZoom,width:lightState?.width}:{})});
// Each shown lamp's outer stroke corners as drawn now, in canvas CSS pixels (the landing's lamp-in-frame probe).
window.focalLightingLampBoxes=()=>{
  camera.updateMatrixWorld(true);const rect=renderer.domElement.getBoundingClientRect();
  return sources.filter(source=>source.boxEdges.visible).map(source=>{
    source.softbox.updateMatrixWorld(true);
    const xs=[],ys=[];
    for(const [x,y] of [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]){
      const p=new THREE.Vector3(x,y,.002).applyMatrix4(source.softbox.matrixWorld).project(camera);
      xs.push((p.x+1)/2*rect.width);ys.push((1-p.y)/2*rect.height);
    }
    return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys),width:rect.width,height:rect.height,occluding:!!source.occluding,outline:!!source.outline};
  });
};
window.focalLightingBustSpan=()=>{
  camera.updateMatrixWorld(true);let top=Infinity,bottom=-Infinity;
  for(const point of framingPoints){const y=(1-point.clone().project(camera).y)/2;top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return [top,bottom];
};
// Sheet reframing lives in the projection, never in the canvas: the canvas always fills the stage. shiftY is a fraction of the stage height (positive moves the subject up), zoom <= 1 zooms out by widening the frame around the unchanged lens and distance. fit <= 1 is the share of the canvas' height the subject is framed in (the rest runs under the host's header): the subject fits the width that part would have.
// floor < fit is the share of the canvas' height below the clear box: the sheet and the
// meter standing on it.
// sheet is the open light sheet's lens shift (Kent, October 15, 2026): the same kind of vertical window offset, but nothing reads it except this projection, so the camera's position, aim and zoom stay exactly where they are while the sheet opens and closes (see eyeFraming and fitView, which ignore it).
let viewFrame={shiftY:0,zoom:1,fit:1,floor:0,sheet:0,sheetZoom:1},viewFrameDirty=false;
function applyViewFrame(){
  const w=renderer.domElement.clientWidth||1,h=renderer.domElement.clientHeight||1,s=viewFrame.zoom*viewFrame.sheetZoom;
  if(s===1&&viewFrame.shiftY===0&&viewFrame.sheet===0){camera.clearViewOffset();return;}
  camera.setViewOffset(w*s,h*s,-(1-s)*w/2,-(1-s)*h/2+(viewFrame.shiftY+viewFrame.sheet)*h,w,h);
}
// The scene segment's length at EV 0, in stops: the larger, the higher the bar starts up the left wall. Must match lightingSceneBarBase in lib/features/lessons/presentation/light_meter.dart.
const SCENE_BAR_BASE=6; // domain: scene bar length at EV 0, stops
function applyMeter(reading,settings){
  meterState={...reading,...settings.contributions,total:reading.scene+settings.exposureStops};
  meterState.noLight=!reading.hasSceneLight;
  // The viewfinder zones the host draws its metering frame from: each cell's
  // display brightness (0 to 1, null off the subject) for the frame's inks, and
  // the brightest cell the highlight-weighted frame outlines.
  const zones=reading.zones;
  meterState.zones=zones?{cols:zones.cols,rows:zones.rows,brightest:zones.brightest,
    luma:zones.mean.map(v=>v===null?null:Math.round(Math.pow(Math.min(1,v*settings.exposureMultiplier),1/2.2)*100)/100)}:null;
  const sceneBar=Math.max(0,SCENE_BAR_BASE+reading.displayScene);
  meterState.bars={scene:sceneBar,...settings.meterContributions};
  meterState.stackTargetStops=sceneBar+settings.meterReferenceStops-reading.scene;
}
// An asynchronous readback landed. While frames keep coming the next draw
// reads it itself and publishes it with that frame (one message per frame);
// when none follows within two frames (the last readback of a gesture) one
// draw publishes the settled reading.
let resolvePending=false,resolveTimer=0;
const SETTLE_MS=34; // domain: two frames at 60 Hz
const GESTURE_MS=100; // domain: a gap longer than this ends a gesture
let gestureUntil=0;
// Hold, then step (Kent, October 13, 2026): settings on A never move while a
// drag is in progress (the meter keeps reading); after release each one clicks a
// detent per AUTO_STEP_MS toward the solved target, aperture, shutter, ISO.
const HOLD_QUIET_MS=400; // domain: a wheel or key gesture with no pointer counts as held this long
let holdHost=false,holdUntil=0,quietTimer=0,stepTimer=0,lastScene=NaN;
const holdPointers=new Set();
const holding=()=>holdHost||holdPointers.size>0||performance.now()<holdUntil;
function scheduleAuto(){
  if(disposed||stepTimer||holding()||!Number.isFinite(lastScene))return;
  const target=cameraSettings.autoTarget(lastScene);
  if(target&&stepAuto(cameraSettings.state,target,AUTO_LISTS))stepTimer=setTimeout(autoTick,AUTO_STEP_MS);
}
function autoTick(){
  stepTimer=0;
  if(disposed||holding())return;
  const target=cameraSettings.autoTarget(lastScene);
  const next=target&&stepAuto(cameraSettings.state,target,AUTO_LISTS);
  if(next&&cameraSettings.setAutoValues(next)){invalidate(false);publishState();}
  scheduleAuto();
}
// A drag began or ended: freeze stepping where it is, or re-target from here.
function holdChanged(){
  if(holding()){clearTimeout(stepTimer);stepTimer=0;return;}
  invalidate(false);scheduleAuto();
}
function touchHold(){
  holdUntil=performance.now()+HOLD_QUIET_MS;holdChanged();
  clearTimeout(quietTimer);quietTimer=setTimeout(holdChanged,HOLD_QUIET_MS+5);
}
window.addEventListener('pointerdown',event=>{holdPointers.add(event.pointerId);holdChanged();},true);
for(const type of ['pointerup','pointercancel'])window.addEventListener(type,event=>{holdPointers.delete(event.pointerId);holdChanged();},true);
function meterResolved(){
  if(disposed)return;
  const reading=exposureMeter.read(cameraSettings.state.meteringMode);
  // A late readback re-targets the auto settings; they step there, not jump.
  lastScene=reading.scene;scheduleAuto();
  applyMeter(reading,cameraSettings.state);
  if(window.focalLightingMetrics)window.focalLightingMetrics.meter={...meterState};
  resolvePending=true;clearTimeout(resolveTimer);
  resolveTimer=setTimeout(()=>{if(resolvePending)invalidate(false);},SETTLE_MS);
}
// The picture while the camera moves (see lighting_quality.js): by default the
// rested halftone at MOVING_SCALE of the canvas's pixel ratio, half-resolution
// source, no defocus, grain, shake pass or outline hull (the meter reads on, asynchronously); with
// ?movingLook=cel the #691 cel frame at one pixel per CSS pixel, upscaled. One full
// frame once the camera has been still for a frame or on lift. ?movingScale= tries
// another halftone scale (a remark may ask for .5) without a rebuild.
const moveClock=createMoveClock();
let settleTimer=0;
const movingLook=params.get('movingLook')==='cel'?'cel':params.get('movingLook')==='halftone'?'halftone':MOVING_LOOK;
const movingScale=Number(params.get('movingScale'))>=.25&&Number(params.get('movingScale'))<=1?Number(params.get('movingScale')):MOVING_SCALE;
const MOVING_SCREEN=movingScreen(SCREEN_PIXEL_RATIO,movingScale);
// The playtest pill's drag render (see lighting_drag_render.js): 8 is the quarter-res halftone (the default); the host's `dragRender` command or ?dragRender= picks another.
let dragRender=dragRenderIndex(params.get('dragRender')),lastDrag=0;
const dragScene=createDragScene();
const dragScreen=(scale,whole)=>scale==null?MOVING_SCREEN:movingScreen(SCREEN_PIXEL_RATIO,scale,whole);
let sourceScale=1,lastMoving=false,meterBehind=false,lastMeterAt=-Infinity,lastMeterMs=0,meterReads=0;
const CEL_SCALE=MOVING_PIXEL_RATIO/SCREEN_PIXEL_RATIO;
// The canvas's pixel ratio for a draw: the device's own, except in the moving halftone frame.
const canvasRatio=quality=>quality.canvasRatio??(quality.look==='halftone'?MOVING_SCREEN.ratio:SCREEN_PIXEL_RATIO);
// The crossfade from the last moving frame to the full print on lift (see lighting_quality.js).
let lastFadeMs=0,fadeSteps=0;
// Reduced motion cuts: no dissolve, the full print replaces the moving one at once.
const liftFade=createLiftFade({enabled:LIFT_CROSSFADE_ENABLED&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches!==true,done:()=>optics.endFade(),step:t=>{
  const started=performance.now();optics.fade(liftEase(t));fadeSteps++;
  if(perfSync){const gl=renderer.getContext();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,perfPixel);}
  lastFadeMs=performance.now()-started;
  if(window.focalLightingMetrics)Object.assign(window.focalLightingMetrics,{fadeT:t,fadeSteps,lastFadeMs,split:optics.splitting,waveBand:optics.waveBand});
}});
// The source target draws at quality.pixelScale of the lit pixel ratio; the canvas at the quality's own ratio (setPixelRatio reallocates the canvas, so only when the look changes).
function setPixelScale(quality){
  const scale=quality.pixelScale,ratio=canvasRatio(quality);
  if(sourceScale===scale&&renderer.getPixelRatio()===ratio)return;
  sourceScale=scale;
  if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
  optics.resize($('stage').clientWidth*ratio,$('stage').clientHeight*ratio,sourceScale*LIT_PIXEL_RATIO/ratio,CEL_SCALE*SCREEN_PIXEL_RATIO/ratio);
}
// The one-shot opening orbit (see lighting_orbit_in.js): started by the host's `orbitIn` command once the page is ready; ?orbitIn=0 skips it.
const DOLLY_MS=DOLLY_IN.ms;
let orbitIn=null,orbitState='idle';
function startOrbitIn(){
  if(disposed||orbitIn||orbitState!=='idle'||!dollyEnabled)return;
  // Reduced motion cuts straight to the end pose.
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  orbitIn={t0:performance.now(),dur:reduced?0:DOLLY_MS};
  orbitState='running';invalidate(true);
}
// One frame of the dolly (the angle is fixed from boot), before the quality is chosen so the frame takes the moving path.
function stepOrbitIn(now){
  const o=orbitIn,t=o.dur>0?Math.min(1,(now-o.t0)/o.dur):1;
  zoomScale=THREE.MathUtils.clamp(dollyInZoom(t),...zoomBounds);
  sceneDirty=true;moveClock.touch(now);
  return t>=1;
}
// The end pose is what reset returns to.
function endOrbitIn(){orbitIn=null;orbitState='done';fitting=true;controls.saveState();fitting=false;}
// The host's glides (see pose_glide.js): `poseTo` orbits the camera and dollies
// from wherever it is, `lightTo` moves one light in all three axes. Their joint
// state `{active, done}` rides every published state.
const glides=createGlideGroup(()=>publishState()),poseGlide=glides.channel('pose');
// Landing only (r9): the visitor's zoom (Kent: "Add zoom controls for the labs.") and the Soft/Hard size (Kent:
// "Tapping soft/hard the light should smoothly animate") glide on their own group, so their ends never read as a
// pose or lamp glide landing (the host's glide-back waits on that group's done).
const landingGlides=createGlideGroup(),landingZoomGlide=landingGlides.channel('viewZoom'),landingSizeGlide=landingGlides.channel('size');
let landingViewZoom=1;
const LANDING_SIZE_MS=700; // domain: landing Soft/Hard size glide
const LANDING_VIEW_ZOOM=[.5,3]; // domain: landing view zoom bounds, a multiplier on the tour's framing
const landingReduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
function landingZoomTo(value){
  const z=value?.zoom,ms=value?.ms;
  if(!landing||disposed||typeof z!=='number'||!Number.isFinite(z))return;
  const to=THREE.MathUtils.clamp(z,...LANDING_VIEW_ZOOM),dur=typeof ms==='number'&&Number.isFinite(ms)&&ms>0&&!landingReduced()?ms:0;
  if(!dur){landingZoomGlide.cancel();landingViewZoom=to;invalidate();publishState();return;}
  landingZoomGlide.start({z:landingViewZoom},{z:to},dur,performance.now());invalidate();
}
const lightGlideIds=new Set();
let pausedAt=0;
// Degrees from head-on: azimuth toward the viewer's left (as orbitIn), elevation above it.
function currentPose(){
  const orbit=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  return {azimuth:wrapDegrees(-THREE.MathUtils.radToDeg(orbit.theta)),
    elevation:THREE.MathUtils.radToDeg(HEAD_PHI-orbit.phi),zoom:zoomScale};
}
// Landing only: `poseTo {path:[{at, azimuth, elevation, zoom}]}` runs one continuous
// orbit through timed keys from the pose on screen (pose_glide.js preparePath).
function landingPath(keys){
  if(!keys.length||!keys.every(k=>['at','azimuth','elevation','zoom'].every(n=>Number.isFinite(k?.[n])))||
    keys.some((k,i)=>k.at<=(i?keys[i-1].at:0)))return;
  if(orbitIn)endOrbitIn();
  const pose=k=>({azimuth:k.azimuth,
    elevation:THREE.MathUtils.clamp(k.elevation,THREE.MathUtils.radToDeg(HEAD_PHI-controls.maxPolarAngle),THREE.MathUtils.radToDeg(HEAD_PHI-controls.minPolarAngle)),
    zoom:THREE.MathUtils.clamp(k.zoom,...zoomBounds)});
  poseGlide.path([{at:0,values:currentPose()},...keys.map(k=>({at:k.at,values:pose(k)}))],performance.now(),['azimuth']);
  invalidate();publishState();
}
function poseTo(value){
  if(landing&&Array.isArray(value?.path)){landingPath(value.path);return;}
  const finite=key=>typeof value?.[key]==='number'&&Number.isFinite(value[key]);
  if(!['azimuth','elevation','zoom','ms'].every(finite)||value.ms<0||disposed)return;
  if(orbitIn)endOrbitIn();
  const from=currentPose();
  const to={azimuth:wrapDegrees(value.azimuth),
    elevation:THREE.MathUtils.clamp(value.elevation,THREE.MathUtils.radToDeg(HEAD_PHI-controls.maxPolarAngle),
      THREE.MathUtils.radToDeg(HEAD_PHI-controls.minPolarAngle)),
    zoom:THREE.MathUtils.clamp(value.zoom,...zoomBounds)};
  poseGlide.start(from,to,value.ms,performance.now(),['azimuth']);
  invalidate();publishState();
}
function applyPose({azimuth,elevation,zoom}){
  const orbit=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  orbit.theta=-THREE.MathUtils.degToRad(azimuth);
  orbit.phi=THREE.MathUtils.clamp(HEAD_PHI-THREE.MathUtils.degToRad(elevation),controls.minPolarAngle,controls.maxPolarAngle);
  fitting=true;camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(orbit));controls.update();fitting=false;
  zoomScale=THREE.MathUtils.clamp(zoom,...zoomBounds);
  lastCameraDistance=camera.position.distanceTo(controls.target);
}
function lightTo(value){
  const lightId=value?.id,p=value?.position;
  if(typeof lightId!=='string'||!sourceStates.some(state=>state.id===lightId)||disposed)return;
  if(!Array.isArray(p)||p.length!==3||!p.every(n=>typeof n==='number'&&Number.isFinite(n)))return;
  if(typeof value.ms!=='number'||!Number.isFinite(value.ms)||value.ms<0)return;
  const [x,y,z]=sourceStates.find(state=>state.id===lightId).position;
  const clamp=n=>THREE.MathUtils.clamp(n,-12,12);
  lightGlideIds.add(lightId);
  glides.channel('light:'+lightId).start({x,y,z},{x:clamp(p[0]),y:clamp(p[1]),z:clamp(p[2])},value.ms,performance.now());
  invalidate();publishState();
}
function moveLight(lightId,{x,y,z}){
  // A lesson's lamp glide (preset, lightTo) never takes the selection: it goes back to the lamp the learner had.
  const previous=selectedId;
  if(selectedId!==lightId){
    if(!session.select(lightId))return;
    refreshSessionState();lightState=sourceStates.find(state=>state.id===lightId);
  }
  setLight({...lightState,position:[x,y,z]});
  if(lesson&&previous!==lightId)selectSource(previous);
}
// One frame of every glide, before the quality is chosen so the frame takes the moving path.
function stepGlides(now){
  if(landing){
    // The size first: a lamp glide this frame then moves the lamp at its new size (the two compose).
    const size=landingSizeGlide.step(now);if(size)applySize(size.values.w);
    const zoom=landingZoomGlide.step(now);if(zoom)landingViewZoom=zoom.values.z;
    if(size||zoom){moveClock.touch(now);sceneDirty=true;}
  }
  if(lessonStudio?.step(now))moveClock.touch(now);
  const pose=poseGlide.step(now);
  if(pose)applyPose(pose.values);
  for(const lightId of lightGlideIds){
    const step=glides.channel('light:'+lightId).step(now);
    if(step)moveLight(lightId,step.values);
  }
  if(glides.active){moveClock.touch(now);sceneDirty=true;}
  glides.flush();
}
function resumeFromPause(){
  if(!paused||disposed)return;
  paused=false;
  const resumedAt=performance.now();
  glides.shiftAll(pausedAt,resumedAt);landingGlides.shiftAll(pausedAt,resumedAt);
  if(orbitIn)orbitIn.t0=orbitIn.t0>=pausedAt?resumedAt:orbitIn.t0+(resumedAt-pausedAt);
  invalidate();
}
function draw(){
  frame=0;if(disposed||document.hidden)return;
  const orbitDone=orbitIn?stepOrbitIn(performance.now()):false;
  // A lesson still draws the state it was given, at rest: no glide step, no moving frame.
  if(!stillCapture)stepGlides(performance.now());
  resolvePending=false;
  // Landing: the dot pitch never changes mid-beat (no coarse moving frame); every frame is the rested print.
  // It is the full print without the per-frame costs a moving tour cannot pay on a
  // phone: no lens defocus or grain passes (the backdrop is plain paper), and the
  // meter read asynchronously at the moving cadence.
  // A lesson likewise (Studio L2 round 3): its glides are the lesson's own beats, and a coarse moving
  // frame doubled the dots mid-move (the hook's looks, a Remember word's scene). The pitch holds.
  // At rest a lesson frame is the full print; mid-glide it drops the tour's per-frame costs.
  const glide=!stillCapture&&moveClock.moving(performance.now());
  const moving=!landing&&lessonStudio==null&&glide,base=renderQuality(moving,movingLook),
    light=landing||(lessonStudio!=null&&glide),
    quality=dragRenderQuality(light?{...base,defocus:false,grain:false,landingTour:true}:base,dragRender,{screenRatio:SCREEN_PIXEL_RATIO,screen:dragScreen});
  setPixelScale(quality);
  // A coarse moving canvas is shown with hard pixels when the choice asks (the half-res halftone); the full canvas never is.
  renderer.domElement.style.imageRendering=quality.nearest?'pixelated':'';
  // A gesture began mid-fade. The cel frame runs the blend back to the moving frames, no pop;
  // the halftone frame draws straight onto the (now small) canvas, so the blend ends.
  if(quality.cel&&liftFade.running)liftFade.back();
  else if(quality.moving&&liftFade.running){liftFade.stop();optics.endFade();}
  clearTimeout(settleTimer);
  // Held (a finger down on the view): no settle timer; the lift draws the one full frame.
  if(moving&&!moveClock.held)settleTimer=setTimeout(()=>invalidate(false),moveClock.untilSettled(performance.now())+1);
  // Frames of a gesture (orbit, zoom, light drag) may read the meter and
  // backdrop asynchronously, a frame behind; any other update reads them exactly.
  const continuous=performance.now()<gestureUntil;
  const refresh=sceneDirty,reframed=viewFrameDirty;viewFrameDirty=false;
  camera.clearViewOffset();
  if(refresh){fitView();updateSourceVisibility();}
  // The low-poly choice drew its shadows from the decimated bust: the first full frame redraws them from the real one.
  if(!quality.moving&&dragScene.shadowsStale){dragScene.shadowsStale=false;markShadows();}
  if(renderer.shadowMap.needsUpdate)shadowUpdates++;
  const started=performance.now();
  lessonStudio?.faceWindow();
  camera.updateMatrixWorld();
  const landmarks=bust.userData.getEyeLandmarks?.().all??[];
  const eyes=landmarks.length?landmarks.map(point=>new THREE.Vector3(...point.world)):[target.clone()];
  const eye=eyes.map(point=>point.clone().applyMatrix4(camera.matrixWorldInverse))
    .filter(point=>point.z<0).sort((a,b)=>b.z-a.z)[0];
  let settings=cameraSettings.state;
  focusDistance=settings.autofocus?Math.max(.1,-(eye?.z??-lastCameraDistance)/worldUnitsPerMeter):settings.focusDistance;
  const meteringHidden=sources.map(source=>source.softbox),outlines=[];
  bust.traverse(object=>{if(object.name==='headOutline')outlines.push(object);});
  meteringHidden.push(...outlines);
  // Lesson props are scenery: the exposure meter never reads them.
  if(lessonStudio)meteringHidden.push(...lessonStudio.meteringHidden());
  // Everything the HDR reading depends on; an unchanged key (a re-select, a
  // no-op command) reuses the last readback instead of a scene render.
  const meterKey=[camera.matrixWorld.elements.join(),camera.projectionMatrix.elements.join(),
    JSON.stringify(sourceStates),selectedModel,style].join('|');
  exposureMeter.setAspect(camera.aspect);
  // A moving frame reads the meter too, asynchronously (a frame behind, never waiting
  // on the GPU), at most once per MOVING_METER_MS; a frame between reads keeps the last
  // reading, and the next full frame reads the meter afresh.
  const frameNow=performance.now();
  const meterDue=quality.meter&&(!(quality.moving||quality.landingTour)||meterIsDue(frameNow,lastMeterAt));
  const skipMeter=!meterDue&&exposureMeter.metrics.hasPixels;
  const meterStarted=performance.now(),samplesBefore=exposureMeter.metrics.sampleCount;
  const reading=skipMeter?exposureMeter.read(settings.meteringMode)
    :exposureMeter.sample(scene,camera,{hidden:meteringHidden,mode:settings.meteringMode,refresh:refresh||meterBehind,key:meterKey,allowAsync:continuous||quality.moving||quality.landingTour===true});
  if(exposureMeter.metrics.sampleCount!==samplesBefore){lastMeterAt=frameNow;lastMeterMs=performance.now()-meterStarted;meterReads++;}
  meterBehind=skipMeter;
  // Settings on A follow the meter once the gesture ends, a detent at a time.
  lastScene=reading.scene;scheduleAuto();
  applyMeter(reading,settings);
  renderer.toneMappingExposure=settings.exposureMultiplier;
  // The optics pass renders scene + depth + a full-screen quad per frame; count all of them
  // rather than only the last pass so drawCalls/triangles describe the whole frame.
  renderer.info.autoReset=false;renderer.info.reset();
  applyViewFrame();
  // The outline hull draws the bust a second time: the moving frame goes without it.
  for(const outline of outlines)outline.visible=style==='print'&&quality.outline;
  // A drag render other than the first changes the lights, shadows or materials for the optics pass only (the meter read the real scene above).
  const undoDrag=dragScene.apply(quality,{renderer,bust,sources,target}),dragKey=quality.dragRender??0;
  const opticsArgs={focalLength,aperture:settings.aperture,focusDistance,worldUnitsPerMeter,printStyle:quality.printStyle??style,refresh:refresh||reframed||lastMoving!==quality.moving||lastDrag!==dragKey,viewZoom:viewFrame.zoom*viewFrame.sheetZoom,subjectDistance:lastCameraDistance/worldUnitsPerMeter,
    // Display-only: sensor noise at the ISO and handheld shake at the shutter. The meter read its own render above.
    iso:settings.iso,shakePx:handheldShake(focalLength,settings.shutter).blurPx*renderer.getPixelRatio(),pixelRatio:renderer.getPixelRatio(),cheap:quality.cheap,cel:quality.cel,
    defocus:quality.defocus,grain:quality.grain,dotPitch:quality.dotPitch??(quality.look==='halftone'?MOVING_SCREEN.pitch:0),keepFrame:(quality.look==='halftone'||quality.look==='drag')&&liftFade.enabled,nearestFrame:quality.nearest===true,waveCells:LIFT_WAVE_CELLS,toneFloor:quality.toneFloor===true};
  // The lift out of the moving halftone also keeps the tone the full print is cut from (the same pass, screen deferred), so the dissolve can split the coarse dots into the fine ones (lighting_optics.js BLIT_FRAGMENT).
  if(liftFade.enabled&&!quality.moving&&optics.movingHalftone&&optics.hasMovingFrame&&(lastMoving||liftFade.running)){
    optics.render(scene,camera,{...opticsArgs,toneOnly:true});opticsArgs.refresh=false;
  }
  optics.render(scene,camera,opticsArgs);
  undoDrag();lastDrag=dragKey;
  // The lift (or a full frame redrawn mid-fade): this frame is what the fade runs to.
  const fadeIn=liftFade.enabled&&!quality.moving&&optics.hasMovingFrame&&(lastMoving||liftFade.running);lastMoving=quality.moving;
  const strips=backdrop.sample({allowAsync:continuous});if(strips)meterState.backdrop=strips;
  headerSampler.sample();
  inkSampler.sample();
  sceneDirty=false;
  if(perfSync){const gl=renderer.getContext();renderer.setRenderTarget(null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,perfPixel);}
  lastDrawMs=performance.now()-started;
  const m=area.metrics;
  const selected=sources.find(source=>source.state.id===selectedId);
  window.focalLightingMetrics={renderedFrames:++renderedFrames,triangles:renderer.info.render.triangles,
    drawCalls:renderer.info.render.calls,pixelRatio:renderer.getPixelRatio(),litPixelRatio:LIT_PIXEL_RATIO,sourceScale,style,framing,viewFrame:{...viewFrame},
    assetTriangles:bust.userData.assetTriangles,cameraPosition:camera.position.toArray(),focalLength,fov:camera.fov,fieldOfView:camera.fov,
    cameraTarget:controls.target.toArray(),aimGoal,zoomScale,fitDistance,viewDistance:lastCameraDistance,farPlane:camera.far,
    camera:{...settings,focusDistance},meter:{...meterState},worldUnitsPerMeter,
    focusEyes:eyes.map(point=>point.toArray()),
    lightPosition:m.position.toArray(),target:m.target.toArray(),normal:m.normal.toArray(),
    sourceWidth:m.width,sourceHeight:m.height,distance:m.distance,
    referenceIlluminance:m.referenceIlluminance,computedReferenceIlluminance:m.computedReferenceIlluminance,
    sampleCount:m.sampleCount,shadowMapSize:m.mapSize,lastDrawMs,lastMeterMs,meterReads,cel:quality.cel,moving:quality.moving,movingLook:movingLook,movingScale,dragRender,lowPolyTriangles:quality.recipe?.lowPoly?dragScene.lowPolyTriangles(bust):null,orbitIn:orbitState,dotPitch:optics.uniforms.dotPitch.value,celRenders:optics.celRenders,fadeSteps,lastFadeMs,
    meterSamples:exposureMeter.metrics.sampleCount,sceneRenders:optics.sourceRenders,
    sourceAppearance:sourceIsOutline?'outline':'solid',sourceOutlineOpacity:selected.boxEdges.material.opacity,
    sourceHousingVisible:selected.casing.visible,sourceFaceVisible:selected.face.visible,
    selectedId,model:selectedModel,modelBusy:bustBusy,modelError,exposureMode,shadowUpdates,shadowMapMarks,totalShadowMaps:sources.reduce((sum,source)=>sum+source.area.samples.length,0),
    lights:sources.map(source=>({id:source.state.id,position:source.state.position,width:source.state.width,
      enabled:source.state.enabled,powerStops:source.state.powerStops,brightnessPercent:source.state.brightnessPercent,panelShade:source.face.material.color.getHexString(),output:source.area.metrics.output,
      referenceIlluminance:source.area.metrics.computedReferenceIlluminance,sourceAppearance:source.outline?'outline':'solid'})),
    samples:area.samples.map(sample=>sample.light.position.toArray()),
    shadowSamples:area.samples.map(({light})=>({enabled:light.castShadow,
      bias:light.shadow.bias,normalBias:light.shadow.normalBias,radius:light.shadow.radius})),
    sampleFrusta:area.samples.map(sample=>({angle:sample.light.angle,far:sample.light.shadow.camera.far,
      targetDistance:sample.referenceDistance,sourceCosine:sample.sourceCosine}))};
  lessonStudio?.updateFace();
  // A still's frame is never published: the host sees the live state only.
  if(!stillCapture){publishState();bridge?.flush();}
  if(fadeIn){optics.captureLift();liftFade.start();}
  // The aim is still gliding to its goal: draw the next step, cheaply, as a move.
  if(aimFollow.settling){moveClock.touch(performance.now());invalidate(true);}
  if(orbitDone)endOrbitIn();else if(orbitIn)invalidate(true);
  if(glides.active||landingGlides.active)invalidate(true);
}
// Preserve a pending scene refresh when light and exposure edits share a frame.
function invalidate(refresh=true){sceneDirty=sceneDirty||refresh;if(!frame&&!disposed&&!document.hidden&&!paused)frame=requestAnimationFrame(draw);}// Draw the pending frame now instead of on the next animation frame.
function drawNow(){if(!frame)return;cancelAnimationFrame(frame);draw();}
function setLight(next){
  const p=new THREE.Vector3(...next.position);
  p.x=THREE.MathUtils.clamp(p.x,-12,12);p.y=THREE.MathUtils.clamp(p.y,-12,12);p.z=THREE.MathUtils.clamp(p.z,-12,12);
  const direction=p.clone().sub(target);
  // Keep the emitting plane outside the bust; crossing the protected center
  // moves around it instead of putting a lamp inside the face.
  if(direction.length()<2.35){
    // Respect the untouched axis of the selected orthographic view.
    const axes=next.axes??[0,1,2],values=direction.toArray();
    const fixedSquared=values.reduce((sum,value,index)=>sum+(axes.includes(index)?0:value*value),0);
    const radius=Math.sqrt(Math.max(0,2.35**2-fixedSquared));
    let length=Math.hypot(...axes.map(index=>values[index]));
    if(length<1e-8){
      for(const index of axes)values[index]=lightState.position[index]-target.getComponent(index);
      length=Math.hypot(...axes.map(index=>values[index]));
      if(length<1e-8){values[axes[0]]=1;length=1;}
    }
    for(const index of axes)values[index]*=radius/length;
    p.copy(target).add(new THREE.Vector3(...values));
  }
  const width=THREE.MathUtils.clamp(next.width,.15,12);
  session.update({position:p.toArray(),width,height:width*1.25});refreshSessionState();lightState=sourceStates.find(state=>state.id===selectedId);
  syncSource(sources.find(source=>source.state.id===selectedId));selectSource(selectedId);
  markShadows(sources.filter(source=>source.state.id===selectedId));invalidate();publishState();
}

function setSize(value){
  if(typeof value!=='number'||!Number.isFinite(value))return;
  const width=THREE.MathUtils.clamp(value,.15,12);
  // Landing: the lamp grows or shrinks to its new size, its softness with it, over LANDING_SIZE_MS (standard easing).
  if(landing&&!landingReduced()&&lightState&&Math.abs(lightState.width-width)>1e-6){
    landingSizeGlide.start({w:lightState.width},{w:width},LANDING_SIZE_MS,performance.now());invalidate();return;
  }
  if(landing)landingSizeGlide.cancel();
  applySize(width);
}
function applySize(width){
  session.update({width,height:width*1.25});refreshSessionState();lightState=sourceStates.find(state=>state.id===selectedId);
  syncSource(sources.find(source=>source.state.id===selectedId));
  placement.setState(lightState);markShadows(sources.filter(source=>source.state.id===selectedId));invalidate();publishState();
}

function setStyle(next){
  if(next!=='print'&&next!=='smooth')return;
  style=next;bust.userData.setStyle(style);
  for(const option of ['print','smooth'])$(option).setAttribute('aria-pressed',String(option===style));
  invalidate();publishState();
}

function disposeBust(root){
  if(typeof root.userData.dispose==='function'){root.userData.dispose();return;}
  const geometries=new Set(),materials=new Set();
  root.traverse(object=>{if(object.isMesh||object.isLineSegments){geometries.add(object.geometry);materials.add(object.material);}});
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials)material.dispose();
}
async function setBustModel(next){
  if(!bustModels.some(model=>model.id===next)||next===selectedModel||bustBusy||disposed)return;
  const request=++bustRequest;bustBusy=true;modelError=null;publishState();
  try{
    const replacement=await buildBust(next,{facePilot,
      onProgress:event=>publishLoadingProgress('lighting',{loaded:event.loaded,total:event.total})});
    if(disposed||request!==bustRequest){disposeBust(replacement);return;}
    const previous=bust;bust=replacement;selectedModel=next;
    scene.add(bust);sourceOcclusion=createSourceOcclusion(bust);
    bust.userData.setStyle(style);updateFramingPoints();
    scene.remove(previous);disposeBust(previous);
    markShadows();invalidate();publishState();
  }catch(error){modelError='That bust could not be loaded. Try another model.';console.error('Could not load lighting bust',next,error);}
  finally{if(request===bustRequest){bustBusy=false;publishState();}}
}

function publishState(){bridge?.publish();}

function getState(){
  const sessionState=session.getState();
  return {ready:!disposed&&sources.length>0&&!bustBusy,busy:bustBusy,model:selectedModel,modelError,models:bustModels.map(({id,label})=>({id,label})),selectedId,
    maxLights:sessionState.maxLights,canAdd:sessionState.canAdd,canRemove:sessionState.canRemove,
    lights:sourceStates.map(({id,label,enabled,powerStops,brightnessPercent,position,width,height})=>
      ({id,label,enabled,powerStops,brightnessPercent,position:[...position],width,height})),
    exposureMode,shading:style,framing,zoomScale,focalLength,focalLengths:[...FOCAL_LENGTHS],fieldOfView:camera.fov,
    camera:{...cameraSettings.state,focusDistance},meter:{...meterState},
    ...(headerSampler.value===null?{}:{headerLuminance:headerSampler.value}),
    ...(inkSampler.values?{inkLuminance:inkSampler.values}:{}),glide:glides.state(),
    cameraPosition:camera.position.toArray(),cameraTarget:controls.target.toArray(),
    ...(lessonStudio?lessonStudio.state():{})};
}
// A lesson still: one full-quality frame of whatever state is set, drawn now and never published.
function renderStillFrame(){
  cancelAnimationFrame(frame);frame=0;
  stillCapture=true;sceneDirty=true;
  if(liftFade.running){liftFade.stop();optics.endFade();}
  lastMoving=false;
  try{draw();}finally{stillCapture=false;}
}
function syncLessonCamera(){
  focalLength=cameraSettings.state.focalLength;camera.setFocalLength(focalLength);camera.updateProjectionMatrix();
  invalidate(true);publishState();
}

function onHostCommand({action,value}={}){
  if(lessonStudio&&lessonStudio.command(action,value))return;
  if(action==='hold'){holdHost=value===true;holdChanged();return;}
  if(action==='orbitIn'){startOrbitIn();return;}
  if(action==='dragRender'){const next=dragRenderIndex(value);if(next!==dragRender){dragRender=next;if(moveClock.moving(performance.now()))invalidate(false);}return;}
  // A touch on the stage ends the dolly where it is (the host brings the chrome in at once).
  if(action==='dollyEnd'){if(orbitIn)endOrbitIn();return;}
  if(action==='pause'){if(!paused)pausedAt=performance.now();paused=true;cancelAnimationFrame(frame);frame=0;clearTimeout(settleTimer);return;}
  // Landing page: continue where `pause` stopped (glides and the opening orbit pick up their progress).
  if(action==='resume'){resumeFromPause();return;}
  if(action==='poseTo'){poseTo(value);return;}
  if(action==='lightTo'){lightTo(value);return;}
  // Landing only (r9): the visitor's zoom buttons; the tour's own poses keep running under it.
  if(landing&&action==='viewZoom'){landingZoomTo(value);return;}
  // The learner's own move ends the opening orbit and any poseTo glide where they are.
  if(action==='viewport'&&orbitIn)endOrbitIn();
  if(action==='viewport'&&(value?.kind==='orbit'||value?.kind==='zoom'||(value?.kind==='gesture'&&value.down===true)))poseGlide.cancel();
  if(action==='position'){
    const explicit=typeof value?.id==='string'?value.id:selectedId;
    if(lightGlideIds.has(explicit))glides.channel('light:'+explicit).cancel();
  }
  // A finger down on the view or lifted off it: plain frames while down, one full frame on lift.
  if(action==='viewport'&&value?.kind==='gesture'){moveClock.hold(value.down===true,performance.now());invalidate(false);return;}
  if(action==='viewport'||action==='position'||action==='size'||action==='power'||action==='brightness')touchHold();
  if(action==='viewport'||action==='position')gestureUntil=performance.now()+GESTURE_MS;
  // A learner's zoom or orbit (a button tap, the wheel, a key) waits LIFT_SETTLE_MS before the full render lifts in; the sheet's own reframes settle at once.
  if(action==='viewport')moveClock.touch(performance.now(),value?.kind==='zoom'||value?.kind==='orbit'?LIFT_SETTLE_MS:undefined);
  if(action==='viewport'){
    if(!controls.enabled||disposed||!value||typeof value!=='object')return;
    if(value.kind==='zoom'&&typeof value.scale==='number'&&Number.isFinite(value.scale)){
      zoomScale=THREE.MathUtils.clamp(value.scale,...zoomBounds);invalidate();publishState();return;
    }
    if(value.kind==='orbit'&&[value.dx,value.dy,value.height].every(n=>typeof n==='number'&&Number.isFinite(n))&&value.height>0){
      const orbit=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      orbit.theta-=2*Math.PI*value.dx/value.height*controls.rotateSpeed;
      orbit.phi=THREE.MathUtils.clamp(orbit.phi-2*Math.PI*value.dy/value.height*controls.rotateSpeed,
        controls.minPolarAngle,controls.maxPolarAngle);
      fitting=true;camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(orbit));controls.update();fitting=false;
      lastCameraDistance=camera.position.distanceTo(controls.target);invalidate();return;
    }
    return;
  }
  // Native sheet diagrams use the same constrained placement path as the
  // standalone diagrams. Only the two coordinates in that view may move.
  if(action==='position'){
    const p=value?.position,axes=value?.axes;
    if(!Array.isArray(p)||p.length!==3||!p.every(n=>typeof n==='number'&&Number.isFinite(n))||
      !Array.isArray(axes)||axes.length!==2||axes[0]!==0||![1,2].includes(axes[1]))return;
    const explicitId=value.id;
    if(explicitId!==undefined){
      if(typeof explicitId!=='string'||!session.select(explicitId))return;
      refreshSessionState();lightState=sourceStates.find(state=>state.id===selectedId);
    }
    const position=[...lightState.position];
    for(const axis of axes)position[axis]=p[axis];
    setLight({...lightState,position,axes});return;
  }
  if(action==='headerBand'){if(headerSampler.setBand(value))invalidate(false);return false;}
  if(action==='inkBands'){if(inkSampler.setBands(value))invalidate(false);return false;}
  if(action==='meterBand'){if(backdrop.setBand(value))invalidate(false);return false;}
  if(action==='reframe'){
    const shiftY=value?.shiftY,zoom=value?.zoom;
    if(typeof shiftY!=='number'||typeof zoom!=='number'||!Number.isFinite(shiftY)||!Number.isFinite(zoom))return false;
    const fit=typeof value.fit==='number'&&Number.isFinite(value.fit)?THREE.MathUtils.clamp(value.fit,.1,1):1;
    const floor=typeof value.floor==='number'&&Number.isFinite(value.floor)?THREE.MathUtils.clamp(value.floor,0,fit-.1):0;
    const framedShift=THREE.MathUtils.clamp(shiftY,-1,1),framedZoom=THREE.MathUtils.clamp(zoom,.1,1);
    // The open light sheet's window (Kent, October 16, 2026): the host's band, from the header's foot to the sheet's top edge, as fractions of the canvas; absent keeps the last, null is closed.
    const band=value.sheetBand;
    let opened=band===undefined?{sheet:viewFrame.sheet,sheetZoom:viewFrame.sheetZoom}:{sheet:0,sheetZoom:1};
    // A pan of the window by the two windows' center difference: the bust's size, zoom and orbit are not read.
    if(band&&typeof band==='object')opened=sheetWindow({band:[band.top,band.bottom],closedBottom:band.closedBottom,blend:band.blend});
    const sheet=THREE.MathUtils.clamp(opened.sheet,-1,1),sheetZoom=THREE.MathUtils.clamp(opened.sheetZoom,.1,1);
    const next={shiftY:framedShift,zoom:framedZoom,fit,floor,sheet,sheetZoom};
    const aimY=landing&&typeof value.aimY==='number'&&Number.isFinite(value.aimY)?THREE.MathUtils.clamp(value.aimY,-1,1):landingAimY;
    const aimMoved=aimY!==landingAimY;landingAimY=aimY;
    // Only the sheet's lens shift changed: repaint through the new window, no refit (the aim stays).
    if(!aimMoved&&next.shiftY===viewFrame.shiftY&&next.zoom===viewFrame.zoom&&next.fit===viewFrame.fit&&next.floor===viewFrame.floor&&(next.sheet!==viewFrame.sheet||next.sheetZoom!==viewFrame.sheetZoom)){
      viewFrame=next;viewFrameDirty=true;moveClock.touch(performance.now());invalidate(false);return false;
    }
    if(aimMoved||next.shiftY!==viewFrame.shiftY||next.zoom!==viewFrame.zoom||next.fit!==viewFrame.fit||next.floor!==viewFrame.floor){
      // Any new frame refits like a pinch frame does: the aim is chosen inside the clear box
      // (see eyeFraming), so a shift or zoom that only repainted would leave the aim stale
      // until the next touch (Kent, October 15, 2026: the bust sat too low after the panel closed).
      viewFrame=next;viewFrameDirty=true;moveClock.touch(performance.now());invalidate(true);}
    return false;
  }
  if(action==='framing'&&['portrait','setup'].includes(value)){framing=value;resetView();return;}
  if(action==='focalLength'){if(typeof value==='number'&&Number.isFinite(value))setFocalLength(value);return;}
  if(['iso','aperture','shutter','auto','lens','autofocus','focusDistance','meteringMode'].includes(action)){
    if(action==='autofocus'&&value===false)cameraSettings.set('focusDistance',focusDistance);
    if(cameraSettings.set(action,value)){
      const previousFocalLength=focalLength;
      focalLength=cameraSettings.state.focalLength;camera.setFocalLength(focalLength);camera.updateProjectionMatrix();
      // These camera controls operate on the existing linear image/depth.
      invalidate(action==='lens'||focalLength!==previousFocalLength);publishState();
    }
    return;
  }
  if(action==='view'&&value==='front'){resetView();return;}
  if(action==='shading'){setStyle(value);return;}
  if(action==='model'){setBustModel(value);return;}
  if(action==='dismissModelError'){modelError=null;publishState();return;}
  if(action==='select'){changeSession({type:'select',id:value});return;}
  if(action==='add'||action==='remove'){changeSession({type:action});return;}
  if(action==='size'){setSize(value);return;}
  if(action==='power'){
    if(typeof value==='number'&&Number.isFinite(value))changeSession({type:'power',powerStops:value});return;
  }
  if(action==='brightness'){
    if(typeof value==='number'&&Number.isFinite(value))changeSession({type:'brightness',brightnessPercent:value});return;
  }
  if(action==='enabled'){
    if(typeof value==='boolean'&&lightState.enabled!==value)changeSession({type:'toggle'});return;
  }
}
controls.addEventListener('change',()=>{
  if(fitting)return;
  gestureUntil=performance.now()+GESTURE_MS;moveClock.touch(performance.now());
  const distance=camera.position.distanceTo(controls.target);
  // OrbitControls only changes radius for a user dolly. Programmatic fitting
  // is guarded above so sheet resizing cannot feed back into manual zoom.
  if(Math.abs(distance-lastCameraDistance)>.00001){
    zoomScale=THREE.MathUtils.clamp(zoomScale*distance/lastCameraDistance,...zoomBounds);
    publishState();
  }
  lastCameraDistance=distance;invalidate();
});
// A pointer on the canvas itself (no host gesture) holds the clock the same way; the full render lifts LIFT_SETTLE_MS after it lifts.
controls.addEventListener('start',()=>{poseGlide.cancel();renderer.domElement.style.cursor='grabbing';moveClock.hold(true,performance.now());});
controls.addEventListener('end',()=>{renderer.domElement.style.cursor='grab';moveClock.hold(false,performance.now());invalidate(false);});
$('front').onclick=resetView;
renderer.domElement.addEventListener('keydown',event=>{
  if(landing||!controls.enabled||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','+','=','-','_'].includes(event.key))return;
  event.preventDefault();
  if(lessonStudio?.blocksKey(event.key))return;
  poseGlide.cancel();
  if(event.key==='Home'){resetView();return;}
  if(['+','=','-','_'].includes(event.key)){
    zoomScale=THREE.MathUtils.clamp(zoomScale*(['+','='].includes(event.key)?.9:1.1),...zoomBounds);
    moveClock.touch(performance.now(),LIFT_SETTLE_MS);invalidate();publishState();return;
  }
  const orbit=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  if(event.key==='ArrowLeft')orbit.theta-=.15;if(event.key==='ArrowRight')orbit.theta+=.15;
  if(event.key==='ArrowUp')orbit.phi-=.1;if(event.key==='ArrowDown')orbit.phi+=.1;
  orbit.phi=THREE.MathUtils.clamp(orbit.phi,controls.minPolarAngle,controls.maxPolarAngle);
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(orbit));controls.update();
});
for(const mode of ['print','smooth'])$(mode).onclick=()=>setStyle(mode);
// The canvas at w x h CSS px (not applySize, the lamp width; the stage's size, or a lesson still's own; style untouched for a still).
function applyCanvasSize(w,h,style=true){
  const ratio=renderer.getPixelRatio();renderer.setSize(w,h,style);
  optics.forgetMovingFrame();
  optics.resize(w*ratio,h*ratio,sourceScale*LIT_PIXEL_RATIO/ratio,CEL_SCALE*SCREEN_PIXEL_RATIO/ratio);
  camera.aspect=w/h;camera.setFocalLength(focalLength);camera.updateProjectionMatrix();invalidate();
}
const resize=new ResizeObserver(()=>{
  applyCanvasSize($('stage').clientWidth,$('stage').clientHeight);
  // setSize cleared the canvas: redraw before the browser paints (or a snapshot
  // reads it), or the whole picture is missing for a frame after every resize.
  drawNow();
});resize.observe($('stage'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else invalidate();});
renderer.domElement.addEventListener('webglcontextlost',e=>{
  e.preventDefault();contextLost=true;$('loading').hidden=false;$('loading').textContent='The 3D view was interrupted. Reload to continue.';
  controls.enabled=false;placement.setEnabled(false);
  for(const id of ['print','smooth','front'])$(id).disabled=true;
});
window.addEventListener('pagehide',()=>{
  disposed=true;lessonStudio?.dispose();bridge?.dispose();cancelAnimationFrame(frame);resize.disconnect();controls.dispose();placement.dispose();
  const geometries=new Set(),materials=new Set();
  scene.traverse(o=>{if(o.isMesh||o.isLineSegments){geometries.add(o.geometry);materials.add(o.material);}});
  for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
  for(const source of sources)source.area.dispose();exposureMeter.dispose();optics.dispose();renderer.dispose();
});
for(const id of ['print','smooth','front'])$(id).disabled=false;
$('loading').hidden=true;placement.setEnabled(true);rebuildSources();setLight(lightState);
if(lesson)lessonStudio=(await import('./lesson_studio.js')).createLessonStudio({THREE,scene,camera,controls,renderer,session,cameraSettings,placement,glides,
  invalidate,publishState,lightTo,refreshSessionState,syncSource,markShadows,currentPose,applyPose,renderStillFrame,
  setFocalLength,getFocalLength:()=>focalLength,getCameraDistance:()=>lastCameraDistance,syncCamera:syncLessonCamera,
  getSources:()=>sources,getSourceStates:()=>sourceStates,getSelectedId:()=>selectedId,getBust:()=>bust,contextLost:()=>contextLost,isDark:()=>dark,
  stillSize:(w,h)=>applyCanvasSize(w,h,false),stageSize:()=>applyCanvasSize($('stage').clientWidth,$('stage').clientHeight)});
bridge=createHostBridge({kind:'lighting',getState,onCommand:onHostCommand,coalesce:true,
  onTheme:tokens=>applySceneTheme(scene,tokens,{invalidate,levels,onApplied:()=>{optics.setShadeColors(document.documentElement.style.getPropertyValue('--fg'),levelPreimage(document.documentElement.style.getPropertyValue('--bg'),levels.black,levels.white));optics.setLevels(levels.black,levels.white);},
    onDark:value=>{dark=value;recolourSoftboxEdges(sources,dark);lessonStudio?.props.retone();}})});
publishState();

