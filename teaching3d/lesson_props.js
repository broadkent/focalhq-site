// Scene props for the focal-length and perspective lessons (lesson=1, `props {on}`): a row of
// identical posts, evenly spaced on a diagonal behind the bust, off to one side, so the frame's width
// and the depth compression read at a glance (an even row's gaps close up on a long lens), or one
// grid window directly behind the bust. Low-poly boxes only, on a bare background: no wall, no
// floor (Kent, October 20, 2026).
//
// Kent, October 20, 2026: "No set behind the bust (no window-with-plant, wall texture or floor)."
// The lesson-8 window set lost its wall and floor first (#978); asked whether the lesson-9 posts
// set should too, Kent said yes. The posts set now has no far wall, no floor and no window: just the
// posts on the bare background. With no floor to stand on, posts that stopped short hung in mid-air
// like glitches (rendered check), so their bottoms run down out of every frame (postBottomY):
// solid pillars off the bottom edge, tops where they were, spacing and diagonal unchanged.
//
// Studio L2 review round 3 (October 19, 2026): the posts were tall bars cut by the frame at
// uneven gaps and the window sat beside the head, so they read as glitches. Now the posts are
// waist-high with their tops in frame and the window is far to the other side. (The contact
// bases were dropped in the props-recede pass below.)
//
// Studio L2 review (October 19, 2026): the wall was a box that ended inside the frame, so the
// picture read as a scene that failed to load. The wall now fills a 24 mm frame from any lesson
// distance, and a floor of the same tone runs from under the camera to the wall: one seamless
// sweep the posts stand on, with the window the only opening.
//
// Dark theme (aesthetic review, October 19, 2026): the tones mirror (1 - tone), so the sweep is
// the dark paper's own near-paper tone, as the light sweep is the light paper's.
//
// Look: props are flat, self-lit print tones, never lit by the lamps. They use the lamp
// indicator's flag (alpha .5 in the HDR buffer, drawn by lighting_optics.js as a plain tone,
// unscreened and without exposure), with tones from print_tones.js. So they stay readable at
// any lamp distance (no 1/d^2 falloff, no black), cast and receive no shadow, and are hidden
// from the exposure meter (lighting.js adds the group to `meteringHidden`).
import {PRINT_TONES} from './print_tones.js';

export const WORLD_UNITS_PER_METER = 3.2 / .6;
const m = meters => meters * WORLD_UNITS_PER_METER;

export const PROP_SPEC = Object.freeze({
  // Props-recede review (October 19, 2026): a straight row beside the bust read as a bar chart,
  // the window as an app glyph floating on the sweep, and the posts' floor pads as stair steps
  // at shoulder height. The row now runs on a diagonal, off to the viewer's right and back:
  // spread wide at 24 mm, stacked close at 135-200 mm. No pads; a wall plane of its own tone.
  // Close behind the bust, .55 m apart: comparable to the camera's distance at 24 mm (sizes
  // fall off nearly 3x along the row) and a small share of it at 200 mm (1.3x: the row stacks).
  postDistancesM: Object.freeze([.4, .95, 1.5, 2.05, 2.6]),
  postHeightM: .6,                                 // tops in frame at every lesson focal length
  postWidthM: .08,
  // The diagonal: x = postX + postSlope * depth (world units), to the viewer's right.
  // Chosen so the row clears the shoulders at 24 mm and stays inside a 200 mm frame.
  postX: 2.48,
  postSlope: .1,
  floorY: -1.45,                                   // the bust's base line (the window set's reference)
  // With no floor to stand on, a post that ends in mid-air hangs like a glitch, so the posts run
  // down out of every frame: the tops (the compression cue) stay where they were.
  postBottomY: -40,
  // Kent, October 20, 2026: no wall, floor or window behind the posts (bare background).
  window: null,
  // Window bars' thickness in z, and the window set's distance behind the bust.
  wallDistanceM: 10,
  wall: Object.freeze({depth: .2}),
  windowFrame: 2,
  windowSill: null,
  // Alternate posts alternate tone, so posts stacked by a long lens read one by one.
  postTone: PRINT_TONES[1],
  postAltTone: PRINT_TONES[0],
  // Far plane head room, world units, added only while props are on.
  farExtra: 40,
});

