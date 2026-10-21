import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {CameraPrintMaterial} from './camera_print_material.js';
import {GLOW_EDGE,GLOW_SLIT} from './concept_demo.js';
// domain: sensor-face units one photosite tile spans (sensor_texture.js).
export const SENSOR_TEXTURE_SPAN = .55;

// The digital camera model's sensor (Kent, October 8, 2026). Every lesson and
// the Lab that shows a digital body draws the same three things, with no
// per-lesson colour code: the sensor is blue, light arriving on it is a white
// overlay (`sensorGlow` over the open gap), and where light has landed it
// leaves yellow behind whose brightness follows the exposure, dim yellow for
// a short exposure and almost white for a long one. Each lesson only drives
// what it already drives: the shutter's curtains and duration (`sensorSweep`,
// `sensorExposure`, `sensorGlow`), the ISO setting (`sensorGain`), the light.
// `sensorGain` (0..1) amplifies the recording; its grain is a fixed per-cell
// pattern that never moves, only brightens. The film body draws its strip
// with FilmStockMaterial and keeps its own look.
// One material draws the pixels; exposure never allocates per-pixel meshes.

// Lesson sensor cells. Each 16x16 block lights its cells in its own
// pseudo-random order, so every stop lights exactly its share of every block
// while the pattern never repeats from block to block.
export const LESSON_SENSOR_CELLS = Object.freeze([48,32]);
const RANK_SEED = 0x51ed, RANK_ROUNDS = 4;
const hash = x => {
  x >>>= 0; x ^= x>>>16; x = Math.imul(x,0x7feb352d)>>>0;
  x ^= x>>>15; x = Math.imul(x,0x846ca68b)>>>0; x ^= x>>>16; return x>>>0;
};
// JS mirror of the shader's lessonRank(): cell (x, y), y counted from the
// bottom row, to a rank in (0, 1). A cell is lit once exposure passes it.
export function lessonCellRank(px, py) {
  let x = (px&15)|((py&15)<<4), key = hash((px>>4)+((py>>4)<<8)+RANK_SEED);
  for (let r = 0; r < RANK_ROUNDS; r++) {
    key = hash(key+r);
    x = ((x^(key&255))*(((key>>>8)&127)*2+1))&255; x ^= x>>>4;
  }
  return (x+.5)/256;
}
// ISO's schematic 48x32 capture: shot/read variance is fixed before gain.
export function lessonIsoRecording(px, py) {
  const key=Math.min(47,Math.max(0,px))+48*Math.min(31,Math.max(0,py))+0x1a50;
  const u=i=>(hash(key+i*0x9e37)+.5)/4294967296;
  return .008+Math.sqrt(.008/2048)*(u(0)+u(1)-1)*Math.sqrt(6)+
    .0005*(u(2)+u(3)-1)*Math.sqrt(6);
}
// Display illustration, not physics. The recorded signal doubles per stop, but
// six cells at 1/4000 would sit at linear 0.004 (near black) beside the dark
// sensor. One fixed mapping (same for every shot, no auto-exposure) lifts every
// lit cell to a floor and then follows a log-like response, so each stop still
// reads one step brighter and 1/15 (signal 1) still reaches full brightness.
export const LESSON_DISPLAY_FLOOR = .12, LESSON_DISPLAY_LOW = 1/512;
export function lessonDisplayLevel(signal) {
  const s = Math.min(Math.max(signal,0),1);
  if (s <= 0) return 0;
  const t = Math.min(Math.max(Math.log2(s/LESSON_DISPLAY_LOW)/Math.log2(1/LESSON_DISPLAY_LOW),0),1);
  return LESSON_DISPLAY_FLOOR + (1-LESSON_DISPLAY_FLOOR)*t;
}
// The model's sensor colours. The sensor is dark blue: Flutter's
// shutterSensorBlue (InkUI light a_infoFocus toward the dark ground, the 2D
// Shutter term's opening), sent as the `sensor` theme token in both themes.
// Light arriving is a white overlay. Exposure is the warm token (`warm`, InkUI
// a_alert), dim at first and almost white at full exposure.
export const SENSOR_BLUE = '#2a506f';
export const SENSOR_LIGHT = Object.freeze([1,1,1]);
export const EXPOSURE_DIM = .4, EXPOSURE_RAMP = .6;
export const EXPOSURE_WHITE_FROM = .5, EXPOSURE_WHITE_MAX = .65;
// Signal at which a cell is fully yellow rather than blue. A shot shows from
// its very first light; the ISO lesson draws its grain in light blue (isoColor).
export const SENSOR_COVER = .004;
// ISO lesson (Kent, October 8, 22:35): ISO changes the sensor's sensitivity,
// not the light, so its grain brightens in blue, never yellow: from the dark
// sensor blue toward a light blue, each cell its own shade.
export const ISO_LIGHT_BLUE = '#7fc1ff';
const hexLinear = hex => { const n=parseInt(hex.slice(1),16);
  return [n>>16,(n>>8)&255,n&255].map(v => { v/=255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4; }); };
