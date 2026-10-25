// Studio tint extension (register #38): a warmth ruler on any Studio lamp, orange to blue, in the halftone ink.
//
//   extTint {lamp?, warmth}   [warmth] -1 (orange) to 1 (blue), 0 neutral; [lamp] defaults to light-1
//   extTint {clear:true}      every lamp neutral again, the ink the theme's own
//
// The picture prints in one ink, so a lamp's colour cannot show as colour on the paper by itself: the lamp's
// light is tinted (its spot lights, so the bust's luminance follows), the halftone's dots print in the hue of
// the lamps' light (weighted by each lamp's brightness) through a blend layer on the page, and the paper takes
// a faint share of it. Both go the moment no lamp is tinted. `frame()` (lesson_studio.js, every draw) keeps
// the lamps' colour after a rebuilt lamp.
// State: ext.tint = {warmth: {id: value}, ink, layers: {ink, wash}}.
import {clamp,finite,hexOf,tintedInk,warmthRgb} from './studio_ext_math.js';
import {colorLamp} from './studio_ext_util.js';

export function createExtTint(ctx){
  const warmth=new Map();
  let applied=null,inked=false;

  const root=()=>document.documentElement.style;
  // The theme's ink and paper: set on the page by a theme message, else the page's own URL tokens (the embed's
  // first draw has no message yet, so the style is empty and a tint would never print).
  const urlInk=key=>{const v=new URLSearchParams(location.search).get(key);return /^#?[0-9a-f]{6}$/i.test(v||'')?'#'+v.replace('#',''):'';};
  const themeInk=()=>({fg:root().getPropertyValue('--fg').trim()||urlInk('fg'),bg:root().getPropertyValue('--bg').trim()||urlInk('bg')});

  /** The ink colour the lamps' light prints in now: each lamp's tint, weighted by its brightness. */
  function inkRgb(){
    let total=0;const mix=[0,0,0];
    for(const state of ctx.getSourceStates()){
      const w=warmth.get(state.id);
      if(w===undefined||!state.enabled)continue;
      const weight=Math.max(state.brightnessPercent,1),rgb=warmthRgb(w);
      for(let i=0;i<3;i++)mix[i]+=rgb[i]*weight;
      total+=weight;
    }
    return total>0?mix.map(c=>c/total):null;
  }
  // Overlays on the page (the halftone's dots are true black or white, so the tint cannot ride the shader's ink):
  // an ink layer that lightens (light paper) or darkens (dark paper) the dots into the tint, and a faint wash on
  // the paper. Both are plain colours, never translucent.
  let layers=null,shown={ink:null,wash:null};
  function makeLayers(){
    if(layers||typeof document?.createElement!=='function'||!document.body)return layers;
    const make=()=>{
      const el=document.createElement('div');
      Object.assign(el.style,{position:'fixed',inset:'0',pointerEvents:'none',display:'none',zIndex:'2'});
      document.body.appendChild(el);return el;
    };
    layers={ink:make(),wash:make()};return layers;
  }
  function applyInk(force=false,notify=true){
    const dark=ctx.isDark?.()===true;
    const rgb=[...warmth.values()].some(w=>Math.abs(w)>.001)?inkRgb():null;
    const {bg}=themeInk();
    const ink=rgb?hexOf(tintedInk(dark?'#ffffff':'#000000',rgb,dark,dark?.8:.85)):null;
    // The paper takes a faint share of the light's colour: warm or cool, never a wash over the print.
    const wash=rgb?hexOf(dark?rgb.map(c=>c*.14):rgb.map(c=>1-(1-c)*.55)):null;
    const key=[ink,wash,dark,bg].join('|');
    if(!force&&key===applied)return;
    applied=key;shown={ink,wash};inked=rgb!=null;
    const l=makeLayers();
    if(l){
      l.ink.style.display=ink?'block':'none';
      l.ink.style.background=ink??'';l.ink.style.mixBlendMode=dark?'darken':'lighten';
      l.wash.style.display=wash?'block':'none';
      // A wash that ends in the paper itself: no edge shows where the layer stops.
      l.wash.style.background=wash?`radial-gradient(ellipse at 50% 42%, ${wash} 0%, ${dark?'#000000':'#ffffff'} 62%)`:'';
      l.wash.style.mixBlendMode=dark?'screen':'multiply';
    }
    if(notify)ctx.invalidate();
  }

  return {
    command(value){
      if(value?.clear===true){
        const ids=[...warmth.keys()];warmth.clear();
        for(const id of ids)colorLamp(ctx,id,[1,1,1]);
        applyInk(true);ctx.publishState();return;
      }
      if(!finite(value?.warmth))return;
      const id=typeof value.lamp==='string'?value.lamp:'light-1';
      if(!ctx.getSourceStates().some(state=>state.id===id))return;
      const w=clamp(value.warmth,-1,1);
      warmth.set(id,w);
      colorLamp(ctx,id,warmthRgb(w));
      applyInk(true);ctx.publishState();
    },
    frame(){
      if(!warmth.size&&!inked)return;
      for(const [id,w] of warmth){
        const light=ctx.getSources().find(s=>s.state.id===id)?.area.samples[0]?.light,want=warmthRgb(w);
        if(light&&Math.abs(light.color.r-want[0])+Math.abs(light.color.g-want[1])+Math.abs(light.color.b-want[2])>.01)colorLamp(ctx,id,want);
      }
      // A theme message resets the optics' colours even when its tokens are unchanged: set them again at every
      // draw while tinted (two uniform writes), without asking for another frame.
      applyInk(false,false);
    },
    state:()=>({warmth:Object.fromEntries(warmth),ink:inked,layers:shown}),
    dispose(){
      for(const id of warmth.keys())colorLamp(ctx,id,[1,1,1]);
      warmth.clear();applyInk(true);
      layers?.ink.remove();layers?.wash.remove();layers=null;
    },
  };
}
