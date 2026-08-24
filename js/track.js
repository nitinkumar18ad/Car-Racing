/**
 * The track.
 *
 * Everything geometric in the game derives from a single closed centreline
 * curve: the asphalt, kerbs, grass, barriers, tree placement, the minimap, lap
 * progress, off-road detection and the car's ride height and body angle.
 *
 * Two things are worth knowing before editing this file:
 *
 * 1. Frames are built by hand, not with `computeFrenetFrames()`. Frenet frames
 *    twist unpredictably wherever curvature changes sign, and that twist would
 *    show up as the road visibly rolling on a straight. Instead the "right"
 *    vector is derived from the tangent and world up every sample, which cannot
 *    twist. Banking is then applied deliberately on top.
 *
 * 2. Samples are evenly spaced *by distance* (via `getPointAt`, which
 *    arc-length reparameterises the curve). That is what lets `sampleAt()`
 *    search a fixed window of indices and lets lap progress be read straight
 *    off a sample index.
 */

import {
  BufferGeometry, BufferAttribute, CatmullRomCurve3, Mesh, MeshStandardMaterial,
  DoubleSide, Vector3, Group,
} from 'three';

import { TRACK } from './config.js';
import {
  createAsphaltTexture, createGrassTexture, createKerbTexture,
  createStartLineTexture, createWallTexture,
} from './textures.js';

const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Circuit layout, as [x, y, z] control points. Catmull-Rom smooths through all
 * of them and `closed: true` joins the last back to the first.
 *
 * The lap reads: main straight -> fast right sweeper -> climb to a blind crest
 * -> tight left hairpin -> downhill S-chicane -> long sweeping left -> kink
 * back onto the straight.
 */
const LAYOUT_SCALE = 1.2;

const CONTROL_POINTS = [
  // Main straight, heading +X. Start/finish sits at the first point.
  [-340,   0, -250],
  [-180,   0, -253],
  [ -20,   0, -254],
  [ 140,   0, -250],
  // Fast right-hand sweeper, starting to climb.
  [ 250,   1, -228],
  [ 330,   3, -170],
  [ 368,   6,  -86],
  // Crest — you cannot see the exit until you are over it.
  [ 372,   8,    0],
  [ 350,   7,   84],
  [ 300,   5,  150],
  // Approach and tight left hairpin.
  [ 232,   4,  188],
  [ 176,   4,  198],
  [ 148,   4,  166],
  [ 170,   4,  126],
  [ 212,   3,   98],
  // Downhill S-chicane.
  [ 250,   2,   56],
  [ 226,   1,   12],
  [ 168,   0,   -8],
  [ 110,   0,   26],
  [  40,  -1,   70],
  // Long sweeping left all the way down the far side.
  [ -60,  -2,  120],
  [-170,  -3,  150],
  [-268,  -3,  128],
  [-336,  -2,   68],
  [-372,  -1,  -20],
  // Kink that feeds back onto the main straight.
  [-392,   0, -110],
  [-370,   0, -198],
];

/* ══════════════════════════════════════════════════════════════════════════
   Geometry helpers
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Build an indexed triangle strip from per-sample vertex pairs.
 *
 * `emit(i, sample, a, b, uv)` fills `a` and `b` with the two world positions
 * for that ring and `uv` with [uA, vA, uB, vB]. One extra ring is emitted at
 * the end, wrapping to sample 0, so the loop closes seamlessly.
 */
