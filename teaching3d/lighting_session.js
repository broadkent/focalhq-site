// Pure collection model for the lighting study.  The renderer and controls
// both consume this shape, which keeps selection and mutation rules in one
// place and makes them usable from the native host bridge as well.

// Three lights (Kent, October 15, 2026): each light is a cluster of shadow-casting
// spots (4 each with several lights), so four asked for 16 shadow maps, the whole
// texture-unit budget of most phones, and the bust's material failed to link.
export const DEFAULT_MAX_LIGHTS = 3;

// The light's output for its brightness percent, as a multiple of the
// reference output (Kent, October 14, 2026: "the light to be able to get a
// lot brighter, so that we can do bigger scenes"). 0 to 50 is linear as
// before (50 is 1); above 50 it rises in stops to BRIGHTNESS_CEILING at 100,
// three times the old 100 (2), so 50 looks as it did and 100 can blow out the
// near side of the bust.
export const BRIGHTNESS_CEILING = 6;
export function brightnessIntensity(percent) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  return p <= 50 ? p / 50 : BRIGHTNESS_CEILING ** ((p - 50) / 50);
}

const clone = value => Array.isArray(value) ? value.slice() : value;

function copyLight(light) {
  return {
    ...light,
    position: clone(light.position),
    target: clone(light.target),
  };
}

function defaultLight(factory, id, index) {
  return factory(id, `Light ${index}`, index);
}

export function createLightingSession({
  createLight,
  maxLights = DEFAULT_MAX_LIGHTS,
  initialLight,
} = {}) {
  if (typeof createLight !== 'function') throw new TypeError('createLight must be a function');
  const cap = Math.max(1, Math.floor(Number(maxLights) || DEFAULT_MAX_LIGHTS));
  let nextNumber = 1;
  let lights = [copyLight(initialLight || defaultLight(createLight, 'light-1', 1))];
  let selectedId = lights[0].id;

  // The counter is deliberately monotonic: deleting Light 2 and adding a new
  // light yields Light 3, so a bridge or accessibility reference never points
  // at a different physical light later in the session.
  const idNumber = id => Number(String(id).match(/^light-(\d+)$/)?.[1] || 0);
  nextNumber = Math.max(nextNumber, ...lights.map(light => idNumber(light.id) + 1));
  // The name is the light's 1-based place: deleting Light 1 makes the old Light 2
  // the new Light 1 (ids stay put, so the selection follows the light).
  const renumber = () => lights.forEach((light, index) => { light.label = `Light ${index + 1}`; });
  renumber();
  const selectedIndex = () => lights.findIndex(light => light.id === selectedId);
  const selected = () => lights[selectedIndex()] || lights[0];
  const snapshot = () => ({
    selectedId,
    lights: lights.map(copyLight),
    maxLights: cap,
    canAdd: lights.length < cap,
    canRemove: lights.length > 1,
  });

  return {
    getState: snapshot,
    getSelected: () => copyLight(selected()),
    select(id) {
      if (!lights.some(light => light.id === id)) return false;
      selectedId = id;
      return true;
    },
    add() {
      if (lights.length >= cap) return null;
      const number = nextNumber++;
      const light = copyLight(createLight(`light-${number}`, `Light ${number}`, number));
      lights.push(light);
      renumber();
      selectedId = light.id;
      return copyLight(light);
    },
    remove() {
      if (lights.length <= 1) return null;
      const index = selectedIndex();
      const removed = lights.splice(index < 0 ? lights.length - 1 : index, 1)[0];
      renumber();
      // Prefer the item that occupied the removed slot; at the end, select the
      // previous item. This keeps keyboard/tap focus near the user's edit.
      const nextIndex = Math.min(Math.max(index, 0), lights.length - 1);
      selectedId = lights[nextIndex].id;
      return copyLight(removed);
    },
    update(patch) {
      return this.updateLight(selectedId, patch);
    },
    // The same edit for any light by id, selection untouched (the lessons' `sizeOf`).
    updateLight(id, patch) {
      const index = lights.findIndex(light => light.id === id);
      if (index < 0) return false;
      const allowed = ['position', 'target', 'width', 'height', 'powerStops', 'brightnessPercent', 'enabled'];
      const changes = Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(patch, key)).map(key => [key, patch[key]]));
      lights[index] = {...lights[index], ...changes,
        ...(patch.position ? {position: clone(patch.position)} : {}),
        ...(patch.target ? {target: clone(patch.target)} : {}),
      };
      return true;
    },
  };
}
