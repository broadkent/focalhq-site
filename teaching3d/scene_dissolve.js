import * as THREE from 'three';

// Blend two complete render states, rather than making every overlapping
// camera shell transparent. Temporary buffers exist only during the reveal;
// settled views still use the normal single, on-demand render.
const displayOutput={value:0};
const preparedMaterials=new WeakSet();
function prepareDisplayOutput(scene){
  scene.traverse(({material})=>{
    if(!material||preparedMaterials.has(material))return;
    preparedMaterials.add(material);
    const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey;
    material.onBeforeCompile=function(shader,...args){
      compile.call(this,shader,...args);
      shader.uniforms.focalDisplayOutput=displayOutput;
      shader.fragmentShader='uniform float focalDisplayOutput;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <colorspace_fragment>',`
        #include <colorspace_fragment>
        if(focalDisplayOutput>0.5)gl_FragColor=sRGBTransferOETF(gl_FragColor);
      `);
    };
    material.customProgramCacheKey=function(){return cacheKey.call(this)+'-display-dissolve';};
    material.needsUpdate=true;
  });
}

export function createSceneDissolve(renderer,scene) {
  prepareDisplayOutput(scene);
  const size=renderer.getDrawingBufferSize(new THREE.Vector2());
  // Ordinary Three targets force linear output, unlike the visible canvas.
  // Encode these passes explicitly into plain RGBA8 so translucent ink lines
  // blend in the same display space as the normal view, with no tone jump.
  const options={samples:4,depthBuffer:true,colorSpace:THREE.NoColorSpace};
  const solid=new THREE.WebGLRenderTarget(size.x,size.y,options);
  const context=new THREE.WebGLRenderTarget(size.x,size.y,options);
  const material=new THREE.ShaderMaterial({
    depthTest:false,depthWrite:false,toneMapped:false,
    uniforms:{solid:{value:solid.texture},context:{value:context.texture},amount:{value:0}},
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader:`uniform sampler2D solid;uniform sampler2D context;
      uniform float amount;varying vec2 vUv;
      void main(){
        gl_FragColor=mix(texture2D(solid,vUv),texture2D(context,vUv),amount);
      }`,
  });
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  const composite=new THREE.Scene();composite.add(plane);
  const camera=new THREE.Camera();
  return {
    render(scene,view,amount,showSolid,showContext){
      renderer.getDrawingBufferSize(size);
      if(solid.width!==size.x||solid.height!==size.y){
        solid.setSize(size.x,size.y);context.setSize(size.x,size.y);
      }
      const previousTarget=renderer.getRenderTarget();
      const background=scene.background;
      try{
        displayOutput.value=1;
        scene.background=background.clone().convertLinearToSRGB();
        showSolid();renderer.setRenderTarget(solid);renderer.render(scene,view);
        showContext();renderer.setRenderTarget(context);renderer.render(scene,view);
      }finally{
        displayOutput.value=0;scene.background=background;
        renderer.setRenderTarget(previousTarget);
      }
      material.uniforms.amount.value=amount;renderer.render(composite,camera);
    },
    dispose(){solid.dispose();context.dispose();plane.geometry.dispose();material.dispose();},
  };
}
