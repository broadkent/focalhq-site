import * as THREE from './vendor/three.module.min.f231b18ca7.js';

// Reflected-light teaching meter. The neutral studio backdrop is UI, not a
// photographed surface; only the subject contributes to the reading.
// The viewfinder's zone grid: the matrix frame the app draws over the stage and the
// cells the highlight-weighted reading names its brightest from. Must match
// lightingMeterZones in lib/features/lessons/presentation/lighting_metering_frame.dart.
export const ZONE_COLS=4,ZONE_ROWS=6; // domain: matrix zone grid, columns x rows

// `aspect` is the stage's width over its height: the 48 x 48 readback stretches
// the stage to a square, so the spot and center rings are measured in the stage's
// own pixels (a true circle, a fraction of its shorter side), not in the square's.
export function weightedLuminance(pixels, width, height, mode='matrix', aspect=1) {
  let sum=0,weightSum=0;const values=[];
  const shorter=Math.min(1,aspect);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;if(pixels[i+3]<.5)continue;
    const luminance=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
    if(!Number.isFinite(luminance))continue;
    const radius=Math.hypot(((x+.5)/width-.5)*aspect,(y+.5)/height-.5)/shorter;
    const weight=mode==='spot'?(radius<=.10?1:0):mode==='center-weighted'?(radius<=.25?3:1):1;
    sum+=luminance*weight;weightSum+=weight;values.push(luminance);
  }
  if(mode==='highlight-weighted'&&values.length){
    values.sort((a,b)=>a-b);return values[Math.floor((values.length-1)*.95)];
  }
  // A spot off the subject sees the unlit photographic background.
  return weightSum?sum/weightSum:0;
}

// Mean linear luminance of each cell of a cols x rows grid over the frame (null
// where the subject does not reach it), and the brightest cell's index.
export function zoneLuminance(pixels, width, height, cols=ZONE_COLS, rows=ZONE_ROWS) {
  const sum=new Array(cols*rows).fill(0),count=new Array(cols*rows).fill(0);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;if(pixels[i+3]<.5)continue;
    const luminance=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
    if(!Number.isFinite(luminance))continue;
    // Readback rows run bottom to top; zone rows run top to bottom.
    const cell=(rows-1-Math.min(rows-1,Math.floor(y*rows/height)))*cols+Math.min(cols-1,Math.floor(x*cols/width));
    sum[cell]+=luminance;count[cell]++;
  }
  const mean=sum.map((total,cell)=>count[cell]?total/count[cell]:null);
  let brightest=null;
  mean.forEach((value,cell)=>{if(value!==null&&(brightest===null||value>mean[brightest]))brightest=cell;});
  return {cols,rows,mean,brightest};
}

