import {autoExposure} from './auto_exposure.js';

// Serializable camera/exposure model shared by the teaching sheet and bridge.
// Exposure is expressed in stops relative to ISO 100, f/4, 1/125 s.

const STOP = Math.SQRT2;
const DEFAULT = Object.freeze({iso:100, aperture:4, shutter:1/125});
// The settings the Studio lab opens on (Kent, October 13, 2026): 1/500, f/4, ISO 400.
// The meter's zero stays DEFAULT; only the starting state moves.
export const START = Object.freeze({iso:400, aperture:4, shutter:1/500});
const isoValues = Object.freeze([100,200,400,800,1600,3200,6400,12800]);
// The selected lens catalogue currently bottoms out at f/1.4. Keep the
// control on conventional whole-stop detents through f/22.
const apertureValues = Object.freeze([STOP,2,2*STOP,4,4*STOP,8,8*STOP,16,16*STOP]);
const shutterLabels = Object.freeze(['1/4000','1/2000','1/1000','1/500','1/250','1/125','1/60','1/30','1/15','1/8','1/4','1/2','1 s']);
const shutterValues = Object.freeze(shutterLabels.map((_,index)=>(1/125)*2**(index-5)));
const apertureLabels = Object.freeze(['f/1.4','f/2','f/2.8','f/4','f/5.6','f/8','f/11','f/16','f/22']);
const apertureOptions = Object.freeze(apertureValues.map((value,index)=>({value,label:apertureLabels[index]})));
const isoOptions = Object.freeze(isoValues.map(value=>({value,label:`ISO ${value}`})));
const shutterOptions = Object.freeze(shutterValues.map((value,index)=>({value,label:shutterLabels[index]})));
const meteringOptions = Object.freeze([
  {value:'matrix',label:'Matrix'},
  {value:'center-weighted',label:'Center weighted'},
  {value:'spot',label:'Spot'},
  {value:'highlight-weighted',label:'Highlight weighted'},
]);
const lenses = Object.freeze([
  {id:'prime-24',label:'24mm f/1.4',minFocalLength:24,maxFocalLength:24,maxAperture:STOP},
  {id:'prime-35',label:'35mm f/1.4',minFocalLength:35,maxFocalLength:35,maxAperture:STOP},
  {id:'prime-50',label:'50mm f/1.4',minFocalLength:50,maxFocalLength:50,maxAperture:STOP},
  {id:'prime-85',label:'85mm f/1.4',minFocalLength:85,maxFocalLength:85,maxAperture:STOP},
  {id:'prime-135',label:'135mm f/2',minFocalLength:135,maxFocalLength:135,maxAperture:2},
  {id:'zoom-16-35',label:'16–35mm f/2.8',minFocalLength:16,maxFocalLength:35,maxAperture:2*STOP},
  {id:'zoom-24-70',label:'24–70mm f/2.8',minFocalLength:24,maxFocalLength:70,maxAperture:2*STOP},
  {id:'zoom-70-200',label:'70–200mm f/2.8',minFocalLength:70,maxFocalLength:200,maxAperture:2*STOP},
]);

// The Studio lessons' one lens (lesson=1): 16-200 mm on a single zoom, so lesson 8 sweeps
// 24 to 200 without changing lens. Only a lesson page lists it; the lab's catalog above is unchanged.
export const LESSON_LENS = Object.freeze({id:'lesson-zoom',label:'16–200mm f/2.8',minFocalLength:16,maxFocalLength:200,maxAperture:2*STOP});

export const AUTO_LISTS = Object.freeze({aperture:apertureValues,shutter:shutterValues,iso:isoValues});
const copyOption = option => ({...option});
const nearest = (value,values) => values.reduce((best,current)=>
  Math.abs(current-value)<Math.abs(best-value)?current:best,values[0]);
