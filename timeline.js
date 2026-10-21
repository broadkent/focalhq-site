// Landing demo timeline: the beats of the scripted tour as plain data, plus
// keyframe tracks the director can sample at any time t (seconds).
// Every tunable lives in K, ACT_SECONDS and the two act sequences below.
// Times are seconds from loop start.
//
// Beat: {id, channel: 'camera'|'lighting'|'describe'|'page', start, duration,
//        caption?, commands?: [{at, action, value}] (at = offset into the beat),
//        events?: [{at, type, ...payload}]}.
// Tracks: keyframes {t, v, ease?, glide?}. `v` is a number or an object/array of
// numbers. `ease` shapes the segment that ARRIVES at the key. A key with
// glide:true makes the director send one timed command (track.action) at the
// previous key's time with ms = segment length; otherwise a track is either
// sampled per tick (mode 'tick'), run as one renderer path (mode 'path') or only
// read back by trackAt (mode 'passive').
//
// Round 7 (Kent, October 19, 2026): one view window, three acts that play by
// themselves, about 25 s each: "I want the camera section to just go through this
// sequence but without the user tapping or doing anything. Just animate smoothly
// through. About 25 seconds. Then 25 seconds animating lights moving around the
// bust for the studio part. Show 3 or 4 different lighting setups. Then the Feel
// section. 25 seconds for that". A one- or two-word caption names what is on screen.

/**
 * How long each act owns the window, s, from the cross-blur that brings it in to the
 * one that takes it out (the only place the act lengths live).
 */
export const ACT_SECONDS = { camera: 25, studio: 25, describe: 40 };
const BLUR_S = 1; // each cross-blur between acts

/**
 * The camera act, in order (Kent: "go through this sequence"): the Camera lab's own
 * Explore > Start tour (web/teaching3d/camera_interactions.js, Mirrorless order),
 * played with no taps. Each beat's kind, its seconds and its caption; reordering the
 * act is reordering these lines.
 * solid: the lab's Explore opening, the whole body, as the poster shows it.
 * capture (step 1, "Take a photo"): the body dissolves to its wire sketch round the
 * shutter and the curtains run. aperture (2): the iris opens, stops down, comes back.
 * focus (3) and zoom (4): their glass groups slide along the axis and back.
 * The tour's last step, "Remove and attach lens" (a 7 s mount cycle), does not fit
 * the 25 s act without rushing, so the act ends on Zoom.
 */
export const CAMERA_SEQUENCE = [
  { kind: 'solid', seconds: 3.5, caption: 'Camera' }, // review 1: a 2 s opening read as a flash
  { kind: 'capture', seconds: 5, caption: 'Shutter' },
  { kind: 'aperture', seconds: 5.5, caption: 'Aperture' },
  { kind: 'focus', seconds: 5, caption: 'Focus' },
  { kind: 'zoom', seconds: 5, caption: 'Zoom' },
];
/** The part each tour step shows solid inside the wire body (the lab's step targets). */
export const CAMERA_PARTS = { capture: 'shutter', aperture: 'aperture', focus: 'focusGroup', zoom: 'zoomGroup' };

/**
 * The studio act, in order (r10, Kent: "cycle through soft butterfly, hard butterfly, soft Rembrandt, hard Rembrandt,
 * soft split, hard split", then Kent: Butterfly in place of Loop): six beats, a setup shown soft and then hard. Soft to hard keeps the lamp where
 * it is and shrinks it (the lab's size glide); hard to the next setup glides the lamp to its new place and
 * grows it back to Soft on the way. The caption names the beat as it lands. `hold` is seconds after landing.
 * Positions are measured on the landing stage (the eyes near y 0.5, the crown near 1.1) and are r8/r9's
 * for Rembrandt and Split (Butterfly is probed on the camera axis): the soft lamp is 2.4 wide, so each setup sits about twice as far from the
 * head as before, the panel clear of the face and of the bust from the act's camera (lampprobe, lampedge).
 * Holds: 3.5 s for the first (its first second is the cross-blur in), then 3 s each; the last runs through
 * the cross-blur out.
 */
export const STUDIO_SEQUENCE = [
  { name: 'Soft butterfly', setup: 'Butterfly', light: 'soft', position: [0, 2.9, 1.1], hold: 3.5 }, // on the camera axis, high above the brow: the small shadow under the nose, even cheeks (butterfly probes: the Soft panel clears the crown and the frame at 390 and 1440)
  { name: 'Hard butterfly', setup: 'Butterfly', light: 'hard', position: [0, 2.9, 1.1], hold: 3 },
  { name: 'Soft Rembrandt', setup: 'Rembrandt', light: 'soft', position: [2.0, 1.8, 1.4], hold: 3 }, // 45 degrees round, above the eyes: the lit cheek triangle
  { name: 'Hard Rembrandt', setup: 'Rembrandt', light: 'hard', position: [2.0, 1.8, 1.4], hold: 3 },
  { name: 'Soft split', setup: 'Split', light: 'soft', position: [2.2, 1.3, 0.4], hold: 3 }, // to the side, a little above the eyes: half the face
  { name: 'Hard split', setup: 'Split', light: 'hard', position: [2.2, 1.3, 0.4], hold: 3 },
];

