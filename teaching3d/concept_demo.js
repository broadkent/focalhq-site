// Short concept loops for lesson intros. Pure timing: the scene maps each
// sample onto its existing shutter, sensor and body transforms. One shot,
// ending on its last frame; the host replays it.
import { clamp } from './capture.js';

export const DEMOS = Object.freeze(['shutter','iso']);
export const DEMO_SECONDS = 4.5;
export const DEMO_PAN = .1;  // Radians of body yaw while the slow exposure follows a subject.
export const ISO_STEPS = 6;
const PRESS = .2, TRAVEL = .28;
const ease = p => { p = clamp(p); return p*p*(3-2*p); };

// One shutter cycle pressed at `at`, fully open for `open` seconds. `value` is
// captureState() time; `light` is fully-open seconds collected so far.
function cycle(t, at, open, out) {
  const s = t-at-PRESS, close = TRAVEL+open;
  if (t < at) { out.value = 0; out.light = 0; }
  else if (s < 0) { out.value = .1*(t-at)/PRESS; out.light = 0; }
  else if (s < TRAVEL) { out.value = .1+.2*s/TRAVEL; out.light = s*s/(2*TRAVEL); }
  else if (s < close) { out.value = .3+.35*(s-TRAVEL)/open; out.light = s-TRAVEL/2; }
  else if (s < close+TRAVEL) {
    const u = s-close; out.value = .65+.2*u/TRAVEL; out.light = close-TRAVEL/2+u-u*u/(2*TRAVEL);
  } else { out.value = 1; out.light = close; }
}

// Fills `out` ({value, light, exposure, gain, pan}) without allocating.
export function demoFrame(kind, seconds, out) {
  const t = clamp(seconds/DEMO_SECONDS)*DEMO_SECONDS;
  out.gain = 0; out.pan = 0;
  if (kind === 'iso') {
    // A brief exposure records a dim signal, then gain amplifies it in steps.
    cycle(t, .25, .1, out); out.exposure = out.light*.3/(TRAVEL+.1);
    out.gain = t < 1.5 ? 0 : Math.min(ISO_STEPS, Math.floor((t-1.5)/.5)+1)/ISO_STEPS;
    return out;
  }
  // Same light, two shutter speeds: a brief gap, then a long one.
  const rate = 1/(TRAVEL+1.5);
  if (t < 1.65) { cycle(t, .25, .06, out); out.exposure = out.light*rate; return out; }
  if (t < 1.95) { out.value = 0; out.light = 0; out.exposure = (TRAVEL+.06)*rate*(1-ease((t-1.65)/.3)); return out; }
  cycle(t, 1.95, 1.5, out); out.exposure = out.light*rate;
  out.pan = DEMO_PAN*ease((t-1.95-PRESS)/(2*TRAVEL+1.5));
  return out;
}

