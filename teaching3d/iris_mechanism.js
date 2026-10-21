import * as THREE from './vendor/three.module.min.f231b18ca7.js';

// Dimensions are schematic, not a prescription for a particular lens. Each
// leaf is nevertheless one fixed shape rotating about one fixed pivot.
// Mechanism reference: https://patents.google.com/patent/US3685418A/en
const PIVOT_RADIUS = .71;
const LEAF_ENVELOPE_RADIUS = .815;
const EDGE_SEGMENTS = 180;
const START_ANGLE = -160 * Math.PI / 180;
const END_ANGLE = 20 * Math.PI / 180;
const LAP_RISE = .008;

export function createIrisMechanism(bladeCount, boreRadius) {
  const curveRadius=boreRadius+.012;
  const closedAngle=2*Math.asin(curveRadius/(2*PIVOT_RADIUS));

  // Shape the back of the leaf once against its entire swept envelope. This
  // leaves clearance inside the casing without clipping or reshaping a moving
  // blade. The small inset covers the sampling tolerance between poses.
  function outerRadiusAt(phi) {
    let radius=LEAF_ENVELOPE_RADIUS;
    for(let i=0;i<=128;i++){
      const angle=closedAngle*i/128;
      const cx=PIVOT_RADIUS*(1-Math.cos(angle));
      const cy=-PIVOT_RADIUS*Math.sin(angle);
      const projection=cx*Math.cos(phi)+cy*Math.sin(phi);
      radius=Math.min(radius,projection+Math.sqrt(
        LEAF_ENVELOPE_RADIUS**2-cx*cx-cy*cy+projection*projection));
    }
    return radius-.001;
  }

  const positions=[],indices=[],edgePositions=[];
  for(let i=0;i<=EDGE_SEGMENTS;i++){
    const t=i/EDGE_SEGMENTS,phi=START_ANGLE+(END_ANGLE-START_ANGLE)*t;
    // A tiny, fixed rise along the thin leaf preserves a cyclic lap: every
    // blade passes above one neighbour and below the other. A stack with
    // successively increasing z instead gives one leaf an exposed extra edge.
    const z=LAP_RISE*(t-.5);
    for(const radius of [curveRadius,outerRadiusAt(phi)]){
      positions.push(radius*Math.cos(phi)-PIVOT_RADIUS,radius*Math.sin(phi),z);
    }
    if(i>0){
      const previous=(i-1)*2,current=i*2;
      indices.push(previous,previous+1,current,current,previous+1,current+1);
      edgePositions.push(...positions.slice(previous*3,previous*3+3),
        ...positions.slice(current*3,current*3+3));
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const outlineGeometry=new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute(edgePositions,3));

  function clearArea(offset) {
    const halfAngle=Math.PI/bladeCount,segments=192,delta=2*halfAngle/segments;
    const radiusAt=angle=>Math.min(boreRadius,
      Math.sqrt(curveRadius**2-(offset*Math.sin(angle))**2)-offset*Math.cos(angle));
    let previous=radiusAt(-halfAngle),area=0;
    for(let i=1;i<=segments;i++){
      const next=radiusAt(-halfAngle+i*delta);
      area+=previous*next*Math.sin(delta)/2;
      previous=next;
    }
    return area*bladeCount;
  }

  function rotationForRadius(radius) {
    if(radius>=boreRadius)return 0;
    const targetArea=Math.PI*radius*radius;
    let low=0,high=curveRadius;
    for(let i=0;i<40;i++){
      const offset=(low+high)/2;
      if(clearArea(offset)>targetArea)low=offset;else high=offset;
    }
    // The centre of a circular edge moves on a circle around the hinge.
    // Its displacement from the optical axis is 2*pivot*sin(rotation/2).
    return 2*Math.asin((low+high)/(4*PIVOT_RADIUS));
  }

  return {geometry,outlineGeometry,pivotRadius:PIVOT_RADIUS,rotationForRadius};
}