export const K = {
  CAPTION_DESCRIBE: 'Describe',
  T1_MS: 1000, T2_MS: 1000, T3_MS: 1000,

  // ---- Camera act: the lens study on a slow turntable (about 4 deg/s), one path
  // through evenly spaced keys, still only at its ends, from the act's opening (the
  // poster's pose) on through the cross-blur out. The iris anchor moves with it so the
  // whole body stays centered. Poses are for a 4:5 window; the director scales
  // distances for a wider one.
  // Kent, October 20, 2026 ("This angle"): the app's Explore three-quarter view from above, about 30 degrees down and
  // 40 degrees round from the lens axis (the lab's own lensView azimuth -40, elevation 30). The turntable drifts a few
  // degrees round it so the act still moves.
  TURNTABLE: [
    { azimuth: -54, elevation: 31, distance: 12.4, anchorX: 0.66 }, // review 2: the solid opening framed out, clear of the options and caption
    { azimuth: -44.7, elevation: 30.3, distance: 12.2, anchorX: 0.64 }, // Kent, October 20: the orbit 1.5x faster, a 28 deg sweep centered on his angle
    { azimuth: -35.3, elevation: 29.7, distance: 12, anchorX: 0.62 },
    { azimuth: -26, elevation: 29, distance: 11.8, anchorX: 0.6 },
  ],
  CAMERA_ANCHOR_Y: 0.58, // the iris a little low in the window: the options sit top left
  // r9 (#951's shorter phone window, 0.9 of its width): the iris lower still on a phone, so the body clears the
  // options' last line by at least 16 px (edges.cjs at 390: 19 px) and its foot stays above the caption.
  CAMERA_ANCHOR_Y_PHONE: 0.65,
  XRAY_S: 1.2, // the solid body dissolves to its wire sketch as the first tour step opens
  EXPOSURE_S: 2.4, // the lab's shutter cycle (scene.js shoot)
  APERTURE_STOPS: [3, 0, 6, 3], // open up, stop all the way down, back
  FOCUS_CURVE: [[0.08, 0.5], [0.33, 0], [0.68, 1], [0.94, 0.5]], // [share of the beat, focus]
  ZOOM_CURVE: [[0.08, 0.5], [0.4, 1], [0.75, 0], [0.94, 0.5]], // [share of the beat, zoom]

  // ---- Studio act: the lamp moves round the bust while the camera orbits slowly (Kent: "slowly
  // orbiting"), about 1.4 deg/s from near head-on (Butterfly reads frontal) round to the bust's side.
  STUDIO_SHIFT_Y: -0.04, // reframe: the subject a little low, room above for the lamp
  STUDIO_ZOOM: 0.7, // a portrait (phone) window: r9, the big Soft lamp stays on the screen with 8 px or more to spare at every setup and glide (lampedge.cjs at 390: 12 px at Loop)
  STUDIO_ZOOM_WIDE: 0.76, // a landscape window: the canvas fit is by height, so the bust comes down clear of the caption
  // r8 (Kent: "tilted down a little bit, looking at the face"): the camera 10 deg above the face,
  // aimed STUDIO_AIM_Y above the bust's middle so the orbit turns round the face.
  STUDIO_AIM_Y: 0.3,
  ORBIT: [
    { azimuth: 10, elevation: 10, zoom: 1.22 },
    { azimuth: 3, elevation: 10, zoom: 1.21 },
    { azimuth: -4, elevation: 10, zoom: 1.2 },
    { azimuth: -11, elevation: 10, zoom: 1.2 },
    { azimuth: -18, elevation: 10, zoom: 1.2 },
    { azimuth: -25, elevation: 10, zoom: 1.2 }, // review 2: at -35 Split read as behind the head
  ],
  LIGHT_MOVE_S: 2.2, // r10: the lamp's glide to the next setup (six beats in 25 s)
  LIGHT_SIZE_S: 0.7, // the lab's Soft/Hard size glide (lighting.js LANDING_SIZE_MS), a fixed 700 ms
  LIGHT_GROW_AT: 0.5, // the share of a move after which the lamp starts growing back to Soft, so it is Soft before it lands
  LIGHT_ID: 'light-1',
  // The lamp's width (the app's `size`, its height 1.25 times that): Kent, "soft and hard
  // which increases / decreases the size of the light".
  LIGHT_SIZE: { soft: 2.4, hard: 0.35 }, // r8, Kent: "make the soft light much, much bigger"

  // ---- Studio lens slider (r10, Kent: "a slider with a lens mm there. 24-200"): the app's lens ruler
  // (studio_scene.dart studioLensDetents), its default the Studio's 50 mm. The lab's `focalLength` command.
  LENS_DETENTS: [24, 35, 50, 85, 135, 200],
  LENS_DEFAULT: 50,

  // ---- Describe (the Feel act): the photo, then the app's own dot animation (roll in, one loop
  // across, roll out), a cross-blur to the result held (the Flutter demo keeps its own clock; its photo,
  // dots and result holds are set for this act in lib/landing/describe_demo.dart).
  DESCRIBE_READING_S: 3.5, // D2 from the act's start (the app's dot animation, 13.6 s)
  DESCRIBE_RESULT_S: 17.1, // D3 from the act's start (then the four words, one open at a time, to the act's end)
};
// Each act runs from the cross-blur that brings it in; the camera's comes at the end of
// the previous loop, so the loop is the three acts and the camera opens at t = 0.
K.T1_AT = ACT_SECONDS.camera - BLUR_S;
K.T2_AT = K.T1_AT + ACT_SECONDS.studio;
K.T3_AT = K.T2_AT + ACT_SECONDS.describe;
K.TOTAL = K.T3_AT + K.T3_MS / 1000; // the loop, the three acts end to end
K.STUDIO_AT = K.T1_AT; // the studio moves from its cross-blur in
K.DESCRIBE_AT = K.T2_AT;
K.DESCRIBE_READING_AT = K.T2_AT + K.DESCRIBE_READING_S;
K.DESCRIBE_RESULT_AT = K.T2_AT + K.DESCRIBE_RESULT_S;
// Loading cues: each lab loads and primes off stage well before its cross-blur in.
K.PRELOAD_STUDIO_AT = K.T1_AT - 7;
K.UNLOAD_CAMERA_AT = K.T1_AT + 2;
K.PRELOAD_DESCRIBE_AT = K.T1_AT + 2.5;
K.PRELOAD_CAMERA_AT = K.T3_AT - 5;
K.CAMERA_START = K.TURNTABLE[0];
K.STUDIO_START = K.ORBIT[0];
K.LIGHT_START = STUDIO_SEQUENCE[0].position;

