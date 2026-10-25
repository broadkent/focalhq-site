// Studio turn extension (register #16): a dial that turns the bust while the lamps stay put.
//
//   extTurn {degrees}   the bust's turn about its own upright axis: 0 faces the camera, positive turns the
//                       nose toward the viewer's right, -180 to 180
//
// The lamps, the camera and the lamp target stay where they are, so the light falls on a new side of the
// face. Anything attached to the bust (the glasses and the hat of studio_ext_set.js) turns with it.
// State: ext.turn.degrees.
import {clamp,finite} from './studio_ext_math.js';

export function createExtTurn(ctx){
  let degrees=0;
  return {
    command(value){
      if(!finite(value?.degrees))return;
      degrees=clamp(value.degrees,-180,180);
      const bust=ctx.getBust();
      if(!bust)return;
      bust.rotation.y=degrees*Math.PI/180;bust.updateMatrixWorld(true);
      ctx.markShadows();ctx.invalidate();
    },
    /** The turn is the bust's, so a new bust model starts at 0 unless this puts it back. */
    state:()=>({degrees}),
    dispose(){const bust=ctx.getBust?.();if(bust){bust.rotation.y=0;bust.updateMatrixWorld(true);}},
  };
}
