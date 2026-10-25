// The sync strip: the frame the two shutter curtains uncover, the flash above it and the photo the flash
// lights (the timeline math below places the flash against the curtains). At or below
// the sync speed the frame is fully open for a stretch and the flash lights all
// of it; above it no such stretch is left and a dark band shows.
import * as THREE from 'three';
import { photoMaterial } from './bench_photo.js';

// 1/250: one curtain's real travel, the unit of the timeline.
export const SYNC_TRAVEL = 1 / 250;
export const FLASH_POINTS = Object.freeze(['front', 'mid', 'rear']);

// Where the second curtain starts, in curtain travels. Gaps longer than one
// travel are compressed (log base 4) so one scale holds 1/4000 to 1 second.
export const secondStart = seconds => {
  const g = seconds / SYNC_TRAVEL;
  return g <= 1 ? g : 1 + Math.log(g) / Math.log(4);
};
// The flash's place on the timeline for a marker choice.
export const flashTime = (xs, point) =>
  point === 0 ? 1 : point === 2 ? xs : (1 + xs) / 2;
// The share of the frame (0 top .. 1 bottom) the flash lights.
export const litRows = (xs, xf) => ({
  lo: Math.min(1, Math.max(0, xf - xs)), hi: Math.min(1, Math.max(0, xf)),
});
// The dark share of the frame at the flash: 0 at or below the sync speed.
export const darkShare = (xs, xf) => {
  const { lo, hi } = litRows(xs, xf);
  return 1 - (hi - lo);
};

const X_MAX = 1 + secondStart(1);
// Two pictures, one above the other: the frame the curtains uncover, and the photo the flash lights.
const FRAME_Y = 1.5, PHOTO_Y = .15, PIC_W = 1.5, PIC_H = 1;

export function create(kit) {
  const group = new THREE.Group();
  const params = { seconds: SYNC_TRAVEL, flash: 0 };
  let clock = 0;

  // The frame in ink and paper only: an empty frame, the two ink curtains over it, and at rest the rows the flash
  // lit left as paper on the dark frame.
  const frameBase = kit.rect(PIC_W, PIC_H, { fill: 'paper' }); frameBase.position.set(0, FRAME_Y, 0); group.add(frameBase);
  const litBand = kit.rect(1, 1, { fill: 'line', edge: null }); group.add(litBand);
  const curtainOne = kit.rect(1, 1, { fill: 'ink', edge: null }); group.add(curtainOne);
  const curtainTwo = kit.rect(1, 1, { fill: 'ink', edge: null }); group.add(curtainTwo);
  const frameEdge = kit.rect(PIC_W, PIC_H, { fill: 'paper', edge: 'ink', opacity: .001 }); frameEdge.position.copy(frameBase.position); group.add(frameEdge);
  const placeRows = (mesh, lo, hi) => {
    mesh.visible = hi - lo > 1e-4;
    mesh.scale.set(PIC_W, Math.max(1e-4, (hi - lo) * PIC_H), 1);
    mesh.position.set(0, FRAME_Y + PIC_H / 2 - ((lo + hi) / 2) * PIC_H, .01);
  };
  // The flash above the frame: a filled ink lamp while it fires, an empty outline between.
  const flashHead = kit.cylinder(.16, .16, .03, { fill: 'paper', edge: 'ink' });
  flashHead.rotation.x = Math.PI / 2; flashHead.position.set(0, FRAME_Y + PIC_H / 2 + .4, 0); group.add(flashHead);

  // The photo the flash makes: the lesson photo, dark where the flash did not reach.
  const previewMat = photoMaterial({ opacity: 0 });
  const preview = new THREE.Mesh(new THREE.PlaneGeometry(PIC_W, PIC_H), previewMat);
  preview.position.set(0, PHOTO_Y, 0); group.add(preview);
  const previewEdge = kit.rect(PIC_W, PIC_H, { fill: 'paper', edge: 'ink', opacity: .001 }); previewEdge.position.copy(preview.position); group.add(previewEdge);

  const layout = () => {
    const xs = secondStart(params.seconds);
    return { xs, xf: flashTime(xs, params.flash) };
  };

  let cache = layout();
  const total = () => cache.xs + 1;
  let lit = false, rest = false;
  return {
    group,
    pose: () => ({ look: [0, 1.1, 0], dir: [0, 0, 1], halfWidth: 1.2, halfHeight: 1.75 }),
    state: () => ({
      mode: 'strip',
      params: { ...params },
      xs: cache.xs, dark: darkShare(cache.xs, cache.xf),
    }),
    setMode() {},
    set(name, value) {
      if (!Number.isFinite(value)) return;
      if (name === 'seconds') params.seconds = Math.max(1 / 4000, Math.min(1, value));
      if (name === 'flash') params.flash = Math.max(0, Math.min(2, Math.round(value)));
      cache = layout();
      clock = 0;
    },
    replay() { clock = 0; },
    update(dt) {
      clock += dt;
      const sweep = Math.min(1, clock / 2.6);
      const x = sweep * total();
      const { xs, xf } = cache;
      const c1 = Math.min(1, Math.max(0, x));
      const c2 = Math.min(1, Math.max(0, x - xs));
      placeRows(curtainOne, c1, 1);
      placeRows(curtainTwo, 0, c2);
      // At rest the curtains are away and the frame shows what the flash lit.
      const done = sweep >= 1;
      if (done) { curtainOne.visible = false; curtainTwo.visible = false; }
      if (done !== rest) { rest = done; kit.setFill(frameBase, done ? 'ink' : 'paper'); kit.setFill(litBand, done ? 'paper' : 'line'); }
      const fired = x >= xf;
      const { lo, hi } = litRows(xs, xf);
      const burst = fired && x - xf < .35 * (total() / X_MAX + .4);
      placeRows(litBand, lo, hi);
      litBand.visible = (burst || done) && hi - lo > 1e-4;
      if (burst !== lit) { lit = burst; kit.setFill(flashHead, burst ? 'ink' : 'paper'); }
      previewMat.uniforms.rowLo.value = lo;
      previewMat.uniforms.rowHi.value = hi;
      previewMat.uniforms.opacity.value += ((fired ? 1 : 0) - previewMat.uniforms.opacity.value) * (1 - Math.exp(-dt * 12));
    },
  };
}
