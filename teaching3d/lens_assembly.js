import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {createIrisMechanism} from './iris_mechanism.js';

// The teaching rig exposes the seven whole-stop positions available on the
// camera control.  The normalized value remains 0 = stopped down and 1 = wide
// open so callers can reverse the UI direction without changing the model.
export const APERTURE_STOP_LABELS = Object.freeze([
  'f/22', 'f/16', 'f/11', 'f/8', 'f/5.6', 'f/4', 'f/2.8',
]);
export const APERTURE_STOP_COUNT = APERTURE_STOP_LABELS.length;
const APERTURE_OUTER_RADIUS = .835;
export const APERTURE_BORE_RADIUS = .54;
const HOUSING_DEPTH = .07;

export function snapApertureValue(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return THREE.MathUtils.clamp(
    Math.round(numeric * (APERTURE_STOP_COUNT - 1)) /
      (APERTURE_STOP_COUNT - 1),
    0,
    1,
  );
}

export function apertureRadiusForValue(value, maxRadius = APERTURE_BORE_RADIUS) {
  const snapped = snapApertureValue(value);
  return maxRadius / Math.pow(Math.sqrt(2),
    (APERTURE_STOP_COUNT - 1) * (1 - snapped));
}

/** Schematic lens mechanism rig, not an optical prescription. Axial movements
 * are illustrative and must be replaced/verified for a specific lens tutorial.
 */