/** Spread evenly over [from, to]: keys {t, v} for a list of values. */
const spread = (values, from, to) => values.map((v, i) => ({ t: +(from + ((to - from) * i) / (values.length - 1)).toFixed(3), v }));

/** The camera act's beats laid end to end from t = 0: [{kind, caption, start, end}]. */
export const CAMERA_BEATS = (() => {
  let at = 0;
  return CAMERA_SEQUENCE.map((b) => { const out = { ...b, start: at, end: at + b.seconds }; at += b.seconds; return out; });
})();
/**
 * The studio act's beats laid out from its cross-blur in: [{name (the caption), setup, light, position,
 * from (the glide or shrink starts), at (landed: the caption), until, moves (the lamp travels to get here)}].
 * A move takes LIGHT_MOVE_S, a shrink LIGHT_SIZE_S.
 */
export const STUDIO_SETUPS = (() => {
  let at = K.STUDIO_AT;
  return STUDIO_SEQUENCE.map((beat, i, all) => {
    const moves = i > 0 && all[i - 1].setup !== beat.setup;
    const glide = i === 0 ? 0 : moves ? K.LIGHT_MOVE_S : K.LIGHT_SIZE_S;
    const landed = at + glide;
    const until = i === all.length - 1 ? K.T2_AT + K.T2_MS / 1000 : landed + beat.hold;
    const out = { ...beat, from: at, at: landed, until, moves };
    at = until;
    return out;
  });
})();

/** The options in the window, per act (Kent's sketch: the selected one is an ink block). The studio has the lens slider instead (r10). */
export const OPTIONS = {
  camera: { label: 'Camera', action: 'model', items: [['film', 'Film SLR'], ['mirrorless', 'Mirrorless'], ['dslr', 'DSLR']] },
};
export const DEFAULT_CHOICE = { camera: 'film' };
/** The command a lab's option sends. */
export function choiceCommand(lab, choice) {
  if (lab === 'camera') return { action: 'model', value: choice };
  return null;
}

/**
 * Track mapping (r10, Kent: "The focal length should not have hard stops. Should just smooth"): the six marks stay
 * evenly spaced as plain ruler ticks and the value is interpolated linearly between them, so the track feels even
 * across the range and no mark pulls or snaps the value. x is the track fraction 0..1; the value is whole mm, 24..200.
 */
export function lensAtFraction(x, marks = K.LENS_DETENTS) {
  const n = marks.length - 1, p = Math.min(1, Math.max(0, x)) * n, i = Math.min(n - 1, Math.floor(p));
  return Math.round(marks[i] + (marks[i + 1] - marks[i]) * (p - i));
}
/** The inverse: the track fraction 0..1 for a length in mm. */
export function lensFraction(mm, marks = K.LENS_DETENTS) {
  const n = marks.length - 1, v = Math.min(marks[n], Math.max(marks[0], mm));
  let i = 0;
  while (i < n - 1 && v > marks[i + 1]) i++;
  return (i + (v - marks[i]) / (marks[i + 1] - marks[i])) / n;
}
/**
 * The studio lens slider (r10): the lab commands for a lens: its `lens` zoom, then its own `focalLength` (millimeters).
 * Outside a lesson the lab does not dolly for the lens (lighting.js fitView fits at 50 mm), so the length changes the
 * magnification as the app's Studio lab does.
 */
