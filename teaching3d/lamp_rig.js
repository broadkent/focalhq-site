// The Studio's lamp rig in meters. No three.js import, so node tests load it.
//
// Kent, October 22, 2026: "Yeah, let's move them. We want it spatially accurate." The bust is life size
// (world_scale.js: 1 m = WORLD_UNITS_PER_METER units), so the lamps stand where a studio puts them: a key
// and fill 1 to 1.5 m from the face, never nearer than 0.6 m, behind real modifiers (a 15 cm bare reflector,
// a 30 cm beauty dish, a 50 cm softbox, a 1 m octa, a 2 m scrim).
//
// Before this the rig was authored in world units 2.3 to 3.9 from the face, which at true scale is 0.29 to
// 0.48 m, with sources 2 to 61 cm wide. Every lamp here is that rig scaled about the face by
// RIG_METERS_PER_OLD_UNIT meters per old unit, positions and widths alike, so every angle, every
// width / distance (hardness) and every inverse-square ratio is exactly what the lessons were tuned on, and
// the light on the face is the same (the area light calibrates against its own starting geometry, so a rig
// scaled about the face lights the face as before). Places are written as meters offset from the face
// (LAMP_TARGET); lampAt turns one into the world position the renderer takes.
import {metersToWorld, worldToMeters} from './world_scale.js';

/** The point every lamp aims at and is measured from: the face, world units (the renderer's `target`). */
export const LAMP_TARGET = Object.freeze([0, .55, 0]);

/** Meters per old world unit of the pre-true-scale rig; the table in true_scale_lamps.test.mjs checks the move against it. */
export const RIG_METERS_PER_OLD_UNIT = .41;


/** Meters offset from the face [x right, y up, z toward the camera] to a world position, world units. */
export const lampAt = ([x, y, z]) => [
  LAMP_TARGET[0] + metersToWorld(x),
  LAMP_TARGET[1] + metersToWorld(y),
  LAMP_TARGET[2] + metersToWorld(z),
];

/** A source width in meters as the renderer's width, world units. */
export const lampSize = meters => metersToWorld(meters);

/** A lamp never stands nearer the face than this. */
export const MIN_LAMP_DISTANCE_M = .6;
export const MIN_LAMP_DISTANCE = metersToWorld(MIN_LAMP_DISTANCE_M);

/**
 * A lamp stays inside this cube round the origin (meters), on every axis. 2 m: every authored lamp is within 1.1 m
 * of the face on each axis, and a placement panel spanning only this keeps the bust close to the size it had
 * (a +-5 m field drew it a third as large).
 */
export const LAMP_LIMIT_M = 2;
export const LAMP_LIMIT = metersToWorld(LAMP_LIMIT_M);

/** Real source sizes, meters: a bare reflector up to a large scrim. */
export const LAMP_WIDTH_RANGE_M = Object.freeze([.1, 2]);
export const MIN_LAMP_WIDTH = lampSize(LAMP_WIDTH_RANGE_M[0]);
export const MAX_LAMP_WIDTH = lampSize(LAMP_WIDTH_RANGE_M[1]);
/** A source is 1.25 times as tall as wide. */
export const LAMP_ASPECT = 1.25;

/**
 * The lab's lamps, as they stand when added: offset from the face and width in meters, and power in stops.
 * One is a 33 cm beauty dish at 1.5 m, two a 49 cm softbox at 1.4 m; three and four are rim lamps behind.
 */
export const DEFAULT_LAMPS = Object.freeze([
  Object.freeze({offset: [.734, .738, 1.045], width: .328, powerStops: 0}),
  Object.freeze({offset: [-.738, .369, 1.107], width: .492, powerStops: -1}),
  Object.freeze({offset: [.984, .226, -.902], width: .41, powerStops: -2}),
  Object.freeze({offset: [-.984, .882, -.738], width: .287, powerStops: -3}),
]);

/** A default lamp as world units: {position, width}. */
export const defaultLamp = index => {
  const lamp = DEFAULT_LAMPS[Math.min(Math.max(index, 0), DEFAULT_LAMPS.length - 1)];
  return {position: lampAt(lamp.offset), width: lampSize(lamp.width), powerStops: lamp.powerStops};
};

/** The standalone area light's starting lamp (area_light.js): a 29 cm source at 1.5 m. */
export const AREA_DEFAULT = Object.freeze({offset: [.697, .738, 1.066], width: .287});
/** The lab placement panel's starting lamp (lighting_controls.js): a 33 cm source at 1.2 m. */
export const PANEL_DEFAULT = Object.freeze({offset: [.574, .513, .902], width: .328});

/** Distance from [from] to [to], the lamp target by default. */
export const lampDistanceTo = (position, target = LAMP_TARGET) =>
  Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);

/** A lamp distance in meters. */
export const lampDistanceM = (position, target = LAMP_TARGET) => worldToMeters(lampDistanceTo(position, target));

const clampTo = (n, limit) => Math.min(limit, Math.max(-limit, n));

/**
 * Where a requested lamp place lands: inside the placement cube, and never within MIN_LAMP_DISTANCE of the face.
 * A lamp that crosses the protected sphere slides round it instead of going through the face. [axes] lists the
 * axes a selected orthographic view moves (the untouched one stays); [previous] is where the lamp was, used
 * when the request sits exactly on the face. Returns a fresh [x, y, z].
 */
export function clampLampPosition(position, {axes = [0, 1, 2], previous = null, target = LAMP_TARGET} = {}) {
  const p = position.map(n => clampTo(n, LAMP_LIMIT));
  const values = p.map((n, i) => n - target[i]);
  if (Math.hypot(...values) >= MIN_LAMP_DISTANCE) return p;
  const fixedSquared = values.reduce((sum, value, i) => sum + (axes.includes(i) ? 0 : value * value), 0);
  const radius = Math.sqrt(Math.max(0, MIN_LAMP_DISTANCE ** 2 - fixedSquared));
  let length = Math.hypot(...axes.map(i => values[i]));
  if (length < 1e-8) {
    for (const i of axes) values[i] = previous ? previous[i] - target[i] : 0;
    length = Math.hypot(...axes.map(i => values[i]));
    if (length < 1e-8) { values[axes[0]] = 1; length = 1; }
  }
  for (const i of axes) values[i] *= radius / length;
  return values.map((value, i) => target[i] + value);
}

/** A width, world units, held to the real range. */
export const clampLampWidth = width => Math.min(MAX_LAMP_WIDTH, Math.max(MIN_LAMP_WIDTH, width));