// The lesson lens resolves by id wherever a state names it, but only a lesson page's catalog lists or selects it.
const lensFor = (id) => lenses.find(lens=>lens.id===id) || (id===LESSON_LENS.id?LESSON_LENS:null) || lenses[2];
// Keep the 70-200 figures in sync with lightingMinFocus in lighting_lens_sheet.dart.
const focusMinimum = state => state.lensId==='zoom-70-200'?.4+Math.min(1,Math.max(0,(state.focalLength-70)/130))*.42:Math.max(.1,state.focalLength/800);
const stops = (state) => ({
  iso:Math.log2(state.iso/DEFAULT.iso),
  aperture:2*Math.log2(DEFAULT.aperture/state.aperture),
  shutter:Math.log2(state.shutter/DEFAULT.shutter),
});
const meterContributions = state => ({
  iso:Math.round(Math.log2(state.iso/isoValues[0])),
  aperture:Math.round(2*Math.log2(apertureValues.at(-1)/state.aperture)),
  shutter:Math.round(Math.log2(state.shutter/shutterValues[0])),
});
const meterReferenceStops=Object.values(meterContributions(DEFAULT)).reduce((sum,value)=>sum+value,0);

// Auto (Kent, session 5, cards 828-835): each ruler has an A detent past its far
// end, the way an aperture ring has an A past f/22. A setting on A follows the
// meter to keep the needle on 0. Any of the three may be on A (Kent, October 13,
// 2026: "I should be able to set them all to auto"). Which settings are on A picks
// the program of a real interchangeable-lens camera (auto_exposure.js): the
// shutter holds 1/focal length, the aperture opens to the lens maximum, then ISO
// rises to 6400, and only then does the shutter drop into camera shake. The
// scene's meter reading fixes the exposure, so a scene always resolves to the
// same program.
export const AUTO_ORDER=Object.freeze(['aperture','shutter','iso']);
const apertureIndex=value=>Math.round(3*Math.log2(value*value)); // thirds of a stop from f/1
const shutterIndex=value=>Math.round(3*Math.log2(1/value)); // thirds of a stop from 1 s
const isoIndex=value=>Math.round(3*Math.log2(value/DEFAULT.iso)); // thirds of a stop from ISO 100
// The lab's reference (ISO 100 f/4 1/125, scene 0) is EV 11 at ISO 100: a + s = 12 + 21 thirds.
const REFERENCE_EV100=11; // domain: EV at ISO 100 of the meter's zero
const SHUTTER_FAST_INDEX=shutterIndex(shutterValues[0]); // 1/4000
const AUTO_PROGRAM={ // domain: auto_exposure.js mode by which of [aperture, shutter, iso] are on A
  'aperture,shutter,iso':'AUTO','shutter,iso':'A','aperture,iso':'S','aperture,shutter':'P',
  iso:'M',shutter:'SHUTTER',aperture:'APERTURE',
};

// The values the auto settings of [state] take to bring the needle to 0 for a
// scene reading of [sceneStops] (the meter's `scene`, in stops): the manual
// settings stay put, the auto ones land on the whole-stop detents the program
// of auto_exposure.js picks. Null with none on auto.
export function solveAuto(state,sceneStops){
  const autos=AUTO_ORDER.filter(key=>state.auto?.[key]);
  if(!autos.length)return null;
  const lens=lensFor(state.lensId);
  const program=AUTO_PROGRAM[autos.join(',')];
  const result=autoExposure({
    ev100:REFERENCE_EV100+sceneStops,focalMm:state.focalLength,mode:program,
    aFix:apertureIndex(state.aperture),sFix:shutterIndex(state.shutter),
    iso:state.auto.iso?null:isoIndex(state.iso),
    aLens:apertureIndex(lens.maxAperture),sMax:SHUTTER_FAST_INDEX,sSlowest:shutterIndex(shutterValues.at(-1)),snap:true,
  });
  const picks={
    aperture:()=>apertureValues[Math.round(result.a/3)-1],
    shutter:()=>shutterValues[Math.round((SHUTTER_FAST_INDEX-result.s)/3)],
    iso:()=>isoValues[Math.round(result.i/3)],
  };
  const next={};
  for(const key of autos)next[key]=picks[key]();
  return next;
}

export function thinLensCocMm(focalLengthMm,fNumber,focusMeters,depthMeters){
  const f=Number(focalLengthMm),n=Number(fNumber),focus=Number(focusMeters)*1000,depth=Number(depthMeters)*1000;
  if(![f,n,focus,depth].every(Number.isFinite)||f<=0||n<=0||focus<=f||depth<=f||depth<=0)return 0;
  return Math.abs(f*f*(depth-focus)/(n*depth*(focus-f)));
}