export function lensCommands(mm) {
  const { LENS_DETENTS: d } = K;
  const f = Math.min(d[d.length - 1], Math.max(d[0], Math.round(mm)));
  // The Studio lab's catalog (lighting_camera.js) has no 24-200 lens outside a lesson page: its 24-70 and 70-200 zooms
  // (both f/2.8, the landing opens at f/4) cover the range, so the lens is picked first and the length then set.
  return [{ action: 'lens', value: f <= 70 ? 'zoom-24-70' : 'zoom-70-200' }, { action: 'focalLength', value: f }];
}
/** The readout for a lens, and the slider's aria-valuetext: "85 mm". */
export const lensText = (mm) => `${Math.round(mm)} mm`;

/**
 * The view window's zoom buttons (r9, Kent: "Add zoom controls for the labs."): a multiplier on the
 * tour's own framing, kept per lab for the session. Each tap glides one STEP over MS (InkUI
 * AnimationTokens.normal); the tour keeps running under it.
 */
export const VIEW_ZOOM = {
  STEP: 1.15, // domain: one tap of the landing zoom buttons
  MS: 300, // AnimationTokens.normal
  RANGE: { camera: [0.75, 2], studio: [0.75, 2] }, // domain: landing view zoom per lab
};
/** The zoom one tap in (dir 1) or out (dir -1) from zoom, clamped to the lab's range; null for a lab with none. */
export function nextZoom(lab, zoom, dir) {
  const range = VIEW_ZOOM.RANGE[lab];
  if (!range || !Number.isFinite(zoom) || (dir !== 1 && dir !== -1)) return null;
  // On the step grid (STEP to a whole power), so taps out and back in return to exactly 1.
  const n = Math.round(Math.log(Math.max(zoom, 1e-6)) / Math.log(VIEW_ZOOM.STEP)) + dir;
  return +Math.min(range[1], Math.max(range[0], VIEW_ZOOM.STEP ** n)).toFixed(4);
}
/** The command for a view zoom (ms 0: at once, as a prime sends it). */
export function zoomCommand(zoom, ms = VIEW_ZOOM.MS) {
  return { action: 'viewZoom', value: { zoom, ms } };
}

const s = (ms) => ms / 1000;

export const BEATS = [
  ...CAMERA_BEATS.map((b, i) => ({ id: `C${i + 1}`, channel: 'camera', start: b.start, duration: Math.min(b.end, K.T1_AT) - b.start, caption: b.caption,
    ...(CAMERA_PARTS[b.kind] ? { commands: [{ at: 0, action: 'part', value: CAMERA_PARTS[b.kind] }] } : {}) })),
  { id: 'T1', channel: 'page', start: K.T1_AT, duration: 1,
    events: [{ at: 0, type: 'transition', id: 'T1', from: 'camera', to: 'studio', ms: K.T1_MS }] },
  // Each beat's name arrives with the light, as it lands (review 1: it changed mid-glide).
  ...STUDIO_SETUPS.map((p, i) => ({ id: `S${i + 1}`, channel: 'lighting', start: p.at,
    duration: (i === STUDIO_SETUPS.length - 1 ? K.T2_AT : STUDIO_SETUPS[i + 1].at) - p.at,
    caption: p.name })),
  { id: 'T2', channel: 'page', start: K.T2_AT, duration: 1,
    events: [{ at: 0, type: 'transition', id: 'T2', from: 'studio', to: 'describe', ms: K.T2_MS }] },
  { id: 'D1', channel: 'describe', start: K.DESCRIBE_AT, duration: K.DESCRIBE_READING_AT - K.DESCRIBE_AT, caption: K.CAPTION_DESCRIBE,
    events: [{ at: 0, type: 'describe', phase: 'photo' }] },
  { id: 'D2', channel: 'describe', start: K.DESCRIBE_READING_AT, duration: K.DESCRIBE_RESULT_AT - K.DESCRIBE_READING_AT, caption: K.CAPTION_DESCRIBE,
    events: [{ at: 0, type: 'describe', phase: 'reading' }] },
  { id: 'D3', channel: 'describe', start: K.DESCRIBE_RESULT_AT, duration: K.T3_AT - K.DESCRIBE_RESULT_AT,
    caption: K.CAPTION_DESCRIBE, events: [{ at: 0, type: 'describe', phase: 'result' }] },
  { id: 'T3', channel: 'page', start: K.T3_AT, duration: K.T3_MS / 1000,
    events: [{ at: 0, type: 'transition', id: 'T3', from: 'describe', to: 'camera', ms: K.T3_MS }] },
  // Loading cues for the page (zero-length).
  { id: 'P-studio', channel: 'page', start: K.PRELOAD_STUDIO_AT, duration: 0,
    events: [{ at: 0, type: 'preload', target: 'studio' }] },
  { id: 'P-unload-camera', channel: 'page', start: K.UNLOAD_CAMERA_AT, duration: 0,
    events: [{ at: 0, type: 'unload', target: 'camera' }] },
  { id: 'P-describe', channel: 'page', start: K.PRELOAD_DESCRIBE_AT, duration: 0,
    events: [{ at: 0, type: 'preload', target: 'describe' }] },
  { id: 'P-camera', channel: 'page', start: K.PRELOAD_CAMERA_AT, duration: 0,
    events: [{ at: 0, type: 'preload', target: 'camera' }] },
];

