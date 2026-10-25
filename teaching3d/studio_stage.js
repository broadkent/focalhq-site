// The Studio's depth stage (lesson 9 first, October 21, 2026): one switch, `stage {on, radius, feather}`,
// that other Studio lessons can adopt once Kent has seen it. Off by default; the lab, the landing page
// and every other lesson draw exactly as before. What it draws depends on the theme (stageLook):
//
//   Dark: the ink stage. Kent, October 21, 2026: "to keep the bust the main subject, we need to have
//   some light fall off. Like, we need the backgrounds to be ink. ... the objects going back should be
//   darker as they go back, mostly because of the fall off."
//   Light: the fog stage. Kent, October 21, 2026: "lets have the backdrop be paper for light mode and ink
//   for dark mode and for light mode let's have "fog" and dark mode will be light falloff."
//
// With the switch on, in the optics pass (lighting_optics.js):
//   1. Ground. Dark: the empty background prints as ink, the levels' black (0 before the levels), the
//      dark paper's own darkest tone. Light: the page paper, as without the stage.
//   2. Depth. The lesson props are flat print tones flagged in the HDR buffer (lesson_props.js), so
//      the lamps never reach them. Each prop pixel is put back in world space from the depth buffer
//      and weighed by the key lamp's inverse square, k = (ref / d)^2 capped at 1, where ref is the key's
//      distance to the lamp target (the bust): a prop as far from the key as the bust keeps its tone.
//      Dark (falloff): its linear light is multiplied by k, so far props sink into the ink. Light (fog):
//      its linear tone is mixed toward the paper, keeping STAGE_FOG_FLOOR + (1 - floor) k of its ink,
//      so far props print fewer, smaller dots and fade but never vanish (keyFog). The bust's own
//      lighting is not touched (the lamps are the same nine spot samples with decay 2; widening their
//      cones to reach the props would coarsen the bust's shadow maps, area_light.js). Lit props
//      (lesson 9's prints, standard materials) draw flat twins of their materials on the stage
//      (createStagePropTwins), so the same weighing reaches them: the spot cones cut them with a hard
//      edge or missed them, and the prints' emissive floor lit every print alike (October 21, 2026).
//   3. Window (dark only). The picture fades into the page paper over a feather round a rounded
//      rectangle, mixed in display space before the halftone screen. On the dark paper the ink ground
//      and the paper are one tone, so the window draws no seam. The light theme has no window: its
//      ground is already the paper.

import {OVERSCAN_GLSL,overscanUniforms} from './studio_overscan.js';

/** The switch off: what every page without `stage` draws. */
export const STAGE_OFF = Object.freeze({on: false, radius: 0, feather: 0});

// domain: widest feather, as a share of the view's short side (half would meet in the middle)
export const STAGE_MAX_FEATHER = .45;

// domain: the share of its ink a prop keeps however far back in the fog (light theme), so a distant
// print fades but is never lost (Kent, October 21, 2026: fog, the mirror of the dark theme's falloff)
export const STAGE_FOG_FLOOR = .3;

/** A host's `stage` value, cleaned: radius in CSS px (>= 0), feather a share of the short side. */
export function parseStage(value) {
  if (typeof value?.on !== 'boolean') return null;
  if (!value.on) return STAGE_OFF;
  const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  return Object.freeze({on: true, radius: num(value.radius, 0, 200, 16), feather: num(value.feather, 0, STAGE_MAX_FEATHER, .2)});
}

/**
 * What a stage draws in a theme: the ink stage (ink ground, falloff, window) on the dark paper, the
 * fog stage (paper ground, fog) on the light one, neither when it is off.
 */
export function stageLook(stage, dark) {
  const on = stage?.on === true;
  return Object.freeze({...(stage ?? STAGE_OFF), ink: on && dark === true, fog: on && dark !== true});
}

/**
 * The window's share of the picture (1 inside, 0 at the edge) at canvas pixel (x, y) of a w x h
 * canvas, every length in the same px. The rectangle inset by the feather with corners of [radius]
 * is fully the picture; outside it the picture fades over [feather] (smoothstep), so the outer
 * contour meets the canvas edge at every side's middle and rounds its corners by radius + feather.
 * Mirrors `stageWindowAt` in STAGE_GLSL.
 */
export function stageWindow(x, y, w, h, radius, feather) {
  const f = Math.max(feather, 1e-6), r = Math.max(0, Math.min(radius, Math.min(w, h) / 2 - feather));
  const bx = Math.max(0, w / 2 - feather - r), by = Math.max(0, h / 2 - feather - r);
  const qx = Math.abs(x - w / 2) - bx, qy = Math.abs(y - h / 2) - by;
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  const t = Math.min(1, Math.max(0, d / f));
  return 1 - t * t * (3 - 2 * t);
}

