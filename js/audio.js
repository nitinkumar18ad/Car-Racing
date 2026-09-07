/**
 * Procedural Audio Engine for Apex Circuit.
 *
 * Synthesizes realistic motorsport sound in real-time using the Web Audio API:
 * - Multi-harmonic engine oscillator array (fundamental cylinder firings, sub-bass rumble, mechanical overtone)
 * - Dynamic throttle body intake filter (opens up during acceleration for visceral throatiness)
 * - Waveshaping soft-saturation curve for exhaust rasp and metallic grit
 * - Gear-ratio RPM simulation with authentic shift drops
 * - Procedural tire slip / screech generator for drifts and hard launches
 * - High-speed aerodynamic wind rush
 * - Automatic Web Audio autoplay-policy resume on first user interaction
 */

import { CAR } from './config.js';

/** Generate soft-clip distortion curve to give engine harmonics mechanical bite. */
function makeDistortionCurve(amount = 20) {
  const n = 512;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/** Create a 2-second looped white noise buffer for procedural wind and tire skid. */
function createNoiseBuffer(ctx) {
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

const STORAGE_KEY_MUTED = 'car-racing-game:muted';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.muted = false;

    try {
      this.muted = window.localStorage.getItem(STORAGE_KEY_MUTED) === 'true';
    } catch {
      this.muted = false;
    }

    // Engine simulation state
    this.rpm = 900;
    this.previousGear = 1;
    this.shiftDropTime = 0;

    // Hook user gestures to resume audio context automatically
    this.#setupGestureUnlock();
  }

  #setupGestureUnlock() {
    const unlock = () => {
      if (!this.ctx) {
        this.#initAudio();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    };

    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('click', unlock, { passive: true });
  }

  #initAudio() {
    if (this.isInitialized) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      this.ctx = ctx;

      // ── Master Gain ───────────────────────────────────────────────────────
      this.masterGain = ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.95, ctx.currentTime);
      this.masterGain.connect(ctx.destination);

      // ── Engine Synthesizer ───────────────────────────────────────────────
      this.engineGain = ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.001, ctx.currentTime);

      // Throttle filter: Low-pass filter that opens up wide when accelerating
      this.throttleFilter = ctx.createBiquadFilter();
      this.throttleFilter.type = 'lowpass';
      this.throttleFilter.frequency.setValueAtTime(320, ctx.currentTime);
      this.throttleFilter.Q.setValueAtTime(2.2, ctx.currentTime);

      // Engine cavity resonance: Peaking filter around 420 Hz
      this.bodyResonance = ctx.createBiquadFilter();
      this.bodyResonance.type = 'peaking';
      this.bodyResonance.frequency.setValueAtTime(420, ctx.currentTime);
      this.bodyResonance.Q.setValueAtTime(2.0, ctx.currentTime);
      this.bodyResonance.gain.setValueAtTime(6.0, ctx.currentTime);

      // Waveshaper for exhaust overdrive and rasp
      this.distortion = ctx.createWaveShaper();
      this.distortion.curve = makeDistortionCurve(16);
      this.distortion.oversample = '2x';

      // Primary cylinder pulses (sawtooth)
      this.oscMain = ctx.createOscillator();
      this.oscMain.type = 'sawtooth';
      this.oscMain.frequency.setValueAtTime(45, ctx.currentTime);

      // Sub-bass engine rumble (triangle)
      this.oscSub = ctx.createOscillator();
      this.oscSub.type = 'triangle';
      this.oscSub.frequency.setValueAtTime(22.5, ctx.currentTime);

      // Mid mechanical overtone (sawtooth, 1.5x harmonic)
      this.oscMid = ctx.createOscillator();
      this.oscMid.type = 'sawtooth';
      this.oscMid.frequency.setValueAtTime(67.5, ctx.currentTime);

      // High screaming overtone (sine, 3.0x harmonic)
      this.oscHigh = ctx.createOscillator();
      this.oscHigh.type = 'sine';
      this.oscHigh.frequency.setValueAtTime(135, ctx.currentTime);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.75, ctx.currentTime);

      const mainGain = ctx.createGain();
      mainGain.gain.setValueAtTime(0.55, ctx.currentTime);

      const midGain = ctx.createGain();
      midGain.gain.setValueAtTime(0.35, ctx.currentTime);

      const highGain = ctx.createGain();
      highGain.gain.setValueAtTime(0.20, ctx.currentTime);

      this.oscSub.connect(subGain);
      this.oscMain.connect(mainGain);
      this.oscMid.connect(midGain);
      this.oscHigh.connect(highGain);

      const oscSum = ctx.createGain();
      subGain.connect(oscSum);
      mainGain.connect(oscSum);
      midGain.connect(oscSum);
      highGain.connect(oscSum);

      oscSum.connect(this.distortion);
      this.distortion.connect(this.bodyResonance);
      this.bodyResonance.connect(this.throttleFilter);
      this.throttleFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.oscSub.start();
      this.oscMain.start();
      this.oscMid.start();
      this.oscHigh.start();

      // ── Tire Skid / Drift Synthesizer ────────────────────────────────────
      const noiseBuffer = createNoiseBuffer(ctx);

      this.skidSource = ctx.createBufferSource();
      this.skidSource.buffer = noiseBuffer;
      this.skidSource.loop = true;

      this.skidFilter = ctx.createBiquadFilter();
      this.skidFilter.type = 'bandpass';
      this.skidFilter.frequency.setValueAtTime(1050, ctx.currentTime);
      this.skidFilter.Q.setValueAtTime(3.2, ctx.currentTime);

      this.skidGain = ctx.createGain();
      this.skidGain.gain.setValueAtTime(0, ctx.currentTime);

      this.skidSource.connect(this.skidFilter);
      this.skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.masterGain);
      this.skidSource.start();

      // ── Wind Rush Synthesizer ────────────────────────────────────────────
      this.windSource = ctx.createBufferSource();
      this.windSource.buffer = noiseBuffer;
      this.windSource.loop = true;

      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.setValueAtTime(450, ctx.currentTime);
      this.windFilter.Q.setValueAtTime(1.0, ctx.currentTime);

      this.windGain = ctx.createGain();
      this.windGain.gain.setValueAtTime(0, ctx.currentTime);

      this.windSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      this.windSource.start();

      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio could not be initialized:', e);
    }
  }

  /**
   * Main audio update loop: computes engine RPM, throttle roar, pitch, and tyre noise.
   */
  update(car, input, dt, isPaused = false) {
    if (!this.ctx) {
      if (input.throttle > 0 || input.brake > 0 || input.steer !== 0) {
        this.#initAudio();
      }
      return;
    }

    if (this.ctx.state === 'suspended') {
      if (input.throttle > 0 || input.brake > 0 || input.steer !== 0) {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const now = this.ctx.currentTime;
    const timeConstant = 0.045; // Smooth param interpolation time

    if (isPaused) {
      this.engineGain.gain.setTargetAtTime(0.001, now, 0.1);
      this.skidGain.gain.setTargetAtTime(0, now, 0.05);
      this.windGain.gain.setTargetAtTime(0, now, 0.1);
      return;
    }

    const speed = Math.max(0, car.speed);
    const forwardSpeed = car.forwardSpeed;
    const throttle = Math.max(0, Math.min(1, input.throttle));
    const brake = Math.max(0, Math.min(1, input.brake));
    const handbrake = input.handbrake;

    // ── Gear & RPM Calculation ───────────────────────────────────────────
    const bounds = CAR.gearRatios; // [0, 12, 22, 34, 48, 62, 78]
    let currentGear = 1;
    for (let i = 1; i < bounds.length; i++) {
      if (speed <= bounds[i]) {
        currentGear = i;
        break;
      }
    }
    if (speed > bounds[bounds.length - 1]) currentGear = bounds.length - 1;

    // Gear shift detect: momentary drop in revs for authentic shifting feel
    if (currentGear !== this.previousGear && speed > 5) {
      this.shiftDropTime = 0.09;
      this.previousGear = currentGear;
    }
    if (this.shiftDropTime > 0) {
      this.shiftDropTime -= dt;
    }

    const lowerSpeed = bounds[currentGear - 1];
    const upperSpeed = bounds[currentGear];
    const gearSpan = Math.max(1, upperSpeed - lowerSpeed);
    const gearFraction = Math.min(1, Math.max(0, (speed - lowerSpeed) / gearSpan));

    // Target RPM
    let targetRpm = 880; // Idle RPM
    if (forwardSpeed < -0.4) {
      // Reversing
      const revRatio = Math.min(1, Math.abs(forwardSpeed) / CAR.reverseTopSpeed);
      targetRpm = 1100 + revRatio * 5200;
    } else if (speed < 1.0 && throttle > 0) {
      // Launching / slipping clutch at standstill: immediate rev build-up!
      targetRpm = 1100 + throttle * 3400;
    } else {
      // Forward driving
      const gearBaseRpm = currentGear === 1 ? 1200 : 2600 + currentGear * 180;
      const gearMaxRpm = 7600;
      targetRpm = gearBaseRpm + gearFraction * (gearMaxRpm - gearBaseRpm);

      // Off-throttle engine deceleration overrun
      if (throttle === 0 && speed > 2) {
        targetRpm = Math.max(1000, targetRpm * 0.82);
      }
    }

    // Shift drop transient
    if (this.shiftDropTime > 0) {
      targetRpm *= 0.72;
    }

    // Rotational inertia smoothing (fast rev-up on throttle, natural run-down)
    const smoothing = throttle > 0 ? 14 : 7.5;
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-smoothing * dt));
    this.rpm = Math.max(800, Math.min(8400, this.rpm));

    // ── Frequency Mapping (6-Cylinder Firing Pulse) ───────────────────────
    // Fundamental firing frequency f0 = (RPM / 60) * 3
    const f0 = (this.rpm / 60) * 2.85;
    this.oscMain.frequency.setTargetAtTime(f0, now, timeConstant);
    this.oscSub.frequency.setTargetAtTime(f0 * 0.5, now, timeConstant);
    this.oscMid.frequency.setTargetAtTime(f0 * 1.5, now, timeConstant);
    this.oscHigh.frequency.setTargetAtTime(f0 * 3.0, now, timeConstant);

    // ── Acceleration & Throttle Roar (Filter & Gain) ───────────────────────
    // Lowpass cutoff sweeps up dramatically as throttle and speed increase
    const speedRatio = Math.min(1, speed / CAR.topSpeed);
    const accelIntensity = throttle * 0.7 + speedRatio * 0.3;

    // Filter frequency: 320 Hz at idle -> 4600 Hz under full acceleration
    const targetCutoff = 320 + Math.pow(accelIntensity, 1.2) * 4300;
    this.throttleFilter.frequency.setTargetAtTime(targetCutoff, now, timeConstant);

    // Filter resonance peaks under hard acceleration for throaty intake bark
    const targetQ = 1.8 + throttle * 2.4;
    this.throttleFilter.Q.setTargetAtTime(targetQ, now, timeConstant);

    // Engine volume: quiet idle rumble -> rich loud roar under acceleration & speed
    const baseVolume = 0.22;
    const accelVolumeBonus = throttle * 0.38 + speedRatio * 0.25;
    const targetEngineGain = (baseVolume + accelVolumeBonus) * (this.muted ? 0 : 1);
    this.engineGain.gain.setTargetAtTime(targetEngineGain, now, timeConstant);

    // ── Tyre Skid & Drift Noise ───────────────────────────────────────────
    const lateralSpeed = Math.abs(car.lateralSpeed);
    const isSkidding = (lateralSpeed > 2.8 || (handbrake && speed > 2));
    let skidAmount = 0;
    if (isSkidding) {
      const slipRatio = Math.min(1, (lateralSpeed - 2.5) / 9.0);
      skidAmount = handbrake ? Math.max(0.4, slipRatio) : slipRatio;
    }
    const targetSkidGain = skidAmount * 0.35 * (this.muted ? 0 : 1);
    this.skidGain.gain.setTargetAtTime(targetSkidGain, now, 0.03);
    this.skidFilter.frequency.setTargetAtTime(900 + speedRatio * 400, now, 0.05);

    // ── Aerodynamic Wind Rush ─────────────────────────────────────────────
    let windAmount = 0;
    if (speed > 12) {
      windAmount = Math.min(1, (speed - 12) / (CAR.topSpeed - 12));
    }
    const targetWindGain = Math.pow(windAmount, 1.8) * 0.28 * (this.muted ? 0 : 1);
    this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.06);
    this.windFilter.frequency.setTargetAtTime(350 + windAmount * 900, now, 0.06);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted) {
    this.muted = !!muted;
    try {
      window.localStorage.setItem(STORAGE_KEY_MUTED, String(this.muted));
    } catch { /* Non-fatal */ }

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.95, this.ctx.currentTime, 0.05);
    }
  }

  dispose() {
    if (this.ctx) {
      try { this.ctx.close(); } catch {}
      this.ctx = null;
    }
    this.isInitialized = false;
  }
}
