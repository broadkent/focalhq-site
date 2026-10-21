// Landing demo director: a clock-driven player for the scripted tour.
// Plain ES module. Time, rAF and the renderers are injected, so it runs in
// node tests with a fake clock and fake bridges.
//
// Bridge interface (one per lab, keys 'camera' and 'lighting'):
//   { send(action, value), onState(cb) -> unsubscribe }
// The real postMessage envelope is isolated in createFrameBridge() below.

import {
  K, BEATS, TRACKS, buildSchedule, tickTracks, trackAt, labAt, isLocked,
  poseAt, stillCommands, primeCommands, captionAt, onStage, pathTrackAt, pathCommand,
  OPTIONS, DEFAULT_CHOICE, choiceCommand, optionsAt, cameraBox, studioFrame, ACTS, actAt,
  nextZoom, zoomCommand, lensCommands,
} from './timeline.js';

/** The ONLY place that knows the postMessage envelope (host_bridge.js, camera_3d_embed_web.dart:78). */
export function createFrameBridge(iframe, kind, { origin = globalThis.location?.origin, win = globalThis } = {}) {
  const listeners = new Set();
  let last = null;
  // r9: a reload keeps the same contentWindow, so the page being replaced can still answer (a stale "ready"
  // that primed the old page and showed the new one unprimed). From expectReload() until the frame's load
  // event, nothing it says is heard; the host's getState poll asks the new page again.
  let stale = false;
  iframe.addEventListener?.('load', () => { stale = false; });
  const onMessage = (event) => {
    if (stale || event.source !== iframe.contentWindow || typeof event.data !== 'string') return;
    let m;
    try { m = JSON.parse(event.data); } catch { return; }
    if (m?.channel !== 'focal-teaching3d' || m.version !== 1 || m.type !== 'state' || m.kind !== kind) return;
    last = m.state;
    for (const cb of [...listeners]) cb(m.state);
  };
  win.addEventListener('message', onMessage);
  return {
    kind,
    get state() { return last; },
    expectReload() { stale = true; last = null; },
    send(action, value) {
      iframe.contentWindow?.postMessage(JSON.stringify({
        channel: 'focal-teaching3d', version: 1, type: 'command', kind, action, value,
      }), origin);
    },
    onState(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    destroy() { win.removeEventListener('message', onMessage); listeners.clear(); },
  };
}

const SCALAR_EPS = 0.002;
// Seconds: a frame gap longer than this (a throttled or backgrounded tab) is cut
// so the timeline does not leap; a slow phone (down to 2 fps) keeps real time.
export const MAX_DT = 0.5;

/** The window aspect the timeline's camera poses are framed for (4:5). */
export const POSE_ASPECT = 0.8;
/** The closest a wide window brings the camera (a share of the 4:5 distance): the body is height-bound there. */
/** r9: a window this narrow or narrower is a phone's (the wide one is 1.55). */
export const PHONE_ASPECT_MAX = 1.2;
export const MIN_DISTANCE_SCALE = 0.7; // review 1: at .8 the body was half the 1440 window's height

export class Director {
  /**
   * @param {object} o
   * @param {{camera, lighting}} o.bridges
   * @param {() => number} [o.now]  ms
   * @param {(cb) => any} [o.raf]
   * @param {(id) => void} [o.cancelRaf]
   * @param {boolean} [o.reducedMotion]  no autoplay; use showStill()
   * @param {number} [o.aspect]  stage width / height; a wider stage brings the camera closer
   */
  constructor({ bridges, now, raf, cancelRaf, reducedMotion = false, beats = BEATS, tracks = TRACKS, aspect = POSE_ASPECT } = {}) {
    this.bridges = bridges;
    this.now = now ?? (() => performance.now());
    this.raf = raf ?? ((cb) => requestAnimationFrame(cb));
    this.cancelRaf = cancelRaf ?? ((id) => cancelAnimationFrame(id));
    this.reducedMotion = reducedMotion;
    this.tracks = tracks;
    this.schedule = buildSchedule(beats, tracks);
    this.ticks = tickTracks(tracks);
    this.total = K.TOTAL;
    this.setAspect(aspect);

    this.t = 0;
    this.cursor = -1; // schedule items with at <= cursor have fired
    this.playing = false;
    this.userPaused = false; // the visitor paused the tour (caption)
    this.frozen = false; // the visitor holds a lab
    this.visible = true;
    this.docHidden = false;
    this.blocks = new Set();
    this.lab = null;
    this.act = null; // which act the dots mark: 'camera' | 'studio' | 'describe'
    this.caption = null;
    this.rendererPaused = { camera: false, lighting: false };
    this.lastScalar = {};
    this.handlers = {};
    this.rafId = null;
    this.lastNow = 0;
    this.destroyed = false;
    // The view window in each lab's canvas (fractions; the canvas bleeds past it) and
    // the visitor's option per act, kept for the session and re-sent with each prime.
    this.box = null;
    this.choice = { ...DEFAULT_CHOICE };
    this.zoom = { camera: 1, studio: 1 }; // r9: the visitor's zoom per lab, a multiplier on the tour's framing
    this.lens = K.LENS_DEFAULT; // r10: the studio lens slider's focal length, mm; the tour never moves it, a visitor's drag holds for the act
    this.options = null;

    // Each lab is primed to its act opening when its page (re)loads (at boot and
    // on its preload cue), so its first frame on the stage is the start of the act.
    this.primePending = { camera: !reducedMotion, studio: !reducedMotion };
    this.offPrime = ['camera', 'studio'].map((lab) => this.bridgeFor(lab)?.onState?.((s) => {
      if (!s?.ready || !this.primePending[lab]) return;
      this.primePending[lab] = false;
      this.prime(lab);
    }));
    this.on('preload', ({ target }) => {
      if (target in this.primePending && !this.reducedMotion) this.primePending[target] = true;
      if (target === 'studio' && this.lens !== K.LENS_DEFAULT) { this.lens = K.LENS_DEFAULT; this.emit('lens', { mm: this.lens }); } // a new loop's studio starts at the default again
    });
    // The camera reloads off stage and is primed the moment it is ready, which on a
    // phone can be before its canvas settles to the stage (the act then opened on an
    // over-large, cropped body): prime it again as it comes back onto the stage.
    this.on('transition', ({ to }) => { if (to === 'camera' && !this.reducedMotion) this.prime('camera'); });
  }

  /** The camera poses are framed for a 4:5 stage; a wider one fills with the camera closer. */
  setAspect(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : POSE_ASPECT;
    // r9: a phone window (#951 made it 0.9 of its width) is height-bound like the 4:5 one: the 4:5 distance, not closer.
    this.distanceScale = a <= PHONE_ASPECT_MAX ? 1 : Math.min(1, Math.max(MIN_DISTANCE_SCALE, POSE_ASPECT / a));
  }

  scaleCamera(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const out = { ...value };
    if (typeof out.distance === 'number') out.distance = +(out.distance * this.distanceScale).toFixed(3);
    for (const k of ['view', 'from']) {
      if (out[k] && typeof out[k].distance === 'number') out[k] = this.scaleCamera(out[k]);
    }
    if (Array.isArray(out.path)) out.path = out.path.map((key) => this.scaleCamera(key));
    return out;
  }

  // ---- events: caption, beat, lab, options, choice, transition, preload, unload, describe, loop, freeze, thaw, playing
  on(type, fn) {
    (this.handlers[type] ??= new Set()).add(fn);
    return () => this.handlers[type].delete(fn);
  }
  emit(type, payload) { for (const fn of [...(this.handlers[type] ?? [])]) fn(payload); }

  // ---- transport
  get running() {
    return this.playing && !this.frozen && this.visible && !this.docHidden && this.blocks.size === 0 &&
      !this.reducedMotion && !this.destroyed;
  }
  play() {
    if (this.reducedMotion) return;
    const was = this.userPaused;
    this.playing = true; this.userPaused = false; this.sync();
    if (was) this.emit('playing', { playing: true });
  }
  /** The visitor's pause (WCAG 2.2.2): the clock and every renderer hold. */
  pause() {
    const was = this.userPaused;
    this.playing = false; this.userPaused = true; this.sync();
    if (!was) this.emit('playing', { playing: false });
  }
  resume() { this.play(); }
  toggle() { if (this.userPaused) this.play(); else this.pause(); }
  getTime() { return this.t; }

  /** Jump to t: no commands replay; scalars and lab/caption state resync. */
  seek(t) {
    this.t = Math.max(0, Math.min(t, this.total - 1e-6));
    this.cursor = this.t;
    this.lastScalar = {};
    this.updateLabAndCaption();
    this.sendScalars(true);
    this.sync();
  }

  /**
   * Jump to the start of an act ('camera'|'studio'|'describe'), as the act dots do. The
   * act's cross-blur in plays as in the loop: its transition event and the commands at
   * its start fire now (even while the visitor has paused), and the lab is primed through
   * prime(), the path the loop wrap and a lab reload use. The camera act's start is the
   * wrap's: a transition to the camera, which primes it.
   */
  seekToAct(id) {
    const act = ACTS.find((a) => a.id === id);
    if (!act || this.destroyed) return;
    const camera = id === 'camera';
    this.t = act.at;
    this.cursor = camera ? -1 : act.at - 1e-6;
    this.lastScalar = {};
    if (camera) this.emit('transition', { from: 'seek', to: 'camera', ms: K.T3_MS });
    else if (id === 'studio' && !this.reducedMotion) { this.lens = K.LENS_DEFAULT; this.prime('studio'); }
    this.fire(act.at);
    this.updateLabAndCaption();
    this.sendScalars(true);
    this.sync();
  }

  block(key) { this.blocks.add(key); this.sync(); }
  unblock(key) { this.blocks.delete(key); this.sync(); }

  setVisible(v) { this.visible = !!v; this.sync(); }
  setDocumentHidden(h) { this.docHidden = !!h; this.sync(); }

  /**
   * Wire IntersectionObserver + visibilitychange, the stage aspect and the
   * caption's pause/play (browser only).
   */
  observe(element, {
    IntersectionObserver: IO = globalThis.IntersectionObserver, document: doc = globalThis.document,
    ResizeObserver: RO = globalThis.ResizeObserver,
    caption = element?.closest?.('.demo')?.querySelector?.('.pause-btn'),
  } = {}) {
    const offs = [];
    if (element?.getBoundingClientRect) {
      const measure = () => {
        const r = element.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) this.setAspect(r.width / r.height);
      };
      measure();
      if (RO) {
        const ro = new RO(measure);
        ro.observe(element);
        offs.push(() => ro.disconnect());
      }
    }
    if (caption && !this.reducedMotion) offs.push(this.wireCaption(caption));
    // The Flutter Describe demo keeps its own clock: the visitor's pause holds it too.
    offs.push(this.on('playing', ({ playing }) => globalThis.focalDescribeDemo?.setPaused?.(!playing)));
    if (IO) {
      const io = new IO((entries) => this.setVisible(entries[entries.length - 1].isIntersecting), { threshold: 0.1 });
      io.observe(element);
      offs.push(() => io.disconnect());
    }
    if (doc) {
      const h = () => this.setDocumentHidden(doc.hidden);
      doc.addEventListener('visibilitychange', h);
      h();
      offs.push(() => doc.removeEventListener('visibilitychange', h));
    }
    return () => offs.forEach((f) => f());
  }

  /**
   * The tour's pause control (WCAG 2.2.2) is a visually hidden "Pause demo" button that
   * shows on keyboard focus (round 9: no visible pause glyph); a click toggles, and
   * aria-pressed is true while paused. A real button keeps its own name, role and
   * Enter/Space; any other element is given them.
   */
  wireCaption(caption) {
    const native = caption.tagName === 'BUTTON';
    if (!native) {
      caption.setAttribute('role', 'button');
      caption.setAttribute('tabindex', '0');
      caption.setAttribute('aria-label', 'Pause demo');
    }
    const reflect = () => caption.setAttribute('aria-pressed', String(this.userPaused));
    reflect();
    const onClick = () => this.toggle();
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault?.();
      this.toggle();
    };
    caption.addEventListener('click', onClick);
    if (!native) caption.addEventListener('keydown', onKey);
    const off = this.on('playing', reflect);
    return () => {
      off();
      caption.removeEventListener('click', onClick);
      if (!native) caption.removeEventListener('keydown', onKey);
    };
  }

  // ---- visitor control (used by the gesture overlay)
  /** The visitor holds a lab: the clock stops; the renderers keep drawing so the view moves under the finger. */
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    this.sync();
    this.emit('freeze', { t: this.t, lab: this.lab });
  }
  thaw() {
    if (!this.frozen) return;
    this.frozen = false;
    // The glide-back landed on the path at t (and ended the renderer's path): run on
    // along the rest of it, so the tour still turns and drifts after a drag.
    const tr = this.lab && !this.reducedMotion ? pathTrackAt(this.lab, this.t, this.tracks) : null;
    const rest = tr && pathCommand(tr, this.t);
    if (rest) this.bridgeFor(this.lab)?.send(tr.action, this.lab === 'camera' ? this.scaleCamera(rest) : rest);
    this.sync();
    this.emit('thaw', { t: this.t, lab: this.lab });
  }
  isLocked(lab) { return isLocked(lab, this.t); }
  /** Pose the lab should return to now (poseTo value without ms). */
  trackPose(lab) { const p = poseAt(lab, this.t); return lab === 'camera' ? this.scaleCamera(p) : p; }
  track(name) { return trackAt(name, this.t, this.tracks); }

  bridgeFor(lab) { return lab === 'camera' ? this.bridges.camera : this.bridges.lighting; }

  /** Reduced motion: put a lab at its key still, orbitable, nothing running. */
  showStill(lab) {
    const camera = lab === 'camera';
    for (const c of stillCommands(camera ? 'camera' : 'studio', { box: this.box, choice: this.choice[lab], zoom: this.zoom[lab], lens: this.lens })) {
      this.bridgeFor(lab)?.send(c.action, camera ? this.scaleCamera(c.value) : c.value);
    }
  }

  /** Put a lab at its act's opening state (off stage, before it is shown). */
  prime(lab) {
    for (const c of primeCommands(lab, { box: this.box, choice: this.choice[lab], zoom: this.zoom[lab], lens: this.lens })) {
      this.bridgeFor(lab)?.send(c.action, lab === 'camera' ? this.scaleCamera(c.value) : c.value);
    }
  }

  /**
   * Where the view window sits in the labs' canvas ({x, y, width, height} fractions;
   * the canvas bleeds past it) and its aspect. Both labs frame their subject in it.
   */
  setBox(box, aspect) {
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return;
    const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : this.box?.aspect;
    const same = this.box && ['x', 'y', 'width', 'height'].every((k) => Math.abs(this.box[k] - box[k]) < 1e-4) && this.box.aspect === ratio;
    this.box = { x: box.x, y: box.y, width: box.width, height: box.height, ...(ratio ? { aspect: ratio } : {}) };
    if (Number.isFinite(aspect) && aspect > 0) this.setAspect(aspect);
    if (same) return;
    const anchorX = trackAt('camera.pose', Math.min(this.t, K.T1_AT)).anchorX;
    this.bridges.camera?.send('lessonViewport', cameraBox(this.box, anchorX));
    this.bridges.lighting?.send('reframe', studioFrame(this.box));
  }

  /** The visitor's option for an act ('camera'|'studio'): applied at once, kept for the session. */
  choose(lab, value) {
    const opts = OPTIONS[lab];
    if (!opts || !opts.items.some(([v]) => v === value) || this.choice[lab] === value) return;
    this.choice[lab] = value;
    const c = choiceCommand(lab, value);
    if (c) this.bridgeFor(lab)?.send(c.action, c.value);
    // A new body comes up with its lens at rest: the tour's aperture and focus re-sent.
    if (lab === 'camera') { this.lastScalar = {}; this.sendScalars(true); }
    this.emit('choice', { lab, value });
  }

  /** r10: the studio lens slider (the visitor's drag): the lab's focalLength at once; kept for the act, the next loop starts at the default. */
  setLens(mm) {
    if (!Number.isFinite(mm)) return;
    const cmds = lensCommands(mm), f = cmds[1].value;
    if (f === this.lens) return;
    this.lens = f;
    for (const c of cmds) this.bridges.lighting?.send(c.action, c.value);
    this.emit('lens', { mm: f });
  }

  /**
   * r9: the page (re)loads a lab's frame (its preload cue, or an act dot's jump): prime it the moment it says
   * ready, so the poster gives way to the act's opening and never to the lab's own default view.
   */
  primeOnReady(lab) { if (lab in this.primePending && !this.reducedMotion) this.primePending[lab] = true; }

  /** r9: one zoom-button tap for a lab (dir 1 in, -1 out): glides at once, kept for the session; the tour runs on. */
  zoomBy(lab, dir) {
    const next = nextZoom(lab, this.zoom[lab], dir);
    if (next === null || next === this.zoom[lab]) return;
    this.zoom[lab] = next;
    const c = zoomCommand(next);
    this.bridgeFor(lab)?.send(c.action, c.value);
    this.emit('zoom', { lab, zoom: next });
  }

  destroy() {
    this.destroyed = true;
    for (const off of this.offPrime ?? []) off?.();
    this.sync();
    this.handlers = {};
  }

  // ---- internals
  sync() {
    const run = this.running;
    // Renderers draw while their lab is on (or about to come onto) the stage and the
    // page is visible; the visitor's pause holds them too. A held lab (freeze) and a
    // clock held for loading keep drawing.
    const away = !this.visible || this.docHidden || this.destroyed;
    for (const [lab, key] of [['camera', 'camera'], ['studio', 'lighting']]) {
      const want = !this.reducedMotion && (away || this.userPaused || !onStage(lab, this.t));
      if (want !== this.rendererPaused[key]) {
        this.rendererPaused[key] = want;
        this.bridges[key]?.send(want ? 'pause' : 'resume');
      }
    }
    if (run && this.rafId === null) {
      this.lastNow = this.now();
      this.rafId = this.raf(() => this.frame());
    } else if (!run && this.rafId !== null) {
      this.cancelRaf(this.rafId);
      this.rafId = null;
    }
  }

  frame() {
    this.rafId = null;
    if (!this.running) return;
    const n = this.now();
    const dt = Math.min(Math.max(n - this.lastNow, 0) / 1000, MAX_DT);
    this.lastNow = n;
    this.advance(dt); // its sync() schedules the next frame while running
    if (this.running && this.rafId === null) this.rafId = this.raf(() => this.frame());
  }

  advance(dt) {
    const t1 = this.t + dt;
    if (t1 >= this.total) {
      this.fire(this.total);
      this.t = 0;
      this.cursor = -1;
      this.lastScalar = {};
      this.emit('loop', {});
      const t2 = t1 - this.total;
      this.t = t2;
      this.fire(t2);
    } else {
      this.t = t1;
      this.fire(t1);
    }
    this.updateLabAndCaption();
    this.sendScalars();
    this.sync();
  }

  fire(upTo) {
    for (const item of this.schedule) {
      if (item.at <= this.cursor) continue;
      if (item.at > upTo) break;
      this.dispatch(item);
    }
    this.cursor = upTo;
  }

  dispatch(item) {
    if (item.kind === 'command') {
      const bridge = item.channel === 'camera' ? this.bridges.camera : this.bridges.lighting;
      bridge?.send(item.action, item.channel === 'camera' ? this.scaleCamera(item.value) : item.value);
    } else if (item.kind === 'event') {
      const { type, at, ...payload } = item.event;
      this.emit(type, { ...payload, beat: item.beat.id, t: item.at });
    } else if (item.kind === 'beat') {
      this.emit('beat', { id: item.beat.id, channel: item.beat.channel, start: item.beat.start });
      if (item.beat.caption) this.setCaption(item.beat.caption, item.beat.id);
    }
  }

  setCaption(text, beat) {
    if (text === this.caption) return;
    this.caption = text;
    this.emit('caption', { text, beat });
  }

  updateLabAndCaption() {
    const lab = labAt(this.t);
    if (lab !== this.lab) { this.lab = lab; this.emit('lab', { lab }); }
    const options = optionsAt(this.t);
    if (options !== this.options) { this.options = options; this.emit('options', { act: options, choice: options ? this.choice[options] : null }); }
    const act = actAt(this.t);
    if (act !== this.act) { this.act = act; this.emit('act', { act }); }
    const cap = captionAt(this.t);
    if (cap && cap !== this.caption) this.setCaption(cap, null);
  }

  sendScalars(force = false) {
    for (const tr of this.ticks) {
      if (this.t < tr.window[0] || this.t > tr.window[1]) continue;
      const v = trackAt(tr.name, this.t, this.tracks);
      const prev = this.lastScalar[tr.name];
      if (!force && prev !== undefined && Math.abs(v - prev) < SCALAR_EPS) continue;
      this.lastScalar[tr.name] = v;
      (tr.channel === 'camera' ? this.bridges.camera : this.bridges.lighting)?.send(tr.action, tr.value ? tr.value(v) : v);
    }
  }
}
