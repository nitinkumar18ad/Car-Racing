/**
 * Scenery, sky and lighting.
 *
 * Two performance rules shape this file:
 *
 * - Roadside objects are `InstancedMesh`, so hundreds of trees and markers cost
 *   a handful of draw calls rather than hundreds.
 * - The directional light's shadow frustum is kept small and moved to follow the
 *   car each frame. A tight ortho box over 2048px gives crisp shadows near the
 *   car; a box big enough to cover the whole circuit would need a 16k map to
 *   look the same.
 */

import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry,
  DirectionalLight, DoubleSide, FogExp2, Group, HemisphereLight, IcosahedronGeometry,
  InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three';

import { TRACK, WORLD } from './config.js';
import {
  createBarkTexture, createFoliageTexture, createGantryBannerTexture, createSkyTexture,
} from './textures.js';

/** Deterministic RNG so the scenery is laid out identically on every load. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 0xffffffff;
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Sky
   ══════════════════════════════════════════════════════════════════════════ */

export function createSky() {
  // Rendered on the inside of a big sphere. `depthWrite: false` keeps it from
  // occluding anything despite being drawn first.
  const sky = new Mesh(
    new SphereGeometry(1100, 40, 24),
    new MeshBasicMaterial({
      map: createSkyTexture(),
      side: BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.name = 'sky';
  sky.frustumCulled = false;
  return sky;
}

/* ══════════════════════════════════════════════════════════════════════════
   Lighting
   ══════════════════════════════════════════════════════════════════════════ */

export function createLighting(scene) {
  scene.fog = new FogExp2(WORLD.horizonColor, WORLD.fogDensity);

  const hemisphere = new HemisphereLight(
    WORLD.horizonColor, WORLD.groundColor, WORLD.hemiIntensity,
  );
  scene.add(hemisphere);

  const sun = new DirectionalLight(0xfff3dc, WORLD.sunIntensity);
  sun.position.set(...WORLD.sunPosition);
  sun.castShadow = true;

  const radius = WORLD.shadowRadius;
  sun.shadow.mapSize.set(WORLD.shadowMapSize, WORLD.shadowMapSize);
  sun.shadow.camera.left = -radius;
  sun.shadow.camera.right = radius;
  sun.shadow.camera.top = radius;
  sun.shadow.camera.bottom = -radius;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 520;
  // Just enough bias to kill acne on the near-flat road without detaching the
  // car's shadow from its wheels.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.028;

  scene.add(sun);
  // A DirectionalLight aims at its target, which must be in the scene graph for
  // its matrix to update.
  scene.add(sun.target);

  return { sun, hemisphere };
}

/**
 * Slide the shadow frustum along with the car.
 *
 * The light keeps its direction (so shadows never swing around); only the
 * position and target move. Snapping to a grid the size of one shadow texel
 * stops the shadow edges from shimmering as the box slides.
 */
const SUN_DIRECTION = new Vector3();
export function updateShadowFrustum(sun, focus) {
  SUN_DIRECTION.set(...WORLD.sunPosition).normalize();

  const texelSize = (WORLD.shadowRadius * 2) / WORLD.shadowMapSize;
  const snap = (value) => Math.round(value / texelSize) * texelSize;

  sun.target.position.set(snap(focus.x), snap(focus.y), snap(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, 260);
}

/* ══════════════════════════════════════════════════════════════════════════
   Trees
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Concatenate several indexed geometries into one.
 *
 * An `InstancedMesh` draws a single geometry, so a tree whose trunk forks into
 * branches has to have those merged up front rather than parented together —
 * otherwise every extra piece costs another draw call multiplied by 460
 * instances. three.js ships `mergeGeometries` in its addons, which aren't
 * vendored here, and the indexed case is short enough to just do.
 */
function mergeGeometries(geometries) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of geometries) {
    position.set(geometry.attributes.position.array, vertexOffset * 3);
    if (geometry.attributes.normal) {
      normal.set(geometry.attributes.normal.array, vertexOffset * 3);
    }
    if (geometry.attributes.uv) {
      uv.set(geometry.attributes.uv.array, vertexOffset * 2);
    }

    if (geometry.index) {
      const source = geometry.index.array;
      for (let i = 0; i < source.length; i++) index[indexOffset + i] = source[i] + vertexOffset;
      indexOffset += source.length;
    } else {
      const count = geometry.attributes.position.count;
      for (let i = 0; i < count; i++) index[indexOffset + i] = i + vertexOffset;
      indexOffset += count;
    }

    vertexOffset += geometry.attributes.position.count;
    geometry.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('uv', new BufferAttribute(uv, 2));
  merged.setIndex(new BufferAttribute(index, 1));
  return merged;
}

/** Realistic tapered trunk with root flare and organic branches. */
function buildTrunkGeometry() {
  const parts = [];

  // Root flare at ground
  const root = new CylinderGeometry(0.32, 0.54, 1.2, 10);
  root.translate(0, 0.6, 0);
  parts.push(root);

  // Main trunk body
  const trunk = new CylinderGeometry(0.20, 0.34, 3.0, 10);
  trunk.translate(0, 2.4, 0);
  parts.push(trunk);

  // Organic branches reaching into canopy clusters
  const branchDefs = [
    { radius: 0.14, len: 2.3, rotZ: 0.54, rotY: 0.4, pos: [0, 3.2, 0] },
    { radius: 0.14, len: 2.5, rotZ: 0.56, rotY: 2.3, pos: [0, 3.4, 0] },
    { radius: 0.13, len: 2.2, rotZ: 0.50, rotY: 4.2, pos: [0, 3.5, 0] },
    { radius: 0.12, len: 1.9, rotZ: 0.22, rotY: 1.2, pos: [0, 4.2, 0] },
  ];

  for (const b of branchDefs) {
    const branch = new CylinderGeometry(b.radius * 0.5, b.radius, b.len, 8);
    branch.translate(0, b.len / 2, 0);
    branch.rotateZ(b.rotZ);
    branch.rotateY(b.rotY);
    branch.translate(...b.pos);
    parts.push(branch);
  }

  return mergeGeometries(parts);
}

/**
 * Realistic layered foliage canopy with volumetric leaf cards and spherical normal transfer.
 */
function buildCanopyGeometry() {
  const parts = [];

  // 7 cluster centers that shape an organic, majestic crown
  const clusters = [
    { pos: [0, 5.8, 0], radius: 2.6 },
    { pos: [-1.4, 4.9, -0.9], radius: 2.2 },
    { pos: [1.4, 4.9, -0.8], radius: 2.2 },
    { pos: [-1.3, 4.7, 1.1], radius: 2.2 },
    { pos: [1.3, 4.7, 1.1], radius: 2.2 },
    { pos: [-1.8, 3.8, 0.1], radius: 2.0 },
    { pos: [1.8, 3.8, 0.0], radius: 2.0 },
  ];

  for (const cluster of clusters) {
    const [cx, cy, cz] = cluster.pos;
    const r = cluster.radius;

    // Cross-quad leaf cards rotated around Y
    for (let a = 0; a < 3; a++) {
      const plane = new PlaneGeometry(r * 1.9, r * 1.6);
      plane.rotateY((a / 3) * Math.PI + a * 0.15);
      plane.translate(cx, cy, cz);
      parts.push(plane);
    }

    // Horizontal tilted leaf card for top/bottom canopy depth
    const cap = new PlaneGeometry(r * 1.8, r * 1.8);
    cap.rotateX(Math.PI / 2);
    cap.rotateZ(0.6);
    cap.translate(cx, cy, cz);
    parts.push(cap);

    // Inner foliage cloud for density
    const ico = new SphereGeometry(r * 0.78, 8, 6);
    ico.translate(cx, cy, cz);
    parts.push(ico);
  }

  const merged = mergeGeometries(parts);

  // Spherical normal transfer: normals radiate outward from tree crown center (0, 4.8, 0)
  // This gives the tree canopy luscious, continuous, 3D volumetric shading like AAA games.
  const pos = merged.attributes.position;
  const norm = merged.attributes.normal;
  const crownCenter = new Vector3(0, 4.8, 0);
  const dir = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(crownCenter).normalize();
    norm.setXYZ(i, dir.x, dir.y, dir.z);
  }

  return merged;
}

/* ══════════════════════════════════════════════════════════════════════════
   Roadside scenery
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Trees and distance markers, placed by walking the track's sample table and
 * stepping sideways from the centreline.
 *
 * Trees sit beyond the barrier with randomised distance, height and lean.
 * Markers sit just outside the kerb at regular intervals, which is what
 * actually sells the sense of speed at 250 km/h.
 */
export function createScenery(track) {
  const group = new Group();
  group.name = 'scenery';

  const random = makeRandom(0x7a3e91);
  const samples = track.samples;
  const barrier = track.wallLateral;

  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const quaternion = new Quaternion();
  const noRotation = new Quaternion();

  /* ── Trees ──────────────────────────────────────────────────────────── */

  const trunks = new InstancedMesh(
    buildTrunkGeometry(),
    new MeshStandardMaterial({
      map: createBarkTexture(),
      roughness: 0.88,
      metalness: 0.04,
    }),
    WORLD.treeCount,
  );
  const foliage = new InstancedMesh(
    buildCanopyGeometry(),
    new MeshStandardMaterial({
      map: createFoliageTexture(),
      alphaTest: 0.35,
      roughness: 0.74,
      metalness: 0.05,
      side: DoubleSide,
      shadowSide: DoubleSide,
    }),
    WORLD.treeCount,
  );
  foliage.instanceColor = new InstancedBufferAttribute(new Float32Array(WORLD.treeCount * 3), 3);
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  trunks.name = 'tree-trunks';
  foliage.name = 'tree-foliage';

  const leafPalette = [
    new Color(0x326922),
    new Color(0x43852b),
    new Color(0x569a35),
    new Color(0x3a7527),
    new Color(0x62a33c),
    new Color(0x2d5f1f),
  ];

  for (let i = 0; i < WORLD.treeCount; i++) {
    const sample = samples[(random() * samples.length) | 0];
    const side = random() < 0.5 ? -1 : 1;
    // Well clear of the barrier, scattered out into the verge.
    const lateral = side * (barrier + 6 + random() * (TRACK.vergeWidth - 12));
    const height = 0.85 + random() * 0.95;

    track.groundPoint(sample, lateral, position);
    scale.set(height * (0.9 + random() * 0.25), height, height * (0.9 + random() * 0.25));
    // A few degrees of lean, so the rows don't look stamped.
    quaternion.setFromAxisAngle(
      new Vector3(random() - 0.5, 0, random() - 0.5).normalize(),
      (random() - 0.5) * 0.08,
    );

    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);
    foliage.setMatrixAt(i, matrix);

    const col = leafPalette[(random() * leafPalette.length) | 0];
    foliage.setColorAt(i, col);
  }
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  group.add(trunks, foliage);

  /* ── Distance markers ───────────────────────────────────────────────── */

  const markerCount = Math.floor(track.length / WORLD.markerSpacing) * 2;
  const markerGeometry = new BoxGeometry(0.14, 1.05, 0.5);
  markerGeometry.translate(0, 0.52, 0);
  const markers = new InstancedMesh(
    markerGeometry,
    new MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.7, metalness: 0.05 }),
    markerCount,
  );
  markers.castShadow = true;
  markers.name = 'markers';

  const markerLateral = TRACK.roadHalfWidth + TRACK.kerbWidth + 1.1;
  let written = 0;
  for (let distance = 0; distance < track.length && written + 1 < markerCount; distance += WORLD.markerSpacing) {
    const sample = samples[Math.min(samples.length - 1, Math.round(distance / track.spacing))];
    for (const side of [-1, 1]) {
      track.groundPoint(sample, side * markerLateral, position);
      // Face along the track so the thin edge is what you see approaching.
      quaternion.setFromUnitVectors(FORWARD_Z, sample.tangent);
      matrix.compose(position, quaternion, ONE);
      markers.setMatrixAt(written++, matrix);
    }
  }
  // Any unwritten instances default to an identity matrix at the origin, which
  // would stack a pile of markers on the start line. Hide the remainder.
  for (let i = written; i < markerCount; i++) {
    matrix.compose(HIDDEN, noRotation, ONE);
    markers.setMatrixAt(i, matrix);
  }
  markers.instanceMatrix.needsUpdate = true;
  group.add(markers);

  /* ── Start/finish gantry ────────────────────────────────────────────── */

  if (track.closed) {
    group.add(createMotorsportGantry({
      track,
      sampleIndex: 0,
      title: 'START / FINISH',
      subtitle: 'APEX GRAND PRIX CIRCUIT',
      isFinish: false,
    }));
  } else {
    group.add(createMotorsportGantry({
      track,
      sampleIndex: track.timingStartIndex,
      title: 'START',
      subtitle: 'POINT-TO-POINT SPRINT',
      isFinish: false,
    }));
    group.add(createMotorsportGantry({
      track,
      sampleIndex: track.timingFinishIndex,
      title: 'FINISH',
      subtitle: 'SPEED TRAP TIMING',
      isFinish: true,
    }));
  }

  return group;
}

