import * as THREE from './vendor/three.module.min.f231b18ca7.js';

const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const p=clamp(value);return p*p*p*(p*(p*6-15)+10);};
const span=(time,start,end)=>smooth((time-start)/(end-start));

// These phases illustrate the existing generic teaching marks. Their angle
// comes from the model's line/dot positions, not a manufacturer's procedure.
export function lensMountPose(time,{angle=Math.PI/6,distance=2.25}={}){
  if(!Number.isFinite(time))throw new TypeError('Mount progress must be finite');
  const p=clamp(time);
  const phase=p<.12?'press':p<.30?'unlock':p<.50?'withdraw':p<.58?'removed':p<.80?'insert':p<.96?'lock':'seated';
  return {phase,
    rotation:angle*span(p,.12,.30)*(1-span(p,.80,.96)),
    withdrawal:distance*span(p,.30,.50)*(1-span(p,.58,.80)),
    release:span(p,0,.12)*(1-span(p,.30,.40)),
  };
}

export function createLensMountCycle({lens,release,angle=Math.PI/6,distance=2.25,pressDistance=.04}){
  const lensPosition=lens.position.clone(),lensQuaternion=lens.quaternion.clone();
  const releasePosition=release.position.clone(),turn=new THREE.Quaternion(),axis=new THREE.Vector3(0,0,1);
  const restore=()=>{lens.position.copy(lensPosition);lens.quaternion.copy(lensQuaternion);release.position.copy(releasePosition);};
  function update(time){
    const pose=lensMountPose(time,{angle,distance});
    lens.position.copy(lensPosition);lens.position.z+=pose.withdrawal;
    lens.quaternion.copy(lensQuaternion).multiply(turn.setFromAxisAngle(axis,pose.rotation));
    release.position.copy(releasePosition);release.position.z-=pose.release*pressDistance;
    if(time>=1)restore();
    return pose;
  }
  return {update,restore};
}
