import {HANDHELD_K} from './auto_exposure.js';

// The two exposure side effects the lab shows on the picture: sensor noise at a
// high ISO and handheld camera shake at a slow shutter. Both are display-only
// passes inside the optics shader; the exposure meter reads its own render and
// never sees either.

// Sensor noise: the ISO lesson's model, ported from tools/dof/iso_bake.py (which
// bakes the lesson's photos) so the lab's grain follows the same curve. At gain
// g = ISO / 100 the noise added to a linear pixel x has variance
//   grain^2 * (SHOT * (g - 1) * x + READ^2 * (g^2 - 1)),
// less what in-camera noise reduction takes off. test/regression pins these
// numbers to the script's.
export const NOISE_SHOT=3.2e-4; // domain: shot-noise variance per unit signal per unit of extra gain (iso_bake.py SHOT)
export const NOISE_READ=2.4e-4; // domain: read-noise std per unit of gain (iso_bake.py READ)
export const NOISE_REDUCTION_SHARE=.5; // domain: share of an ISO 400 frame's noise removed (iso_bake.py NR[0])
export const NOISE_REDUCTION_ISO=400; // domain: the frame the reduction is measured on (iso_bake.py NR[1])
export const NOISE_CHROMA_SHOT=.2; // domain: colour share of the noise where shot noise rules (iso_bake.py CHROMA[0])
export const NOISE_CHROMA_READ=.5; // domain: colour share where read noise rules (iso_bake.py CHROMA[1])
export const BASE_ISO=100; // domain: the lessons' lowest ISO, the clean source

// The standard deviation of the noise added to a linear pixel `lin` at `iso`;
// the same number iso_bake.py's `noisy` draws from.
export function isoNoiseSigma(iso,lin,grain=1){
  const g=iso/BASE_ISO;
  if(!(g>1))return 0;
  const x=Math.max(lin,0),variance=(gain,signal)=>NOISE_SHOT*(gain-1)*signal+NOISE_READ**2*(gain*gain-1);
  const floor=NOISE_REDUCTION_SHARE*Math.sqrt(variance(NOISE_REDUCTION_ISO/BASE_ISO,x));
  return grain*Math.max(Math.sqrt(variance(g,x))-floor,0);
}

// The lab shows its grain one stop softer than the lesson's curve (Kent, October
// 12, 2026): the amount the lesson draws at ISO 6400 is drawn at 12800, 3200's at
// 6400, and so on down. Only the displayed grain shifts; the exposure still uses
// the real ISO.
export const GRAIN_STOPS_SOFTER=1; // domain: stops the lab's grain curve is shifted softer than the ISO lesson's
// The ISO the lesson's noise model is evaluated at for a lab ISO.
export const grainIso=iso=>iso/2**GRAIN_STOPS_SOFTER;
// The gain the optics shader draws grain at: 1 (no grain) up to the shifted ISO.
export const grainGain=iso=>{
  const g=grainIso(Number.isFinite(iso)?iso:BASE_ISO)/BASE_ISO;
  return g>1?g:1;
};

// Handheld shake. A hand holding the camera moves about as far as 1/(focal
// length in mm) seconds' worth of exposure can hide, so a shutter slower than
// that blurs the picture sideways. The rule of thumb is one over the focal
// length, as real cameras do and the auto program holds (Kent, October 13,
// 2026), so at 50mm the threshold is 1/50: 1/30 shakes, 1/60 does not.
export const HANDHELD_SAFE_FACTOR=HANDHELD_K; // domain: safe shutter is 1 / (HANDHELD_SAFE_FACTOR x focal length mm) seconds; the auto floor uses the same
export const SHAKE_PX_PER_UNIT=10; // domain: blur length in CSS px per millimeter-second past the threshold
export const SHAKE_MAX_PX=30; // domain: longest blur, CSS px; the picture stays recognizable

// The slowest shutter, in seconds, that is still safe handheld at `focalMm`.
export const handheldSafeSeconds=focalMm=>1/(HANDHELD_SAFE_FACTOR*Math.max(focalMm,1));

// {tooSlow, blurPx}: whether `shutterSeconds` is past the threshold, and the
// sideways blur length in CSS px, growing with focal length x shutter time past
// it, capped. Zero at or below the threshold.
export function handheldShake(focalMm,shutterSeconds){
  const over=focalMm*shutterSeconds-1/HANDHELD_SAFE_FACTOR;
  if(!(over>1e-9))return {tooSlow:false,blurPx:0};
  return {tooSlow:true,blurPx:Math.min(SHAKE_MAX_PX,SHAKE_PX_PER_UNIT*over)};
}

// The shake is its own display pass over the finished, defocused picture:
// single-fetch taps along the blur, the whole tap lattice shifted by a
// per-pixel jitter so the steps dither into a smooth smear instead of stamping
// SHAKE_TAPS copies of a thin outline.
export const SHAKE_TAPS=28; // domain: taps along the blur length in the shake pass (one fetch each)
export const SHAKE_MIN_PX=.5; // domain: below this blur length the shake pass is skipped entirely
// Whether a blur of `shakePx` device px is drawn at all.
export const shakeNeeded=shakePx=>shakePx>SHAKE_MIN_PX;
// Interleaved gradient noise (Jimenez): a per-pixel phase in [0, 1) whose
// neighbors differ and whose error is blue-ish. The shake shader's jitter is
// this same function of gl_FragCoord.
export const IGN_A=.06711056,IGN_B=.00583715,IGN_C=52.9829189; // domain: Jimenez interleaved gradient noise constants
export function shakeJitter(x,y){
  const fract=v=>v-Math.floor(v);
  return fract(IGN_C*fract(IGN_A*x+IGN_B*y));
}
