/**
 * The player's car: mesh and handling.
 *
 * ── Conventions ───────────────────────────────────────────────────────────
 * `yaw` is the heading, and matches `mesh.rotation.y` directly so there is no
 * offset to remember. three.js objects face their local -Z, which after a Y
 * rotation of `yaw` points along:
 *
 *     forward = (-sin yaw, 0, -cos yaw)
 *     right   = ( cos yaw, 0, -sin yaw)
 *
 * Both are flat: the car is glued to the road surface, with height read from
 * the track rather than integrated, so there is no airborne case to handle.
 * Increasing `yaw` turns left, and `steerAngle` is positive-left to match.
 *
 * ── Why the drift works ───────────────────────────────────────────────────
 * Velocity is kept in world space. Each step it is split into forward and
 * lateral components *in the current heading's frame*, those are modified, and
 * it is recomposed in that same frame — and only then is `yaw` updated. Because
 * the velocity vector does not get rotated along with the car, turning the nose
 * naturally leaves sideways velocity behind. That leftover is the slip, and how
 * fast `gripLateral` eats it is the entire difference between planted and
 * sliding.
 */

import {
  BoxGeometry, CylinderGeometry, Euler, Group, Matrix4, Mesh, MeshStandardMaterial,
  Quaternion, Vector3,
} from 'three';

import { CAR, TRACK } from './config.js';
import { clamp } from './track.js';

const WORLD_UP = new Vector3(0, 1, 0);

/** Half the car's width, used for barrier clearance. */
const CAR_HALF_WIDTH = 0.95;

/* ══════════════════════════════════════════════════════════════════════════
   Mesh
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Giallo-ish yellow, with a darker shade for the sills so the car reads as
 * having a lower half rather than being one flat slab of colour.
 */
const PAINT = 0xf5c400;
const PAINT_DARK = 0xb8900a;

function bodyPart(geometry, material, position) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

