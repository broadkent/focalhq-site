// Model catalog and URL resolution; no Three.js imports so node tests can load it.
/** Untextured study mesh: Vitruvian by Sean Buckley & Olaf Delgado-Friedrichs, CC0.
 * See models/README.md. Geometry, rather than painted shading, supplies the
 * nose/cheek shadows. Portrait-pattern assessments still need author review.
 */
// The Vitruvian head is one merged mesh with no eye nodes, so its eye landmarks are authored:
// the visible eyes' sideways positions (bust units), measured on a render at the fit and at the
// closest dolly (October 13, 2026: the old pair, -0.05 and 0.25, put the left one by the nose
// bridge, so centering the eye line left the face 12% of the width off center up close).
export const VITRUVIAN_EYE_X = [-.29,.27];
export const BUST_MODELS = [
  {id:'vitruvian',label:'Vitruvian study',file:'vitruvian-study.9b8d19edf7.glb'},
  {id:'young-woman',label:'Young woman',file:'young-woman.3dc57b9585.glb'},
  {id:'young-man',label:'Young man',file:'young-man.3d962b95c5.glb'},
];
/** Pilot GLBs are 81 MB and live on the review Hosting site (hosting/review/),
 * not in the app bundle. Tests point this at a local server with
 * `globalThis.FOCAL_PILOT_MODEL_BASE`. */
export const PILOT_MODEL_BASE = 'https://focal-507819-review.web.app/teaching3d/models/';
export function modelUrl(model){
  const base=model.pilot===true?(globalThis.FOCAL_PILOT_MODEL_BASE||PILOT_MODEL_BASE):new URL('./models/',import.meta.url).href;
  return new URL(model.file,base).href;
}
export const FACE_PILOT_MODEL = {
  id:'young-woman-skin-pilot',label:'Young woman (skin pilot)',file:'face-pilot/young-woman.glb',pilot:true,
};
export const STYLED_FACE_PILOT_MODEL = {
  id:'young-woman-styled-pilot',label:'Young woman (styled pilot)',file:'face-pilot/young-woman-styled.glb',pilot:true,
};
export const PONYTAIL_FACE_PILOT_MODEL = {
  id:'young-woman-ponytail-pilot',label:'Young woman (ponytail)',file:'face-pilot/young-woman-ponytail.glb',pilot:true,
};
export const VICTORIAN_FACE_PILOT_MODEL = {
  id:'young-woman-victorian-pilot',label:'Young woman (sculpted curls)',file:'face-pilot/young-woman-victorian.glb',pilot:true,
};
export const SHORT_CURLS_FACE_PILOT_MODEL = {
  id:'young-woman-short-curls-pilot',label:'Young woman (short curls)',file:'face-pilot/young-woman-short-curls.glb',pilot:true,
};
export const MESSY_BUN_FACE_PILOT_MODEL = {
  id:'young-woman-messy-bun-pilot',label:'Young woman (messy bun)',file:'face-pilot/young-woman-messy-bun.glb',pilot:true,
};
export const FACE_PILOT_MODELS = [FACE_PILOT_MODEL,STYLED_FACE_PILOT_MODEL,PONYTAIL_FACE_PILOT_MODEL,VICTORIAN_FACE_PILOT_MODEL,SHORT_CURLS_FACE_PILOT_MODEL,MESSY_BUN_FACE_PILOT_MODEL];

