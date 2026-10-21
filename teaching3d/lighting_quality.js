// The lab draws a cheaper picture while the camera moves (Kent, session 5, cards
// 836-838: the reframe when the sheet comes up "is just a little choppy"). Moving
// means a camera change in the last MOVE_SETTLE_MS: the sheet's reframe, a pinch
// dolly, an orbit. While a finger is down on the view (an orbit, pan or pinch,
// held) the camera is moving even when the finger rests: no shake pass until it
// lifts (Kent, October 14, 2026), then one full frame.
//
// The moving picture has two looks, chosen by MOVING_LOOK:
//
// 'halftone' (the default; Kent, October 15, 2026: "the cel shading to halftone is
// just a bit too jarring"): the rested print's own pipeline, drawn small. No defocus
// and no grain and the outline hull hidden (the exposure meter keeps reading, below); the canvas
// draws at MOVING_SCALE of the device's pixel ratio, with the dot pitch chosen so
// the dots keep their size in CSS pixels (movingScreen), so the lift is a sharpening
// (the source and the canvas return to full resolution, defocus and grain come back)
// and not a change of family.
//
// 'cel' (the #691 look, kept selectable): the 3D source draws at CHEAP_PIXEL_SCALE of
// its resolution; the optics pass draws at MOVING_PIXEL_RATIO (one pixel per CSS
// pixel) into a small target that is upscaled to the canvas, tone mapping only (see
// the cel tone in lighting_shading.js: banded flat ink, soft one-pixel edges).
//
// Either way one full frame draws once the camera has been still for a frame or the
// finger lifts.
import {halftonePitch,HALFTONE_MIN_PITCH_PX} from './lighting_shading.js';

export const MOVE_SETTLE_MS=40; // domain: a camera still this long (a little over two 60 Hz frames) has settled
export const LIFT_SETTLE_MS=750; // domain: the coarse render stays this long after the last touch lifts before the full render lifts in (Kent, October 16, 2026: so a learner still adjusting is not interrupted)
export const CHEAP_PIXEL_SCALE=.5; // domain: share of the device-pixel resolution the 3D source draws at while the camera moves
export const MOVING_LOOK='halftone'; // domain: the moving picture, 'halftone' (the rested pipeline, small) or 'cel' (#691's flat ink bands)
export const MOVING_SCALE=.7; // domain: share of the device pixel ratio the halftone canvas draws at while moving; .5 is the cheaper fallback
// Kent, October 15, 2026: the meter froze while the camera orbited; it reads live. One read is a 48 x 48 scene
// render plus an asynchronous readback (never waits on the GPU), measured at 412x915, DPR 2.625, 4x CPU throttle,
// ~0.7-1.0 ms on the draw path (lastMeterMs); moving frames stay at median 1.6-2.2 ms, p95 under 4.5 ms with a read
// on every frame, so no throttle is needed here. Raise it (ms) if a slower phone drops frames.
export const MOVING_METER_MS=0; // domain: least time between exposure-meter reads while the camera moves (0 = every frame)
export function meterIsDue(now,last,interval=MOVING_METER_MS){return now-last>=interval;}
export const MOVING_PIXEL_RATIO=1; // domain: device pixels per CSS pixel the moving (cel) frame draws at before it is upscaled
export const MOVING_DEFOCUS_TAPS=0; // domain: defocus taps while moving (none: the moving frame is drawn sharp)
// The lift is a crossfade, not a snap (Kent, October 15, 2026: the change from the moving
// frame to the full print "must be smooth"): the full frame draws once, then the last
// moving frame fades into it over LIFT_CROSSFADE_MS, one composite per frame. Set
// LIFT_CROSSFADE_ENABLED false to compare with the snap.
export const LIFT_CROSSFADE_MS=1000; // domain: one second, longer than any AnimationTokens step (Kent, October 16, 2026: the split is so smooth, lower it to 1 s)
export const LIFT_WAVE_CELLS=0; // domain: width of a dissolve's wave front in moving dot cells; 0 = no front, every cell splits at the same time (Kent, October 16: not a wipe)
// AnimationTokens.standard (Curves.easeInOut, cubic-bezier .42 0 .58 1) applied to the dissolve's linear progress.
export function liftEase(t){
  if(t<=0)return 0;if(t>=1)return 1;
  const x1=.42,y1=0,x2=.58,y2=1,bez=(a,b,s)=>3*a*s*(1-s)*(1-s)+3*b*s*s*(1-s)+s*s*s;
  let lo=0,hi=1;for(let i=0;i<24;i++){const m=(lo+hi)/2;if(bez(x1,x2,m)<t)lo=m;else hi=m;}
  return bez(y1,y2,(lo+hi)/2);
}
export const LIFT_CROSSFADE_ENABLED=true; // domain: false = snap to the full frame on lift (comparison)