/** A cylinder lying along Z, for lights and exhaust tips that face the rear. */
function disc(radius, depth, segments = 16) {
  const geometry = new CylinderGeometry(radius, radius, depth, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/**
 * Assemble the car from primitives. No model files, so no loader and no
 * asynchronous startup — the car exists the moment the game does.
 *
 * ── Orientation ───────────────────────────────────────────────────────────
 * The nose is at local **-Z**. This is not a free choice: three.js objects face
 * their local -Z, and `updateVisuals` builds the orientation with
 * `makeBasis(right, up, BACKWARD)`, whose third column is where local +Z ends
 * up. Build the nose at +Z and the car drives tail-first — which is easy to
 * miss, because everything else about it looks right.
 *
 * Shapes follow a mid-engine layout: cabin forward of centre, engine deck with
 * a glazed cover behind it, haunches wider than the tub, and the whole rear end
 * — quad round lamps, finned diffuser, twin tips — doing the work, since the
 * rear is the only part of the car the player ever really sees.
 *
 * Returns the group plus handles on the pieces that animate.
 */
function buildCarMesh() {
  const group = new Group();
  group.name = 'car';

  const paint = new MeshStandardMaterial({ color: PAINT, roughness: 0.28, metalness: 0.55 });
  const paintDark = new MeshStandardMaterial({ color: PAINT_DARK, roughness: 0.4, metalness: 0.5 });
  const trim = new MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.35 });
  const vent = new MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.88, metalness: 0.08 });
  const glass = new MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.06, metalness: 0.6 });
  const chrome = new MeshStandardMaterial({ color: 0xd4d8de, roughness: 0.13, metalness: 0.95 });
  const rubber = new MeshStandardMaterial({ color: 0x14161a, roughness: 0.88, metalness: 0.02 });
  const rim = new MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.34, metalness: 0.82 });
  const headlight = new MeshStandardMaterial({
    color: 0xfff4d2, emissive: 0xfff0c4, emissiveIntensity: 1.1, roughness: 0.2,
  });
  const taillight = new MeshStandardMaterial({
    color: 0x6b0f0f, emissive: 0xff2020, emissiveIntensity: 0.55, roughness: 0.3,
  });
  const reflector = new MeshStandardMaterial({
    color: 0x7a1414, emissive: 0xc01818, emissiveIntensity: 0.35, roughness: 0.45,
  });

  /* ── Body ──────────────────────────────────────────────────────────────
     A wide dark sill under a narrower tub, which is what makes the car read
     as low and planted rather than as a single block. */
  group.add(bodyPart(new BoxGeometry(1.96, 0.28, 3.60), paintDark, [0, 0.40, 0]));
  group.add(bodyPart(new BoxGeometry(1.80, 0.46, 3.90), paint, [0, 0.63, 0]));

  // Rear haunches, proud of the tub on both sides. From behind, this single
  // detail does more than any other to say "supercar".
  for (const side of [-1, 1]) {
    group.add(bodyPart(new BoxGeometry(0.24, 0.50, 1.60), paint, [side * 0.90, 0.70, 1.00]));
    // Black mesh intake let into the haunch.
    group.add(bodyPart(new BoxGeometry(0.07, 0.28, 0.80), vent, [side * 1.00, 0.76, 0.50]));
  }

  /* ── Nose ──────────────────────────────────────────────────────────── */
  group.add(bodyPart(new BoxGeometry(1.66, 0.32, 0.86), paint, [0, 0.52, -2.18]));
  group.add(bodyPart(new BoxGeometry(1.90, 0.10, 0.60), trim, [0, 0.28, -2.40]));
  group.add(bodyPart(new BoxGeometry(0.92, 0.06, 0.50), vent, [0, 0.69, -1.72]));
  group.add(bodyPart(new BoxGeometry(0.40, 0.14, 0.07), headlight, [0.58, 0.58, -2.58]));
  group.add(bodyPart(new BoxGeometry(0.40, 0.14, 0.07), headlight, [-0.58, 0.58, -2.58]));

  /* ── Cabin, forward of centre ──────────────────────────────────────── */
  group.add(bodyPart(new BoxGeometry(1.44, 0.42, 1.50), paint, [0, 1.04, -0.60]));
  group.add(bodyPart(new BoxGeometry(1.34, 0.30, 0.10), glass, [0, 1.06, -1.32]));  // windscreen
  group.add(bodyPart(new BoxGeometry(0.08, 0.26, 1.30), glass, [0.69, 1.06, -0.60]));
  group.add(bodyPart(new BoxGeometry(0.08, 0.26, 1.30), glass, [-0.69, 1.06, -0.60]));

  // Mirrors, on stalks off the shoulder line.
  for (const side of [-1, 1]) {
    group.add(bodyPart(new BoxGeometry(0.18, 0.045, 0.05), trim, [side * 0.88, 1.00, -1.10]));
    group.add(bodyPart(new BoxGeometry(0.09, 0.15, 0.22), paint, [side * 1.00, 1.02, -1.08]));
  }

  /* ── Engine deck ────────────────────────────────────────────────────
     A raised bay behind the cabin with a glazed cover over it, then louvre
     slats across the deck, then a body-coloured ducktail lip. */
  group.add(bodyPart(new BoxGeometry(1.82, 0.30, 1.30), paint, [0, 0.94, 0.68]));
  group.add(bodyPart(new BoxGeometry(1.16, 0.07, 1.02), glass, [0, 1.12, 0.68]));
  for (const z of [0.30, 0.46, 0.62]) {
    group.add(bodyPart(new BoxGeometry(1.24, 0.05, 0.07), trim, [0, 1.14, z]));
  }
  group.add(bodyPart(new BoxGeometry(1.70, 0.10, 0.34), paint, [0, 1.06, 1.48]));
  group.add(bodyPart(new BoxGeometry(1.72, 0.05, 0.10), trim, [0, 1.11, 1.62]));

  /* ── Rear end ───────────────────────────────────────────────────────
     Fascia, four round lamps in pairs, twin tips above a finned diffuser,
     and low reflector strips at the outer corners. */
  group.add(bodyPart(new BoxGeometry(1.94, 0.44, 0.28), paint, [0, 0.72, 2.06]));

  const lens = disc(0.125, 0.09);
  const brakeLights = [];
  for (const x of [-0.72, -0.44, 0.44, 0.72]) {
    const light = bodyPart(lens, taillight, [x, 0.80, 2.22]);
    brakeLights.push(light);
    group.add(light);
  }

  for (const side of [-1, 1]) {
    group.add(bodyPart(new BoxGeometry(0.30, 0.055, 0.05), reflector, [side * 0.70, 0.46, 2.20]));
  }

  group.add(bodyPart(new BoxGeometry(1.66, 0.26, 0.44), vent, [0, 0.34, 2.02]));
  const fin = new BoxGeometry(0.055, 0.24, 0.42);
  for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) {
    group.add(bodyPart(fin, trim, [x, 0.34, 2.06]));
  }

  const tip = disc(0.09, 0.22, 14);
  group.add(bodyPart(tip, chrome, [0.19, 0.52, 2.22]));
  group.add(bodyPart(tip, chrome, [-0.19, 0.52, 2.22]));

  /* ── Wheels ─────────────────────────────────────────────────────────
     The cylinder's axis is Y by default, so rotate the geometry onto X;
     after that, spinning a wheel is just `rotation.x`. */
  const tyre = new CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.30, 20);
  tyre.rotateZ(Math.PI / 2);
  const hub = new CylinderGeometry(CAR.wheelRadius * 0.62, CAR.wheelRadius * 0.62, 0.32, 12);
  hub.rotateZ(Math.PI / 2);

  const halfTrack = CAR.trackWidth / 2;
  const halfBase = CAR.wheelbase / 2;
  const wheels = [];
  const steerPivots = [];

  for (const [side, axle] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    // Front wheels need a pivot that steers, holding a wheel that spins, so the
    // two rotations never fight over Euler order.
    const pivot = new Group();
    pivot.position.set(side * halfTrack, CAR.wheelRadius, axle * halfBase);
    group.add(pivot);

    const wheel = new Mesh(tyre, rubber);
    wheel.castShadow = true;
    wheel.add(new Mesh(hub, rim));
    pivot.add(wheel);

    wheels.push(wheel);
    // Negative Z is the nose, so the front axle is the negative one.
    if (axle < 0) steerPivots.push(pivot);
  }

  return { group, wheels, steerPivots, brakeLights };
}

