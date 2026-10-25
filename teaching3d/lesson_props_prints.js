// Lesson 9's set (Kent, October 21, 2026): photo prints hung on sagging wires behind the bust,
// scattered the way they would be in a darkroom: three wires at different depths, heights and
// angles, two or three prints on each at uneven gaps, every sheet turned, tilted and gently curled.
//
// What teaches compression is the depth: the wires sit .35 to 2.2 m behind the bust, so the prints are
// small and spread at 24 mm and large and stacked at 200 mm.
//
// True scale (Kent, October 22, 2026): everything here is a real object in meters, converted by `m`:
// 8 x 10 inch prints, wires 0.2-2.3 m up and .35-2.2 m behind the bust, a hand-span of sag. The depths
// are the old ones (world units) stretched by the real equal-framing distance (about 1.25x the old
// dolly), so the spread and the sizes read as they did.
//
// Lit, not flat (Kent, October 21, 2026: "the objects going back should be darker as they go back,
// mostly because of the fall off"). Sheets, borders, photos and wires are lit standard materials, so
// the lamps' falloff darkens what is farther back and the pieces stay separate. The border is a
// step brighter than the photo.
//
// The photos are Kent's own (@broadkent), reduced to 36 x 46 gray pixels (assets/studio/prints) so
// the Studio's halftone reads them as coarse dot pictures. A texture drawn through the screen is
// cheaper and more faithful to the Studio's own dots than the Learn print pipeline, which prepares
// full photographs as a halftone of its own and would be screened twice.
import {SENSOR_MM, metersToWorld, equalFramingDistanceM} from './world_scale.js';

// A real 8 x 10 inch print (0.203 x 0.254 m), bordered like a darkroom sheet. Everything here is
// authored in meters and converted by `m` (world_scale.js), so it holds at true scale.
export const PRINT_SIZE_M = Object.freeze({w: .203, h: .254, border: .012});
export const PRINT_PHOTO_COUNT = 7;
const PHOTO_SIZE = [36, 46];
// A floor of the paper's own tone under the lamps' light, so a print far from the lamp is dimmer, not black.
const GLOW = .3;
// The paper border's tone on the ink stage (sRGB gray), about the photos' mean.
export const STAGE_BORDER_GRAY = .5;

/** Deterministic noise: the layout never changes between builds. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wires: depth in meters behind the bust at the left and right end, the height of each end
// above the bust's origin and the sag, all in meters. Each wire runs over the head, high, and comes down beside it toward one side, so
// at no lens does a wire cross the head and neck (clearance test); the prints hang from the low
// side. The ends are placed past the 24 mm frame at their depth (wireEndX), so a wire always leaves
// the frame and never stops inside it.
export const WIRES = Object.freeze([
  Object.freeze({dLeft: .75, dRight: .35, yLeft: 1.25, yRight: .30, sag: .13}),
  Object.freeze({dLeft: 1.0, dRight: 1.45, yLeft: .25, yRight: 1.78, sag: .165}),
  Object.freeze({dLeft: 2.2, dRight: 1.7, yLeft: 2.3, yRight: .35, sag: .19}),
]);

// Prints: the wire, x along it (meters), scale, yaw and roll (radians), curl shape, photo.
// Uneven on purpose: no two gaps match and no two sheets hang alike.
export const PRINTS = Object.freeze([
  Object.freeze({wire: 0, x: .30, scale: 1.0, yaw: -.5, roll: .06, curl: 'bow', photo: 0}),
  Object.freeze({wire: 0, x: .53, scale: .85, yaw: .5, roll: -.09, curl: 'corner', photo: 1}),
  Object.freeze({wire: 1, x: -.5, scale: 1.1, yaw: .2, roll: .04, curl: 'edge', photo: 2}),
  Object.freeze({wire: 1, x: -.78, scale: .9, yaw: -.55, roll: -.07, curl: 'wave', photo: 3}),
  Object.freeze({wire: 2, x: .62, scale: 1.0, yaw: .4, roll: .1, curl: 'cornerLeft', photo: 4}),
  Object.freeze({wire: 2, x: .95, scale: .85, yaw: -.15, roll: -.05, curl: 'bow', photo: 5}),
  Object.freeze({wire: 2, x: 1.4, scale: 1.05, yaw: -.45, roll: .08, curl: 'edge', photo: 6}),
]);
/**
 * Past the widest (24 mm, equal-framing) frame at this depth, so a wire's end is never in view:
 * the half width the 36 mm sensor sees at the 24 mm equal-framing distance plus the wire's depth
 * (world units), with a quarter to spare.
 */
export function wireEndX(zWorld) {
  const halfFrame = SENSOR_MM.width / 2 / 24;
  return 1.25 * halfFrame * (metersToWorld(equalFramingDistanceM(24)) + Math.abs(zWorld));
}

/** A wire's sag at 0-1 along it: 0 at both ends, `sag` at the middle, a catenary's cosh. */
export function sagAt(s, sag) {
  const k = 2.6;
  return sag * (Math.cosh(k / 2) - Math.cosh(k * (s - .5))) / (Math.cosh(k / 2) - 1);
}

/** One wire's geometry as a function of x: depth z, height y. `m` is meters to world units. */
export function wireFrame(wire, m) {
  const zl = -m(wire.dLeft), zr = -m(wire.dRight);
  const xl = -wireEndX(zl), xr = wireEndX(zr);
  const at = s => {
    const x = xl + (xr - xl) * s, z = zl + (zr - zl) * s;
    const y = m(wire.yLeft + (wire.yRight - wire.yLeft) * s - sagAt(s, wire.sag));
    return [x, y, z];
  };
  return {xl, xr, at, s: x => (x - xl) / (xr - xl)};
}

