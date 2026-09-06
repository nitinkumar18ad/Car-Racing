/**
 * Procedural textures.
 *
 * Every surface in the game is drawn onto an offscreen 2D canvas and handed to
 * three.js as a CanvasTexture. That keeps the project asset-free: nothing to
 * download, nothing to 404, and the whole look is tunable in code.
 *
 * All of these tile along the V axis (which runs along the track), so the
 * repeat counts in config.js control how fast detail streams past you.
 */

import {
  CanvasTexture, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace, LinearFilter,
} from 'three';

import { WORLD } from './config.js';

/** Allocate a canvas and hand back its 2D context. */
function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

/**
 * Wrap a canvas as a colour texture.
 * Colour textures must declare sRGB or three will double-apply gamma and
 * everything comes out washed out.
 */
function toTexture(canvas, { repeatX = 1, repeatY = 1, anisotropy = 8 } = {}) {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/** Deterministic pseudo-random so textures look identical on every reload. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — plenty of quality for scattering noise pixels.
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 0xffffffff;
  };
}

/** Speckle a region with translucent dots to break up flat fills. */
function speckle(ctx, { x = 0, y = 0, w, h, count, random, colors, minSize = 1, maxSize = 3 }) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(random() * colors.length) | 0];
    const size = minSize + random() * (maxSize - minSize);
    ctx.fillRect(x + random() * w, y + random() * h, size, size);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Asphalt — the road surface, with lane markings baked in.

   The texture spans the full road width in U, so lane lines land at fixed
   fractions of the road no matter how wide roadHalfWidth is set.
   ══════════════════════════════════════════════════════════════════════════ */