/** The key lamp's light at distance [d] relative to the lamp target's at [ref]: (ref / d)^2, capped at 1. */
export function keyFalloff(d, ref) {
  if (!(ref > 0)) return 1;
  return Math.min(1, (ref / Math.max(d, 1e-6)) ** 2);
}

/** The share of its ink a prop keeps in the fog at distance [d]: the falloff's curve over a floor. */
export function keyFog(d, ref) {
  return STAGE_FOG_FLOOR + (1 - STAGE_FOG_FLOOR) * keyFalloff(d, ref);
}

// The flag lesson_props.js's flat tones and the softbox cue carry in the HDR buffer's alpha.
const PROP_FLAG = '0.5';

/**
 * Lit props on the stage (lesson 9's prints, lesson_props_prints.js). The lamps are nine spot
 * samples whose cones are sized to the bust (area_light.js), so a print beside or behind the bust is
 * cut by a hard cone edge or not lit at all, and the prints' emissive floor lit every print alike
 * (rendered check, October 21, 2026). On the stage each lit prop mesh draws a flat twin of its
 * material instead: the same albedo (color and photo map), flagged like the flat props, so the optics
 * pass weighs it by the key's distance like every other prop. Off the stage the originals come back
 * untouched. `sync` runs before each draw: a photo map that arrives later is picked up.
 */
