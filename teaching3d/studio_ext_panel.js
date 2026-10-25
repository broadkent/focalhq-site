// Studio panel extension (register #13): a movable flat panel prop.
//
//   extPanel {kind, lamp?, fill?, x?, y?, z?, size?, level?, t?, shift?}
//     kind   'card' | 'backdrop' | 'diffusion' | 'softbox' | 'flag' | null (no panel)
//     x y z  meters from the face (x right, y up, z toward the camera): a card's and a flag's place
//     size   meters, the panel's width (its height is 1.25 times that)
//     level  0..1, a backdrop's own brightness
//     t      0..1, a flag's place on the line from the lamp to the face
//     shift  meters, a flag's slide across that line
//   extPanel {kind:null}  takes the panel away and puts the lamps back as they were
//
// How each lights the bust, with the Studio's own lamps (the renderer has one light model):
//   card       white card; a bounce lamp (the fill, `fill`) stands at the card, its brightness the key's
//              scaled by how near the card is (studio_ext_math.cardBounce)
//   backdrop   a wide self-lit plane behind the bust at its own brightness
//   diffusion  a translucent sheet just in front of the lamp: the lamp takes the sheet's width (softer) and
//              loses 40 percent of its light
//   softbox    the lamp in a deep dark housing with a white front, the housing's width, 15 percent dimmer
//   flag       a black card on the line from the lamp to the face that casts a real shadow over part of it
//              (shifted across the line by default); the fill lamp stays on at 22 percent so the rest still reads
// State: ext.panel.
import {along,cardBounce,clamp,finite,FACE_Y_WORLD,toWorld,WUM} from './studio_ext_math.js';
import {flat,lampState,makeGroup,patchLamp} from './studio_ext_util.js';

const KINDS=['card','backdrop','diffusion','softbox','flag'];
const ASPECT=1.25;
/** The room fill a flag leaves on, percent. */
export const FLAG_FILL_PERCENT=22;

