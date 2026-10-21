// The Studio's one print look: the halftone. Dot area carries the tone, and the
// tone is Smooth's (Kent, October 13, 2026: the print "needs to represent
// Smooth in an accurate way"). `shadeInk` receives Smooth's finished pixel, so
// over any small patch the average ink equals the ink amount of that pixel.
// The camera lab (camera_halftone.js) still asks for `shadeIndex`, so it stays.
export const shadeIndex=()=>1;

// The dot pitch is fixed at 3 CSS px on every screen (Kent, October 13, 2026:
// "3 for the dots. Final answer."). In device px it is rounded to a whole
// number so the lattice is periodic on the pixel grid, never under 2.
export const HALFTONE_REF_PITCH_CSS=3; // domain: Kent, Oct 13: the dot pitch on every screen
export const HALFTONE_MIN_PITCH_PX=2; // domain: below this the dot lattice aliases
export const halftonePitch=(pixelRatio=1)=>Math.max(HALFTONE_MIN_PITCH_PX,Math.round(HALFTONE_REF_PITCH_CSS*pixelRatio));
// The hand-off (Kent, October 14, 2026: dots both scale and carry a full range
// from black to white). Dot size carries the midtones. Where a dot would shrink
// below a floor (a dot one device px in radius) its size holds and its ink
// fades to paper; where the paper gap would shrink below that size it holds and
// the gap's paper fades to ink. Mirrors `halftoneInk` in GLSL line for line.
export const HALFTONE_KNEE=.25; // domain: dot size holds below 25% and above 75% coverage (Kent, October 14, 2026)
export const halftoneKnee=()=>HALFTONE_KNEE;
export function halftoneHandoff(a,pitchDevicePx){
  const t=Math.min(1,Math.max(0,a)),lo=HALFTONE_KNEE,hi=1-lo;
  if(t<lo)return {coverage:lo,inkStrength:t/lo,gapInk:0};
  if(t>hi)return {coverage:hi,inkStrength:1,gapInk:(t-hi)/(1-hi)};
  return {coverage:t,inkStrength:1,gapInk:0};
}
// The moving (cel) frame's flat ink (see lighting_quality.js): paper and a dark
// ink gray, no dots. The pixel's display-encoded (perceptual) lightness snaps to
// CEL_BANDS flat tones evenly spaced in that lightness, the lightest the paper
// itself and the darkest CEL_INK_LIGHTNESS (a dark gray, never pure black; mirrored
// to 1 - that on a dark paper). The step between two tones is a smoothstep one
// device pixel wide (fwidth of the band ramp), so contours are not stair-stepped
// and do not shimmer while orbiting. Mirrors `celInk` in GLSL.
export const CEL_BANDS=7; // domain: flat tones from paper to ink in the moving frame, picked by eye against the halftone
export const CEL_INK_LIGHTNESS=.18; // domain: encoded lightness of the darkest band on a light paper
export const CEL_EDGE_PX=1; // domain: device pixels a band edge's smoothstep spans
// Share (0 paper .. 1 darkest band) of the tone for a pixel of [lightness] on a
// [paper] lightness, [far] being the darkest band's; [edgeBands] is the band ramp's
// change over CEL_EDGE_PX (0: a hard edge).
export function celTone(lightness,paper,far,edgeBands=0){
  const steps=CEL_BANDS-1,t=Math.min(1,Math.max(0,(lightness-paper)/(far-paper)))*steps;
  if(!(edgeBands>0))return Math.round(t)/steps;
  const w=Math.min(.5,Math.max(.001,.5*edgeBands)),i=Math.floor(t),f=Math.min(1,Math.max(0,(t-i-(.5-w))/(2*w)));
  return (i+f*f*(3-2*f))/steps;
}
// GLSL for the cel frame; needs SHADE_GLSL spliced before it.
export const CEL_GLSL=`
  const float CEL_STEPS=${CEL_BANDS-1}.;
  const float CEL_INK_LIGHTNESS=${CEL_INK_LIGHTNESS};
  vec3 celInk(vec3 color){
    float paper=lumaOf(paperColor);
    float far=lumaOf(inkColor)>paper?1.-CEL_INK_LIGHTNESS:CEL_INK_LIGHTNESS;
    float t=clamp((lumaOf(color)-paper)/(far-paper),0.,1.)*CEL_STEPS;
    float w=clamp(.5*${CEL_EDGE_PX}.*fwidth(t),.001,.5);
    float i=floor(t);
    float k=(i+smoothstep(.5-w,.5+w,t-i))/CEL_STEPS;
    return mix(paperColor,vec3(far),k);
  }
`;
// The theme's ink (fg) and paper (bg) as the raw sRGB the canvas shows, plus
// the darker and lighter of the two.
const rgb=hex=>{const m=/^#?([0-9a-f]{6})$/i.exec(hex||'');if(!m)return null;const n=parseInt(m[1],16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255];};
const luma=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
export function shadeColors(fg,bg){
  const ink=rgb(fg)||[.2,.22,.21],paper=rgb(bg)||[.96,.96,.96];
  const [shadow,light]=luma(ink)<=luma(paper)?[ink,paper]:[paper,ink];
  return {ink,paper,shadow,light};
}

export const shadeUniforms=THREE=>({
  shadeMode:{value:1},
  dotPitch:{value:0}, // device px; 0 = the fixed 3 x noiseCell (the camera lab)
  inkColor:{value:new THREE.Vector3(.2,.22,.21)},paperColor:{value:new THREE.Vector3(.96,.96,.96)},
  shadowColor:{value:new THREE.Vector3(.2,.22,.21)},lightColor:{value:new THREE.Vector3(.96,.96,.96)},
  levels:{value:new THREE.Vector2(0,1)}, // display-space black and white points of the finished picture (see levelOut)
});
// Applies theme colors (hex strings) to the uniforms made by shadeUniforms.
export function applyShadeColors(uniforms,fg,bg){
  const c=shadeColors(fg,bg);
  uniforms.inkColor.value.set(...c.ink);uniforms.paperColor.value.set(...c.paper);
  uniforms.shadowColor.value.set(...c.shadow);uniforms.lightColor.value.set(...c.light);
}
// The finished picture's black and white points (Kent, October 16, 2026: black
// and white are the two papers). [black] and [white] are 0..1 display values.
export function applyLevels(uniforms,black,white){uniforms.levels.value.set(black,white);}
// GLSL spliced into the optics pass. Needs `noiseCell` (the device pixel
// ratio) in scope; `dotPitch` sets the dot size.
export const SHADE_GLSL=`
  uniform float shadeMode;
  uniform float dotPitch;
  uniform vec3 inkColor;
  uniform vec3 paperColor;
  uniform vec3 shadowColor;
  uniform vec3 lightColor;
  uniform vec2 levels;
  // The one levels step at the end of every output path: display-encoded 0..1 in, black..white point out.
  // Affine in linear light, where the eye integrates the halftone's dots: a dot's partial coverage keeps its share of ink.
  vec3 levelOut(vec3 c){
    c=clamp(c,0.,1.);
    vec3 lin=mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));
    vec2 L=mix(levels/12.92,pow((levels+.055)/1.055,vec2(2.4)),step(vec2(.04045),levels));
    vec3 o=L.x+lin*(L.y-L.x);
    return mix(o*12.92,1.055*pow(max(o,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),o));
  }
  float lumaOf(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
  // Coverage of a pixel by a disc of the given area (px^2) at distance d from
  // its center: a one pixel ramp, with the ramp's own extra area (pi/12)
  // taken off the radius, and a dot too small to resolve held at a radius of
  // .6 px with its strength scaled so the area is still exact.
  float discCover(float d,float area){
    float amp=1.,r;
    if(area<1.3933){amp=area/1.3933;r=.6;}
    else r=sqrt(max(area/3.14159265-.0833333,0.));
    return amp*clamp(r-d+.5,0.,1.);
  }
  vec3 shadeLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
  // Screen-space halftone: dot area carries tone on a 45 degree grid. Ink dots
  // grow from the cell center until they touch (a = pi/4), then paper dots open
  // at the cell corners, so the covered area is exactly the ink amount. The eye
  // integrates dots in linear light, so the area is chosen so the LINEAR average
  // of ink and paper equals Smooth's linear luminance (Lp - L)/(Lp - Li).
  // True black ink on a light paper, true white on a dark one, so the paper
  // dots keep shrinking all the way into the deepest shadow (no saturated band).
  vec3 halftoneInkColor(){return lumaOf(inkColor)>lumaOf(paperColor)?vec3(1.):vec3(0.);}
  // The ink amount (0 paper .. 1 ink) of a finished pixel.
  float halftoneAmount(vec3 color){
    float L=lumaOf(shadeLinear(color)),Lp=lumaOf(shadeLinear(paperColor)),Li=lumaOf(halftoneInkColor());
    return clamp((Lp-L)/(Lp-Li),0.,1.);
  }
  // The share of ink (0..1) at px for ink amount a, on a lattice of the given pitch.
  float halftoneFraction(float a,vec2 px,float pitch){
    vec2 p=vec2(px.x+px.y,px.x-px.y)*.70710678/pitch;
    // The hand-off (see halftoneHandoff): size holds at the knees, ink fades.
    float knee=.25;
    float strength=1.,gapInk=0.;
    if(a<knee){strength=a/knee;a=knee;}
    else if(a>1.-knee){gapInk=(a-(1.-knee))/knee;a=1.-knee;}
    float cover;
    if(a<=.7853982){
      cover=discCover(length(fract(p)-.5)*pitch,a*pitch*pitch);
    }else{
      cover=1.-discCover(length(fract(p+.5)-.5)*pitch,(1.-a)*pitch*pitch);
    }
    return mix(gapInk,strength,cover);
  }
  // The pixel for an ink share f: blended in linear light, so a half-covered edge pixel carries half the light.
  vec3 halftonePrint(float f){
    vec3 paperLin=shadeLinear(paperColor);
    vec3 lin=mix(paperLin,halftoneInkColor(),f);
    return mix(lin*12.92,1.055*pow(max(lin,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),lin));
  }
  vec3 halftoneInk(vec3 color,vec2 px){
    return halftonePrint(halftoneFraction(halftoneAmount(color),px,dotPitch>0.?dotPitch:3.*noiseCell));
  }
  // The halftone's ink is already black, so there is no separate outline fill.
  vec3 shadeInk(vec3 color,vec2 px){return halftoneInk(color,px);}
`;