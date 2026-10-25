import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {GLTFLoader} from './vendor/GLTFLoader.f231b18ca7.js';
import {MeshoptDecoder} from './vendor/meshopt_decoder.f231b18ca7.js';

import {BUST_MODELS,modelUrl,FACE_PILOT_MODELS,VITRUVIAN_EYE_X} from './bust_models.js';
import {WORLD_UNITS_PER_METER,YOUNG_WOMAN_HEIGHT_M,metersToWorld} from './world_scale.js';
export {BUST_MODELS,PILOT_MODEL_BASE,modelUrl,FACE_PILOT_MODEL,STYLED_FACE_PILOT_MODEL,PONYTAIL_FACE_PILOT_MODEL,
  VICTORIAN_FACE_PILOT_MODEL,SHORT_CURLS_FACE_PILOT_MODEL,MESSY_BUN_FACE_PILOT_MODEL,FACE_PILOT_MODELS} from './bust_models.js';

// Kent, October 22, 2026: the bust is life size. The shipped GLBs are authored in meters, so a model is
// scaled by world units per meter and nothing else (the Vitruvian study stays 3.2 units, the young
// woman 3.15, the young man 3.15). The face pilots carry hair and clothing that vary in height, so they
// are fitted by the head mesh to the young woman's native height instead of a made-up 3.2.
export const PILOT_FIT_HEIGHT = metersToWorld(YOUNG_WOMAN_HEIGHT_M);

/** The scale that puts [model] at life size; [size] is its fitted bounds' size in its own units. */
export function bustScale(model,size){
  return model?.pilot===true?PILOT_FIT_HEIGHT/size.y:WORLD_UNITS_PER_METER;
}

export async function buildBust(id='vitruvian',options={}) {
  const model=[...BUST_MODELS,...(options.facePilot?FACE_PILOT_MODELS:[])].find(model=>model.id===id);
  if(!model)throw new Error('Unknown portrait model');
  const {scene:asset}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(modelUrl(model),options.onProgress);
  const bust=new THREE.Group();bust.name='lightingStudy';
  const preserveImportedMaterials=model.pilot===true;
  const clay=new THREE.MeshStandardMaterial({color:0xb5b5b5,roughness:1,metalness:0});
  // A touch darker than the head clay: a hint of a hairline, not a wig seam.
  const hairlineClay=new THREE.MeshStandardMaterial({color:0xa2a2a2,roughness:1,metalness:0});
  // Print quantization is applied by lighting_optics.js after exposure and
  // color conversion; the bust material remains physically continuous here.
  const outlineMaterial=new THREE.ShaderMaterial({
    side:THREE.BackSide,
    vertexShader:`void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position+normal*0.0006,1.0);}`,
    fragmentShader:`void main(){gl_FragColor=vec4(vec3(0.0),1.0);}`,
  });
  const outlines=[];
  // Collect first: adding children during traverse would visit outlines too.
  const meshes=[];asset.traverse(object=>{if(object.isMesh)meshes.push(object);});
  for(const object of meshes){
    const name=object.material.name || 'UnpaintedClay';
    if(!preserveImportedMaterials){
      for(const material of [object.material].flat()){
        for(const value of Object.values(material))if(value?.isTexture)value.dispose();
        material.dispose();
      }
      // Open eyes use the same unpainted matte material as a sculpted statue;
      // the hairline gets its own slightly darker clay instead of the shared one.
      object.material=name==='HairlineClay'?hairlineClay:clay;
      object.name=name;
    }
    object.castShadow=true;object.receiveShadow=true;
    if(!preserveImportedMaterials&&name!=='SolidEyeClay'&&name!=='HairlineClay'&&(name==='UnpaintedClay'||id!=='vitruvian')){
      const outline=new THREE.Mesh(object.geometry,outlineMaterial);
      outline.name='headOutline';object.add(outline);outlines.push(outline);
    }
  }
  // Pilot assets may add hair and clothing. Keep the face at the established
  // young-woman scale by fitting from its named head mesh only.
  const normalizationMeshes=model.pilot
    ?meshes.filter(object=>/^(young-woman|head)(?:$|[_-])/i.test(object.name||''))
    :[];
  const bounds=new THREE.Box3();
  if(normalizationMeshes.length){
    asset.updateWorldMatrix(true,true);
    for(const object of normalizationMeshes){
      const position=object.geometry.attributes.position;
      const basis=new THREE.Box3().setFromBufferAttribute(position).applyMatrix4(object.matrixWorld);
      bounds.union(basis);
    }
  }else bounds.setFromObject(asset);
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const scale=bustScale(model,size);
  asset.scale.multiplyScalar(scale);
  asset.position.set(-center.x*scale,.15-center.y*scale,-center.z*scale);
  bust.add(asset);
  bust.updateWorldMatrix(true,true);
  const authoredEyes=id==='vitruvian'?VITRUVIAN_EYE_X.map(x=>{
    // Authored image-plane eye centers, intersected with the real face surface
    // so focus uses face depth rather than a guessed plane inside the head.
    const ray=new THREE.Raycaster(new THREE.Vector3(x,.95,5),new THREE.Vector3(0,0,-1));
    const hit=ray.intersectObjects(meshes,false)[0];
    return hit?bust.worldToLocal(hit.point.clone()):new THREE.Vector3(x,.95,.08);
  }):[];
  // The source GLBs label both eye inserts `SolidEyeClay`. Keep this landmark
  // API data-driven: if a future asset omits those named meshes it returns an
  // empty list instead of inventing screen-space coordinates.
  bust.userData.getEyeLandmarks=()=>{
    asset.updateWorldMatrix(true,true);bust.updateWorldMatrix(true,true);
    const landmarks=[];
    asset.traverse(object=>{
      if(!object.isMesh||!/eye/i.test(object.name||''))return;
      if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
      const local=object.geometry.boundingBox.getCenter(new THREE.Vector3());
      const world=object.localToWorld(local.clone());
      landmarks.push({name:object.name,local:bust.worldToLocal(world.clone()).toArray(),world:world.toArray()});
    });
    if(!landmarks.length&&id==='vitruvian'){
      // The Vitruvian derivative intentionally has one merged clay head mesh
      // and no eye node names. These points are authored against the visible
      // eye centers in the normalized renderer view, rather than pretending
      // that a hidden mesh landmark exists.
      for(const [index,name] of ['left','right'].entries()){
        const local=authoredEyes[index].clone(),world=bust.localToWorld(local.clone());
        landmarks.push({name,local:local.toArray(),world:world.toArray(),authored:true});
      }
    }
    landmarks.sort((a,b)=>a.local[0]-b.local[0]);
    return {left:landmarks[0]??null,right:landmarks[1]??null,all:landmarks};
  };
  bust.userData.setStyle=style=>{
    for(const outline of outlines)outline.visible=style==='print';
  };
  bust.userData.modelId=id;
  bust.userData.assetTriangles=meshes.reduce((sum,mesh)=>sum+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);
  bust.userData.dispose=()=>{
    const geometries=new Set(meshes.map(mesh=>mesh.geometry));
    for(const geometry of geometries)geometry.dispose();
    if(preserveImportedMaterials){
      const materials=new Set(meshes.map(mesh=>mesh.material));
      for(const material of materials){
        for(const value of Object.values(material))if(value?.isTexture)value.dispose();
        material.dispose();
      }
    }
    clay.dispose();hairlineClay.dispose();outlineMaterial.dispose();
  };
  return bust;
}