// onReading opts in to asynchronous readback (a pixel-pack buffer and a fence,
// so the GPU is never waited on): sample() then returns the newest completed
// reading, one frame behind the render it issued, and calls onReading when a
// newer one lands. The first reading, and any renderer without the async path,
// read synchronously, and so does any sample the caller does not allow to lag
// (llowAsync:false): a one-off update should be exact when it is drawn.
export function createLightingMeter(renderer,{onReading=null}={}){
  const size=48;
  const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,
    format:THREE.RGBAFormat,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  target.texture.colorSpace=THREE.LinearSRGBColorSpace;
  const pixels=new Float32Array(size*size*4);
  let reference=null;
  let hasPixels=false,sampleCount=0,readbackCount=0,lastKey=null,disposed=false;
  let asyncOk=typeof onReading==='function'&&typeof renderer.readRenderTargetPixelsAsync==='function'&&
    renderer.capabilities?.isWebGL2===true;
  let issued=0,applied=0;
  // Luminance per mode is derived from the pixels alone; recompute it only
  // after a new readback (the matrix mode doubles as the display reading).
  let luminanceByMode=new Map();
  let histogramKey=null,histogramValue=[];
  let aspect=1,zones=null;
  const luminanceFor=requested=>{
    if(!luminanceByMode.has(requested))luminanceByMode.set(requested,weightedLuminance(pixels,size,size,requested,aspect));
    return luminanceByMode.get(requested);
  };
  return {
    // The stage's width over its height, so the spot and center rings are round.
    setAspect(next){
      if(!(next>0)||next===aspect)return;
      aspect=next;luminanceByMode=new Map();
    },
    // `key` identifies everything the reading depends on (camera, lights,
    // model). An equal key reuses the last readback instead of re-rendering.
    sample(scene,camera,{hidden=[],mode='matrix',refresh=true,key=null,allowAsync=true}={}){
      const previous=renderer.getRenderTarget(),background=scene.background;
      const toneMapping=renderer.toneMapping,alpha=renderer.getClearAlpha();
      const clear=renderer.getClearColor(new THREE.Color());
      const visibility=hidden.map(object=>object.visible);
      const stale=key===null||key!==lastKey;
      if((refresh&&stale)||!hasPixels){
        lastKey=key;
        try{
          hidden.forEach(object=>object.visible=false);scene.background=null;
          renderer.toneMapping=THREE.NoToneMapping;renderer.setClearColor(0,0);
          renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);sampleCount++;
          if(asyncOk&&allowAsync&&hasPixels)readAsync();
          else{
            // Synchronous: exact now, and any older asynchronous read still in flight is stale.
            applied=++issued;
            renderer.readRenderTargetPixels(target,0,0,size,size,pixels);readbackCount++;hasPixels=true;luminanceByMode=new Map();
          }
        }finally{
          hidden.forEach((object,i)=>object.visible=visibility[i]);scene.background=background;
          renderer.toneMapping=toneMapping;renderer.setClearColor(clear,alpha);renderer.setRenderTarget(previous);
        }
      }
      return read(mode);
    },
    // The reading for the pixels held now, without sampling.
    read,
    get metrics(){return {sampleCount,readbackCount,hasPixels};},
    dispose(){disposed=true;target.dispose();hasPixels=false;},
  };
  function readAsync(){
    const seq=++issued,buffer=new Float32Array(size*size*4);
    const read=renderer.readRenderTargetPixelsAsync(target,0,0,size,size,buffer);
    // three leaves its pack buffer bound until the fence lands (it rebinds before it
    // copies out), and any other readPixels meanwhile (the backdrop's, the header's)
    // fails with INVALID_OPERATION: unbind it right after the read is issued.
    const gl=renderer.getContext?.();if(gl?.PIXEL_PACK_BUFFER)gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    read.then(data=>{
      if(disposed||seq<applied)return;
      applied=seq;pixels.set(data);readbackCount++;luminanceByMode=new Map();onReading();
    }).catch(()=>{
      // The async path failed on this device: read synchronously from now on.
      asyncOk=false;lastKey=null;
    });
  }
  function read(mode='matrix'){
      // Fixed reference: initial studio at ISO 100, f/4, 1/125. This is a
      // relative exposure simulator, not an absolute lux-calibrated meter.
      const matrixLuminance=luminanceFor('matrix');
      if(reference===null)reference=Math.max(1e-6,matrixLuminance);
      const luminance=luminanceFor(mode);
      const sceneStops=Math.log2(Math.max(1e-8,luminance)/reference);
      const displayScene=Math.log2(Math.max(1e-8,matrixLuminance)/reference);
      // Camera exposure stays fixed when metering changes. Move the target
      // instead: bar minus target still equals the selected meter's reading.
      if(!zones||zones.for!==luminanceByMode)zones={for:luminanceByMode,value:zoneLuminance(pixels,size,size)};
      return {scene:sceneStops,displayScene,targetStops:displayScene-sceneStops,luminance,matrixLuminance,
        zones:zones.value,hasSceneLight:matrixLuminance>1e-8,hasMeteredLight:luminance>1e-8,reference};
  }
}
