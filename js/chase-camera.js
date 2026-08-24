/**
 * Chase camera.
 *
 * Follows the car with exponential damping rather than a fixed lerp factor:
 *
 *     alpha = 1 - exp(-stiffness * dt)
 *
 * A plain `lerp(a, b, 0.1)` per frame converges at a rate that depends on
 * frame rate, so the camera would feel tighter on a 144Hz monitor than a 60Hz
 * one. The exponential form is frame-rate independent — the same stiffness
 * produces the same motion at any refresh rate.
 *
 * The camera also deliberately trails the car's *heading*, not its velocity, so
 * a drift is seen side-on instead of the camera swinging behind the slide.
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
  }

  #desired; #desiredLook; #forward; #initialised;

  get mode() {
    return CAMERA.modes[this.modeIndex];
  }

  cycleMode() {
    this.modeIndex = (this.modeIndex + 1) % CAMERA.modes.length;
    // Don't smooth across a mode change — snap, or the camera sails through the
    // scenery on its way to the new offset.
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

    // Capture this before the flag is cleared below — the FOV needs to know
    // whether this frame is a snap, and by then `#initialised` is always true.
    const snap = !this.#initialised;

    if (snap) {
      this.position.copy(this.#desired);
      this.lookTarget.copy(this.#desiredLook);
      this.#initialised = true;
    } else {
      const alpha = 1 - Math.exp(-mode.stiffness * dt);
      this.position.lerp(this.#desired, alpha);
      // The aim point chases faster than the position, so the car stays framed
      // even when the camera is lagging behind through a fast direction change.
      this.lookTarget.lerp(this.#desiredLook, Math.min(1, alpha * 1.9));
    }

    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookTarget);

    // Widen the lens with speed. Cheap, and it does more for the sense of
    // velocity than any amount of extra scenery.
    const targetFov =
      (CAMERA.fov + (CAMERA.fovAtTopSpeed - CAMERA.fov) * speedFraction) * mode.fovScale;
    const fovAlpha = snap ? 1 : 1 - Math.exp(-4 * dt);
    this.camera.fov += (targetFov - this.camera.fov) * fovAlpha;
    this.camera.updateProjectionMatrix();
  }
}
