const step=(id,name,target,slider=false)=>({id,name,target,slider});
export const interactionPrompts={capture:'Tap to press the shutter',
  load:'Tap to load film',close:'Tap to close the back',advance:'Tap to advance the film',
  release:'Tap to press the shutter',rewind:'Tap to press the rewind release',unload:'Tap to open the back',
  unfold:'Tap to unfold the rewind crank',wind:'Tap to rewind the film',
  mountMarks:'Tap to align the mounting marks',lensRelease:'Tap to release the lens'};
const mirror={...step('mirror','Reflex mirror','reflexMirror'),automatic:true,prompt:'Watch the mirror'};
const capture=step('capture','Take a photo','shutterButton');
const lens=[step('aperture','Aperture','aperture',true),step('focus','Focus','focusGroup',true),
  step('zoom','Zoom','zoomGroup',true),
  step('lensRelease','Remove and attach lens','lensRelease')];
export function cameraInteractions(model){
  if(model==='film')return [step('load','Load film','filmBack'),capture,mirror,...lens,
    step('rewind','Rewind film','filmRewindRelease')];
  return [capture,...(model==='dslr'?[mirror]:[]),...lens];
}
export function nextCameraInteraction(model,current){
  const steps=cameraInteractions(model),index=steps.findIndex(step=>step.id===current);
  return index>=0?steps[index+1]?.id??null:null;
}
// The cutaway (Show/Hide internals) may switch under a running exploration
// demo, with no dissolve and no restart of the motion: only when the camera is
// in free exploration, an animation owns the lock, and no reveal or scene
// dissolve is in flight (those cross-fade between two fixed states).
export function canToggleInternalsLive({status,locked,animating,dissolving,revealing}){
  return status==='intro'&&Boolean(locked)&&Boolean(animating)&&!dissolving&&!revealing;
}
