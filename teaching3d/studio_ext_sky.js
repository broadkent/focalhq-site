// Studio sky extension (register #15): a sun on a time-of-day ruler, a sky dome, a cloud slider and
// a blocking wall.
//
//   extSky {on, hour?, cloud?, dome?, wall?, wallAngle?, lamp?}
//     on         false puts the sun lamp back as it was and takes every sky object away
//     hour       6 to 18: the sun's place on its arc (studio_ext_math.sunAngles), its brightness and warmth
//     cloud      0 clear to 1 overcast: a hard small sun to a soft wide one, and more sky fill
//     dome       the sky dome behind everything, a gray gradient for the hour and the cloud (off by default: its
//                hard edge at the canvas's rim reads as a slab, not as sky)
//     wall       a blocking wall, 1.4 x 1.8 m, [wallAngle] degrees round the bust (0 in front, 90 on the
//                viewer's right; -70 by default: beside the bust, outside the camera's view, see
//                studio_ext_math.wallPlacement) 0.85 m out, shading the bust from a low sun
//     lamp       the sun lamp's id (light-1)
// The sun is the lamp: it can only stand 2 m out, so a low sun is a lamp near the horizon at 1.8 m. The
// sky's fill is a hemisphere light that lights the bust, so a cloud changes its shadow side.
// Objects outside the lamps' cone are self-lit tones (the lesson props' convention). State: ext.sky.
import {clamp,domeTones,finite,FACE_Y_WORLD,GROUND_Y_WORLD,skyFill,sunAngles,sunBrightness,sunOffset,sunWarmth,sunWidthM,toWorld,WALL,wallPlacement,warmthRgb} from './studio_ext_math.js';
import {colorLamp,flat,lampState,makeGroup,patchLamp} from './studio_ext_util.js';

// The hemisphere light's intensity per unit of skyFill (calibrated against the key lamp's reference
// illuminance of 3 at 50 percent, 18 at 100: read off the Studio's meter: an overcast noon sits about two stops under a clear one, and a clear
// noon's fill still opens the eye sockets).
export const SKY_FILL_GAIN=12;

