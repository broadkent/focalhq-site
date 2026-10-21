// Lamp places for the Studio lessons (lesson=1). The four setups are copied from the
// landing page's STUDIO_SEQUENCE (web_landing/timeline.js) and never imported from it:
// the landing page stays untouched, and test/regression/lab_lesson_presets.test.mjs
// reads timeline.js as text and fails if a value here drifts from it.
// Positions are world xyz; distance and angles are measured from the lamp target
// (0, .55, 0), which is where setLight in lighting.js holds the lamp 2.35 away from.
export const LAMP_TARGET = Object.freeze([0, .55, 0]);
export const MIN_LAMP_DISTANCE = 2.35;

export const LESSON_PRESETS = Object.freeze({
  // The landing setups.
  butterfly: Object.freeze([0, 3.2, 1.5]),
  loop: Object.freeze([1.5, 2.2, 1.5]),
  rembrandt: Object.freeze([2.0, 1.8, 1.4]),
  split: Object.freeze([2.2, 1.3, 0.4]),
  // Direction lesson (plan section 2.4): lamp on a circle round the head, at the head's height.
  front: Object.freeze([0, 0.6, 3.0]),
  side: Object.freeze([3.0, 0.6, 0.2]),
  back: Object.freeze([0, 0.6, -3.0]),
  // The fill lamp of lesson 13: opposite the Rembrandt key, the same distance from the target
  // (2.742), so distance never enters the key:fill ratio.
  fill: Object.freeze([-1.915, 0.981, 1.915]),
});

export const LESSON_PRESET_NAMES = Object.freeze(Object.keys(LESSON_PRESETS));

/** The preset's xyz as a fresh array, or null for an unknown name. */
export function presetPosition(name) {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(LESSON_PRESETS, key) ? [...LESSON_PRESETS[key]] : null;
}
