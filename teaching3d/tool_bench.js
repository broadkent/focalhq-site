// The tool bench: one flat-ink scene host for the Lab tools built on the 3D
// teaching camera look (darkroom bench, view camera, sync strip). The page
// takes `?tool=darkroom|view-camera|sync-strip`, the theme tokens the camera
// scene takes, and the same host bridge commands: `mode`, `param`, `replay`.
import * as THREE from 'three';
import { createHostBridge } from './host_bridge.js';
import { createKit } from './bench_ink.js';

const query = new URLSearchParams(location.search);
const tool = query.get('tool') || 'darkroom';
const FILES = { darkroom: './darkroom.js', 'view-camera': './view_camera.js', 'sync-strip': './sync_strip.js' };

const hex = key => (/^[0-9a-f]{6}$/i.test(query.get(key) ?? '') ? '#' + query.get(key) : null);
const themeColors = () => ({
  bg: hex('bg') ?? '#f5f5f4', paper: hex('bg') ?? '#f5f5f4', ink: hex('fg') ?? '#333735',
  accent: hex('info') ?? '#406b83', warm: hex('warm') ?? '#c49a2a', sensor: hex('sensor') ?? '#2a506f',
  muted: hex('muted') ?? '#7b807e', line: hex('line') ?? '#d9ddda',
});

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, .1, 100);
const kit = createKit(themeColors());
const applyBackground = () => {
  scene.background = new THREE.Color(kit.palette.bg);
  document.documentElement.style.setProperty('--bg', kit.palette.bg);
  document.documentElement.style.setProperty('--fg', kit.palette.ink);
};
applyBackground();

const module = await import(FILES[tool]);
const bench = module.create(kit, { renderer, query, glass: document.getElementById('glass') });
scene.add(bench.group);

let size = { w: 1, h: 1 };
const look = new THREE.Vector3(), lookTarget = new THREE.Vector3();
const dirNow = new THREE.Vector3(), dirTarget = new THREE.Vector3();
let distNow = 8, distTarget = 8, posed = false;

function fitPose() {
  const pose = bench.pose();
  lookTarget.set(...pose.look);
  dirTarget.set(...pose.dir).normalize();
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  distTarget = Math.max(pose.halfHeight / t, pose.halfWidth / (t * camera.aspect));
  if (!posed) { look.copy(lookTarget); dirNow.copy(dirTarget); distNow = distTarget; posed = true; }
}

function resize() {
  size = { w: Math.max(1, innerWidth), h: Math.max(1, innerHeight) };
  renderer.setSize(size.w, size.h, false);
  camera.aspect = size.w / size.h;
  camera.updateProjectionMatrix();
  fitPose();
}
addEventListener('resize', () => { resize(); wake(); });
resize();

const getState = () => ({ ready: true, tool, ...bench.state(), stage: { w: size.w, h: size.h } });
const bridge = createHostBridge({
  kind: 'camera',
  getState,
  onCommand: ({ action, value }) => {
    if (action === 'mode') bench.setMode(String(value));
    else if (action === 'param' && value && typeof value === 'object') bench.set(String(value.name), Number(value.value));
    else if (action === 'replay') bench.replay?.();
    else if (action === 'pause') return false;
    fitPose();
    wake();
  },
  onTheme: tokens => {
    const pick = key => (/^[0-9a-f]{6}$/i.test(tokens[key] ?? '') ? '#' + tokens[key] : null);
    const next = {};
    const map = { bg: 'bg', fg: 'ink', info: 'accent', warm: 'warm', sensor: 'sensor', muted: 'muted', line: 'line' };
    for (const [from, to] of Object.entries(map)) if (pick(from)) next[to] = pick(from);
    if (next.bg) next.paper = next.bg;
    kit.setColors(next);
    applyBackground();
    bench.recolour?.();
    wake();
  },
});

// Render on change only: any command, theme, resize or a pointer wakes the loop for IDLE_MS (the longest
// animation, the darkroom print, is 4 s), then it stops until the next one.
const IDLE_MS = 6000;
let last = performance.now(), published = '', awakeUntil = 0, running = false;
function wake() {
  awakeUntil = performance.now() + IDLE_MS;
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}
function frame(now) {
  if (now > awakeUntil) { running = false; return; }
  const dt = Math.min(.1, (now - last) / 1000);
  last = now;
  bench.update(dt, now / 1000);
  const k = 1 - Math.exp(-dt * 6);
  look.lerp(lookTarget, k);
  dirNow.lerp(dirTarget, k);
  distNow += (distTarget - distNow) * k;
  camera.position.copy(look).addScaledVector(dirNow.clone().normalize(), distNow);
  camera.lookAt(look);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.w, size.h);
  renderer.render(scene, camera);
  bench.afterRender?.(renderer, size);
  const json = JSON.stringify(bench.state());
  if (json !== published) { published = json; bridge.publish(); }
  requestAnimationFrame(frame);
}
wake();
bridge.publish();