export function createExtSky(ctx){
  const {THREE}=ctx;
  const mk=makeGroup(THREE,ctx.scene,'studioExtSky');
  const st={on:false,hour:12,cloud:0,dome:false,wall:false,wallAngle:WALL.angle,lamp:'light-1'};
  let held=null,hemi=null,dome=null;

  function lampPlace(){
    const [x,y,z]=sunOffset(st.hour);
    return [toWorld(x),FACE_Y_WORLD+toWorld(y),toWorld(z)];
  }
  function paintDome(){
    if(!dome)return;
    const {top,horizon}=domeTones(st.hour,st.cloud);
    const position=dome.geometry.attributes.position,colors=dome.geometry.attributes.color;
    const radius=dome.geometry.parameters.radius,color=new THREE.Color();
    for(let i=0;i<position.count;i++){
      const t=clamp(position.getY(i)/radius,0,1),tone=horizon+(top-horizon)*t;
      color.setRGB(tone,tone,tone,THREE.SRGBColorSpace);
      colors.setXYZ(i,color.r,color.g,color.b);
    }
    colors.needsUpdate=true;
  }
  function build(){
    mk.clear();dome=null;
    if(!st.on)return;
    if(st.dome){
      const geometry=new THREE.SphereGeometry(toWorld(6),32,18);
      geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count*3),3));
      dome=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,depthWrite:false}));
      dome.renderOrder=-10;dome.frustumCulled=false;mk.group.add(dome);paintDome();
    }
    if(st.wall){
      const place=wallPlacement(st.wallAngle);
      const wall=new THREE.Mesh(new THREE.BoxGeometry(toWorld(place.width),toWorld(place.height),toWorld(.12)),flat(THREE,.4));
      wall.position.set(toWorld(place.x),GROUND_Y_WORLD+toWorld(place.height/2),toWorld(place.z));
      wall.lookAt(0,wall.position.y,0);
      wall.castShadow=true;mk.group.add(wall);
    }
    hemi=new THREE.HemisphereLight(0xffffff,0xffffff,0);mk.group.add(hemi);
  }
  function applySun(){
    if(!st.on)return;
    if(!held){const s=lampState(ctx,st.lamp);if(s)held={width:s.width,brightnessPercent:s.brightnessPercent,enabled:s.enabled,position:[...s.position]};}
    patchLamp(ctx,st.lamp,{position:lampPlace(),width:toWorld(sunWidthM(st.cloud)),brightnessPercent:sunBrightness(st.hour,st.cloud),enabled:true});
    colorLamp(ctx,st.lamp,warmthRgb(sunWarmth(sunAngles(st.hour).elevation)));
    if(hemi){
      hemi.intensity=skyFill(st.hour,st.cloud)*SKY_FILL_GAIN;
      const cool=warmthRgb(.25);
      hemi.color.setRGB(cool[0],cool[1],cool[2]);
      // The ground bounces a little of the sky back up.
      // An overcast sky is brighter above than below: the gradient gives the face its soft form.
      const ground=.55-.5*st.cloud;
      hemi.groundColor.setRGB(ground,ground,ground);
    }
    paintDome();ctx.markShadows();ctx.invalidate();
  }
  function clear(){
    if(held){patchLamp(ctx,st.lamp,held);colorLamp(ctx,st.lamp,[1,1,1]);held=null;}
    mk.clear();dome=null;hemi=null;
  }

  return {
    command(value){
      if(!value||typeof value!=='object')return;
      const was={on:st.on,dome:st.dome,wall:st.wall,wallAngle:st.wallAngle};
      if(typeof value.lamp==='string')st.lamp=value.lamp;
      for(const key of ['on','dome','wall'])if(typeof value[key]==='boolean')st[key]=value[key];
      if(finite(value.hour))st.hour=clamp(value.hour,6,18);
      if(finite(value.cloud))st.cloud=clamp(value.cloud,0,1);
      if(finite(value.wallAngle))st.wallAngle=clamp(value.wallAngle,-90,90);
      if(!st.on){clear();ctx.markShadows();ctx.invalidate();return;}
      const rebuild=!was.on||was.dome!==st.dome||was.wall!==st.wall||was.wallAngle!==st.wallAngle;
      if(rebuild){mk.clear();dome=null;hemi=null;build();}
      applySun();
    },
    /** The sky's light changes what the meter reads: hour, cloud and the wall. */
    meterKey:()=>st.on?[st.hour,st.cloud,st.wall,st.wallAngle].join():'',
    /** Scenery the exposure meter never reads: the dome, the ground and the wall. */
    meteringHidden:()=>st.on?[mk.group]:[],
    /** The lamp lost its colour (the sources were rebuilt): put the sun's back. */
    frame(){
      if(!st.on)return;
      // The scene's own lamp commands (the first show) can land after the sky's first message: when the sun
      // is not where it should be, put it back, so the first frame is the right one.
      const now=lampState(ctx,st.lamp),place=lampPlace();
      if(now&&(Math.abs(now.brightnessPercent-sunBrightness(st.hour,st.cloud))>.01||now.position.some((v,i)=>Math.abs(v-place[i])>.01))){applySun();return;}
      const source=ctx.getSources().find(s=>s.state.id===st.lamp);
      const light=source?.area.samples[0]?.light;
      const want=warmthRgb(sunWarmth(sunAngles(st.hour).elevation));
      if(light&&Math.abs(light.color.r-want[0])+Math.abs(light.color.g-want[1])+Math.abs(light.color.b-want[2])>.01)colorLamp(ctx,st.lamp,want);
    },
    state(){
      const sun=sunAngles(st.hour);
      return {on:st.on,hour:st.hour,cloud:st.cloud,dome:st.dome,wall:st.wall,wallAngle:st.wallAngle,
        elevation:sun.elevation,azimuth:sun.azimuth,sunPercent:sunBrightness(st.hour,st.cloud)};
    },
    dispose(){clear();mk.dispose();},
  };
}
