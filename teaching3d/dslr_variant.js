import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {CAMERA_LAYOUT} from './camera_layout.js';

// Scene units are schematic, not a manufacturer flange-distance profile.
// The extension stops at the existing grip's front plane. A compact mirror
// clears the thinner recording assembly and folds behind the shifted lens.
export const DSLR_LAYOUT=Object.freeze({
  housingWidth:2.64,
  housingHeight:2.35,
  housingCornerRadius:.10,
  mirrorWidth:1.336,
  mirrorLength:1.256,
  mirrorThickness:.008,
  mirrorHingeY:.445,
  mirrorHingeZ:-.608,
  releaseX:.99,
  releaseY:-.89,
});

// An illustrative optical finder sized to the approved body and rear window.
// The focusing plane is the same folded distance from the lowered mirror as
// the recording plane. Prism facets show the assembly, not a traced optical
// prescription or a particular manufacturer's internal dimensions.
export const SLR_OPTICS_LAYOUT=Object.freeze({
  recordingPlaneZ:-.7725,
  screenWidth:1.32,
  screenDepth:.88,
  screenThickness:.014,
  prismWidth:.98,
  prismProfile:Object.freeze([
    [-.66,.69],[.38,.69],[.38,1.25],[-.31,1.54],[-.66,1.36],
  ].map(point=>Object.freeze(point))), // [z,y], pentagonal side section
  eyepieceY:1.23,
  eyepieceWidth:.50,
  eyepieceHeight:.31,
});

function roundedRectangle(width,height,radius){
  const shape=new THREE.Shape(),x=width/2,y=height/2,r=radius;
  shape.moveTo(-x+r,-y);shape.lineTo(x-r,-y);
  shape.quadraticCurveTo(x,-y,x,-y+r);shape.lineTo(x,y-r);
  shape.quadraticCurveTo(x,y,x-r,y);shape.lineTo(-x+r,y);
  shape.quadraticCurveTo(-x,y,-x,y-r);shape.lineTo(-x,-y+r);
  shape.quadraticCurveTo(-x,-y,-x+r,-y);
  return shape;
}

/** Extend the existing camera; do not duplicate or rebuild its base geometry.
 * Create before material isolation/context snapshots. Variant-only parent
 * groups own visibility, so context treatments can restore child materials.
 * Sensor/shutter, rear panel/screen, controls and grip are never transformed.
 */
