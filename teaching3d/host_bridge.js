// Small same-origin adapter: Flutter owns app controls; the iframe owns the
// interactive scene. No account data, network calls or general script commands.
// Available before the scene/bridge is constructed, including GLTF downloads.
export function publishLoadingProgress(kind,{loaded,total}){
  if(new URLSearchParams(location.search).get('embedded')!=='1'||parent===window)return;
  parent.postMessage(JSON.stringify({channel:'focal-teaching3d',version:1,
    type:'progress',kind,progress:{loaded,total}}),location.origin);
}

// The page itself failed to start: tell the host why (it retries early).
export function publishLoadError(kind,error){
  if(new URLSearchParams(location.search).get('embedded')!=='1'||parent===window)return;
  parent.postMessage(JSON.stringify({channel:'focal-teaching3d',version:1,
    type:'error',kind,message:String(error),stack:String(error?.stack??'').slice(0,500)}),location.origin);
}

// `coalesce` (opt-in, for scenes that render on requestAnimationFrame): publish()
// only marks the state dirty, and one message per frame carries the latest state.
// A scene that draws every frame calls flush() at the end of its draw so the
// message leaves with the frame it describes; otherwise a frame callback sends
// it. A hidden page gets no frames, so it sends immediately. deferAck(message)
// says whether the reply to a command may wait for the frame (default: yes).
export function createHostBridge({kind,getState,onCommand,onTheme,coalesce=false,deferAck=()=>true}){
  const embedded=new URLSearchParams(location.search).get('embedded')==='1';
  let disposed=false,pending=false,scheduled=0;
  function send(){
    pending=false;
    if(!embedded||disposed||parent===window)return;
    parent.postMessage(JSON.stringify({channel:'focal-teaching3d',version:1,
      type:'state',kind,state:getState()}),location.origin);
  }
  function flush(){if(pending)send();}
  function publish(){
    if(!coalesce||document.hidden){send();return;}
    pending=true;
    if(!scheduled&&!disposed)scheduled=requestAnimationFrame(()=>{scheduled=0;flush();});
  }
  function receive(event){
    if(!embedded||event.source!==parent||event.origin!==location.origin||typeof event.data!=='string')return;
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message?.channel!=='focal-teaching3d'||message.version!==1||message.type!=='command'||
      message.kind!==kind||typeof message.action!=='string')return;
    // Continuous scene gestures can defer their reply until the next rendered
    // frame. Other commands keep their immediate state acknowledgement.
    if(message.action==='theme'&&onTheme){
      if(!message.value||typeof message.value!=='object'||Array.isArray(message.value))return;
      onTheme(message.value);
    }else if(message.action!=='getState'&&onCommand({action:message.action,value:message.value})===false)return;
    // A coalescing bridge defers the reply to a continuous gesture only (deferAck):
    // every other command is acknowledged at once, like a non-coalescing bridge.
    if(coalesce&&!deferAck(message))send();else publish();
  }
  window.addEventListener('message',receive);
  return {publish,flush,dispose(){disposed=true;pending=false;if(scheduled)cancelAnimationFrame(scheduled);window.removeEventListener('message',receive);}};
}
