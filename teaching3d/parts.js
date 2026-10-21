import * as THREE from './vendor/three.module.min.f231b18ca7.js';

/** Named groups are the contract between lessons and model geometry.
 * A part owns its transform and materials; highlighting cannot leak to siblings.
 */
export function createPartRegistry() {
  const parts = new Map();
  function add(id, label, parent) {
    if (parts.has(id)) throw new Error('Duplicate camera part: '+id);
    const group = new THREE.Group(); group.name=id;
    group.userData.label=label; parent.add(group); parts.set(id, group);
    return group;
  }
  function get(id) {
    if(!parts.has(id)) throw new Error('Unknown camera part: '+id);
    return parts.get(id);
  }
  function isolateMaterials(root) {
    root.traverse(o=>{
      if(o.material && !o.userData.ownsMaterial) {
        o.material=o.material.clone();o.userData.ownsMaterial=true;
      }
    });
  }
  function highlight(id, root) {
    root.traverse(o=>{if(o.material?.uniforms?.highlight)o.material.uniforms.highlight.value=0;});
    if(!id)return '';
    const group=get(id);
    group.traverse(o=>{if(o.material?.uniforms?.highlight)o.material.uniforms.highlight.value=1;});
    return group.userData.label;
  }
  return {add,get,highlight,isolateMaterials,ids:()=>[...parts.keys()]};
}
