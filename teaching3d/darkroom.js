// The darkroom bench: five flat-ink stations on one bench, one at a time.
// Cards, Trays, Enlarger, Negative and Print. Each station has one param.
import * as THREE from 'three';
import { photoMaterial } from './bench_photo.js';

export const STATIONS = Object.freeze(['cards', 'trays', 'enlarger', 'negative', 'print']);
export const PARAM_COUNT = Object.freeze({ cards: 3, trays: 3, enlarger: 5, negative: 5, print: 2 });
export const STRIP_STEPS = 7;

// Enlarger head height for a detent, and the projected image's half size.
export const headHeight = i => 1.3 + i * .35;
export const projection = i => (headHeight(i) - .06 - .45) * .3;
// A negative's density stops for a detent (-1 thin .. +1 dense).
export const densityStops = i => (i - 2) / 2;
// The strip step a detent marks.
export const stripStep = i => Math.round((i / 4) * (STRIP_STEPS - 1));

const POSES = {
  cards: { look: [0, .5, 0], dir: [.1, .35, 1], halfWidth: 2.1, halfHeight: 1.1 },
  trays: { look: [0, .3, 0], dir: [0, .8, 1], halfWidth: 2.4, halfHeight: 1.5 },
  enlarger: { look: [0, 1.4, 0], dir: [.15, .15, 1], halfWidth: 2.1, halfHeight: 1.85 },
  negative: { look: [0, 1.05, 0], dir: [0, .1, 1], halfWidth: 1.4, halfHeight: 1.55 },
  print: { look: [0, .2, 0], dir: [0, .9, 1], halfWidth: 2.3, halfHeight: 1.2 },
};

