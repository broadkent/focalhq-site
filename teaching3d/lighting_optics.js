import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {SHADE_GLSL,CEL_GLSL,shadeUniforms,applyShadeColors,applyLevels,halftonePitch} from './lighting_shading.js';
import {NOISE_SHOT,NOISE_READ,NOISE_REDUCTION_SHARE,NOISE_REDUCTION_ISO,NOISE_CHROMA_SHOT,NOISE_CHROMA_READ,BASE_ISO,grainGain,SHAKE_TAPS,shakeNeeded,IGN_A,IGN_B,IGN_C} from './lighting_effects.js';

// A bounded thin-lens display pass. The renderer owns exposure and color
// management; this helper owns only depth-aware defocus and the final print
// palette. Keeping both operations in the fullscreen pass prevents print
// quantization from changing the lighting/material math before exposure.
//
// Handheld shake is a second pass. The optics pass draws the finished,
// defocused picture to the canvas; when the shutter is slow enough to shake,
// the canvas is copied to a texture and the shake pass blurs that texture
// sideways with single-fetch taps, then grains the result. A blur of a finished
// picture cannot draw the dark rim an added shake delta did, and the shake
// costs SHAKE_TAPS fetches instead of 16 defocused pixels.
const SENSOR_WIDTH_METERS=0.036;
// Defocus taps gathered while the camera moves (center plus the cross); tune on the phone, 1..13.
const CHEAP_TAPS=5;
const SAMPLE_OFFSETS=Object.freeze([
  [0,0],[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[-.707,.707],
  [.707,-.707],[-.707,-.707],[.5,0],[-.5,0],[0,.5],[0,-.5],
]);

const VERTEX=`
  varying vec2 vUv;
  void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}
`;
// Sensor noise, the ISO lesson's model (see lighting_effects.js). Shared by the
// optics pass (no shake) and the shake pass (grain after the blur).
const NOISE=`
  uniform float isoGain;
  uniform float noiseGrain;
  uniform float noiseCell;
  const float NOISE_SHOT=${NOISE_SHOT};
  const float NOISE_READ=${NOISE_READ};
  const float NOISE_REDUCTION_SHARE=${NOISE_REDUCTION_SHARE};
  const float NOISE_REDUCTION_GAIN=${NOISE_REDUCTION_ISO/BASE_ISO}.;
  const float NOISE_CHROMA_SHOT=${NOISE_CHROMA_SHOT};
  const float NOISE_CHROMA_READ=${NOISE_CHROMA_READ};
  vec3 srgbToLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
  vec3 linearToSrgb(vec3 c){c=clamp(c,0.,1.);return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
  float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
  // Unit-variance noise from three uniform draws (Irwin-Hall).
  float gauss(vec2 p){return (hash12(p)+hash12(p+17.1)+hash12(p+43.7)-1.5)*2.;}
  // Noise smoothed over a cell of pixels; the 1.4 puts back the spread the
  // interpolation takes off a lattice cell's unit variance.
  float smoothNoise(vec2 p,float cell,float seed){
    vec2 q=p/cell,i=floor(q),f=q-i;f=f*f*(3.-2.*f);
    float a=gauss(i+seed),b=gauss(i+vec2(1.,0.)+seed),c=gauss(i+vec2(0.,1.)+seed),d=gauss(i+vec2(1.,1.)+seed);
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y)*1.4;
  }
  // iso_bake.py's noisy(): noise added in linear light, shot noise on the signal
  // plus read noise, less the camera's noise reduction, partly shared by the
  // channels (brightness) and partly per channel (colour). Clipped highlights stay clipped.
  vec3 sensorNoise(vec3 shown,bool paper){
    vec3 lin=srgbToLinear(shown),x=max(lin,0.);
    vec3 shot=NOISE_SHOT*(isoGain-1.)*x;
    float read=NOISE_READ*NOISE_READ*(isoGain*isoGain-1.);
    vec3 floorNoise=NOISE_REDUCTION_SHARE*sqrt(NOISE_SHOT*(NOISE_REDUCTION_GAIN-1.)*x+NOISE_READ*NOISE_READ*(NOISE_REDUCTION_GAIN*NOISE_REDUCTION_GAIN-1.));
    float clipped=paper?0.:clamp((max(shown.r,max(shown.g,shown.b))-.94)/.05,0.,1.);
    vec3 sigma=noiseGrain*max(sqrt(shot+read)-floorNoise,0.)*(1.-clipped);
    vec3 chroma=NOISE_CHROMA_SHOT+(NOISE_CHROMA_READ-NOISE_CHROMA_SHOT)*(read/(shot+read+1e-9));
    vec2 p=floor(gl_FragCoord.xy);float seed=isoGain*7.31;
    // Brightness speckle is about a CSS pixel across, colour speckle about three.
    float luma=smoothNoise(p,1.2*noiseCell,seed);
    float blot=3.*noiseCell;
    vec3 colour=vec3(smoothNoise(p,blot,seed+3.1),smoothNoise(p,blot,seed+9.7),smoothNoise(p,blot,seed+15.3));
    return linearToSrgb(lin+sigma*(sqrt(1.-chroma*chroma)*luma+chroma*colour));
  }
`;
const FRAGMENT=`
  precision highp float;
  uniform sampler2D colorTexture;
  uniform sampler2D depthTexture;
  // The source target's size (tap offsets, depth) and the canvas's (the print screen).
  uniform vec2 resolution;
  uniform vec2 outputResolution;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float focalLengthMm;
  uniform float aperture;
  uniform float focusDistance;
  uniform float worldUnitsPerMeter;
  uniform float sensorWidthMeters;
  uniform float maxBlurPixels;
  uniform float exactFocusPixels;
  uniform float printMode;
  // 1 while the shake pass follows in the print: this pass writes the unscreened tone and the shake pass screens it once, after the smear.
  uniform float deferScreen;
  uniform float subjectDistance;
  uniform float viewZoom;
  // 1 while the camera moves: the defocus gathers CHEAP_TAPS taps instead of 13.
  uniform float cheap;
  // 1 in the moving halftone frame: no defocus at all (the sharp tone is screened as is).
  uniform float noDefocus;
  // 1 in a smooth drag frame: the tone is held to the print's own range (see floorToPaper).
  uniform float toneFloor;
  // 1 when this pass draws the finished picture (levelOut); 0 when the shake pass or the tone copy follows.
  uniform float leveled;
  varying vec2 vUv;
  const float PI=3.14159265359;
  const int CHEAP_TAPS=${CHEAP_TAPS};
  ${NOISE}
  // Below half a pixel the subject's defocus cannot move its silhouette.
  const float paperScatterPixels=.5;
  const vec2 offsets[13]=vec2[13](${SAMPLE_OFFSETS.map(([x,y])=>`vec2(${x},${y})`).join(',')});
  float viewDepth(float depth){
    float z=depth*2.0-1.0;
    return (2.0*cameraNear*cameraFar)/(cameraFar+cameraNear-z*(cameraFar-cameraNear));
  }
  float cocMeters(float z){
    float focal=focalLengthMm*.001;
    float apertureDiameter=max(.0001,focal/max(aperture,.1));
    float coc=abs(apertureDiameter*focal*(z-focusDistance)/(z*(focusDistance-focal)));
    float limit=maxBlurPixels*resolution.x/max(outputResolution.x,1.);
    return clamp(.5*coc/max(sensorWidthMeters,.0001)*resolution.x*viewZoom,-limit,limit);
  }
  float cocPixels(float depth){
    return cocMeters(viewDepth(depth)/max(worldUnitsPerMeter,.0001));
  }
  ${SHADE_GLSL}
  // The finished picture for one pixel: exposure, display encoding, then the
  // halftone screen. Depth of field blurs the tone, never the light.
  vec3 display(vec3 hdr){
    gl_FragColor=vec4(hdr,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return gl_FragColor.rgb;
  }
  vec3 paperShown(vec3 hdr){
    gl_FragColor=vec4(hdr,1.);
    #include <colorspace_fragment>
    return gl_FragColor.rgb;
  }
  // Where the print screen samples: the pixel's own center, so the dots and
  // dots sit on the same lattice wherever the tap came from.
  vec2 screenPx(vec2 uv){return floor(uv*outputResolution)+.5;}
  bool screenInPass(){return printMode>.5&&deferScreen<.5;}
  // The halftone cannot print a tone past its paper: a shadow darker than a dark paper, or a highlight lighter than a light paper, is paper (halftoneInk clamps the ink amount to 0..1). A smooth drag frame holds the same range, in linear light and keeping the hue, so its darkest shadow lands on the page's own black and the switch to the print does not pop.
  vec3 floorToPaper(vec3 shown){
    vec3 lin=srgbToLinear(shown),paperLin=srgbToLinear(paperColor);
    float L=lumaOf(lin),Lp=max(lumaOf(paperLin),1e-6);
    float Lc=lumaOf(inkColor)>lumaOf(paperColor)?max(L,Lp):min(L,Lp);
    // The part past the paper is replaced by paper, in the paper's own tint: the floor is exactly the page's black.
    return linearToSrgb(lin+(Lc-L)*(paperLin/Lp));
  }
  vec3 finish(vec3 hdr,vec2 uv){
    vec3 shown=display(hdr);
    if(toneFloor>.5)shown=floorToPaper(shown);
    return screenInPass()?shadeInk(shown,screenPx(uv)):shown;
  }
  // The halftone is a screen laid on the print, not part of the picture:
  // defocus blurs the tone and the screen is applied once afterwards, so the
  // dots keep their pitch and shape however far out of focus.
  bool screenAfterBlur(){return screenInPass();}
  vec3 tapTone(vec3 hdr,vec2 uv,bool screen){return screen?display(hdr):finish(hdr,uv);}
  // One finished pixel at uv with defocus applied. While the camera moves
  // (cheap) the same gather runs on the first CHEAP_TAPS taps.
  vec3 defocusedPixel(vec2 uv){
    vec4 c=texture2D(colorTexture,uv);
    float depth=texture2D(depthTexture,uv).r;
    bool screen=screenAfterBlur();
    int taps=cheap>.5?CHEAP_TAPS:13;
    if(depth<.999999){
      vec3 shown=finish(c.rgb,uv);
      if(noDefocus>.5)return shown;
      float coc=cocPixels(depth);
      // At exact focus (blur under exactFocusPixels, 1/1000 px) the taps all
      // land within a thousandth of a texel of the center, so the loop would
      // return the center color after 26 extra fetches.
      if(abs(coc)<=exactFocusPixels)return shown;
      vec3 sum=vec3(0.),paperSum=vec3(0.);float weightSum=0.,paperWeight=0.;
      for(int k=0;k<13;k++){
        if(k>=taps)break;
        vec2 suv=uv+offsets[k]*coc/max(resolution,vec2(1.));
        float sampleDepth=texture2D(depthTexture,suv).r;
        vec4 sampleColor=texture2D(colorTexture,suv);
        // UI backdrop/panel cues are not illumination and must not leak into
        // a dark subject through the defocus filter.
        // The empty paper behind the subject is a legitimate neighbor: a
        // defocused silhouette edge fades into it instead of staying crisp.
        bool paper=sampleDepth>=.999999&&abs(sampleColor.a-.5)>=.01;
        if(paper){
          vec3 pt=paperShown(sampleColor.rgb);
          // The paper is never screened: it joins after the model's tone is.
          if(screen){paperSum+=pt;paperWeight+=1.;}else{sum+=pt;weightSum+=1.;}
        }else{
          float depthWeight=(sampleDepth>=.999999||abs(sampleColor.a-.5)<.01)?0.0:exp(-abs(viewDepth(sampleDepth)-viewDepth(depth))*18.0/max(viewDepth(depth),.001));
          sum+=tapTone(sampleColor.rgb,suv,screen)*depthWeight;weightSum+=depthWeight;
        }
      }
      if(!screen)return sum/max(weightSum,.0001);
      vec3 inked=shadeInk(sum/max(weightSum,.0001),screenPx(uv));
      return (inked*weightSum+paperSum)/max(weightSum+paperWeight,.0001);
    }
    // Paper pixel: scatter the subject's defocus outward. Taps within the
    // subject's circle of confusion that land on the subject carry its
    // finished color, the rest keep the paper, so the silhouette softens on
    // both sides of the edge.
    vec3 shown=paperShown(c.rgb);
    // The filtered silhouette edge mixes the bust's dark with the paper: held to the paper too.
    if(toneFloor>.5)shown=floorToPaper(shown);
    float subjectCoc=subjectDistance>0.?cocMeters(subjectDistance):0.;
    if(noDefocus<.5&&abs(subjectCoc)>paperScatterPixels){
      vec3 sum=vec3(0.);float hits=0.;
      for(int k=0;k<13;k++){
        if(k>=taps)break;
        vec2 suv=uv+offsets[k]*subjectCoc/max(resolution,vec2(1.));
        float sampleDepth=texture2D(depthTexture,suv).r;
        vec4 sampleColor=texture2D(colorTexture,suv);
        if(sampleDepth<.999999&&abs(sampleColor.a-.5)>=.01){sum+=tapTone(sampleColor.rgb,suv,screen);hits+=1.;}
      }
      if(hits>0.){
        vec3 model=screen?shadeInk(sum/hits,screenPx(uv)):sum/hits;
        shown=(model*hits+shown*(float(taps)-hits))/float(taps);
      }
    }
    return shown;
  }
  void render(){
    float centerDepth=texture2D(depthTexture,vUv).r;
    vec4 center=texture2D(colorTexture,vUv);
    // Opaque softbox materials reserve alpha .5 in the HDR buffer as an
    // indicator flag. Preserve their black-to-white setting preview instead
    // of applying photographic exposure or the print screen to that UI cue.
    if(abs(center.a-.5)<.01){
      // The cue is never given exposure, defocus or noise (it shakes with the picture in the shake pass), but in the print it is screened like the picture: the panel is a halftone tone, not flat gray.
      vec3 cue=paperShown(center.rgb);
      gl_FragColor=vec4(screenInPass()?shadeInk(cue,screenPx(vUv)):cue,1.);
      return;
    }
    // The softbox's drawn edges (alpha .24 outline, .7 housing) are ink lines: shown as drawn, never screened into dashes, no exposure or noise.
    if(abs(center.a-.24)<.01||abs(center.a-.7)<.01){
      gl_FragColor=vec4(paperShown(center.rgb),1.);
      return;
    }
    vec3 shown=defocusedPixel(vUv);
    // Sensor noise over the whole frame: the subject and the empty paper both
    // grain (the paper is a light tone, not clipped white, so it speckles
    // lighter and darker like the bust). The exposure meter read its own clean
    // render. While the picture shakes isoGain is 1 here: the shake pass grains
    // after the blur so the grain is not smeared.
    if(isoGain>1.001)shown=sensorNoise(shown,centerDepth>=.999999);
    gl_FragColor=vec4(shown,1.);
  }
  void main(){
    render();
    // The finished picture only: a pass whose output is shaken or screened afterwards hands on its tone as is.
    if(leveled>.5)gl_FragColor.rgb=levelOut(gl_FragColor.rgb);
  }
`;
// The shake pass: SHAKE_TAPS single fetches of the finished picture along x,
// the tap lattice shifted by interleaved gradient noise of the pixel so the
// steps dither into a smear (no repeated outline stripes), then grain.
const SHAKE_FRAGMENT=`
  precision highp float;
  uniform sampler2D finishedTexture;
  uniform sampler2D colorTexture;
  uniform sampler2D depthTexture;
  uniform vec2 resolution;
  uniform vec2 outputResolution;
  uniform float printMode;
  uniform float shakePixels;
  varying vec2 vUv;
  const int SHAKE_TAPS=${SHAKE_TAPS};
  ${NOISE}
  ${SHADE_GLSL}
  vec2 screenPx(vec2 uv){return floor(uv*outputResolution)+.5;}
  void main(){
    float phase=fract(${IGN_C}*fract(dot(floor(gl_FragCoord.xy),vec2(${IGN_A},${IGN_B}))));
    float span=shakePixels/max(resolution.x,1.);
    vec3 sum=vec3(0.);
    for(int i=0;i<SHAKE_TAPS;i++){
      float t=(float(i)+phase)/float(SHAKE_TAPS)-.5;
      sum+=texture2D(finishedTexture,vUv+vec2(t*span,0.)).rgb;
    }
    vec3 shown=sum/float(SHAKE_TAPS);
    // The halftone is a screen laid on the print after the shake as after the blur: the finished tone is smeared unscreened and screened once, so the dots keep their pitch. The softbox lines stay plain ink.
    float flag=texture2D(colorTexture,vUv).a;
    if(printMode>.5&&abs(flag-.24)>=.01&&abs(flag-.7)>=.01)shown=shadeInk(shown,screenPx(vUv));
    // Grain over the whole frame except the softbox cue, after the blur.
    if(isoGain>1.001&&abs(texture2D(colorTexture,vUv).a-.5)>=.01&&abs(texture2D(colorTexture,vUv).a-.24)>=.01&&abs(texture2D(colorTexture,vUv).a-.7)>=.01)shown=sensorNoise(shown,texture2D(depthTexture,vUv).r>=.999999);
    gl_FragColor=vec4(levelOut(shown),1.);
  }
`;
// The moving (cel) frame, see lighting_quality.js: tone mapping and display
// encoding only, then flat ink bands in the print. No defocus taps, halftone,
// grain or shake, and no depth fetch: the paper is told by its color, the scene's
// background exactly. It draws into a small target (render targets get no automatic
// tone mapping or encoding, so both are done here with three's own ACES).
const CEL_FRAGMENT=`
  precision highp float;
  uniform sampler2D colorTexture;
  uniform vec3 paperHdr;
  uniform float printMode;
  uniform float noiseCell;
  varying vec2 vUv;
  ${THREE.ShaderChunk.tonemapping_pars_fragment.replaceAll('toneMappingExposure','celExposure')}
  ${SHADE_GLSL}
  ${CEL_GLSL}
  vec3 encode(vec3 c){c=clamp(c,0.,1.);return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
  void main(){
    vec4 c=texture2D(colorTexture,vUv);
    // The softbox's drawn edges stay plain ink lines; the panel cue and the paper get no exposure.
    if(abs(c.a-.24)<.01||abs(c.a-.7)<.01){gl_FragColor=vec4(levelOut(encode(c.rgb)),1.);return;}
    bool paper=abs(c.a-.5)>=.01&&all(lessThan(abs(c.rgb-paperHdr),vec3(.002)));
    vec3 shown=abs(c.a-.5)<.01||paper?encode(c.rgb):encode(ACESFilmicToneMapping(c.rgb));
    if(printMode>.5&&!paper)shown=celInk(shown);
    gl_FragColor=vec4(levelOut(shown),1.);
  }
`;
// Draws a finished frame texture to the canvas as is (no encoding: it is already
// display-encoded), upscaling the cel target; with fade > 0 it blends toward the
// full frame captured on lift (the lift crossfade).
const BLIT_FRAGMENT=`
  precision highp float;
  uniform sampler2D frameTexture;
  uniform sampler2D liftTexture;
  uniform float fade;
  uniform float band;
  // 1 once the lift also kept the unscreened tone: the wave then splits the coarse dots into the fine print (see below) instead of crossfading the two pictures.
  uniform float morph;
  uniform sampler2D toneTexture;
  uniform vec2 outSize;
  // x, y: the moving canvas in px; z: its dot pitch in its own px; w: the full print's dot pitch in canvas px.
  uniform vec4 morphGeom;
  uniform float noiseCell;
  varying vec2 vUv;
  ${SHADE_GLSL}
  vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
  vec3 toDisplay(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
  void main(){
    vec3 c=texture2D(frameTexture,vUv).rgb;
    // The prints dissolve in linear light (the mean of the frame then moves in a straight line between the two prints; an sRGB mix of two dot lattices sinks below both) and both carry the same paper floor, so the paper neither dips nor lifts.
    // A wave front can roll from the top left to the bottom right: each cell mixes by how far the front is past it, through its band (band 0, the Studio's setting: every cell at the same mix, the whole frame at once).
    if(fade>0.){
      float m=fade;
      if(band>0.){float d=(vUv.x+1.-vUv.y)*.5;m=smoothstep(0.,1.,(fade*(1.+band)-d)/band);}
      if(m>=1.)c=texture2D(liftTexture,vUv).rgb;
      else if(m>0.){
        vec3 lift=texture2D(liftTexture,vUv).rgb;
        vec3 mixed=lift;
        vec3 from=toLinear(c);
        if(morph>.5){
          // Each coarse cell splits into the fine print along the front: the coarse dot gives up (1-m) of its ink amount, and the fine lattice carries the rest, as the amount that makes the two together the local tone (the fine dots over the coarse one are not counted twice). Each lattice is evaluated in its own pixels (the coarse in the moving canvas' hard pixels, the fine in the full canvas' own) so both ends are the two prints exactly.
          float a=halftoneAmount(texture2D(toneTexture,vUv).rgb);
          float a1=(1.-m)*a;
          // (the two lattices overlap a little more than chance: the fine amount is raised by that, at most 2.5%, mid-front)
          float a2=min(1.,m*a/max(1.-a1,.001)*(1.+.1*m*(1.-m)));
          float fc=halftoneFraction(a1,floor(vUv*morphGeom.xy)+.5,morphGeom.z);
          float ff=halftoneFraction(a2,floor(vUv*outSize)+.5,morphGeom.w);
          // The ends hand over to the real frames, so a seam in the tone cannot show.
          vec3 split=toLinear(levelOut(halftonePrint(fc+(1.-fc)*ff)));
          from=mix(from,split,smoothstep(0.,.12,m));
          mixed=toDisplay(mix(from,toLinear(lift),smoothstep(.88,1.,m)));
        }else mixed=toDisplay(mix(from,toLinear(lift),m));
        c=mixed;
      }
    }
    gl_FragColor=vec4(c,1.);
  }
`;
export function createLightingOptics(renderer,{maxBlurPixels=18,exactFocusPixels=.001}={}){
  if(!renderer||typeof renderer.setRenderTarget!=='function')throw new TypeError('renderer must be a WebGLRenderer');
  const target=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat,type:THREE.HalfFloatType,depthBuffer:true});
  // Telephoto framing can put thin eyelids and the outline shell tens of
  // scene units away. A 16-bit buffer merges their depths and makes the
  // surfaces fight; WebGL2's 24-bit depth keeps them correctly ordered.
  target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const material=new THREE.ShaderMaterial({uniforms:{
    colorTexture:{value:target.texture},depthTexture:{value:target.depthTexture},resolution:{value:new THREE.Vector2(1,1)},outputResolution:{value:new THREE.Vector2(1,1)},
    cameraNear:{value:.1},cameraFar:{value:40},focalLengthMm:{value:50},aperture:{value:4},focusDistance:{value:3},worldUnitsPerMeter:{value:5.333333},sensorWidthMeters:{value:SENSOR_WIDTH_METERS},maxBlurPixels:{value:maxBlurPixels},exactFocusPixels:{value:exactFocusPixels},printMode:{value:0},deferScreen:{value:0},leveled:{value:1},...shadeUniforms(THREE),subjectDistance:{value:0},viewZoom:{value:1},cheap:{value:0},noDefocus:{value:0},toneFloor:{value:0},isoGain:{value:1},noiseGrain:{value:1.7},noiseCell:{value:1},
  },vertexShader:VERTEX,fragmentShader:FRAGMENT,depthTest:false,depthWrite:false,toneMapped:true,transparent:true});
  // The canvas, copied after the optics pass, is the shake pass's input.
  let finished=new THREE.FramebufferTexture(1,1);
  finished.minFilter=finished.magFilter=THREE.LinearFilter;
  const shakeMaterial=new THREE.ShaderMaterial({uniforms:{
    finishedTexture:{value:finished},colorTexture:{value:target.texture},depthTexture:{value:target.depthTexture},resolution:material.uniforms.resolution,outputResolution:material.uniforms.outputResolution,printMode:material.uniforms.printMode,
    ...Object.fromEntries(Object.keys(shadeUniforms(THREE)).map(key=>[key,material.uniforms[key]])),
    shakePixels:{value:0},isoGain:{value:1},noiseGrain:material.uniforms.noiseGrain,noiseCell:material.uniforms.noiseCell,
  },vertexShader:VERTEX,fragmentShader:SHAKE_FRAGMENT,depthTest:false,depthWrite:false,toneMapped:false,transparent:false});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;
  const scene=new THREE.Scene();scene.add(quad);
  const shakeQuad=new THREE.Mesh(quad.geometry,shakeMaterial);shakeQuad.frustumCulled=false;
  const shakeScene=new THREE.Scene();shakeScene.add(shakeQuad);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  // The cel frame's target (one pixel per CSS pixel) and the pass that upscales it.
  const celTarget=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat,type:THREE.UnsignedByteType,depthBuffer:false});
  const celMaterial=new THREE.ShaderMaterial({uniforms:{
    colorTexture:material.uniforms.colorTexture,paperHdr:{value:new THREE.Vector3(1,1,1)},printMode:material.uniforms.printMode,noiseCell:material.uniforms.noiseCell,
    ...Object.fromEntries(Object.keys(shadeUniforms(THREE)).map(key=>[key,material.uniforms[key]])),celExposure:{value:1},
  },vertexShader:VERTEX,fragmentShader:CEL_FRAGMENT,depthTest:false,depthWrite:false,toneMapped:false,transparent:false});
  const blitMaterial=new THREE.ShaderMaterial({uniforms:{frameTexture:{value:celTarget.texture},liftTexture:{value:celTarget.texture},fade:{value:0},band:{value:0},morph:{value:0},toneTexture:{value:celTarget.texture},outSize:{value:new THREE.Vector2(1,1)},morphGeom:{value:new THREE.Vector4(1,1,3,8)},noiseCell:{value:1},...shadeUniforms(THREE)},
    vertexShader:VERTEX,fragmentShader:BLIT_FRAGMENT,depthTest:false,depthWrite:false,toneMapped:false,transparent:false});
  const celScene=new THREE.Scene(),blitScene=new THREE.Scene();
  for(const [into,mat] of [[celScene,celMaterial],[blitScene,blitMaterial]]){const q=new THREE.Mesh(quad.geometry,mat);q.frustumCulled=false;into.add(q);}
  let liftTexture=null,toneTexture=null,toneKept=false,movingHalftone=false,movingPitch=0,canvasSize=[1,1],liftMix=0;
  let hasRendered=false,sourceRenders=0,shakeRenders=0,celRenders=0;
  // The newest moving frame the lift crossfade fades from: the cel target's own texture, or (the moving halftone look) a copy of the canvas. frameReady is false until one is drawn and after the canvas is resized.
  let movingFrame=null,movingSize=[0,0],movingNearest=false,frameReady=false;
  // [nearest]: the moving print is upscaled with hard pixels on screen, so the copy the dissolve starts from is sampled the same way (a linear sample blurs the dots and the first dissolve frame would already differ from the last moving one).
  function keepMovingFrame(nearest,band,pitch){
    const [w,h]=canvasSize;
    if(!movingFrame||movingSize[0]!==w||movingSize[1]!==h||movingNearest!==nearest){
      movingFrame?.dispose();movingFrame=new THREE.FramebufferTexture(w,h);movingFrame.minFilter=movingFrame.magFilter=nearest?THREE.NearestFilter:THREE.LinearFilter;movingSize=[w,h];movingNearest=nearest;
    }
    blitMaterial.uniforms.band.value=band;
    renderer.copyFramebufferToTexture(movingFrame);
    blitMaterial.uniforms.frameTexture.value=movingFrame;frameReady=true;
    movingHalftone=true;movingPitch=pitch;blitMaterial.uniforms.morphGeom.value.set(w,h,pitch,blitMaterial.uniforms.morphGeom.value.w);
  }
  const api={
    // defocus false and grain false are the moving halftone frame (see lighting_quality.js); dotPitch (canvas px, 0 = the pixel ratio's own) keeps its dots the size they are at rest; keepFrame copies the finished canvas for the lift crossfade.
    render(sourceScene,sourceCamera,{focalLength=50,aperture=4,focusDistance=3,worldUnitsPerMeter=5.333333,printStyle='smooth',refresh=true,subjectDistance=0,viewZoom=1,iso=BASE_ISO,shakePx=0,pixelRatio=1,cheap=false,cel=false,defocus=true,grain=true,dotPitch=0,keepFrame=false,nearestFrame=false,waveCells=0,toneOnly=false,toneFloor=false}={}){
      // The cheap picture (the camera is moving) draws its source at reduced size and blurs with fewer taps and skips the shake pass; the optics pass grains it.
      const shaking=shakeNeeded(shakePx)&&!cheap,gain=grain?grainGain(iso):1;
      material.uniforms.cheap.value=cheap?1:0;material.uniforms.noDefocus.value=defocus?0:1;material.uniforms.toneFloor.value=toneFloor?1:0;
      material.uniforms.cameraNear.value=sourceCamera.near;material.uniforms.cameraFar.value=sourceCamera.far;
      material.uniforms.focalLengthMm.value=focalLength;material.uniforms.aperture.value=aperture;material.uniforms.focusDistance.value=focusDistance;material.uniforms.worldUnitsPerMeter.value=worldUnitsPerMeter;material.uniforms.sensorWidthMeters.value=sourceCamera.getFilmWidth?sourceCamera.getFilmWidth()*.001:SENSOR_WIDTH_METERS;material.uniforms.printMode.value=printStyle==='print'?1:0;material.uniforms.deferScreen.value=shaking&&printStyle==='print'?1:0;material.uniforms.subjectDistance.value=subjectDistance;material.uniforms.viewZoom.value=viewZoom;material.uniforms.noiseCell.value=pixelRatio;material.uniforms.dotPitch.value=dotPitch>0?dotPitch:halftonePitch(pixelRatio);
      // The optics pass grains the picture unless the shake pass will, after the blur.
      material.uniforms.isoGain.value=shaking?1:gain;shakeMaterial.uniforms.shakePixels.value=shakePx;
      // The lift also keeps the picture before the screen (the tone the dots are cut from): the same pass with the screen deferred and no shake.
      if(toneOnly)material.uniforms.deferScreen.value=1;
      // Only the pass that draws the finished picture applies the levels: the tone copy and the pass the shake follows hand on a tone.
      material.uniforms.leveled.value=toneOnly||shaking?0:1;
      const previous=renderer.getRenderTarget();
      if(refresh||!hasRendered){renderer.setRenderTarget(target);renderer.render(sourceScene,sourceCamera);renderer.setRenderTarget(previous);hasRendered=true;sourceRenders++;}
      if(cel){
        // The moving frame: the cel pass at one pixel per CSS pixel, upscaled to the canvas.
        celMaterial.uniforms.celExposure.value=renderer.toneMappingExposure;
        const bg=sourceScene.background;if(bg?.isColor)celMaterial.uniforms.paperHdr.value.set(bg.r,bg.g,bg.b);
        renderer.setRenderTarget(celTarget);renderer.render(celScene,camera);renderer.setRenderTarget(previous);
        blitMaterial.uniforms.frameTexture.value=celTarget.texture;frameReady=true;movingHalftone=false;
        blitMaterial.uniforms.fade.value=liftMix;renderer.render(blitScene,camera);celRenders++;
        return;
      }
      renderer.render(scene,camera);
      if(toneOnly){
        if(!toneTexture){toneTexture=new THREE.FramebufferTexture(...canvasSize);toneTexture.minFilter=toneTexture.magFilter=THREE.LinearFilter;blitMaterial.uniforms.toneTexture.value=toneTexture;}
        const kept=renderer.getRenderTarget();renderer.setRenderTarget(null);renderer.copyFramebufferToTexture(toneTexture);renderer.setRenderTarget(kept);
        toneKept=true;return;
      }
      if(keepFrame)keepMovingFrame(nearestFrame,dotPitch>0&&waveCells>0?waveCells*dotPitch/canvasSize[0]:0,dotPitch);
      if(shaking){
        renderer.copyFramebufferToTexture(finished);
        shakeMaterial.uniforms.isoGain.value=gain;
        renderer.render(shakeScene,camera);shakeRenders++;
      }
    },
    // The canvas is width x height; the source target is sourceScale of that (the cheap picture while the camera moves).
    // celScale is the cel frame's share of the canvas (one pixel per CSS pixel).
    resize(width,height,sourceScale=1,celScale=1){
      const w=Math.max(1,Math.floor(width)),h=Math.max(1,Math.floor(height));
      const tw=Math.max(1,Math.floor(w*sourceScale)),th=Math.max(1,Math.floor(h*sourceScale));
      target.setSize(tw,th);material.uniforms.resolution.value.set(tw,th);material.uniforms.outputResolution.value.set(w,h);hasRendered=false;
      celTarget.setSize(Math.max(1,Math.floor(w*celScale)),Math.max(1,Math.floor(h*celScale)));
      // copyFramebufferToTexture writes into allocated storage: a new size needs a new texture
      // (the same size, as when the moving frame toggles the source scale, keeps it).
      if(canvasSize[0]===w&&canvasSize[1]===h)return;
      canvasSize=[w,h];
      finished.dispose();finished=new THREE.FramebufferTexture(w,h);finished.minFilter=finished.magFilter=THREE.LinearFilter;
      shakeMaterial.uniforms.finishedTexture.value=finished;
      if(liftTexture){liftTexture.dispose();liftTexture=null;blitMaterial.uniforms.liftTexture.value=celTarget.texture;}
      if(toneTexture){toneTexture.dispose();toneTexture=null;blitMaterial.uniforms.toneTexture.value=celTarget.texture;}
      toneKept=false;
    },
    // The lift crossfade: keep the full frame just drawn on the canvas, then fade(t)
    // draws the newest cel frame blended toward it (t = 1 is the full frame, exactly);
    // a cel frame drawn mid-fade keeps the blend. endFade() when the fade is over.
    captureLift(){
      if(!liftTexture){liftTexture=new THREE.FramebufferTexture(...canvasSize);liftTexture.minFilter=liftTexture.magFilter=THREE.LinearFilter;blitMaterial.uniforms.liftTexture.value=liftTexture;}
      const previous=renderer.getRenderTarget();renderer.setRenderTarget(null);renderer.copyFramebufferToTexture(liftTexture);renderer.setRenderTarget(previous);
      // The split needs the moving halftone, the kept tone and both pitches; otherwise the wave crossfades.
      const u=blitMaterial.uniforms;
      u.morph.value=toneKept&&movingHalftone&&movingPitch>0?1:0;toneKept=false;
      u.outSize.value.set(...canvasSize);u.morphGeom.value.w=material.uniforms.dotPitch.value;
    },
    fade(t){
      const previous=renderer.getRenderTarget();renderer.setRenderTarget(null);
      liftMix=Math.min(1,Math.max(0,t));
      blitMaterial.uniforms.fade.value=liftMix;renderer.render(blitScene,camera);renderer.setRenderTarget(previous);
    },
    endFade(){liftMix=0;},
    // Whether a moving frame is kept to fade from; forget it when the stage is resized (it no longer fits).
    get hasMovingFrame(){return frameReady;},
    forgetMovingFrame(){frameReady=false;},
    get celRenders(){return celRenders;},
    setShadeColors(fg,bg){applyShadeColors(material.uniforms,fg,bg);applyShadeColors(blitMaterial.uniforms,fg,bg);},
    // The finished picture's black and white points, 0..1 display values (the shake and cel passes share the optics uniforms).
    setLevels(black,white){applyLevels(material.uniforms,black,white);applyLevels(blitMaterial.uniforms,black,white);},
    // 1 when the next lift can split the coarse dots (a moving halftone frame was kept).
    get movingHalftone(){return movingHalftone;},
    // 1 while the running dissolve splits the coarse dots (0: it crossfades).
    get splitting(){return blitMaterial.uniforms.morph.value;},
    // The wave front's width as a share of the diagonal (0: the whole frame at once).
    get waveBand(){return blitMaterial.uniforms.band.value;},
    get sourceRenders(){return sourceRenders;},
    get shakeRenders(){return shakeRenders;},
    uniforms:material.uniforms,
    dispose(){target.dispose();finished.dispose();material.dispose();shakeMaterial.dispose();celTarget.dispose();liftTexture?.dispose();movingFrame?.dispose();celMaterial.dispose();toneTexture?.dispose();blitMaterial.dispose();quad.geometry.dispose();hasRendered=false;},
    target,
  };
  return api;
}

export const lightingOpticsConstants=Object.freeze({sensorWidthMeters:SENSOR_WIDTH_METERS,sampleCount:SAMPLE_OFFSETS.length,recommendedWorldUnitsPerMeter:3.2/.6});
