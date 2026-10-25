// The view camera: a flat-ink bellows camera on a rail. The front standard
// (lens) shifts on its post and tilts; the rear standard (ground glass) stays.
// A ground-glass inset shows the effect on a tower: shift keeps the walls
// straight while the framing rises, tilt makes them lean in.
import * as THREE from 'three';

const lerp = THREE.MathUtils.lerp;
export const SHIFT_LIMIT_MM = 30, TILT_LIMIT_DEG = 15;
// The page's content column, px: the view runs the window's width, the inset stays inside the column.
const COLUMN_PX = 640;
const STANDARD_H = 1.1, STANDARD_D = .9, REAR_X = -1.25, FRONT_X = .95, BASE_Y = 1.15;

// World height of the front standard's shift, and the inset's lens shift in
// normalised device units for the same millimetres.
export const shiftHeight = mm => mm * .012;
export const lensShift = mm => (mm / SHIFT_LIMIT_MM) * .55;
// The inset camera's pitch, radians, for a tilt in degrees.
export const insetPitch = deg => THREE.MathUtils.degToRad(deg) * .9;

export function create(kit, { glass }) {
  const group = new THREE.Group();
  const params = { shift: 0, tilt: 0 };
  const shown = { shift: 0, tilt: 0 };
  let mode = 'view';

  const rail = kit.box(3.4, .09, .16); rail.position.set(-.1, .5, 0); group.add(rail);
  for (const x of [REAR_X, FRONT_X]) {
    const post = kit.box(.14, .55, .3); post.position.set(x, .78, 0); group.add(post);
  }

  // A standard: a flat frame in the y-z plane of depth d and height h.
  function standard(withGlass) {
    const g = new THREE.Group();
    const bars = [[STANDARD_D, .08, 0, STANDARD_H / 2], [STANDARD_D, .08, 0, -STANDARD_H / 2],
      [.08, STANDARD_H, STANDARD_D / 2, 0], [.08, STANDARD_H, -STANDARD_D / 2, 0]];
    for (const [d, h, z, y] of bars) {
      const bar = kit.box(.08, h, d); bar.position.set(0, y, z); g.add(bar);
    }
    if (withGlass) {
      const pane = kit.rect(STANDARD_D - .1, STANDARD_H - .1, { fill: 'line', edge: null });
      pane.rotation.y = Math.PI / 2; g.add(pane);
    }
    return g;
  }
  const rear = standard(true); rear.position.set(REAR_X, BASE_Y, 0); group.add(rear);
  const front = standard(false); group.add(front);
  const lens = kit.cylinder(.22, .3, .45, { fill: 'muted' }); lens.rotation.z = Math.PI / 2; lens.position.x = .25; front.add(lens);
  const board = kit.box(.06, .5, .5); front.add(board);

  // The bellows: pleated sides between the two standards. Each fold is a ring of four corners, scaled out
  // and in alternately, so the sides zigzag like an accordion; the faces tilting toward the viewer print in
  // the mid tone, the others in solid ink, and every crease is an ink line: solid folds, not a fence.
  const FOLDS = 7;
  const RINGS = FOLDS + 2;
  const FACES = RINGS - 1;
  const makeSide = (count, fill) => {
    const positions = new Float32Array(count * 4 * 6 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geometry, kit.material('fill', fill));
    mesh.frustumCulled = false; group.add(mesh);
    return { positions, geometry };
  };
  const lit = makeSide(Math.ceil(FACES / 2), 'muted'), shaded = makeSide(Math.floor(FACES / 2), 'ink');
  const foldPositions = new Float32Array(RINGS * 4 * 2 * 3);
  const foldGeometry = new THREE.BufferGeometry();
  foldGeometry.setAttribute('position', new THREE.BufferAttribute(foldPositions, 3));
  const folds = new THREE.LineSegments(foldGeometry, kit.material('line', 'ink'));
  folds.frustumCulled = false;
  group.add(folds);
  // The pleat's scale about the bellows' axis: ends are the standards' size, folds go out and in.
  const pleat = k => (k === 0 || k === RINGS - 1 ? 1 : k % 2 ? 1.22 : .9);

  const corners = (x, y, tilt, h, d) => {
    const c = Math.cos(tilt), s = Math.sin(tilt), out = [];
    for (const [dy, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const ly = dy * h / 2;
      out.push(new THREE.Vector3(x - s * ly, y + c * ly, dz * d / 2));
    }
    return out;
  };

  function layout() {
    const tilt = THREE.MathUtils.degToRad(shown.tilt);
    const fy = BASE_Y + shiftHeight(shown.shift);
    front.position.set(FRONT_X, fy, 0);
    front.rotation.z = tilt;
    const a = corners(REAR_X, BASE_Y, 0, STANDARD_H - .1, STANDARD_D - .1);
    const b = corners(FRONT_X, fy, tilt, STANDARD_H - .1, STANDARD_D - .1);
    // Ring k: the corners at its share of the way, scaled about the line between the standards' centres.
    const rings = [];
    for (let k = 0; k < RINGS; k++) {
      const u = k / (RINGS - 1);
      const centre = new THREE.Vector3(lerp(REAR_X, FRONT_X, u), lerp(BASE_Y, fy, u), 0);
      rings.push(a.map((v, i) => {
        const point = new THREE.Vector3().lerpVectors(v, b[i], u);
        return point.sub(centre).multiplyScalar(pleat(k)).add(centre);
      }));
    }
    const cursor = [0, 0];
    for (let k = 0; k < RINGS - 1; k++) {
      const side = k % 2 ? shaded : lit, which = k % 2;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        for (const v of [rings[k][i], rings[k + 1][i], rings[k + 1][j], rings[k][i], rings[k + 1][j], rings[k][j]]) {
          side.positions[cursor[which]++] = v.x; side.positions[cursor[which]++] = v.y; side.positions[cursor[which]++] = v.z;
        }
      }
    }
    lit.geometry.attributes.position.needsUpdate = true;
    shaded.geometry.attributes.position.needsUpdate = true;
    let p = 0;
    for (const ring of rings) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        for (const v of [ring[i], ring[j]]) { foldPositions[p++] = v.x; foldPositions[p++] = v.y; foldPositions[p++] = v.z; }
      }
    }
    foldGeometry.attributes.position.needsUpdate = true;
  }

  // The ground-glass scene: a tower with a window grid on the front, a horizon.
  const inset = new THREE.Scene();
  const tower = kit.box(1.3, 3.4, 1.3); tower.position.set(0, 1.7, 0); inset.add(tower);
  for (let row = 0; row < 7; row++) {
    for (let col = -1; col <= 1; col++) {
      const w = kit.rect(.28, .26, { fill: 'accent', edge: null });
      w.position.set(col * .38, .4 + row * .45, .66); inset.add(w);
    }
  }
  const ground = kit.line([[-8, 0, 0], [8, 0, 0]], 'ink'); inset.add(ground);
  const neighbour = kit.box(1, 1.4, 1, { fill: 'muted' }); neighbour.position.set(-2.2, .7, -.5); inset.add(neighbour);
  const insetCamera = new THREE.PerspectiveCamera(36, 1, .1, 60);
  insetCamera.position.set(0, 1.5, 8);
  const insetBack = new THREE.Color();
  const refreshInset = () => { insetBack.set(kit.palette.line).lerp(new THREE.Color(kit.palette.bg), .6); inset.background = insetBack; };
  refreshInset();

  function afterRender(renderer, size) {
    glass.style.display = mode === 'view' ? 'block' : 'none';
    const column = Math.min(size.w, COLUMN_PX);
    const side = Math.round(Math.min(column * .36, size.h * .36));
    const x = Math.round((size.w + column) / 2) - side - 8, y = 8;
    Object.assign(glass.style, { left: x + 'px', top: y + 'px', width: side + 'px', height: side + 'px' });
    insetCamera.rotation.x = insetPitch(shown.tilt);
    insetCamera.aspect = 1;
    insetCamera.updateProjectionMatrix();
    insetCamera.projectionMatrix.elements[9] = lensShift(shown.shift);
    insetCamera.projectionMatrixInverse.copy(insetCamera.projectionMatrix).invert();
    renderer.setScissorTest(true);
    renderer.setScissor(x, size.h - y - side, side, side);
    renderer.setViewport(x, size.h - y - side, side, side);
    renderer.autoClear = true;
    renderer.render(inset, insetCamera);
    renderer.setScissorTest(false);
  }

  layout();
  return {
    group,
    pose: () => ({ look: [-.1, 1.3, 0], dir: [.2, .5, 1], halfWidth: 2.3, halfHeight: 1.7 }),
    state: () => ({ mode, params: { ...params } }),
    setMode(id) { if (id === 'view') mode = id; },
    set(name, value) {
      if (!Number.isFinite(value)) return;
      if (name === 'shift') params.shift = Math.max(-SHIFT_LIMIT_MM, Math.min(SHIFT_LIMIT_MM, value));
      if (name === 'tilt') params.tilt = Math.max(-TILT_LIMIT_DEG, Math.min(TILT_LIMIT_DEG, value));
    },
    update(dt) {
      const k = 1 - Math.exp(-dt * 10);
      shown.shift += (params.shift - shown.shift) * k;
      shown.tilt += (params.tilt - shown.tilt) * k;
      layout();
    },
    afterRender,
    recolour: refreshInset,
  };
}
