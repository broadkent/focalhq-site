import {metersToWorld, equalFramingDistanceM} from './world_scale.js';
// Pure math for the Studio lessons (lesson=1): the key:fill ratio and the equal-framing
// dolly. No scene, no DOM, so node tests load it.
import {LAMP_TARGET} from './lesson_presets.js';

export const lampDistance = (position, target = LAMP_TARGET) =>
  Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);

// A lamp's light on the target, in "percent at one unit": its brightness percent over the
// distance squared (the inverse square law). A lamp that is off or at 0 gives 0.
export function lampIrradiance(light, target = LAMP_TARGET) {
  const percent = Number(light?.brightnessPercent);
  if (!light || light.enabled === false || !(percent > 0)) return 0;
  const d = Math.max(lampDistance(light.position, target), 1e-6);
  return percent / (d * d);
}

const trimmed = n => String(Math.round(n * 10) / 10);

/** "4:1", "2.5:1", or "1:2" when the fill is the brighter. */
export function ratioText(stops) {
  if (!Number.isFinite(stops)) return null;
  const n = 2 ** (Math.round(stops * 1e6) / 1e6);
  return n >= 1 ? `${trimmed(n)}:1` : `1:${trimmed(1 / n)}`;
}

/**
 * The key:fill ratio, from lamp power and the inverse square law: the first lamp is the key,
 * the second the fill. Null with fewer than two lamps. With either lamp dark the ratio is
 * undefined: stops and text are null.
 * `{key, fill, stops, text}`: key and fill are irradiance on the target (percent at one unit),
 * stops = log2(key / fill), text = "n:1".
 */
export function keyFillRatio(lights, target = LAMP_TARGET) {
  if (!Array.isArray(lights) || lights.length < 2) return null;
  const key = lampIrradiance(lights[0], target), fill = lampIrradiance(lights[1], target);
  if (!(key > 0) || !(fill > 0)) return {key, fill, stops: null, text: null};
  const stops = Math.log2(key / fill);
  return {key, fill, stops, text: ratioText(stops)};
}

// Equal framing: the head's projected height is focalLength / distance times its height, so
// holding head size as the lens changes holds distance / focalLength (millimeters' worth of
// distance per millimeter of lens).
export const equalFramingRate = (distance, focalLength) => distance / focalLength;

// True scale (Kent, October 22, 2026): the rate a real full-frame camera needs to hold the head at
// EQUAL_FRAMING_HEAD_FRACTION of the 24 mm frame, world units per mm, whatever the camera distance was.
export const trueEqualFramingRate = () => metersToWorld(equalFramingDistanceM(1));

/** The camera distance that keeps the head size [rate] sets at [focalLength], inside [min, max]. */
export function equalFramingDistance(rate, focalLength, {min = 0, max = Infinity} = {}) {
  return Math.min(max, Math.max(min, rate * focalLength));
}

/** True if the bounds stopped the dolly holding the head size. */
export const equalFramingClamped = (rate, focalLength, bounds) =>
  Math.abs(equalFramingDistance(rate, focalLength, bounds) - rate * focalLength) > 1e-6;
