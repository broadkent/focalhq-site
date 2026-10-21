// The Studio's lesson mode (URL param lesson=1): the bridge commands the Studio lessons
// (plan docs/plan/lessons/studio-lessons-plan.md, section 5) drive. Loaded by lighting.js
// only when lesson=1, so the lab and the landing page never run any of it.
//
// Commands (all ignored unless lesson=1):
//   preset {name, ms, id?}     lamp to a named place (lesson_presets.js)
//   lock {orbit, zoom, lamp}   learner input locks; the host's own commands still run
//   still {id?, state, width?, height?, release?}  render the Studio at `state` (lights, pose, focalLength,
//                              props) to a blob URL (state.stills[id])
//   sizeOf {id, value}         lamp width by id, selection untouched
//   equalFraming {on, ms?, distance?}  hold head size as the focal length changes; the rate is
//                              taken once, at the first on (or from distance), and held until off
//   chrome {lamps, canvasLamp} show the lamp / take canvas lamp drags (both off by default:
//                              the lesson picture and its stills are the bust and its light)
//   lessonLens {focalLength?}  select the 16-200 mm lens
//   props {on, set?, posts?}           the lesson set behind the bust: set 'window' (default: a
//                                      wall close behind with a window and a plant) or 'posts'
//                                      (lesson 9's receding row, bare background); lesson_props.js
// Published state (lesson only): lesson, lock, chrome, props, equalFraming, ratio, faceRect,
// noseRect, cheekRect, shadowEdgeAnchor, shadowSide, lampRects ({id: rect}, shown lamps only), stills.
import {createLessonLock} from './lesson_lock.js';
import {presetPosition,LAMP_TARGET} from './lesson_presets.js';
import {keyFillRatio,equalFramingRate} from './lesson_math.js';
import {faceGeometry} from './lesson_face.js';
import {createLessonProps} from './lesson_props.js';

// A lesson lens change's glide, ms (lesson 8 playtest, October 19, 2026).
export const LENS_GLIDE_MS=450;
// The lesson aim: this far under the eye line, scene units: the published face rect's centre, so
// the face holds its place in the frame at every lens (measured: 0.3 drifted it 6% up at 200 mm).
export const FACE_AIM_DROP=.22;

/** The lesson camera's aim: the face's middle, below the eye line, whatever the lens. */
export function faceAimPoint(eyes){
  const n=eyes.length,mid=[0,0,0];
  for(const eye of eyes)for(let i=0;i<3;i++)mid[i]+=eye[i]/n;
  return [mid[0],mid[1]-FACE_AIM_DROP,mid[2]];
}

