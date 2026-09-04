/**
 * Game state machine, lap timing and the fixed-timestep loop.
 *
 * ── Why lap counting works the way it does ────────────────────────────────
 * The obvious implementation — "fire a lap when `distance` jumps from near the
 * end of the track to near the start" — breaks in two ways that players find
 * immediately: idling on the start line double-counts as the value jitters
 * across the boundary, and reversing over the line hands out a free lap.
 *
 * Instead this accumulates *signed* progress into `totalDistance`, unwrapping
 * the jump at the seam each step, and completes a lap only once that total has
 * advanced a full track length past where the current lap began. Jitter at the
 * line can't retrigger (you'd have to drive another full lap to earn it), and
 * reversing genuinely subtracts progress.
 */

import { RACE, RENDER } from './config.js';
import { IDLE_INPUT } from './input.js';
import { loadBestLap, saveBestLap } from './hud.js';

export const State = {
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  PAUSED: 'paused',
  FINISHED: 'finished',
};

export class Game {
  constructor({ track, car, camera, hud, input, onModeChange }) {
    this.track = track;
    this.car = car;
    this.camera = camera;
    this.hud = hud;
    this.input = input;
    this.onModeChange = onModeChange;

    this.bestLap = loadBestLap(this.track.mode.storageKey);
    this.accumulator = 0;

    this.reset();
  }

  /** Return everything to the grid and restart the countdown. */
  reset() {
    this.car.reset();
    this.camera.snapTo(this.car);

    this.state = State.COUNTDOWN;
    this.countdownRemaining = RACE.countdownSeconds + 1; // +1 for the "GO" beat
    this.raceTime = 0;
    this.accumulator = 0;

    this.lap = 1;
    this.laps = [];
    this.lastLap = null;
    this.setNewRecord = false;

    // Progress tracking. `previousDistance` seeds from wherever the car
    // actually sits so the first step doesn't see a false jump.
    this.previousDistance = this.car.trackDistance;
    this.totalDistance = 0;
    this.lapStartTotal = 0;
    this.lapStartTime = 0;

    this.hud.hideResults();
    this.hud.setPaused(false);
    this.hud.showCountdown(RACE.countdownSeconds);
  }

  get lapElapsed() {
    if (this.state === State.COUNTDOWN) return 0;
    return (this.raceTime - this.lapStartTime) * 1000;
  }

  /** Snapshot the HUD reads each frame. */
  get raceState() {
    return {
      lap: this.lap,
      laps: this.laps,
      lastLap: this.lastLap,
      bestLap: this.bestLap,
      lapElapsed: this.lapElapsed,
      setNewRecord: this.setNewRecord,
      label: this.track.mode.label,
      totalLaps: this.track.mode.totalLaps,
      resultsTitle: this.track.mode.resultsTitle,
    };
  }

  /* ── Frame ───────────────────────────────────────────────────────────── */

  /**
   * Advance one rendered frame.
   *
   * Physics runs on a fixed step so handling is identical at 60Hz and 144Hz;
   * only the leftover time carries into the next frame. `maxFrameTime` caps how
   * much is simulated at once, so returning from an alt-tab doesn't fast-forward
   * the car through a barrier.
   */
  update(frameTime) {
    this.#handleActions();

    const input = this.#currentInput();
    const dt = Math.min(frameTime, RENDER.maxFrameTime);

    if (this.state === State.COUNTDOWN) {
      this.countdownRemaining -= dt;
      const beat = Math.ceil(this.countdownRemaining) - 1;
      this.hud.showCountdown(beat <= 0 ? 'GO' : beat);

      if (this.countdownRemaining <= 0) {
        this.state = State.RACING;
        this.hud.showCountdown(null);
      }
    }

    if (this.state !== State.PAUSED) {
      this.accumulator += dt;
      let steps = 0;
      // Hard step ceiling as a second line of defence against a runaway
      // accumulator on a very slow frame.
      const maxSteps = Math.ceil(RENDER.maxFrameTime / RENDER.fixedStep);

      while (this.accumulator >= RENDER.fixedStep && steps < maxSteps) {
        this.car.step(RENDER.fixedStep, input);

        if (this.state === State.RACING) {
          this.raceTime += RENDER.fixedStep;
          this.#trackProgress();
        }

        this.accumulator -= RENDER.fixedStep;
        steps++;
      }
      if (steps >= maxSteps) this.accumulator = 0;

      this.car.updateVisuals(dt, input);
      this.camera.update(this.car, dt);
    }

    this.hud.update(this.car, this.raceState);
    this.input.endFrame();
  }

  #currentInput() {
    if (this.state === State.RACING) return this.input.sample();
    if (this.state === State.FINISHED) {
      // Let the car coast to a stop rather than freezing mid-corner.
      return { throttle: 0, brake: 0.35, steer: 0, handbrake: false };
    }
    // Countdown and paused: keep sampling so held keys don't get stuck, but
    // ignore what they say.
    this.input.sample();
    return IDLE_INPUT;
  }

  /* ── Progress and laps ───────────────────────────────────────────────── */

  #trackProgress() {
    const length = this.track.length;
    let delta = this.car.trackDistance - this.previousDistance;

    if (this.track.closed) {
      // Unwrap the seam: a delta larger than half the track means we crossed it
      // rather than teleported.
      if (delta > length / 2) delta -= length;
      else if (delta < -length / 2) delta += length;
    }

    this.totalDistance += delta;
    this.previousDistance = this.car.trackDistance;

    if (this.track.closed && this.totalDistance - this.lapStartTotal >= length) {
      this.#completeLap();
    } else if (!this.track.closed && this.totalDistance >= length - 2) {
      this.#completeLap();
    }
  }

  #completeLap() {
    const lapTime = (this.raceTime - this.lapStartTime) * 1000;
    this.laps.push(lapTime);
    this.lastLap = lapTime;

    if (this.bestLap == null || lapTime < this.bestLap) {
      this.bestLap = lapTime;
      this.setNewRecord = true;
      saveBestLap(lapTime, this.track.mode.storageKey);
    }

    this.lapStartTotal += this.track.length;
    this.lapStartTime = this.raceTime;
    this.lap++;

    if (this.lap > this.track.mode.totalLaps) {
      this.state = State.FINISHED;
      this.lap = this.track.mode.totalLaps;
      this.hud.showResults(this.raceState);
    }
  }

  /* ── One-shot keys ───────────────────────────────────────────────────── */

  #handleActions() {
    if (this.input.consume('KeyR')) {
      this.reset();
      return;
    }

    if (this.input.consume('KeyC')) {
      this.camera.cycleMode();
    }

    if (this.input.consume('KeyM') && this.onModeChange) {
      this.onModeChange();
      return;
    }

    if (this.input.consume('KeyP') || this.input.consume('Escape')) {
      if (this.state === State.PAUSED) {
        this.state = this.resumeState;
        this.hud.setPaused(false);
      } else if (this.state === State.RACING || this.state === State.COUNTDOWN) {
        this.resumeState = this.state;
        this.state = State.PAUSED;
        this.hud.setPaused(true);
      }
    }
  }
}
