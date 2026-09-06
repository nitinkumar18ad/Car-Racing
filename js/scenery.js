/**
 * Scenery, sky, lighting, roadside flora, grandstands and safety barriers.
 *
 * Performance guidelines:
 * - Roadside objects (trees, bushes, markers, tire walls, sponsor boards) are InstancedMesh,
 *   so thousands of environmental props cost only a handful of draw calls.
 * - The directional light's shadow frustum is tightly budgeted to follow the car every frame.
 */

import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry,
  DirectionalLight, DoubleSide, FogExp2, Group, HemisphereLight,
  InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three';

import { TRACK, WORLD } from './config.js';
import {
  createBarkTexture, createBushTexture, createFoliageTexture, createGantryBannerTexture,
  createGrandstandCrowdTexture, createSkyTexture, createSponsorBannerTexture, createTireWallTexture,
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
   Lighting & Atmosphere
   ══════════════════════════════════════════════════════════════════════════ */

export function createLighting(scene) {
  scene.fog = new FogExp2(WORLD.horizonColor, WORLD.fogDensity);

  const hemisphere = new HemisphereLight(
    0xa8d2f5, WORLD.groundColor, WORLD.hemiIntensity,
  );
  scene.add(hemisphere);

  const sun = new DirectionalLight(0xfff4e0, WORLD.sunIntensity);
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
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);

  return sun;
}

