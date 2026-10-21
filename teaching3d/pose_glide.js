// Shared glide bookkeeping for the camera and studio renderers (the host's
// `poseTo` and `lightTo` commands). A glide eases a few numbers from wherever
// they are now to a target over `ms`; the renderer reads them back each frame
// and writes them into its own scene. The group publishes one state,
// `{active, done}`, so the host knows when a rejoin has landed:
//   active  some glide is still running
//   done    the last glide to end landed on its target (false once a viewport
//           command cancelled it, and false again as soon as another starts)
// Nothing here touches the scene or the clock: callers pass `now` in.

// The smootherstep the camera lab already uses for its own moves.
export const glideEase=value=>{
  const p=Math.min(1,Math.max(0,value));
  return p*p*p*(p*(p*6-15)+10);
};
// An angle in degrees folded into [-180, 180).
export const wrapDegrees=degrees=>(((degrees+180)%360)+360)%360-180;
// A path through timed keys [{at (ms), values:{key:number}}], at rising from 0: a
// monotone cubic Hermite per key (Fritsch-Butland tangents), so the speed runs on
// through every key, a key between two moves the same way never stops it, a key
// that is a hold or a turning point is met at rest, nothing overshoots a key, and
// it starts and ends still. Angular keys unwrap the short way round between keys.
// The landing tour sends its long camera moves this way (web_landing/timeline.js
// keeps the same curve for its glide-back poses).
export function preparePath(keys,angular=[]){
  const turn=new Set(angular),names=Object.keys(keys[0].values),at=keys.map(k=>k.at),curves={};
  for(const name of names){
    const y=[keys[0].values[name]];
    for(let i=1;i<keys.length;i++){
      const v=keys[i].values[name];
      y.push(turn.has(name)?y[i-1]+wrapDegrees(v-y[i-1]):v);
    }
    const n=y.length,h=[],d=[],m=new Array(n).fill(0);
    for(let i=0;i<n-1;i++){h.push(at[i+1]-at[i]);d.push(h[i]>0?(y[i+1]-y[i])/h[i]:0);}
    for(let i=1;i<n-1;i++){
      if(d[i-1]*d[i]>0)m[i]=3*(h[i-1]+h[i])/((2*h[i]+h[i-1])/d[i-1]+(h[i]+2*h[i-1])/d[i]);
    }
    curves[name]={y,m};
  }
  return {at,names,curves,ms:at[at.length-1],angular:turn};
}
export function samplePath(path,ms){
  const {at}=path,values={};
  let i=0;while(i<at.length-2&&ms>at[i+1])i++;
  const h=at[i+1]-at[i],s=h>0?Math.min(1,Math.max(0,(ms-at[i])/h)):1,s2=s*s,s3=s2*s;
  for(const name of path.names){
    const {y,m}=path.curves[name];
    const v=(2*s3-3*s2+1)*y[i]+(s3-2*s2+s)*h*m[i]+(-2*s3+3*s2)*y[i+1]+(s3-s2)*h*m[i+1];
    values[name]=path.angular.has(name)?wrapDegrees(v):v;
  }
  return values;
}

export function createGlideGroup(onChange){
  const channels=new Map();
  let state={active:false,done:false},last='none',dirty=false;
  const running=()=>{for(const channel of channels.values())if(channel.run)return true;return false;};
  function publish(){
    dirty=false;
    const active=running(),done=!active&&last==='done';
    if(active===state.active&&done===state.done)return;
    state={active,done};onChange?.({...state});
  }
  function channel(name){
    if(channels.has(name))return channels.get(name);
    const c={
      run:null,
      // from/to: {key:number}. angular: keys in degrees that turn the short way round.
      start(from,to,ms,now,angular=[]){
        c.run={from:{...from},to:{...to},ms:Math.max(0,ms),t0:now,angular:new Set(angular)};
        publish();
      },
      // A timed path (see preparePath): keys[0] is where it starts (at 0).
      path(keys,now,angular=[]){
        const path=preparePath(keys,angular);
        c.run={path,from:{...keys[0].values},to:{...keys[keys.length-1].values},ms:path.ms,t0:now,angular:path.angular};
        publish();
      },
      // The eased values at `now`, or null when idle. The final step returns the
      // target exactly; call group.flush() once the values are written.
      step(now){
        const r=c.run;if(!r)return null;
        const p=r.ms>0?Math.min(1,Math.max(0,(now-r.t0)/r.ms)):1,e=glideEase(p);
        let values={};
        if(r.path&&p<1)values=samplePath(r.path,now-r.t0);
        else for(const key of Object.keys(r.to)){
          if(p>=1)values[key]=r.to[key];
          else if(r.angular.has(key))values[key]=r.from[key]+wrapDegrees(r.to[key]-r.from[key])*e;
          else values[key]=r.from[key]+(r.to[key]-r.from[key])*e;
        }
        if(p>=1){c.run=null;last='done';dirty=true;}
        return {values,finished:p>=1};
      },
      // Stop where it is. The caller leaves the scene as it was drawn.
      cancel(){
        if(!c.run)return;
        c.run=null;last='cancel';publish();
      },
      // The clock stopped at `pausedAt` and restarted at `resumedAt`: hold the
      // progress. A glide begun while stopped starts from the restart.
      shift(pausedAt,resumedAt){
        if(c.run)c.run.t0=c.run.t0>=pausedAt?resumedAt:c.run.t0+(resumedAt-pausedAt);
      },
      get active(){return Boolean(c.run);},
    };
    channels.set(name,c);return c;
  }
  return {
    channel,
    state:()=>({...state}),
    get active(){return running();},
    // Publish an end-of-glide state change after the frame's values were written.
    flush(){if(dirty)publish();},
    cancelAll(){for(const c of channels.values())c.cancel();},
    shiftAll(pausedAt,resumedAt){for(const c of channels.values())c.shift(pausedAt,resumedAt);},
  };
}
