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
//   stage {on, radius?, feather?}      the depth stage (studio_stage.js): on the dark paper ink ground,
//                                      prop falloff and a feathered window of corner [radius] CSS px and
//                                      [feather] (share of the short side); on the light one paper ground
//                                      and prop fog; {on:false} (the default) draws as before
//   props {on, set?}                    the lesson set behind the bust: set 'window' (default: a
//                                      wall close behind with a window and a plant) or 'prints'
//                                      (lesson 9's sagging wires of curled photo prints); lesson_props.js
// Published state (lesson only): lesson, lock, chrome, stage, props, equalFraming, ratio, faceRect,
// noseRect, cheekRect, shadowEdgeAnchor, shadowSide, lampRects ({id: rect}, shown lamps only), stills.
import {createLessonLock} from './lesson_lock.js';
import {presetPosition,LAMP_TARGET} from './lesson_presets.js';
import {clampLampWidth} from './lamp_rig.js';
import {keyFillRatio,equalFramingRate,trueEqualFramingRate} from './lesson_math.js';
import {faceGeometry} from './lesson_face.js';
import {createLessonProps} from './lesson_props.js';
import {STAGE_OFF,parseStage,stageLook,createStagePropTwins} from './studio_stage.js';
// The lab's Studio extensions (studio_ext.js): map camera, panel, sky, turn, flash, tint, set pieces.
import {createStudioExt} from './studio_ext.js';

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
  // The depth stage (off by default): ink and falloff on the dark paper, fog on the light (stageLook).
  let stage=STAGE_OFF;
  const props=createLessonProps({THREE,scene:ctx.scene,lesson:true,isDark:()=>ctx.isDark?.()===true,invalidate:()=>ctx.invalidate?.()});
  // Lit props draw flat twins on the stage, so the key's falloff reaches them (studio_stage.js).
  const twins=createStagePropTwins(THREE);
  const ext=createStudioExt(ctx);
  // True when the stage changed.
  function setStage(value){
    const next=parseStage(value);
    if(!next||JSON.stringify(next)===JSON.stringify(stage))return false;
    stage=next;
    return true;
  }
  // A still never shows the lamp, even on a page whose live view does.
  let stilling=false;
  const stills={},urls={};
  let face=null,lampRects={};
  const lensGlide=ctx.glides.channel('lens');
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const lightIds=()=>ctx.getSourceStates().map(state=>state.id);
  // A canvas point (fractions, y down) in the working frame's fractions: the host lays its callouts on the
  // frame, and the full-bleed canvas reaches past it (studio_overscan.js).
  const frameOf=p=>ctx.toFrame?.(p)??p;

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
    const width=clampLampWidth(v);
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
    // True scale (Kent, October 22, 2026): without a host distance the rate is the real full-frame solution,
    // the distance at which the head fills EQUAL_FRAMING_HEAD_FRACTION of the 24 mm frame at each lens, not
    // whatever distance the camera happened to be at (that drifted with the lens the lesson started on).
    eq.rate=given?equalFramingRate(Math.max(1e-3,value.distance-eq.depth),focal):trueEqualFramingRate();
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
    pose:ctx.currentPose(),focalLength:ctx.getFocalLength(),props:props.on,propSet:props.kind,stage});
  function applyState(state){
    for(const light of state.lights??[]){
      if(!lightIds().includes(light?.id))continue;
      const patch={};
      if(Array.isArray(light.position)&&light.position.length===3&&light.position.every(Number.isFinite))patch.position=[...light.position];
      if(Number.isFinite(light.width)){patch.width=clampLampWidth(light.width);patch.height=patch.width*1.25;}
      if(Number.isFinite(light.brightnessPercent)){patch.brightnessPercent=THREE.MathUtils.clamp(light.brightnessPercent,0,100);patch.powerStops=patch.brightnessPercent>0?Math.log2(patch.brightnessPercent/50):null;}
      if(typeof light.enabled==='boolean')patch.enabled=light.enabled;
      session.updateLight(light.id,patch);
    }
    ctx.refreshSessionState();
    for(const source of ctx.getSources())ctx.syncSource(source);
    ctx.markShadows();
    if(state.pose)ctx.applyPose({...ctx.currentPose(),...state.pose});
    if(Number.isFinite(state.focalLength))ctx.setFocalLength(state.focalLength);
    // A still takes the stage it was given (a Match reference renders with the live view's look).
    if(state.stage)setStage(state.stage);
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
    const given=Number.isFinite(value.width)&&Number.isFinite(value.height)&&value.width>=16&&value.height>=16;
    // A still is the working frame alone: without a size, the live frame's (never the full-bleed canvas round it).
    const frame=ctx.liveFrame?.(),size=given?[value.width,value.height]:frame?[frame.width,frame.height]:null;
    const sized=size!=null&&(given||frame.width!==canvas.clientWidth||frame.height!==canvas.clientHeight);
    if(sized)ctx.stillSize(Math.round(size[0]),Math.round(size[1]));
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
        case 'stage':if(setStage(value)){ctx.invalidate();ctx.publishState();}return true;
        case 'props':{if(props.set(value?.on,value?.set))ctx.invalidate();return true;}
        case 'viewport':return lock.blocksViewport(value);
        case 'focalLength':return focalCommand(value);
        default:return ext.command(action,value);
      }
    },
    blocksKey:key=>lock.blocksKey(key),
    hidesLamps:()=>stilling||!chrome.lamps,
    // Called by lighting.js's fitView: the zoomScale that holds the head size, or null.
    fitZoom(fitDistance,focalLength){
      const extZoom=ext.fitZoom(fitDistance);
      if(extZoom!=null)return extZoom;
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
    meteringHidden:()=>[...(props.group?[props.group]:[]),...ext.meteringHidden()],
    meterKey:()=>ext.meterKey(),
    // Called by lighting.js's draw: the optics pass's stage (studio_stage.js).
    stage:()=>{ext.frame();const look=stageLook(stage,ctx.isDark?.()===true);twins.sync(props.on?props.group:null,look.ink||look.fog,{ink:look.ink});return look;},
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
        project:world=>{point.fromArray(world).project(camera);return frameOf({x:(point.x+1)/2,y:(1-point.y)/2});}});
      // Each shown lamp's softbox in the working frame (fractions, y down), for a callout on a lamp.
      lampRects={};
      if(!stilling&&chrome.lamps)for(const source of ctx.getSources()){
        if(!source.softbox?.visible)continue;
        source.softbox.updateMatrixWorld(true);
        let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
        for(const x of [-.5,.5])for(const y of [-.5,.5]){
          point.set(x,y,.002).applyMatrix4(source.softbox.matrixWorld).project(camera);
          if(point.z>1)continue;
          const {x:px,y:py}=frameOf({x:(point.x+1)/2,y:(1-point.y)/2});
          l=Math.min(l,px);r=Math.max(r,px);t=Math.min(t,py);b=Math.max(b,py);
        }
        l=Math.max(0,l);t=Math.max(0,t);r=Math.min(1,r);b=Math.min(1,b);
        if(r>l&&b>t)lampRects[source.state.id]={left:l,top:t,width:r-l,height:b-t};
      }
    },
    state(){
      return {lesson:true,lock:lock.snapshot(),chrome:{...chrome},stage:{...stage},props:props.on,propSet:props.kind,
        equalFraming:{on:eq.on,distance:eq.on?eq.distance:null,clamped:eq.clamped},
        ratio:keyFillRatio(ctx.getSourceStates(),LAMP_TARGET),
        ...(face??{faceRect:null,shadowEdgeAnchor:null}),lampRects:{...lampRects},stills:{...stills},ext:ext.state()};
    },
    dispose(){ext.dispose();twins.dispose();props.dispose();for(const url of Object.values(urls))URL.revokeObjectURL(url);},
  };
}
