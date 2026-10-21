// The Studio's opening move (Kent, October 15, 2026): the bust is already at its
// final angle (to the viewer's left and a little above) before the first frame,
// and the camera dollies in from just a little further away. The constants are
// matched to Kent's end frame by eye on the sheet.
export const DOLLY_IN={
  azimuth:32, // degrees toward the viewer's left (the camera sits at -x), fixed from the start
  elevation:15, // degrees above the head-on pose, fixed from the start
  closer:.05, // share of the fit distance closed at rest (the bust sits a touch larger)
  from:1.12, // the camera starts this many times the resting distance away
  ms:900, // ease-out duration
};
export const dollyEase=t=>1-(1-t)**3; // cubic out: fast at first, settling slowly

const rad=degrees=>degrees*Math.PI/180;

// The fixed angle the page boots at, from the head-on spherical angles
// [head] (theta, phi); phi stays inside [minPhi, maxPhi].
export function dollyInAngles(head,{minPhi=.15,maxPhi=Math.PI-.15,config=DOLLY_IN}={}){
  return {
    theta:head.theta-rad(config.azimuth),
    phi:Math.min(maxPhi,Math.max(minPhi,head.phi-rad(config.elevation))),
  };
}

// The zoom scale at the resting distance, and at the start of the dolly.
export const restZoom=(config=DOLLY_IN)=>1-config.closer;
export const startZoom=(config=DOLLY_IN)=>restZoom(config)*config.from;

// The zoom scale at progress [t] (0 to 1, eased here): [startZoom] to [restZoom].
export function dollyInZoom(t,config=DOLLY_IN){
  const e=dollyEase(Math.min(1,Math.max(0,t)));
  return startZoom(config)+(restZoom(config)-startZoom(config))*e;
}
