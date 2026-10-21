// Lesson 5 "Balance", page sensorBalance (docs/plan/lessons/combine-lessons-plan.md
// L5.4, chunk C6): the camera in x-ray with the lens iris in front and the
// sensor behind it. More light for less time leaves the same exposure: white
// light arrives on the sensor brighter through a bigger opening, and the
// yellow it leaves behind builds as intensity x time, so the linked settings
// (shutter s = 10 - a) all end at one yellow level while the white glow gets
// brighter and shorter. Pure numbers only; scene.js draws them with the
// shutter lesson's own curtains, sweep and sensor colours.
import { clamp } from './capture.js';
import { LESSON_TRAVEL, SHOT_LEAD, CURTAIN_TRANSLUCENT, shotFrame, shotGap, shotSeconds, shotProgress }
  from './concept_demo.js';

export const BALANCE_DEMO = 'balance-lesson';
// Lesson indices, as the Dart rulers count them. Aperture a: 0 = f/2.8 (wide
// open) ... 3 = f/8 ... 6 = f/22. Shutter s: 0 = 1 s ... 7 = 1/125 ... 12 =
// 1/4000 (slowest first, shutter_speeds.dart).
export const BALANCE_APERTURE_MAX = 6, BALANCE_SHUTTER_MAX = 12;
// The lesson's linked pair: f/8 at 1/125 is the anchor; every stop the iris
// opens, the shutter is a stop faster.
export const BALANCE_LINK = 10;
export const balanceLinkedShutter = a => BALANCE_LINK-a;
// The Watch's three shots, each on a cleared sensor (plan L5.4).
export const BALANCE_WATCH_SHOTS = Object.freeze([[3,7],[1,9],[0,10]].map(Object.freeze));
// The renderer's shutter detents run fastest first (concept_demo.js
// SHUTTER_SPEEDS): ruler index s is detent 12 - s.
export const balanceShutterDetent = s => BALANCE_SHUTTER_MAX-s;
// The iris's open area relative to f/2.8: each stop halves it (lens_assembly.js
// apertureRadiusForValue shrinks the radius by sqrt(2) a stop). This is the
// light's intensity on the sensor.
export const balanceIntensity = a => 2**-a;
// Exact whole-stop time (1 s, 1/2 ... 1/1024): the nominal labels round
// (1/125, 1/1000), the light they collect doubles exactly per stop.
export const balanceTime = s => 2**-s;
// Displayed signal of a balanced shot (the sensor material's level, no lift):
// a full, rich yellow, short of the near-white of a long exposure.
export const BALANCE_LEVEL = .6;
const BALANCE_GAIN = BALANCE_LEVEL/(balanceIntensity(3)*balanceTime(7));
// Exposure = intensity x time, on the one fixed scale that puts the anchor
// (and every linked pair) at BALANCE_LEVEL.
export const balanceExposure = (a,s) => clamp(BALANCE_GAIN*balanceIntensity(a)*balanceTime(s));
// The white light's strength on the sensor while it arrives: its brightness
// follows the opening, one even step per stop (the square root of the area,
// so f/22 is still visibly lit and f/2.8 is close to pure white).
export const BALANCE_GLOW_MAX = .85;
export const balanceGlow = a => BALANCE_GLOW_MAX*Math.sqrt(balanceIntensity(a));
// Sweep scale for the sensor material: each row builds at a rate proportional
// to the intensity while the gap between the curtains lies over it, for the
// gap's playback time, so the slit paints the final exposure.
export const balanceSweepScale = (a,s) => balanceExposure(a,s)*LESSON_TRAVEL/shotGap(balanceShutterDetent(s));
// Exposure row `d` (0 top, 1 bottom) has collected for curtain edges `front`
// and `back` (unclamped travel units): sensor_exposure_material.js evaluates
// the same expression per row.
export const balanceRowExposure = (a,s,front,back,d) =>
  clamp((Math.max(front-d,0)-Math.max(back-d,0))*balanceSweepScale(a,s));
// Seconds a whole shot plays (settle, press, curtains, rest) and its progress.
export const balanceShotSeconds = s => shotSeconds(balanceShutterDetent(s));
export const balanceShotProgress = (s,t) => shotProgress(balanceShutterDetent(s),t);
// Seconds one sensor row lies in the light, in playback: shorter at each
// faster shutter stop.
export const balanceGlowSeconds = s => shotGap(balanceShutterDetent(s));

// One balanced shot at (a, s), `t` seconds after the release: the shutter
// lesson's curtain timing at that speed, with this lesson's intensity.
// Fills `out` like shotFrame (value, first, second, front, back, share,
// opacity) and sets `exposure` (mean displayed signal), `glow` (white light
// strength while light arrives, else 0) and `scale` (the sweep scale).
export function balanceShotFrame(a, s, t, out) {
  const detent = balanceShutterDetent(s);
  shotFrame(detent, t, out);
  out.scale = balanceSweepScale(a,s);
  out.exposure = balanceExposure(a,s)*out.share;
  out.glow = out.glow>0 ? balanceGlow(a) : 0;
  // The curtains darken to the shutter lesson's veil while the shutter
  // works, and clear again before and after, so the yellow left behind
  // reads as itself rather than through blue slats.
  const end = SHOT_LEAD+shotGap(detent)+LESSON_TRAVEL;
  const working = t<SHOT_LEAD ? ease(t/SHOT_LEAD) : 1-ease((t-end)/BALANCE_CURTAIN_CLEAR);
  out.opacity = BALANCE_CURTAIN_REST+(CURTAIN_TRANSLUCENT-BALANCE_CURTAIN_REST)*working;
  return out;
}
// The curtains at rest (still visible as the shutter, the sensor plain
// behind them) and how long they take to clear after a shot, in seconds.
export const BALANCE_CURTAIN_REST = .16, BALANCE_CURTAIN_CLEAR = .28;
const ease = p => { p = clamp(p); return p*p*(3-2*p); };
// Valid lesson indices only.
export const isBalanceSetting = (a,s) => Number.isInteger(a)&&a>=0&&a<=BALANCE_APERTURE_MAX&&
  Number.isInteger(s)&&s>=0&&s<=BALANCE_SHUTTER_MAX;
