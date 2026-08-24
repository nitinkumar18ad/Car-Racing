/**
 * HUD.
 *
 * Rendered as DOM/CSS over the canvas rather than drawn in WebGL: crisp text at
 * any resolution, and no font atlas to build. The only exception is the
 * minimap, which is a small 2D canvas because it's a path, not text.
 *
 * Everything here is write-only presentation — it reads game state and never
 * mutates it. Element lookups happen once in the constructor, and text is only
 * assigned when the value actually changes, so a 60fps HUD doesn't thrash
 * layout.
 */

import { CAR, RACE, STORAGE_KEY } from './config.js';

/** `72491` ms -> `1:12.491`. */
export function formatLapTime(milliseconds) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return '—';
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(milliseconds % 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Signed gap, e.g. `-0.482` or `+1.207`. */
function formatDelta(milliseconds) {
  const sign = milliseconds < 0 ? '-' : '+';
  const seconds = Math.abs(milliseconds) / 1000;
  return `${sign}${seconds.toFixed(3)}`;
}

export class Hud {
  constructor(track) {
    this.track = track;

    this.elements = {
      hud: document.getElementById('hud'),
      loading: document.getElementById('loading'),
      lapCurrent: document.getElementById('lap-current'),
      lapTotal: document.getElementById('lap-total'),
      timeCurrent: document.getElementById('time-current'),
      timeLast: document.getElementById('time-last'),
      timeBest: document.getElementById('time-best'),
      delta: document.getElementById('delta'),
      speedValue: document.getElementById('speed-value'),
      gaugeFill: document.getElementById('gauge-fill'),
      gear: document.getElementById('gear'),
      offroad: document.getElementById('offroad'),
      countdown: document.getElementById('countdown'),
      countdownText: document.getElementById('countdown-text'),
      paused: document.getElementById('paused'),
      results: document.getElementById('results'),
      resultsRows: document.getElementById('results-rows'),
      resultsTotal: document.getElementById('results-total'),
      resultsBest: document.getElementById('results-best'),
      fatal: document.getElementById('fatal'),
      fatalMessage: document.getElementById('fatal-message'),
    };

    this.elements.lapTotal.textContent = String(RACE.totalLaps);

    // The gauge arc is a <path>; measuring it once lets stroke-dashoffset act
    // as a 0..1 fill without hard-coding the arc length.
    this.gaugeLength = this.elements.gaugeFill.getTotalLength();
    this.elements.gaugeFill.style.strokeDasharray = String(this.gaugeLength);
    this.elements.gaugeFill.style.strokeDashoffset = String(this.gaugeLength);

    // Cache of last-written values, so we only touch the DOM on change.
    this.shown = {
      speed: -1, gear: '', lap: -1, time: '', last: '', best: '',
      delta: '', offRoad: null, countdown: null,
    };

    this.#setupMinimap();
  }

  /* ── Minimap ─────────────────────────────────────────────────────────── */

  #setupMinimap() {
    const canvas = document.getElementById('minimap');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    // Back the canvas at device resolution so the track line isn't fuzzy.
    const cssSize = canvas.clientWidth || 148;
    canvas.width = cssSize * ratio;
    canvas.height = cssSize * ratio;

    this.minimap = canvas.getContext('2d');
    this.minimapSize = cssSize;
    this.minimap.scale(ratio, ratio);

    // Fit the track's XZ bounding box into the canvas once, with a margin.
    const path = this.track.getMinimapPath(6);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of path) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const margin = 12;
    const usable = cssSize - margin * 2;
    const scale = Math.min(usable / (maxX - minX), usable / (maxZ - minZ));
    const centreX = (minX + maxX) / 2;
    const centreZ = (minZ + maxZ) / 2;

    this.minimapProject = (x, z) => [
      cssSize / 2 + (x - centreX) * scale,
      cssSize / 2 + (z - centreZ) * scale,
    ];
    this.minimapPath = path;

    // The static layer — track outline and start line — is identical every
    // frame, so render it once to an offscreen canvas and blit it.
    const base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const baseCtx = base.getContext('2d');
    baseCtx.scale(ratio, ratio);
    this.#drawTrackOutline(baseCtx);
    this.minimapBase = base;
  }

  #drawTrackOutline(ctx) {
    const project = this.minimapProject;

    ctx.beginPath();
    for (let i = 0; i < this.minimapPath.length; i++) {
      const [x, y] = project(...this.minimapPath[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Wide dark casing under a lighter core reads as a road at 148px.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Start line marker.
    const [sx, sy] = project(...this.minimapPath[0]);
    ctx.fillStyle = '#ffc93c';
    ctx.beginPath();
    ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  #drawMinimap(car) {
    const ctx = this.minimap;
    const size = this.minimapSize;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.minimapBase, 0, 0, size, size);

    const [x, y] = this.minimapProject(car.position.x, car.position.z);

    // Heading wedge, so the dot shows which way the car is pointing.
    ctx.save();
    ctx.translate(x, y);
    // Screen +y maps to world +z, so the wedge angle comes from the car's
    // forward vector directly rather than from yaw.
    ctx.rotate(Math.atan2(-Math.sin(car.yaw), -Math.cos(car.yaw)) + Math.PI / 2);
    ctx.fillStyle = '#ff5a4d';
    ctx.beginPath();
    ctx.moveTo(6.5, 0);
    ctx.lineTo(-4, 3.6);
    ctx.lineTo(-4, -3.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /* ── Per-frame update ────────────────────────────────────────────────── */

  update(car, race) {
    const el = this.elements;
    const shown = this.shown;

    const speed = Math.round(car.speedKmh);
    if (speed !== shown.speed) {
      el.speedValue.textContent = String(speed);
      const fraction = Math.min(1, car.speed / CAR.topSpeed);
      el.gaugeFill.style.strokeDashoffset = String(this.gaugeLength * (1 - fraction));
      shown.speed = speed;
    }

    const gear = car.getGear();
    if (gear !== shown.gear) {
      el.gear.textContent = gear;
      shown.gear = gear;
    }

    const lap = Math.min(race.lap, RACE.totalLaps);
    if (lap !== shown.lap) {
      el.lapCurrent.textContent = String(lap);
      shown.lap = lap;
    }

    const current = formatLapTime(race.lapElapsed);
    if (current !== shown.time) {
      el.timeCurrent.textContent = current;
      shown.time = current;
    }

    const last = formatLapTime(race.lastLap);
    if (last !== shown.last) {
      el.timeLast.textContent = last;
      shown.last = last;
    }

    const best = formatLapTime(race.bestLap);
    if (best !== shown.best) {
      el.timeBest.textContent = best;
      shown.best = best;
    }

    // Delta against your best lap, only once there is a best to compare to.
    let delta = '';
    let deltaClass = '';
    if (race.bestLap != null && race.lastLap != null) {
      const gap = race.lastLap - race.bestLap;
      if (gap === 0) {
        delta = 'BEST LAP';
        deltaClass = 'faster';
      } else {
        delta = formatDelta(gap);
        deltaClass = gap < 0 ? 'faster' : 'slower';
      }
    }
    if (delta !== shown.delta) {
      el.delta.textContent = delta;
      el.delta.className = `delta ${deltaClass}`;
      shown.delta = delta;
    }

    const offRoad = car.offRoad && car.speed > 2;
    if (offRoad !== shown.offRoad) {
      el.offroad.classList.toggle('show', offRoad);
      shown.offRoad = offRoad;
    }

    this.#drawMinimap(car);
  }

  /* ── Screens ─────────────────────────────────────────────────────────── */

  hideLoading() {
    this.elements.loading.classList.add('hidden');
    this.elements.hud.classList.remove('hidden');
  }

  /** `value` is 3, 2, 1 or the string 'GO', or null to hide. */
  showCountdown(value) {
    const el = this.elements;
    if (value === null) {
      el.countdown.classList.add('hidden');
      this.shown.countdown = null;
      return;
    }
    if (value === this.shown.countdown) return;
    this.shown.countdown = value;

    el.countdown.classList.remove('hidden');
    el.countdownText.textContent = String(value);
    el.countdownText.classList.toggle('go', value === 'GO');
    // Restarting a CSS animation requires forcing a reflow between removing and
    // re-adding it; reading offsetWidth is the standard way to do that.
    el.countdownText.style.animation = 'none';
    void el.countdownText.offsetWidth;
    el.countdownText.style.animation = '';
  }

  setPaused(paused) {
    this.elements.paused.classList.toggle('hidden', !paused);
  }

  showResults(race) {
    const el = this.elements;
    el.resultsRows.innerHTML = '';

    const fastest = race.laps.length ? Math.min(...race.laps) : null;
    race.laps.forEach((time, index) => {
      const row = document.createElement('tr');
      if (time === fastest) row.className = 'best';
      row.innerHTML = `<td>Lap ${index + 1}</td><td>${formatLapTime(time)}</td>`;
      el.resultsRows.appendChild(row);
    });

    const total = race.laps.reduce((sum, time) => sum + time, 0);
    el.resultsTotal.textContent = formatLapTime(total);
    el.resultsBest.textContent = race.setNewRecord ? 'New personal best' : '';
    el.results.classList.remove('hidden');
  }

  hideResults() {
    this.elements.results.classList.add('hidden');
  }

  showFatal(message) {
    this.elements.loading.classList.add('hidden');
    this.elements.fatalMessage.textContent = message;
    this.elements.fatal.classList.remove('hidden');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Best-lap persistence
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * localStorage throws in a few real situations — Safari private browsing, and
 * any `file://` page — so both of these swallow failures. A missing best lap is
 * a cosmetic loss, not a reason to refuse to start.
 */
export function loadBestLap() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const value = stored === null ? NaN : Number(stored);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveBestLap(milliseconds) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(milliseconds)));
  } catch {
    /* Non-fatal: the session keeps its best lap in memory regardless. */
  }
}
