// Studio set pieces extension (register #52): simple solids beyond the bust.
//
//   extSet {pieces: ['relief', 'tower', 'busts', 'glasses', 'hat', 'leaf'], count?}   exactly these, no others
//   extSet {piece, on}                                                                  one piece in or out
//
//   relief   a square relief tile (ridges and a boss) beside the face, turned a little to the camera
//   tower    a stepped tower block behind and to the right
//   busts    busts receding behind, left and right in turn ([count] 2 to 5, default 3), clones of the bust
// Every piece stays whole inside the working frame (the camera sees about half a meter across at the bust).
//   glasses  round frames on the bust's eyes; they turn with the bust
//   hat      a felt hat on the bust's head; it turns with the bust
//   leaf     a curled leaf on a stem low at the bust's left
// The lamps light only a cone round the bust, so each solid is a matte tone with part of it self-lit (matte() in
// studio_ext_util.js): readable anywhere, shaded by a lamp that reaches it. Every solid casts a shadow.
// Pieces outside the bust are hidden from the exposure meter. State: ext.set = {pieces, count}.
import {clamp,finite,FACE_Y_WORLD,GROUND_Y_WORLD,toWorld} from './studio_ext_math.js';
import {disposeTree,flat,makeGroup,matte} from './studio_ext_util.js';

export const PIECES=Object.freeze(['relief','tower','busts','glasses','hat','leaf']);
const m=toWorld;

/** The relief tile's height at (u, v), each -1..1: concentric ridges round a boss, fading to the edge. */
export function reliefHeight(u,v){
  const r=Math.hypot(u,v),edge=Math.max(0,1-Math.max(Math.abs(u),Math.abs(v))**4);
  return edge*(.55*Math.exp(-r*r*7)+.22*Math.max(0,Math.cos(r*14))*Math.exp(-r*r*2));
}

