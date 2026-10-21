// What the meter row sits over. The Flutter meter lies above the canvas; each
// of its ticks, numbers and signs picks light or dark ink from the rendered
// frame directly behind it. The host sends where the meter is (`meterBand`);
// after every rendered frame this reads two thin strips of that frame back and
// reports one mean luminance per column bucket. Reading the finished frame
// means the reframe view offset is already in it.
export const STRIP_SAMPLES=64; // domain: columns across the meter's span
export const CHANGE_EPSILON=.02; // domain: luminance change worth a new message

// Mean luminance (0..1, display-encoded) of `n` equal column buckets across an
// RGBA readback `width` x `height`; every row of the strip counts equally.
export function stripLuminance(pixels,width,height,n=STRIP_SAMPLES){
  const out=new Array(n).fill(0);
  if(!width||!height)return out;
  for(let k=0;k<n;k++){
    const x0=Math.floor(k*width/n),x1=Math.max(x0+1,Math.floor((k+1)*width/n));
    let sum=0,count=0;
    for(let y=0;y<height;y++)for(let x=x0;x<Math.min(x1,width);x++){
      const i=(y*width+x)*4;
      sum+=(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2])/255;count++;
    }
    out[k]=count?Math.round(sum/count*100)/100:0;
  }
  return out;
}

export function stripsDiffer(a,b,epsilon=CHANGE_EPSILON){
  if(!a||!b)return true;
  for(const key of ['row','num']){
    if(a[key].length!==b[key].length)return true;
    for(let i=0;i<a[key].length;i++)if(Math.abs(a[key][i]-b[key][i])>epsilon)return true;
  }
  return false;
}

// A band is {x,w,rowY,rowH,numY,numH} in CSS pixels from the canvas's top-left.
export function cleanBand(value){
  if(!value||typeof value!=='object')return null;
  const keys=['x','w','rowY','rowH','numY','numH'];
  if(!keys.every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])))return null;
  if(value.w<=0||value.rowH<=0||value.numH<=0)return null;
  return Object.fromEntries(keys.map(k=>[k,Math.round(value[k])]));
}

export function sameBand(a,b){
  return !!a&&!!b&&['x','w','rowY','rowH','numY','numH'].every(k=>a[k]===b[k]);
}