/* ══════════════════════════════════════════════════════════════════════════
   Car
   ══════════════════════════════════════════════════════════════════════════ */

export class Car {
  constructor(track) {
    this.track = track;

    const built = buildCarMesh();
    this.mesh = built.group;
    this.wheels = built.wheels;
    this.steerPivots = built.steerPivots;
    this.brakeLights = built.brakeLights;

    // Physics state.
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.yaw = 0;
    this.steerAngle = 0;
    this.wheelSpin = 0;

    // Derived, read by the HUD, camera and lap logic.
    this.speed = 0;            // m/s, magnitude of velocity
    this.forwardSpeed = 0;     // m/s, signed along the nose
    this.lateralSpeed = 0;     // m/s, sideways (the drift readout)
    this.trackDistance = 0;
    this.lateral = 0;
    this.offRoad = false;
    this.touchingWall = false;
    this.surfaceUp = new Vector3(0, 1, 0);

    // Scratch objects, reused every step so the physics allocates nothing.
    this.#forward = new Vector3();
    this.#right = new Vector3();
    this.#targetQuaternion = new Quaternion();
    this.#basisEuler = new Euler();
    this.#cosmeticQuaternion = new Quaternion();
    this.#tmp = new Vector3();
    this.#tmpB = new Vector3();

    this.reset();
  }

  #forward; #right; #targetQuaternion; #basisEuler; #cosmeticQuaternion; #tmp; #tmpB;

  /** Put the car back on the grid, stationary. */
  reset() {
    const start = this.track.getStartTransform();
    this.position.copy(start.position);
    this.velocity.set(0, 0, 0);
    this.yaw = start.yaw;
    this.steerAngle = 0;
    this.wheelSpin = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.offRoad = false;
    this.touchingWall = false;

    this.track.resetCursor();
    const sample = this.track.sampleAt(this.position, { global: true });
    this.trackDistance = sample.distance;
    this.lateral = sample.lateral;
    this.surfaceUp.copy(sample.up);

    this.mesh.position.copy(this.position);
    this.mesh.quaternion.setFromEuler(new Euler(0, this.yaw, 0));
    this.#syncBasis();
  }