export function createAsphaltTexture(repeatY) {
  const W = 512;
  const H = 512;
  const ctx = surface(W, H);
  const random = makeRandom(0x5eed1);

  ctx.fillStyle = '#3a3d44';
  ctx.fillRect(0, 0, W, H);

  // Coarse tonal patches, so the road doesn't look like flat grey plastic.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.012 + random() * 0.03})`;
    const r = 24 + random() * 78;
    ctx.beginPath();
    ctx.ellipse(random() * W, random() * H, r, r * (0.5 + random() * 0.7), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + random() * 0.05})`;
    const r = 18 + random() * 64;
    ctx.beginPath();
    ctx.ellipse(random() * W, random() * H, r, r * (0.5 + random() * 0.8), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Aggregate grain.
  speckle(ctx, {
    w: W, h: H, count: 22000, random, minSize: 1, maxSize: 2.4,
    colors: ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.09)', 'rgba(190,196,206,0.05)', 'rgba(255,255,255,0.025)'],
  });

  // A darker racing line down the middle — subtle tyre-rubber staining.
  const stain = ctx.createLinearGradient(0, 0, W, 0);
  stain.addColorStop(0.00, 'rgba(0,0,0,0)');
  stain.addColorStop(0.30, 'rgba(0,0,0,0.055)');
  stain.addColorStop(0.50, 'rgba(0,0,0,0.085)');
  stain.addColorStop(0.70, 'rgba(0,0,0,0.055)');
  stain.addColorStop(1.00, 'rgba(0,0,0,0)');
  ctx.fillStyle = stain;
  ctx.fillRect(0, 0, W, H);

  // Solid white edge lines, inset slightly from the asphalt boundary.
  ctx.fillStyle = 'rgba(232,236,242,0.80)';
  const edgeInset = W * 0.045;
  const edgeWidth = W * 0.016;
  ctx.fillRect(edgeInset, 0, edgeWidth, H);
  ctx.fillRect(W - edgeInset - edgeWidth, 0, edgeWidth, H);

  // Dashed centre line. Two dashes per tile keeps the rhythm even when tiled.
  ctx.fillStyle = 'rgba(240,242,246,0.72)';
  const dashWidth = W * 0.013;
  const dashX = W / 2 - dashWidth / 2;
  const dashLength = H * 0.30;
  const dashGap = H * 0.20;
  for (let y = 0; y < H; y += dashLength + dashGap) {
    ctx.fillRect(dashX, y, dashWidth, Math.min(dashLength, H - y));
  }

  // Hairline cracks for close-up interest.
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    let x = random() * W;
    let y = random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 4 + ((random() * 6) | 0);
    for (let s = 0; s < steps; s++) {
      x += (random() - 0.5) * 60;
      y += (random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  return toTexture(ctx.canvas, { repeatX: 1, repeatY });
}

/* ══════════════════════════════════════════════════════════════════════════
   Kerb — red/white rumble strip.
   Striped along V so the pattern flickers past at speed.
   ══════════════════════════════════════════════════════════════════════════ */

export function createKerbTexture(repeatY) {
  const W = 32;
  const H = 128;
  const ctx = surface(W, H);

  ctx.fillStyle = '#e8ecf2';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c9302c';
  ctx.fillRect(0, 0, W, H / 2);

  // Bevel the inner edge so the kerb reads as raised, not painted on.
  const bevel = ctx.createLinearGradient(0, 0, W, 0);
  bevel.addColorStop(0.00, 'rgba(0,0,0,0.30)');
  bevel.addColorStop(0.28, 'rgba(0,0,0,0)');
  bevel.addColorStop(0.80, 'rgba(255,255,255,0.10)');
  bevel.addColorStop(1.00, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = bevel;
  ctx.fillRect(0, 0, W, H);

  return toTexture(ctx.canvas, { repeatX: 1, repeatY });
}

/* ══════════════════════════════════════════════════════════════════════════
   Grass — the verge either side of the track.
   ══════════════════════════════════════════════════════════════════════════ */

export function createGrassTexture(repeatX, repeatY) {
  const W = 256;
  const H = 256;
  const ctx = surface(W, H);
  const random = makeRandom(0x9a5511);

  ctx.fillStyle = '#5f7344';
  ctx.fillRect(0, 0, W, H);

  // Broad mown patches in alternating tones.
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = random() > 0.5
      ? `rgba(126,150,86,${0.10 + random() * 0.20})`
      : `rgba(62,80,44,${0.10 + random() * 0.22})`;
    const r = 20 + random() * 70;
    ctx.beginPath();
    ctx.ellipse(random() * W, random() * H, r, r * (0.4 + random() * 0.8), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Individual blades, drawn as short strokes at varied angles.
  for (let i = 0; i < 4200; i++) {
    const shade = 0.10 + random() * 0.30;
    ctx.strokeStyle = random() > 0.42
      ? `rgba(140,168,96,${shade})`
      : `rgba(52,70,38,${shade})`;
    ctx.lineWidth = 1;
    const x = random() * W;
    const y = random() * H;
    const len = 2 + random() * 5;
    const angle = -Math.PI / 2 + (random() - 0.5) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  return toTexture(ctx.canvas, { repeatX, repeatY });
}

/* ══════════════════════════════════════════════════════════════════════════
   Barrier wall — red/white armco chevrons.
   ══════════════════════════════════════════════════════════════════════════ */

export function createWallTexture(repeatX) {
  const W = 128;
  const H = 64;
  const ctx = surface(W, H);

  ctx.fillStyle = '#eef1f5';
  ctx.fillRect(0, 0, W, H);

  // Diagonal hazard stripes. Drawn wide and clipped so the edges stay clean.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.strokeStyle = '#cf3b34';
  ctx.lineWidth = 22;
  for (let x = -H; x < W + H; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x, H + 10);
    ctx.lineTo(x + H + 20, -10);
    ctx.stroke();
  }
  ctx.restore();

  // Horizontal shading: darker at the base, catching light along the top rail.
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0.00, 'rgba(255,255,255,0.16)');
  shade.addColorStop(0.35, 'rgba(0,0,0,0)');
  shade.addColorStop(1.00, 'rgba(0,0,0,0.36)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  return toTexture(ctx.canvas, { repeatX, repeatY: 1 });
}

/* ══════════════════════════════════════════════════════════════════════════
   Start / finish chequer & timing line.
   Not tiled — one texture spanning the whole strip, so ClampToEdge.
   ══════════════════════════════════════════════════════════════════════════ */

export function createStartLineTexture() {
  const squares = 24;
  const rows = 4;
  const cell = 32;
  const W = squares * cell;
  const H = rows * cell;
  const ctx = surface(W, H);

  // Background white
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  // Dark chequer tiles
  ctx.fillStyle = '#0f1217';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < squares; col++) {
      if ((row + col) % 2 === 0) {
        ctx.fillRect(col * cell, row * cell, cell, cell);
      }
    }
  }

  // Solid white timing boundary lines on leading and trailing edges
  const borderHeight = Math.max(4, Math.round(cell * 0.18));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, borderHeight);
  ctx.fillRect(0, H - borderHeight, W, borderHeight);

  // Subtle tire skid overlay on the line for realism
  const random = makeRandom(0x4a18f);
  ctx.fillStyle = 'rgba(10, 12, 16, 0.16)';
  for (let t = 0; t < 6; t++) {
    const tx = (0.15 + random() * 0.7) * W;
    const tw = 28 + random() * 40;
    ctx.fillRect(tx, 0, tw, H);
  }

  const texture = new CanvasTexture(ctx.canvas);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/* ══════════════════════════════════════════════════════════════════════════
   Motorsport Gantry Banner Texture
   High-resolution double-sided banner for start/finish gantries.
   ══════════════════════════════════════════════════════════════════════════ */

export function createGantryBannerTexture({ title = 'START / FINISH', subtitle = 'APEX GRAND PRIX CIRCUIT', isFinish = false } = {}) {
  const W = 1024;
  const H = 256;
  const ctx = surface(W, H);

  // Carbon fiber dark woven background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#10141b');
  bgGrad.addColorStop(0.5, '#181d26');
  bgGrad.addColorStop(1, '#0c0f14');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Carbon weave micro-pattern
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 8) {
      if ((x + y) % 8 === 0) ctx.fillRect(x, y, 4, 4);
    }
  }

  // Accent borders: gold/cyan/red racing stripes
  const accentColor = isFinish ? '#ff2a4b' : '#f5c400';
  const secondaryAccent = isFinish ? '#ffffff' : '#00e5ff';

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, W, 10);
  ctx.fillRect(0, H - 10, W, 10);

  ctx.fillStyle = secondaryAccent;
  ctx.fillRect(0, 10, W, 3);
  ctx.fillRect(0, H - 13, W, 3);

  // Checkered side flags
  const flagCols = 8;
  const flagRows = 6;
  const fw = 14;
  const fh = Math.round((H - 36) / flagRows);

  for (const side of [0, 1]) {
    const startX = side === 0 ? 20 : W - 20 - flagCols * fw;
    for (let r = 0; r < flagRows; r++) {
      for (let c = 0; c < flagCols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#14181f';
        ctx.fillRect(startX + c * fw, 18 + r * fh, fw, fh);
      }
    }
  }

  // Glowing center title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Subtitle (circuit/timing label)
  ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillStyle = accentColor;
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = 10;
  ctx.fillText(subtitle, W / 2, 70);

  // Main bold title
  ctx.font = '900 italic 94px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, W / 2, 145);

  // Inner glow stroke
  ctx.lineWidth = 3;
  ctx.strokeStyle = accentColor;
  ctx.strokeText(title, W / 2, 145);
  ctx.shadowBlur = 0;

  // Bottom timing bar indicator
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.fillRect(W / 2 - 280, 205, 560, 6);
  ctx.fillStyle = secondaryAccent;
  ctx.fillRect(W / 2 - 80, 204, 160, 8);

  const texture = new CanvasTexture(ctx.canvas);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/* ══════════════════════════════════════════════════════════════════════════
   Realistic Wood Bark Texture
   Organic vertical furrowed bark with rich grain and tonal variation.
   ══════════════════════════════════════════════════════════════════════════ */

export function createBarkTexture() {
  const W = 512;
  const H = 512;
  const ctx = surface(W, H);
  const random = makeRandom(0x3d7b8);

  // Base deep wood tone
  ctx.fillStyle = '#3c2b1d';
  ctx.fillRect(0, 0, W, H);

  // Vertical bark ridges and fibrous striations
  for (let x = 0; x < W; x += 2) {
    const val = 0.5 + 0.5 * Math.sin(x * 0.18) + (random() - 0.5) * 0.4;
    const r = Math.round(48 + val * 38);
    const g = Math.round(34 + val * 26);
    const b = Math.round(22 + val * 18);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, 0, 2 + Math.floor(random() * 3), H);
  }

  // Deep vertical fissures
  ctx.fillStyle = 'rgba(15, 10, 6, 0.65)';
  for (let i = 0; i < 48; i++) {
    const fx = random() * W;
    const fw = 2 + random() * 4;
    ctx.fillRect(fx, 0, fw, H);
  }

  // Weathering and subtle moss speckles
  for (let i = 0; i < 600; i++) {
    const px = random() * W;
    const py = random() * H;
    const isMoss = random() < 0.25;
    ctx.fillStyle = isMoss ? 'rgba(74, 94, 52, 0.4)' : 'rgba(110, 85, 60, 0.35)';
    ctx.fillRect(px, py, 2 + random() * 4, 3 + random() * 8);
  }

  return toTexture(ctx.canvas, { repeatX: 1, repeatY: 3, anisotropy: 8 });
}

/* ══════════════════════════════════════════════════════════════════════════
   Realistic Foliage Cluster Texture
   Organic leaf branches with rich alpha transparency and sunlight translucency.
   ══════════════════════════════════════════════════════════════════════════ */

export function createFoliageTexture() {
  const W = 512;
  const H = 512;
  const ctx = surface(W, H);
  const random = makeRandom(0x6f2a1);

  ctx.clearRect(0, 0, W, H);

  // Twigs / central branches
  ctx.strokeStyle = '#382618';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(W / 2, H * 0.95);
  ctx.quadraticCurveTo(W / 2 + 20, H * 0.5, W / 2, H * 0.1);
  ctx.stroke();

  for (let b = 0; b < 10; b++) {
    const by = H * (0.2 + b * 0.07);
    const side = b % 2 === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.moveTo(W / 2, by);
    ctx.quadraticCurveTo(W / 2 + side * 60, by - 15, W / 2 + side * 140, by - 30);
    ctx.stroke();
  }

  // Dense multi-layered leaves
  const leafColors = [
    '#275518', '#346d20', '#44852a', '#549f33',
    '#68b83e', '#7ecc4a', '#8fd957', '#3c5a21',
  ];

  const leafCount = 420;
  for (let i = 0; i < leafCount; i++) {
    const angle = random() * Math.PI * 2;
    const dist = Math.pow(random(), 0.65) * 210;
    const lx = W / 2 + Math.cos(angle) * dist * 1.08;
    const ly = H / 2 + Math.sin(angle) * dist * 0.88;

    const leafLength = 18 + random() * 22;
    const leafWidth = 9 + random() * 12;
    const rot = angle + (random() - 0.5) * 1.2;

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(rot);

    ctx.fillStyle = leafColors[(random() * leafColors.length) | 0];
    ctx.beginPath();
    ctx.ellipse(0, 0, leafLength, leafWidth, 0, 0, Math.PI * 2);
    ctx.fill();

    // Leaf center vein highlight
    ctx.strokeStyle = 'rgba(180, 230, 120, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-leafLength * 0.8, 0);
    ctx.lineTo(leafLength * 0.8, 0);
    ctx.stroke();

    ctx.restore();
  }

  const texture = new CanvasTexture(ctx.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/* ══════════════════════════════════════════════════════════════════════════
   Sky — vertical gradient with a haze band and a few soft clouds.
   Applied to the inside of a large sphere.
   ══════════════════════════════════════════════════════════════════════════ */

export function createSkyTexture() {
  const W = 1024;
  const H = 512;
  const ctx = surface(W, H);
  const random = makeRandom(0x5c1ee);

  const zenith = '#' + WORLD.zenithColor.toString(16).padStart(6, '0');
  const horizon = '#' + WORLD.horizonColor.toString(16).padStart(6, '0');

  // Sphere UVs put v=0 at the bottom, so paint top-down: zenith to horizon and
  // on into a slightly darker ground haze below the skyline.
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0.00, zenith);
  gradient.addColorStop(0.32, '#5f9bcb');
  gradient.addColorStop(0.50, horizon);
  gradient.addColorStop(0.56, horizon);
  gradient.addColorStop(1.00, '#96a98c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // Soft cumulus: overlapping translucent ellipses, brighter on top.
  for (let i = 0; i < 26; i++) {
    const cx = random() * W;
    const cy = H * (0.10 + random() * 0.28);
    const scale = 0.5 + random() * 1.5;
    const puffs = 5 + ((random() * 7) | 0);
    for (let p = 0; p < puffs; p++) {
      const px = cx + (random() - 0.5) * 150 * scale;
      const py = cy + (random() - 0.5) * 26 * scale;
      const rx = (24 + random() * 52) * scale;
      const ry = rx * (0.32 + random() * 0.3);
      ctx.fillStyle = `rgba(255,255,255,${0.10 + random() * 0.20})`;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Warm glow near the sun's azimuth so the lighting direction reads visually.
  const glow = ctx.createRadialGradient(W * 0.68, H * 0.22, 0, W * 0.68, H * 0.22, W * 0.30);
  glow.addColorStop(0, 'rgba(255,246,214,0.55)');
  glow.addColorStop(1, 'rgba(255,246,214,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const texture = new CanvasTexture(ctx.canvas);
  texture.colorSpace = SRGBColorSpace;
  // Clamp vertically: repeating would mirror the horizon back into the sky.
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
