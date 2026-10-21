// Lightweight, dependency-free placement diagrams for the lighting study.
// The host owns the lighting state; this module only presents and edits it.

const LIMITS = Object.freeze({x: 12, z: 12, yMin: -12, yMax: 12, width: [0.15, 12]});
const PLACEMENT_SCALE=109/12;
const DEFAULT_STATE = Object.freeze({position: [1.4, 1.8, 2.2], target: [0, .55, 0], width: .8, height: 1});
const NS = 'http://www.w3.org/2000/svg';

const clamp = (n, a, b) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : a));
export function lightingPlacementPoint(kind,position){
  return [110+position[0]*PLACEMENT_SCALE,110+(kind==='top'?position[2]:-position[1])*PLACEMENT_SCALE];
}
export function lightingPlacementPosition(kind,point,previous){
  const position=[...previous];
  position[0]=clamp((point[0]-110)/PLACEMENT_SCALE,-LIMITS.x,LIMITS.x);
  if(kind==='top')position[2]=clamp((point[1]-110)/PLACEMENT_SCALE,-LIMITS.z,LIMITS.z);
  else position[1]=clamp((110-point[1])/PLACEMENT_SCALE,LIMITS.yMin,LIMITS.yMax);
  return position;
}
function cleanState(input = {}) {
  const p = Array.isArray(input.position) ? input.position : DEFAULT_STATE.position;
  const t = Array.isArray(input.target) ? input.target : DEFAULT_STATE.target;
  const width = clamp(input.width ?? DEFAULT_STATE.width, LIMITS.width[0], LIMITS.width[1]);
  return {
    position: [clamp(+p[0], -LIMITS.x, LIMITS.x), clamp(+p[1], LIMITS.yMin, LIMITS.yMax), clamp(+p[2], -LIMITS.z, LIMITS.z)],
    target: [Number.isFinite(+t[0]) ? +t[0] : 0, Number.isFinite(+t[1]) ? +t[1] : .55, Number.isFinite(+t[2]) ? +t[2] : 0],
    width, height: clamp(input.height ?? width * 1.25, .1875, 15),
  };
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

export function createPlacementControls({root, onChange, onSessionChange=()=>{}} = {}) {
  if (!(root instanceof Element)) throw new TypeError('root must be an Element');
  if (typeof onChange !== 'function') throw new TypeError('onChange must be a function');
  root.classList.add('placement-controls', 'is-disabled');
  root.innerHTML = '';
  const state = cleanState();
  const views = [];
  const listeners = [];
  let enabled = false;
  let session={selectedId:'light-1',lights:[{...state,id:'light-1',label:'Light 1',enabled:true,powerStops:0}],canAdd:true,canRemove:false};
  const settings=document.createElement('div');settings.className='source-settings';
  settings.innerHTML='<div class="source-choice" role="group" aria-label="Select light"><span class="placement-light-title" aria-live="polite"></span><button type="button" data-action="add" aria-label="Add light">+</button><button type="button" data-action="remove" aria-label="Delete selected light">×</button></div>';
  root.append(settings);
  for(const button of settings.querySelectorAll('[data-action]')){
    const fn=()=>{if(enabled)onSessionChange({type:button.dataset.action});};
    button.addEventListener('click',fn);listeners.push(()=>button.removeEventListener('click',fn));
  }

  const diagrams = document.createElement('div');
  diagrams.className = 'placement-diagrams';
  root.append(diagrams);

  function setAttr(el, key, value) { el.setAttribute(key, String(value)); }
  function pointFor(kind, pos) {
    return lightingPlacementPoint(kind,pos);
  }
  function bust(kind) {
    const group = svgEl('g', {class: 'bust-silhouette', 'aria-hidden': 'true', transform:`translate(110 110) scale(${PLACEMENT_SCALE/25.5}) translate(-110 -110)`});
    if (kind === 'top') {
      group.append(svgEl('ellipse', {cx: 110, cy: 105, rx: 37, ry: 13}), svgEl('path', {d: 'M94 106 C94 82 126 82 126 106 Q126 121 114 125 L110 131 L106 125 Q94 121 94 106Z'}));
    } else {
      group.append(svgEl('path', {d: 'M96 109 C89 74 131 74 124 109 L119 122 L120 135 Q135 136 147 148 Q148 164 110 166 Q72 164 73 148 Q85 136 100 135 L101 122Z'}));
    }
    return group;
  }
  function addView(kind, label) {
    const figure = document.createElement('figure');
    figure.className = 'placement-view';
    const caption = document.createElement('figcaption'); caption.textContent = label; figure.append(caption);
    const svg = svgEl('svg', {viewBox: '0 0 220 220', role: 'img', 'aria-label': `${label} light placement`});
    svg.append(svgEl('rect', {class: 'diagram-field', x: 1, y: 1, width: 218, height: 218, rx: 3}));
    svg.append(bust(kind));
    const aim = svgEl('line', {class: 'aim-line'}); svg.append(aim);
    const source = svgEl('g', {class: 'source-marker', tabindex: '0', role: 'slider', 'aria-label': `${label} source position`});
    const edge = svgEl('line', {class: 'aiming-edge', x1: -17, y1: 0, x2: 17, y2: 0});
    const back = svgEl('polygon', {class: 'emitter-back'});
    const face = svgEl('polygon', {class: 'emitter-face'});
    source.append(back, face, edge);
    source.append(svgEl('circle', {class: 'marker-hit', cx: 0, cy: 0, r: 22}));
    source.append(svgEl('circle', {class: 'marker-dot', cx: 0, cy: 0, r: 5}));
    svg.append(source); figure.append(svg); diagrams.append(figure);
    const others=new Map();
    const view={kind,svg,source,aim,back,face,edge,others};views.push(view);
    view.ensureOther=light=>{
      if(others.has(light.id))return others.get(light.id);
      const marker=svgEl('g',{class:'other-source',role:'button',tabindex:'-1','data-light-id':light.id});
      marker.append(svgEl('circle',{r:22,class:'marker-hit'}),svgEl('circle',{r:5,class:'other-dot'}));
      svg.append(marker);others.set(light.id,marker);return marker;
    };
    let gesture=null,lastTap=null;
    const point=event=>{const r=svg.getBoundingClientRect();return [(event.clientX-r.left)*220/r.width,(event.clientY-r.top)*220/r.height];};
    const hits=event=>{
      const [x,y]=point(event),radius=24*220/Math.max(1,svg.getBoundingClientRect().width);
      return session.lights.map(light=>{const [px,py]=pointFor(kind,light.position);return {id:light.id,distance:Math.hypot(px-x,py-y)};})
        .filter(hit=>hit.distance<=radius).sort((a,b)=>a.distance-b.distance);
    };
    const down=event=>{
      if(!enabled||gesture||event.button>0)return;
      const candidates=hits(event);if(!candidates.length)return;
      event.preventDefault();svg.setPointerCapture(event.pointerId);
      const id=candidates[0].id,light=session.lights.find(light=>light.id===id);
      gesture={pointerId:event.pointerId,id,x:event.clientX,y:event.clientY,point:pointFor(kind,light.position),position:[...light.position],dragged:false};
    };
    const move=event=>{
      if(!enabled||!gesture||gesture.pointerId!==event.pointerId)return;
      const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      if(!gesture.dragged&&Math.hypot(dx,dy)<4)return;
      if(!gesture.dragged){gesture.dragged=true;onSessionChange({type:'select',id:gesture.id});}
      const rect=svg.getBoundingClientRect();
      state.position=lightingPlacementPosition(kind,[gesture.point[0]+dx*220/rect.width,gesture.point[1]+dy*220/rect.height],gesture.position);
      notify(kind==='top'?[0,2]:[0,1]);
    };
    const up=event=>{
      if(!gesture||gesture.pointerId!==event.pointerId)return;
      svg.releasePointerCapture?.(event.pointerId);
      if(enabled&&!gesture.dragged&&event.type==='pointerup'){
        const candidates=hits(event).map(hit=>hit.id),now=Date.now();
        const repeated=lastTap&&now-lastTap.time<800&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<12
          &&candidates.length===lastTap.ids.length&&candidates.every(id=>lastTap.ids.includes(id));
        const ids=repeated?lastTap.ids:candidates,index=repeated?(lastTap.index+1)%ids.length:0;
        if(ids.length){onSessionChange({type:'select',id:ids[index]});lastTap={time:now,x:event.clientX,y:event.clientY,ids,index};}
      }
      gesture=null;
    };
    const key=event=>{
      if(!enabled)return;
      const other=event.target.closest('.other-source');
      if(other){
        if(event.key==='Enter'||event.key===' '){event.preventDefault();onSessionChange({type:'select',id:other.dataset.lightId});source.focus();}
        return;
      }
      if(event.target!==source)return;
      const step=event.shiftKey?.25:.1;
      if(event.key==='ArrowLeft')state.position[0]-=step;
      else if(event.key==='ArrowRight')state.position[0]+=step;
      else if(event.key==='ArrowUp')state.position[kind==='top'?2:1]+=kind==='top'?-step:step;
      else if(event.key==='ArrowDown')state.position[kind==='top'?2:1]+=kind==='top'?step:-step;
      else return;
      event.preventDefault();notify(kind==='top'?[0,2]:[0,1]);
    };
    for(const [type,fn]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['keydown',key]]){
      svg.addEventListener(type,fn);listeners.push(()=>svg.removeEventListener(type,fn));
    }
  }
  addView('top', 'Top'); addView('front', 'Front');
  const sizeWrap = document.createElement('label');
  sizeWrap.className = 'placement-size';
  sizeWrap.innerHTML = '<span>Size</span>';
  const size = document.createElement('input'); size.type = 'range'; size.min = LIMITS.width[0]; size.max = LIMITS.width[1]; size.step = '.01'; size.setAttribute('aria-label', 'Light size'); sizeWrap.append(size);
  const sizeInput = () => { if (!enabled) return; state.width = Number(size.value); state.height = state.width * 1.25; notify(); };
  size.addEventListener('input', sizeInput); listeners.push(() => size.removeEventListener('input', sizeInput));
  const powerWrap=document.createElement('div');powerWrap.className='placement-power';
  powerWrap.innerHTML='<div class="power-heading"><label for="light-power">Brightness <output id="power-value">50%</output></label><button type="button" id="light-enabled" aria-pressed="true">On</button></div><input id="light-power" type="range" min="0" max="100" step="1" value="50" aria-label="Light brightness">';
  root.append(powerWrap);
  root.append(sizeWrap);
  const power=powerWrap.querySelector('input'),powerOutput=powerWrap.querySelector('output'),toggle=powerWrap.querySelector('button');
  for(const [el,type,fn]of [[power,'input',()=>onSessionChange({type:'brightness',brightnessPercent:Number(power.value)})],[toggle,'click',()=>onSessionChange({type:'toggle'})]]){
    const handler=()=>{if(enabled)fn();};el.addEventListener(type,handler);listeners.push(()=>el.removeEventListener(type,handler));
  }

  function notify(axes) { state.height = state.width * 1.25; onChange({position: [...state.position], target: [...state.target], width: state.width, height: state.height,axes}); render(); }
  function render() {
    size.value = state.width;
    const selected=session.lights.find(light=>light.id===session.selectedId);
    if(!selected)return;

    settings.querySelector('.placement-light-title').textContent=selected.label;
    settings.querySelector('[data-action="add"]').disabled=!enabled||session.canAdd===false;
    settings.querySelector('[data-action="remove"]').disabled=!enabled||session.canRemove===false;
    power.value=selected.brightnessPercent??50;powerOutput.textContent=`${Math.round(selected.brightnessPercent??50)}%`;
    toggle.textContent=selected.enabled?'On':'Off';toggle.setAttribute('aria-pressed',String(selected.enabled));
    views.forEach(({kind, source, aim, back, face, edge,others,ensureOther}) => {
      const visibleIds=new Set();
      session.lights.filter(light=>light.id!==session.selectedId).forEach(light=>{
        const other=ensureOther(light);visibleIds.add(light.id);const [ox,oy]=pointFor(kind,light.position);
        setAttr(other,'transform',`translate(${ox} ${oy})`);setAttr(other,'aria-label',`Select ${light.label} light in ${kind} view`);setAttr(other,'tabindex',enabled?'0':'-1');other.style.opacity=light.enabled?'1':'.4';
      });
      for(const [id,other] of others)if(!visibleIds.has(id)){other.remove();others.delete(id);}
      const [x, y] = pointFor(kind, state.position); setAttr(source, 'transform', `translate(${x} ${y}) rotate(${kind === 'top' ? 0 : 0})`);
      source.dataset.id=session.selectedId;
      source.style.opacity=selected.enabled?'1':'.4';
      const target = pointFor(kind, state.target); setAttr(aim, 'x1', x); setAttr(aim, 'y1', y); setAttr(aim, 'x2', target[0]); setAttr(aim, 'y2', target[1]);
      const pos = state.position, tgt = state.target;
      let nx = tgt[0] - pos[0], ny = tgt[1] - pos[1], nz = tgt[2] - pos[2];
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      let ux = -nx * ny, uy = 1 - ny * ny, uz = -nz * ny;
      // Match the emitter's stable plane even directly above/below the face;
      // projecting world-up there has zero length and used to collapse the icon.
      if (Math.hypot(ux, uy, uz) < .0001) { ux = 1 - nx * nx; uy = -ny * nx; uz = -nz * nx; }
      const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
      const rx = uy * nz - uz * ny, ry = uz * nx - ux * nz, rz = ux * ny - uy * nx;
      const corners = (offset) => [[-1,-1], [1,-1], [1,1], [-1,1]].map(([a,b]) => {
        const px = pos[0] + rx * state.width * a / 2 + ux * state.height * b / 2 + nx * offset;
        const py = pos[1] + ry * state.width * a / 2 + uy * state.height * b / 2 + ny * offset;
        const pz = pos[2] + rz * state.width * a / 2 + uz * state.height * b / 2 + nz * offset;
        return pointFor(kind, [px, py, pz]);
      });
      const backPoints = corners(-.10), front = corners(0);
      setAttr(back, 'points', backPoints.map(([px, py]) => `${px - x},${py - y}`).join(' '));
      setAttr(face, 'points', front.map(([px, py]) => `${px - x},${py - y}`).join(' '));
      setAttr(edge, 'x1', front[2][0] - x); setAttr(edge, 'y1', front[2][1] - y); setAttr(edge, 'x2', front[3][0] - x); setAttr(edge, 'y2', front[3][1] - y);
      setAttr(source, 'aria-valuenow', state.position[0].toFixed(2));
      setAttr(source, 'aria-valuemin', -LIMITS.x); setAttr(source, 'aria-valuemax', LIMITS.x);
      setAttr(source, 'aria-valuetext', kind === 'top' ? `X ${state.position[0].toFixed(2)}, Z ${state.position[2].toFixed(2)}` : `X ${state.position[0].toFixed(2)}, Y ${state.position[1].toFixed(2)}`);
    });
  }
  render();
  const resize=new ResizeObserver(()=>views.forEach(({svg,source})=>{
    source.querySelector('.marker-hit').setAttribute('r',22*220/Math.max(1,svg.clientWidth));
  }));
  views.forEach(({svg})=>resize.observe(svg));
  // Build inert so the host can opt in when its scene is ready.
  for(const control of root.querySelectorAll('button,input,select'))control.disabled=true;
  views.forEach(({source}) => { source.setAttribute('aria-disabled', 'true'); source.setAttribute('tabindex', '-1'); });
  return {
    setState(next) { Object.assign(state, cleanState(next)); render(); },
    setSession(next) { session=next;render(); },
    setEnabled(value) {
      enabled = Boolean(value); root.classList.toggle('is-disabled', !enabled); size.disabled = !enabled;
      for(const control of root.querySelectorAll('button,input,select'))control.disabled=!enabled;
      const current=session;
      if(enabled){
        root.querySelector('[data-action="add"]').disabled=current.canAdd===false;
        root.querySelector('[data-action="remove"]').disabled=current.canRemove===false;
      }
      views.forEach(({others})=>{for(const other of others.values())other.setAttribute('tabindex',enabled?'0':'-1');});
      views.forEach(({source}) => { source.setAttribute('aria-disabled', String(!enabled)); source.setAttribute('tabindex', enabled ? '0' : '-1'); });
    },
    dispose() { resize.disconnect();listeners.splice(0).forEach(remove => remove()); root.innerHTML = ''; root.classList.remove('placement-controls', 'is-disabled'); },
  };
}
