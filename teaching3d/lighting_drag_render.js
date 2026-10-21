// The picture drawn while the learner drags (orbit, light drag, zoom), chosen by
// the playtest pill (Kent, October 15, 2026: "Give me like 3 to 5 good options,
// from which one looks the best as it's moving to which one is the absolute most
// performant while it's moving"). The host sends the index (`dragRender`
// command, or ?dragRender= on the page); the lift always draws the full print.
// The smooth choices (3 to 5) hold the print's tone range (toneFloor in lighting_optics.js): the halftone cannot print a tone past its paper, so its darkest shadow is the page black; a smooth frame drawn without that floor sank below it (dark theme) or sat lifted above it (the key material's fill), and the switch at hold-still popped.
// Index 0 is the half-res halftone (Kent, October 16, 2026: choice 6 of the first seven, now the default); the measurements below keep the numbers they were taken under (old 1 to 7 are now 2, 3, 4, 5, 6, 1, 7).
//
// Each choice is a recipe: the canvas's share of the device pixel ratio
// (`scale`), the lit source's share of its ratio (`source`), the screen
// (`look`: the halftone print or smooth tone), whether the 9 (or 4) shadowed
// sample lights stay, collapse to one unshadowed light per source (`lights`),
// and the bust's material for the frame (`material`: the clay as is, a cheaper
// Lambert clay, or `key`: one cosine to the key light, no light loop at all).
// Only the optics pass sees the change; the exposure meter reads the real scene.
//
// Measured, 412x915 at DPR 2.625, 4x CPU throttle, a scripted 2 s orbit drag,
// three runs (test/regression/lighting_drag_render_browser.cjs with
// DRAG_RENDER_MEASURE=1), October 15, 2026, Chrome on an RTX 3070 Ti (D3D11) with
// the machine busy; frame interval and draw ms (?perf=1 waits on the GPU), median / p95:
//   1  frame 10.0 / 68.2  draw 6.0 / 43.6  (223 draws in 6 s)
//   2  frame 10.0 / 39.6  draw 5.3 / 23.4  (335)
//   3  frame 10.0 / 39.7  draw 4.4 / 21.7  (282)
//   4  frame  9.9 / 19.7  draw 4.1 / 10.0  (474)
//   5  frame  9.7 / 19.5  draw 4.2 /  8.1  (474)
//   full pass on lift: 16-18 ms median.
// Choices 6 and 7 (Kent, October 16, 2026: keep the halftone, drop the resolution or the poly count while the camera moves), same rig, three runs, then one run in software GL:
//   6  frame 10.0 / 10.1  draw 3.4 / 3.7   (half-res halftone; software GL about 208 ms a frame)
//   7  frame 10.0 / 10.1  draw 3.7 / 4.4   (low-poly halftone; software GL about 375 ms)
// Choices 8 and 9 (Kent, October 16, 2026: a third and a quarter of the resolution), software GL, one run, with the choices renumbered (1 half-res, 2 the old 1, 3 to 6 the old 2 to 5, 7 low-poly): 1 208 ms, 2 400, 3 217, 4 192, 5 92, 6 58, 7 392, 8 third 108, 9 quarter 83.
// (this run, a quiet machine, held the 100 Hz frame cap for every choice; 1 to 5 now draw 4.0 / 3.4 / 3.4 / 2.6 / 2.6 ms median.) A desktop GPU hides pixel cost; in software GL (DRAG_GL=swiftshader, fill-bound
// like a phone) the canvas size dominates: 1 about 360 ms a frame, a half-ratio
// choice about 155, the quarter-ratio choice about 52 (one noisy run each).
import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {decimate} from './lod_decimate.js';

