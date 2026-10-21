import * as THREE from './vendor/three.module.min.f231b18ca7.js';

/** A view-only softbox treatment. Sample the actual static subject surface once;
 * test camera-to-surface segments against the emitter rectangle during redraws.
 * This avoids a GPU readback, extra render pass or per-frame triangle raycasts.
 */
export function createSourceOcclusion(subject, maxSamples=4096) {
  subject.updateWorldMatrix(true,true);
  const meshes=[];
  subject.traverse(object=>{
    if(object.isMesh&&object.name!=='headOutline')meshes.push(object);
  });
  const total=meshes.reduce((sum,mesh)=>sum+mesh.geometry.attributes.position.count,0);
  const stride=Math.max(1,Math.ceil(total/maxSamples));
  const rootInverse=subject.matrixWorld.clone().invert(),point=new THREE.Vector3();
  const samples=[];
  let index=0;
  for(const mesh of meshes){
    const position=mesh.geometry.attributes.position;
    const matrix=rootInverse.clone().multiply(mesh.matrixWorld);
    for(let i=0;i<position.count;i++,index++){
      if(index%stride)continue;
      samples.push(point.fromBufferAttribute(position,i).applyMatrix4(matrix).clone());
    }
  }
  const inverse=new THREE.Matrix4(),matrix=new THREE.Matrix4(),eye=new THREE.Vector3();
  return {
    sampleCount:samples.length,
    isOccluding(camera,source){
      source.updateWorldMatrix(true,false);subject.updateWorldMatrix(true,false);
      inverse.copy(source.matrixWorld).invert();
      camera.getWorldPosition(eye).applyMatrix4(inverse);
      matrix.copy(inverse).multiply(subject.matrixWorld);
      // The case extends behind the emitting plane. Use the nearer face so a
      // grazing view does not leave an opaque sliver across the subject.
      const plane=eye.z>=0?.002:-.085;
      for(const sample of samples){
        point.copy(sample).applyMatrix4(matrix);
        const t=(plane-eye.z)/(point.z-eye.z);
        if(t<=0||t>=1||!Number.isFinite(t))continue;
        const x=eye.x+(point.x-eye.x)*t,y=eye.y+(point.y-eye.y)*t;
        if(Math.abs(x)<=.5&&Math.abs(y)<=.5)return true;
      }
      return false;
    },
  };
}
