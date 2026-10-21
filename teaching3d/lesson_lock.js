// Learner-input locks for the Studio lessons (lesson=1): `lock {orbit, zoom, lamp}`.
// Off by default. The host's own choreography (`poseTo`, `lightTo`, `focalLength`,
// `preset`) is never blocked: the lock stops the learner, not the lesson.
const ORBIT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const ZOOM_KEYS = ['+', '=', '-', '_'];

export function createLessonLock() {
  const state = {orbit: false, zoom: false, lamp: false};
  return {
    state,
    snapshot: () => ({...state}),
    /** Sets the named flags that are booleans; true if any changed. */
    set(value) {
      let changed = false;
      for (const key of Object.keys(state)) {
        if (typeof value?.[key] === 'boolean' && state[key] !== value[key]) {state[key] = value[key]; changed = true;}
      }
      return changed;
    },
    // Home resets the view, which undoes both an orbit and a zoom.
    blocksKey: key => (ORBIT_KEYS.includes(key) && state.orbit) || (ZOOM_KEYS.includes(key) && state.zoom) ||
      (key === 'Home' && (state.orbit || state.zoom)),
    // A `viewport` command: orbit and zoom by kind; a finger down or up only holds the render
    // clock, blocked once nothing on the view can move.
    blocksViewport: value => {
      if (value?.kind === 'orbit') return state.orbit;
      if (value?.kind === 'zoom') return state.zoom;
      if (value?.kind === 'gesture') return state.orbit && state.zoom;
      return false;
    },
    blocksLampDrag: () => state.lamp,
  };
}