  #syncBasis() {
    this.#forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.#right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /**
   * Advance the simulation by one fixed step.
   *
   * `input` is `{ throttle, brake, steer, handbrake }` with throttle/brake in
   * 0..1, steer in -1..1 (positive = left) and handbrake a boolean.
   */
  step(dt, input) {
    this.#syncBasis();
    const forward = this.#forward;
    const right = this.#right;

    // ── Steering ────────────────────────────────────────────────────────
    // Authority falls off with speed so the car is sharp in the hairpin
    // without being nervous on the straight.
    const speedFraction = Math.abs(this.forwardSpeed) / CAR.steerFalloffSpeed;
    const authority = Math.max(CAR.steerFalloffFloor, 1 / (1 + speedFraction));
    const targetSteer = input.steer * CAR.maxSteerRadians * authority;
    const steerRate = input.steer === 0 ? CAR.steerReturnRate : CAR.steerRate;
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, steerRate * dt);

    // ── Split velocity into the heading's frame ─────────────────────────
    let vForward = this.velocity.dot(forward);
    let vLateral = this.velocity.dot(right);

    // ── Surface ─────────────────────────────────────────────────────────
    const onGrass = this.offRoad;
    let grip = onGrass ? CAR.gripGrass : CAR.gripAsphalt;
    if (input.handbrake) grip = Math.min(grip, CAR.gripHandbrake);

    const topSpeed = onGrass ? CAR.topSpeed * CAR.grassTopSpeedFactor : CAR.topSpeed;

    // ── Longitudinal forces ─────────────────────────────────────────────
    if (input.throttle > 0 && !input.handbrake) {
      if (vForward < topSpeed) vForward += CAR.enginePower * input.throttle * dt;
    }

    if (input.brake > 0) {
      if (vForward > 0.4) {
        // Braking while moving forward.
        vForward -= CAR.brakePower * input.brake * dt;
        if (vForward < 0) vForward = 0;
      } else {
        // Stopped or already reversing — the brake pedal becomes reverse.
        vForward -= CAR.reversePower * input.brake * dt;
      }
    }

    if (input.handbrake) {
      // The handbrake locks the rears: strong retardation, and grip is already
      // cut above, which is what makes the tail step out.
      vForward -= CAR.brakePower * 0.42 * dt * Math.sign(vForward || 1);
    }

    if (input.throttle === 0 && input.brake === 0) {
      const engineBrake = CAR.engineBraking * dt;
      vForward -= clamp(vForward, -engineBrake, engineBrake);
    }

    // Resistance: quadratic drag dominates at speed, rolling at walking pace.
    const drag = CAR.dragArea * vForward * vForward + CAR.rollingResistance * Math.abs(vForward);
    const grassDrag = onGrass ? CAR.grassExtraDrag * Math.min(1, Math.abs(vForward) / 20) : 0;
    const resistance = (drag + grassDrag) * dt;
    vForward -= clamp(vForward, -resistance, resistance);

    // Scraping a barrier scrubs speed off.
    if (this.touchingWall) {
      const scrub = CAR.wallScrub * dt;
      vForward -= clamp(vForward, -scrub, scrub);
      if (vForward > CAR.wallSpeedCap) vForward = CAR.wallSpeedCap;
    }

    vForward = clamp(vForward, -CAR.reverseTopSpeed, topSpeed);

    // ── Lateral grip ────────────────────────────────────────────────────
    // Exponential decay, so the amount of slip killed per second is constant
    // regardless of step size.
    vLateral *= Math.exp(-grip * dt);

    // ── Recompose in the OLD frame, then rotate ─────────────────────────
    // Order matters: recomposing before the yaw update is what preserves slip.
    this.velocity.copy(forward).multiplyScalar(vForward).addScaledVector(right, vLateral);

    // Bicycle-model yaw rate: proportional to forward speed, so the car cannot
    // spin on the spot, and it reverses sign correctly when backing up.
    const yawRate = (vForward / CAR.wheelbase) * Math.tan(this.steerAngle) * CAR.yawFromSteer;
    this.yaw += yawRate * dt;

    // ── Integrate ───────────────────────────────────────────────────────
    this.position.addScaledVector(this.velocity, dt);

    // ── Resolve against the track ───────────────────────────────────────
    const sample = this.track.sampleAt(this.position);
    this.trackDistance = sample.distance;
    this.lateral = sample.lateral;
    this.surfaceUp.copy(sample.up);

    const wallLimit = this.track.wallLateral - CAR_HALF_WIDTH;
    this.touchingWall = Math.abs(sample.lateral) > wallLimit;
    if (this.touchingWall) {
      const clamped = clamp(sample.lateral, -wallLimit, wallLimit);
      // Push straight back out along the road's lateral axis...
      this.position.addScaledVector(sample.right, clamped - sample.lateral);
      this.lateral = clamped;
      // ...and kill the velocity component driving into the barrier, so the car
      // slides along it instead of grinding to a halt.
      const into = this.velocity.dot(sample.right);
      if (Math.sign(into) === Math.sign(clamped)) {
        this.velocity.addScaledVector(sample.right, -into);
      }
    }

