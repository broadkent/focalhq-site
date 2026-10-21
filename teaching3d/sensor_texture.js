// The sensor's surface texture (Kent, October 11, 2026): a fine photosite
// grid with subtle grain over the sensor blue, one shared look for every
// lesson that shows the digital sensor (shutter, ISO, balance, the Lab).
// Generated once, procedurally, into a power-of-two tile that repeats across
// the sensor face. SensorExposureMaterial draws it with two uniforms,
// brightness and contrast; `forIso` maps an ISO value to them the way ISO
// treats grain: higher ISO, brighter and more contrasty.
// Pure data here (testable in node); `createSensorTexture` wraps it in a
// three.js texture in the browser.
import {SENSOR_BLUE,SENSOR_TEXTURE_SPAN} from './sensor_exposure_material.js';

// domain: one tile, in texels (power of two so it mipmaps and repeats).
export const SENSOR_TEXTURE_SIZE = 256;
// domain: texels per photosite: 32 x 32 photosites per tile.
export const SENSOR_TEXTURE_CELL = 8;
// SENSOR_TEXTURE_SPAN: sensor-face units one tile spans (the face is
// 1.65 x 1.1), so the face carries 96 x 64 photosites: fine, but visible on a
// phone. The material owns it (its shader samples the tile).
export {SENSOR_TEXTURE_SPAN};
// domain: the photosite's look, as factors on the sensor blue: the dark
// gutter between sites, the microlens's lift at its centre, the per-site
// grain spread (subtle) and the per-texel noise.
export const SENSOR_GUTTER = .72, SENSOR_LENS_LIFT = .16, SENSOR_GRAIN = .08, SENSOR_NOISE = .03;
const SEED = 0x5e75;

const hash = x => {
  x >>>= 0; x ^= x>>>16; x = Math.imul(x,0x7feb352d)>>>0;
  x ^= x>>>15; x = Math.imul(x,0x846ca68b)>>>0; x ^= x>>>16; return x>>>0;
};
const unit = key => hash(key)/4294967296-.5;
const srgb = hex => { const n = parseInt(hex.slice(1),16); return [n>>16,(n>>8)&255,n&255]; };
export const toLinear = c => { const v = c/255; return v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4; };

// The relative brightness of texel (x, y) in the tile, mean ~1: the gutter
// on each site's last row and column, the microlens lift, and the grain.
function texelFactor(x, y, cell) {
  const cx = Math.floor(x/cell), cy = Math.floor(y/cell), ix = x%cell, iy = y%cell;
  if (ix===cell-1 || iy===cell-1) return SENSOR_GUTTER*(1+unit(SEED^(x*977+y*131))*SENSOR_NOISE);
  const c = (cell-2)/2, r = Math.hypot(ix-c, iy-c)/(c+.5);
  const lens = 1+SENSOR_LENS_LIFT*Math.max(0,1-r*r);
  const grain = 1+unit(SEED+cx*7919+cy*104729)*2*SENSOR_GRAIN;
  return lens*grain*(1+unit(SEED^(x*2654435761+y*40503))*SENSOR_NOISE);
}

// The tile as RGBA bytes (sRGB), `size` x `size`, deterministic. The mean
// colour is the sensor blue: every texel is the blue scaled by its factor,
// normalised so the factors average to one.
export function sensorTexturePixels({size = SENSOR_TEXTURE_SIZE, cell = SENSOR_TEXTURE_CELL, base = SENSOR_BLUE} = {}) {
  if (!Number.isInteger(size) || size<=0 || (size&(size-1))) throw new RangeError(`size ${size} is not a power of two`);
  const factors = new Float64Array(size*size);
  let sum = 0;
  for (let y = 0; y<size; y++) for (let x = 0; x<size; x++) sum += factors[y*size+x] = texelFactor(x,y,cell);
  const mean = sum/factors.length, rgb = srgb(base), data = new Uint8ClampedArray(size*size*4);
  for (let i = 0; i<factors.length; i++) {
    const f = factors[i]/mean;
    for (let c = 0; c<3; c++) data[i*4+c] = Math.round(rgb[c]*f);
    data[i*4+3] = 255;
  }
  return {width:size, height:size, data};
}

// The tile's mean colour in linear rgb, as the GPU averages it once sampled:
// the shader's brightness and contrast work around it.
export function sensorTextureMeanLinear({data}) {
  const mean = [0,0,0], n = data.length/4;
  for (let i = 0; i<n; i++) for (let c = 0; c<3; c++) mean[c] += toLinear(data[i*4+c]);
  return mean.map(v => v/n);
}

// domain: the ISO range the mapping spans (the lessons' ISO 100 ... 6400) and
// how much brighter and more contrasty the texture is at the top of it. At
// ISO 100 it is the plain texture (brightness 1, contrast 1): the shutter
// lesson and the Lab show that.
export const ISO_TEXTURE_BASE = 100, ISO_TEXTURE_STOPS = 6;
export const ISO_TEXTURE_BRIGHTNESS = .9, ISO_TEXTURE_CONTRAST = 2.5;
export function forIso(iso) {
  const stops = Number.isFinite(iso) && iso>0 ? Math.log2(iso/ISO_TEXTURE_BASE) : 0;
  const t = Math.min(Math.max(stops/ISO_TEXTURE_STOPS,0),1);
  return {brightness:1+ISO_TEXTURE_BRIGHTNESS*t, contrast:1+ISO_TEXTURE_CONTRAST*t};
}

// The tile as a repeating three.js texture (a canvas when there is a DOM, a
// DataTexture otherwise), built once per call; the caller keeps it.
export function createSensorTexture(THREE, options) {
  const pixels = sensorTexturePixels(options);
  let texture;
  if (typeof document!=='undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width; canvas.height = pixels.height;
    canvas.getContext('2d').putImageData(new ImageData(pixels.data,pixels.width,pixels.height),0,0);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = new THREE.DataTexture(pixels.data,pixels.width,pixels.height);
  }
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return {texture, mean:sensorTextureMeanLinear(pixels)};
}
