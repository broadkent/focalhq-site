// One blend for both labs' camera aim (Kent, session 5, cards 819-825 and 839-844):
// dollied out, the camera looks at the whole subject so it sits centered in the
// clear area; dollied in, it looks at the part itself so the part is dead center.
// The blend keys off camera distance (the pinch dolly), never focal length.

function smoothstep(value){
  const x=Math.min(1,Math.max(0,value));
  return x*x*(3-2*x);
}

// The share (0 far, 1 near) of the dolly travelled from [far] distance in to [near]
// distance, eased so the aim settles at both ends.
export function dollyShare(distance,near,far){
  if(!(far>near))return 0;
  return smoothstep((far-distance)/(far-near));
}

// The aim point between [far] and [near] ([x,y,z] each) at [share]: 0 is [far],
// 1 is [near].
export function blendAim(far,near,share){
  return far.map((value,index)=>value+(near[index]-value)*share);
}

// The camera lab's step framing: far out, the aim sits two thirds of the way
// from the body's center to the part, so the ghost body stays in frame; dollied
// all the way in, it is the part itself, dead center.
export const STEP_PART_FAR_SHARE=2/3; // domain: how far toward the part the aim sits at the far distance

// The aim for a camera [distance] from it, with [near] and [far] the closest and
// the fit distances; body and part are [x,y,z].
export function stepAim(body,part,distance,near,far){
  return blendAim(blendAim(body,part,STEP_PART_FAR_SHARE),part,dollyShare(distance,near,far));
}

// The lighting lab's aim before the eye framing below: on the line from [whole] (the
// whole bust's center) to [eyeLine] (the measured eye line), both [x,y,z], at the
// dolly's share. Neither point takes a fixed forward shift: a constant orbit anchor
// ahead of the face sat a profile bust right of center far out and ran the head off
// the screen's edge while dollying (Kent, October 12, 2026).
export function lightingAim(whole,eyeLine,distance,near,far){
  return blendAim(whole,eyeLine,dollyShare(distance,near,far));
}

// Kent, October 12, 2026: "The frame should stay well framed for a photograph of the
// subject at the different distances and angles." The frame is the clear box from under
// the header row down to the meter bar, the canvas's full width (his drawing). From the
// aim above, the aim then moves sideways and up or down only, so the eye line lands:
// - sideways: where the aim puts it while the bust fits, easing in to the third line as
//   the bust outgrows the frame, so a profile's face never slides to the edge;
// - vertically: where the centered bust puts it while the bust fits, rising onto the
//   box's upper third line as the head outgrows the box ("The eyes, when these
//   distances, should be in the upper third line"), the chin and neck below it.
// "Dolly also needs to make sure transition is *smooth*": both ease over a long stretch
// of the dolly, so each pinch step moves the face a small, even amount.
export const FRAME_MARGIN=.9; // domain: share of the half-frame the whole bust fills when it just fits
export const EYE_THIRD=1/3; // domain: the third lines, a share of the half-box from its center
export const EYE_SIDE_FROM=.6; // domain: bust overflow at which the eye starts easing in to the side third
export const EYE_SIDE_TO=1.6; // domain: bust overflow by which it is on the side third (past 85 mm at the whole-bust fit)
export const EYE_LIFT_OVERFLOW=2.6; // domain: bust overflow when the face (crown to chin, about 1/2.6 of the bust) fills the box

// How far the bust overflows the frame on one axis: [ndcs] are its corners' ndc on
// that axis with the camera aimed at its center, [half] the box's half-size there.
// 1 when it just fills [FRAME_MARGIN] of the box.
export function overflow(ndcs,half=1){
  return (Math.max(...ndcs)-Math.min(...ndcs))/(2*FRAME_MARGIN*half);
}

// How far (0 to 1) the eye has eased in to the side third at overflow [q].
export function eyeSideEase(q){
  return smoothstep((q-EYE_SIDE_FROM)/(EYE_SIDE_TO-EYE_SIDE_FROM));
}

// Head-on, the face is symmetric about the eye line's midpoint, so that midpoint sits
// dead center at every zoom (Kent, October 13, 2026: "when the head is straight on and
// I zoom in, the head drifts to the left"). The aim alone leaves the eye line off the
// bust box's center by a fixed sideways offset in the world, which the lens's
// magnification grows with every step of zoom. [facing] is the cosine of the angle
// between the camera's line of sight and the face's front (1 head-on, 0 profile).
export const FRONTAL_FROM=.8; // domain: facing cosine (about 37 degrees) where the eye line starts easing to center
export const FRONTAL_TO=.98; // domain: facing cosine (about 11 degrees) from which it is centered

// How far (0 to 1) the view is head-on at [facing].
export function frontalShare(facing){
  return smoothstep((facing-FRONTAL_FROM)/(FRONTAL_TO-FRONTAL_FROM));
}

// The eye's sideways ndc for overflow [q]: [free] is where the aim alone puts it, the
// box is centered with [half] its half-width, [facing] as above (0 leaves a profile's
// framing untouched).
export function eyeSide(free,half,q,facing=0){
  const third=EYE_THIRD*half,held=Math.min(third,Math.max(-third,free));
  const side=free+(held-free)*eyeSideEase(q);
  return side*(1-frontalShare(facing));
}

// How far (0 to 1) the eye line has risen to the upper third at overflow [q].
export function eyeLift(q){
  return smoothstep((q-1)/(EYE_LIFT_OVERFLOW-1));
}

// The eye's vertical ndc for overflow [q]: [free] is where the aim alone puts it, and
// the box is [center] +- [half] in the same ndc.
export function eyeLevel(free,center,half,q){
  return free+(center+half*EYE_THIRD-free)*eyeLift(q);
}

// How far to move the aim along a view axis (right or up) so the eye lands at ndc
// [level] on it: [eyeOffset] and [eyeDepth] are the eye's offset from the unmoved aim
// along that axis and its depth from the camera, [scale] the tangent of the half field
// of view on that axis. The axis is perpendicular to the view, so the depth, and the
// framing on the other axis, do not change.
export function eyeShift(eyeOffset,eyeDepth,level,scale){
  return eyeOffset-level*eyeDepth*scale;
}

// The aim follows its goal critically damped (no overshoot), settling within the
// standard duration (InkUI AnimationTokens.normal, 300 ms), so a quick pinch glides.
export const AIM_FOLLOW_SECONDS=.3; // domain: mirrors AnimationTokens.normal
const AIM_FOLLOW_RATE=4/AIM_FOLLOW_SECONDS; // (1 + 4) e^-4: 9% left at the duration
// One step of [dt] seconds from [value] moving at [velocity] toward [goal], each [x,y,z]:
// the exact critically damped solution with the goal held for the step.
export function followAim(value,velocity,goal,dt){
  const decay=Math.exp(-AIM_FOLLOW_RATE*dt),next=[],speed=[];
  let settled=true;
  for(let i=0;i<goal.length;i++){
    const error=value[i]-goal[i],push=(velocity[i]+AIM_FOLLOW_RATE*error)*dt;
    const e=(error+push)*decay,v=(velocity[i]-AIM_FOLLOW_RATE*push)*decay;
    next.push(goal[i]+e);speed.push(v);
    if(Math.abs(e)>1e-4||Math.abs(v)>1e-3)settled=false;
  }
  return settled?{value:[...goal],velocity:goal.map(()=>0),settled}:{value:next,velocity:speed,settled};
}