export const DRAG_RENDERS=Object.freeze([
  // 1: the default (Kent, October 16, 2026): the print at half the canvas size in each direction (a quarter of the pixels), upscaled with hard pixels (CSS pixelated; at DPR 2.625 the 2 to 1 step is whole), the dots the same size on screen.
  Object.freeze({name:'1',look:'halftone',scale:.5,source:null,lights:'all',shadows:true,material:'clay',nearest:true}),
  // 2: the rested print's halftone, small (MOVING_SCALE of the device ratio), every light, every shadow: the moving print before the choices.
  Object.freeze({name:'2',look:'halftone',scale:null,source:null,lights:'all',shadows:true,material:'clay'}),
  // 3: the same print at half the device ratio (the dots keep their size on screen).
  Object.freeze({name:'3',look:'halftone',scale:.5,source:null,lights:'all',shadows:true,material:'clay'}),
  // 4: smooth tone (no screen), every light and shadow, half the device ratio.
  Object.freeze({name:'4',look:'smooth',scale:.5,source:.5,lights:'all',shadows:true,material:'clay'}),
  // 5: smooth tone, one unshadowed Lambert light per source, a third of the device ratio.
  Object.freeze({name:'5',look:'smooth',scale:.35,source:.5,lights:'one',shadows:false,material:'lambert'}),
  // 6: the key light's cosine only (no light loop, no shadows) at a quarter of the device ratio: the cheapest smooth one.
  Object.freeze({name:'6',look:'smooth',scale:.25,source:.5,lights:'one',shadows:false,material:'key'}),
  // 7: the moving halftone from a decimated bust (LOW_POLY_SHARE of its triangles, shadows included), the full mesh on lift.
  Object.freeze({name:'7',look:'halftone',scale:null,source:null,lights:'all',shadows:true,material:'clay',lowPoly:true}),
  // 8: the print at a third of the canvas size in each direction, hard pixels, a whole 3 to 1 step: the canvas is the device ratio / 3 and the dot cell a whole number of its pixels (movingScreen `whole`; 3 px, 9 device px at DPR 2.625, a touch larger than the print's 8), so the lattice cannot beat against the upscale.
  Object.freeze({name:'8',look:'halftone',scale:1/3,whole:3,source:null,lights:'all',shadows:true,material:'clay',nearest:true}),
  // 9: the same at a quarter, a whole 4 to 1 step; its dot cell holds at 3 canvas px (12 device px, 1.5 times the print's): a 2 px cell aliases into a grey checker with a beat (WHOLE_MIN_PITCH_PX).
  Object.freeze({name:'9',look:'halftone',scale:1/4,whole:4,source:null,lights:'all',shadows:true,material:'clay',nearest:true}),
]);

// The share of the bust's triangles the low-poly choice keeps.
export const LOW_POLY_SHARE=.2; // domain: tuned by eye against the rested print

// The display tone of a fully lit surface in the `key` material, before exposure:
// the lit side of the bust reads about as bright as the clay under the key at rest.
export const KEY_LIT_TONE=.55; // domain: tuned by eye against the rested print
// The share of that tone a surface facing away from the key keeps (the fill a real set has).
export const KEY_FILL=0; // domain: tuned by eye against the rested print

// Kent, October 16, 2026: "Honestly 9 is great": the quarter-res print is the default (index 8; the Studio pill's names start at 1).
export const DEFAULT_DRAG_RENDER=8; // domain: index of choice 9, the quarter-res halftone
export function dragRenderIndex(value){
  if(value===null||value===undefined||value===''||value===false)return DEFAULT_DRAG_RENDER;
  const n=Number(value);
  return Number.isInteger(n)&&n>=0&&n<DRAG_RENDERS.length?n:DEFAULT_DRAG_RENDER;
}

// The moving quality for choice [index]; a still frame is [base] as is.
// [screen](scale) is the moving halftone canvas ({ratio, pitch}) at a share of the
// device ratio, the page's own moving one for null; [screenRatio] the device's ratio.
export function dragRenderQuality(base,index,{screenRatio,screen}){
  if(!base.moving)return base;
  const recipe=DRAG_RENDERS[index];
  const halftone=recipe.look==='halftone';
  const shot=halftone?screen(recipe.scale,recipe.whole):null;
  return {...base,look:'drag',cel:false,cheap:true,halftone,outline:false,
    pixelScale:recipe.source??base.pixelScale,
    canvasRatio:halftone?shot.ratio:screenRatio*recipe.scale,
    dotPitch:halftone?shot.pitch:0,
    printStyle:halftone?null:'smooth',toneFloor:!halftone,nearest:recipe.nearest===true,dragRender:index,recipe};
}

