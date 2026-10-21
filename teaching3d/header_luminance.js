// What lies behind a lab's header. The Flutter header (back arrow and title) lies
// over the canvas; it picks light or dark ink from the rendered frame directly
// behind it. The host sends where the header stands (`headerBand`, CSS pixels
// from the canvas's top-left); after a frame is drawn this reads that band of the
// finished frame back and reports one mean luminance (0..1, display-encoded).
// Reading is rate limited: an idle scene draws no frames, so it costs nothing,
// and a moving one reads a few times a second, with a last read once it settles.
export const HEADER_INTERVAL_MS=500; // domain: at most two header readings a second while moving
export const HEADER_POLL_MS=16; // domain: how often a pending fence is checked
export const HEADER_EPSILON=.03; // domain: luminance change worth a new message
export const HEADER_STRIDE=3; // domain: every third pixel each way is enough for a mean

// Mean luminance (0..1) of an RGBA byte readback `width` x `height`, every
// `stride`th pixel each way; null for an empty readback.
export function regionLuminance(pixels,width,height,stride=HEADER_STRIDE){
  let sum=0,count=0;
  for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride){
    const i=(y*width+x)*4;
    sum+=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];count++;
  }
  return count?Math.round(sum/count/255*100)/100:null;
}

// A band is {x,y,w,h} in CSS pixels from the canvas's top-left.
export function cleanHeaderBand(value){
  if(!value||typeof value!=='object')return null;
  const keys=['x','y','w','h'];
  if(!keys.every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])))return null;
  if(value.w<=0||value.h<=0)return null;
  return Object.fromEntries(keys.map(k=>[k,Math.round(value[k])]));
}

export function sameHeaderBand(a,b){
  return !!a&&!!b&&['x','y','w','h'].every(k=>a[k]===b[k]);
}