/** A curl: how far a point of the sheet lifts toward the lens. u across (-.5 to .5), v down (0 to 1). */
const CURLS = {
  bow: (u, v) => .14 * (1 - 4 * u * u) * (.5 + .5 * v),
  corner: (u, v) => .4 * Math.pow(Math.max(0, (u + .5) * v - .3) / .7, 1.6),
  cornerLeft: (u, v) => .4 * Math.pow(Math.max(0, (.5 - u) * v - .3) / .7, 1.6),
  edge: (u, v) => .3 * Math.pow(Math.max(0, v - .45) / .55, 2.2) + .04 * (1 - 4 * u * u),
  wave: (u, v) => .11 * Math.sin(v * Math.PI * 1.8) + .04 * (1 - 4 * u * u),
};

/**
 * A sheet's surface, `inset` meters in from the paper's edge on every side, displaced by a curl so a
 * print is never flat. Hangs from its clip (origin) down the -y axis.
 */
export function sheetGeometry(THREE, m, curl, size = PRINT_SIZE_M, inset = 0, gap = .012) {
  const {w, h} = size, fn = CURLS[curl] ?? CURLS.bow;
  const u0 = -.5 + inset / w, u1 = .5 - inset / w, v0 = inset / h, v1 = 1 - inset / h;
  const geo = new THREE.PlaneGeometry(1, 1, 8, 10), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = u0 + (pos.getX(i) + .5) * (u1 - u0), v = v0 + (.5 - pos.getY(i)) * (v1 - v0);
    pos.setXYZ(i, u * m(w), -m(gap) - v * m(h), fn(u, v) * m(w));
  }
  geo.computeVertexNormals();
  return geo;
}

/** The wire: a thin tube along its sagging curve. */
export function buildWire(THREE, m, wire, material) {
  const {at} = wireFrame(wire, m);
  const points = [];
  for (let i = 0; i <= 40; i++) points.push(new THREE.Vector3(...at(i / 40)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, m(.0045), 4), material);
  mesh.castShadow = false;mesh.receiveShadow = false;
  return mesh;
}

function photoUrl(index) {
  return new URL(`../assets/assets/studio/prints/p${index}.png`, import.meta.url).href;
}

/** Every lit material the set uses; the photos load later and call `invalidate` as each arrives. */
export function printMaterials(THREE, {invalidate, load = typeof document !== 'undefined'} = {}) {
  const lit = (gray, extra = {}) => new THREE.MeshStandardMaterial({color: new THREE.Color().setRGB(gray, gray, gray, THREE.SRGBColorSpace), roughness: 1, metalness: 0, emissive: new THREE.Color().setRGB(gray, gray, gray, THREE.SRGBColorSpace), emissiveIntensity: GLOW, ...extra});
  const paper = lit(.96, {side: THREE.DoubleSide});
  // On the ink stage (studio_stage.js) the border prints near the photos' own tone: white, its thin strip read
  // as a bright marquee round each print against the falloff-dimmed photos (aesthetic review, October 21, 2026).
  paper.userData.stageGray = STAGE_BORDER_GRAY;
  const wire = lit(.4);
  const photos = [];
  for (let i = 0; i < PRINT_PHOTO_COUNT; i++) {
    // A tonal print until the photo arrives, a step darker than the border.
    const material = lit(.7, {polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
    if (load) {
      const texture = new THREE.TextureLoader().load(photoUrl(i), () => {
        material.color.setRGB(.86, .86, .86, THREE.SRGBColorSpace);
        material.map = texture;material.emissiveMap = texture;material.needsUpdate = true;invalidate?.();
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      // The 1 px white edge baked into each image is cropped: the paper provides the border.
      texture.repeat.set((PHOTO_SIZE[0] - 2) / PHOTO_SIZE[0], (PHOTO_SIZE[1] - 2) / PHOTO_SIZE[1]);
      texture.offset.set(1 / PHOTO_SIZE[0], 1 / PHOTO_SIZE[1]);
    }
    photos.push(material);
  }
  return {paper, wire, photos};
}

/** The whole set: wires and prints, in one group. */
export function buildPrintSet(THREE, m, options = {}) {
  const group = new THREE.Group();
  group.name = 'lessonPrints';
  const mats = printMaterials(THREE, options);
  const sheets = new Map();
  const geometry = (curl, inset) => {
    const key = `${curl}:${inset}`;
    if (!sheets.has(key)) sheets.set(key, sheetGeometry(THREE, m, curl, PRINT_SIZE_M, inset));
    return sheets.get(key);
  };
  const wires = options.wires ?? WIRES, prints = options.prints ?? PRINTS;
  const frames = wires.map(wire => wireFrame(wire, m));
  for (const wire of wires) group.add(buildWire(THREE, m, wire, mats.wire));
  for (const print of prints) {
    const frame = frames[print.wire], [x, y, z] = frame.at(frame.s(m(print.x)));
    const hang = new THREE.Group();
    hang.position.set(x, y, z);
    hang.rotation.set(0, print.yaw, print.roll, 'YXZ');
    hang.scale.setScalar(print.scale);
    const paper = new THREE.Mesh(geometry(print.curl, 0), mats.paper);
    const image = new THREE.Mesh(geometry(print.curl, PRINT_SIZE_M.border), mats.photos[print.photo % PRINT_PHOTO_COUNT]);
    image.position.z = m(.0012);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(m(.03), m(.034), m(.014)), mats.wire);
    clip.position.set(0, -m(.002), m(.002));
    hang.add(paper, image, clip);
    group.add(hang);
  }
  group.traverse(o => {o.castShadow = false;o.receiveShadow = false;});
  return group;
}
