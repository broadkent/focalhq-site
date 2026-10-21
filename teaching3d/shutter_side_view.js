// The shutter lesson's side view (Kent, October 11, 2026). After the front
// Watch, the renderer's own shutter and sensor stay; strictly in order, every
// other part of the x-ray body fades out, then the shutter and the sensor
// split apart along the lens axis while the view turns to a slightly angled
// side pose, and only then does the light show: one translucent volume from
// the lens side through the opening between the curtains onto the sensor.
// Pure timing and geometry here; scene.js applies them to its meshes.
import { clamp } from './capture.js';

// Phases, in playback seconds (Kent, October 11, 14:37: "move it over and
// then show the sensor separate back behind it so the user can stay
// oriented"): the body fades, then the view turns to the side pose with the
// sensor still against the shutter, then the sensor slides back to its gap.
// Each eased in and out, about one LessonMotion beat (0.7 s) each.
export const SIDE_FADE_SECONDS = .6, SIDE_TURN_SECONDS = .9, SIDE_SPLIT_SECONDS = .8;
export const SIDE_SECONDS = SIDE_FADE_SECONDS+SIDE_TURN_SECONDS+SIDE_SPLIT_SECONDS;
// Reduced motion: one short cross-fade straight to the side pose.
export const SIDE_REDUCED_SECONDS = .3;
// How far the shutter and the sensor stand apart in total, in model units.
// #382's gap was 1.3; Kent (14:38) asked for half to a third of it.
export const SIDE_SPLIT_382 = 1.3, SIDE_SPLIT_SCALE = .4;
export const SIDE_SPLIT = SIDE_SPLIT_382*SIDE_SPLIT_SCALE;
// The shutter holds still and the sensor slides back the whole gap, so the
// learner keeps the shutter they just watched where it was.
export const SIDE_SHUTTER_SHARE = 0;
// The side pose: the lens side at the left, the sensor at the right, a
// little above. #382 sat 55 degrees off the lens axis; Kent's own orbit
// (remark #393) sits further round, the shutter near edge-on and the
// sensor's face open toward the learner, so 62. Kent (15:08) wanted it even
// further to the side and level: 78. His own drag on the open/close page
// (16:30) landed nearer 60: vertically straight on, only a little angled, so
// the shutter reads as the light passes. Pitch stays 0, the camera at the
// sensor's height.
export const SIDE_YAW = 60*Math.PI/180, SIDE_PITCH = 0;
// The side pose dollies in: the pair fills about 70% of the frame (#382 and
// the front view: 57%), and the orbit centre sits this share of the way from
// the pair's middle toward the sensor, so the sensor is the nearer, larger
// plate (Kent's own orbit, remark #393).
export const SIDE_FILL = .7, SIDE_SENSOR_BIAS = .3;
// The pair stands tall at the side angle, so its height may fill more of the
// box than its width does (the callout hangs below it).
export const SIDE_FILL_Y = .95;
// The beam continues toward the lens past the shutter by this much, as the
// same rectangle, so it reads as one beam rather than a cone and a prism.
// Short, so it never runs off the left edge at the closer pose.
export const BEAM_LEAD = .18;
// One translucent volume in the exposure's warm light colour.
export const BEAM_OPACITY = .42;

const ease = p => { p = clamp(p); return p*p*(3-2*p); };

// Unit vector from the orbit target toward the side pose's camera
// (+z toward the lens, +x the camera's right side seen from the front).
export const sideViewDirection = () => [
  Math.sin(SIDE_YAW)*Math.cos(SIDE_PITCH), Math.sin(SIDE_PITCH), Math.cos(SIDE_YAW)*Math.cos(SIDE_PITCH)];

// The transition at `seconds` since it began: `fade` of the body, then
// `turn`, then `split` (each eased in and out, 0..1), `done` at the end.
// Never concurrent: the turn waits for the fade, the split for the turn.
export function sideViewPhase(seconds, out = {}) {
  out.fade = ease(seconds/SIDE_FADE_SECONDS);
  out.turn = ease((seconds-SIDE_FADE_SECONDS)/SIDE_TURN_SECONDS);
  out.split = ease((seconds-SIDE_FADE_SECONDS-SIDE_TURN_SECONDS)/SIDE_SPLIT_SECONDS);
  out.done = seconds >= SIDE_SECONDS;
  return out;
}

// Where the shutter and the sensor stand along the lens axis at split `p`
// (0 touching, 1 apart), as offsets from their rest positions.
export const splitOffsets = p => ({
  shutter: SIDE_SPLIT*SIDE_SHUTTER_SHARE*clamp(p),
  sensor: -SIDE_SPLIT*(1-SIDE_SHUTTER_SHARE)*clamp(p)});

// The side pose's orbit centre: the framed centre moved SIDE_SENSOR_BIAS of
// the way toward the sensor's centre (points as [x, y, z]).
export const biasedTarget = (centre, sensorCentre, bias = SIDE_SENSOR_BIAS) =>
  centre.map((c,i) => c+(sensorCentre[i]-c)*bias);

// The opening between the curtains, in rows of the frame (0 top, 1 bottom):
// the first curtain has uncovered rows above `first`, the second has covered
// rows above `second` again. Null while closed.
export function curtainWindow(first, second) {
  const top = clamp(second), bottom = clamp(first);
  return bottom > top ? {top, bottom} : null;
}

// The light volume for curtain positions `first`/`second`, as an axis-aligned
// box in the shutter's parent frame: its cross-section at the shutter plane is
// exactly the curtain window (`halfWidth` x `halfHeight` is the frame opening,
// rows running down from +halfHeight), it ends on the sensor face at
// `sensorZ` and reaches `lead` past the shutter plane `shutterZ` toward the
// lens. Null (nothing drawn) while the shutter is closed.
export function beamBox(first, second, {halfWidth, halfHeight, centerY = 0, shutterZ, sensorZ, lead = BEAM_LEAD}) {
  const open = curtainWindow(first, second);
  if (!open) return null;
  const h = 2*halfHeight;
  return {x0:-halfWidth, x1:halfWidth,
    y0:centerY+halfHeight-open.bottom*h, y1:centerY+halfHeight-open.top*h,
    z0:sensorZ, z1:shutterZ+lead};
}

// Reduced motion in the side view: no sweep. The whole window stands open for
// the shot's open time (from the first curtain starting until the second has
// landed), closed before and after.
export function reducedCurtains(front, back) {
  if (front <= 0) return {first:0, second:0};
  if (back >= 1) return {first:1, second:1};
  return {first:1, second:0};
}