export function createDslrVariant({registry,shell,internals,lens,lensMount,
  lensRelease,finderBody,grip,material,addPrintedEdges}){
  const d=DSLR_LAYOUT;
  // Read the actual grip mesh, including its bevel, in shell coordinates.
  // A grip edit therefore cannot silently leave a deeper DSLR extension.
  grip.geometry.computeBoundingBox();grip.updateMatrix();
  const gripFront=new THREE.Box3().copy(grip.geometry.boundingBox).applyMatrix4(grip.matrix).max.z;
  const bodyFront=CAMERA_LAYOUT.bodyCenterZ+CAMERA_LAYOUT.bodyDepth/2+.025;
  const mountShift=gripFront-bodyFront;
  const originals=new Map([lens,lensMount,lensRelease,finderBody].map(object=>
    [object,{position:object.position.clone(),scale:object.scale.clone()}]));
  const housing=registry.add('dslrHousing','Mirror housing',shell);
  housing.position.x=CAMERA_LAYOUT.opticalCenterX;
  const mirror=registry.add('reflexMirror','Reflex mirror',internals);
  const hinge=new THREE.Group();mirror.add(hinge);
  hinge.position.set(0,d.mirrorHingeY,d.mirrorHingeZ);

  // A single square section with an actual open bore, including both end
  // faces. It overlaps the original front skin and the translated collar.
  const rear=CAMERA_LAYOUT.bodyCenterZ+CAMERA_LAYOUT.bodyDepth/2-.015;
  const front=gripFront;
  const shape=roundedRectangle(d.housingWidth,d.housingHeight,d.housingCornerRadius);
  const bore=new THREE.Path();
  bore.absarc(0,0,CAMERA_LAYOUT.frontOpeningRadius,0,Math.PI*2,true);
  shape.holes.push(bore);
  const extension=addPrintedEdges(new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{
    depth:front-rear,bevelEnabled:false,steps:1,curveSegments:40,
  }),material('#808080')));
  extension.name='dslrFrontExtension';extension.position.z=rear;housing.add(extension);

  // At rest the top edge is behind the lower edge: incoming light along -Z
  // reflects upward. Rotating about that top edge parks the same plate above
  // the recording aperture. Its projected width/height cover the .8 sensor.
  const mirrorSurface=addPrintedEdges(new THREE.Mesh(new THREE.BoxGeometry(
    d.mirrorWidth,d.mirrorLength,d.mirrorThickness),material('#ababab')));
  mirrorSurface.name='reflexMirrorSurface';mirrorSurface.position.y=-d.mirrorLength/2;
  hinge.add(mirrorSurface);

  const optics=SLR_OPTICS_LAYOUT;
  const focusingScreen=registry.add('focusingScreen','Focusing screen',internals);
  const pentaprism=registry.add('pentaprism','Pentaprism',internals);
  const opticalFinder=registry.add('opticalFinder','Optical eyepiece',internals);
  const mirrorCenterRayZ=d.mirrorHingeZ+d.mirrorHingeY;
  const focusingPlaneY=mirrorCenterRayZ-optics.recordingPlaneZ;
  const screenSurface=addPrintedEdges(new THREE.Mesh(new THREE.BoxGeometry(
    optics.screenWidth,optics.screenThickness,optics.screenDepth),material('#b5b5b5')));
  screenSurface.name='slrFocusingScreen';
  screenSurface.position.set(0,focusingPlaneY,mirrorCenterRayZ);
  screenSurface.material.transparent=true;screenSurface.material.opacity=.4;
  screenSurface.material.uniforms.opacity.value=.4;screenSurface.material.depthWrite=false;
  focusingScreen.add(screenSurface);

  // Extrude the five-sided Y/Z section sideways. The lower entrance faces the
  // focusing screen; the rear vertical face connects to the unchanged eyecup.
  const prismSection=new THREE.Shape();
  optics.prismProfile.forEach(([z,y],index)=>
    index?prismSection.lineTo(z,y):prismSection.moveTo(z,y));
  prismSection.closePath();
  const prismGeometry=new THREE.ExtrudeGeometry(prismSection,{
    depth:optics.prismWidth,bevelEnabled:false,steps:1,
  });
  prismGeometry.translate(0,0,-optics.prismWidth/2);
  // Rotate local section X into world Z and extrusion Z into world -X.
  prismGeometry.rotateY(-Math.PI/2);
  const prism=addPrintedEdges(new THREE.Mesh(prismGeometry,material('#969696')));
  prism.name='slrPentaprism';pentaprism.add(prism);
  prism.material.transparent=true;prism.material.opacity=.4;
  prism.material.uniforms.opacity.value=.4;prism.material.depthWrite=false;

  const bodyRear=CAMERA_LAYOUT.bodyCenterZ-CAMERA_LAYOUT.bodyDepth/2-.025;
  const prismExitZ=optics.prismProfile[0][0];
  const finderExitZ=bodyRear-.066;
  const finderDepth=prismExitZ-finderExitZ;
  const frameThickness=.035;
  const eyepiecePart=(name,width,height,depth,x,y,z,color)=>{
    const part=addPrintedEdges(new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material(color)));
    part.name=name;part.position.set(x,y,z);opticalFinder.add(part);return part;
  };
  for(const sign of [-1,1]){
    eyepiecePart('slrEyepieceHorizontalFrame',optics.eyepieceWidth,frameThickness,finderDepth,
      0,optics.eyepieceY+sign*(optics.eyepieceHeight-frameThickness)/2,
      (prismExitZ+finderExitZ)/2,'#626262');
    eyepiecePart('slrEyepieceVerticalFrame',frameThickness,optics.eyepieceHeight-2*frameThickness,finderDepth,
      sign*(optics.eyepieceWidth-frameThickness)/2,optics.eyepieceY,
      (prismExitZ+finderExitZ)/2,'#626262');
  }
  const eyepieceGlass=eyepiecePart('slrEyepieceGlass',optics.eyepieceWidth-2*frameThickness,
    optics.eyepieceHeight-2*frameThickness,.014,0,optics.eyepieceY,finderExitZ+.018,'#aaaaaa');

  finderBody.geometry.computeBoundingBox();
  const finderBounds=finderBody.geometry.boundingBox.clone();
  let variant='mirrorless',raised=0;
  function setMirrorRaised(value){
    if(!Number.isFinite(value))throw new TypeError('Mirror raise must be finite');
    raised=THREE.MathUtils.clamp(value,0,1);
    hinge.rotation.x=-Math.PI/4-raised*Math.PI/4;
  }
  function setVariant(next){
    if(next!=='mirrorless'&&next!=='dslr')throw new RangeError('Unknown camera variant: '+next);
    variant=next;
    for(const [object,original] of originals){
      object.position.copy(original.position);object.scale.copy(original.scale);
    }
    housing.visible=mirror.visible=focusingScreen.visible=pentaprism.visible=opticalFinder.visible=next==='dslr';
    if(next==='dslr'){
      lens.position.z+=mountShift;lensMount.position.z+=mountShift;
      // The current button mesh is at (1.25,-.45,.12) within its named group.
      lensRelease.position.x+=d.releaseX-1.25;
      lensRelease.position.y+=d.releaseY-(-.45);
      lensRelease.position.z+=mountShift;
      // Stretch only the finder housing toward the new front face. Preserve
      // its back plane exactly; separate rear eyecup/window never move.
      const original=originals.get(finderBody);
      const depth=(finderBounds.max.z-finderBounds.min.z)*original.scale.z;
      finderBody.scale.z=original.scale.z*(depth+mountShift)/depth;
      finderBody.position.z=original.position.z+
        finderBounds.min.z*(original.scale.z-finderBody.scale.z);
    }
    setMirrorRaised(raised);
  }
  function getLayout(){
    shell.updateWorldMatrix(true,true);internals.updateWorldMatrix(true,true);
    const bounds=object=>{
      const box=new THREE.Box3().setFromObject(object,true);
      return {min:box.min.toArray(),max:box.max.toArray()};
    };
    const origin=new THREE.Vector3(CAMERA_LAYOUT.opticalCenterX,0,front+.5);
    const ray=new THREE.Raycaster(origin,new THREE.Vector3(0,0,-1));
    let mirrorApertureHits=0;
    // Check the corners, edge centers and center of the approved .8-scaled
    // active image; rounded sensor bevels are outside this recording area.
    for(const x of [-.66,0,.66])for(const y of [-.44,0,.44]){
      const apertureRay=new THREE.Raycaster(new THREE.Vector3(CAMERA_LAYOUT.opticalCenterX+x,y,front+.5),
        new THREE.Vector3(0,0,-1));
      if(apertureRay.intersectObject(mirrorSurface,false).length)mirrorApertureHits++;
    }
    return {variant,mirrorRaised:raised,gripFront,mountShift:variant==='dslr'?mountShift:0,
      extension:bounds(extension),mirror:bounds(mirrorSurface),mirrorApertureHits,
      extensionBlocksAxis:ray.intersectObject(extension,false).length>0,
      optics:{visible:pentaprism.visible,focusingPlaneY,mirrorCenterRayZ,prismExitZ,finderExitZ,
        screen:bounds(screenSurface),prism:bounds(prism),eyepiece:bounds(opticalFinder)}};
  }
  setMirrorRaised(0);setVariant('mirrorless');
  return {setVariant,setMirrorRaised,getLayout,housing,extension,mirror,mirrorSurface,
    focusingScreen,screenSurface,pentaprism,prism,opticalFinder,eyepieceGlass};
}