// onStrips opts in to asynchronous readback: both strips go into one pixel-pack
// buffer behind one fence, so the GPU is never waited on, and the strips of a
// frame arrive with the next one (the caller is told through onStrips and
// redraws). A renderer without WebGL2 fences, or a failed fence, reads
// synchronously instead.
export function createBackdropSampler(renderer,{onStrips=null}={}){
  let band=null,last=null,ready=null,epoch=0,issued=0,applied=0;
  const gl=()=>renderer.getContext();
  let asyncOk=typeof onStrips==='function'&&typeof gl()?.fenceSync==='function'&&
    typeof gl().clientWaitSync==='function';
  function geometry(top,height,left,width,ratio,bufferW,bufferH){
    const x=Math.max(0,Math.min(bufferW-1,Math.round(left*ratio)));
    const w=Math.max(1,Math.min(bufferW-x,Math.round(width*ratio)));
    const h=Math.max(1,Math.min(bufferH,Math.round(height*ratio)));
    // readPixels counts rows from the bottom.
    const y=Math.max(0,Math.min(bufferH-h,bufferH-Math.round((top+height)*ratio)));
    return {x,y,w,h};
  }
  function waitFence(context,sync){
    return new Promise((resolve,reject)=>{
      const poll=()=>{
        const status=context.clientWaitSync(sync,0,0);
        if(status===context.WAIT_FAILED)reject(new Error('fence failed'));
        else if(status===context.TIMEOUT_EXPIRED)setTimeout(poll,2);
        else resolve();
      };
      poll();
    });
  }
  function readAsync(){
    const context=gl(),ratio=renderer.getPixelRatio();
    const bufferW=context.drawingBufferWidth,bufferH=context.drawingBufferHeight;
    const row=geometry(band.rowY,band.rowH,band.x,band.w,ratio,bufferW,bufferH);
    const num=geometry(band.numY,band.numH,band.x,band.w,ratio,bufferW,bufferH);
    const rowBytes=row.w*row.h*4,total=rowBytes+num.w*num.h*4;
    const mine=epoch,seq=++issued;
    const buffer=context.createBuffer();
    context.bindBuffer(context.PIXEL_PACK_BUFFER,buffer);
    context.bufferData(context.PIXEL_PACK_BUFFER,total,context.STREAM_READ);
    context.readPixels(row.x,row.y,row.w,row.h,context.RGBA,context.UNSIGNED_BYTE,0);
    context.readPixels(num.x,num.y,num.w,num.h,context.RGBA,context.UNSIGNED_BYTE,rowBytes);
    context.bindBuffer(context.PIXEL_PACK_BUFFER,null);
    const sync=context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE,0);
    context.flush();
    waitFence(context,sync).then(()=>{
      const pixels=new Uint8Array(total);
      context.bindBuffer(context.PIXEL_PACK_BUFFER,buffer);
      context.getBufferSubData(context.PIXEL_PACK_BUFFER,0,pixels);
      context.bindBuffer(context.PIXEL_PACK_BUFFER,null);
      context.deleteBuffer(buffer);context.deleteSync(sync);
      if(mine!==epoch||seq<applied)return;
      applied=seq;
      const next={row:stripLuminance(pixels.subarray(0,rowBytes),row.w,row.h),
        num:stripLuminance(pixels.subarray(rowBytes),num.w,num.h)};
      // Compared with what the host last received (or is about to), never with a
      // landed reading nobody has taken yet.
      if(!stripsDiffer(ready??last,next))return;
      ready=next;onStrips();
    }).catch(()=>{asyncOk=false;last=null;ready=null;});
  }
  function readStrip(top,height,left,width,ratio,bufferW,bufferH){
    const x=Math.max(0,Math.min(bufferW-1,Math.round(left*ratio)));
    const w=Math.max(1,Math.min(bufferW-x,Math.round(width*ratio)));
    const h=Math.max(1,Math.min(bufferH,Math.round(height*ratio)));
    // readPixels counts rows from the bottom.
    const y=Math.max(0,Math.min(bufferH-h,bufferH-Math.round((top+height)*ratio)));
    const pixels=new Uint8Array(w*h*4);
    gl().readPixels(x,y,w,h,gl().RGBA,gl().UNSIGNED_BYTE,pixels);
    return stripLuminance(pixels,w,h);
  }
  return {
    // True when the band moved (the caller redraws so a fresh strip is read).
    setBand(value){
      const next=cleanBand(value);
      if(sameBand(next,band))return false;
      band=next;last=null;ready=null;epoch++;return true;
    },
    get band(){return band;},
    // The strips to send after a frame was drawn, or null when there is no band
    // or nothing changed beyond the epsilon since the last strips sent.
    // llowAsync:false reads synchronously (exact now; a frame on its own).
    sample({allowAsync=true}={}){
      if(!band)return null;
      if(asyncOk&&allowAsync){
        readAsync();
        const strips=ready;ready=null;if(strips)last=strips;return strips;
      }
      applied=++issued;ready=null; // older asynchronous strips still in flight are stale
      const size={w:gl().drawingBufferWidth,h:gl().drawingBufferHeight};
      const ratio=renderer.getPixelRatio();
      const next={
        row:readStrip(band.rowY,band.rowH,band.x,band.w,ratio,size.w,size.h),
        num:readStrip(band.numY,band.numH,band.x,band.w,ratio,size.w,size.h),
      };
      if(!stripsDiffer(last,next))return null;
      last=next;return next;
    },
  };
}
