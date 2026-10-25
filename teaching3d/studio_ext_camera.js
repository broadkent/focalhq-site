// Studio map extension (register #12): the top map's marker moves the camera or the bust, not the lamp.
//
//   extCamera {x?, z?, height?}   the camera at a map place, meters from the bust (x right, z toward the
//                                 default camera), its lens [height] meters above the bust's base line; it
//                                 keeps looking at the face
//   extCamera {bust:{x?, z?}}     the bust at a map place, meters; the lamps and the camera stay put
//   extCamera {reset:true}        the camera back to the lesson's own pose, the bust to the centre
//
// The pose goes through ctx.applyPose (azimuth, elevation) and the distance through fitZoom (lesson_studio.js
// asks the extension first), so the lesson fit keeps the face in frame at the new distance. State: ext.camera.
import {cameraFromMap,clamp,finite,FACE_Y_M,mapFromCamera,toWorld} from './studio_ext_math.js';

export function createExtCamera(ctx){
  const {controls}=ctx;
  const cam={active:false,x:0,z:1.2,height:FACE_Y_M};
  const bustAt={x:0,z:0};
  let distanceWorld=null;

  function aimCamera(){
    const pose=cameraFromMap(cam);
    // The orbit never goes below its polar limit; applyPose clamps the elevation to it.
    distanceWorld=toWorld(Math.max(pose.distance,.25));
    ctx.applyPose({azimuth:pose.azimuth,elevation:pose.elevation,zoom:ctx.currentPose().zoom});
    ctx.invalidate(true);
  }
  function placeBust(){
    const bust=ctx.getBust();
    if(!bust)return;
    bust.position.x=toWorld(bustAt.x);bust.position.z=toWorld(bustAt.z);
    bust.updateMatrixWorld(true);
    ctx.markShadows();ctx.invalidate(true);
  }

  return {
    command(value){
      if(value?.reset===true){
        cam.active=false;distanceWorld=null;bustAt.x=0;bustAt.z=0;placeBust();ctx.invalidate(true);return;
      }
      if(value?.bust&&typeof value.bust==='object'){
        if(finite(value.bust.x))bustAt.x=clamp(value.bust.x,-2,2);
        if(finite(value.bust.z))bustAt.z=clamp(value.bust.z,-2,2);
        placeBust();
      }
      let moved=false;
      for(const key of ['x','z','height'])if(finite(value?.[key])){cam[key]=value[key];moved=true;}
      cam.x=clamp(cam.x,-3,3);cam.z=clamp(cam.z,-3,3);cam.height=clamp(cam.height,.05,1.6);
      if(moved){cam.active=true;aimCamera();}
    },
    /** lesson_studio.js fitZoom: the zoom scale that puts the camera at the map's distance, or null. */
    fitZoom(fitDistance){
      if(!cam.active||distanceWorld==null)return null;
      const want=clamp(distanceWorld,controls.minDistance||0,controls.maxDistance||Infinity);
      return want/fitDistance;
    },
    state(){
      const pose=cameraFromMap(cam);
      return {active:cam.active,x:cam.x,z:cam.z,height:cam.height,azimuth:pose.azimuth,elevation:pose.elevation,
        distance:pose.distance,bust:{...bustAt},back:mapFromCamera(pose)};
    },
    dispose(){const bust=ctx.getBust?.();if(bust){bust.position.x=0;bust.position.z=0;}},
  };
}
