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
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry,
  DirectionalLight, FogExp2, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3,
} from 'three';

import { TRACK, WORLD } from './config.js';
import { createSkyTexture } from './textures.js';

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
    indexCount += geometry.index.count;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of geometries) {
    position.set(geometry.attributes.position.array, vertexOffset * 3);
    normal.set(geometry.attributes.normal.array, vertexOffset * 3);
    uv.set(geometry.attributes.uv.array, vertexOffset * 2);

    // Indices are local to their own geometry, so they shift by however many
    // vertices have already been written.
    const source = geometry.index.array;
    for (let i = 0; i < source.length; i++) index[indexOffset + i] = source[i] + vertexOffset;

    vertexOffset += geometry.attributes.position.count;
    indexOffset += source.length;
    geometry.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('uv', new BufferAttribute(uv, 2));
  merged.setIndex(new BufferAttribute(index, 1));
  return merged;
}

/** A tapered trunk that forks into three branches reaching up into the canopy. */
function buildTrunkGeometry() {
  const parts = [];

  const trunk = new CylinderGeometry(0.20, 0.42, 2.6, 8);
  trunk.translate(0, 1.3, 0);
  parts.push(trunk);

  for (let i = 0; i < 3; i++) {
    const branch = new CylinderGeometry(0.08, 0.18, 1.9, 6);
    // Stand it on its own base, lean it out, swing that lean around, then lift
    // the whole thing to the fork. Order matters: `rotateY` after `rotateZ` is
    // what turns one leaning branch into three pointing different ways.
    branch.translate(0, 0.95, 0);
    branch.rotateZ(0.52);
    branch.rotateY((i / 3) * Math.PI * 2 + 0.4);
    branch.translate(0, 2.35, 0);
    parts.push(branch);
  }

  return mergeGeometries(parts);
}

/**
 * A broad, round, lumpy canopy.
 *
 * A bare sphere reads as a lollipop, so each vertex is pushed in and out along
 * its own radius by a sum of three sinusoids of its direction. That's smooth and
 * seamless (it's a function of direction, so the sphere's wrap-around costs
 * nothing) and deterministic, unlike sampling a random number per vertex, which
 * would just look like static.
 */
function buildCanopyGeometry() {
  const canopy = new SphereGeometry(2.5, 16, 12);
  const position = canopy.attributes.position;
  const vertex = new Vector3();
  const direction = new Vector3();

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    direction.copy(vertex).normalize();

    const lump = 1
      + 0.11 * Math.sin(direction.x * 4.7 + direction.y * 3.1)
      + 0.09 * Math.sin(direction.y * 5.3 + direction.z * 4.1)
      + 0.07 * Math.sin(direction.z * 6.1 + direction.x * 5.7);

    vertex.multiplyScalar(lump);
    // Wider than tall, and shallower underneath, so it sits over the fork
    // instead of swallowing the trunk.
    vertex.x *= 1.18;
    vertex.z *= 1.18;
    vertex.y *= 0.92;
    if (vertex.y < 0) vertex.y *= 0.62;

    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  canopy.translate(0, 4.6, 0);
  // The displacement invalidated the sphere's normals; without this the lumps
  // are there but flat-lit, so they don't read as lumps.
  canopy.computeVertexNormals();
  return canopy;
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
    new MeshStandardMaterial({ color: 0x5b4530, roughness: 0.94, metalness: 0 }),
    WORLD.treeCount,
  );
  const foliage = new InstancedMesh(
    buildCanopyGeometry(),
    new MeshStandardMaterial({ color: 0x4c8a37, roughness: 0.88, metalness: 0 }),
    WORLD.treeCount,
  );
  trunks.castShadow = true;
  foliage.castShadow = true;
  trunks.name = 'tree-trunks';
  foliage.name = 'tree-foliage';

  for (let i = 0; i < WORLD.treeCount; i++) {
    const sample = samples[(random() * samples.length) | 0];
    const side = random() < 0.5 ? -1 : 1;
    // Well clear of the barrier, scattered out into the verge.
    const lateral = side * (barrier + 6 + random() * (TRACK.vergeWidth - 12));
    const height = 0.72 + random() * 0.85;

    track.groundPoint(sample, lateral, position);
    scale.set(height * (0.85 + random() * 0.3), height, height * (0.85 + random() * 0.3));
    // A few degrees of lean, so the rows don't look stamped.
    quaternion.setFromAxisAngle(
      new Vector3(random() - 0.5, 0, random() - 0.5).normalize(),
      (random() - 0.5) * 0.09,
    );

    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);
    foliage.setMatrixAt(i, matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
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

  group.add(createStartGantry(track));

  return group;
}

const FORWARD_Z = new Vector3(0, 0, 1);
const ONE = new Vector3(1, 1, 1);
const HIDDEN = new Vector3(0, -9999, 0);

/** A simple arch over the start line, so the lap boundary is unmistakable. */
function createStartGantry(track) {
  const gantry = new Group();
  gantry.name = 'start-gantry';

  const sample = track.samples[0];
  const halfWidth = TRACK.roadHalfWidth + TRACK.kerbWidth + 2.2;
  const postHeight = 7.4;

  const steel = new MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.45, metalness: 0.72 });
  const banner = new MeshStandardMaterial({ color: 0x16283f, roughness: 0.6, metalness: 0.1 });

  const postGeometry = new CylinderGeometry(0.34, 0.4, postHeight, 10);
  postGeometry.translate(0, postHeight / 2, 0);

  const position = new Vector3();
  for (const side of [-1, 1]) {
    const post = new Mesh(postGeometry, steel);
    track.groundPoint(sample, side * halfWidth, position);
    post.position.copy(position);
    post.castShadow = true;
    gantry.add(post);
  }

  // Cross beam and banner, spanning between the posts.
  const span = halfWidth * 2;
  const beam = new Mesh(new BoxGeometry(span, 0.42, 0.5), steel);
  const sign = new Mesh(new BoxGeometry(span * 0.62, 1.5, 0.16), banner);

  beam.position.copy(sample.position);
  beam.position.y += postHeight - 0.2;
  sign.position.copy(sample.position);
  sign.position.y += postHeight - 1.5;

  // Rotate both to lie across the track.
  const acrossAngle = Math.atan2(sample.right.x, sample.right.z) - Math.PI / 2;
  beam.rotation.y = acrossAngle;
  sign.rotation.y = acrossAngle;
  beam.castShadow = true;
  sign.castShadow = true;

  gantry.add(beam, sign);
  return gantry;
}