// The moving halftone canvas for a device pixel ratio of [screenRatio]: its pixel
// ratio and its dot pitch in canvas pixels. The pitch is a whole share of the full
// pitch (halftonePitch), and the ratio the same share of [screenRatio], so a dot is
// the same size in CSS pixels as at rest and the two lattices line up through the lift
// crossfade (no moire between the two frames).
export const WHOLE_MIN_PITCH_PX=3; // domain: a whole-step canvas draws its dots no smaller than this many canvas px (2 aliases into a grey checker with a beat)
export function movingScreen(screenRatio,scale=MOVING_SCALE,whole=0){
  const full=halftonePitch(screenRatio);
  // A whole step (the third- and quarter-res drag renders, drawn with hard pixels): the canvas is exactly 1/whole of the device ratio, so the upscale is a whole number of device pixels, and the dot cell a whole number of canvas pixels (the nearest to the full pitch / whole). A fractional step beats the dot lattice against the upscaled pixel grid (moire).
  if(whole>=2)return {ratio:screenRatio/whole,pitch:Math.min(full,Math.max(WHOLE_MIN_PITCH_PX,Math.round(full/whole)))};
  const pitch=Math.min(full,Math.max(HALFTONE_MIN_PITCH_PX,Math.round(scale*full)));
  return {ratio:screenRatio*pitch/full,pitch};
}

export function createMoveClock({settleMs=MOVE_SETTLE_MS,liftSettleMs=LIFT_SETTLE_MS}={}){
  let until=-Infinity,held=false;
  return {
    // A camera change happened at [now] (ms). A learner's own input (a zoom tap, a key) passes LIFT_SETTLE_MS as [delay]; it never shortens a longer wait already pending.
    touch(now,delay=settleMs){until=Math.max(until,now+delay);},
    // Whether the camera is still moving at [now].
    moving(now){return held||now<until;},
    // Milliseconds until the camera counts as settled, 0 when it already does.
    untilSettled(now){return held?Infinity:Math.max(0,until-now);},
    // A finger went down on (true) or lifted off (false) the view. Down cancels any pending lift; lifting starts the wait afresh.
    hold(down,now){held=down===true;if(!held)until=now+liftSettleMs;},
    get held(){return held;},
  };
}

// What a draw does for a camera that is [moving] or settled. [look] is the moving look.
export function renderQuality(moving,look=MOVING_LOOK){
  if(!moving)return {moving:false,look:null,cheap:false,cel:false,pixelScale:1,outputPixelRatio:null,defocusTaps:13,defocus:true,shake:true,grain:true,halftone:true,outline:true,meter:true};
  if(look==='cel')return {moving:true,look:'cel',cheap:true,cel:true,pixelScale:CHEAP_PIXEL_SCALE,outputPixelRatio:MOVING_PIXEL_RATIO,defocusTaps:MOVING_DEFOCUS_TAPS,defocus:false,shake:false,grain:false,halftone:false,outline:false,meter:true};
  return {moving:true,look:'halftone',cheap:true,cel:false,pixelScale:CHEAP_PIXEL_SCALE,outputPixelRatio:null,defocusTaps:MOVING_DEFOCUS_TAPS,defocus:false,shake:false,grain:false,halftone:true,outline:false,meter:true};
}

// The lift crossfade's mix t (0 = the newest moving frame, 1 = the full frame). start()
// once the full frame is captured runs t up to 1 from wherever it is; back() (a
// gesture began mid-fade) runs it down to 0 at the same rate so the moving frames
// return without a pop; stop() (a full frame drew over it) ends it at once. step(t)
// draws the blend on each animation frame; done(t) when a run ends.
export function createLiftFade({durationMs=LIFT_CROSSFADE_MS,enabled=LIFT_CROSSFADE_ENABLED,step,done=()=>{},now=()=>performance.now(),
  frame=cb=>requestAnimationFrame(cb),cancelFrame=id=>cancelAnimationFrame(id)}={}){
  let id=0,t=0,goal=0,at=0;
  const tick=()=>{
    const time=now(),delta=(time-at)/durationMs;at=time;
    t=goal>t?Math.min(goal,t+delta):Math.max(goal,t-delta);
    step(t);
    if(t===goal){id=0;done(t);t=0;}else id=frame(tick);
  };
  const run=to=>{goal=to;at=now();if(!id)id=frame(tick);};
  // start() draws the blend at once: the full frame just drawn must not show for a frame.
  return {
    get enabled(){return enabled&&durationMs>0;},
    get running(){return id!==0;},
    get value(){return t;},
    start(){if(!(enabled&&durationMs>0))return false;run(1);step(t);return true;},
    back(){if(!id)return false;run(0);return true;},
    stop(){if(id)cancelFrame(id);id=0;t=0;goal=0;},
  };
}