// The default lesson set (Kent, lesson 8 playtest, October 19, 2026: "the weird pillars to the
// side of our guy aren't super helpful ... maybe we need a plant in the window and the windows
// should be closer behind him"). No posts: a wall 1.1 m behind the bust's centre (about 1 m
// behind the head) with a framed window to the viewer's left and a potted plant on its sill.
// A 24 mm frame shows the whole window, a 200 mm frame part of it, with or without equal framing.
// The posts set (PROP_SPEC) stays for lesson 9, whose compression teaching is built on the row.
// Kent, October 20, 2026 (live playtest): no set behind the bust, no wall, floor, plant or sill;
// at most ONE very simple grid window directly behind it, on the bare background. `bare` builds
// the window alone, centered on the bust.
export const WINDOW_SET_SPEC = Object.freeze({
  ...PROP_SPEC,
  postDistancesM: Object.freeze([]),
  wallDistanceM: 1.1,
  wall: Object.freeze({depth: .2}),
  // A portrait window directly behind the bust. Its group turns with the camera's azimuth so it stays
  // centered (faces: the scored rounds view from +-12 degrees). The transom lies one frame (0.45)
  // above the crown, the pane below it is open (no mullion near the head) and the jambs stand well
  // outside the head: at 85-135 mm the window is out of frame and the background bare; at 24-50 mm
  // it shows round the head without touching it.
  faces: true,
  window: Object.freeze({x0: -4.3, x1: 4.3, y0: -3.6, y1: 7.4, transomY: 4, openBelow: true}),
  // A lighter ink than the posts: the window is a quiet mark on bare paper, not the darkest mass.
  windowTone: PRINT_TONES[2],
  windowFrame: .45,
  windowSill: null,
  plant: null,
});

/** The prop sets a lesson can show: `props {set}`. */
export const PROP_SETS = Object.freeze({window: WINDOW_SET_SPEC, posts: PROP_SPEC});

/** The window's frame round the opening and its cross: [centerX, centerY, width, height]. */
export function windowPieces({window: w, windowFrame: f}) {
  const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, width = w.x1 - w.x0, height = w.y1 - w.y0;
  if (w.transomY !== undefined) {
    // The transom at its own height; with an open pane below, the mullion stands above it only.
    const ty = w.transomY, top = w.y1 - f, from = ty + f / 2;
    return [
      [w.x0 + f / 2, cy, f, height],
      [w.x1 - f / 2, cy, f, height],
      [cx, w.y1 - f / 2, width, f],
      [cx, w.y0 + f / 2, width, f],
      [cx, ty, width, f],
      w.openBelow ? [cx, (from + top) / 2, f, top - from] : [cx, cy, f, height],
    ];
  }
  return [
    [w.x0 + f / 2, cy, f, height],          // left jamb
    [w.x1 - f / 2, cy, f, height],          // right jamb
    [cx, w.y1 - f / 2, width, f],           // head
    [cx, w.y0 + f / 2, width, f],           // bottom rail
    [cx, cy, f, height],                    // mullion
    [cx, cy, width, f],                     // transom
  ];
}

/** Post centers: [x, y, z] in world units. */
export function postPlaces(spec = PROP_SPEC) {
  const height = postHeight(spec);
  return spec.postDistancesM.map(d => [spec.postX + spec.postSlope * m(d), spec.postBottomY + height / 2, -m(d)]);
}

/** A post's full height, world units: from its top (floorY + postHeightM) down out of frame. */
export function postHeight(spec = PROP_SPEC) {return spec.floorY + m(spec.postHeightM) - spec.postBottomY;}

/** A prop tone on the theme's paper: as given on light paper, mirrored on dark. */
export function themedTone(tone, dark) {
  return dark ? 1 - tone : tone;
}

function flatMaterial(THREE, tone, dark) {
  const material = new THREE.MeshBasicMaterial({color: 0x808080});
  // The light-paper tone; the shown one follows the theme (retoneProps).
  material.userData.tone = tone;
  const shown = themedTone(tone, dark);
  material.color.setRGB(shown, shown, shown, THREE.SRGBColorSpace);
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a=0.5;');
  };
  material.customProgramCacheKey = () => 'focal-panel-indicator-v1';
  return material;
}

/** Sets every prop material to its tone on the theme's paper. */
export function retoneProps(group, dark) {
  group?.traverse(o => {
    const tone = o.material?.userData?.tone;
    if (typeof tone !== 'number') return;
    const t = themedTone(tone, dark);
    o.material.color.setRGB(t, t, t, 'srgb'); // THREE.SRGBColorSpace
  });
}