// Which lab owns input at time t. null during transitions and Describe.
const LAB_WINDOWS = [
  { lab: 'camera', from: 0, to: K.T1_AT },
  { lab: 'studio', from: K.T1_AT + s(K.T1_MS), to: K.T2_AT },
];
// Which act's options the window shows at t: from the cross-blur that brings the act
// in to the one that takes it out. Describe has none.
const OPTION_WINDOWS = [
  { act: 'camera', from: 0, to: K.T1_AT },
  { act: 'studio', from: K.T1_AT, to: K.T2_AT },
  { act: 'camera', from: K.T3_AT, to: Infinity },
];
export function optionsAt(t) {
  return OPTION_WINDOWS.find((w) => t >= w.from && t < w.to)?.act ?? null;
}
// When each renderer draws: from its cue (loaded and primed off stage) until its
// cross-blur out has ended. Off these windows it is paused (it is not on screen).
const STAGE_WINDOWS = {
  camera: [{ from: 0, to: K.T1_AT + s(K.T1_MS) }, { from: K.PRELOAD_CAMERA_AT, to: Infinity }],
  studio: [{ from: K.PRELOAD_STUDIO_AT, to: K.T2_AT + s(K.T2_MS) }],
};
// Nothing locks renderer input in this tour (round 7 has no reveal flight).
const LOCK_WINDOWS = { camera: [], studio: [] };

// ---- Tracks ---------------------------------------------------------------

const apertureValue = (stop) => 1 - stop / 6; // apertureValueForStopIndex
const beatOf = (kind) => CAMERA_BEATS.find((b) => b.kind === kind);

// The x-ray: 0 the solid body, 1 its wire sketch round the lens (scene.js landing `xray`).
// It rises as the first tour step (the first beat with a part) opens.
const firstStep = CAMERA_BEATS.find((b) => CAMERA_PARTS[b.kind]);
const xrayKeys = (() => {
  if (!firstStep) return [{ t: 0, v: 0 }];
  if (firstStep.start <= 0) return [{ t: 0, v: 1 }];
  return [{ t: 0, v: 0 }, { t: firstStep.start, v: 0 }, { t: firstStep.start + K.XRAY_S, v: 1 }];
})();
/** The part the camera opens on (primed with the solid body, so the dissolve shows it). */
const firstPart = firstStep ? CAMERA_PARTS[firstStep.kind] : 'aperture';
// The shutter cycle (0 closed and cocked, 1 the second curtain down) runs once the wire body is in.
const exposureKeys = (() => {
  const b = beatOf('capture');
  if (!b) return [{ t: 0, v: 0 }];
  const go = b.start + (b === firstStep ? K.XRAY_S : 0) + 0.3;
  return [{ t: 0, v: 0 }, { t: go, v: 0 }, { t: Math.min(b.end, go + K.EXPOSURE_S), v: 1, ease: 'linear' }];
})();
const apertureKeys = (() => {
  const b = beatOf('aperture');
  return b ? spread(K.APERTURE_STOPS.map(apertureValue), b.start + 0.4, b.end - 0.4) : [{ t: 0, v: apertureValue(K.APERTURE_STOPS[0]) }];
})();
const curveKeys = (kind, curve) => {
  const b = beatOf(kind);
  return b ? curve.map(([x, v]) => ({ t: +(b.start + x * b.seconds).toFixed(3), v })) : [{ t: 0, v: 0.5 }];
};
const focusKeys = curveKeys('focus', K.FOCUS_CURVE);
const zoomKeys = curveKeys('zoom', K.ZOOM_CURVE);
// The lamp: holds each setup (soft then hard, in place), glides to the next (one timed lightTo each).
const lightKeys = STUDIO_SETUPS.flatMap((p, i) => (i === 0
  ? [{ t: 0, v: p.position }, { t: p.until, v: p.position }]
  : p.moves
    ? [{ t: p.at, v: p.position, glide: true }, { t: p.until, v: p.position }]
    : [{ t: p.until, v: p.position }]));
