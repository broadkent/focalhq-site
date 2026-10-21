import * as THREE from './vendor/three.module.min.f231b18ca7.js';

const MIN_WIDTH=.15,MAX_WIDTH=12,DEFAULT_TARGET=new THREE.Vector3(0,.55,0);
const DEFAULT_REFERENCE_DISTANCE=Math.hypot(1.7,1.8,2.6);
// Fixed, asymmetric offsets avoid the regular shadow banding of a point grid,
// while keeping every sample inside its equal-area 3x3 stratum.
const STRATIFIED_3X3=[
  [-.79,-.84],[-.04,-.73],[.78,-.89],
  [-.88,-.05],[.08,.11],[.73,-.12],
  [-.75,.82],[-.12,.70],[.86,.77],
];
const STRATIFIED_2X2=[[-.53,-.61],[.57,-.43],[-.46,.56],[.62,.49]];

/**
 * A bounded approximation of a one-sided rectangular Lambert emitter.
 * Distinct shadow-casting points create real geometric penumbrae: no shadow
 * radius or screen-space blur is used. All samples share the plane normal.
 * Compensated mode holds the facing target's illuminance at referenceIlluminance
 * times 2**powerStops. Physical mode holds total Lambert output constant instead:
 * size redistributes that output over the rectangle, and distance attenuates it.
 * Its calibration uses a fixed nine-point reference rectangle, independent of
 * initial/current geometry, mode switches and the runtime shadow sample budget.
 * `output` is the declared Lambert flux (pi times axial intensity), in relative
 * scene units, not calibrated real-world lumens. The spot approximation applies
 * emitter cosine at the target; it is not an exact Lambert field off that target.
 */