// `onDue` asks the scene for another frame (a reading was skipped by the rate
// limit and nothing else will draw); `onValue` fires when a reading lands after
// the frame that asked for it (publish only, do not redraw); `now` is injectable.
export function createHeaderSampler(renderer,{onDue=()=>{},onValue=()=>{},now=()=>performance.now()}={}){
  let band=null,value=null,lastRead=-Infinity,timer=0,pollTimer=0,fresh=true,pending=null,settled=true;
  const gl=()=>renderer.getContext();
  const asyncOk=()=>{const c=gl();return typeof c.fenceSync==='function'&&typeof c.createBuffer==='function'&&typeof c.getBufferSubData==='function';};
  function rect(){
    const context=gl(),ratio=renderer.getPixelRatio();
    const bufferW=context.drawingBufferWidth,bufferH=context.drawingBufferHeight;
    const x=Math.max(0,Math.min(bufferW-1,Math.round(band.x*ratio)));
    const w=Math.max(1,Math.min(bufferW-x,Math.round(band.w*ratio)));
    const h=Math.max(1,Math.min(bufferH,Math.round(band.h*ratio)));
    // readPixels counts rows from the bottom.
    const y=Math.max(0,Math.min(bufferH-h,bufferH-Math.round((band.y+band.h)*ratio)));
    return {x,y,w,h};
  }
  function readSync(){
    const context=gl(),{x,y,w,h}=rect();
    const pixels=new Uint8Array(w*h*4);
    context.readPixels(x,y,w,h,context.RGBA,context.UNSIGNED_BYTE,pixels);
    return regionLuminance(pixels,w,h);
  }
  function issue(){
    const context=gl(),{x,y,w,h}=rect();
    const buffer=context.createBuffer();
    context.bindBuffer(context.PIXEL_PACK_BUFFER,buffer);
    context.bufferData(context.PIXEL_PACK_BUFFER,w*h*4,context.STREAM_READ);
    context.readPixels(x,y,w,h,context.RGBA,context.UNSIGNED_BYTE,0);
    context.bindBuffer(context.PIXEL_PACK_BUFFER,null);
    const sync=context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE,0);
    context.flush();
    pending={buffer,sync,w,h,band};
    schedulePoll();
  }
  function release(){
    if(!pending)return;
    const context=gl();
    context.deleteSync(pending.sync);context.deleteBuffer(pending.buffer);pending=null;
  }
  function schedulePoll(){if(!pollTimer&&pending)pollTimer=setTimeout(()=>{pollTimer=0;poll();},HEADER_POLL_MS);}
  function accept(next){
    if(next===null||(value!==null&&Math.abs(next-value)<=HEADER_EPSILON))return false;
    value=next;return true;
  }
  // Collects a pending reading when its fence has signaled; never waits.
  function poll(){
    if(!pending)return false;
    const context=gl(),status=context.clientWaitSync(pending.sync,0,0);
    if(status===context.TIMEOUT_EXPIRED){schedulePoll();return false;}
    const {buffer,w,h,band:issuedFor}=pending;
    let next=null;
    if(status!==context.WAIT_FAILED){
      const pixels=new Uint8Array(w*h*4);
      context.bindBuffer(context.PIXEL_PACK_BUFFER,buffer);
      context.getBufferSubData(context.PIXEL_PACK_BUFFER,0,pixels);
      context.bindBuffer(context.PIXEL_PACK_BUFFER,null);
      next=regionLuminance(pixels,w,h);
    }
    release();
    // A band that moved meanwhile makes this reading stale; the move asked for a new one.
    if(!sameHeaderBand(issuedFor,band))return false;
    if(accept(next)){onValue();return true;}
    return false;
  }
  return {
    // True when the band moved (the caller redraws so a fresh reading is taken).
    setBand(next){
      const clean=cleanHeaderBand(next);
      if(sameHeaderBand(clean,band))return false;
      band=clean;fresh=true;settled=true;return true;
    },
    get band(){return band;},
    // The newest reading, or null while there is none.
    get value(){return value;},
    get pending(){return !!pending;},
    poll,
    // Call after a frame is drawn. Returns true when a synchronous reading changed;
    // asynchronous readings arrive through `onValue`.
    sample(){
      if(!band)return false;
      const t=now();
      if(!asyncOk()){
        // WebGL1 only: no fence, so read once the scene has settled, never periodically.
        if(!settled){
          clearTimeout(timer);
          timer=setTimeout(()=>{timer=0;settled=true;onDue();},HEADER_INTERVAL_MS);
          return false;
        }
        settled=false;fresh=false;lastRead=t;
        return accept(readSync());
      }
      if(pending){
        // One read at a time; the poll collects it. Ask again once it has landed.
        if(!timer)timer=setTimeout(()=>{timer=0;fresh=true;onDue();},HEADER_INTERVAL_MS);
        return false;
      }
      if(!fresh&&t-lastRead<HEADER_INTERVAL_MS){
        if(!timer)timer=setTimeout(()=>{timer=0;fresh=true;onDue();},HEADER_INTERVAL_MS-(t-lastRead));
        return false;
      }
      fresh=false;lastRead=t;
      issue();
      return false;
    },
    dispose(){clearTimeout(timer);clearTimeout(pollTimer);timer=pollTimer=0;release();band=null;},
  };
}

// Named regions (the `inkBands` host command): a lab's plateless controls each
// stand over their own part of the frame and pick their own ink. `setBands`
// takes {name:{x,y,w,h}} (CSS pixels from the canvas's top-left) and replaces
// the set; each name is sampled like the header, and `values` is the
// {name:luminance} the lab publishes as `inkLuminance` (null while empty).
// Lab-agnostic: any scene with a renderer can create one.
export function createInkSamplers(renderer,opts={}){
  const samplers=new Map();
  return {
    // True when a band was added, moved or removed (the caller redraws).
    setBands(next){
      let changed=false;
      const clean={};
      if(next&&typeof next==='object')for(const [name,band] of Object.entries(next)){
        const b=cleanHeaderBand(band);if(b)clean[name]=b;
      }
      for(const name of [...samplers.keys()])if(!(name in clean)){samplers.get(name).dispose();samplers.delete(name);changed=true;}
      for(const [name,band] of Object.entries(clean)){
        let s=samplers.get(name);
        if(!s){s=createHeaderSampler(renderer,opts);samplers.set(name,s);}
        if(s.setBand(band))changed=true;
      }
      return changed;
    },
    get names(){return [...samplers.keys()];},
    get values(){
      const out={};
      for(const [name,s] of samplers)if(s.value!==null)out[name]=s.value;
      return Object.keys(out).length?out:null;
    },
    sample(){let changed=false;for(const s of samplers.values())if(s.sample())changed=true;return changed;},
    dispose(){for(const s of samplers.values())s.dispose();samplers.clear();},
  };
}