// The lamp's width (r10): a hard beat shrinks it where it stands (sent as the beat's glide starts); a move grows it
// back to Soft part-way along (each size command is the lab's own 700 ms glide, composing with the move).
const sizeKeys = (() => {
  const { soft, hard } = K.LIGHT_SIZE, keys = [{ t: 0, v: soft }];
  STUDIO_SETUPS.forEach((p, i) => {
    if (i === 0) return;
    if (p.light === 'hard') keys.push({ t: p.from, v: soft }, { t: p.at, v: hard, glide: true });
    else {
      const send = +(p.from + K.LIGHT_GROW_AT * K.LIGHT_MOVE_S).toFixed(3);
      keys.push({ t: send, v: hard }, { t: +(send + K.LIGHT_SIZE_S).toFixed(3), v: soft, glide: true });
    }
  });
  return keys;
})();

// A path track (mode 'path') sends one poseTo {path} as its key `pathFrom` is reached:
// the renderer runs it as one move through the later keys with continuous speed
// (pose_glide.js preparePath); trackAt reads the same curve back for a glide-back.
export const TRACKS = {
  'camera.pose': { channel: 'camera', mode: 'path', action: 'poseTo', pathFrom: 0, keys: spread(K.TURNTABLE, 0, K.T1_AT + s(K.T1_MS)) },
  'camera.xray': { channel: 'camera', mode: 'tick', action: 'xray', window: [0, K.T1_AT], keys: xrayKeys },
  'camera.aperture': { channel: 'camera', mode: 'tick', action: 'aperture', window: [apertureKeys[0].t, K.T1_AT], keys: apertureKeys },
  'camera.exposure': { channel: 'camera', mode: 'tick', action: 'exposure', window: [exposureKeys[0].t, K.T1_AT], keys: exposureKeys },
  'camera.focus': { channel: 'camera', mode: 'tick', action: 'focus', window: [focusKeys[0].t, K.T1_AT], keys: focusKeys },
  'camera.zoom': { channel: 'camera', mode: 'tick', action: 'zoom', window: [zoomKeys[0].t, K.T1_AT], keys: zoomKeys },
  'studio.pose': { channel: 'lighting', mode: 'path', action: 'poseTo', pathFrom: 0, keys: spread(K.ORBIT, K.STUDIO_AT, K.T2_AT + s(K.T2_MS)) },
  'studio.light1': { channel: 'lighting', mode: 'glide', action: 'lightTo', extra: { id: K.LIGHT_ID }, valueKey: 'position', keys: lightKeys },
  'studio.size': { channel: 'lighting', mode: 'glide', action: 'size', bare: true, keys: sizeKeys }, // bare: the command's value is the width itself
};

const ease = {
  linear: (x) => x,
  smooth: (x) => x * x * (3 - 2 * x),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
};

function lerpV(a, b, x) {
  if (typeof a === 'number') return a + (b - a) * x;
  if (Array.isArray(a)) return a.map((n, i) => n + (b[i] - n) * x);
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k] + (b[k] - a[k]) * x;
  return out;
}

// The renderer's path curve (web/teaching3d/pose_glide.js preparePath/samplePath,
// which the hosted page cannot import from here): a monotone cubic Hermite per key
// with Fritsch-Butland tangents, still at both ends. `azimuth` turns the short way.
const wrapDeg = (d) => (((d + 180) % 360) + 360) % 360 - 180;
export function pathValue(keys, t) {
  const at = keys.map((k) => k.t);
  let i = 0;
  while (i < at.length - 2 && t > at[i + 1]) i++;
  const h = at[i + 1] - at[i], x = h > 0 ? Math.min(1, Math.max(0, (t - at[i]) / h)) : 1, x2 = x * x, x3 = x2 * x;
  const out = {};
  for (const name of Object.keys(keys[0].v)) {
    const y = [keys[0].v[name]];
    for (let j = 1; j < keys.length; j++) {
      const v = keys[j].v[name];
      y.push(name === 'azimuth' ? y[j - 1] + wrapDeg(v - y[j - 1]) : v);
    }
    const tangent = (j) => {
      if (j === 0 || j === keys.length - 1) return 0;
      const h0 = at[j] - at[j - 1], h1 = at[j + 1] - at[j];
      const d0 = (y[j] - y[j - 1]) / h0, d1 = (y[j + 1] - y[j]) / h1;
      return d0 * d1 > 0 ? (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1) : 0;
    };
    const v = (2 * x3 - 3 * x2 + 1) * y[i] + (x3 - 2 * x2 + x) * h * tangent(i) + (-2 * x3 + 3 * x2) * y[i + 1] + (x3 - x2) * h * tangent(i + 1);
    out[name] = name === 'azimuth' ? wrapDeg(v) : v;
  }
  return out;
}

