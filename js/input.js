/**
 * Keyboard input.
 *
 * Held keys are tracked as a set and sampled by the game loop, rather than
 * driving the car directly from the event handler — otherwise the car's
 * response would be tied to the OS key-repeat rate.
 *
 * One-shot actions (pause, restart, camera) are queued as edges and drained
 * once per frame, so holding the key doesn't retrigger them.
 */

const DRIVE_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
]);

export class Input {
  constructor(target = window) {
    this.held = new Set();
    this.pressed = new Set();

    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };

    this.onKeyDown = (event) => {
      // Stop the page scrolling out from under the game.
      if (DRIVE_KEYS.has(event.code)) event.preventDefault();
      if (event.repeat) return;
      this.held.add(event.code);
      this.pressed.add(event.code);
    };

    this.onKeyUp = (event) => {
      this.held.delete(event.code);
    };

    // Losing focus mid-corner would otherwise leave the throttle stuck on.
    this.onBlur = () => {
      this.held.clear();
    };

    target.addEventListener('keydown', this.onKeyDown, { passive: false });
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    this.target = target;
  }

  /** Refresh `state` from the currently held keys. */
  sample() {
    const held = this.held;
    const forward = held.has('ArrowUp') || held.has('KeyW');
    const back = held.has('ArrowDown') || held.has('KeyS');
    const left = held.has('ArrowLeft') || held.has('KeyA');
    const right = held.has('ArrowRight') || held.has('KeyD');

    this.state.throttle = forward ? 1 : 0;
    this.state.brake = back ? 1 : 0;
    // Positive steer is left, matching the car's yaw convention.
    this.state.steer = (left ? 1 : 0) - (right ? 1 : 0);
    this.state.handbrake = held.has('Space');
    return this.state;
  }

  /** True once per physical key press. */
  consume(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  /** Drop any presses that nothing handled this frame. */
  endFrame() {
    this.pressed.clear();
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

/** Neutral input, for the countdown and the results screen. */
export const IDLE_INPUT = Object.freeze({
  throttle: 0, brake: 0, steer: 0, handbrake: false,
});
