// The lesson photo through a small linear-light tone pass, the web twin of the
// Exposure photo's `linear_tone` shader: decode to linear, scale by 2^stops,
// clamp, optionally invert (a negative), re-encode, then contrast and grain.
import * as THREE from 'three';

export const PHOTO_URL = new URL('../assets/assets/games/aperture/harbour/f8.jpg', import.meta.url).href;
let shared;
export function photoTexture() {
  if (!shared) {
    shared = new THREE.TextureLoader().load(PHOTO_URL);
    shared.colorSpace = THREE.NoColorSpace;
    shared.minFilter = THREE.LinearFilter;
    shared.generateMipmaps = false;
  }
  return shared;
}

const vertex = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }';
const fragment = `
uniform sampler2D map; uniform float invert, stops, contrast, grain, soft, opacity, rowLo, rowHi;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
vec3 sampleSoft(vec2 uv){
  vec3 c = texture2D(map, uv).rgb;
  if (soft <= 0.) return c;
  c += texture2D(map, uv + vec2(soft, 0.)).rgb + texture2D(map, uv - vec2(soft, 0.)).rgb
     + texture2D(map, uv + vec2(0., soft)).rgb + texture2D(map, uv - vec2(0., soft)).rgb;
  return c / 5.;
}
void main(){
  vec3 l = clamp(pow(sampleSoft(vUv), vec3(2.2)) * exp2(stops), 0., 1.);
  if (invert > .5) l = 1. - l;
  vec3 e = pow(l, vec3(1. / 2.2));
  e = (e - .5) * contrast + .5;
  e += (hash(vUv * 700.) - .5) * grain;
  float row = 1. - vUv.y;
  float lit = step(rowLo, row) * step(row, rowHi);
  gl_FragColor = vec4(clamp(e, 0., 1.) * lit, opacity);
}`;

export function photoMaterial(opts = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: photoTexture() }, invert: { value: 0 }, stops: { value: 0 }, contrast: { value: 1 },
      grain: { value: 0 }, soft: { value: 0 }, opacity: { value: 1 }, rowLo: { value: 0 }, rowHi: { value: 1 },
    },
    vertexShader: vertex, fragmentShader: fragment, transparent: true, side: THREE.DoubleSide,
  });
  for (const [k, v] of Object.entries(opts)) m.uniforms[k].value = v;
  return m;
}

// The pure tone curve: 0..1 sRGB in, 0..1 out.
export function tone(value, { invert = false, stops = 0, contrast = 1 } = {}) {
  let l = Math.min(1, Math.max(0, Math.pow(value, 2.2) * Math.pow(2, stops)));
  if (invert) l = 1 - l;
  return Math.min(1, Math.max(0, (Math.pow(l, 1 / 2.2) - .5) * contrast + .5));
}
