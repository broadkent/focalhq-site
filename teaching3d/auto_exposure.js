// The auto exposure program: what a real interchangeable-lens camera does when
// some of aperture, shutter and ISO are on auto. One pure function in integer
// thirds of a stop (spec: docs/plan/lab/auto-exposure-program.md). The Dart twin
// is lib/features/combine/domain/auto_exposure.dart; test/fixtures/
// auto_exposure_golden.json pins both.
//
// Indices: a = 3*log2(N^2) (0 = f/1, f/4 = 12), s = 3*log2(1/t) (0 = 1 s,
// 1/125 = 21), i = 3*log2(ISO/100). The exposure equation is a + s = L + i with
// L = round(3 * EV at ISO 100).
//
// Canonical order as light falls: hold the shutter at the floor (1/focal length
// x handheld factor), open the aperture to the lens maximum, raise ISO to its
// ceiling, and only then let the shutter drop below the floor (last resort,
// flagged 'shake').

export const HANDHELD_K=1; // domain: real bodies hold 1/focal length (Kent, October 13, 2026)
export const APERTURE_WIDEST=0; // domain: f/1 in thirds
export const APERTURE_NARROWEST=27; // domain: f/22
export const ISO_MIN=0; // domain: ISO 100
export const ISO_CEILING=18; // domain: ISO 6400, the Auto ISO ceiling
export const SHUTTER_FASTEST=39; // domain: 1/8000
export const SHUTTER_SLOWEST=-15; // domain: 30 s

const floorDiv=(a,b)=>Math.floor(a/b);
const round3=x=>3*Math.round(x/3);
const ceil3=x=>3*Math.ceil(x/3);
const floor3=x=>3*Math.floor(x/3);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));

// The slowest grid shutter (index) that is still safe handheld.
export const safeShutter=({focalMm,crop=1,k=HANDHELD_K,stabStops=0})=>
  Math.ceil(3*Math.log2(k*focalMm*crop)-3*stabStops-1e-9);

// inputs: ev100 (EV at ISO 100), focalMm, crop=1, k, stabStops=0,
//   mode: 'P' | 'AUTO' (a, s free) | 'A' (aFix) | 'S' (sFix) | 'M' (aFix, sFix,
//         ISO auto) | 'SHUTTER' (aFix, iso fixed) | 'APERTURE' (sFix, iso fixed)
//   aFix, sFix: fixed indices; iso: fixed ISO index or null for Auto ISO;
//   aLens (widest the lens opens), aMax, isoMin, isoMax, sMax, sSlowest;
//   bias: whole stops added to the floor; snap: land on whole-stop detents.
// returns {a, s, i, flags}; flags are 'shake', 'too dark', 'too bright'.
export function autoExposure(inputs){
  const {ev100,focalMm,crop=1,k=HANDHELD_K,stabStops=0,mode,aFix=null,sFix=null,iso=null,
    aLens=3,aMax=APERTURE_NARROWEST,isoMin=ISO_MIN,isoMax=ISO_CEILING,
    sMax=SHUTTER_FASTEST,sSlowest=SHUTTER_SLOWEST,bias=0,snap=false}=inputs;
  const L=Math.floor(3*ev100+.5);
  const sSafe=safeShutter({focalMm,crop,k,stabStops});
  const sMin=sSafe+3*bias;
  const isoAuto=iso===null||iso===undefined;
  const floorMode=mode==='A'||mode==='P'||mode==='AUTO';
  let a=aFix,s=sFix,i=isoAuto?isoMin:iso;
  let floorDriven=false;

  if(mode==='A'){
    a=aFix;s=L+i-a;
    if(isoAuto&&s<sMin){i=clamp(sMin-(L-a),isoMin,isoMax);s=L+i-a;}
  }else if(mode==='S'){
    s=sFix;a=L+i-s;
    if(a<aLens){a=aLens;if(isoAuto)i=clamp(a+s-L,isoMin,isoMax);}
    if(a>aMax)a=aMax;
  }else if(mode==='P'||mode==='AUTO'){
    const line=clamp(floorDiv(L+i-3+1,2),aLens,aMax);
    a=line;s=L+i-a;
    if(s<sMin){
      a=Math.min(line,Math.max(aLens,L+i-sMin));floorDriven=a<line;s=L+i-a;
      if(isoAuto&&s<sMin){i=clamp(a+sMin-L,isoMin,isoMax);s=L+i-a;}
    }
  }else if(mode==='M'){
    a=aFix;s=sFix;i=clamp(a+s-L,isoMin,isoMax);
  }else if(mode==='SHUTTER'){
    a=aFix;s=L+i-a;
  }else if(mode==='APERTURE'){
    s=sFix;a=clamp(L+i-s,aLens,aMax);
  }else throw new Error(`unknown mode ${mode}`);
  s=clamp(s,sSlowest,sMax);
  const got=a+s-i,flags=[];
  if(got>L)flags.push('too dark');
  else if(got<L)flags.push('too bright');

  if(snap){
    const aFree=mode==='P'||mode==='AUTO'||mode==='S'||mode==='APERTURE';
    const sFree=mode==='P'||mode==='AUTO'||mode==='A'||mode==='SHUTTER';
    const iFree=isoAuto&&mode!=='SHUTTER'&&mode!=='APERTURE';
    if(aFree)a=clamp(floorDriven?floor3(a):round3(a),aLens,aMax);
    if(sFree){
      const s0=L+i-a;
      let s1=round3(s0);
      if(floorMode&&s1<sMin)s1=iFree&&s0<sMin?ceil3(sMin):ceil3(s0);
      s=clamp(s1,ceil3(sSlowest),floor3(sMax));
    }
    if(iFree){
      const need=a+s-L;
      i=clamp(round3(need),isoMin,isoMax);
      // ISO ran out: the shutter takes what is left (last resort).
      if(sFree&&round3(need)!==i)s=clamp(round3(L+i-a),ceil3(sSlowest),floor3(sMax));
    }
  }
  if(s<sSafe)flags.push('shake');
  return {a,s,i,flags};
}
