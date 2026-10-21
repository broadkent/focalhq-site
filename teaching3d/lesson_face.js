// Published face geometry for the Studio lessons (lesson=1): where the face, nose and
// shadow edge fall in the canvas, measured from the eye landmarks and the camera, so Flutter
// callouts and outlines anchor to rects and never to photo fractions (the iris precedent).
// Proportions are an adult face's, in units of the eye separation (ipd). They are anchors
// for a callout, not a mesh measurement; the rects follow the camera and the lamp.
//
// `project(world [x,y,z]) -> {x, y}` gives canvas fractions (0..1, y down).
// Every rect is {left, top, width, height} in canvas fractions.
const FACE = {half: 1.15, top: 1.03, bottom: -1.83};   // hairline to chin, either cheek (ipd)
const NOSE = {half: .28, top: -.1, bottom: -.75};      // bridge to tip
const CHEEK = {near: .45, far: 1.1, top: -.5, bottom: -1.4};
const DEPTH = .25;                                       // the face surface, in front of the eye centers

export function rectOf(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs), top = Math.min(...ys);
  return {left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top};
}

export function faceGeometry({eyes, lampPosition, project}) {
  if (!Array.isArray(eyes) || eyes.length < 2) return null;
  const [a, b] = [...eyes].sort((p, q) => p[0] - q[0]);
  const ipd = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (!(ipd > 1e-6)) return null;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + DEPTH * ipd];
  const at = (dx, dy) => project([mid[0] + dx * ipd, mid[1] + dy * ipd, mid[2]]);
  const box = (x0, x1, y0, y1) => rectOf([at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]);
  // The shadow falls away from the lamp: +1 when the lamp is on the viewer's right of the face.
  const lampX = lampPosition?.[0] ?? mid[0];
  const side = Math.abs(lampX - mid[0]) < .15 * ipd ? 0 : Math.sign(lampX - mid[0]);
  const shadow = -side || 0;                  // which cheek is in shadow: -1 left, +1 right, 0 under the nose
  const cheek = shadow === 0
    ? box(-CHEEK.near, CHEEK.near, CHEEK.bottom, CHEEK.top)
    : box(...[shadow * CHEEK.near, shadow * CHEEK.far].sort((p, q) => p - q), CHEEK.bottom, CHEEK.top);
  const anchorAt = shadow === 0 ? at(0, NOSE.bottom - .25) : at(shadow * NOSE.half * 1.6, NOSE.bottom - .1);
  return {
    faceRect: box(-FACE.half, FACE.half, FACE.bottom, FACE.top),
    noseRect: box(-NOSE.half, NOSE.half, NOSE.bottom, NOSE.top),
    cheekRect: cheek,
    shadowEdgeAnchor: {x: anchorAt.x, y: anchorAt.y},
    shadowSide: shadow === 0 ? 'under' : shadow < 0 ? 'left' : 'right',
  };
}
