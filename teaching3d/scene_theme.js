// Recolour the existing scene and material uniforms. Renderer, geometry,
// camera pose and lesson state stay owned by the scene's existing lifecycle.
// The finished picture is levelled to the two papers at its last pass (see
// levelOut in lighting_shading.js): out = black + x * (white - black), in linear light. A color
// that must land on screen as [hex] is therefore drawn as its pre-image.
export const grayOf=hex=>parseInt(hex.slice(1,3),16)/255;
const toLin=v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
const toEnc=l=>l<=.0031308?l*12.92:1.055*Math.pow(l,1/2.4)-.055;
export function levelPreimage(hex,black,white){
  const channel=i=>{
    const v=toEnc(Math.min(1,Math.max(0,(toLin(parseInt(hex.slice(1+2*i,3+2*i),16)/255)-toLin(black))/(toLin(white)-toLin(black)))));
    return Math.round(v*255).toString(16).padStart(2,'0');
  };
  return '#'+channel(0)+channel(1)+channel(2);
}

// [levels] ({black,white}, 0..1 display values) is the Studio's: its scene is
// drawn in pre-image and levelled at the end. Tokens black and white update it.
export function applySceneTheme(scene,tokens,{root=document.documentElement,
  accent,contextInk,contextEntries=[],levels,onDark=()=>{},onApplied=()=>{},invalidate=()=>{}}={}){
  const hex=value=>typeof value==='string'&&/^[0-9a-f]{6}$/i.test(value)?'#'+value:null;
  if(levels&&hex(tokens.black)&&hex(tokens.white)){levels.black=grayOf(hex(tokens.black));levels.white=grayOf(hex(tokens.white));}
  for(const key of ['bg','fg','muted','line','info']){
    const colour=hex(tokens[key]);
    if(!colour)continue;
    root.style.setProperty('--'+(key==='info'?'accent':key),colour);
    if(key==='bg')scene.background.set(levels?levelPreimage(colour,levels.black,levels.white):colour);
    if(key==='fg'){
      contextInk?.set(colour);
      for(const entry of contextEntries){
        if(entry.object.userData.contextOutline){
          entry.color?.set(colour);entry.material.color?.set(colour);
        }
      }
    }
    if(key==='info'){
      accent?.set(colour);
      scene.traverse(object=>{
        const materials=Array.isArray(object.material)?object.material:[object.material];
        for(const material of materials)material?.uniforms?.accent?.value.set(colour);
      });
    }
  }
  if(tokens.theme==='dark'||tokens.theme==='light')onDark(tokens.theme==='dark');
  onApplied();
  invalidate();
}

// Softbox outline ink follows the current theme, for new and existing lights.
// Drawn as the pre-image of the page's ink (levelPreimage): the last pass puts
// it at 0x121212 on the light paper and 0xF5F5F5 on the dark one.
export const softboxEdgeColor=dark=>dark?0xffffff:0x000000;
export function recolourSoftboxEdges(sources,dark){
  for(const source of sources)source.boxEdges.material.color.setHex(softboxEdgeColor(dark));
}

// Opacity and ink of one context line (print or technical outline) for the
// current theme. Shared by the scene and its tests so a theme message and a
// focus change always derive the same values.
export function styleContextLine(entry,{dark,ink,active,amount}){
  const target=dark?.14:.12;
  const opacity=active?entry.opacity:target*amount+entry.opacity*(1-amount);
  if(entry.color){
    entry.material.color.copy(entry.color);
    if(dark&&!active)entry.material.color.lerp(ink,amount);
  }
  return opacity;
}

// Theme-only restyle: writes material.color and material.opacity of context
// lines and nothing else. Meshes, visibility, transparency and depth state
// (curtains, demo fades, exposure) belong to the scene and are never touched.
export function restyleContextLines(entries,{active,amount,dark,ink}){
  for(const entry of entries){
    const {object}=entry;
    if(!object.isLineSegments||!(object.userData.printOutline||object.userData.contextOutline))continue;
    entry.material.opacity=styleContextLine(entry,{dark,ink,active:active.has(object),amount});
  }
}
