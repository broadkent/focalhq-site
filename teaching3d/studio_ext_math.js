// Pure math for the Studio extensions (studio_ext.js and its modules): no scene, no DOM, so node
// tests load it (test/teaching3d/studio_ext_math.test.mjs). Lengths are meters unless a name says
// world units; angles are degrees.
import {WORLD_UNITS_PER_METER} from './world_scale.js';

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const lerp = (a, b, t) => a + (b - a) * t;
export const finite = n => typeof n === 'number' && Number.isFinite(n);
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

/** The face's height in the scene, world units (lighting.js target.y). */
export const FACE_Y_WORLD = .55;
/** The bust's base line, world units (lesson_props.js floorY): the ground plane lies here. */
export const GROUND_Y_WORLD = -1.45;
/** The face's height above the base line, meters: a camera "height" is measured from the base line too. */
export const FACE_Y_M = (FACE_Y_WORLD - GROUND_Y_WORLD) / WORLD_UNITS_PER_METER;

// --- Studio map ---------------------------------------------------------------------------------

/**
 * The camera pose for a marker on the top map: [x] right and [z] toward the default camera, meters from
 * the bust; [height] is the lens height above the bust's base line, meters. The camera looks at the face.
 * Returns the renderer's pose azimuth (poseTo convention: positive turns the camera to the viewer's
 * left round the bust, so a marker on the right has a negative azimuth) and elevation, and the distance
 * from the face, meters.
 */
export function cameraFromMap({x, z, height = FACE_Y_M}) {
  const flat = Math.hypot(x, z);
  const rise = height - FACE_Y_M;
  return {
    azimuth: -deg(Math.atan2(x, z)),
    elevation: deg(Math.atan2(rise, Math.max(flat, 1e-6))),
    distance: Math.hypot(flat, rise),
    flat,
  };
}

/** The inverse: a pose's marker place and lens height. */
export function mapFromCamera({azimuth, elevation, distance}) {
  const flat = Math.cos(rad(elevation)) * distance;
  return {
    x: Math.sin(rad(-azimuth)) * flat,
    z: Math.cos(rad(-azimuth)) * flat,
    height: FACE_Y_M + Math.sin(rad(elevation)) * distance,
  };
}

// --- Sky ----------------------------------------------------------------------------------------

export const SUNRISE = 6;
export const SUNSET = 18;

/** The sun's elevation and azimuth at [hour] (6 to 18): up from the left, over the top, down on the right. */
export function sunAngles(hour) {
  const t = clamp((hour - SUNRISE) / (SUNSET - SUNRISE), 0, 1);
  return {elevation: Math.sin(Math.PI * t) * 90, azimuth: lerp(-80, 80, t)};
}

/** The sun lamp's place, meters from the face (x right, y up, z toward the camera), [range] out. */
export function sunOffset(hour, range = 1.8) {
  const {elevation, azimuth} = sunAngles(hour);
  const e = rad(Math.max(elevation, 8)), a = rad(azimuth);
  return [Math.sin(a) * Math.cos(e) * range, Math.sin(e) * range, Math.cos(a) * Math.cos(e) * range];
}

/** The sun's brightness, percent: dim at the horizon, full overhead, thinned by cloud (0..1). */
export function sunBrightness(hour, cloud) {
  const e = sunAngles(hour).elevation;
  const base = 12 + 88 * Math.pow(Math.sin(rad(clamp(e, 0, 90))), .6);
  return clamp(base * (1 - .36 * clamp(cloud, 0, 1)), 0, 100);
}

/** The sun's width, meters: a hard point on a clear sky to a soft 2 m source under cloud. */
export function sunWidthM(cloud) {
  return lerp(.1, 2, Math.pow(clamp(cloud, 0, 1), .7));
}

/**
 * The sky's fill level, 0..1: bright overhead, and nearly as much under cloud (the sun gives way to the
 * sky as the cloud thickens, so a clear noon still lights the eye sockets).
 */
export function skyFill(hour, cloud) {
  const e = sunAngles(hour).elevation;
  const day = .25 + .75 * Math.sin(rad(clamp(e, 0, 90)));
  return day * (.55 + .45 * clamp(cloud, 0, 1)) * .5;
}

