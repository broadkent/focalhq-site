// The Lab camera's tap labels (Kent, October 11, 2026): tap a part and a
// callout names it, one or two plain words, no verb, whether or not the tap
// also animates the part. Every tappable part id has exactly one name here.
export const PART_NAMES = Object.freeze({
  shutterButton: 'Shutter button',
  controlDial: 'Mode dial',
  lensRelease: 'Lens release',
  aperture: 'Aperture',
  focusGroup: 'Focus',
  zoomGroup: 'Zoom',
  sensor: 'Sensor',
  reflexMirror: 'Mirror',
  filmAdvance: 'Film advance',
  filmRewind: 'Rewind',
  filmRewindRelease: 'Rewind release',
});

// Parts whose tap only names them (nothing moves).
export const LABEL_ONLY_PARTS = Object.freeze(['controlDial', 'sensor']);

// The parts a tap reaches, as scene.js tests them: the closed exterior, then
// the open internals view, and the film body's own controls.
export function tappablePartIds({internals = false, slr = false, film = false} = {}) {
  const filmIds = film ? ['filmAdvance', 'filmRewind', 'filmRewindRelease'] : [];
  if (!internals) return ['shutterButton', 'controlDial', 'lensRelease', ...filmIds];
  return ['shutterButton', 'lensRelease', 'aperture', 'focusGroup', 'zoomGroup', 'sensor',
    ...(slr ? ['reflexMirror'] : []), ...filmIds];
}

// domain: how long a tap label stays, then how long it takes to fade (seconds).
export const TAP_LABEL_SECONDS = 1.5;
export const TAP_LABEL_FADE_SECONDS = .3;
