// The flat-ink kit for the tool benches (darkroom, view camera, sync strip):
// faces filled with a role colour, outlines in ink, nothing shaded. Colours are
// the page theme's roles, so a theme message recolours every material.
import * as THREE from 'three';

export const ROLES = Object.freeze(['paper', 'ink', 'accent', 'warm', 'sensor', 'muted', 'line']);

export function createKit(colors) {
  const palette = { ...colors };
  const mats = [];
  const hexOf = role => palette[role] ?? '#888888';
  function material(kind, role, opacity = 1) {
    const base = { transparent: opacity < 1, opacity };
    const m = kind === 'line'
      ? new THREE.LineBasicMaterial(base)
      : new THREE.MeshBasicMaterial({ ...base, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    m.userData.role = role;
    m.color.set(hexOf(role));
    mats.push(m);
    return m;
  }
  // A filled solid with an ink outline.
  function solid(geometry, { fill = 'paper', edge = 'ink', opacity = 1 } = {}) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, material('fill', fill, opacity));
    group.add(mesh);
    group.userData.mesh = mesh;
    if (edge) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), material('line', edge, opacity));
      group.add(lines);
      group.userData.edge = lines;
    }
    return group;
  }
  const box = (w, h, d, o) => solid(new THREE.BoxGeometry(w, h, d), o);
  const cylinder = (rTop, rBottom, h, o, segments = 28) => solid(new THREE.CylinderGeometry(rTop, rBottom, h, segments), o);
  const rect = (w, h, o) => solid(new THREE.PlaneGeometry(w, h), o);
  // A polygon from [x, y] points, filled and outlined.
  function polygon(points, o) {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    return solid(new THREE.ShapeGeometry(shape), o);
  }
  function line(points, role = 'ink', opacity = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    return new THREE.Line(geometry, material('line', role, opacity));
  }
  function setOpacity(group, opacity) {
    group.traverse(o => {
      if (!o.material) return;
      o.material.opacity = opacity;
      o.material.transparent = opacity < 1;
    });
  }
  function setFill(group, role) {
    const m = group.userData.mesh?.material;
    if (!m) return;
    m.userData.role = role;
    m.color.set(hexOf(role));
  }
  function setColors(next) {
    Object.assign(palette, next);
    for (const m of mats) m.color.set(hexOf(m.userData.role));
  }
  return { THREE, palette, hexOf, material, solid, box, cylinder, rect, polygon, line, setOpacity, setFill, setColors };
}