// Makes the scene what [quality] draws (lights, shadows, materials) and returns
// the undo. Nothing is changed for a still frame.
export function createDragScene(){
  const lambert=new THREE.MeshLambertMaterial({color:0xb5b5b5});
  const key=new THREE.ShaderMaterial({
    uniforms:{keyDir:{value:new THREE.Vector3(0,0,1)},tone:{value:1},fill:{value:KEY_FILL}},
    vertexShader:`varying vec3 vNormal;
      void main(){vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform vec3 keyDir;uniform float tone;uniform float fill;varying vec3 vNormal;
      void main(){float d=max(dot(normalize(vNormal),keyDir),0.);gl_FragColor=vec4(vec3(tone*(fill+(1.-fill)*d)),1.);}`,
  });
  const keyAt=new THREE.Vector3();
  const lods=new WeakMap();
  // The decimated copy of [geometry], made once, at the first low-poly frame.
  const lodOf=geometry=>{
    let lod=lods.get(geometry);
    if(!lod){
      const index=geometry.index?geometry.index.array:null,triangles=(index?index.length:geometry.attributes.position.count)/3;
      const small=decimate({position:geometry.attributes.position.array,normal:geometry.attributes.normal?.array,index},Math.max(12,Math.round(triangles*LOW_POLY_SHARE)));
      lod=new THREE.BufferGeometry();lod.setAttribute('position',new THREE.BufferAttribute(small.position,3));lod.setAttribute('normal',new THREE.BufferAttribute(small.normal,3));lod.setIndex(new THREE.BufferAttribute(small.index,1));lod.userData.triangles=small.triangles;lod.userData.fullTriangles=triangles;lods.set(geometry,lod);
    }
    return lod;
  };
  return {
    // True once a low-poly frame drew shadow maps from the decimated bust (they are static until a light moves): the first full frame marks them for a redraw.
    shadowsStale:false,
    // [triangles, fullTriangles] of the bust's low-poly copy (decimating it if need be).
    lowPolyTriangles(bust){
      let small=0,full=0;
      bust.traverse(object=>{if(object.isMesh&&object.name!=='headOutline'){const lod=lodOf(object.geometry);small+=lod.userData.triangles;full+=lod.userData.fullTriangles;}});
      return [small,full];
    },
    apply(quality,{renderer,bust,sources,target}){
      const recipe=quality.recipe;
      if(!recipe)return ()=>{};
      const undo=[];
      if(!recipe.shadows&&renderer.shadowMap.enabled){
        renderer.shadowMap.enabled=false;undo.push(()=>{renderer.shadowMap.enabled=true;});
      }
      if(recipe.lights==='one'){
        for(const source of sources){
          const samples=source.area.samples;
          // The sample nearest the source's center carries the whole source.
          const keep=samples.reduce((a,b)=>Math.abs(b.u)+Math.abs(b.v)<Math.abs(a.u)+Math.abs(a.v)?b:a);
          for(const sample of samples){
            const light=sample.light,visible=light.visible,intensity=light.intensity;
            if(sample===keep)light.intensity=intensity*samples.length;else light.visible=false;
            undo.push(()=>{light.visible=visible;light.intensity=intensity;});
          }
        }
      }
      if(recipe.lowPoly){
        if(renderer.shadowMap.needsUpdate)this.shadowsStale=true;
        bust.traverse(object=>{
          if(!object.isMesh||object.name==='headOutline')return;
          const was=object.geometry;object.geometry=lodOf(was);undo.push(()=>{object.geometry=was;});
        });
      }
      if(recipe.material!=='clay'){
        let material=lambert;
        if(recipe.material==='key'){
          material=key;
          const lit=sources.filter(source=>source.state.enabled);
          const brightest=lit.reduce((a,b)=>(b.area.metrics.output??0)>(a?.area.metrics.output??-1)?b:a,null);
          if(brightest)keyAt.fromArray(brightest.state.position).sub(target).normalize();else keyAt.set(0,0,1);
          key.uniforms.keyDir.value.copy(keyAt);
          // Before the optics pass's exposure: the lit side lands near KEY_LIT_TONE on screen, dark with every light off.
          key.uniforms.tone.value=brightest?KEY_LIT_TONE/Math.max(renderer.toneMappingExposure,1e-6):0;
        }
        bust.traverse(object=>{
          if(!object.isMesh||object.name==='headOutline')return;
          const was=object.material;object.material=material;undo.push(()=>{object.material=was;});
        });
      }
      return ()=>{for(let i=undo.length-1;i>=0;i--)undo[i]();};
    },
    dispose(){lambert.dispose();key.dispose();},
  };
}
