// A small uniform-only transition driven by the scene's existing RAF.
export function createHighlightFader(duration=150){
  const pending=new Map();
  // While paused the fader's clock is frozen at `pausedAt`: tick() and set() do not
  // advance or delete transitions, and fades begun meanwhile start at resume.
  let pausedAt=null;
  function tick(now){
    if(pausedAt!==null)return pending.size>0;
    for(const [uniform,a] of pending){
      const p=Math.max(0,Math.min(1,(now-a.start)/duration));
      uniform.value=a.from+(a.to-a.from)*p*p*(3-2*p);
      if(p===1)pending.delete(uniform);
    }
    return pending.size>0;
  }
  function set(targets,now,immediate=false){
    if(pausedAt!==null)now=pausedAt;
    tick(now);
    for(const [uniform,to] of targets){
      if(immediate){uniform.value=to;pending.delete(uniform);continue;}
      if(pending.get(uniform)?.to===to)continue;
      if(Math.abs(uniform.value-to)<1e-7){uniform.value=to;pending.delete(uniform);continue;}
      pending.set(uniform,{from:uniform.value,to,start:now});
    }
  }
  function finish(){for(const [uniform,a] of pending)uniform.value=a.to;pending.clear();}
  function pause(now){if(pausedAt===null)pausedAt=now;}
  // A fade begun before the pause loses only the paused time; one begun while
  // paused starts at `now`.
  function resume(now){
    if(pausedAt===null)return;
    const gap=now-pausedAt;
    for(const a of pending.values())a.start=a.start>=pausedAt?now:a.start+gap;
    pausedAt=null;
  }
  return {set,tick,finish,pause,resume,get active(){return pending.size>0;}};
}
