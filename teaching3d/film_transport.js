import {clamp} from './capture.js';
const smooth=value=>{const p=clamp(value);return p*p*p*(p*(p*6-15)+10);};
export const MAX_FILM_EXPOSURES=40; // 36 frames plus preparation exposures.

// Integrate the uncovered gate area from the first curtain opening (.1) to
// the second curtain closing (.85). A real executing cycle supplies this time.
export function filmExposureStrength(time){
  const t=clamp(time);
  if(t<=.1)return 0;
  if(t<.3)return ((t-.1)**2/.4)/.55;
  if(t<.65)return (.1+t-.3)/.55;
  if(t<.85)return (.45+t-.65-(t-.65)**2/.4)/.55;
  return 1;
}

// One illustrative 36-exposure roll. All progress setters are deterministic;
// the scene supplies animation/reduced motion and owns the interaction lock.
export function createFilmTransport({framePitch,leaderLength,wrapLength=0,preparationTravel=0}){
  for(const [name,value] of Object.entries({framePitch,leaderLength,wrapLength,preparationTravel})){
    if(!Number.isFinite(value))throw new TypeError(`${name} must be finite`);
    if(value<0||(name==='framePitch'&&value===0))throw new RangeError(`${name} is out of range`);
  }
  let loaded=false,sealed=false,backOpen=0,load=0,travel=0,leader=0,wrap=0;
  let prepared=false,releaseDue=false,readyTravel=0;
  let exposures=[],exposureStrengths=[];
  let phase='empty',action=null,startTravel=0,startLeader=0,startWrap=0,startBack=0,progress=0;
  const finite=value=>{if(!Number.isFinite(value))throw new TypeError('Film progress must be finite');return clamp(value);};
  function state(){
    return {phase,loaded,sealed,backOpen,load,travel,leader,wrap,progress,prepared,releaseDue,exposures:exposures.map(range=>[...range]),exposureStrengths:[...exposureStrengths],
      frame:loaded&&prepared?Math.max(1,Math.min(36,1+Math.round((travel-readyTravel)/framePitch))):0,
      canOpen:!sealed,canLoad:!loaded&&!action,
      canAdvance:loaded&&sealed&&backOpen===0&&!action&&!releaseDue&&(!prepared||travel<readyTravel+35*framePitch-1e-6),
      canRelease:loaded&&sealed&&backOpen===0&&!action&&releaseDue,
      canRewind:loaded&&sealed&&backOpen===0&&!action,
      canCapture:loaded&&sealed&&backOpen===0&&!action&&prepared};
  }
  function setBackOpen(value){
    value=finite(value);
    if(action||(value>backOpen&&sealed))return false;
    backOpen=value;if(value===0&&loaded)sealed=true;return true;
  }
  function begin(next){
    const s=state();
    if(action||!(next==='load'?s.canLoad:next==='advance'?s.canAdvance:next==='rewind'?s.canRewind:next==='release'?s.canRelease:false))return false;
    action=next;startTravel=travel;startLeader=leader;startWrap=wrap;startBack=backOpen;progress=0;
    phase=next==='load'?'loading':next==='advance'?'advancing':next==='release'?'releasing':'rewinding';
    if(next==='load'){prepared=false;releaseDue=false;readyTravel=0;exposures=[];exposureStrengths=[];}
    return true;
  }
  function update(value){
    const p=finite(value);if(!action)return false;progress=p;
    if(action==='load'){
      backOpen=startBack+(1-startBack)*smooth(p/.20);load=clamp((p-.20)/.80);
      leader=leaderLength*smooth((load-.28)/.62);travel=0;
      wrap=0;
    }else if(action==='advance'){
      travel=startTravel+framePitch*p;
      wrap=wrapLength>0?clamp(travel/wrapLength):0;
    }else if(action==='rewind'){
      // Wind back the accumulated stock, then withdraw the leader from the
      // take-up, across the gate, and into the cartridge. Both are real travel.
      // Press the rewind release and unfold the crank before returning stock.
      const winding=smooth((p-.30)/.70);
      const returned=(startTravel+startLeader)*winding;
      travel=Math.max(0,startTravel-returned);
      const unwound=Math.max(0,returned-startTravel);
      wrap=wrapLength>0?Math.min(startWrap,travel/wrapLength):0;
      leader=Math.max(0,startLeader-unwound);
    }
    if(p===1){
      if(action==='rewind'){
        loaded=false;sealed=false;prepared=false;releaseDue=false;phase='rewound';travel=0;leader=0;wrap=0;
      }
      else {
        loaded=true;phase='loaded';
        if(action==='load'&&preparationTravel===0)prepared=true;
        if(action==='release')releaseDue=false;
        if(action==='advance'&&!prepared){
          if(travel>=preparationTravel){prepared=true;readyTravel=travel;}
          else releaseDue=true;
        }
      }
      action=null;
    }
    return true;
  }
  function reset(){
    loaded=false;sealed=false;backOpen=0;load=0;travel=0;leader=0;wrap=0;
    prepared=false;releaseDue=false;readyTravel=0;exposures=[];exposureStrengths=[];phase='empty';action=null;
    startTravel=0;startLeader=0;startWrap=0;startBack=0;progress=0;
  }
  function expose(distanceStart,distanceEnd,strength=1){
    if(!Number.isFinite(distanceStart)||!Number.isFinite(distanceEnd)||distanceStart>=distanceEnd)
      throw new TypeError('Exposure bounds must be an ordered finite interval');
    strength=finite(strength);if(strength===0)return false;
    if(!loaded||!sealed||backOpen!==0||(action&&action!=='release'))return false;
    // Positive stock coordinates are the already fogged daylight leader.
    const interval=[distanceStart-travel,Math.min(0,distanceEnd-travel)];
    if(interval[0]>=interval[1])return false;
    const records=exposures.map((range,index)=>({range,strength:exposureStrengths[index]}));
    records.push({range:interval,strength});
    const boundaries=[...new Set(records.flatMap(record=>record.range))].sort((a,b)=>a-b),merged=[],strengths=[];
    for(let index=0;index<boundaries.length-1;index++){
      const start=boundaries[index],end=boundaries[index+1],mid=(start+end)/2;
      const amount=Math.max(0,...records.filter(record=>mid>=record.range[0]&&mid<=record.range[1]).map(record=>record.strength));
      if(!amount)continue;
      const last=merged.at(-1);
      if(last&&Math.abs(last[1]-start)<1e-9&&strengths.at(-1)===amount)last[1]=end;
      else{merged.push([start,end]);strengths.push(amount);}
    }
    if(merged.length>MAX_FILM_EXPOSURES||(JSON.stringify(merged)===JSON.stringify(exposures)&&JSON.stringify(strengths)===JSON.stringify(exposureStrengths)))return false;
    exposures=merged;exposureStrengths=strengths;return true;
  }
  function checkpoint(){
    const saved=[loaded,sealed,backOpen,load,travel,leader,wrap,prepared,releaseDue,readyTravel,phase,action,
      startTravel,startLeader,startWrap,startBack,progress];
    const savedExposures=exposures.map(range=>[...range]);
    const savedStrengths=[...exposureStrengths];
    return ()=>{[loaded,sealed,backOpen,load,travel,leader,wrap,prepared,releaseDue,readyTravel,phase,action,
      startTravel,startLeader,startWrap,startBack,progress]=saved;exposures=savedExposures.map(range=>[...range]);exposureStrengths=[...savedStrengths];};
  }
  return {state,setBackOpen,begin,update,reset,checkpoint,expose};
}