export function createLessonStudio(ctx){
  const {THREE,camera,controls,renderer,session,cameraSettings,placement}=ctx;
  const lock=createLessonLock();
  // Studio L2 review: the lamp mesh, its housing edges and outline are teaching chrome for the
  // lab, never part of a lesson's print.
  const chrome={lamps:false,canvasLamp:false};
  const eq={on:false,rate:null,depth:0,ms:0,distance:null,clamped:false};
  const props=createLessonProps({THREE,scene:ctx.scene,lesson:true,isDark:()=>ctx.isDark?.()===true});
  // A still never shows the lamp, even on a page whose live view does.
  let stilling=false;
  const stills={},urls={};
  let face=null,lampRects={};
  const lensGlide=ctx.glides.channel('lens');
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const lightIds=()=>ctx.getSourceStates().map(state=>state.id);

  function applyLocks(){
    controls.enableRotate=!lock.state.orbit;controls.enableZoom=!lock.state.zoom;
    placement.setEnabled(!ctx.contextLost()&&!lock.state.lamp&&chrome.canvasLamp);
  }
  const bounds=()=>({min:controls.minDistance,max:controls.maxDistance});
  // How far the face stands in front of the orbit target, toward the camera. Equal
  // framing holds the face's own distance in step with the lens, so the face, not the head's
  // centre, keeps its size (within a few percent from 24 to 200 mm).
  function faceDepth(){
    const eyes=ctx.getBust?.()?.userData.getEyeLandmarks?.().all??[];
    if(!eyes.length)return 0;
    const mid=new THREE.Vector3();for(const eye of eyes)mid.add(new THREE.Vector3().fromArray(eye.world));
    mid.divideScalar(eyes.length);
    const toCamera=camera.position.clone().sub(controls.target).normalize();
    // Half the eyes' depth: the face's rect runs from the brows to the chin, whose mean depth
    // sits about halfway between the eyes and the target (measured: the eyes' full depth
    // over-corrects wide lenses by 7%, none under-corrects by 7%).
    return Math.max(0,mid.sub(controls.target).dot(toCamera))*.5;
  }

  function sizeOf(value){
    const id=value?.id,v=value?.value;
    if(typeof id!=='string'||!lightIds().includes(id)||typeof v!=='number'||!Number.isFinite(v))return;
    const width=THREE.MathUtils.clamp(v,.15,12);
    session.updateLight(id,{width,height:width*1.25});ctx.refreshSessionState();
    const source=ctx.getSources().find(s=>s.state.id===id);
    if(source)ctx.syncSource(source);
    if(id===ctx.getSelectedId())placement.setState(ctx.getSourceStates().find(s=>s.id===id));
    ctx.markShadows(source?[source]:undefined);ctx.invalidate();ctx.publishState();
  }

  function setEqualFraming(value){
    if(typeof value?.on!=='boolean')return;
    if(!value.on){eq.on=false;ctx.invalidate();return;}
    const focal=ctx.getFocalLength();
    const given=typeof value.distance==='number'&&Number.isFinite(value.distance)&&value.distance>0;
    eq.ms=typeof value.ms==='number'&&value.ms>0?value.ms:0;
    // One rate from the first on until off (lesson 9, October 19, 2026): a repeated on (the shell
    // re-sends the scene's equalFraming with every show, after the lens has changed) keeps it;
    // reading the stale camera distance again made the head drift with the lens.
    if(eq.on&&!given){ctx.invalidate();return;}
    eq.on=true;eq.depth=faceDepth();
    eq.rate=equalFramingRate(Math.max(1e-3,(given?value.distance:ctx.getCameraDistance())-eq.depth),focal);
    ctx.invalidate();
  }

  // Every lesson lens change glides (lesson 8 playtest: a cut read as a jump), over equal
  // framing's own duration when it set one. Reduced motion, or no change, sets it at once.
  function focalCommand(value){
    if(reduced()||typeof value!=='number'||!Number.isFinite(value))return false;
    const from=ctx.getFocalLength();
    if(Math.abs(from-value)<1e-6&&!lensGlide.active)return false;
    lensGlide.start({f:from},{f:value},eq.on&&eq.ms?eq.ms:LENS_GLIDE_MS,performance.now());
    ctx.invalidate();ctx.publishState();return true;
  }

  // The state a still sets and restores: every lamp, the camera pose and the lens.
  const snapshot=()=>({lights:ctx.getSourceStates().map(({id,position,width,brightnessPercent,enabled})=>({id,position:[...position],width,brightnessPercent,enabled})),
    pose:ctx.currentPose(),focalLength:ctx.getFocalLength(),props:props.on,propSet:props.kind});
  function applyState(state){
    for(const light of state.lights??[]){
      if(!lightIds().includes(light?.id))continue;
      const patch={};
      if(Array.isArray(light.position)&&light.position.length===3&&light.position.every(Number.isFinite))patch.position=[...light.position];
      if(Number.isFinite(light.width)){patch.width=THREE.MathUtils.clamp(light.width,.15,12);patch.height=patch.width*1.25;}
      if(Number.isFinite(light.brightnessPercent)){patch.brightnessPercent=THREE.MathUtils.clamp(light.brightnessPercent,0,100);patch.powerStops=patch.brightnessPercent>0?Math.log2(patch.brightnessPercent/50):null;}
      if(typeof light.enabled==='boolean')patch.enabled=light.enabled;
      session.updateLight(light.id,patch);
    }
    ctx.refreshSessionState();
    for(const source of ctx.getSources())ctx.syncSource(source);
    ctx.markShadows();
    if(state.pose)ctx.applyPose({...ctx.currentPose(),...state.pose});
    if(Number.isFinite(state.focalLength))ctx.setFocalLength(state.focalLength);
    if(typeof state.props==='boolean')props.set(state.props,state.propSet);
  }
  // Render [state] to a PNG blob URL and put the live state back inside the same task: the
  // browser composites only between tasks, so the still's frame is never on screen. toBlob
  // copies the canvas when it is called; the encoding finishes later.
  async function still(value){
    const id=typeof value?.id==='string'&&value.id?value.id:'still';
    if(value?.release===true){if(urls[id])URL.revokeObjectURL(urls[id]);delete urls[id];delete stills[id];ctx.publishState();return;}
    if(!value||typeof value.state!=='object'||!value.state)return;
    const before=snapshot(),canvas=renderer.domElement;
    // At its displayed size (CSS px; the halftone keeps the live view's dot pitch, where a
    // downscaled full-size still went to a coarse checker), else the live view's.
    const sized=Number.isFinite(value.width)&&Number.isFinite(value.height)&&value.width>=16&&value.height>=16;
    if(sized)ctx.stillSize(Math.round(value.width),Math.round(value.height));
    applyState(value.state);stilling=true;
    try{ctx.renderStillFrame();}finally{stilling=false;}
    const encoded=new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const width=canvas.width,height=canvas.height;
    if(sized)ctx.stageSize();
    applyState(before);ctx.renderStillFrame();ctx.invalidate();
    const blob=await encoded;
    if(!blob)return;
    if(urls[id])URL.revokeObjectURL(urls[id]);
    urls[id]=URL.createObjectURL(blob);stills[id]={url:urls[id],width,height};
    ctx.publishState();
  }

  return {
    lock,props,
    // Handles a host command; true when it was (or was refused as) one of ours.
    command(action,value){
      switch(action){
        case 'preset':{
          const position=presetPosition(value?.name),id=typeof value?.id==='string'?value.id:ctx.getSelectedId();
          if(position)ctx.lightTo({id,position,ms:typeof value.ms==='number'&&value.ms>=0?value.ms:0});
          return true;
        }
        case 'lock':if(lock.set(value)){applyLocks();ctx.invalidate();}return true;
        case 'still':still(value);return true;
        case 'sizeOf':sizeOf(value);return true;
        case 'equalFraming':setEqualFraming(value);return true;
        case 'chrome':{
          for(const key of ['lamps','canvasLamp'])if(typeof value?.[key]==='boolean')chrome[key]=value[key];
          applyLocks();ctx.invalidate();return true;
        }
        case 'lessonLens':
          if(cameraSettings.set('lens','lesson-zoom')){
            if(typeof value?.focalLength==='number')cameraSettings.set('focalLength',value.focalLength);
            ctx.syncCamera();
          }
          return true;
        case 'props':{const moved=props.set(value?.on,value?.set),posts=props.posts(value?.posts!==false);if(moved||posts)ctx.invalidate();return true;}
        case 'viewport':return lock.blocksViewport(value);
        case 'focalLength':return focalCommand(value);
        default:return false;
      }
    },
    blocksKey:key=>lock.blocksKey(key),
    hidesLamps:()=>stilling||!chrome.lamps,
    // Called by lighting.js's fitView: the zoomScale that holds the head size, or null.
    fitZoom(fitDistance,focalLength){
      if(!eq.on)return null;
      const {min,max}=bounds(),want=eq.rate*focalLength+eq.depth;
      eq.distance=Math.min(max,Math.max(min,want));eq.clamped=Math.abs(eq.distance-want)>1e-6;
      return eq.distance/fitDistance;
    },
    farExtra:()=>props.farExtra,
    // Called by lighting.js's draw: a window set turns to face the camera.
    faceWindow:()=>props.face(camera),
    // Called by lighting.js's fitView: the aim, on the face, the same at every lens.
    faceAim:eyes=>faceAimPoint(eyes),
    meteringHidden:()=>props.group?[props.group]:[],
    // One frame of the lens glide; true while it runs.
    step(now){
      const s=lensGlide.step(now);
      if(s){ctx.setFocalLength(s.values.f);return true;}
      return false;
    },
    // After a draw: the face's rects for the camera as drawn.
    updateFace(){
      const eyes=ctx.getBust().userData.getEyeLandmarks?.().all??[];
      const lamp=ctx.getSourceStates()[0]?.position;
      camera.updateMatrixWorld();
      const point=new THREE.Vector3();
      face=faceGeometry({eyes:eyes.map(e=>e.world),lampPosition:lamp,
        project:world=>{point.fromArray(world).project(camera);return {x:(point.x+1)/2,y:(1-point.y)/2};}});
      // Each shown lamp's softbox on the canvas (fractions, y down), for a callout on a lamp.
      lampRects={};
      if(!stilling&&chrome.lamps)for(const source of ctx.getSources()){
        if(!source.softbox?.visible)continue;
        source.softbox.updateMatrixWorld(true);
        let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
        for(const x of [-.5,.5])for(const y of [-.5,.5]){
          point.set(x,y,.002).applyMatrix4(source.softbox.matrixWorld).project(camera);
          if(point.z>1)continue;
          const px=(point.x+1)/2,py=(1-point.y)/2;
          l=Math.min(l,px);r=Math.max(r,px);t=Math.min(t,py);b=Math.max(b,py);
        }
        l=Math.max(0,l);t=Math.max(0,t);r=Math.min(1,r);b=Math.min(1,b);
        if(r>l&&b>t)lampRects[source.state.id]={left:l,top:t,width:r-l,height:b-t};
      }
    },
    state(){
      return {lesson:true,lock:lock.snapshot(),chrome:{...chrome},props:props.on,propSet:props.kind,
        equalFraming:{on:eq.on,distance:eq.on?eq.distance:null,clamped:eq.clamped},
        ratio:keyFillRatio(ctx.getSourceStates(),LAMP_TARGET),
        ...(face??{faceRect:null,shadowEdgeAnchor:null}),lampRects:{...lampRects},stills:{...stills}};
    },
    dispose(){props.dispose();for(const url of Object.values(urls))URL.revokeObjectURL(url);},
  };
}
