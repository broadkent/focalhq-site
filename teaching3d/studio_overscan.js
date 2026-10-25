// The Studio lessons' full-bleed view (Kent, October 21, 2026, on lesson 9's Match screen: "Move the
// main view up and centered and add corner marks to show what the frame is, BUT the visuals should
// extend outside of the frame to the edges of the phone. ... Any of the studio games should have just
// the corner marks to show the working frame and it should render outside of it as well").
//
// The host lays the canvas across the whole play area and names the working frame inside it with the
// `frame` command, {left, top, width, height, fade} in canvas CSS px. The camera keeps the frame's own
// aspect and frustum and is overscanned to the canvas with a view offset (three's setViewOffset with a
// window larger than the full image), so what the frame shows is exactly the picture the canvas showed
// when it was the frame, at every lens: the fit, the aim, the meter and the stills all still see the
// frame alone. `fade` (CSS px) thins the picture into the page paper toward the canvas's top and bottom
// edges, only outside the frame, so the canvas has no edge of its own against the page. The sides run
// to the phone's edges and need none.

/** A host's `frame` value, cleaned (CSS px), or null: the whole canvas is the frame. */
export function parseFrame(value) {
  if (!value || typeof value !== 'object') return null;
  const {left, top, width, height} = value;
  if (![left, top, width, height].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  if (width < 1 || height < 1) return null;
  const fade = typeof value.fade === 'number' && Number.isFinite(value.fade) ? Math.max(0, value.fade) : 0;
  return Object.freeze({left, top, width, height, fade});
}

/**
 * The frame for a canvas of [w] x [h] CSS px: the host's [frame] when it lies inside the canvas (to
 * half a px), else the whole canvas (a still, or a canvas that has not caught up with the frame yet).
 */
export function frameIn(frame, w, h) {
  const whole = {left: 0, top: 0, width: w, height: h, fade: 0};
  if (!frame) return whole;
  const e = .5;
  if (frame.left < -e || frame.top < -e || frame.left + frame.width > w + e || frame.top + frame.height > h + e) return whole;
  return frame;
}

/**
 * The camera's view offset for [frame] on a [canvas] = [w, h] (CSS px), with the lab's reframing
 * ([zoom] <= 1 widens the frame round the unchanged lens, [shift] moves the subject up by that share
 * of the frame's height): three's setViewOffset arguments, or null when there is nothing to offset.
 * The frame plays the full image; the canvas is a window round it, larger than it.
 */
export function overscanViewOffset(frame, [w, h], {zoom = 1, shift = 0} = {}) {
  const f = frameIn(frame, w, h);
  const whole = f.left === 0 && f.top === 0 && f.width === w && f.height === h;
  if (whole && zoom === 1 && shift === 0) return null;
  return [f.width * zoom, f.height * zoom, -(1 - zoom) * f.width / 2 - f.left, -(1 - zoom) * f.height / 2 + shift * f.height - f.top, w, h];
}

/** A point in canvas fractions (0..1, y down) as fractions of the frame. */
export function toFrameFraction({x, y}, frame, [w, h]) {
  const f = frameIn(frame, w, h);
  return {x: (x * w - f.left) / f.width, y: (y * h - f.top) / f.height};
}

/**
 * The fade bands at the canvas's top and bottom, CSS px: the host's fade, but never reaching into the
 * frame (the frame prints exactly as before).
 */
export function fadeBands(frame, [w, h]) {
  const f = frameIn(frame, w, h);
  if (!(f.fade > 0)) return {top: 0, bottom: 0};
  return {top: Math.max(0, Math.min(f.fade, f.top)), bottom: Math.max(0, Math.min(f.fade, h - f.top - f.height))};
}

/**
 * The picture's share (1 the picture, 0 the paper) at canvas row [y] (CSS px from the top) of a canvas
 * [h] high with [bands]: a smoothstep from each banded edge in. Mirrors overscanFadeAt in OVERSCAN_GLSL.
 */
export function overscanFade(y, h, {top, bottom}) {
  const s = t => {const c = Math.min(1, Math.max(0, t));return c * c * (3 - 2 * c);};
  return (top > 0 ? s(y / top) : 1) * (bottom > 0 ? s((h - y) / bottom) : 1);
}

/**
 * The host's scrim over the live view (the `dim` command, 0..1): the share of the page paper laid over
 * the whole canvas, the same mix the page's scrim makes under the app's paper, so a dimmed page has no
 * step at the canvas's edge (review, October 21, 2026: Ready?). A still never takes it.
 */
export function parseDim(value) {
  const v = Number(value);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/**
 * The optics passes' uniforms: x top band, y bottom band, z canvas height (device px); the dim.
 */
export const overscanUniforms = THREE => ({
  overscanFadePx: {value: new THREE.Vector3(0, 0, 1)},
  overscanDim: {value: 0},
});

/**
 * Sets the fade for one frame: [frame] as the host gave it, [canvas] CSS px, [pixelRatio] device px per CSS
 * px, [dim] the scrim. Nothing here follows the working frame's own edges: the scene runs through them
 * unchanged (review round 3, October 21, 2026).
 */
export function applyOverscan(uniforms, frame, {canvas, pixelRatio = 1, dim = 0}) {
  const bands = fadeBands(frame, canvas);
  uniforms.overscanFadePx.value.set(bands.top * pixelRatio, bands.bottom * pixelRatio, Math.max(1, canvas[1] * pixelRatio));
  uniforms.overscanDim.value = parseDim(dim);
}

// GLSL for the optics passes (before STAGE_GLSL, whose stageWindowed applies it to every finished tone).
export const OVERSCAN_GLSL = `
  uniform vec3 overscanFadePx;
  uniform float overscanDim;
  // See overscanFade in studio_overscan.js. uv.y runs up from the canvas's bottom. The dim lays the
  // paper over the whole picture, frame and all.
  float overscanFadeAt(vec2 uv){
    float y=(1.-uv.y)*overscanFadePx.z;
    float top=overscanFadePx.x>0.?smoothstep(0.,1.,clamp(y/overscanFadePx.x,0.,1.)):1.;
    float bottom=overscanFadePx.y>0.?smoothstep(0.,1.,clamp((overscanFadePx.z-y)/overscanFadePx.y,0.,1.)):1.;
    return top*bottom*(1.-overscanDim);
  }
`;
