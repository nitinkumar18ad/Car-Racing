/**
 * Bootstrap: renderer, scene, resize handling and the requestAnimationFrame
 * loop. Everything else lives in its own module; this file only wires them
 * together.
 */

import {
  PerspectiveCamera, Scene, WebGLRenderer, ACESFilmicToneMapping, PCFShadowMap,
  Vector3,
} from 'three';

import { CAMERA, MODES, RENDER } from './config.js';
import { Track } from './track.js';
import { Car } from './car.js';
import { ChaseCamera } from './chase-camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { createLighting, createScenery, createSky, updateShadowFrustum } from './scenery.js';
import { loadModelAssets } from './models.js';

const MODE_STORAGE_KEY = 'car-racing-game:mode';

function readModeId() {
  const urlMode = new URLSearchParams(window.location.search).get('mode');
  const storedMode = (() => {
    try { return window.localStorage.getItem(MODE_STORAGE_KEY); } catch { return null; }
  })();
  const mode = urlMode || storedMode;
  return mode === MODES.timeLap.id ? MODES.timeLap.id : MODES.circuit.id;
}

function switchMode(currentModeId) {
  const nextModeId = currentModeId === MODES.timeLap.id ? MODES.circuit.id : MODES.timeLap.id;
  try { window.localStorage.setItem(MODE_STORAGE_KEY, nextModeId); } catch { /* Non-fatal. */ }

  const url = new URL(window.location.href);
  url.searchParams.set('mode', nextModeId);
  window.location.href = url.toString();
}

function start() {
  const canvas = document.getElementById('scene');
  const modeId = readModeId();

  /* ── Renderer ──────────────────────────────────────────────────────────
     Construction throws if WebGL is unavailable, which is the one startup
     failure worth reporting properly rather than leaving a black screen. */
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    showFatal('This browser could not create a WebGL context. Try updating it, or '
      + 'enabling hardware acceleration in its settings.');
    console.error(error);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was deprecated in r185 and silently falls back to this.
  renderer.shadowMap.type = PCFShadowMap;

  /* ── Scene ─────────────────────────────────────────────────────────── */

  const scene = new Scene();
  const camera = new PerspectiveCamera(
    CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far,
  );

  const sky = createSky();
  scene.add(sky);

  const { sun } = createLighting(scene);

  const track = new Track(modeId);
  scene.add(track.group);
  const scenery = createScenery(track);
  scene.add(scenery);

  const car = new Car(track);
  scene.add(car.mesh);

  const chaseCamera = new ChaseCamera(camera);
  const input = new Input(window);
  const hud = new Hud(track);
  const game = new Game({
    track,
    car,
    camera: chaseCamera,
    hud,
    input,
    onModeChange: () => switchMode(track.mode.id),
  });

  hud.elements.modeButton?.addEventListener('click', () => switchMode(track.mode.id));

  // Load realistic 3D car model, then dismiss loading overlay
  loadModelAssets(track, car, scenery).finally(() => {
    hud.hideLoading();
  });

  /* ── Resize ────────────────────────────────────────────────────────── */

  const onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
    renderer.setSize(width, height, false);
  };
  window.addEventListener('resize', onResize);
  onResize();

  /* ── Loop ──────────────────────────────────────────────────────────── */

  const skyAnchor = new Vector3();
  let previousTime = performance.now();

  function frame(now) {
    const frameTime = (now - previousTime) / 1000;
    previousTime = now;

    game.update(frameTime);

    // Keep the sky centred on the camera so its horizon never slides past, and
    // move the shadow box with the car so its 2048px map is spent where it
    // shows.
    skyAnchor.copy(camera.position);
    sky.position.set(skyAnchor.x, 0, skyAnchor.z);
    updateShadowFrustum(sun, car.position);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  // Handy for poking at state from the console while tuning.
  window.game = { game, car, track, scene, renderer, camera, chaseCamera };
}

function showFatal(message) {
  document.getElementById('loading')?.classList.add('hidden');
  const fatal = document.getElementById('fatal');
  const text = document.getElementById('fatal-message');
  if (text) text.textContent = message;
  fatal?.classList.remove('hidden');
}

try {
  start();
} catch (error) {
  // Anything thrown during setup would otherwise leave the loading screen up
  // forever with no explanation.
  showFatal(`${error.message}  —  see the browser console for details.`);
  throw error;
}