export function createExtPanel(ctx){
  const {THREE}=ctx;
  const mk=makeGroup(THREE,ctx.scene,'studioExtPanel');
  const target=new THREE.Vector3(0,FACE_Y_WORLD,0);
  const st={kind:null,lamp:'light-1',fill:'light-2',x:.6,y:0,z:.7,size:.6,level:.5,t:.45,shift:.14};
  // The lamps as they were before the panel changed them: {id: {width, brightnessPercent, enabled, position}}.
  let held={};
  let backdrop=null;

  function hold(id){
    if(held[id])return held[id];
    const s=lampState(ctx,id);
    if(!s)return null;
    return held[id]={width:s.width,brightnessPercent:s.brightnessPercent,enabled:s.enabled,position:[...s.position]};
  }
  function restore(){
    for(const [id,was] of Object.entries(held))patchLamp(ctx,id,was);
    held={};
  }
  function lampPosition(){
    const s=lampState(ctx,st.lamp);
    return s?new THREE.Vector3(...s.position):new THREE.Vector3(toWorld(.6),FACE_Y_WORLD+toWorld(.6),toWorld(.9));
  }
  const place=(mesh,position)=>{mesh.position.copy(position);mesh.lookAt(target);return mesh;};
  const sized=mesh=>{mesh.scale.set(toWorld(st.size),toWorld(st.size)*ASPECT,1);return mesh;};

  function rebuild(){
    mk.clear();backdrop=null;
    if(!KINDS.includes(st.kind)){restore();ctx.markShadows();ctx.invalidate();return;}
    const origin=lampPosition(),face=new THREE.Vector3(0,FACE_Y_WORLD,0);
    if(st.kind==='card'){
      const at=new THREE.Vector3(toWorld(st.x),FACE_Y_WORLD+toWorld(st.y),toWorld(st.z));
      const card=sized(place(new THREE.Mesh(new THREE.PlaneGeometry(1,1),flat(THREE,.96,{side:THREE.DoubleSide})),at));
      card.castShadow=true;mk.group.add(card);
      const key=lampState(ctx,st.lamp),fill=hold(st.fill);
      if(fill&&key){
        const distanceM=at.distanceTo(face)/WUM;
        patchLamp(ctx,st.fill,{position:at.toArray(),width:toWorld(st.size),brightnessPercent:cardBounce(key.brightnessPercent,distanceM),enabled:true});
      }
    }else if(st.kind==='backdrop'){
      const wall=new THREE.Mesh(new THREE.PlaneGeometry(1,1),flat(THREE,st.level,{side:THREE.DoubleSide}));
      wall.scale.set(toWorld(4),toWorld(3),1);wall.position.set(0,FACE_Y_WORLD,-toWorld(.9));
      mk.group.add(wall);backdrop=wall;
    }else if(st.kind==='diffusion'||st.kind==='softbox'){
      const base=hold(st.lamp);
      const toward=face.clone().sub(origin).normalize();
      if(st.kind==='diffusion'){
        const at=origin.clone().addScaledVector(toward,toWorld(.2));
        // An opaque pale sheet: nothing in the print is translucent. It stands at the lamp, out of the picture.
        const sheet=new THREE.Mesh(new THREE.PlaneGeometry(1,1),flat(THREE,.9,{side:THREE.DoubleSide}));
        sized(place(sheet,at));mk.group.add(sheet);
        if(base)patchLamp(ctx,st.lamp,{width:Math.max(base.width,toWorld(st.size)),brightnessPercent:base.brightnessPercent*.6});
      }else{
        const depth=toWorld(.35),box=new THREE.Group();
        const shell=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),flat(THREE,.1));
        shell.scale.set(toWorld(st.size),toWorld(st.size)*ASPECT,depth);shell.position.z=-depth/2-.01;
        const front=new THREE.Mesh(new THREE.PlaneGeometry(1,1),flat(THREE,.97));
        sized(front);box.add(shell,front);
        box.position.copy(origin).addScaledVector(toward,toWorld(.05));box.lookAt(face);
        mk.group.add(box);
        if(base)patchLamp(ctx,st.lamp,{width:toWorld(st.size),brightnessPercent:base.brightnessPercent*.85});
      }
    }else{
      // A flag cuts light from part of the face, never all of it: a dim room fill stays on beside it.
      const fill=hold(st.fill);
      if(fill)patchLamp(ctx,st.fill,{enabled:true,brightnessPercent:Math.max(fill.brightnessPercent,FLAG_FILL_PERCENT)});
      const line=along(origin.toArray(),face.toArray(),clamp(st.t,.1,.9));
      const at=new THREE.Vector3(...line);
      const flag=sized(place(new THREE.Mesh(new THREE.PlaneGeometry(1,1),flat(THREE,.03,{side:THREE.DoubleSide})),at));
      // Slide across the line: along the flag's own right-hand axis.
      flag.translateX(toWorld(st.shift));
      // The flag shows by its shadow: its own card would print as a black wedge across the picture's corner, so
      // it draws nothing (no colour, no depth) and still casts.
      flag.material.colorWrite=false;flag.material.depthWrite=false;
      flag.castShadow=true;flag.receiveShadow=false;mk.group.add(flag);
    }
    ctx.markShadows();ctx.invalidate();
  }

  return {
    command(value){
      if(!value||typeof value!=='object')return;
      const before=st.kind;
      if('kind' in value&&(value.kind===null||KINDS.includes(value.kind))){
        if(value.kind!==st.kind)restore();
        st.kind=value.kind;
      }
      for(const key of ['lamp','fill'])if(typeof value[key]==='string')st[key]=value[key];
      for(const key of ['x','y','z','size','level','t','shift'])if(finite(value[key]))st[key]=value[key];
      st.size=clamp(st.size,.2,2);st.level=clamp(st.level,0,1);st.t=clamp(st.t,.1,.9);
      // A lamp-attached kind re-reads the lamp it changed: put it back first, so the base is the learner's.
      if(before===st.kind&&(st.kind==='diffusion'||st.kind==='softbox'||st.kind==='card'))restore();
      if(before===st.kind&&st.kind==='backdrop'&&backdrop&&Object.keys(value).every(k=>k==='level'||k==='kind')){
        backdrop.material.color.setRGB(st.level,st.level,st.level,THREE.SRGBColorSpace);ctx.invalidate();return;
      }
      rebuild();
    },
    state(){return {kind:st.kind,lamp:st.lamp,x:st.x,y:st.y,z:st.z,size:st.size,level:st.level,t:st.t,shift:st.shift,held:Object.keys(held)};},
    dispose(){restore();mk.dispose();},
  };
}