export function create(kit) {
  const group = new THREE.Group();
  let mode = 'cards';
  const params = { cards: 0, trays: 0, enlarger: 2, negative: 2, print: 0 };
  const stations = {};
  const live = []; // per-station update functions

  const bench = kit.box(8, .1, 3.4);
  bench.position.y = -.05;
  group.add(bench);

  function station(id, build) {
    const g = new THREE.Group();
    g.visible = id === mode;
    stations[id] = g;
    group.add(g);
    live.push(build(g, () => params[id]));
  }
  const smooth = (v, target, dt, rate = 8) => v + (target - v) * (1 - Math.exp(-dt * rate));

  // Cards: a 35 mm cartridge, a 120 spool and a 4x5 sheet holder.
  station('cards', (g, param) => {
    const items = [];
    const xs = [-1.4, 0, 1.4];
    const cartridge = new THREE.Group();
    const can = kit.cylinder(.3, .3, .95, { fill: 'muted' }); can.position.y = .475; cartridge.add(can);
    const cap = kit.cylinder(.12, .12, .14, { fill: 'muted' }); cap.position.y = 1.02; cartridge.add(cap);
    const leader = kit.rect(.6, .12, { fill: 'muted' }); leader.rotation.x = -Math.PI / 2; leader.position.set(.55, .01, .1); cartridge.add(leader);
    const spool = new THREE.Group();
    const core = kit.cylinder(.1, .1, .95); core.position.y = .475; spool.add(core);
    const wrap = kit.cylinder(.3, .3, .8, { fill: 'muted' }); wrap.position.y = .475; spool.add(wrap);
    for (const y of [.03, .92]) { const flange = kit.cylinder(.4, .4, .06); flange.position.y = y; spool.add(flange); }
    const holder = new THREE.Group();
    const sheet = kit.box(.95, 1.25, .09); sheet.position.y = .65; holder.add(sheet);
    const slide = kit.box(.95, .22, .11, { fill: 'ink' }); slide.position.y = 1.18; holder.add(slide);
    [cartridge, spool, holder].forEach((item, i) => { item.position.x = xs[i]; g.add(item); items.push(item); });
    const marker = kit.polygon([[-.14, .2], [.14, .2], [0, 0]], { fill: 'accent', edge: 'accent' });
    marker.position.set(0, 1.7, 0);
    g.add(marker);
    const lifts = [0, 0, 0];
    return dt => {
      const sel = param();
      items.forEach((item, i) => {
        lifts[i] = smooth(lifts[i], i === sel ? .3 : 0, dt);
        item.position.y = lifts[i];
      });
      marker.position.x = smooth(marker.position.x, xs[sel], dt);
      marker.position.y = 1.5 + lifts[sel];
    };
  });

  // Trays: developer, stop, fix; a print sheet dips into the chosen one.
  station('trays', (g, param) => {
    const xs = [-1.7, 0, 1.7], roles = ['warm', 'accent', 'sensor'];
    xs.forEach((x, i) => {
      const tray = kit.box(1.4, .14, 1.1); tray.position.set(x, .07, 0); g.add(tray);
      const liquid = kit.rect(1.2, .9, { fill: roles[i], edge: null, opacity: .6 });
      liquid.rotation.x = -Math.PI / 2; liquid.position.set(x, .145, 0); g.add(liquid);
    });
    const sheet = kit.rect(.9, 1.1, { fill: 'paper' });
    sheet.rotation.x = -Math.PI / 2;
    const image = kit.rect(.7, .85, { fill: 'ink', edge: null, opacity: .05 });
    image.position.z = .005;
    sheet.add(image);
    g.add(sheet);
    let sx = xs[0], sy = .8, shown = .05, clock = 0, prev = 0;
    return dt => {
      const step = param();
      if (step !== prev) { prev = step; clock = 0; }
      clock += dt;
      sx = smooth(sx, xs[step], dt, 5);
      const arrived = Math.abs(sx - xs[step]) < .05;
      sy = smooth(sy, arrived ? .2 : .8, dt, 4);
      const target = step === 0 ? Math.min(.9, .05 + clock * .3) : .9;
      shown = smooth(shown, target, dt, 3);
      sheet.position.set(sx, sy, 0);
      kit.setOpacity(image, shown);
    };
  });

  // Enlarger: the head slides up its column; the light cone and the projected
  // frame on the easel grow with it.
  station('enlarger', (g, param) => {
    const base = kit.box(2.4, .12, 1.8); base.position.set(0, .06, 0); g.add(base);
    const column = kit.cylinder(.07, .07, 3.1); column.position.set(-1.1, 1.6, 0); g.add(column);
    const head = new THREE.Group();
    const arm = kit.box(.9, .1, .12); arm.position.set(-.65, 0, 0); head.add(arm);
    const body = kit.box(.8, .55, .8); head.add(body);
    const lens = kit.cylinder(.16, .2, .25, { fill: 'muted' }); lens.position.y = -.4; head.add(lens);
    head.position.x = -.1;
    g.add(head);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), kit.material('fill', 'warm', .22));
    g.add(cone);
    const easel = kit.rect(1.5, 1.2, { fill: 'paper' }); easel.rotation.x = -Math.PI / 2; easel.position.set(-.1, .13, 0); g.add(easel);
    const lit = kit.rect(1, 1, { fill: 'warm', edge: 'ink', opacity: .55 }); lit.rotation.x = -Math.PI / 2; lit.position.set(-.1, .14, 0); g.add(lit);
    let h = headHeight(2);
    return dt => {
      h = smooth(h, headHeight(param()), dt, 6);
      head.position.y = h;
      const lensY = h - .52, height = lensY - .12, r = height * .3;
      cone.scale.set(r, height, r);
      cone.position.set(-.1, .12 + height / 2, 0);
      lit.scale.set(r * 2 * .8, r * 2 * .8, 1);
    };
  });

  // Negative: the lesson photo inverted, with a density strip and a marker.
  station('negative', (g, param) => {
    const frame = kit.box(2.1, 1.5, .06, { fill: 'muted' }); frame.position.set(0, 1.55, -.04); g.add(frame);
    const material = photoMaterial({ invert: 1 });
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(1.95, 1.3), material);
    photo.position.set(0, 1.55, 0); g.add(photo);
    const step = 2 / STRIP_STEPS * .95;
    const left = -(STRIP_STEPS * step) / 2 + step / 2;
    for (let i = 0; i < STRIP_STEPS; i++) {
      const v = 1 - i / (STRIP_STEPS - 1);
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(step * .94, .3),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v) }));
      patch.position.set(left + i * step, .55, 0);
      g.add(patch);
    }
    const outline = kit.rect(STRIP_STEPS * step + .04, .34, { fill: 'paper', edge: 'ink', opacity: .001 });
    outline.position.set(0, .55, 0); g.add(outline);
    const marker = kit.polygon([[-.12, -.18], [.12, -.18], [0, 0]], { fill: 'accent', edge: 'accent' });
    marker.position.set(0, .25, 0); g.add(marker);
    let stops = densityStops(2), mx = 0;
    return dt => {
      const i = param();
      stops = smooth(stops, densityStops(i), dt, 6);
      material.uniforms.stops.value = stops;
      mx = smooth(mx, left + stripStep(i) * step, dt, 8);
      marker.position.x = mx;
    };
  });

  // Print: a glass plate or a paper negative copies onto paper in a tray.
  station('print', (g, param) => {
    const trayX = 1.0, homeX = -1.3;
    const tray = kit.box(1.7, .12, 1.3); tray.position.set(trayX, .06, 0); g.add(tray);
    const liquid = kit.rect(1.5, 1.1, { fill: 'accent', edge: null, opacity: .35 });
    liquid.rotation.x = -Math.PI / 2; liquid.position.set(trayX, .125, 0); g.add(liquid);
    const printMat = photoMaterial({ opacity: 0 });
    const print = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .85), printMat);
    print.rotation.x = -Math.PI / 2; print.position.set(trayX, .135, 0); g.add(print);
    const flash = kit.rect(1.3, .95, { fill: 'warm', edge: null, opacity: 0 });
    flash.rotation.x = -Math.PI / 2; flash.position.set(trayX, .15, 0); g.add(flash);
    const srcMat = photoMaterial({ invert: 1 });
    const source = new THREE.Group();
    const slab = kit.box(1.3, .05, .95, { fill: 'sensor', opacity: .35 });
    const srcPhoto = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .85), srcMat);
    srcPhoto.rotation.x = -Math.PI / 2; srcPhoto.position.y = .03;
    source.add(slab, srcPhoto);
    g.add(source);
    const fibres = kit.line([[-.6, .04, -.2], [.1, .04, .3], [.5, .04, -.3]], 'line', .8);
    source.add(fibres);
    let phase = 0, prev = -1;
    const ease = p => p * p * (3 - 2 * p);
    return dt => {
      const kind = param();
      if (kind !== prev) {
        prev = kind; phase = 0;
        const paper = kind === 1;
        kit.setFill(slab, paper ? 'paper' : 'sensor');
        kit.setOpacity(slab, paper ? 1 : .35);
        fibres.visible = paper;
        srcMat.uniforms.contrast.value = paper ? .8 : 1;
        srcMat.uniforms.grain.value = paper ? .12 : 0;
        printMat.uniforms.contrast.value = paper ? .8 : 1.05;
        printMat.uniforms.grain.value = paper ? .12 : 0;
        printMat.uniforms.soft.value = paper ? .006 : 0;
      }
      phase = Math.min(1, phase + dt / 4);
      const slide = phase < .3 ? ease(phase / .3) : phase < .55 ? 1 : phase < .8 ? 1 - ease((phase - .55) / .25) : 0;
      source.position.set(homeX + (trayX - homeX) * slide, .03 + (slide > .98 ? .22 : .05 + slide * .2), 0);
      const fire = phase > .4 && phase < .5 ? 1 - Math.abs(phase - .45) / .05 : 0;
      kit.setOpacity(flash, fire * .6);
      flash.visible = fire > 0;
      printMat.uniforms.opacity.value = phase < .6 ? 0 : ease((phase - .6) / .4);
    };
  });

  return {
    group,
    pose: () => POSES[mode],
    state: () => ({ mode, params: { ...params } }),
    setMode(id) {
      if (!STATIONS.includes(id)) return;
      mode = id;
      for (const [key, g] of Object.entries(stations)) g.visible = key === id;
    },
    set(name, value) {
      if (!(name in params) || !Number.isFinite(value)) return;
      params[name] = Math.max(0, Math.min(PARAM_COUNT[name] - 1, Math.round(value)));
    },
    update(dt) { for (const f of live) f(dt); },
  };
}