export function createExtSet(ctx){
  const {THREE}=ctx;
  const mk=makeGroup(THREE,ctx.scene,'studioExtSet');
  const on=new Set();
  let count=3;
  let attached=[];

  function shadowed(object){object.traverse(o=>{if(o.isMesh)o.castShadow=true;});return object;}
  function relief(){
    const size=m(.13),geometry=new THREE.PlaneGeometry(size,size,48,48),position=geometry.attributes.position;
    for(let i=0;i<position.count;i++){
      position.setZ(i,reliefHeight(position.getX(i)/(size/2),position.getY(i)/(size/2))*m(.02));
    }
    geometry.computeVertexNormals();
    const tile=new THREE.Mesh(geometry,matte(THREE,.8,{glow:.12,side:THREE.DoubleSide}));
    tile.position.set(m(.17),FACE_Y_WORLD-m(.03),m(.02));tile.rotation.y=-.45;
    return shadowed(tile);
  }
  function tower(){
    const group=new THREE.Group();
    let y=0;
    for(const [w,h,tone] of [[.15,.17,.62],[.115,.15,.74],[.08,.13,.86]]){
      const block=new THREE.Mesh(new THREE.BoxGeometry(m(w),m(h),m(w)),matte(THREE,tone));
      block.position.y=y+m(h)/2;y+=m(h);group.add(block);
    }
    group.position.set(m(.24),FACE_Y_WORLD-m(.27),-m(.45));group.rotation.y=.5;
    return shadowed(group);
  }
  function busts(){
    const source=ctx.getBust();
    const group=new THREE.Group();
    for(let i=1;i<=count;i++){
      const clone=source.clone(true);
      // The clones share the bust's geometry and materials: never freed with the row.
      // The geometry is shared; each clone gets its own self-lit material so a clone outside the lamps' cone
      // still prints (the lamps light only a cone round the bust).
      clone.traverse(o=>{
        o.userData={...o.userData,shared:true};
        if(!o.isMesh)return;
        o.material=[].concat(o.material).map(material=>{
          const own=material.clone();
          own.emissive?.setRGB(.16,.16,.16);
          return own;
        });
        if(o.material.length===1)o.material=o.material[0];
        o.userData.ownMaterial=true;
      });
      // Alternate left and right, each farther out and back, so every clone shows beside the one before.
      const side=i%2?-1:1,rank=Math.ceil(i/2);
      clone.scale.setScalar(.8);clone.position.set(side*m(.13+.07*(rank-1)),0,-m(.1)*i);clone.rotation.y=-side*.25;clone.rotation.x=0;
      group.add(clone);
    }
    return group;
  }
  function leaf(){
    const group=new THREE.Group(),length=m(.16),width=m(.07);
    const shape=new THREE.Shape();
    shape.moveTo(0,0);
    shape.quadraticCurveTo(width*.9,length*.28,0,length);
    shape.quadraticCurveTo(-width*.9,length*.28,0,0);
    const geometry=new THREE.ShapeGeometry(shape,12),position=geometry.attributes.position;
    // A curl along the length and a fold down the midrib.
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i);
      position.setZ(i,(y/length)**2*m(.03)+Math.abs(x)*.35);
    }
    geometry.computeVertexNormals();
    const blade=new THREE.Mesh(geometry,matte(THREE,.58,{side:THREE.DoubleSide}));
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(m(.003),m(.004),m(.09),6),matte(THREE,.4));
    stem.position.y=-m(.045);
    group.add(blade,stem);
    group.position.set(-m(.2),FACE_Y_WORLD-m(.16),m(.1));group.rotation.set(-.35,.5,.25);
    return shadowed(group);
  }
  /** The head's top, the eyes' middle and where the face stands there, in the bust's own coordinates (turn and
   *  place undone): the frames sit on the face and the temples reach the ears at any turn. */
  function head(){
    const bust=ctx.getBust(),saved=[bust.rotation.y,bust.position.x,bust.position.z];
    bust.rotation.y=0;bust.position.x=0;bust.position.z=0;bust.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(bust);
    const eyes=(bust.userData.getEyeLandmarks?.().all??[]).map(e=>new THREE.Vector3(...e.local));
    const mid=eyes.length?eyes.reduce((s,e)=>s.add(e),new THREE.Vector3()).divideScalar(eyes.length):new THREE.Vector3(0,box.max.y-m(.1),m(.08));
    const span=eyes.length>1?Math.max(...eyes.map(e=>e.x))-Math.min(...eyes.map(e=>e.x)):m(.062);
    const ray=new THREE.Raycaster(),far=m(.6);
    const hit=(from,dir)=>{ray.set(from,dir);return ray.intersectObject(bust,true)[0]?.point??null;};
    const frontAt=(x,y)=>hit(new THREE.Vector3(x,y,mid.z+far),new THREE.Vector3(0,0,-1))?.z??mid.z;
    const sideAt=(z,y,side)=>hit(new THREE.Vector3(side*far,y,z),new THREE.Vector3(-side,0,0))?.x??side*m(.075);
    const result={top:box.max.y,center:box.getCenter(new THREE.Vector3()),mid,span};
    // Each ring stands in front of the face's most forward surface round the eye: the nearest hit over several
    // rays across the ring's disc, so the brow and cheek never bury it (they do in profile).
    const reach=span*.38;
    result.rings=[-1,1].map(side=>{
      let z=-Infinity;
      for(let k=0;k<9;k++){
        const a=k*Math.PI/4,r=k===8?0:reach;
        z=Math.max(z,frontAt(side*span/2+Math.cos(a)*r,mid.y+Math.sin(a)*r));
      }
      return z;
    });
    result.bridge=frontAt(0,mid.y);
    result.ears=[-1,1].map(side=>sideAt(mid.z-m(.1),mid.y,side));
    [bust.rotation.y,bust.position.x,bust.position.z]=saved;bust.updateMatrixWorld(true);
    return result;
  }
  function glasses(h){
    const group=new THREE.Group(),ink=flat(THREE,.06);
    const r=h.span*.38,tube=m(.0035),lift=tube+m(.004);
    [-1,1].forEach((side,k)=>{
      const z=h.rings[k]+lift;
      const ring=new THREE.Mesh(new THREE.TorusGeometry(r,tube,8,32),ink);
      ring.position.set(side*h.span/2,h.mid.y,z);
      // Frames wrap the face a little, so a turned head still shows them.
      ring.rotation.y=side*.3;group.add(ring);
      // The temple runs from the ring's outer edge straight back to the ear, on the head's side.
      const from=new THREE.Vector3(side*(h.span/2+r),h.mid.y,z);
      const to=new THREE.Vector3(side*(Math.abs(h.ears[k])+tube),h.mid.y,h.mid.z-m(.1));
      const temple=new THREE.Mesh(new THREE.CylinderGeometry(tube,tube,from.distanceTo(to),6),ink);
      temple.position.copy(from).add(to).multiplyScalar(.5);
      temple.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),to.clone().sub(from).normalize());
      group.add(temple);
    });
    const bridge=new THREE.Mesh(new THREE.CylinderGeometry(tube,tube,Math.max(h.span-2*r,m(.01)),6),ink);
    bridge.rotation.z=Math.PI/2;bridge.position.set(0,h.mid.y+r*.35,h.bridge+lift);group.add(bridge);
    return group;
  }
  function hat(h){
    const group=new THREE.Group(),tone=.16;
    const crown=new THREE.Mesh(new THREE.CylinderGeometry(m(.085),m(.095),m(.1),24),matte(THREE,tone,{glow:.3}));
    const brim=new THREE.Mesh(new THREE.CylinderGeometry(m(.17),m(.17),m(.008),32),matte(THREE,tone+.04,{glow:.3}));
    crown.position.y=m(.054);group.add(crown,brim);
    group.position.set(h.mid.x,h.top-m(.06),h.mid.z-m(.085));group.rotation.x=-.08;
    return shadowed(group);
  }

  function clearAttached(){
    const bust=ctx.getBust();
    for(const object of attached){bust?.remove(object);disposeTree(object);}
    attached=[];
  }
  function build(){
    mk.clear();clearAttached();
    const bust=ctx.getBust();
    if(on.has('relief'))mk.group.add(relief());
    if(on.has('tower'))mk.group.add(tower());
    if(on.has('busts')&&bust)mk.group.add(busts());
    if(on.has('leaf'))mk.group.add(leaf());
    if(bust&&(on.has('glasses')||on.has('hat'))){
      const h=head();
      for(const [name,make] of [['glasses',glasses],['hat',hat]]){
        if(!on.has(name))continue;
        const piece=make(h);bust.add(piece);attached.push(piece);
      }
    }
    ctx.markShadows();ctx.invalidate();
  }

  return {
    command(value){
      if(!value||typeof value!=='object')return;
      if(finite(value.count))count=clamp(Math.round(value.count),2,5);
      if(Array.isArray(value.pieces)){
        on.clear();
        for(const piece of value.pieces)if(PIECES.includes(piece))on.add(piece);
      }else if(PIECES.includes(value.piece)&&typeof value.on==='boolean'){
        if(value.on)on.add(value.piece);else on.delete(value.piece);
      }else if(!('count' in value))return;
      build();
    },
    meteringHidden:()=>[mk.group],
    state:()=>({pieces:PIECES.filter(piece=>on.has(piece)),count}),
    dispose(){clearAttached();mk.dispose();},
  };
}
