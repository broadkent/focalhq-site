import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {CAMERA_LAYOUT} from './camera_layout.js';
import {createFilmTransport} from './film_transport.js';
import {FilmStockMaterial} from './film_stock_material.js';
const smooth=value=>{const p=THREE.MathUtils.clamp(value,0,1);return p*p*p*(p*(p*6-15)+10);};

// A schematic recording-medium variation of the current DSLR. Dimensions
// follow its approved image area, not a manufacturer camera's body dimensions.
export const FILM_LAYOUT=Object.freeze({
  imageWidth:1.32,imageHeight:.88,stockHeight:1.32*35/36,
  cartridgeX:1.62,cartridgeRadius:.30,takeupX:-1.30,takeupRadius:.26,
  perforationPitch:1.32*4.75/36,perforationWidth:.10,perforationHeight:.07,
  perforationY:.54,
  framePitch:1.32*38/36,stockThickness:.0012,
});

function roundedRectangle(w,h,r){
  const s=new THREE.Shape();
  s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);
  s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);
  s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);
  s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);
  s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
  return s;
}

export function createFilmVariant({registry,model,shell,body,rearBacking,
  rearScreen,rearControls,sensor,filmZ,material,addPrintedEdges}){
  const f=FILM_LAYOUT,layout=CAMERA_LAYOUT;
  const frontZ=layout.bodyCenterZ+layout.bodyDepth/2+.025;
  const backZ=layout.bodyCenterZ-layout.bodyDepth/2-.025;
  const root=new THREE.Group();root.name='filmVariant';model.add(root);
  // Parent visibility is outside the material/context snapshot. Never toggle
  // individual digital meshes: a focus treatment must not resurrect the LCD.
  const digitalBody=new THREE.Group();shell.add(digitalBody);digitalBody.add(body);
  const digitalGroups=[digitalBody,rearBacking,rearScreen,rearControls,sensor];
  const originals=digitalGroups.map(group=>group.visible);
  const filmBody=registry.add('filmBody','Film camera body',root);
  const back=registry.add('filmBack','Film back',root);
  const pressurePlate=registry.add('filmPressurePlate','Pressure plate',back);
  const cartridge=registry.add('filmCartridge','Film cartridge',root);
  const takeup=registry.add('filmTakeup','Take-up spool',root);
  const gate=registry.add('filmGate','Film gate and guide rails',root);
  const strip=registry.add('filmStrip','Film',root);
  const sprocket=registry.add('filmSprocket','Film sprocket',root);
  const rewind=registry.add('filmRewind','Rewind crank',root);
  const rewindBase=registry.ids().includes('controlDial')?registry.get('controlDial'):null;
  const rewindBaseParent=rewindBase?.parent;
  const advance=registry.add('filmAdvance','Film advance lever',root);
  const rewindRelease=registry.add('filmRewindRelease','Rewind release button',root);
  function mesh(geometry,color,parent,x=0,y=0,z=0){
    const object=addPrintedEdges(new THREE.Mesh(geometry,material(color)));
    object.position.set(x,y,z);parent.add(object);return object;
  }
  const box=(w,h,d,color,parent,x,y,z)=>mesh(new THREE.BoxGeometry(w,h,d),color,parent,x,y,z);
  const cylinder=(r,h,color,parent,x,y,z)=>
    mesh(new THREE.CylinderGeometry(r,r,h,32),color,parent,x,y,z);
  const extrude=(shape,depth,color,parent,z)=>mesh(new THREE.ExtrudeGeometry(shape,{
    depth,bevelEnabled:false,steps:1,curveSegments:24,
  }),color,parent,0,0,z);

  // Keep the DSLR outline but hollow out the former solid side sections for
  // the two film chambers. The original digital body is restored verbatim.
  const face=roundedRectangle(layout.bodyWidth,2.45,.23);
  const opening=new THREE.Path();opening.absarc(layout.opticalCenterX,0,
    layout.frontOpeningRadius,0,Math.PI*2,true);face.holes.push(opening);
  const walls=roundedRectangle(layout.bodyWidth,2.45,.23);
  const cavity=roundedRectangle(layout.bodyWidth-.14,2.45-.14,.18);
  walls.holes.push(new THREE.Path(cavity.getPoints(12).reverse()));
  // A single front skin closes the open-ended chamber walls. A separate
  // extruded slab overlaps their front ring and creates doubled cutaway planes.
  const frontGeometry=new THREE.ShapeGeometry(face,24).toNonIndexed();
  frontGeometry.translate(0,0,frontZ-backZ);
  const wallGeometry=new THREE.ExtrudeGeometry(walls,{
    depth:frontZ-backZ,bevelEnabled:false,steps:1,curveSegments:24,
  });
  const combined=new THREE.BufferGeometry();
  for(const name of ['position','normal','uv']){
    const values=Array.from(frontGeometry.attributes[name].array);
    const attribute=wallGeometry.attributes[name],position=wallGeometry.attributes.position;
    for(let i=0;i<position.count;i+=3){
      if([i,i+1,i+2].every(index=>position.getZ(index)>frontZ-backZ-1e-5))continue;
      for(let j=i;j<i+3;j++)for(let k=0;k<attribute.itemSize;k++)values.push(attribute.array[j*attribute.itemSize+k]);
    }
    combined.setAttribute(name,new THREE.Float32BufferAttribute(values,frontGeometry.attributes[name].itemSize));
  }
  frontGeometry.dispose();wallGeometry.dispose();
  const bodyWalls=mesh(combined,'#808080',filmBody,0,0,backZ);
  // The open back exposes the inside of this same skin, not a second plane.
  bodyWalls.material.side=THREE.DoubleSide;
  // Split front contours from the existing wall ink. Rear/depth edges stay
  // unchanged; the front retains only faint technical context in cutaways.
  const wallOutline=bodyWalls.children[0],positions=wallOutline.geometry.attributes.position;
  const frontEdges=[],otherEdges=[];
  for(let i=0;i<positions.count;i+=2){
    const target=positions.getZ(i)>frontZ-backZ-1e-5&&positions.getZ(i+1)>frontZ-backZ-1e-5?frontEdges:otherEdges;
    for(const index of [i,i+1])target.push(positions.getX(index),positions.getY(index),positions.getZ(index));
  }
  const edges=data=>new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(data,3));
  wallOutline.geometry.dispose();wallOutline.geometry=edges(otherEdges);
  const frontOutline=new THREE.LineSegments(edges(frontEdges),wallOutline.material.clone());
  frontOutline.userData={printOutline:true,slrFrontOutline:true};bodyWalls.add(frontOutline);

  // One plain back replaces both the digital rear skin and screen. Its hinge
  // and pressure plate belong to the door, ready for a later loading lesson.
  back.position.set(-layout.bodyWidth/2,0,backZ);
  // The rear eyecup extends below the body's top edge. Cut a real notch in
  // the hinged plate around that hardware rather than covering it with ink.
  model.updateMatrixWorld(true);
  const finderBounds=new THREE.Box3();
  if(registry.ids().includes('viewfinder'))registry.get('viewfinder').traverse(object=>{
    if(!object.isMesh)return;
    const bounds=new THREE.Box3().setFromObject(object,true);
    if(bounds.min.z<backZ-.001)finderBounds.union(bounds);
  });
  // Independent geometry fixtures can omit the finder; use its approved rear
  // footprint in that case. The plate tucks slightly beneath the housing so
  // the closed back has no visible seam around its sides or lower edge.
  if(finderBounds.isEmpty())finderBounds.set(
    new THREE.Vector3(layout.opticalCenterX-.435,.85,backZ-.08),
    new THREE.Vector3(layout.opticalCenterX+.435,1.56,backZ));
  const notchOverlap=.02;
  const notchLeft=finderBounds.min.x+notchOverlap,notchRight=finderBounds.max.x-notchOverlap;
  const notchBottom=finderBounds.min.y+notchOverlap,notchRadius=.035;
  const halfWidth=layout.bodyWidth/2,halfHeight=2.45/2,corner=.23;
  const panelShape=new THREE.Shape();
  panelShape.moveTo(-halfWidth+corner,-halfHeight);panelShape.lineTo(halfWidth-corner,-halfHeight);
  panelShape.quadraticCurveTo(halfWidth,-halfHeight,halfWidth,-halfHeight+corner);
  panelShape.lineTo(halfWidth,halfHeight-corner);panelShape.quadraticCurveTo(halfWidth,halfHeight,halfWidth-corner,halfHeight);
  panelShape.lineTo(notchRight,halfHeight);panelShape.lineTo(notchRight,notchBottom+notchRadius);
  panelShape.quadraticCurveTo(notchRight,notchBottom,notchRight-notchRadius,notchBottom);
  panelShape.lineTo(notchLeft+notchRadius,notchBottom);
  panelShape.quadraticCurveTo(notchLeft,notchBottom,notchLeft,notchBottom+notchRadius);
  panelShape.lineTo(notchLeft,halfHeight);panelShape.lineTo(-halfWidth+corner,halfHeight);
  panelShape.quadraticCurveTo(-halfWidth,halfHeight,-halfWidth,halfHeight-corner);
  panelShape.lineTo(-halfWidth,-halfHeight+corner);panelShape.quadraticCurveTo(-halfWidth,-halfHeight,-halfWidth+corner,-halfHeight);
  panelShape.closePath();
  const panel=extrude(panelShape,.025,'#626262',back,-.025);
  panel.position.x=layout.bodyWidth/2;
  box(1.54,1.06,.018,'#393939',pressurePlate,
    layout.opticalCenterX+layout.bodyWidth/2,0,filmZ-backZ-.025);
  for(const y of [-.84,.84])cylinder(.055,.24,'#777777',back,.025,y,0);

  const cartridgeZ=filmZ+f.cartridgeRadius+.012;
  const takeupZ=filmZ+f.takeupRadius;
  cylinder(f.cartridgeRadius,1.58,'#393939',cartridge,f.cartridgeX,0,cartridgeZ);
  for(const y of [-.80,.80])cylinder(.32,.045,'#777777',cartridge,f.cartridgeX,y,cartridgeZ);
  cylinder(.085,1.82,'#777777',cartridge,f.cartridgeX,0,cartridgeZ);
  box(.15,f.stockHeight+.05,.09,'#393939',cartridge,f.cartridgeX-.20,0,filmZ+.03);
  const coil=cylinder(f.takeupRadius,1.28,'#626262',takeup,f.takeupX,0,takeupZ);
  for(const y of [-.71,.71])cylinder(.30,.05,'#393939',takeup,f.takeupX,y,takeupZ);
  cylinder(.075,1.74,'#777777',takeup,f.takeupX,0,takeupZ);
  box(.065,1.12,.016,'#303030',takeup,f.takeupX,0,takeupZ-f.takeupRadius-.004);

  // Rails leave the full recording aperture and the perforations unobstructed.
  for(const y of [-.68,.68])box(1.56,.045,.045,'#777777',gate,layout.opticalCenterX,y,filmZ+.0225);
  for(const x of [layout.opticalCenterX-.71,layout.opticalCenterX+.71])
    box(.06,1.28,.025,'#393939',gate,x,0,filmZ+.023);
  for(const y of [-.47,.47])box(1.36,.04,.025,'#393939',gate,layout.opticalCenterX,y,filmZ+.023);
  const sprocketRadius=.085,sprocketPitchRadius=f.perforationPitch*3/(Math.PI*2);
  const sprocketX=f.takeupX+4*f.perforationPitch,sprocketZ=filmZ+sprocketRadius+.012;
  const sprocketShaft=cylinder(sprocketRadius,1.18,'#777777',sprocket,sprocketX,0,sprocketZ);
  const sprocketTeeth=[];
  // Three teeth on this small pitch circle match the actual perforation pitch.
  // The shaft clears the flat stock; only the teeth reach through its holes.
  for(const y of [-f.perforationY,f.perforationY]){
    for(let i=0;i<3;i++){
      const angle=Math.PI+i*Math.PI*2/3;
      const tooth=box(.042,.042,.045,'#777777',sprocket,
        sprocketX+Math.sin(angle)*sprocketPitchRadius,y,sprocketZ+Math.cos(angle)*sprocketPitchRadius);
      tooth.rotation.y=angle;sprocketTeeth.push(tooth);
    }
  }

  const left=f.takeupX,right=f.cartridgeX-.16,h=f.stockHeight/2;
  const transport=createFilmTransport({framePitch:f.framePitch,leaderLength:right-left,
    wrapLength:f.takeupRadius*Math.PI*1.5,preparationTravel:right-(layout.opticalCenterX-f.imageWidth/2)});
  let holes=[];
  function stockGeometry(leader,travel){
    const filmShape=new THREE.Shape(),edge=right-Math.max(leader,.0001);
    filmShape.moveTo(edge,-h);filmShape.lineTo(right,-h);filmShape.lineTo(right,h);
    filmShape.lineTo(edge,h);filmShape.closePath();holes=[];
    const offset=THREE.MathUtils.euclideanModulo(-travel-(leader-(right-left)),f.perforationPitch);
    for(let x=left+offset;x<right;x+=f.perforationPitch){
      if(x<edge+f.perforationWidth/2||x>right-f.perforationWidth/2)continue;
      for(const y of [-f.perforationY,f.perforationY]){
        const hole=new THREE.Path(),w=f.perforationWidth/2,hh=f.perforationHeight/2;
        hole.moveTo(x-w,y-hh);hole.lineTo(x-w,y+hh);hole.lineTo(x+w,y+hh);
        hole.lineTo(x+w,y-hh);hole.closePath();filmShape.holes.push(hole);holes.push([x,y]);
      }
    }
    const geometry=new THREE.ShapeGeometry(filmShape),p=geometry.attributes.position;
    geometry.setAttribute('stockDistance',new THREE.Float32BufferAttribute(
      Array.from({length:p.count},(_,i)=>right-p.getX(i)),1));
    return geometry;
  }
  const filmSurface=mesh(stockGeometry(right-left,0), '#b2b2b2',strip,0,0,filmZ);
  function useStockMaterial(object){
    const previous=object.material;
    object.material=new FilmStockMaterial('#b2b2b2',previous.uniforms.accent.value);
    object.material.side=THREE.DoubleSide;object.userData.filmStockColor=true;
    object.userData.dynamicGeometry=true;object.children[0].userData.dynamicGeometry=true;
    previous.dispose();
  }
  useStockMaterial(filmSurface);
  filmSurface.material.side=THREE.DoubleSide;
  // The leader continues around the spool. Deform a perforated flat band
  // onto a cylinder, keeping its beginning tangent to the incoming strip.
  function wrapGeometry(radius,amount,travel){
    const length=radius*Math.PI*1.5*Math.max(amount,.001),shape=new THREE.Shape();
    shape.moveTo(0,-h);shape.lineTo(length,-h);shape.lineTo(length,h);shape.lineTo(0,h);shape.closePath();
    const offset=THREE.MathUtils.euclideanModulo(travel,f.perforationPitch);
    for(let u=offset;u<length;u+=f.perforationPitch){
      if(u<f.perforationWidth/2||u>length-f.perforationWidth/2)continue;
      for(const y of [-f.perforationY,f.perforationY]){
        const hole=new THREE.Path(),w=f.perforationWidth/2,hh=f.perforationHeight/2;
        hole.moveTo(u-w,y-hh);hole.lineTo(u-w,y+hh);hole.lineTo(u+w,y+hh);hole.lineTo(u+w,y-hh);hole.closePath();shape.holes.push(hole);
      }
    }
    // Add vertices along both long edges so even a short unperforated leader
    // curves around the spool instead of becoming a straight chord through it.
    const points=[new THREE.Vector2(0,-h)];
    for(let i=1;i<=48;i++)points.push(new THREE.Vector2(length*i/48,-h));
    points.push(new THREE.Vector2(length,h));
    for(let i=47;i>=0;i--)points.push(new THREE.Vector2(length*i/48,h));
    const band=new THREE.Shape(points);band.holes=shape.holes;
    const geometry=new THREE.ShapeGeometry(band),positions=geometry.attributes.position;
    const distances=[];
    for(let i=0;i<positions.count;i++){
      distances.push(right-left+positions.getX(i));
      const angle=positions.getX(i)/radius;
      positions.setXYZ(i,f.takeupX-radius*Math.sin(angle),positions.getY(i),takeupZ-radius*Math.cos(angle));
    }
    geometry.setAttribute('stockDistance',new THREE.Float32BufferAttribute(distances,1));
    geometry.computeVertexNormals();return geometry;
  }
  const wrap=mesh(wrapGeometry(f.takeupRadius+.002,1,0),'#b2b2b2',strip);
  useStockMaterial(wrap);
  wrap.material.side=THREE.DoubleSide;
  // A moving outline at frame pitch makes stock displacement legible even
  // when eight perforations return to the same positions at a full stroke.
  const witnesses=Array.from({length:4},(_,i)=>mesh(new THREE.BoxGeometry(.008,f.imageHeight,.002),'#777777',strip,
    layout.opticalCenterX-f.imageWidth/2+(i-1)*f.framePitch,0,filmZ-.003));
  const witness=witnesses[1];

  // Keep the existing top controls; add only the recognizable film hardware.
  const dialX=layout.opticalCenterX+layout.viewfinderWidth/2+layout.controlDialRadius+layout.controlDialClearance;
  // Thin formed levers, informed by the FM2 manual's top views (pp. 3, 15).
  // This schematic deliberately shares the existing shutter button's axis.
  const advancePivot=new THREE.Group();advancePivot.position.set(-1.46,1.31,layout.bodyCenterZ);advance.add(advancePivot);
  const plate=(shape,thickness,color,parent)=>{
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:16});
    geometry.translate(0,0,-thickness/2);geometry.rotateX(-Math.PI/2);
    return mesh(geometry,color,parent);
  };
  const collar=new THREE.Shape();collar.absarc(0,0,.225,0,Math.PI*2,false);
  const buttonClearance=new THREE.Path();buttonClearance.absarc(0,0,.175,0,Math.PI*2,true);collar.holes.push(buttonClearance);
  plate(collar,.032,'#777777',advancePivot);
  // Parallel edges carry a full-width arm into the pivot disk; the previous
  // curved neck pinched to a narrow point at this connection.
  const arm=new THREE.Shape();arm.moveTo(.065,.115);arm.lineTo(.75,.255);
  arm.lineTo(.73,.36);arm.lineTo(.045,.22);arm.closePath();
  const advanceArm=plate(arm,.032,'#777777',advancePivot);advanceArm.name='filmAdvanceArm';
  const gripShape=new THREE.Shape();gripShape.moveTo(.55,.22);gripShape.lineTo(.79,.255);
  gripShape.quadraticCurveTo(.84,.265,.825,.31);gripShape.lineTo(.80,.365);
  gripShape.quadraticCurveTo(.79,.385,.75,.38);gripShape.lineTo(.53,.335);
  gripShape.quadraticCurveTo(.51,.28,.55,.22);
  const advanceGrip=plate(gripShape,.055,'#393939',advancePivot);

  // The folded arm spans the existing dial. Its rim hinge lifts it through
  // a half-turn into a longer outboard crank before the spindle rotates.
  const rewindPivot=new THREE.Group();rewindPivot.position.set(dialX,1.415,layout.bodyCenterZ);rewind.add(rewindPivot);
  const crankHinge=new THREE.Group();crankHinge.position.x=.22;rewindPivot.add(crankHinge);
  const crankArm=plate(roundedRectangle(.50,.095,.042),.028,'#777777',crankHinge);crankArm.position.x=-.25;
  // The knob tucks below the stowed arm; the hinge's half-turn places it
  // above the deployed crank where a finger can turn it.
  const crankKnob=cylinder(.052,.09,'#393939',crankHinge,-.475,-.053,0);
  const hingePin=cylinder(.043,.115,'#777777',rewindPivot,.22,0,0);hingePin.rotation.x=Math.PI/2;
  function pivotParts(parent,x,y,z){
    const objects=[...parent.children],pivot=new THREE.Group();pivot.position.set(x,y,z);parent.add(pivot);
    for(const object of objects)pivot.attach(object);
    return pivot;
  }
  const takeupPivot=pivotParts(takeup,f.takeupX,0,takeupZ);
  const sprocketPivot=pivotParts(sprocket,sprocketX,0,sprocketZ);
  const loadingMark=box(.07,.10,.012,'#b2b2b2',takeup,left,-h-.10,filmZ-.01);
  cylinder(.12,.025,'#777777',rewindRelease,f.takeupX,-1.235,takeupZ);
  const releaseButton=cylinder(.085,.055,'#393939',rewindRelease,f.takeupX,-1.27,takeupZ);

  let previousStock='',coilRadius=f.takeupRadius,foldingFromRewind=false,cartridgeRemoval=0;
  let rewindReleasePress=0,rewindCrankFold=0;
  function sync(){
    const s=transport.state();
    // A dissolve restores quaternions. Beyond a 90° Y rotation, Three may
    // express that quaternion as Euler X=π/Z=π; updating Y alone leaves those
    // extra rotations behind. Mechanisms own a complete axis-only rotation.
    back.rotation.set(0,s.backOpen*Math.PI*.58,0);
    cartridge.visible=s.load>0&&cartridgeRemoval<1;
    const seated=THREE.MathUtils.clamp(s.load/.28,0,1);
    cartridge.position.set(0,0,-1.8*(1-smooth(seated)+cartridgeRemoval)||0);
    strip.visible=s.leader>.001;
    coilRadius=Math.sqrt(f.takeupRadius**2+s.travel*f.stockThickness/Math.PI);
    const stockKey=s.leader+':'+s.travel+':'+s.wrap;
    if(previousStock!==stockKey){
      previousStock=stockKey;filmSurface.geometry.dispose();
      filmSurface.geometry=stockGeometry(s.leader,s.travel);
      const positions=filmSurface.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        const p=THREE.MathUtils.clamp((-.85-positions.getX(i))/(-.85-f.takeupX),0,1);
        positions.setZ(i,-(coilRadius-f.takeupRadius)*p*p*(3-2*p));
      }
      filmSurface.geometry.computeVertexNormals();
      const outline=filmSurface.children[0];outline.geometry.dispose();
      outline.geometry=new THREE.EdgesGeometry(filmSurface.geometry,40);
      wrap.geometry.dispose();
      wrap.geometry=wrapGeometry(coilRadius+.002,s.wrap,s.travel);
      wrap.children[0].geometry.dispose();wrap.children[0].geometry=new THREE.EdgesGeometry(wrap.geometry,40);
    }
    wrap.visible=s.wrap>.001;
    wrap.userData.mechanismVisible=wrap.visible;
    coil.scale.set(coilRadius/f.takeupRadius,1,coilRadius/f.takeupRadius);
    filmSurface.material.uniforms.filmTravel.value=s.travel;
    wrap.material.uniforms.filmTravel.value=s.travel;
    for(const object of [filmSurface,wrap]){
      object.material.uniforms.exposureCount.value=s.exposures.length;
      object.material.uniforms.exposureRanges.value.forEach((range,index)=>range.set(...(s.exposures[index]||[0,0])));
      object.material.uniforms.exposureStrengths.value.forEach((_,index)=>{
        object.material.uniforms.exposureStrengths.value[index]=s.exposureStrengths[index]??0;
      });
    }
    takeupPivot.rotation.set(0,s.travel/f.takeupRadius,0);
    sprocketPivot.rotation.set(0,(s.travel+s.leader-(right-left))/sprocketPitchRadius,0);
    advancePivot.rotation.set(0,s.phase==='advancing'?Math.sin(s.progress*Math.PI)*.8:0,0);
    rewindPivot.rotation.set(0,(s.travel+s.leader)/(f.cartridgeRadius*2),0);
    const reset=foldingFromRewind&&s.phase==='loading'?1-smooth(s.progress/.20):0;
    rewindReleasePress=s.phase==='rewinding'?smooth(s.progress/.12):s.phase==='rewound'?1:reset;
    rewindCrankFold=s.phase==='rewinding'?smooth((s.progress-.12)/.18):s.phase==='rewound'?1:reset;
    releaseButton.position.y=-1.27+rewindReleasePress*.035;
    crankHinge.rotation.set(0,0,-Math.PI*rewindCrankFold);
    // The stock leaves the winding coil tangentially, then lies at the gate.
    // Small radius growth stays behind the gate and ahead of the closed back.
    witnesses.forEach((line,i)=>{
      line.position.x=layout.opticalCenterX-f.imageWidth/2+(i-1)*f.framePitch-s.travel%f.framePitch;
      line.visible=line.position.x>right-s.leader&&line.position.x<right&&s.leader>.001;
      line.userData.mechanismVisible=line.visible;
      const p=THREE.MathUtils.clamp((-.85-line.position.x)/(-.85-f.takeupX),0,1);
      line.position.z=filmZ-.003-(coilRadius-f.takeupRadius)*p*p*(3-2*p);
    });
  }

  let enabled=false;
  function setEnabled(value){
    enabled=Boolean(value);root.visible=enabled;
    if(rewindBase)(enabled?rewind:rewindBaseParent).add(rewindBase);
    digitalGroups.forEach((group,i)=>{group.visible=enabled?false:originals[i];});
  }
  function getLayout(){
    model.updateMatrixWorld(true);
    const bounds=object=>{
      const b=new THREE.Box3().setFromObject(object,true);
      return {min:b.min.toArray(),max:b.max.toArray()};
    };
    return {enabled,filmZ,backZ,frontZ,body:bounds(filmBody),back:bounds(back),
      backAngle:back.rotation.y,backPanel:bounds(panel),backOutline:bounds(panel.children[0]),
      film:bounds(filmSurface),cartridge:bounds(cartridge),cartridgeVisible:cartridge.visible,
      cartridgeOffset:cartridge.position.toArray(),cartridgeRemoval,takeup:bounds(takeup),
      gate:bounds(gate),pressurePlate:bounds(pressurePlate),holes,coilRadius,
      transport:transport.state(),witnessX:witness.position.x,
      takeupRotation:takeupPivot.rotation.y,rewindRotation:rewindPivot.rotation.y,
      advanceRotation:advancePivot.rotation.y,
      advancePivot:advancePivot.getWorldPosition(new THREE.Vector3()).toArray(),advanceGrip:bounds(advanceGrip),
      rewindPivot:rewindPivot.getWorldPosition(new THREE.Vector3()).toArray(),
      crankKnob:crankKnob.getWorldPosition(new THREE.Vector3()).toArray(),
      rewindReleasePress,rewindCrankFold,rewindRelease:bounds(rewindRelease),
      loadingMark:bounds(loadingMark),freshBoundaryX:right-transport.state().travel,
      fogColor:filmSurface.material.uniforms.fogAccent.value.getHexString(),
      freshColor:filmSurface.material.uniforms.freshAccent.value.getHexString(),
      digitalVisible:digitalGroups.map(group=>group.visible)};
  }
  setEnabled(false);sync();
  return {root,setEnabled,getLayout,filmBody,back,pressurePlate,cartridge,takeup,gate,strip,filmSurface,sprocket,sprocketShaft,sprocketTeeth,advanceArm,rewindBase,
    getState:()=>({...transport.state(),cartridgeRemoval}),
    exposeGate(strength=1){
      const changed=transport.expose(right-(layout.opticalCenterX+f.imageWidth/2),right-(layout.opticalCenterX-f.imageWidth/2),strength);
      if(changed)sync();return changed;
    },
    reset(){transport.reset();foldingFromRewind=false;cartridgeRemoval=0;sync();},
    checkpoint(){const restore=transport.checkpoint(),fold=foldingFromRewind,removed=cartridgeRemoval;
      return ()=>{restore();foldingFromRewind=fold;cartridgeRemoval=removed;sync();};},
    begin(action){
      if(action==='load')foldingFromRewind=transport.state().phase==='rewound';
      const result=transport.begin(action);if(result&&action==='load')cartridgeRemoval=0;sync();return result;
    },
    update(value){const result=transport.update(value);sync();return result;},
    setBackOpen(value){const result=transport.setBackOpen(value);sync();return result;},
    setCartridgeRemoval(value){
      if(!Number.isFinite(value))throw new TypeError('Cartridge removal must be finite');
      const state=transport.state();if(state.phase!=='rewound'||state.backOpen!==1)return false;
      cartridgeRemoval=THREE.MathUtils.clamp(value,0,1);sync();return true;
    }};
}