export function createAreaLight({
  target=DEFAULT_TARGET,color=0xffffff,referenceIlluminance=38,
  mapSize=1024,width=.7,height=width*1.25,position=new THREE.Vector3(1.7,2.35,2.6),
  sampleCount=9,powerStops=0,intensityScale=1,exposureMode='compensated',
  referenceDistance=DEFAULT_REFERENCE_DISTANCE,referenceWidth=.7,referenceHeight=.875,
  shadowBias=-.00008,
}={}){
  if(sampleCount!==9&&sampleCount!==4)throw new RangeError('sampleCount must be 9 or 4');
  if(!Number.isFinite(shadowBias))throw new RangeError('shadowBias must be finite');
  if(!Number.isFinite(referenceIlluminance)||referenceIlluminance<0)
    throw new RangeError('referenceIlluminance must be nonnegative and finite');
  for(const [name,value]of Object.entries({referenceDistance,referenceWidth,referenceHeight})){
    if(!Number.isFinite(value)||value<=0)throw new RangeError(`${name} must be positive and finite`);
  }
  const referenceResponse=STRATIFIED_3X3.reduce((sum,[u,v])=>{
    const rangeSquared=referenceDistance**2+(u*referenceWidth*.5)**2+(v*referenceHeight*.5)**2;
    return sum+referenceDistance**2/(rangeSquared**2*STRATIFIED_3X3.length);
  },0);
  const referenceScale=referenceIlluminance/referenceResponse;
  const referenceOutput=Math.PI*referenceScale;
  if(!Number.isFinite(referenceOutput))throw new RangeError('reference geometry must yield finite output');
  const referenceTarget=toVector3(target,'target').clone();
  const offsets=sampleCount===9?STRATIFIED_3X3:STRATIFIED_2X2;
  const group=new THREE.Group();group.name='rectangularAreaSource';
  const sampleTargets=new THREE.Group();sampleTargets.name='areaSampleTargets';group.add(sampleTargets);
  const samples=offsets.map(([u,v],index)=>{
    const targetObject=new THREE.Object3D();sampleTargets.add(targetObject);
    const light=new THREE.SpotLight(color,0,0,1.22,0,2);
    light.name=`areaSample${index+1}`;light.castShadow=true;light.target=targetObject;
    light.shadow.mapSize.set(mapSize,mapSize);light.shadow.camera.near=.15;light.shadow.camera.far=12;
    // Small normalBias: at .006 it pushed receiver samples past thin features
    // (ear flaps, eyelid rims), so those lit up while the head sat in shadow.
    light.shadow.bias=shadowBias;light.shadow.normalBias=.002;group.add(light);
    return {light,target:targetObject,u,v,weight:1/offsets.length};
  });
  const center=new THREE.Vector3(),normal=new THREE.Vector3(),up=new THREE.Vector3(),right=new THREE.Vector3();
  let previousUp=null,currentWidth=0,currentHeight=0;
  let currentPowerStops=powerStops,currentExposureMode=exposureMode;
  let currentIntensityScale=intensityScale;
  const metrics={sampleCount:samples.length,mapSize,shadowTexels:samples.length*mapSize*mapSize,
    referenceIlluminance,computedReferenceIlluminance:0,width:0,height:0,distance:0,
    referenceDistance,referenceWidth,referenceHeight,referenceOutput,output:0,
    powerStops,exposureMode,intensityScale:1,powerMultiplier:1,
    position:new THREE.Vector3(),target:referenceTarget.clone(),normal:new THREE.Vector3(),
    right:new THREE.Vector3(),up:new THREE.Vector3(),minIntensity:0,maxIntensity:0};

  function update(next={}){
    if(next.sampleCount!==undefined&&next.sampleCount!==sampleCount)
      throw new RangeError('sampleCount is fixed; create a new area light to change it');
    const requestedPowerStops=next.powerStops??currentPowerStops;
    if(!Number.isFinite(requestedPowerStops))
      throw new RangeError('powerStops must produce a finite power multiplier');
    const nextPowerStops=THREE.MathUtils.clamp(requestedPowerStops,-4,8);
    const powerMultiplier=2**nextPowerStops;
    const requestedIntensityScale=next.intensityScale??currentIntensityScale;
    if(!Number.isFinite(requestedIntensityScale)||requestedIntensityScale<0)
      throw new RangeError('intensityScale must be finite and nonnegative');
    const nextExposureMode=next.exposureMode??currentExposureMode;
    if(nextExposureMode!=='physical'&&nextExposureMode!=='compensated')
      throw new RangeError('exposureMode must be compensated or physical');
    const nextCenter=toVector3(next.position??(currentWidth===0?position:center),'position');
    const requestedWidth=next.width??(currentWidth||width);
    if(!Number.isFinite(requestedWidth))throw new TypeError('width must be finite');
    const nextWidth=THREE.MathUtils.clamp(requestedWidth,MIN_WIDTH,MAX_WIDTH);
    const requestedHeight=next.height??(next.width!==undefined?nextWidth*1.25:(currentHeight||height));
    if(!Number.isFinite(requestedHeight)||requestedHeight<=0)throw new RangeError('height must be positive and finite');
    const distance=referenceTarget.distanceTo(nextCenter);
    if(distance<1e-4)throw new RangeError('area source must not coincide with its target');
    if(!Number.isFinite(distance))throw new RangeError('source distance must be finite');
    const nextResponse=offsets.reduce((sum,[u,v])=>{
      const rangeSquared=distance**2+(u*nextWidth*.5)**2+(v*requestedHeight*.5)**2;
      return sum+distance**2/(rangeSquared**2*offsets.length);
    },0);
    const radiometricScale=(nextExposureMode==='physical'?referenceScale:referenceIlluminance/nextResponse)*powerMultiplier*requestedIntensityScale;
    if(!Number.isFinite(radiometricScale*Math.PI))throw new RangeError('geometry and power must yield finite output');
    center.copy(nextCenter);currentWidth=nextWidth;currentHeight=requestedHeight;
    currentPowerStops=nextPowerStops;currentExposureMode=nextExposureMode;
    currentIntensityScale=requestedIntensityScale;
    normal.copy(referenceTarget).sub(center);
    normal.divideScalar(distance);
    up.set(0,1,0).addScaledVector(normal,-normal.y);
    if(up.lengthSq()<1e-8)up.set(1,0,0).addScaledVector(normal,-normal.x);
    up.normalize();right.crossVectors(up,normal).normalize();
    if(previousUp&&up.dot(previousUp)<0){up.negate();right.negate();}
    previousUp=up.clone();

    for(const sample of samples){
      sample.light.position.copy(center)
        .addScaledVector(right,sample.u*currentWidth*.5)
        .addScaledVector(up,sample.v*currentHeight*.5);
      // A target translated along the common normal makes all sample axes
      // parallel, matching a planar emitter rather than nine converging spots.
      sample.target.position.copy(sample.light.position).addScaledVector(normal,distance);
      const ray=referenceTarget.clone().sub(sample.light.position),range=ray.length();
      // Wider sources put their outer samples far off axis. Keep the bust in
      // each sample's cone/shadow frustum without changing the planar output.
      // The cone tracks the bust's actual angular size (+2.3 covers the full
      // bust extent around the target): the old 1.22 floor spread each shadow
      // map over a ~70-degree frustum, leaving texels too coarse for ears and
      // eyelids to block light at all.
      sample.light.angle=Math.max(.3,Math.min(Math.PI/2-.01,Math.atan2(
        Math.hypot(sample.u*currentWidth*.5,sample.v*currentHeight*.5)+2.3,distance)));
      sample.light.shadow.camera.far=Math.max(12,range+4);
      // Blur each sample's shadow in proportion to the gap between samples,
      // so a WIDE source reads as one soft penumbra instead of N stacked
      // hard shadows (Kent's 09-19 "4ish separate lights" banding). The gap
      // between neighbouring samples grows with source size; spreading each
      // PCF kernel by roughly that gap (expressed in shadow-map texels at
      // the target) makes the bands overlap and fuse. Small sources keep a
      // crisp geometric penumbra (radius clamps to 1 = plain PCF).
      const sampleGap=Math.max(currentWidth,currentHeight)/(sampleCount===9?3:2);
      const texelWorld=2*distance*Math.tan(sample.light.angle)/mapSize;
      sample.light.shadow.radius=THREE.MathUtils.clamp(sampleGap*.5/Math.max(texelWorld,1e-6),1,24);
      const sourceCosine=Math.max(0,normal.dot(ray)/range);
      // The reference receiver faces the source center. Its cosine is kept
      // separate because Three's lit material supplies this second cosine.
      const receiverCosine=sourceCosine;
      sample.referenceDistance=range;sample.sourceCosine=sourceCosine;
      sample.receiverCosine=receiverCosine;
    }
    let computed=0;
    for(const sample of samples){
      sample.light.intensity=radiometricScale*sample.weight*sample.sourceCosine;
      computed+=sample.light.intensity*sample.receiverCosine/
        (sample.referenceDistance*sample.referenceDistance);
    }
    metrics.width=currentWidth;metrics.height=currentHeight;metrics.distance=distance;
    metrics.computedReferenceIlluminance=computed;metrics.radiometricScale=radiometricScale;
    metrics.output=Math.PI*radiometricScale;metrics.powerMultiplier=powerMultiplier;
    metrics.powerStops=currentPowerStops;metrics.exposureMode=currentExposureMode;
    metrics.intensityScale=currentIntensityScale;
    metrics.position.copy(center);metrics.normal.copy(normal);metrics.right.copy(right);metrics.up.copy(up);
    metrics.minIntensity=Math.min(...samples.map(sample=>sample.light.intensity));
    metrics.maxIntensity=Math.max(...samples.map(sample=>sample.light.intensity));
    group.userData.areaNormal=normal.clone();group.userData.areaRight=right.clone();group.userData.areaUp=up.clone();
    group.updateMatrixWorld(true);
    return api;
  }
  function dispose(){
    for(const {light}of samples)light.shadow.map?.dispose();
    group.remove(...group.children);
  }
  const api={group,samples,metrics,update,dispose};
  update({position,width,height});
  return api;
}

function toVector3(value,name){
  if(value?.isVector3&&[value.x,value.y,value.z].every(Number.isFinite))return value;
  if(Array.isArray(value)&&value.length===3&&value.every(Number.isFinite))return new THREE.Vector3(...value);
  throw new TypeError(`${name} must be a THREE.Vector3 or finite [x, y, z]`);
}
