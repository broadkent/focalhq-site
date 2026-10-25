// Lamp places for the Studio lessons (lesson=1). The four setups mirror the landing page's
// STUDIO_SEQUENCE (web_landing/timeline.js), which is never imported from here: the landing page
// stays standalone, and test/regression/lab_lesson_presets.test.mjs reads timeline.js as text and
// fails if a value here drifts from it.
// True scale (Kent, October 22, 2026): every place is meters offset from the face (lamp_rig.js),
// 0.96 to 1.65 m out, never nearer than MIN_LAMP_DISTANCE (0.6 m). Distance and angles are measured
// from the lamp target, where setLight in lighting.js holds the lamp at least that far away.
import {LAMP_TARGET, MIN_LAMP_DISTANCE, lampAt} from './lamp_rig.js';

export {LAMP_TARGET, MIN_LAMP_DISTANCE};

export const LESSON_PRESETS = Object.freeze({
  // The landing setups.
  butterfly: Object.freeze(lampAt([0, 1.087, 0.615])),
  loop: Object.freeze(lampAt([0.615, 0.677, 0.615])),
  rembrandt: Object.freeze(lampAt([0.82, 0.513, 0.574])),
  split: Object.freeze(lampAt([0.902, 0.308, 0.164])),
  // Direction lesson (plan section 2.4): lamp on a circle round the head, 1.23 m out, at the head's height.
  front: Object.freeze(lampAt([0, 0.02, 1.23])),
  side: Object.freeze(lampAt([1.23, 0.02, 0.082])),
  back: Object.freeze(lampAt([0, 0.02, -1.23])),
  // The fill lamp of lesson 13: opposite the Rembrandt key, the same distance from the target
  // (1.124 m), so distance never enters the key:fill ratio.
  fill: Object.freeze(lampAt([-0.785, 0.177, 0.785])),
});

export const LESSON_PRESET_NAMES = Object.freeze(Object.keys(LESSON_PRESETS));

/** The preset's xyz as a fresh array, or null for an unknown name. */
export function presetPosition(name) {
  const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(LESSON_PRESETS, key) ? [...LESSON_PRESETS[key]] : null;
}