export function buildProps(THREE, spec = PROP_SPEC, dark = false) {
  const group = new THREE.Group();
  group.name = 'lessonProps';
  const post = flatMaterial(THREE, spec.postTone, dark);
  const box = (material, [x, y, z], [w, h, d]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);mesh.castShadow = false;mesh.receiveShadow = false;
    group.add(mesh);
  };
  const posts = new THREE.Group();posts.name = 'lessonPosts';group.add(posts);
  const into = target => (material, at, size) => {box(material, at, size);target.add(group.children.pop());};
  const postBox = into(posts);
  const alt = flatMaterial(THREE, spec.postAltTone, dark);
  for (const [i, place] of postPlaces(spec).entries()) postBox(i % 2 ? alt : post, place, [m(spec.postWidthM), postHeight(spec), m(spec.postWidthM)]);
  const z = -m(spec.wallDistanceM);
  const win = new THREE.Group();win.name = 'lessonWindow';group.add(win);
  const winBox = into(win);
  const winInk = spec.windowTone === undefined ? post : flatMaterial(THREE, spec.windowTone, dark);
  if (spec.window) for (const [x, y, w, h] of windowPieces(spec)) winBox(winInk, [x, y, z + spec.wall.depth / 2], [w, h, spec.wall.depth * 2]);
  const {x0, x1, y0} = spec.window ?? {}, sill = spec.windowSill;
  if (spec.window && sill) winBox(winInk, [(x0 + x1) / 2, y0 - sill.height / 2, z + sill.depth / 2], [x1 - x0 + sill.overhang * 2, sill.height, sill.depth]);
  if (spec.plant) {
    // On the sill's top, standing proud of the wall: a pot and five low-poly leaves.
    const plant = new THREE.Group();plant.name = 'lessonPlant';group.add(plant);
    const {x, pot, potHeight, leaf} = spec.plant, top = y0, at = z + sill.depth / 2;
    const potMesh = new THREE.Mesh(new THREE.CylinderGeometry(pot / 2, pot * .38, potHeight, 6), flatMaterial(THREE, spec.plantPotTone, dark));
    potMesh.position.set(x, top + potHeight / 2, at);plant.add(potMesh);
    const leafMaterial = flatMaterial(THREE, spec.plantLeafTone, dark);
    for (const [tilt, turn, scale] of [[0, 0, 1], [.5, -.4, .85], [-.5, .4, .85], [.85, .3, .7], [-.85, -.3, .7]]) {
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(leaf * .14, leaf * scale, 4), leafMaterial);
      mesh.geometry.translate(0, leaf * scale / 2, 0);
      mesh.position.set(x, top + potHeight * .9, at);
      mesh.rotation.set(turn * .3, turn, tilt);
      plant.add(mesh);
    }
    plant.traverse(o => {o.castShadow = false;o.receiveShadow = false;});
  }
  return group;
}

/**
 * `props {on, set?}`: builds a set's group on first use, adds it to the scene only while on. The
 * set is 'window' (the default) or 'posts' (lesson 9). A page without lesson=1 never builds
 * anything, whatever it is sent.
 */
export function createLessonProps({THREE, scene, lesson, sets = PROP_SETS, isDark = () => false}) {
  const groups = {};
  let shown = null, kind = 'window';
  return {
    get on() {return Boolean(shown?.parent);},
    get group() {return shown;},
    get kind() {return kind;},
    get farExtra() {return shown?.parent ? sets[kind].farExtra : 0;},
    /** Turns a set that faces about the bust (the origin) to the camera's azimuth. True when it moved. */
    face(camera) {
      const win = shown?.getObjectByName('lessonWindow');
      if (!win || !sets[kind].faces) return false;
      const a = Math.atan2(camera.position.x, camera.position.z);
      if (Math.abs(win.rotation.y - a) < 1e-9) return false;
      win.rotation.y = a;win.updateMatrixWorld(true);return true;
    },
    /** True when the scene changed. An unknown set name keeps the current one. */
    set(value, name = kind) {
      if (!lesson || typeof value !== 'boolean') return false;
      const next = typeof name === 'string' && sets[name] ? name : kind;
      if (value === this.on && (next === kind || !value)) return false;
      if (shown) scene.remove(shown);
      kind = next;
      if (!value) {shown = null;return true;}
      shown = groups[kind] ||= buildProps(THREE, sets[kind], isDark());
      retoneProps(shown, isDark());scene.add(shown);
      return true;
    },
    /** `props {posts:false}`: the sweep and window alone (lighting prints). True when it changed. */
    posts(visible) {
      const row = shown?.getObjectByName('lessonPosts');
      if (!row || row.visible === visible) return false;
      row.visible = visible;return true;
    },
    /** The theme changed: the props take the new paper's tones. */
    retone() {for (const group of Object.values(groups)) retoneProps(group, isDark());},
    dispose() {
      if (shown) scene.remove(shown);
      for (const group of Object.values(groups)) group.traverse(o => {o.geometry?.dispose();o.material?.dispose();});
      for (const key of Object.keys(groups)) delete groups[key];
      shown = null;
    },
  };
}
