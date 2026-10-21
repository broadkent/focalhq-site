// Transparent input layer over a lab iframe. Owns input the way the app's
// camera_viewport_input.dart / lighting_viewport.dart do: pointer gestures pass
// through as `viewport` commands. A drag holds the director at t once it shows
// intent (about 10 px, mostly horizontal for touch, so a vertical swipe scrolls
// the page and the tour keeps playing); 3 s after the last pointerup/wheel the
// lab glides back to the track pose at t (one poseTo) and the director thaws
// when the renderer reports done.

const WHEEL_SENSITIVITY = 0.0015; // lighting_viewport.dart:wheel
const STUDIO_ZOOM = [0.2, 2.5]; // lighting_viewport.dart:_zoom clamp
const PINCH_EPS = 0.001; // camera_viewport_input.dart:pinch threshold
/** px of travel before a touch drag counts as an orbit (mostly horizontal). */
export const INTENT_PX = 10;
/** px of travel before a mouse drag counts (any direction: a mouse never scrolls). */
export const MOUSE_INTENT_PX = 3;

export class GestureOverlay {
  /**
   * @param {object} o
   * @param {HTMLElement} o.element   div the page placed over the lab iframe
   * @param {'camera'|'studio'} o.lab
   * @param {{send, onState}} o.bridge  this lab's bridge
   * @param {Director} o.director
   * @param {number} [o.idleMs=3000]
   * @param {number} [o.rejoinMs=1200]
   * @param {Function} [o.setTimeout]
   * @param {Function} [o.clearTimeout]
   */
  constructor({
    element, lab, bridge, director, idleMs = 3000, rejoinMs = 1200,
    setTimeout: st = globalThis.setTimeout?.bind(globalThis),
    clearTimeout: ct = globalThis.clearTimeout?.bind(globalThis),
  }) {
    this.element = element;
    this.lab = lab;
    this.bridge = bridge;
    this.director = director;
    this.idleMs = idleMs;
    this.rejoinMs = rejoinMs;
    this.st = st;
    this.ct = ct;

    this.active = true;
    this.pointers = new Map(); // id -> {x, y, ox, oy, mouse, engaged}
    this.idleTimer = null;
    this.rejoin = null; // {off, timer}
    this.state = bridge.state ?? {};
    this.pinch = null; // {dist, start}
    this.gestureDown = false;

    this.offState = bridge.onState((s) => { this.state = s; });
    this.holding = false; // we froze the director
    this.offLab = director.on('lab', ({ lab: l }) => { if (!director.reducedMotion) this.setActive(l === lab); });
    this.setActive(director.reducedMotion || director.lab === lab);

    if (element?.style) {
      element.style.touchAction = 'pan-y'; // vertical swipe scrolls the page
      element.style.background = 'transparent';
    }
    this.listeners = {
      pointerdown: (e) => this.pointerDown(e),
      pointermove: (e) => this.pointerMove(e),
      pointerup: (e) => this.pointerUp(e),
      pointercancel: (e) => this.pointerUp(e),
      wheel: (e) => this.wheel(e),
    };
    for (const [type, fn] of Object.entries(this.listeners)) {
      element?.addEventListener?.(type, fn, type === 'wheel' ? { passive: false } : undefined);
    }
  }

  /** Enable/disable input (the Describe beat and transitions have no overlay). */
  setActive(on) {
    this.active = !!on;
    if (this.element?.style) {
      this.element.style.pointerEvents = this.active ? 'auto' : 'none';
      this.element.style.cursor = this.active ? 'grab' : '';
    }
    if (!this.active) this.reset();
  }

  get height() {
    const r = this.element?.getBoundingClientRect?.();
    return r?.height || this.element?.clientHeight || 1;
  }

