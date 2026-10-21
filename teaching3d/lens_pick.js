// Minimum-size screen-space targets for visible lens elements in Explore.
// Direct mesh hits still take precedence; this only handles near misses.
export function pickLensTarget(bounds,point,{minimumSize=48,padding=8}={}){
  const candidates=[];
  for(const box of bounds){
    const {left,right,top,bottom}=box;
    if(![left,right,top,bottom].every(Number.isFinite)||right<left||bottom<top)continue;
    const x=(left+right)/2,y=(top+bottom)/2;
    const halfWidth=Math.max(minimumSize/2,(right-left)/2+padding);
    const halfHeight=Math.max(minimumSize/2,(bottom-top)/2+padding);
    if(Math.abs(point.x-x)>halfWidth||Math.abs(point.y-y)>halfHeight)continue;
    const dx=Math.max(left-point.x,0,point.x-right),dy=Math.max(top-point.y,0,point.y-bottom);
    candidates.push({...box,distance:Math.hypot(dx,dy),
      centerDistance:Math.hypot((point.x-x)/halfWidth,(point.y-y)/halfHeight)});
  }
  return candidates.sort((a,b)=>a.distance-b.distance||a.centerDistance-b.centerDistance||
    (a.depth??0)-(b.depth??0))[0]?.id;
}
