import * as THREE from './vendor/three.module.min.f231b18ca7.js';

/**
 * An unlit material with the camera lesson's restrained, three-ink print
 * finish. Keep `uniforms` public: the part registry and reveal animation use
 * them as their small material-control contract.
 */
export class CameraPrintMaterial extends THREE.MeshBasicMaterial {
  constructor(color = '#808080', accent = new THREE.Color('#5b8fb9')) {
    // Material colors are stored in linear space by THREE.Color. This keeps
    // the supplied color (including a prebuilt linear THREE.Color) intact,
    // while the renderer's output color space handles display conversion.
    super({color, toneMapped:false});
    const hsl={};
    this.color.getHSL(hsl,THREE.SRGBColorSpace);
    this.uniforms={
      tone:{value:hsl.l},
      opacity:{value:1},
      highlight:{value:0},
      // A fixed grey ink (0..1) for the unhighlighted state; negative derives
      // it from the colour. The blue state still follows the colour.
      grayInk:{value:-1},
      accent:{value:new THREE.Color(accent)},
    };
  }

  copy(source) {
    super.copy(source);
    this.uniforms={
      tone:{value:source.uniforms.tone.value},
      opacity:{value:source.uniforms.opacity.value},
      highlight:{value:source.uniforms.highlight.value},
      grayInk:{value:source.uniforms.grayInk.value},
      accent:{value:source.uniforms.accent.value.clone()},
    };
    return this;
  }

  onBeforeCompile(shader) {
    shader.uniforms.printTone=this.uniforms.tone;
    shader.uniforms.printOpacity=this.uniforms.opacity;
    shader.uniforms.printHighlight=this.uniforms.highlight;
    shader.uniforms.printAccent=this.uniforms.accent;
    shader.uniforms.printGrayInk=this.uniforms.grayInk;
    shader.fragmentShader=`
      uniform float printTone;
      uniform float printOpacity;
      uniform float printHighlight;
      uniform vec3 printAccent;
      uniform float printGrayInk;
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      float printLight = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float printValue = clamp(printLight * (2.4 + printTone * 2.2), 0.0, 1.0);
      float printInk = printValue > 0.72 ? 0.78 : (printValue > 0.28 ? 0.32 : 0.045);
      vec3 printGray = vec3(printGrayInk >= 0.0 ? printGrayInk : printInk);
      vec3 printColor = printAccent * (0.42 + printInk * 0.72);
      diffuseColor.rgb = mix(printGray, printColor, printHighlight);
      outgoingLight = diffuseColor.rgb;
      diffuseColor.a = printOpacity;
      #include <opaque_fragment>
    `);
  }

  customProgramCacheKey() {
    return 'focal-camera-print-unlit-v1';
  }
}

export function createCameraPrintMaterial(color, accent) {
  return new CameraPrintMaterial(color,accent);
}