/** Value of a track at time t (held before the first and after the last key). */
export function trackAt(name, t, tracks = TRACKS) {
  const tr = tracks[name], keys = tr.keys;
  if (tr.mode === 'path') {
    const from = tr.pathFrom ?? 0, path = keys.slice(from);
    if (t >= path[0].t && t <= path[path.length - 1].t) return pathValue(path, t);
  }
  if (t <= keys[0].t) return lerpV(keys[0].v, keys[0].v, 0);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const span = b.t - a.t;
      const x = span <= 0 ? 1 : (t - a.t) / span;
      return lerpV(a.v, b.v, (ease[b.ease] ?? ease.smooth)(x));
    }
  }
  const last = keys[keys.length - 1];
  return lerpV(last.v, last.v, 0);
}

export const beatAt = (t) =>
  BEATS.filter((b) => b.duration > 0 && b.channel !== 'page' && t >= b.start && t < b.start + b.duration).pop() ?? null;

export function captionAt(t) {
  const b = beatAt(t);
  return b?.caption ?? null;
}

export function labAt(t) {
  const w = LAB_WINDOWS.find((x) => t >= x.from && t < x.to);
  return w ? w.lab : null;
}

/**
 * The three acts the act dots stand for (round 9): the page's own name for each, and
 * the time the act's cross-blur in begins (the camera's is the loop's start).
 */
export const ACTS = [
  { id: 'camera', label: 'Camera', at: 0 },
  { id: 'studio', label: 'Studio', at: K.T1_AT },
  { id: 'describe', label: 'Feel', at: K.T2_AT },
];

/** The act that owns the window at t, from the cross-blur that brings it in. */
export function actAt(t) {
  if (t >= K.T3_AT) return 'camera';
  if (t >= K.T2_AT) return 'describe';
  if (t >= K.T1_AT) return 'studio';
  return 'camera';
}

/** Whether lab ('camera'|'studio') is drawing at t (loaded, primed or on screen). */
export function onStage(lab, t) {
  return (STAGE_WINDOWS[lab] ?? []).some((w) => t >= w.from && t < w.to);
}

export function isLocked(lab, t) {
  return (LOCK_WINDOWS[lab] ?? []).some((w) => t >= w.from && t < w.to);
}

export const poseTrackFor = (lab) => (lab === 'camera' ? 'camera.pose' : 'studio.pose');

/** The pose a lab should glide back to at time t, as a poseTo value (without ms). */
export function poseAt(lab, t) {
  return trackAt(poseTrackFor(lab), t);
}

/**
 * Flat, time-sorted schedule: {at, kind: 'beat'|'command'|'event', ...}.
 * Commands carry `channel` ('camera'|'lighting') naming the bridge.
 */
export function buildSchedule(beats = BEATS, tracks = TRACKS) {
  const items = [];
  for (const b of beats) {
    items.push({ at: b.start, kind: 'beat', beat: b });
    const channel = b.channel === 'camera' || b.channel === 'lighting' ? b.channel : null;
    for (const c of b.commands ?? []) {
      items.push({ at: b.start + c.at, kind: 'command', channel, action: c.action, value: c.value });
    }
    for (const e of b.events ?? []) items.push({ at: b.start + e.at, kind: 'event', event: e, beat: b });
  }
  for (const tr of Object.values(tracks)) {
    if (tr.mode === 'path') {
      const from = tr.pathFrom ?? 0;
      items.push({ at: tr.keys[from].t, kind: 'command', channel: tr.channel, action: tr.action, value: pathCommand(tr, tr.keys[from].t) });
      continue;
    }
    if (tr.mode !== 'glide' && !tr.keys.some((k) => k.glide)) continue;
    for (let i = 1; i < tr.keys.length; i++) {
      const to = tr.keys[i];
      if (!to.glide) continue;
      const from = tr.keys[i - 1];
      const ms = Math.round((to.t - from.t) * 1000);
      const value = tr.bare ? to.v : tr.valueKey ? { ...tr.extra, [tr.valueKey]: to.v, ms } : { ...to.v, ms };
      items.push({ at: from.t, kind: 'command', channel: tr.channel, action: tr.action, value });
    }
  }
  return items.sort((a, b) => a.at - b.at);
}

/**
 * A path track's poseTo from time t on: {path: [{at (ms after t), ...pose}]}, the keys
 * still ahead (the renderer starts it from the pose on screen). null once it has ended.
 */
export function pathCommand(tr, t) {
  const ahead = tr.keys.slice(tr.pathFrom ?? 0).filter((k) => k.t > t + 1e-6);
  if (!ahead.length) return null;
  return { path: ahead.map((k) => ({ at: Math.round((k.t - t) * 1000), ...k.v })) };
}

/** The path track that moves a lab ('camera'|'studio') at t, if one is mid-way. */
export function pathTrackAt(lab, t, tracks = TRACKS) {
  const tr = tracks[poseTrackFor(lab)];
  if (tr?.mode !== 'path') return null;
  const keys = tr.keys.slice(tr.pathFrom ?? 0);
  return t >= keys[0].t && t < keys[keys.length - 1].t ? tr : null;
}

