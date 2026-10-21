// Prepared slow mechanical exposure. Not a simulation of mirrorless live view.
export const clamp = x => Math.max(0, Math.min(1, x));
export function captureState(time) {
  const first = clamp((time - .1) / .2);
  const second = clamp((time - .65) / .2);
  const caption = time < .1 ? 'The shutter sits in front of the sensor.'
    : time < .3 ? 'The first curtain uncovers the sensor.'
    : time < .65 ? 'Light reaches the sensor.'
    : time < .85 ? 'The second curtain ends the exposure.'
    : 'The exposure is complete.';
  return { first, second, caption };
}