    this.offRoad = Math.abs(this.lateral) > TRACK.roadHalfWidth;

    // Glue to the surface rather than integrating vertical motion.
    //
    // The mesh is built with the wheel bottoms resting on local y = 0, so the
    // origin *is* the contact plane: the surface height is the whole answer.
    // Adding a ride-height on top of that would float the car above the asphalt.
    //
    // `sample.height` is the height of the *centreline*, and banking tilts the
    // road away from it, so step out along the banked lateral axis by however far
    // off-centre the car is before lifting onto the asphalt. Skipping that buries
    // the inside wheels on a banked corner and floats the outside ones.
    this.position.y = sample.height
      + sample.right.y * this.lateral
      + sample.up.y * TRACK.roadLift;

    // ── Bookkeeping for the HUD and camera ──────────────────────────────
    this.forwardSpeed = vForward;
    this.lateralSpeed = vLateral;
    this.speed = this.velocity.length();
    this.wheelSpin += (vForward / CAR.wheelRadius) * dt;
  }

  /**
   * Push the physics state onto the mesh. Called once per rendered frame
   * rather than per physics step, since nothing reads it in between.
   */
  updateVisuals(dt, input) {
    this.mesh.position.copy(this.position);

    // Orientation: build a basis that sits the car flat on the road surface,
    // with its nose along the heading projected into that surface.
    this.#syncBasis();
    const up = this.surfaceUp;
    const forward = this.#tmp.copy(this.#forward)
      .addScaledVector(up, -this.#forward.dot(up))
      .normalize();
    const right = this.#tmpB.crossVectors(forward, up).normalize();

    // Object3D faces local -Z, so the basis' third column is *backward*.
    BACKWARD.copy(forward).negate();
    this.#targetQuaternion.setFromRotationMatrix(MATRIX.makeBasis(right, up, BACKWARD));

    // Cosmetic lean: roll into the corner from actual slip, squat/dive from
    // acceleration. Purely visual — the physics never sees these.
    const roll = clamp(
      -this.lateralSpeed * CAR.bodyRollFromSlip,
      -CAR.maxBodyRoll, CAR.maxBodyRoll,
    );
    const pitch = clamp(
      (input.brake - input.throttle) * this.speed * CAR.bodyPitchFromAccel,
      -CAR.maxBodyPitch, CAR.maxBodyPitch,
    );
    this.#basisEuler.set(pitch, 0, roll);
    this.#cosmeticQuaternion.setFromEuler(this.#basisEuler);
    this.#targetQuaternion.multiply(this.#cosmeticQuaternion);

    // Damped settle, frame-rate independent.
    this.mesh.quaternion.slerp(
      this.#targetQuaternion,
      1 - Math.exp(-CAR.bodyAlignRate * dt),
    );

    // Wheels. `wheelSpin` is the angle rolled, so it grows as the car moves
    // forward — but forward is local -Z, and a positive rotation about local +X
    // carries the top of the wheel toward +Z. Hence the negation: without it the
    // wheels spin backwards while the car drives forwards.
    for (const pivot of this.steerPivots) pivot.rotation.y = this.steerAngle;
    for (const wheel of this.wheels) wheel.rotation.x = -this.wheelSpin;

    // Brake lights glow under braking or handbrake.
    const braking = input.brake > 0 || input.handbrake;
    for (const light of this.brakeLights) {
      light.material.emissiveIntensity = braking ? 2.6 : 0.55;
    }
  }

  /** Gear number for the HUD. Cosmetic — there is no real gearbox. */
  getGear() {
    if (this.forwardSpeed < -0.5) return 'R';
    if (this.speed < 0.5) return 'N';
    const bounds = CAR.gearRatios;
    for (let i = 1; i < bounds.length; i++) {
      if (this.speed <= bounds[i]) return String(i);
    }
    return String(bounds.length - 1);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }
}

/** Scratch objects shared by `updateVisuals`, which is not re-entrant. */
const MATRIX = new Matrix4();
const BACKWARD = new Vector3();
