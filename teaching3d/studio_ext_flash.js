// Studio flash extension (register #37): a flash lamp with on and off, a power ruler, a burst, an ambient
// level and (on the host side) the light meter.
//
//   extFlash {lamp?, on?, stops?, ambient?, fire?}
//     lamp     the flash lamp's id (light-1)
//     on       the flash contributes to the picture (the lamp is lit); off, only the ambient light does
//     stops    0 to 5 stops down from full power: the lamp's brightness 100, 50, 25, ... percent
//     ambient  0 to 1: the room light, a hemisphere light (an ambient light prints the bust as a flat cutout; 0 is a dark room, 1 is as bright as a half-power lamp)
//     fire     {count?}: a burst of 1 to 8 flashes; between them the lamp goes dark, then it is as set
//   extFlash {reset:true}  the lamp as it was, no ambient light
//
// The light meter is the Studio's own (`meter` in the published state); `meterKey()` tells lighting.js to
// read it again when the ambient level or a pulse changes what the camera sees. State: ext.flash.
import {burstPulses,clamp,finite,flashPercent} from './studio_ext_math.js';
import {lampState,patchLamp} from './studio_ext_util.js';

/** An ambient level of 1 as the ambient light's intensity: the illuminance a half-power lamp gives the face. */
export const AMBIENT_GAIN=3;

export function createExtFlash(ctx){
  const {THREE}=ctx;
  const st={lamp:'light-1',on:true,stops:2,ambient:0,bursting:false,fired:0};
  let held=null,ambient=null,timers=[];

  const percent=()=>flashPercent(st.stops);
  function showLamp(lit){
    patchLamp(ctx,st.lamp,{enabled:lit&&st.on,brightnessPercent:percent()});
  }
  function hold(){
    if(held)return;
    const s=lampState(ctx,st.lamp);
    if(s)held={width:s.width,brightnessPercent:s.brightnessPercent,enabled:s.enabled,position:[...s.position]};
  }
  function stopBurst(){for(const t of timers)clearTimeout(t);timers=[];st.bursting=false;}
  function fire(count){
    stopBurst();
    const pulses=burstPulses(count),end=pulses.at(-1)[1]+160;
    st.bursting=true;
    pulses.forEach(([on,off],i)=>{
      timers.push(setTimeout(()=>{st.fired++;showLamp(true);},on));
      // The last pulse stays lit when the flash is on; the others go dark between.
      if(i<pulses.length-1)timers.push(setTimeout(()=>showLamp(false),off));
    });
    timers.push(setTimeout(()=>{st.bursting=false;showLamp(true);},end));
    showLamp(false);
  }

  return {
    command(value){
      if(!value||typeof value!=='object')return;
      if(value.reset===true){
        stopBurst();
        if(held){patchLamp(ctx,st.lamp,held);held=null;}
        if(ambient){ctx.scene.remove(ambient);ambient=null;}
        st.ambient=0;ctx.invalidate();ctx.publishState();return;
      }
      if(typeof value.lamp==='string')st.lamp=value.lamp;
      hold();
      if(typeof value.on==='boolean')st.on=value.on;
      if(finite(value.stops))st.stops=clamp(Math.round(value.stops),0,5);
      if(finite(value.ambient))st.ambient=clamp(value.ambient,0,1);
      if(st.ambient>0&&!ambient){ambient=new THREE.HemisphereLight(0xffffff,0x9a9a9a,0);ambient.name='studioExtAmbient';ctx.scene.add(ambient);}
      if(ambient)ambient.intensity=st.ambient*AMBIENT_GAIN;
      if(!st.bursting)showLamp(true);
      if(value.fire&&typeof value.fire==='object')fire(finite(value.fire.count)?value.fire.count:1);
      ctx.invalidate();ctx.publishState();
    },
    /** Folded into lighting.js's meter key: what the camera sees changes with these. */
    meterKey:()=>[st.ambient,st.on,st.stops,st.bursting].join(),
    state:()=>({lamp:st.lamp,on:st.on,stops:st.stops,percent:percent(),ambient:st.ambient,bursting:st.bursting,fired:st.fired}),
    dispose(){
      stopBurst();
      if(held)patchLamp(ctx,st.lamp,held);
      if(ambient){ctx.scene.remove(ambient);ambient=null;}
    },
  };
}