const SUN_DIRECTION = new Vector3();
export function updateShadowFrustum(sun, focus) {
  if (!sun || !sun.target || !focus) return;
  SUN_DIRECTION.set(...WORLD.sunPosition).normalize();

  const texelSize = (WORLD.shadowRadius * 2) / WORLD.shadowMapSize;
  const snap = (value) => Math.round(value / texelSize) * texelSize;

  sun.target.position.set(snap(focus.x), snap(focus.y), snap(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, 260);
}

/* ══════════════════════════════════════════════════════════════════════════
   Geometry Concatenation Helper
   ══════════════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════════════
   Trees & Roadside Flora
   ══════════════════════════════════════════════════════════════════════════ */

/** Realistic tapered trunk with root flare and organic branches. */
function buildTrunkGeometry() {
  const parts = [];

  const root = new CylinderGeometry(0.32, 0.54, 1.2, 10);
  root.translate(0, 0.6, 0);
  parts.push(root);

  const trunk = new CylinderGeometry(0.20, 0.34, 3.0, 10);
  trunk.translate(0, 2.4, 0);
  parts.push(trunk);

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

/** Layered foliage canopy with spherical normal transfer. */
function buildCanopyGeometry() {
  const parts = [];

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

    for (let a = 0; a < 3; a++) {
      const plane = new PlaneGeometry(r * 1.9, r * 1.6);
      plane.rotateY((a / 3) * Math.PI + a * 0.15);
      plane.translate(cx, cy, cz);
      parts.push(plane);
    }

    const cap = new PlaneGeometry(r * 1.8, r * 1.8);
    cap.rotateX(Math.PI / 2);
    cap.rotateZ(0.6);
    cap.translate(cx, cy, cz);
    parts.push(cap);

    const ico = new SphereGeometry(r * 0.78, 8, 6);
    ico.translate(cx, cy, cz);
    parts.push(ico);
  }

  const merged = mergeGeometries(parts);

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

/** Low flowering bushes and roadside ground foliage. */
function buildBushGeometry() {
  const parts = [];
  const angles = [0, Math.PI / 3, (2 * Math.PI) / 3];
  for (const a of angles) {
    const p = new PlaneGeometry(2.1, 1.45);
    p.rotateY(a);
    p.translate(0, 0.725, 0);
    parts.push(p);
  }
  return mergeGeometries(parts);
}

/* ══════════════════════════════════════════════════════════════════════════
   Spectator Grandstands
   ══════════════════════════════════════════════════════════════════════════ */

function createGrandstand({ track, sampleIndex, side = 1 }) {
  const safeIndex = Math.max(0, Math.min(track.samples.length - 1, sampleIndex));
  const sample = track.samples[safeIndex];
  const stand = new Group();
  stand.name = 'grandstand';

  const lateral = side * (track.wallLateral + 7.5);
  const pos = new Vector3();
  track.groundPoint(sample, lateral, pos);
  stand.position.copy(pos);

  // Orient grandstand facing directly toward the track
  const forward = sample.tangent.clone().normalize();
  const up = sample.up.clone().normalize();
  const inward = sample.right.clone().multiplyScalar(-side).normalize();
  const quat = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(forward, up, inward));
  stand.quaternion.copy(quat);

  const crowdMat = new MeshStandardMaterial({
    map: createGrandstandCrowdTexture(),
    roughness: 0.6,
    metalness: 0.1,
  });
  const steelMat = new MeshStandardMaterial({
    color: 0x3a404a,
    roughness: 0.4,
    metalness: 0.8,
  });
  const roofMat = new MeshStandardMaterial({
    color: 0x1c2027,
    roughness: 0.35,
    metalness: 0.6,
  });

  // 1. Bleachers body with cheering spectators
  const bleachers = new Mesh(new BoxGeometry(22, 4.8, 8.0), crowdMat);
  bleachers.position.set(0, 2.4, 0);
  bleachers.castShadow = true;
  bleachers.receiveShadow = true;

  // 2. Modern cantilever stadium roof canopy
  const roof = new Mesh(new BoxGeometry(24, 0.36, 9.5), roofMat);
  roof.position.set(0, 6.2, 0.4);
  roof.rotation.x = -0.10;
  roof.castShadow = true;
  roof.receiveShadow = true;

  // 3. Steel support pillars
  const pillarGeom = new CylinderGeometry(0.18, 0.22, 6.4, 8);
  pillarGeom.translate(0, 3.2, 0);
  for (const px of [-10, 10]) {
    for (const pz of [-3.5, 3.5]) {
      const pillar = new Mesh(pillarGeom, steelMat);
      pillar.position.set(px, 0, pz);
      pillar.castShadow = true;
      stand.add(pillar);
    }
  }

  stand.add(bleachers, roof);
  return stand;
}

/* ══════════════════════════════════════════════════════════════════════════
   Full Roadside Scenery Assembly
   ══════════════════════════════════════════════════════════════════════════ */

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
    const lateral = side * (barrier + 6 + random() * (TRACK.vergeWidth - 12));
    const height = 0.85 + random() * 0.95;

    track.groundPoint(sample, lateral, position);
    scale.set(height * (0.9 + random() * 0.25), height, height * (0.9 + random() * 0.25));
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

  /* ── Lush Roadside Bushes & Ground Shrubs ────────────────────────────── */

  const bushCount = WORLD.bushCount || 320;
  const bushes = new InstancedMesh(
    buildBushGeometry(),
    new MeshStandardMaterial({
      map: createBushTexture(),
      alphaTest: 0.35,
      roughness: 0.78,
      metalness: 0.04,
      side: DoubleSide,
      shadowSide: DoubleSide,
    }),
    bushCount,
  );
  bushes.instanceColor = new InstancedBufferAttribute(new Float32Array(bushCount * 3), 3);
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  bushes.name = 'bushes';

  const bushPalette = [
    new Color(0x28591a),
    new Color(0x3a7526),
    new Color(0x4e9334),
    new Color(0x336821),
    new Color(0x5ba43d),
  ];

  for (let i = 0; i < bushCount; i++) {
    const sample = samples[(random() * samples.length) | 0];
    const side = random() < 0.5 ? -1 : 1;
    // Scattered along grassy verge outside the barrier
    const lateral = side * (barrier + 1.2 + random() * 16);
    const bScale = 0.75 + random() * 0.85;

    track.groundPoint(sample, lateral, position);
    scale.set(bScale * (0.85 + random() * 0.3), bScale, bScale * (0.85 + random() * 0.3));
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI * 2);

    matrix.compose(position, quaternion, scale);
    bushes.setMatrixAt(i, matrix);
    bushes.setColorAt(i, bushPalette[(random() * bushPalette.length) | 0]);
  }
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  group.add(bushes);

  /* ── Distance Markers ───────────────────────────────────────────────── */

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
      quaternion.setFromUnitVectors(FORWARD_Z, sample.tangent);
      matrix.compose(position, quaternion, ONE);
      markers.setMatrixAt(written++, matrix);
    }
  }
  for (let i = written; i < markerCount; i++) {
    matrix.compose(HIDDEN, noRotation, ONE);
    markers.setMatrixAt(i, matrix);
  }
  markers.instanceMatrix.needsUpdate = true;
  group.add(markers);

  /* ── Corner Tire Safety Walls ───────────────────────────────────────── */

  const tireWallCount = WORLD.tireWallCount || 56;
  const tireGeom = new BoxGeometry(5.4, 1.05, 1.35);
  tireGeom.translate(0, 0.525, 0);
  const tireWalls = new InstancedMesh(
    tireGeom,
    new MeshStandardMaterial({
      map: createTireWallTexture(),
      roughness: 0.8,
      metalness: 0.08,
    }),
    tireWallCount,
  );
  tireWalls.castShadow = true;
  tireWalls.receiveShadow = true;
  tireWalls.name = 'tire-walls';

  let tireWritten = 0;
  const step = Math.max(1, Math.floor(samples.length / tireWallCount));
  for (let i = 0; i < samples.length && tireWritten < tireWallCount; i += step) {
    const sample = samples[i];
    // Place tire wall on outside of curves or every few intervals
    const isCurved = Math.abs(sample.curvature) > 0.006;
    const side = sample.curvature >= 0 ? 1 : -1;
    const lateral = side * (barrier + 1.1);

    track.groundPoint(sample, lateral, position);
    quaternion.setFromUnitVectors(FORWARD_Z, sample.tangent);
    scale.set(1, 1, 1);

    if (isCurved || i % (step * 2) === 0) {
      matrix.compose(position, quaternion, scale);
      tireWalls.setMatrixAt(tireWritten++, matrix);
    }
  }
  for (let i = tireWritten; i < tireWallCount; i++) {
    matrix.compose(HIDDEN, noRotation, ONE);
    tireWalls.setMatrixAt(i, matrix);
  }
  tireWalls.instanceMatrix.needsUpdate = true;
  group.add(tireWalls);

  /* ── Trackside Sponsor Billboards ───────────────────────────────────── */

  const sponsorCount = WORLD.sponsorBannerCount || 34;
  const bannerGeom = new BoxGeometry(4.8, 1.22, 0.16);
  bannerGeom.translate(0, 0.61, 0);

  // 4 sponsor variations distributed along track
  for (let v = 0; v < 4; v++) {
    const perVariant = Math.ceil(sponsorCount / 4);
    const boards = new InstancedMesh(
      bannerGeom,
      new MeshStandardMaterial({
        map: createSponsorBannerTexture(v),
        roughness: 0.45,
        metalness: 0.25,
      }),
      perVariant,
    );
    boards.castShadow = true;
    boards.receiveShadow = true;
    boards.name = `sponsor-boards-${v}`;

    let bWritten = 0;
    const bSpacing = Math.floor(samples.length / sponsorCount);
    for (let s = v; s < sponsorCount && bWritten < perVariant; s += 4) {
      const sIdx = (s * bSpacing + 12) % samples.length;
      const sample = samples[sIdx];
      const side = s % 2 === 0 ? 1 : -1;
      const lateral = side * (barrier + 1.25);

      track.groundPoint(sample, lateral, position);
      quaternion.setFromUnitVectors(FORWARD_Z, sample.tangent);

      matrix.compose(position, quaternion, ONE);
      boards.setMatrixAt(bWritten++, matrix);
    }
    for (let i = bWritten; i < perVariant; i++) {
      matrix.compose(HIDDEN, noRotation, ONE);
      boards.setMatrixAt(i, matrix);
    }
    boards.instanceMatrix.needsUpdate = true;
    group.add(boards);
  }

  /* ── Spectator Grandstands ──────────────────────────────────────────── */

  if (track.closed) {
    // Grand Prix Circuit spectator locations
    const standIndices = [
      { idx: 10, side: 1 },
      { idx: 36, side: 1 },
      { idx: 75, side: -1 },
      { idx: 150, side: 1 },
      { idx: 240, side: -1 },
      { idx: Math.max(0, samples.length - 40), side: 1 },
    ];
    for (const s of standIndices) {
      group.add(createGrandstand({ track, sampleIndex: s.idx, side: s.side }));
    }
  } else {
    // Sprint / Time Lap spectator locations along the run
    const startIdx = track.timingStartIndex;
    const finishIdx = track.timingFinishIndex;
    const standIndices = [
      { idx: startIdx + 8, side: 1 },
      { idx: startIdx + 45, side: -1 },
      { idx: Math.floor((startIdx + finishIdx) / 2), side: 1 },
      { idx: finishIdx - 50, side: -1 },
      { idx: finishIdx - 14, side: 1 },
    ];
    for (const s of standIndices) {
      group.add(createGrandstand({ track, sampleIndex: s.idx, side: s.side }));
    }
  }

  /* ── Start/Finish Motorsport Gantries ────────────────────────────────── */

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

  const acrossAngle = Math.atan2(sample.right.x, sample.right.z) - Math.PI / 2;

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

  const signWidth = span * 0.72;
  const signHeight = 1.45;
  const sign = new Mesh(new BoxGeometry(signWidth, signHeight, 0.14), bannerMat);
  sign.position.copy(sample.position);
  sign.position.y += postHeight - 1.0;
  sign.rotation.y = acrossAngle;
  sign.castShadow = true;

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