export function buildLensAssembly(registry, parent, material, options = {}) {
  // Keep this author-facing knob bounded to practical schematic assemblies.
  // The range is a modeling choice, not a universal limit for real lenses.
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const {bladeCount = 7} = options;
  if (!Number.isInteger(bladeCount) || bladeCount < 3 || bladeCount > 20) {
    throw new RangeError('bladeCount must be an integer from 3 to 20');
  }
  // Low-count authoring variants need more radial storage to keep their broad
  // leaves overlapped throughout travel. The camera's seven-leaf bore is .54.
  const boreRadius=bladeCount<7 ? [.4,.44,.48,.48][bladeCount-3] : APERTURE_BORE_RADIUS;
  const mechanism=createIrisMechanism(bladeCount,boreRadius);
  const stopAngles=APERTURE_STOP_LABELS.map((_,i)=>mechanism.rotationForRadius(
    apertureRadiusForValue(i/(APERTURE_STOP_COUNT-1),boreRadius)));

  const focus=registry.add('focusGroup','Focus group',parent);
  const zoom=registry.add('zoomGroup','Zoom group',parent);
  const iris=registry.add('aperture','Aperture',parent);
  iris.userData.bladeCount=bladeCount;
  iris.position.z=.48;

  const contextOutlines=[];
  function lineMaterial(opacity=.65) {
    return new THREE.LineBasicMaterial({color:0x333333,transparent:true,opacity,
      depthTest:true,depthWrite:false});
  }
  function circleSegments(radius,z,segments=64) {
    const points=[];
    for(let i=0;i<segments;i++){
      const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments;
      points.push(Math.cos(a)*radius,Math.sin(a)*radius,z,
        Math.cos(b)*radius,Math.sin(b)*radius,z);
    }
    return new THREE.BufferGeometry().setAttribute('position',
      new THREE.Float32BufferAttribute(points,3));
  }
  function glass(group,z,radius) {
    const surface=material('#ababab');surface.transparent=true;
    surface.opacity=.4;surface.uniforms.opacity.value=.4;surface.depthWrite=false;
    const lens=new THREE.Mesh(new THREE.SphereGeometry(radius,32,16),surface);
    lens.scale.z=.12;lens.position.z=z;group.add(lens);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(radius,.012,4,48),material('#555555'));
    rim.position.z=z;group.add(rim);
    // A single analytical silhouette keeps contextual glass legible without
    // exposing the sphere tessellation as a wireframe grid.
    const outline=new THREE.LineSegments(circleSegments(radius,z),lineMaterial());
    outline.name='glassSilhouette';
    outline.userData.contextOutline=true;
    group.add(outline);
    contextOutlines.push({outline,group,z,radius,depth:radius*.12});
  }
  glass(focus,.78,.65);glass(focus,.88,.62);
  glass(zoom,1.07,.69);glass(zoom,1.21,.66);
  // A shallow annular cassette leaves radial storage for the leaves. Keep
  // the old outside diameter so it still fits inside the camera's lens.
  const housingShape=new THREE.Shape();
  housingShape.absarc(0,0,APERTURE_OUTER_RADIUS,0,Math.PI*2,false);
  const borePath=new THREE.Path();
  borePath.absarc(0,0,boreRadius,0,Math.PI*2,true);
  housingShape.holes.push(borePath);
  const housingGeometry=new THREE.ExtrudeGeometry(housingShape,{
    depth:HOUSING_DEPTH,bevelEnabled:false,curveSegments:64,steps:1,
  });
  housingGeometry.translate(0,0,-HOUSING_DEPTH/2);
  const housing=new THREE.Mesh(housingGeometry,material('#555555'));
  housing.name='apertureHousing';
  housing.userData.boreRadius=boreRadius;
  housing.userData.outerRadius=APERTURE_OUTER_RADIUS;
  iris.add(housing);
  for(const radius of [boreRadius,APERTURE_OUTER_RADIUS]){
    const outline=new THREE.LineSegments(circleSegments(radius,HOUSING_DEPTH/2+.001,128),lineMaterial());
    outline.name='apertureHousingOutline';
    outline.userData.contextOutline=true;
    iris.add(outline);
  }
  const blades=[];
  const bladeMat=material('#888888');bladeMat.side=THREE.DoubleSide;
  // Plain grey: the ring's darker grey (its print ink), so the leaves read
  // against the paper and the wireframe. Blue keeps the lighter leaf tone.
  bladeMat.uniforms.grayInk.value=.32;
  // A slope-dependent bias reveals buried edges at oblique views. One depth
  // unit is enough to draw a leaf's own outline without lifting hidden edges.
  bladeMat.polygonOffset=true;bladeMat.polygonOffsetFactor=0;bladeMat.polygonOffsetUnits=1;
  for(let i=0;i<bladeCount;i++){
    const angle=i*Math.PI*2/bladeCount;
    const b=new THREE.Mesh(mechanism.geometry,bladeMat.clone());
    b.name='apertureBlade'+i;
    b.position.set(mechanism.pivotRadius*Math.cos(angle),
      mechanism.pivotRadius*Math.sin(angle),0);
    b.renderOrder=10;
    const edge=new THREE.LineSegments(mechanism.outlineGeometry,lineMaterial());
    edge.name='apertureBladeOutline';
    edge.userData.contextOutline=true;
    edge.renderOrder=20;
    b.add(edge);
    iris.add(b);blades.push(b);
  }
  function setAperture(value) {
    const snappedValue=snapApertureValue(value);
    const stopIndex=Math.round(snappedValue*(APERTURE_STOP_COUNT-1));
    const angle=stopAngles[stopIndex];
    for(let i=0;i<blades.length;i++){
      blades[i].rotation.z=i*Math.PI*2/bladeCount-angle;
    }
    iris.userData.opening=apertureRadiusForValue(snappedValue,boreRadius);
    iris.userData.apertureValue=snappedValue;
    iris.userData.apertureLabel=APERTURE_STOP_LABELS[stopIndex];
    return snappedValue;
  }
  function setFocus(value){focus.position.z=(THREE.MathUtils.clamp(value,0,1)-.5)*.26;}
  function setZoom(value){zoom.position.z=(THREE.MathUtils.clamp(value,0,1)-.5)*.38;}
  function updateContextOutlines(camera) {
    const cameraWorld=camera.getWorldPosition(new THREE.Vector3());
    for(const entry of contextOutlines){
      const localCamera=entry.group.worldToLocal(cameraWorld.clone());
      const q=new THREE.Vector3(localCamera.x/entry.radius,localCamera.y/entry.radius,
        (localCamera.z-entry.z)/entry.depth);
      const qLengthSq=q.lengthSq();
      if(qLengthSq<=1)continue;
      const center=q.clone().multiplyScalar(1/qLengthSq);
      const circleRadius=Math.sqrt(1-1/qLengthSq);
      const axis=Math.abs(q.z/q.length())<.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(0,1,0);
      const u=new THREE.Vector3().crossVectors(q,axis).normalize();
      const v=new THREE.Vector3().crossVectors(q,u).normalize();
      const positions=entry.outline.geometry.attributes.position.array;
      const segments=positions.length/6;
      for(let i=0;i<segments;i++){
        for(let endpoint=0;endpoint<2;endpoint++){
          const angle=(i+endpoint)*Math.PI*2/segments;
          const uScale=Math.cos(angle)*circleRadius,vScale=Math.sin(angle)*circleRadius;
          const offset=(i*2+endpoint)*3;
          positions[offset]=(center.x+u.x*uScale+v.x*vScale)*entry.radius;
          positions[offset+1]=(center.y+u.y*uScale+v.y*vScale)*entry.radius;
          positions[offset+2]=entry.z+(center.z+u.z*uScale+v.z*vScale)*entry.depth;
        }
      }
      entry.outline.geometry.attributes.position.needsUpdate=true;
    }
  }
  function reset(){setAperture(.5);setFocus(.5);setZoom(.5);}
  reset();
  return {focus,zoom,iris,setAperture,setFocus,setZoom,updateContextOutlines,reset};
}