// Lesson kinds hold still until the host sends a setting detent.
// Shutter: 1/4000 … 1 s, one exposure per setting. ISO: 100 … 6400 gain.
export const LESSONS = Object.freeze(['shutter-lesson','iso-lesson']);
export const SHUTTER_MAX = 12, ISO_MAX = 6, SHUTTER_DEFAULT = 5;
export const SHUTTER_SPEEDS = Object.freeze(['1/4000','1/2000','1/1000','1/500','1/250','1/125','1/60','1/30','1/15','1/8','1/4','1/2','1 s']);
// Match ShutterClock's nominal times, including traditional rounded labels.
const SHUTTER_SECONDS = Object.freeze([1/4000,1/2000,1/1000,1/500,1/250,1/125,1/60,1/30,1/15,1/8,1/4,1/2,1]);
export const ISO_SPEEDS = Object.freeze([100,200,400,800,1600,3200,6400]);
export const LESSON_ISO_EXPOSURE = .3, GAIN_SECONDS = .3;
// The balance lesson's working curtains are translucent (Kent, October 7), so
// the light building on the sensor stays visible through them.
export const CURTAIN_TRANSLUCENT = .55;
// The shutter lesson's curtains are fully opaque throughout, front view and
// side view (Kent, October 11): the side view's split of the shutter from the
// sensor shows the light landing, so the curtains no longer need to.
export const SHUTTER_CURTAIN_OPACITY = 1;
// SETTLE: the last recording fades from the sensor before the release.
// REVEAL: the closed shutter rests a moment after the second curtain lands.
const SETTLE = .28, REVEAL = .28;
// Before the first curtain moves: no light arrives.
export const SHOT_LEAD = SETTLE+PRESS;
// Real focal-plane travel (typical 1/250 flash sync).
export const REAL_TRAVEL = 1/250;
// Kent, October 7: each curtain crosses the frame at one speed at every
// setting; the setting changes only how long the second curtain waits after
// the first. Below REAL_TRAVEL the gap keeps the real slit width (a sliver at
// 1/4000); from 1/250 the frame is fully open, for longer at each slower stop,
// up to LESSON_OPEN_HOLD playback seconds at 1 s.
export const LESSON_TRAVEL = .5, LESSON_OPEN_HOLD = 2.4;
// True seconds each sensor line sees light.
export const shotOpen = index => SHUTTER_SECONDS[index];
// Playback seconds between the first and the second curtain starting.
export const shotGap = index => {
  const open = shotOpen(index);
  return open<REAL_TRAVEL ? LESSON_TRAVEL*open/REAL_TRAVEL :
    LESSON_TRAVEL+LESSON_OPEN_HOLD*Math.log2(open/REAL_TRAVEL)/Math.log2(1/REAL_TRAVEL);
};
// Playback seconds from the first curtain starting to the second landing.
export const shotCycleSeconds = index => shotGap(index)+LESSON_TRAVEL;
// Renderer-owned clock progress: no exposure while settling or pressing.
export const shotProgress = (index,seconds) => {
  const elapsed = seconds-SHOT_LEAD, cycle = shotCycleSeconds(index);
  // Treat the exact end as 1 despite subtraction rounding at fractional stops.
  return elapsed>=cycle-8*Number.EPSILON ? 1 : clamp(elapsed/cycle);
};
export const shotSeconds = index => SHOT_LEAD+shotCycleSeconds(index)+REVEAL;
// Anchor: 1/4000 displays 1/256, lighting six cells of the 48x32 grid.
// Exact doubling at each detent reaches saturation at 1/15 (index 8).
// Rounded nominal times stay physical; the display corrects their rounding.
export const shotDisplayScale = index => 2**index/256/shotOpen(index);
export const shotExposure = (light,index) => clamp(light*shotDisplayScale(index));
// The whole frame's recorded exposure once the shot is over (1 s of light at
// 1/15 and slower saturates the display).
export const shotFinalExposure = index => shotExposure(shotOpen(index),index);
// Exposure recorded by the sensor row `d` (0 at the top of the frame, 1 at
// the bottom; both curtains travel downwards). `front` and `back` are the
// first and second curtain edges in unclamped travel units: the row builds
// from dark toward the final exposure while it lies in the open gap, and
// every row is uncovered for the same `shotGap`, so the slit paints the
// frame. sensor_exposure_material.js evaluates the same expression per row,
// with `shotSweepScale` as its sweep scale.
export const shotSweepScale = index => shotFinalExposure(index)*LESSON_TRAVEL/shotGap(index);
export const sensorRowExposure = (index,front,back,d) =>
  clamp((Math.max(front-d,0)-Math.max(back-d,0))*shotSweepScale(index));
// Mean of the rows' share of their final light, for edges `front`, `back`.
const swept = x => x<=0 ? 0 : x<1 ? x*x/2 : x-.5;
const meanShare = (front,back,gap) => clamp((swept(front)-swept(back))*LESSON_TRAVEL/gap);
// Light arriving, not light recorded: row `d` glows while it lies inside the
// open gap, softened over GLOW_EDGE of the frame height at both curtain edges.
// The shader draws it over the recording; it never adds to the exposure.
export const GLOW_EDGE = .02;
export const sensorRowGlow = (front,back,d) => ease((front-d)/GLOW_EDGE)*ease((d-back)/GLOW_EDGE);
// A narrow slit glows brightly. Once the gap is at least a full crossing the
// whole sensor is uncovered, so the white light is a lighter wash, GLOW_OPEN_MAX,
// that still reads as white light (Kent, October 8) while the yellow it leaves
// behind stays readable underneath.
export const GLOW_SLIT = .8, GLOW_OPEN_MAX = .4;
export const glowStrength = gap =>
  gap<LESSON_TRAVEL ? GLOW_SLIT : GLOW_OPEN_MAX;

// One exposure at detent `index`, `t` seconds after the release is pressed.
// Fills `out` ({value, first, second, front, back, light, exposure, opacity,
// glow, share}) without allocating. Each curtain crosses in LESSON_TRAVEL and
// the second starts `shotGap` after the first, so every row sees light for
// the same time; below a full crossing both cross together as a moving slit.
// `light` is the mean real light over the sensor (seconds), `exposure` the
// mean displayed exposure and `share` the mean fraction of the final.
// `glow` is the slit glow while light arrives: zero before the first curtain
// moves and once the second lands. The curtains stay opaque throughout.
export function shotFrame(index, t, out) {
  const gap = shotGap(index), s = t-SHOT_LEAD, closed = gap+LESSON_TRAVEL;
  out.value = s<0 ? .1*clamp((t-SETTLE)/PRESS) : .1+.9*clamp(s/closed);
  out.first = clamp(s/LESSON_TRAVEL); out.second = clamp((s-gap)/LESSON_TRAVEL);
  out.front = s/LESSON_TRAVEL; out.back = (s-gap)/LESSON_TRAVEL;
  out.opacity = SHUTTER_CURTAIN_OPACITY;
  out.share = s>=closed ? 1 : meanShare(out.front,out.back,gap);
  out.light = shotOpen(index)*out.share; out.exposure = shotFinalExposure(index)*out.share;
  out.glow = s>0&&s<closed ? glowStrength(gap) : 0;
  return out;
}
