// The Studio extensions (lab tools #12, #13, #15, #16, #37, #38, #52; docs/plan/curriculum/lesson_maps.md "New
// tools and games register"). One registration point: lesson_studio.js builds this with its own ctx and asks it
// last, so every extension lives in its own file and the lesson bridge changes by a few lines.
// Loaded only with lesson=1, like lesson_studio.js; a page that never sends an ext command builds nothing in the
// scene (each module makes its meshes on its first command).
//
// Commands (all ignored unless lesson=1):
//   extCamera {x, z, height, bust:{x,z}, reset}   studio_ext_camera.js
//   extPanel {kind, lamp, fill, x, y, z, size, level, t, shift}   studio_ext_panel.js
//   extSky {on, hour, cloud, dome, ground, wall, wallAngle, lamp}   studio_ext_sky.js
//   extTurn {degrees}   studio_ext_turn.js
//   extFlash {lamp, on, stops, ambient, fire:{count}, reset}   studio_ext_flash.js
//   extTint {lamp, warmth, clear}   studio_ext_tint.js
//   extSet {pieces, piece, on, count}   studio_ext_set.js
//   extReset {}   every extension back to its resting state
// The thin-lens defocus (#27) is the lab's own: the host sends `aperture` and `auto`, nothing here.
// Published state (lesson only): ext = {camera, panel, sky, turn, flash, tint, set}, each module's state.
import {createExtCamera} from './studio_ext_camera.js';
import {createExtPanel} from './studio_ext_panel.js';
import {createExtSky} from './studio_ext_sky.js';
import {createExtTurn} from './studio_ext_turn.js';
import {createExtFlash} from './studio_ext_flash.js';
import {createExtTint} from './studio_ext_tint.js';
import {createExtSet} from './studio_ext_set.js';

const ACTIONS={extCamera:'camera',extPanel:'panel',extSky:'sky',extTurn:'turn',extFlash:'flash',extTint:'tint',extSet:'set'};

export function createStudioExt(ctx){
  // Each module is built on its first command, so a lesson that never uses one pays nothing.
  const modules={},factories={
    camera:createExtCamera,panel:createExtPanel,sky:createExtSky,turn:createExtTurn,
    flash:createExtFlash,tint:createExtTint,set:createExtSet,
  };
  const get=name=>modules[name]??=factories[name](ctx);
  const each=fn=>{for(const module of Object.values(modules))fn(module);};

  return {
    /** Handles a host command; true when it was (or was refused as) one of ours. */
    command(action,value){
      if(action==='extReset'){
        for(const name of Object.keys(modules).reverse()){modules[name].dispose?.();delete modules[name];}
        ctx.invalidate();ctx.publishState();return true;
      }
      const name=ACTIONS[action];
      if(!name)return false;
      get(name).command(value);
      ctx.publishState();
      return true;
    },
    /** lesson_studio.js fitZoom: the camera tool's distance, or null. */
    fitZoom:fitDistance=>modules.camera?.fitZoom(fitDistance)??null,
    /** Called every draw (lesson_studio.js stage): keeps tint and sky light colours across rebuilt sources and themes. */
    frame:()=>each(module=>module.frame?.()),
    /** Scenery the exposure meter never reads. */
    meteringHidden:()=>Object.values(modules).flatMap(module=>module.meteringHidden?.()??[]),
    /** Folded into the meter key so the meter reads again when the ambient light or a flash pulse changes. */
    meterKey:()=>Object.values(modules).map(module=>module.meterKey?.()??'').join('|'),
    state:()=>Object.fromEntries(Object.entries(modules).map(([name,module])=>[name,module.state()])),
    dispose:()=>each(module=>module.dispose?.()),
  };
}
