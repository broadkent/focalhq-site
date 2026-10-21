// A lower-poly copy of a triangle mesh by vertex clustering: the bounding box is
// cut into a grid, every vertex in a cell becomes one vertex (the average of the
// positions, the sum of the normals, renormalized), and a triangle whose corners
// fall in fewer than three cells is dropped. The grid's cell size is bisected until
// the copy has about [target] triangles. Pure typed arrays, so a node test loads it.
// Used by the low-poly drag render (lighting_drag_render.js): the loaded bust has
// no decimation tool vendored (three's SimplifyModifier is not in vendor/), and
// clustering is one pass over the vertices, cheap enough to run once at first use.

// Triangles that survive clustering with square cells of [size].
function cluster(position,index,count,min,size,cells){
  const [nx,ny]=cells,keys=new Float64Array(count);
  for(let i=0;i<count;i++){
    const x=Math.min(nx-1,Math.floor((position[i*3]-min[0])/size)),
      y=Math.min(ny-1,Math.floor((position[i*3+1]-min[1])/size)),
      z=Math.floor((position[i*3+2]-min[2])/size);
    keys[i]=x+nx*(y+ny*z);
  }
  const triangles=index?index.length/3:count/3;
  let kept=0;
  for(let t=0;t<triangles;t++){
    const a=keys[index?index[t*3]:t*3],b=keys[index?index[t*3+1]:t*3+1],c=keys[index?index[t*3+2]:t*3+2];
    if(a!==b&&b!==c&&a!==c)kept++;
  }
  return {keys,kept};
}

// {position, normal, index} (typed arrays) for about [target] triangles; the mesh
// itself when it already has fewer.
export function decimate({position,normal,index},target){
  const count=position.length/3,triangles=index?index.length/3:count/3;
  if(triangles<=target)return {position,normal,index:index??Uint32Array.from({length:count},(_,i)=>i),triangles};
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let k=0;k<3;k++){const v=position[i*3+k];if(v<min[k])min[k]=v;if(v>max[k])max[k]=v;}
  const extent=[max[0]-min[0],max[1]-min[1],max[2]-min[2]],longest=Math.max(...extent,1e-9);
  const cellsFor=size=>[Math.floor(extent[0]/size)+1,Math.floor(extent[1]/size)+1];
  let lo=longest/4096,hi=longest/2,best=null;
  for(let step=0;step<14;step++){
    const size=Math.sqrt(lo*hi),result=cluster(position,index,count,min,size,cellsFor(size));
    if(result.kept>target){lo=size;}else{hi=size;best={size,result};}
  }
  if(!best){const size=hi;best={size,result:cluster(position,index,count,min,size,cellsFor(size))};}
  const {keys}=best.result,slot=new Map(),sumP=[],sumN=[],weight=[];
  const remap=new Uint32Array(count);
  for(let i=0;i<count;i++){
    let s=slot.get(keys[i]);
    if(s===undefined){s=weight.length;slot.set(keys[i],s);weight.push(0);sumP.push(0,0,0);sumN.push(0,0,0);}
    remap[i]=s;weight[s]++;
    for(let k=0;k<3;k++){sumP[s*3+k]+=position[i*3+k];sumN[s*3+k]+=normal?normal[i*3+k]:0;}
  }
  const used=weight.length,outPosition=new Float32Array(used*3),outNormal=new Float32Array(used*3);
  for(let s=0;s<used;s++){
    for(let k=0;k<3;k++)outPosition[s*3+k]=sumP[s*3+k]/weight[s];
    const nl=Math.hypot(sumN[s*3],sumN[s*3+1],sumN[s*3+2])||1;
    for(let k=0;k<3;k++)outNormal[s*3+k]=sumN[s*3+k]/nl;
  }
  const out=[];
  for(let t=0;t<triangles;t++){
    const a=remap[index?index[t*3]:t*3],b=remap[index?index[t*3+1]:t*3+1],c=remap[index?index[t*3+2]:t*3+2];
    if(a!==b&&b!==c&&a!==c)out.push(a,b,c);
  }
  return {position:outPosition,normal:outNormal,index:Uint32Array.from(out),triangles:out.length/3};
}
