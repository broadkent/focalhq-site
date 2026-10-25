// The Studio's one scale: world units to meters, and the full-frame sensor. No three.js import,
// so node tests load it.
//
// Kent, October 22, 2026: "make the bust life size ... representative of what someone would see
// if they had a full frame camera at that focal length from the distances ... spatially accurate."
//
// The bust GLBs are authored life-size in meters (measured: the default Vitruvian study stands
// 0.4064 m, the young woman 0.4001 m, the young man 0.4000 m). The scene already draws the
// Vitruvian 3.2 world units tall and every authored scene literal (lamp places, props, framing
// floors) is written against that, so the scale is the one that keeps the Vitruvian exactly 3.2
// units: 1 m = 3.2 / 0.4064 = 7.874 units. Before this the bust was stretched to 3.2 units and the
// code assumed 1 m = 3.2 / 0.6 = 5.333 units, which made every bust 1.48 times its real size
// against anything measured in meters (defocus, the focus ruler, props, the lens).

/** The default bust's native height, meters (vitruvian-study.glb). */
export const VITRUVIAN_HEIGHT_M = 0.4064;
/** The young woman's native height, meters (young-woman.glb); the face pilots are fitted to it. */
export const YOUNG_WOMAN_HEIGHT_M = 0.4001;

/** World units in one meter. */
export const WORLD_UNITS_PER_METER = 3.2 / VITRUVIAN_HEIGHT_M;
export const metersToWorld = meters => meters * WORLD_UNITS_PER_METER;
export const worldToMeters = units => units / WORLD_UNITS_PER_METER;

/** A full-frame sensor, mm. The Studio's working frame is its 3:2 landscape. */
export const SENSOR_MM = Object.freeze({width: 36, height: 24});
/** The circle of confusion a full-frame print is judged sharp at, mm. */
export const COC_MM = 0.03;

/**
 * The filmGauge that keeps the field inside a 36 x 24 sensor at [aspect] (width / height). three.js
 * reads filmGauge as the film's LARGER dimension (width = gauge * min(aspect, 1), height = gauge /
 * max(aspect, 1)), so the short side is gauge / max(aspect, 1 / aspect): capped at 24 mm. Between
 * 2:3 and 3:2 the gauge shrinks (a square canvas is 24 x 24, 4:3 is 32 x 24); at 3:2 and beyond it
 * is the full 36, so the Studio's 3:2 frame is exactly 36 x 24.
 */
export function filmGaugeFor(aspect) {
  return Math.min(SENSOR_MM.width, SENSOR_MM.height * Math.max(aspect, 1 / aspect));
}

/** The film size three.js uses at [aspect] with filmGaugeFor(aspect), mm; never over 36 x 24 (or 24 x 36). */
export function filmSize(aspect) {
  const gauge = filmGaugeFor(aspect);
  return {
    width: gauge * Math.min(aspect, 1),
    height: gauge / Math.max(aspect, 1),
  };
}

/**
 * Makes [camera] a full-frame camera: three.js reads its field of view from the film gauge. Call
 * again when the camera's aspect changes.
 */
export function configureFullFrameCamera(camera, aspect = camera.aspect) {
  camera.filmGauge = filmGaugeFor(aspect);
  return camera;
}
/** The share of a sensor dimension ([sensorDimMm]) an object [sizeM] tall fills at [distanceM]. */
export const projectedFraction = (sizeM, focalMm, distanceM, sensorDimMm) =>
  sizeM * focalMm / (distanceM * sensorDimMm);

/**
 * Lessons that hold the head the same size as the lens changes (lesson 9, Perspective): the
 * default bust's head, chin to crown, meters (measured on vitruvian-study.glb), and the share of
 * the 24 mm frame height it fills. 0.40 (October 22, 2026): the 412 x 915 phone sheets showed
 * lesson 9's head at 0.27 of the canvas on the Watch pages, and 0.40 restores that exactly. The old
 * dolly took its rate from whatever distance the camera had at the first on, so the head drifted
 * between pages (0.50 on term and Remember pages); one true-scale distance per lens ends the drift
 * (term pages end up about 14% smaller than the strongest old page).
 */
export const EQUAL_FRAMING_HEAD_M = 0.2334;
export const EQUAL_FRAMING_HEAD_FRACTION = 0.40;

/** The camera-to-face distance, meters, that fills EQUAL_FRAMING_HEAD_FRACTION of the frame at [focalMm]. */
export const equalFramingDistanceM = focalMm =>
  EQUAL_FRAMING_HEAD_M * focalMm / (EQUAL_FRAMING_HEAD_FRACTION * SENSOR_MM.height);