export function createLightingCamera({lesson=false}={}){
  const catalog=lesson?[...lenses,LESSON_LENS]:lenses;
  let state={iso:START.iso,aperture:START.aperture,shutter:START.shutter,lensId:'prime-50',focalLength:50,autofocus:true,focusDistance:5,meteringMode:'matrix',auto:{shutter:false,iso:false,aperture:false}};
  const snapshot=()=>{
    const lens=lensFor(state.lensId), contributions=stops(state);
    const exposureStops=contributions.iso+contributions.aperture+contributions.shutter;
    return {iso:state.iso,aperture:state.aperture,shutter:state.shutter,
      isoOptions:isoOptions.map(copyOption),apertureOptions:apertureOptions.filter(option=>option.value>=lens.maxAperture).map(copyOption),shutterOptions:shutterOptions.map(copyOption),
      lenses:catalog.map(lens=>({...lens})),lensId:state.lensId,focalLength:state.focalLength,isZoom:lens.minFocalLength!==lens.maxFocalLength,
      auto:{...state.auto},autofocus:state.autofocus,focusDistance:state.focusDistance,meteringMode:state.meteringMode,meteringOptions:meteringOptions.map(copyOption),meteringModes:meteringOptions.map(copyOption),
      exposureMultiplier:2**exposureStops,exposureStops,contributions:{...contributions},
      meterContributions:meterContributions(state),meterReferenceStops};
  };
  return {getState:snapshot,get state(){return snapshot();},
  // Re-solves the auto settings for the meter's [sceneStops]; true if any changed.
  applyAuto(sceneStops){
    const next=Number.isFinite(sceneStops)?solveAuto(state,sceneStops):null;
    if(!next)return false;
    let changed=false;
    for(const key of Object.keys(next))if(state[key]!==next[key]){state[key]=next[key];changed=true;}
    return changed;
  },
  // The values the auto settings are heading to for [sceneStops], or null.
  autoTarget(sceneStops){return Number.isFinite(sceneStops)?solveAuto(state,sceneStops):null;},
  // One tick of the hold-then-step: sets the auto settings to [values] without taking them off A.
  setAutoValues(values){
    let changed=false;
    for(const key of AUTO_ORDER)if(state.auto[key]&&typeof values?.[key]==='number'&&state[key]!==values[key]){state[key]=values[key];changed=true;}
    return changed;
  },set(action,value){
    let changed=true;
    // A value dragged to takes its setting off auto.
    if(action==='iso'&&typeof value==='number'&&Number.isFinite(value)){state.iso=nearest(value,isoValues);state.auto.iso=false;}
    else if(action==='aperture'&&typeof value==='number'&&Number.isFinite(value)){state.aperture=nearest(Math.max(value,lensFor(state.lensId).maxAperture),apertureValues);state.auto.aperture=false;}
    else if(action==='shutter'&&typeof value==='number'&&Number.isFinite(value)){state.shutter=nearest(value,shutterValues);state.auto.shutter=false;}
    else if(action==='auto'&&value&&AUTO_ORDER.includes(value.setting)&&typeof value.on==='boolean'){
      if(state.auto[value.setting]===value.on)changed=false;
      else state.auto[value.setting]=value.on;
    }
    else if(action==='lens'&&typeof value==='string'&&catalog.some(lens=>lens.id===value)){
      state.lensId=value;const lens=lensFor(value);state.focalLength=Math.min(lens.maxFocalLength,Math.max(lens.minFocalLength,state.focalLength));state.focusDistance=Math.max(state.focusDistance,focusMinimum(state));
      if(state.aperture<lens.maxAperture)state.aperture=nearest(lens.maxAperture,apertureValues);
    } else if(action==='focalLength'&&typeof value==='number'&&Number.isFinite(value)){const lens=lensFor(state.lensId);state.focalLength=Math.min(lens.maxFocalLength,Math.max(lens.minFocalLength,value));state.focusDistance=Math.max(state.focusDistance,focusMinimum(state));}
    else if(action==='autofocus'&&typeof value==='boolean')state.autofocus=value;
    else if(action==='focusDistance'&&typeof value==='number'&&Number.isFinite(value))state.focusDistance=Math.min(30,Math.max(focusMinimum(state),value));
    else if(action==='meteringMode'&&meteringOptions.some(option=>option.value===value))state.meteringMode=value;
    else changed=false;
    return changed;
  }};
}