  // ---- gestures
  pointerDown(e) {
    if (!this.active || this.director.isLocked(this.lab)) return; // solidReveal flight: ignored
    const mouse = e.pointerType === 'mouse';
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, mouse, engaged: false });
    if (this.pointers.size === 2) {
      // Two fingers: a pinch, engaged at once.
      for (const [id, p] of this.pointers) this.engage(id, p);
      this.pinch = { dist: this.pinchDistance(), start: this.zoomValue() };
    }
  }

  /** The pointer showed intent: capture it, hold the clock, start the gesture. */
  engage(id, p) {
    if (p.engaged) return;
    p.engaged = true;
    this.element?.setPointerCapture?.(id);
    this.beginInteraction();
    this.setGesture(true);
    if (p.mouse && this.element?.style) this.element.style.cursor = 'grabbing';
  }

  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.active) return;
    if (!p.engaged) {
      const tx = e.clientX - p.ox, ty = e.clientY - p.oy;
      const ax = Math.abs(tx), ay = Math.abs(ty);
      if (p.mouse) {
        if (Math.hypot(tx, ty) < MOUSE_INTENT_PX) return;
      } else {
        if (Math.max(ax, ay) < INTENT_PX) return;
        if (ay >= ax) { this.pointers.delete(e.pointerId); return; } // a scroll: let the page have it
      }
      this.engage(e.pointerId, p);
      // The travel so far moves the view too, so it stays under the finger.
      p.x = p.ox; p.y = p.oy;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size >= 2 && this.pinch) {
      const scale = this.pinchDistance() / (this.pinch.dist || 1);
      if (Math.abs(scale - 1) > PINCH_EPS) this.sendZoom(this.pinch.start, scale);
    } else if (this.pointers.size === 1 && (dx || dy)) {
      this.bridge.send('viewport', { kind: 'orbit', dx, dy, height: this.height });
    }
  }

  pointerUp(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    const engaged = p.engaged || this.gestureDown;
    if (this.pointers.size === 0) {
      this.setGesture(false);
      if (this.element?.style && this.active) this.element.style.cursor = 'grab';
    }
    if (engaged) this.startIdle();
  }

  wheel(e) {
    // Desktop: wheel dollies only with ctrl; plain wheel scrolls the page.
    if (!e.ctrlKey || !this.active || this.director.isLocked(this.lab)) return;
    e.preventDefault?.();
    this.beginInteraction();
    const f = Math.exp(e.deltaY * WHEEL_SENSITIVITY);
    if (this.lab === 'camera') {
      this.bridge.send('viewport', { kind: 'zoom', distance: this.zoomValue() * f });
    } else {
      this.bridge.send('viewport', { kind: 'zoom', scale: clampZoom(this.zoomValue() * f) });
    }
    this.startIdle();
  }

  sendZoom(start, scale) {
    if (this.lab === 'camera') {
      this.bridge.send('viewport', { kind: 'zoom', distance: start / scale });
    } else {
      this.bridge.send('viewport', { kind: 'zoom', scale: clampZoom(start / scale) });
    }
  }

  zoomValue() {
    const s = this.state ?? {};
    return this.lab === 'camera'
      ? Number(s.zoomDistance ?? s.pose?.distance ?? 10)
      : Number(s.zoomScale ?? 1);
  }

  pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  setGesture(down) {
    if (this.gestureDown === down) return;
    this.gestureDown = down;
    // Also cancels a rejoin glide renderer-side (viewport cancels any poseTo).
    this.bridge.send('viewport', { kind: 'gesture', down });
  }

  // ---- freeze / idle / rejoin
  beginInteraction() {
    this.clearIdle();
    this.cancelRejoin();
    if (!this.director.reducedMotion) { this.holding = true; this.director.freeze(); }
  }

  startIdle() {
    this.clearIdle();
    this.idleTimer = this.st(() => {
      this.idleTimer = null;
      this.rejoinNow();
    }, this.idleMs);
  }

  clearIdle() {
    if (this.idleTimer !== null) { this.ct(this.idleTimer); this.idleTimer = null; }
  }

  rejoinNow() {
    if (this.gestureDown || !this.active) return;
    if (this.director.reducedMotion || !this.director.frozen) return; // reduced: stay put
    const pose = this.director.trackPose(this.lab);
    let seenActive = false;
    const rj = { off: null, timer: null };
    const finish = () => {
      if (this.rejoin !== rj) return;
      this.clearRejoin();
      this.holding = false;
      this.director.thaw();
    };
    rj.off = this.bridge.onState((s) => {
      const g = s?.glide;
      if (!g || this.rejoin !== rj) return;
      if (g.active) seenActive = true;
      else if (seenActive && g.done) finish(); // done stays true from the previous glide until active:true
    });
    rj.timer = this.st(finish, this.rejoinMs + 800); // renderer never answered
    this.rejoin = rj;
    this.bridge.send('poseTo', { ...pose, ms: this.rejoinMs });
  }

  clearRejoin() {
    const rj = this.rejoin;
    if (!rj) return;
    this.rejoin = null;
    rj.off?.();
    if (rj.timer !== null) this.ct(rj.timer);
  }

  /** A new gesture during the rejoin: drop it; the director stays frozen. */
  cancelRejoin() { this.clearRejoin(); }

  reset() {
    this.clearIdle();
    this.clearRejoin();
    this.pointers.clear();
    this.pinch = null;
    this.gestureDown = false;
    if (this.holding) { this.holding = false; this.director.thaw(); }
  }

  destroy() {
    this.reset();
    this.offState?.();
    this.offLab?.();
    for (const [type, fn] of Object.entries(this.listeners)) this.element?.removeEventListener?.(type, fn);
  }
}

const clampZoom = (v) => Math.min(STUDIO_ZOOM[1], Math.max(STUDIO_ZOOM[0], v));