export const ISO_LIGHT_BLUE_LINEAR = Object.freeze(hexLinear(ISO_LIGHT_BLUE));
// The grain's fixed per-cell spread at full gain (Lab): it never moves.
export const GRAIN_SPREAD = 1.2;
const smoothstep = (a,b,x) => { const t = Math.min(Math.max((x-a)/(b-a),0),1); return t*t*(3-2*t); };
// JS mirror of the shader's exposedColor(): displayed level (0..1) to the
// recorded colour (linear rgb arrays in and out).
export function exposedColor(level, warm) {
  const ramp = EXPOSURE_DIM+(1-EXPOSURE_DIM)*smoothstep(0,EXPOSURE_RAMP,level);
  const white = EXPOSURE_WHITE_MAX*smoothstep(EXPOSURE_WHITE_FROM,1,level);
  return warm.map(c => c*ramp*(1-white)+white);
}
// JS mirror of the shader's isoColor(): recorded signal (0..1) to the blue
// grain colour, from the sensor blue (linear rgb in and out) toward light blue.
export function isoColor(level, sensorBlue) {
  const t = Math.min(Math.max(level,0),1);
  return sensorBlue.map((c,i) => c+(ISO_LIGHT_BLUE_LINEAR[i]-c)*t);
}
// JS mirror of the shader's recorded colour: blue sensor where no light has
// landed, the exposure colour where it has. `lift` applies lessonDisplay().
export function sensorRecordedColor(signal, warm, sensor, {lift = false, cover = SENSOR_COVER} = {}) {
  const s = Math.min(Math.max(signal,0),1), amount = smoothstep(0,cover,s);
  const exposed = exposedColor(lift ? lessonDisplayLevel(s) : s, warm);
  return sensor.map((c,i) => c*(1-amount)+exposed[i]*amount);
}
// The white light overlay drawn over the recording while light arrives.
export const sensorLitColor = (recorded, glow) => recorded.map((c,i) => c+(SENSOR_LIGHT[i]-c)*glow);
// Shutter lesson (Kent, October 11, 2026, 15:08): light on the sensor is not a
// white patch that replaces the blue; white is added over the photosite
// texture, so the grain and gutters still show through a fully exposed region
// as a paler version of the same pattern. Only the beam in the air stays warm.
export const EXPOSURE_ADD_WHITE = Object.freeze([1,1,1]);
// domain: linear white added to the texture at full exposure (and in the
// sweeping slit band). Looked at in the browser: at 1 s the sensor reads
// clearly light, with the blue grain still visible under it.
export const EXPOSURE_WHITE_STRENGTH = .3;
// JS mirror of the shader's additive exposure: texel (linear rgb) plus
// `exposure` (0..1) of white, clamped per channel.
export const additiveExposure = (texel, exposure) => {
  const e = Math.min(Math.max(exposure,0),1)*EXPOSURE_WHITE_STRENGTH;
  return texel.map((c,i) => Math.min(1,c+e*EXPOSURE_ADD_WHITE[i]));
};
// JS mirror of the shader's exposure amount for a recorded signal: how much of
// the white is added (0 unexposed, 1 at a full 1 s exposure).
export function whiteExposure(signal, {cover = SENSOR_COVER} = {}) {
  const s = Math.min(Math.max(signal,0),1);
  return {color:EXPOSURE_ADD_WHITE, coverage:smoothstep(0,cover,s)*lessonDisplayLevel(s)};
}// JS mirror of the shader's textured sensor: texel (linear rgb) around the
// tile's linear mean, scaled by brightness and contrast (sensor_texture.js).
export const texturedSensor = (sensor, texel, mean, {brightness = 1, contrast = 1} = {}) =>
  sensor.map((c,i) => Math.max(0,c*(brightness+contrast*(texel[i]/Math.max(mean[i],1e-4)-1))));
