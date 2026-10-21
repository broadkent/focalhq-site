import * as THREE from './vendor/three.module.min.f231b18ca7.js';
import {CameraPrintMaterial} from './camera_print_material.js';
import {MAX_FILM_EXPOSURES} from './film_transport.js';

// The leader's original daylight exposure is a property of the stock, not the
// gate. Its boundary moves with the actual strip and follows it onto the spool.
export class FilmStockMaterial extends CameraPrintMaterial {
  constructor(color='#b2b2b2',accent=new THREE.Color('#5b8fb9')){
    super(color,accent);
    this.uniforms.filmTravel={value:0};
    this.uniforms.fogAccent={value:new THREE.Color('#57351f')};
    this.uniforms.freshAccent={value:new THREE.Color('#ac7c58')};
    this.uniforms.exposureCount={value:0};
    this.uniforms.exposureRanges={value:Array.from({length:MAX_FILM_EXPOSURES},()=>new THREE.Vector2())};
    this.uniforms.exposureStrengths={value:Array(MAX_FILM_EXPOSURES).fill(0)};
  }
  copy(source){
    super.copy(source);
    this.uniforms.filmTravel={value:source.uniforms.filmTravel.value};
    this.uniforms.fogAccent={value:source.uniforms.fogAccent.value.clone()};
    this.uniforms.freshAccent={value:source.uniforms.freshAccent.value.clone()};
    this.uniforms.exposureCount={value:source.uniforms.exposureCount.value};
    this.uniforms.exposureRanges={value:source.uniforms.exposureRanges.value.map(range=>range.clone())};
    this.uniforms.exposureStrengths={value:[...source.uniforms.exposureStrengths.value]};
    return this;
  }
  onBeforeCompile(shader){
    super.onBeforeCompile(shader);
    shader.uniforms.filmTravel=this.uniforms.filmTravel;
    shader.uniforms.fogAccent=this.uniforms.fogAccent;
    shader.uniforms.freshAccent=this.uniforms.freshAccent;
    shader.uniforms.exposureCount=this.uniforms.exposureCount;
    shader.uniforms.exposureRanges=this.uniforms.exposureRanges;
    shader.uniforms.exposureStrengths=this.uniforms.exposureStrengths;
    shader.vertexShader='attribute float stockDistance; varying float filmDistance; varying float filmRow;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nfilmDistance=stockDistance; filmRow=position.y;');
    shader.fragmentShader=`varying float filmDistance; varying float filmRow;
      uniform float filmTravel; uniform vec3 fogAccent; uniform vec3 freshAccent;
      uniform int exposureCount; uniform vec2 exposureRanges[${MAX_FILM_EXPOSURES}];
      uniform float exposureStrengths[${MAX_FILM_EXPOSURES}];\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('vec3 printColor = printAccent *',
      `float stockCoordinate=filmDistance-filmTravel;
       float exposureAmount=stockCoordinate>0.0?1.0:0.0;
       if(abs(filmRow)<=0.44){
         for(int i=0;i<${MAX_FILM_EXPOSURES};i++){
           if(i<exposureCount&&stockCoordinate>=exposureRanges[i].x&&stockCoordinate<=exposureRanges[i].y)exposureAmount=max(exposureAmount,exposureStrengths[i]);
         }
       }
       vec3 stockAccent=mix(freshAccent,fogAccent,exposureAmount);
       vec3 printColor = stockAccent *`);
    shader.fragmentShader=shader.fragmentShader.replace('diffuseColor.rgb = mix(printGray, printColor, printHighlight);',
      'diffuseColor.rgb = printColor;');
  }
  customProgramCacheKey(){return 'focal-film-stock-print-v3';}
}