/** Tick-sampled scalar tracks: [{name, channel, action, window}]. */
export const tickTracks = (tracks = TRACKS) =>
  Object.entries(tracks).filter(([, t]) => t.mode === 'tick').map(([name, t]) => ({ name, ...t }));

/** The camera lab's window box (fractions of its canvas), with the iris anchor. */
export function cameraBox(box, anchorX = K.CAMERA_START.anchorX) {
  const b = box ?? { x: 0, y: 0, width: 1, height: 1 };
  return { x: b.x, y: b.y, width: b.width, height: b.height, anchorX: +anchorX.toFixed(4), anchorY: (b.aspect ?? 0) > 0 && b.aspect <= 1.2 ? K.CAMERA_ANCHOR_Y_PHONE : K.CAMERA_ANCHOR_Y };
}

/** The studio's reframe for its window: the clear box is the window's height band of the canvas. */
export function studioFrame(box) {
  const b = box ?? { x: 0, y: 0, width: 1, height: 1 };
  const fit = +(1 - b.y).toFixed(4), floor = +Math.max(0, 1 - b.y - b.height).toFixed(4);
  const zoom = (b.aspect ?? 0) > 1.2 ? K.STUDIO_ZOOM_WIDE : K.STUDIO_ZOOM;
  return { shiftY: K.STUDIO_SHIFT_Y, zoom, fit, floor, aimY: K.STUDIO_AIM_Y };
}

/**
 * A lab's opening state, sent when its page loads (off stage, and again each
 * loop), so its first frame on the stage is the start of its act: the camera's
 * lens study at the turntable's first pose (solid, as the poster), the studio's
 * opening pose and first setup. `box` is the view window in the canvas
 * (fractions); `choice` the visitor's option; `lens` the studio's focal length, mm (default K.LENS_DEFAULT).
 */
export function primeCommands(lab, { box, choice, zoom, lens } = {}) {
  // The visitor's zoom for this lab, at once (the reloaded page starts at 1).
  const zoomed = Number.isFinite(zoom) && zoom !== 1 ? [zoomCommand(zoom, 0)] : [];
  if (lab === 'camera') {
    const { anchorX, ...pose } = K.CAMERA_START;
    return [
      ...zoomed,
      { action: 'lessonViewport', value: cameraBox(box, anchorX) },
      { action: 'model', value: choice ?? DEFAULT_CHOICE.camera },
      { action: 'lensView', value: pose },
      { action: 'part', value: firstPart },
      { action: 'xray', value: xrayKeys[0].v },
      { action: 'exposure', value: exposureKeys[0].v },
      { action: 'aperture', value: apertureKeys[0].v },
      { action: 'focus', value: focusKeys[0].v },
      { action: 'zoom', value: zoomKeys[0].v },
    ];
  }
  if (lab !== 'studio') return [];
  return [
    ...zoomed,
    { action: 'framing', value: 'portrait' },
    { action: 'reframe', value: studioFrame(box) },
    { action: 'poseTo', value: { ...K.STUDIO_START, ms: 0 } },
    { action: 'lightTo', value: { id: K.LIGHT_ID, position: K.LIGHT_START, ms: 0 } },
    { action: 'size', value: K.LIGHT_SIZE.soft },
    ...lensCommands(lens ?? K.LENS_DEFAULT),
  ];
}

/**
 * Reduced motion: commands that put a lab at its key still (instant, no glides).
 * Camera: the x-ray lens study, the aperture part open and focus mid. Studio: soft Rembrandt.
 */
export function stillCommands(lab, { box, choice, zoom, lens } = {}) {
  const zoomed = Number.isFinite(zoom) && zoom !== 1 ? [zoomCommand(zoom, 0)] : [];
  if (lab === 'camera') {
    const { anchorX, ...pose } = trackAt('camera.pose', K.T1_AT / 2);
    return [
      ...zoomed,
      { action: 'lessonViewport', value: cameraBox(box, anchorX) },
      { action: 'model', value: choice ?? DEFAULT_CHOICE.camera },
      { action: 'lensView', value: pose },
      { action: 'part', value: 'aperture' },
      { action: 'xray', value: 1 },
      { action: 'exposure', value: 0 },
      { action: 'aperture', value: apertureValue(2) },
      { action: 'focus', value: 0.5 },
      { action: 'zoom', value: 0.5 },
    ];
  }
  const rembrandt = STUDIO_SETUPS.find((p) => p.setup === 'Rembrandt' && p.light === 'soft') ?? STUDIO_SETUPS[0];
  return [
    ...zoomed,
    { action: 'framing', value: 'portrait' },
    { action: 'reframe', value: studioFrame(box) },
    { action: 'poseTo', value: { ...trackAt('studio.pose', rembrandt.at), ms: 0 } },
    { action: 'lightTo', value: { id: K.LIGHT_ID, position: rembrandt.position, ms: 0 } },
    { action: 'size', value: K.LIGHT_SIZE.soft },
    ...lensCommands(lens ?? K.LENS_DEFAULT),
  ];
}