const glslFloat = value => value.toFixed(6);
const LESSON_GLSL = `
  highp uint lessonHash(highp uint x){
    x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return x;
  }
  float lessonRank(vec2 pixel){
    highp uvec2 p=uvec2(clamp(pixel,vec2(0.),vec2(${LESSON_SENSOR_CELLS[0]-1}.,${LESSON_SENSOR_CELLS[1]-1}.)));
    highp uint x=(p.x&15u)|((p.y&15u)<<4u);
    highp uint key=lessonHash((p.x>>4u)+((p.y>>4u)<<8u)+${RANK_SEED}u);
    for(highp uint r=0u;r<${RANK_ROUNDS}u;r++){
      key=lessonHash(key+r);
      x=((x^(key&255u))*(((key>>8u)&127u)*2u+1u))&255u;x^=x>>4u;
    }
    return (float(x)+.5)/256.;
  }
  float isoUniform(highp uint key,highp uint stream){
    return (float(lessonHash(key+stream*0x9e37u))+.5)/4294967296.;
  }
  float isoRecording(vec2 pixel){
    highp uvec2 p=uvec2(clamp(pixel,vec2(0.),vec2(47.,31.)));
    highp uint key=p.x+48u*p.y+0x1a50u;
    return .008+sqrt(.008/2048.)*(isoUniform(key,0u)+isoUniform(key,1u)-1.)*sqrt(6.)+
      .0005*(isoUniform(key,2u)+isoUniform(key,3u)-1.)*sqrt(6.);
  }
  // Mirror of lessonDisplayLevel() in JS: fixed display lift for lit cells.
  float lessonDisplay(float signal){
    float s=clamp(signal,0.,1.);
    float t=clamp(log2(max(s,1e-6)/${(LESSON_DISPLAY_LOW).toFixed(8)})/log2(1./${(LESSON_DISPLAY_LOW).toFixed(8)}),0.,1.);
    return ${glslFloat(LESSON_DISPLAY_FLOOR)}+(1.-${glslFloat(LESSON_DISPLAY_FLOOR)})*t;
  }
  // Mirror of isoColor() in JS: sensor blue toward light blue.
  vec3 isoColor(float level,vec3 sensor){
    return mix(sensor,vec3(${ISO_LIGHT_BLUE_LINEAR.map(glslFloat).join(',')}),clamp(level,0.,1.));
  }
  // Mirror of exposedColor() in JS: dim yellow to almost white.
  vec3 exposedColor(float level,vec3 warm){
    float ramp=${glslFloat(EXPOSURE_DIM)}+(1.-${glslFloat(EXPOSURE_DIM)})*smoothstep(0.,${glslFloat(EXPOSURE_RAMP)},level);
    float white=${glslFloat(EXPOSURE_WHITE_MAX)}*smoothstep(${glslFloat(EXPOSURE_WHITE_FROM)},1.,level);
    return mix(warm*ramp,vec3(1.),white);
  }
`;

