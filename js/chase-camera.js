/**
 * Camera controller for Chase and First-Person (FPP) modes.
 *
 * - Chase & Wide modes follow the car with frame-rate independent exponential damping:
 *       alpha = 1 - exp(-stiffness * dt)
 *   trailing the car's heading to deliver a smooth cinematic slide.
 *
 * - FPP (Cockpit and Hood) modes are rigidly locked to the car chassis' visual transform
 *   (car.mesh.quaternion and car.mesh.position). Because there is zero forward/backward spring
 *   lag and orientation moves in lockstep with the car's pitch and roll, the car body and hood
 *   remain completely rock-solid in the frame without any forward/backward shaking, vibrating,
 *   or clipping under acceleration and braking.
 */

import { Vector3 } from 'three';

import { CAMERA, CAR } from './config.js';
import { clamp } from './track.js';

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.modeIndex = 0;

    this.position = new Vector3();
    this.lookTarget = new Vector3();

    this.#desired = new Vector3();
    this.#desiredLook = new Vector3();
    this.#forward = new Vector3();
    this.#initialised = false;

    this.#tmpLocalPos = new Vector3();
    this.#tmpLocalLook = new Vector3();
    this.#camUp = new Vector3();
  }

  #desired; #desiredLook; #forward; #initialised;
  #tmpLocalPos; #tmpLocalLook; #camUp;

  get mode() {
    return CAMERA.modes[this.modeIndex];
  }

  cycleMode() {
    this.modeIndex = (this.modeIndex + 1) % CAMERA.modes.length;
    // Don't smooth across a mode change — snap immediately
    this.#initialised = false;
    return this.mode.name;
  }

  /** Snap straight to the ideal position, e.g. after a reset. */
  snapTo(car) {
    this.#initialised = false;
    this.update(car, 0);
  }

  update(car, dt) {
    const mode = this.mode;

    // ── First-Person Perspective (FPP / Cockpit / Hood) ───────────────────
    if (mode.isFPP) {
      // Direct chassis binding:
      // Computes world position and look target directly from car.mesh.
      // This completely eliminates forward/backward shaking, bouncing, and clipping.
      this.#tmpLocalPos.set(mode.offset[0], mode.offset[1], mode.offset[2]);
      this.#tmpLocalLook.set(0, mode.lookHeight, -mode.lookAhead);

      this.#tmpLocalPos.applyQuaternion(car.mesh.quaternion).add(car.mesh.position);
      this.#tmpLocalLook.applyQuaternion(car.mesh.quaternion).add(car.mesh.position);

      this.position.copy(this.#tmpLocalPos);
      this.lookTarget.copy(this.#tmpLocalLook);
      this.#initialised = true;

      this.camera.position.copy(this.position);
      this.#camUp.set(0, 1, 0).applyQuaternion(car.mesh.quaternion);
      this.camera.up.copy(this.#camUp);
      this.camera.lookAt(this.lookTarget);

      // Keep FOV steady in FPP to prevent perspective breathing distortion
      const targetFov = CAMERA.fov * mode.fovScale;
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
      return;
    }

    // ── 3rd-Person Chase Modes ───────────────────────────────────────────
    const speedFraction = clamp(car.speed / CAR.topSpeed, 0, 1);

    // Car-local basis. Using yaw rather than the mesh quaternion keeps the
    // camera level when the body is leaning into a corner.
    const sinYaw = Math.sin(car.yaw);
    const cosYaw = Math.cos(car.yaw);
    this.#forward.set(-sinYaw, 0, -cosYaw);
    const rightX = cosYaw;
    const rightZ = -sinYaw;

    const [offsetX, offsetY, offsetZ] = mode.offset;
    // Pull back a little as speed rises, which widens the view of what's coming.
    const behind = offsetZ - mode.pullback * speedFraction;

    this.#desired.set(
      car.position.x + rightX * offsetX + this.#forward.x * behind,
      car.position.y + offsetY,
      car.position.z + rightZ * offsetX + this.#forward.z * behind,
    );

    // Lift the camera to stay clear of the road as it rises or falls beneath us.
    this.#desired.y += car.surfaceUp.y < 0.999 ? (1 - car.surfaceUp.y) * 6 : 0;

    this.#desiredLook.set(
      car.position.x + this.#forward.x * mode.lookAhead,
      car.position.y + mode.lookHeight,
      car.position.z + this.#forward.z * mode.lookAhead,
    );

    const snap = !this.#initialised;

    if (snap) {
      this.position.copy(this.#desired);
      this.lookTarget.copy(this.#desiredLook);
      this.#initialised = true;
    } else {
      const alpha = 1 - Math.exp(-mode.stiffness * dt);
      this.position.lerp(this.#desired, alpha);
      this.lookTarget.lerp(this.#desiredLook, Math.min(1, alpha * 1.9));
    }

    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);

    // Widen the lens with speed in 3rd-person chase
    const targetFov =
      (CAMERA.fov + (CAMERA.fovAtTopSpeed - CAMERA.fov) * speedFraction) * mode.fovScale;
    const fovAlpha = snap ? 1 : 1 - Math.exp(-4 * dt);
    this.camera.fov += (targetFov - this.camera.fov) * fovAlpha;
    this.camera.updateProjectionMatrix();
  }
}