export function createStagePropTwins(THREE) {
  const twins = new Map();      // original material -> its flat twin
  const swapped = new Map();    // mesh -> its original material
  const twinOf = (original, ink) => {
    let twin = twins.get(original);
    if (!twin) {
      twin = new THREE.MeshBasicMaterial({color: new THREE.Color(), side: original.side,
        polygonOffset: original.polygonOffset, polygonOffsetFactor: original.polygonOffsetFactor, polygonOffsetUnits: original.polygonOffsetUnits});
      twin.userData.stageTwin = true;
      twin.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.a=${PROP_FLAG};`);
      };
      twin.customProgramCacheKey = () => 'focal-stage-prop-twin-v1';
      twins.set(original, twin);
    }
    // On the ink ground a prop may name its tone (userData.stageGray, sRGB): the prints' white paper
    // border, a 2-3 px strip at 24 mm, printed as a bright marquee round each photo (aesthetic review,
    // October 21, 2026). On the paper ground (the fog) the border is white again.
    const gray = ink ? original.userData?.stageGray : undefined;
    if (typeof gray === 'number') {
      const want = new THREE.Color().setRGB(gray, gray, gray, THREE.SRGBColorSpace);
      if (!twin.color.equals(want)) twin.color.copy(want);
    } else if (!twin.color.equals(original.color)) twin.color.copy(original.color);
    if (twin.map !== (original.map ?? null)) {twin.map = original.map ?? null;twin.needsUpdate = true;}
    return twin;
  };
  const restore = () => {
    for (const [mesh, original] of swapped) mesh.material = original;
    swapped.clear();
  };
  return {
    /** Puts each lit mesh of [group] on its twin while [on] (with the ink ground's tones when [ink]), else puts every original back. */
    sync(group, on, {ink = false} = {}) {
      if (!on || !group) {restore();return;}
      for (const [mesh, original] of swapped) if (!isIn(mesh, group)) {mesh.material = original;swapped.delete(mesh);}
      group.traverse(o => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        const original = swapped.get(o) ?? o.material;
        if (!original?.isMeshStandardMaterial) return;
        o.material = twinOf(original, ink);swapped.set(o, original);
      });
    },
    get swapped() {return swapped.size;},
    dispose() {restore();for (const twin of twins.values()) twin.dispose();twins.clear();},
  };
}
const isIn = (object, group) => {
  for (let o = object; o; o = o.parent) if (o === group) return true;
  return false;
};

/** The optics pass's stage uniforms (shared by its passes). */
export const stageUniforms = THREE => ({
  stageInk: {value: 0},                                  // the ink stage (dark): ink ground, falloff, window
  stageFog: {value: 0},                                  // the fog stage (light): paper ground, fog
  stageWindowPx: {value: new THREE.Vector4(1, 1, 0, 0)}, // canvas w, h; corner radius; feather (device px)
  stageKey: {value: new THREE.Vector4(0, 0, 0, 0)},      // key lamp xyz (world); w: its distance to the lamp target
  stageInvProjection: {value: new THREE.Matrix4()},
  stageCameraWorld: {value: new THREE.Matrix4()},
  // The full-bleed view's edge fade (studio_overscan.js), on every lesson, stage or not.
  ...overscanUniforms(THREE),
});

/**
 * Sets the stage uniforms for one frame. [stage] is a stageLook ({ink, fog, radius (CSS px), feather
 * (share)}) or null, [canvas] the output size in device px, [pixelRatio] device px per CSS px, [key]
 * {position, ref}.
 */
export function applyStage(uniforms, stage, {canvas, pixelRatio = 1, camera, key} = {}) {
  const ink = stage?.ink === true, fog = !ink && stage?.fog === true;
  uniforms.stageInk.value = ink ? 1 : 0;
  uniforms.stageFog.value = fog ? 1 : 0;
  if (!ink && !fog) return;
  const [w, h] = canvas;
  uniforms.stageWindowPx.value.set(w, h, stage.radius * pixelRatio, stage.feather * Math.min(w, h));
  if (key?.position) uniforms.stageKey.value.set(...key.position, key.ref > 0 ? key.ref : 0);
  else uniforms.stageKey.value.set(0, 0, 0, 0);
  if (camera) {
    uniforms.stageInvProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.stageCameraWorld.value.copy(camera.matrixWorld);
  }
}

// GLSL for the optics passes; needs SHADE_GLSL (paperColor) before it.
export const STAGE_GLSL = `${OVERSCAN_GLSL}
  uniform float stageInk;
  uniform float stageFog;
  uniform vec4 stageWindowPx;
  uniform vec4 stageKey;
  uniform mat4 stageInvProjection;
  uniform mat4 stageCameraWorld;
  // The ink stage (dark theme): ink ground, falloff, window.
  bool inkStageOn(){return stageInk>.5;}
  // Either stage: the props are weighed by their distance from the key (falloff or fog).
  bool depthStageOn(){return stageInk>.5||stageFog>.5;}
  // A prop's anti-aliased edge on the stage: its .5 flag blended with the ground's alpha 1 (the bust and the
  // ground write 1). Never true off the stage.
  bool stageEdge(float a){return depthStageOn()&&a>.49&&a<.99;}
  // See stageWindow in studio_stage.js.
  float stageWindowAt(vec2 uv){
    if(!inkStageOn())return 1.;
    vec2 size=stageWindowPx.xy;float f=max(stageWindowPx.w,1e-6);
    float r=max(0.,min(stageWindowPx.z,min(size.x,size.y)*.5-stageWindowPx.w));
    vec2 b=max(vec2(0.),size*.5-vec2(stageWindowPx.w+r));
    vec2 q=abs(uv*size-size*.5)-b;
    float d=length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-r;
    return 1.-smoothstep(0.,1.,clamp(d/f,0.,1.));
  }
  // A finished (display) tone inside the ink stage's window: mixed toward the paper in display space,
  // before the screen, so the dots thin toward the edge. The edge itself is exactly the paper.
  // Every finished tone also thins into the paper toward a full-bleed canvas's top and bottom edges
  // (overscanFadeAt, 1 everywhere unless the host set a fade).
  vec3 stageWindowed(vec3 shown,vec2 uv){return mix(paperColor,inkStageOn()?mix(paperColor,shown,stageWindowAt(uv)):shown,overscanFadeAt(uv));}
  // The empty background's tone: the ink (0 before the levels) on the ink stage, else the paper as given.
  vec3 stageGround(vec3 paper){return inkStageOn()?vec3(0.):paper;}
  vec3 stageLinear(vec3 c){c=clamp(c,0.,1.);return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
  // A flagged prop pixel's tone weighed by its distance from the key lamp (see keyFalloff and keyFog):
  // darkened toward the ink on the ink stage, faded toward the paper in the fog.
  // The weight is a world distance only: it never follows the working frame, so a prop's tone runs
  // through the frame's edges unchanged.
  vec3 stageDistance(vec3 shown,float depth,vec2 uv){
    if(!depthStageOn()||stageKey.w<=0.)return shown;
    vec4 view=stageInvProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
    vec3 world=(stageCameraWorld*vec4(view.xyz/view.w,1.)).xyz;
    float d=max(distance(world,stageKey.xyz),1e-6);
    float k=min(1.,(stageKey.w*stageKey.w)/(d*d));
    vec3 lin=stageLinear(shown);
    lin=inkStageOn()?lin*k:mix(stageLinear(paperColor),lin,${STAGE_FOG_FLOOR.toFixed(4)}+${(1 - STAGE_FOG_FLOOR).toFixed(4)}*k);
    return mix(lin*12.92,1.055*pow(max(lin,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),lin));
  }
`;