export class SensorExposureMaterial extends CameraPrintMaterial {
  constructor(color='#b2b2b2',accent=new THREE.Color('#5b8fb9')){
    super(color,accent);this.uniforms.sensorExposure={value:0};this.uniforms.sensorGain={value:0};
    // 1 in the ISO lesson: the sensor holds one fixed dim recording (with its
    // fixed grain) that sensorGain amplifies.
    this.uniforms.lessonIso={value:0};
    // 1 in the shutter lesson only: applies the lessonDisplay() lift. The ISO
    // lesson (0) keeps its gain-driven brightening exactly as before.
    this.uniforms.lessonLift={value:0};
    // Lesson shots: (first curtain edge, second curtain edge, light per unit
    // of travel). z = 0 develops the whole sensor evenly from sensorExposure.
    this.uniforms.sensorSweep={value:new THREE.Vector3()};
    // Strength of the light-arriving glow in the open gap (0 = none).
    this.uniforms.sensorGlow={value:0};
    // Exposure yellow (the host's InkUI alert token) and the sensor blue.
    this.uniforms.exposureWarm={value:new THREE.Color('#c9a227')};
    this.uniforms.sensorBlue={value:new THREE.Color(SENSOR_BLUE)};
    // The photosite texture (sensor_texture.js): off until the scene sets it,
    // then brightness and contrast around its linear mean (forIso).
    this.uniforms.sensorTexture={value:null};
    this.uniforms.sensorTextureOn={value:0};
    this.uniforms.sensorTextureMean={value:new THREE.Vector3(1,1,1)};
    this.uniforms.sensorTextureBrightness={value:1};
    this.uniforms.sensorTextureContrast={value:1};
    // 1 in the shutter lesson: exposure and arriving light are near white.
    this.uniforms.exposureWhite={value:0};
  }
  // The shared photosite tile and its linear mean (sensor_texture.js).
  setSensorTexture(texture, mean){
    this.uniforms.sensorTexture.value=texture;this.uniforms.sensorTextureMean.value.set(...mean);
    this.uniforms.sensorTextureOn.value=texture?1:0;
  }
  copy(source){
    super.copy(source);this.uniforms.sensorExposure={value:source.uniforms.sensorExposure.value};
    this.uniforms.sensorGain={value:source.uniforms.sensorGain.value};
    this.uniforms.lessonIso={value:source.uniforms.lessonIso.value};
    this.uniforms.lessonLift={value:source.uniforms.lessonLift.value};
    this.uniforms.sensorGlow={value:source.uniforms.sensorGlow.value};
    this.uniforms.exposureWarm={value:source.uniforms.exposureWarm.value.clone()};
    this.uniforms.sensorBlue={value:source.uniforms.sensorBlue.value.clone()};
    this.uniforms.sensorSweep={value:source.uniforms.sensorSweep.value.clone()};
    this.uniforms.sensorTexture={value:source.uniforms.sensorTexture.value};
    this.uniforms.sensorTextureOn={value:source.uniforms.sensorTextureOn.value};
    this.uniforms.sensorTextureMean={value:source.uniforms.sensorTextureMean.value.clone()};
    this.uniforms.sensorTextureBrightness={value:source.uniforms.sensorTextureBrightness.value};
    this.uniforms.sensorTextureContrast={value:source.uniforms.sensorTextureContrast.value};
    this.uniforms.exposureWhite={value:source.uniforms.exposureWhite.value};return this;
  }
  onBeforeCompile(shader){
    super.onBeforeCompile(shader);shader.uniforms.sensorExposure=this.uniforms.sensorExposure;
    shader.uniforms.sensorGain=this.uniforms.sensorGain;
    shader.uniforms.lessonIso=this.uniforms.lessonIso;
    shader.uniforms.lessonLift=this.uniforms.lessonLift;
    shader.uniforms.sensorSweep=this.uniforms.sensorSweep;
    shader.uniforms.sensorGlow=this.uniforms.sensorGlow;
    shader.uniforms.exposureWarm=this.uniforms.exposureWarm;
    shader.uniforms.sensorBlue=this.uniforms.sensorBlue;
    for(const key of ['sensorTexture','sensorTextureOn','sensorTextureMean','sensorTextureBrightness',
      'sensorTextureContrast','exposureWhite'])shader.uniforms[key]=this.uniforms[key];
    shader.vertexShader='varying vec2 sensorPoint;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nsensorPoint=position.xy;');
    shader.fragmentShader='varying vec2 sensorPoint; uniform float sensorExposure; uniform float sensorGain; uniform float lessonIso; uniform float lessonLift; uniform vec3 sensorSweep; uniform float sensorGlow; uniform vec3 exposureWarm; uniform vec3 sensorBlue;\n'+
      'uniform sampler2D sensorTexture; uniform float sensorTextureOn; uniform vec3 sensorTextureMean;\n'+
      'uniform float sensorTextureBrightness; uniform float sensorTextureContrast; uniform float exposureWhite;\n'+
      LESSON_GLSL+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('diffuseColor.rgb = mix(printGray, printColor, printHighlight);',`
      vec2 pixel=floor((sensorPoint+vec2(.825,.55))*vec2(48.0/1.65,32.0/1.1));
      // The sensor's own surface: the photosite tile over the sensor blue,
      // its brightness and contrast set by the lesson (sensor_texture.js).
      vec3 sensorBase=sensorBlue;
      if(sensorTextureOn>.5){
        vec3 texel=texture2D(sensorTexture,sensorPoint/${glslFloat(SENSOR_TEXTURE_SPAN)}).rgb;
        sensorBase=max(sensorBlue*(sensorTextureBrightness+sensorTextureContrast*(texel/max(sensorTextureMean,vec3(1e-4))-1.)),0.);
      }
      // Each row builds toward its final exposure only while both curtains
      // leave it uncovered (concept_demo.js sensorRowExposure); rows run top
      // (0) to bottom (1), continuous in y so the sweep has no cell steps.
      // There is no time input: recorded light holds still.
      float glowRow=(.55-sensorPoint.y)/1.1;
      float exposure=sensorSweep.z>0.?
        clamp((max(sensorSweep.x-glowRow,0.)-max(sensorSweep.y-glowRow,0.))*sensorSweep.z,0.,1.):sensorExposure;
      // Gain amplifies the recording; its grain is fixed per cell and only
      // brightens with gain, it never moves.
      highp uvec2 grainCell=uvec2(clamp(pixel,vec2(0.),vec2(47.,31.)));
      float grain=isoUniform(grainCell.x+48u*grainCell.y+0x6a1du,4u)-.5;
      float signal=clamp(exposure*(1.+sensorGain*1.8)*(1.+sensorGain*grain*${glslFloat(GRAIN_SPREAD)}),0.,1.);
      float cover=${glslFloat(SENSOR_COVER)};
      if(lessonIso>.5){signal=clamp(isoRecording(pixel)*exp2(sensorGain*6.),0.,1.);}
      // The blue sensor turns yellow where light has landed (Kent, October
      // 8), dim for a short exposure and almost white for a long one (no
      // dots), softened in at the very first light.
      float level=lessonLift>.5?lessonDisplay(signal):signal;
      vec3 recorded=mix(sensorBase,exposedColor(level,exposureWarm),smoothstep(0.,cover,signal));
      // Shutter lesson: white is added over the texture by the displayed
      // level (additiveExposure in JS), so the pattern survives.
      vec3 lightColor=vec3(${SENSOR_LIGHT.map(glslFloat).join(',')});
      if(exposureWhite>.5){
        recorded=min(sensorBase+vec3(${glslFloat(EXPOSURE_WHITE_STRENGTH)})*smoothstep(0.,cover,signal)*level,vec3(1.));
      }
      // ISO lesson: sensitivity, not light, so the grain is blue only.
      if(lessonIso>.5)recorded=isoColor(signal,sensorBase);
      // Light arriving through the open gap (concept_demo.js sensorRowGlow),
      // drawn over the recording without adding to it. Continuous in y so
      // the band has soft edges rather than cell steps. Light itself is
      // white, distinct from the yellow it leaves behind.
      float band=smoothstep(0.,${glslFloat(GLOW_EDGE)},sensorSweep.x-glowRow)*
        smoothstep(0.,${glslFloat(GLOW_EDGE)},glowRow-sensorSweep.y);
      // The shutter lesson's slit is the same additive white at full
      // strength; a wide-open window keeps its lighter wash.
      float glow=(exposureWhite>.5?(sensorGlow>=${glslFloat(GLOW_SLIT-.001)}?1.:sensorGlow):sensorGlow)*band;
      // The sensor is always drawn in its own blue: a part highlight never
      // tints it (lessons highlight the shutter with the sensor inside it).
      diffuseColor.rgb=exposureWhite>.5?min(recorded+vec3(${glslFloat(EXPOSURE_WHITE_STRENGTH)})*glow,vec3(1.)):mix(recorded,lightColor,glow);
    `);
  }
  customProgramCacheKey(){return 'focal-sensor-exposure-v15';}
}
