// Hold-then-step for the Studio lab's auto settings (Kent, October 13, 2026):
// nothing on A moves while a drag is in progress; after release each auto
// setting clicks one detent per tick toward the solved target, one setting at
// a time. This file is the pure part: given the current values, the target and
// the detent lists, it returns the values after one tick.

export const AUTO_STEP_ORDER=Object.freeze(['aperture','shutter','iso']);
export const AUTO_STEP_MS=300; // domain: one detent click of an auto setting, between 250 and 500 ms

const indexOf=(values,value)=>values.reduce((best,v,i)=>
  Math.abs(Math.log(v/value))<Math.abs(Math.log(values[best]/value))?i:best,0);

// current, target: {aperture, shutter, iso} (target holds only the auto keys).
// lists: {aperture, shutter, iso} each an array of detent values in any
// monotonic order. Returns the values after one tick, or null when every
// setting in the target already sits on its target detent.
export function stepAuto(current,target,lists){
  if(!target)return null;
  for(const key of AUTO_STEP_ORDER){
    if(!(key in target))continue;
    const values=lists[key],from=indexOf(values,current[key]),to=indexOf(values,target[key]);
    if(from===to)continue;
    return {...current,[key]:values[from+Math.sign(to-from)]};
  }
  return null;
}