/** The blocking wall's size and place, meters: 1.4 wide, 1.8 tall, [angle] degrees round the bust, 0.85 m out. */
export const WALL = Object.freeze({width: 1.4, height: 1.8, away: .85, angle: -70});
export function wallPlacement(angleDeg = WALL.angle) {
  const a = rad(angleDeg);
  return {x: Math.sin(a) * WALL.away, z: Math.cos(a) * WALL.away, width: WALL.width, height: WALL.height};
}
/**
 * The wall's two ends in plan, meters from the bust (x right, z toward the camera): the wall faces the
 * bust, so it runs along the tangent of the circle it stands on.
 */
export function wallEnds(angleDeg = WALL.angle) {
  const a = rad(angleDeg), {x, z, width} = wallPlacement(angleDeg);
  const tx = Math.cos(a), tz = -Math.sin(a), h = width / 2;
  return [[x - tx * h, z - tz * h], [x + tx * h, z + tz * h]];
}

/** The sky dome's gray at the top and at the horizon (0..1) for [hour]. */
export function domeTones(hour, cloud) {
  const e = sunAngles(hour).elevation;
  const day = Math.sin(rad(clamp(e, 0, 90)));
  const c = clamp(cloud, 0, 1);
  const top = lerp(.22 + .3 * day, .62 + .1 * day, c);
  const horizon = lerp(.5 + .4 * day, .74 + .1 * day, c);
  return {top, horizon};
}

// --- Tint ---------------------------------------------------------------------------------------

const ORANGE = [1, .56, .2], WHITE = [1, 1, 1], BLUE = [.5, .7, 1];

/** A warmth ruler value in [-1, 1] (-1 orange, 0 neutral, 1 blue) as a linear RGB multiplier. */
export function warmthRgb(w) {
  const v = clamp(w, -1, 1), end = v < 0 ? ORANGE : BLUE, t = Math.abs(v);
  return WHITE.map((c, i) => lerp(c, end[i], t));
}

/** The sun's own warmth by elevation: orange near the horizon, neutral high. */
export function sunWarmth(elevation) {
  return -clamp(1 - elevation / 40, 0, 1) * .9;
}

/** "#rrggbb" of an rgb triple (0..1). */
export function hexOf(rgb) {
  return '#' + rgb.map(c => Math.round(clamp(c, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

/** An "#rrggbb" or "rgb(r, g, b)" CSS color as 0..1 channels, or null. */
export function rgbOf(css) {
  const s = String(css ?? '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  return m ? [m[1], m[2], m[3]].map(n => Number(n) / 255) : null;
}

/**
 * The ink colour a tint prints in: the theme's ink [fg] pulled toward the lamp light [rgb]. On the light
 * paper the ink stays dark (the tint scaled down); on the dark paper it stays pale.
 */
export function tintedInk(fg, rgb, dark, amount = .7) {
  const base = rgbOf(fg);
  if (!base) return null;
  const tone = dark ? rgb : rgb.map(c => c * .62);
  return base.map((c, i) => lerp(c, tone[i], amount));
}

// --- Flash --------------------------------------------------------------------------------------

/** The power ladder: full power then each stop down, as the lamp's brightness percent. */
export const FLASH_STOPS = Object.freeze([0, 1, 2, 3, 4, 5]);
export const flashPercent = stopsDown => clamp(100 * 2 ** -stopsDown, 0, 100);
/** The flash burst's pulse times, ms from the trigger: [on, off] per flash. */
export function burstPulses(count, onMs = 90, gapMs = 150) {
  return Array.from({length: clamp(Math.round(count), 1, 8)}, (_, i) => [i * (onMs + gapMs), i * (onMs + gapMs) + onMs]);
}

// --- Panel --------------------------------------------------------------------------------------

/** A card's bounce: the key's brightness scaled by how near the card stands (1.2 m is the reference). */
export function cardBounce(keyPercent, cardDistanceM) {
  const near = clamp((1.2 / Math.max(cardDistanceM, .3)) ** 2, 0, 2.5);
  return clamp(keyPercent * .3 * near, 0, 100);
}

/** A point [t] of the way from [from] to [to] (arrays). */
export const along = (from, to, t) => from.map((v, i) => lerp(v, to[i], t));

export const WUM = WORLD_UNITS_PER_METER;
export const toWorld = m => m * WORLD_UNITS_PER_METER;