function buildStrip(samples, emit, normalFor) {
  const ringCount = samples.length + 1;
  const positions = new Float32Array(ringCount * 2 * 3);
  const normals = new Float32Array(ringCount * 2 * 3);
  const uvs = new Float32Array(ringCount * 2 * 2);
  const indices = new Uint32Array(samples.length * 6);

  const a = new Vector3();
  const b = new Vector3();
  const normal = new Vector3();
  const uv = [0, 0, 0, 0];

  for (let ring = 0; ring < ringCount; ring++) {
    // The final ring reuses sample 0's cross-section but keeps the running
    // distance, so the texture does not jump at the seam.
    const index = ring % samples.length;
    const sample = samples[index];

    emit(ring, sample, a, b, uv);
    normalFor(sample, normal);

    const p = ring * 6;
    positions[p + 0] = a.x; positions[p + 1] = a.y; positions[p + 2] = a.z;
    positions[p + 3] = b.x; positions[p + 4] = b.y; positions[p + 5] = b.z;
    normals[p + 0] = normal.x; normals[p + 1] = normal.y; normals[p + 2] = normal.z;
    normals[p + 3] = normal.x; normals[p + 4] = normal.y; normals[p + 5] = normal.z;

    const t = ring * 4;
    uvs[t + 0] = uv[0]; uvs[t + 1] = uv[1];
    uvs[t + 2] = uv[2]; uvs[t + 3] = uv[3];
  }

  for (let i = 0; i < samples.length; i++) {
    const v = i * 2;
    const o = i * 6;
    indices[o + 0] = v;     indices[o + 1] = v + 1; indices[o + 2] = v + 2;
    indices[o + 3] = v + 1; indices[o + 4] = v + 3; indices[o + 5] = v + 2;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A ribbon lying on (or just above) the road plane, between two lateral offsets.
 *
 * `liftA`/`liftB` are heights along the surface normal at each edge, so a ribbon
 * can slope — which the grass verges use to meet the kerb flush at their inner
 * edge and fall away to the centreline plane at their outer edge.
 *
 * IMPORTANT: `latB` must be greater than `latA`. `buildStrip`'s winding makes the
 * front face point along `up * (latB - latA)`, so a descending ribbon faces down
 * and is silently backface-culled. `surfaceRibbonBetween` handles the ordering.
 */
function surfaceRibbon(samples, spacing, latA, latB, liftA, liftB, vPerMetre, uSpan) {
  return buildStrip(
    samples,
    (ring, sample, a, b, uv) => {
      const distance = ring * spacing;
      a.copy(sample.right).multiplyScalar(latA)
        .addScaledVector(sample.up, liftA).add(sample.position);
      b.copy(sample.right).multiplyScalar(latB)
        .addScaledVector(sample.up, liftB).add(sample.position);
      uv[0] = 0;     uv[1] = distance * vPerMetre;
      uv[2] = uSpan; uv[3] = distance * vPerMetre;
    },
    (sample, normal) => normal.copy(sample.up),
  );
}

/**
 * `surfaceRibbon` for a strip described by its inner and outer edge, which is how
 * the mirrored left/right pieces are naturally expressed. Swaps the pair when the
 * left-hand side puts them in descending order, keeping every surface facing up.
 */
function surfaceRibbonBetween(samples, spacing, edgeA, edgeB, vPerMetre, uSpan) {
  const [lo, hi] = edgeA.lateral <= edgeB.lateral ? [edgeA, edgeB] : [edgeB, edgeA];
  return surfaceRibbon(
    samples, spacing, lo.lateral, hi.lateral, lo.lift, hi.lift, vPerMetre, uSpan,
  );
}

/** A vertical wall standing on the road plane at a fixed lateral offset. */
function wallRibbon(samples, spacing, lat, height, uPerMetre, inwardSign) {
  return buildStrip(
    samples,
    (ring, sample, a, b, uv) => {
      const distance = ring * spacing;
      a.copy(sample.right).multiplyScalar(lat).add(sample.position);
      b.copy(a).addScaledVector(sample.up, height);
      uv[0] = distance * uPerMetre; uv[1] = 0;
      uv[2] = distance * uPerMetre; uv[3] = 1;
    },
    (sample, normal) => normal.copy(sample.right).multiplyScalar(inwardSign),
  );
}

/**
 * Moving average over a closed ring of values. `window` is a half-width in
 * samples.
 *
 * Apply it twice to get a triangular filter, which smooths the *derivative* as
 * well: a single box pass turns a step into a straight ramp, and a ramp still has
 * corners at each end that are plainly visible when the thing being ramped is
 * rolling 18 metres of road.
 */
function smoothRing(values, window) {
  const count = values.length;
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = -window; k <= window; k++) sum += values[(i + k + count) % count];
    out[i] = sum / (window * 2 + 1);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   Track
   ══════════════════════════════════════════════════════════════════════════ */

export class Track {
  constructor() {
    this.curve = new CatmullRomCurve3(
      CONTROL_POINTS.map(([x, y, z]) => new Vector3(x * LAYOUT_SCALE, y, z * LAYOUT_SCALE)),
      true,          // closed loop
      'catmullrom',
      0.5,           // tension
    );
    // The default 200 divisions is far too coarse to arc-length parameterise
    // 2200 samples evenly; without this, sample spacing drifts on tight bends.
    this.curve.arcLengthDivisions = 8000;

    this.samples = this.#buildSamples();
    this.length = this.samples.length * this.spacing;

    /** Cursor for the windowed nearest-sample search in `sampleAt()`. */
    this.cursor = 0;

    this.group = new Group();
    this.group.name = 'track';
    this.#buildMeshes();
  }

  /* ── Sample table ────────────────────────────────────────────────────── */

  #buildSamples() {
    const count = TRACK.samples;
    const totalLength = this.curve.getLength();
    this.spacing = totalLength / count;

    const samples = [];

    // Pass 1: positions and frames. `t = i / count` (not `count - 1`) because
    // on a closed curve t=1 is the same point as t=0.
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const position = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();

      // right = tangent x worldUp. Cannot twist, unlike a Frenet frame.
      const right = new Vector3().crossVectors(tangent, WORLD_UP).normalize();
      const up = new Vector3().crossVectors(right, tangent).normalize();

      samples.push({
        index: i,
        distance: i * this.spacing,
        position,
        tangent,
        right,
        up,
        curvature: 0,
        bank: 0,
      });
    }

    // Pass 2: signed curvature, from how much the tangent swings toward `right`
    // over one sample of arc length. Positive means the track turns right.
    const raw = new Float64Array(count);
    const delta = new Vector3();
    for (let i = 0; i < count; i++) {
      const previous = samples[(i - 1 + count) % count];
      const next = samples[(i + 1) % count];
      delta.subVectors(next.tangent, previous.tangent);
      raw[i] = delta.dot(samples[i].right) / (2 * this.spacing);
    }

    // Smooth curvature before it drives banking, otherwise sampling noise makes
    // the road ripple.
    const curvature = smoothRing(raw, 14);

    // Pass 3: bank the frames.
    //
    // `tanh` soft-limits the lean instead of clamping it, and the result is then
    // smoothed twice over a wide window — see the note on TRACK.maxBankRadians for
    // why both are necessary. Without them the bank saturates across almost the
    // whole lap and flips sign within a metre wherever the corner changes hand,
    // which throws the road's edges up and down like a cone.
    const target = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      samples[i].curvature = curvature[i];
      target[i] = TRACK.maxBankRadians * Math.tanh(curvature[i] * TRACK.bankCurvatureScale);
    }

    const bankWindow = Math.max(1, Math.round(TRACK.bankSmoothingMetres / this.spacing));
    const bank = smoothRing(smoothRing(target, bankWindow), bankWindow);

    // Rotating `right` about `tangent` by a positive angle drops its y, which
    // raises the left (outer) edge of a right-hand corner — exactly the lean we
    // want.
    const axisCross = new Vector3();
    for (let i = 0; i < count; i++) {
      const sample = samples[i];
      sample.bank = bank[i];
      if (bank[i] === 0) continue;

      // Rodrigues rotation of `right` about `tangent`.
      axisCross.crossVectors(sample.tangent, sample.right);
      sample.right
        .multiplyScalar(Math.cos(bank[i]))
        .addScaledVector(axisCross, Math.sin(bank[i]))
        .normalize();
      sample.up.crossVectors(sample.right, sample.tangent).normalize();
    }

    return samples;
  }

  /* ── Meshes ──────────────────────────────────────────────────────────── */

  #buildMeshes() {
    const { samples, spacing } = this;
    const halfWidth = TRACK.roadHalfWidth;
    const kerbOuter = halfWidth + TRACK.kerbWidth;
    const grassEdge = kerbOuter + TRACK.vergeWidth;

    // Grass runs from the outer edge of each kerb outward — never underneath the
    // asphalt. See the note on TRACK.roadLift: a single full-width ribbon has
    // rings wide enough (~140m) that triangulating them bulges the surface by
    // more than the road's clearance wherever banking changes, which shows up as
    // grass poking through the track. Two disjoint verges cannot do that.
    //
    // Each verge starts flush with the kerb's outer lip and falls away to the
    // centreline plane at its far edge, which reads as drainage camber.
    const grassTileMetres = 1 / TRACK.grassRepeatPerMetre;
    const grassMaterial = new MeshStandardMaterial({
      map: createGrassTexture(1, 1),
      roughness: 0.95,
      metalness: 0,
    });
    for (const sign of [-1, 1]) {
      const verge = new Mesh(
        surfaceRibbonBetween(samples, spacing,
          { lateral: sign * kerbOuter, lift: TRACK.kerbLift },
          { lateral: sign * grassEdge, lift: 0 },
          TRACK.grassRepeatPerMetre, TRACK.vergeWidth / grassTileMetres),
        grassMaterial,
      );
      verge.receiveShadow = true;
      verge.name = `grass-${sign < 0 ? 'left' : 'right'}`;
      this.group.add(verge);
    }

    const kerbMaterial = new MeshStandardMaterial({
      map: createKerbTexture(1),
      roughness: 0.7,
      metalness: 0,
    });
    for (const sign of [-1, 1]) {
      const kerb = new Mesh(
        surfaceRibbonBetween(samples, spacing,
          { lateral: sign * halfWidth, lift: TRACK.roadLift },
          { lateral: sign * kerbOuter, lift: TRACK.kerbLift },
          TRACK.kerbRepeatPerMetre, 1),
        kerbMaterial,
      );
      kerb.receiveShadow = true;
      kerb.name = `kerb-${sign < 0 ? 'left' : 'right'}`;
      this.group.add(kerb);
    }

    const road = new Mesh(
      surfaceRibbon(samples, spacing, -halfWidth, halfWidth,
        TRACK.roadLift, TRACK.roadLift, TRACK.asphaltRepeatPerMetre, 1),
      new MeshStandardMaterial({
        map: createAsphaltTexture(1),
        roughness: 0.82,
        metalness: 0,
      }),
    );
    road.receiveShadow = true;
    road.name = 'road';
    this.group.add(road);

    const wallMaterial = new MeshStandardMaterial({
      map: createWallTexture(1),
      roughness: 0.55,
      metalness: 0.1,
      side: DoubleSide,
    });
    this.wallLateral = kerbOuter + TRACK.wallOffset;
    for (const sign of [-1, 1]) {
      const wall = new Mesh(
        wallRibbon(samples, spacing, sign * this.wallLateral, TRACK.wallHeight,
          TRACK.wallRepeatPerMetre, -sign),
        wallMaterial,
      );
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.name = `wall-${sign < 0 ? 'left' : 'right'}`;
      this.group.add(wall);
    }

    this.group.add(this.#buildStartLine());
  }

  /** Chequered strip laid across the road at s = 0. */
  #buildStartLine() {
    const halfWidth = TRACK.roadHalfWidth;
    const depth = 5;                 // metres along the track
    const rings = Math.max(2, Math.round(depth / this.spacing));
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    const point = new Vector3();
    for (let i = 0; i <= rings; i++) {
      const sample = this.samples[i % this.samples.length];
      const v = i / rings;
      for (const side of [-1, 1]) {
        point.copy(sample.right).multiplyScalar(side * halfWidth)
          .addScaledVector(sample.up, TRACK.roadLift + 0.012)
          .add(sample.position);
        positions.push(point.x, point.y, point.z);
        normals.push(sample.up.x, sample.up.y, sample.up.z);
        uvs.push(side < 0 ? 0 : 1, v);
      }
      if (i < rings) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geometry.setIndex(indices);

    const mesh = new Mesh(geometry, new MeshStandardMaterial({
      map: createStartLineTexture(),
      roughness: 0.6,
      metalness: 0,
    }));
    mesh.name = 'start-line';
    return mesh;
  }

  /* ── Queries ─────────────────────────────────────────────────────────── */

  /**
   * Locate a world position relative to the track.
   *
   * Returns `{ distance, lateral, height, up, tangent, right, index, curvature }`
   * where `distance` is metres travelled along the centreline and `lateral` is
   * signed metres to the right of it.
   *
   * Searches a window around the previous result, since the car cannot move
   * more than a few samples in one physics step. Pass `global: true` (on reset,
   * or if the car is teleported) to scan the whole table instead.
   */
  sampleAt(position, { global = false } = {}) {
    const samples = this.samples;
    const count = samples.length;

    let bestIndex = 0;
    let bestDistanceSq = Infinity;

    if (global) {
      for (let i = 0; i < count; i++) {
        const d = horizontalDistanceSq(samples[i].position, position);
        if (d < bestDistanceSq) { bestDistanceSq = d; bestIndex = i; }
      }
    } else {
      const window = 60;
      for (let k = -window; k <= window; k++) {
        const i = (this.cursor + k + count) % count;
        const d = horizontalDistanceSq(samples[i].position, position);
        if (d < bestDistanceSq) { bestDistanceSq = d; bestIndex = i; }
      }
    }

    this.cursor = bestIndex;

    // Refine onto whichever of the two adjoining segments the point projects
    // into, so `distance` and `lateral` are continuous rather than quantised to
    // sample spacing.
    const forward = this.#projectOntoSegment(bestIndex, position);
    const backward = this.#projectOntoSegment((bestIndex - 1 + count) % count, position);
    return forward.offRadius <= backward.offRadius ? forward : backward;
  }

  /** Project a point onto the segment starting at `index`. */
  #projectOntoSegment(index, position) {
    const samples = this.samples;
    const count = samples.length;
    const a = samples[index];
    const b = samples[(index + 1) % count];

    const segX = b.position.x - a.position.x;
    const segZ = b.position.z - a.position.z;
    const lengthSq = segX * segX + segZ * segZ;

    let t = lengthSq > 0
      ? ((position.x - a.position.x) * segX + (position.z - a.position.z) * segZ) / lengthSq
      : 0;
    t = clamp(t, 0, 1);

    const centreX = a.position.x + segX * t;
    const centreZ = a.position.z + segZ * t;
    const height = a.position.y + (b.position.y - a.position.y) * t;

    // Interpolating unit frames then renormalising is accurate enough at this
    // sample density and much cheaper than a slerp.
    const right = a.right.clone().lerp(b.right, t).normalize();
    const up = a.up.clone().lerp(b.up, t).normalize();
    const tangent = a.tangent.clone().lerp(b.tangent, t).normalize();

    const toPointX = position.x - centreX;
    const toPointZ = position.z - centreZ;
    const lateral = toPointX * right.x + toPointZ * right.z;

    return {
      index,
      distance: a.distance + t * this.spacing,
      lateral,
      height,
      up,
      tangent,
      right,
      curvature: a.curvature + (b.curvature - a.curvature) * t,
      /** Perpendicular distance, used only to pick the better of two segments. */
      offRadius: Math.abs(toPointX * -right.z + toPointZ * right.x) + Math.abs(lateral) * 1e-4,
    };
  }

  /** Reset the search cursor — call before a `global: true` lookup. */
  resetCursor() {
    this.cursor = 0;
  }

  /**
   * World position of a point on the ground, `lateral` metres right of the
   * centreline at `sample`.
   *
   * Follows the banked plane and the verge's outward slope, which matters more
   * than it sounds: on a banked corner the surface 60 m out sits several metres
   * below the centreline plane, so anything placed on the unbanked lateral axis
   * instead hangs visibly in the air.
   */
  groundPoint(sample, lateral, target = new Vector3()) {
    const kerbOuter = TRACK.roadHalfWidth + TRACK.kerbWidth;
    const beyondKerb = Math.max(0, Math.abs(lateral) - kerbOuter);
    const acrossVerge = Math.min(1, beyondKerb / TRACK.vergeWidth);
    const lift = TRACK.kerbLift * (1 - acrossVerge);

    return target.copy(sample.right).multiplyScalar(lateral)
      .addScaledVector(sample.up, lift)
      .add(sample.position);
  }

  /** Where the car sits on the grid, and which way it faces. */
  getStartTransform() {
    const sample = this.samples[0];
    return {
      position: sample.position.clone().addScaledVector(sample.up, TRACK.roadLift),
      // Yaw uses the car's convention: forward = (-sin yaw, 0, -cos yaw), so
      // recovering yaw from a direction needs both components negated.
      yaw: Math.atan2(-sample.tangent.x, -sample.tangent.z),
      sample,
    };
  }

  /** Centreline projected to XZ, for the minimap. */
  getMinimapPath(step = 8) {
    const points = [];
    for (let i = 0; i < this.samples.length; i += step) {
      const p = this.samples[i].position;
      points.push([p.x, p.z]);
    }
    return points;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Small shared helpers
   ══════════════════════════════════════════════════════════════════════════ */

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function horizontalDistanceSq(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