const FORWARD_Z = new Vector3(0, 0, 1);
const ONE = new Vector3(1, 1, 1);
const HIDDEN = new Vector3(0, -9999, 0);

/**
 * Grand motorsport gantry with dual steel lattice columns, overhead crossbeam truss,
 * double-sided textured racing banner, and 5-pod start light cluster.
 */
function createMotorsportGantry({ track, sampleIndex, title, subtitle, isFinish = false }) {
  const gantry = new Group();
  gantry.name = isFinish ? 'finish-gantry' : 'start-gantry';

  const safeIndex = Math.max(0, Math.min(track.samples.length - 1, sampleIndex));
  const sample = track.samples[safeIndex];
  const halfWidth = TRACK.roadHalfWidth + TRACK.kerbWidth + 2.4;
  const postHeight = 8.8;

  const steel = new MeshStandardMaterial({ color: 0xb4bcc7, roughness: 0.35, metalness: 0.85 });
  const darkSteel = new MeshStandardMaterial({ color: 0x242830, roughness: 0.5, metalness: 0.7 });
  const bannerMat = new MeshStandardMaterial({
    map: createGantryBannerTexture({ title, subtitle, isFinish }),
    roughness: 0.4,
    metalness: 0.2,
    side: DoubleSide,
  });
  const lightHousing = new MeshStandardMaterial({ color: 0x111317, roughness: 0.7, metalness: 0.3 });
  const lightLamp = new MeshStandardMaterial({
    color: isFinish ? 0x22ff88 : 0xff1e40,
    emissive: isFinish ? 0x11dd66 : 0xff1030,
    emissiveIntensity: 1.6,
    roughness: 0.2,
  });

  // Calculate rotation across track:
  const acrossAngle = Math.atan2(sample.right.x, sample.right.z) - Math.PI / 2;

  // Dual lattice columns on each side of the track
  const postGeom = new CylinderGeometry(0.24, 0.32, postHeight, 10);
  postGeom.translate(0, postHeight / 2, 0);

  const subPostGeom = new CylinderGeometry(0.16, 0.20, postHeight, 8);
  subPostGeom.translate(0, postHeight / 2, 0);

  const posA = new Vector3();
  const posB = new Vector3();
  for (const side of [-1, 1]) {
    const colA = new Mesh(postGeom, steel);
    track.groundPoint(sample, side * halfWidth, posA);
    colA.position.copy(posA);
    colA.castShadow = true;

    const colB = new Mesh(subPostGeom, darkSteel);
    track.groundPoint(sample, side * (halfWidth - 0.7), posB);
    colB.position.copy(posB);
    colB.castShadow = true;

    gantry.add(colA, colB);
  }

  // Cross beam truss: upper and lower rails
  const span = halfWidth * 2;
  const topRail = new Mesh(new BoxGeometry(span, 0.34, 0.42), steel);
  topRail.position.copy(sample.position);
  topRail.position.y += postHeight - 0.15;
  topRail.rotation.y = acrossAngle;
  topRail.castShadow = true;

  const bottomRail = new Mesh(new BoxGeometry(span, 0.24, 0.36), darkSteel);
  bottomRail.position.copy(sample.position);
  bottomRail.position.y += postHeight - 1.85;
  bottomRail.rotation.y = acrossAngle;
  bottomRail.castShadow = true;

  // High-res double-sided banner board
  const signWidth = span * 0.72;
  const signHeight = 1.45;
  const sign = new Mesh(new BoxGeometry(signWidth, signHeight, 0.14), bannerMat);
  sign.position.copy(sample.position);
  sign.position.y += postHeight - 1.0;
  sign.rotation.y = acrossAngle;
  sign.castShadow = true;

  // 5 Start / Finish lights mounted below the banner
  const lightBar = new Group();
  lightBar.position.copy(sample.position);
  lightBar.position.y += postHeight - 2.15;
  lightBar.rotation.y = acrossAngle;

  const housingGeom = new BoxGeometry(0.55, 0.55, 0.28);
  const podGeom = new CylinderGeometry(0.20, 0.20, 0.12, 14);
  podGeom.rotateX(Math.PI / 2);

  const lightCount = 5;
  const spacing = 0.85;
  for (let k = 0; k < lightCount; k++) {
    const xOff = (k - (lightCount - 1) / 2) * spacing;
    const housing = new Mesh(housingGeom, lightHousing);
    housing.position.set(xOff, 0, 0);
    const lampFront = new Mesh(podGeom, lightLamp);
    lampFront.position.set(xOff, 0, 0.14);
    const lampBack = new Mesh(podGeom, lightLamp);
    lampBack.position.set(xOff, 0, -0.14);
    lightBar.add(housing, lampFront, lampBack);
  }

  gantry.add(topRail, bottomRail, sign, lightBar);
  return gantry;
}
