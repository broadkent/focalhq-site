// Helpers the Studio extension modules share (studio_ext.js): lamp edits through the session, a group
// for their meshes, and disposal. Nothing here runs unless a studio_ext command arrives.
import {clampLampPosition,clampLampWidth} from './lamp_rig.js';
import {clamp,finite} from './studio_ext_math.js';

/**
 * Edits lamp [id] the way the lessons' `sizeOf` and a still's state do: through the session, then the source,
 * its shadows and a published state. Returns the lamp's state, or null for an unknown id.
 * [patch]: position (world units), width (world units), brightnessPercent, enabled.
 */
export function patchLamp(ctx,id,patch){
  const states=ctx.getSourceStates();
  if(!states.some(state=>state.id===id))return null;
  const next={};
  if(Array.isArray(patch.position)&&patch.position.length===3&&patch.position.every(finite))next.position=clampLampPosition(patch.position);
  if(finite(patch.width)){const width=clampLampWidth(patch.width);next.width=width;next.height=width*1.25;}
  if(finite(patch.brightnessPercent)){
    const percent=clamp(patch.brightnessPercent,0,100);
    next.brightnessPercent=percent;next.powerStops=percent>0?Math.log2(percent/50):null;
  }
  if(typeof patch.enabled==='boolean')next.enabled=patch.enabled;
  ctx.session.updateLight(id,next);ctx.refreshSessionState();
  const source=ctx.getSources().find(s=>s.state.id===id);
  if(source)ctx.syncSource(source);
  ctx.markShadows(source?[source]:undefined);ctx.invalidate();ctx.publishState();
  return ctx.getSourceStates().find(state=>state.id===id)??null;
}

/** The lamp's current state, or null. */
export const lampState=(ctx,id)=>ctx.getSourceStates().find(state=>state.id===id)??null;

/** Frees [root]'s geometry and materials, except any a clone shares with another object (userData.shared). */
export function disposeTree(root){
  root.traverse(object=>{
    const shared=object.userData?.shared===true;
    if(!shared)object.geometry?.dispose();
    // A clone's own material (userData.ownMaterial) is freed even though its geometry is shared.
    if(!shared||object.userData.ownMaterial)for(const material of [].concat(object.material??[]))material.dispose();
  });
}

/** One group in the scene for an extension's meshes; `clear()` disposes what is in it. */
export function makeGroup(THREE,scene,name){
  const group=new THREE.Group();group.name=name;scene.add(group);
  return {
    group,
    clear(){
      for(const child of [...group.children]){
        group.remove(child);
        disposeTree(child);
      }
    },
    dispose(){this.clear();scene.remove(group);},
  };
}

/**
 * A lit matte mesh material in the Studio's gray print tones; [tone] 0..1 sRGB. The lamps light only a cone
 * round the bust (area_light.js), so a prop outside it would print black: [glow] (0..1) of its tone is
 * self-lit, which keeps it readable anywhere and lets a lamp in reach still shade it.
 */
export function matte(THREE,tone,{glow=.45,...extra}={}){
  const material=new THREE.MeshStandardMaterial({roughness:.95,metalness:0,...extra});
  material.color.setRGB(tone,tone,tone,THREE.SRGBColorSpace);
  material.emissive.setRGB(tone*glow,tone*glow,tone*glow,THREE.SRGBColorSpace);
  return material;
}

/** Sets lamp [id]'s light colour (linear rgb 0..1), on every sample light. */
export function colorLamp(ctx,id,rgb){
  const source=ctx.getSources().find(s=>s.state.id===id);
  if(!source)return false;
  for(const {light} of source.area.samples)light.color.setRGB(rgb[0],rgb[1],rgb[2]);
  ctx.invalidate();
  return true;
}

/** A self-lit material of [tone] (0..1 sRGB): its luminance prints as dots whatever the lamps do. */
export function flat(THREE,tone,extra={}){
  const material=new THREE.MeshBasicMaterial(extra);
  material.color.setRGB(tone,tone,tone,THREE.SRGBColorSpace);
  return material;
}

/** Turns [object] to face [point] (world), z axis toward it: a panel's front looks at the bust. */
export function faceToward(object,point){
  object.lookAt(point);
}
