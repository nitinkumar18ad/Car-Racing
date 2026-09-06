# Apex Circuit — 3D Motorsport Racing Game

A high-performance 3D browser racing game built with **Three.js**, **React 19**, and **Next.js 15**. Features the classic 1966 **Jaguar XJ13** Le Mans prototype, dynamic Grand Prix circuit scenery, multiple camera views including rock-solid Cockpit & Hood First-Person Perspectives (FPP), authentic vehicle dynamics, and dual racing modes.

---

## 🏎️ Features

- **Photorealistic 3D Car**: Authentic Jaguar XJ13 Le Mans sports car in British Racing Green with metallic clearcoat reflections, aerodynamic bodywork, grounded tire contact, and working taillights.
- **Multiple Camera Views**:
  - `Chase`: Dynamic spring-tethered 3rd-person chase camera.
  - `Cockpit (FPP)`: Driver-seat view looking over the steering wheel, dashboard, and curved hood, rigidly locked to the car chassis with zero forward/backward shaking.
  - `Hood (FPP)`: Low-slung bonnet mount for high-speed apex tracking.
  - `Wide`: Panoramic distance chase camera.
- **Rich Grand Prix Scenery**:
  - Covered spectator grandstands with stadium roofs and cheering crowds along the main straight and key corners.
  - Over 300 lush roadside flowering bushes and shrubs along the verges.
  - Corner tire safety walls with alternating red and white racing barriers.
  - Classic motorsport sponsor billboards (**Pirelli**, **Brembo**, **Castrol**, **Apex GP**).
  - Multi-cluster trees with furrowed bark trunks, organic leaf cutouts, and spherical normal volume shading.
- **Dual Race Modes**:
  - **Circuit Mode**: 3-lap Grand Prix circuit racing with lap delta timing and personal best tracking.
  - **Time Lap Mode**: Point-to-point speed trap sprint with start gantry, speed traps, and dedicated 50m deceleration runoff.
- **Ultra-Fast & Zero Asset Lag**: Optimized geometry instancing (`InstancedMesh`) and procedural texture generation for 60+ FPS performance.

---

## 🎮 Controls

| Key | Action |
| :--- | :--- |
| `W` / `↑` | Accelerate / Throttle |
| `S` / `↓` | Brake, then Reverse when stopped |
| `A` / `←` & `D` / `→` | Steer Left / Right |
| `Space` | Handbrake (drift through tight corners) |
| `C` | Cycle Camera (`Chase` → `Cockpit FPP` → `Hood FPP` → `Wide`) |
| `M` | Toggle Mode (`Circuit` ↔ `Time Lap`) |
| `R` | Restart race |
| `P` or `Esc` | Pause / Resume |

---

## 🚀 Deployment Guide

### Option 1: Vercel (Recommended — 1-Click)

Apex Circuit is a Next.js application optimized for zero-config Vercel deployment:

1. Push your repository to **GitHub**, **GitLab**, or **Bitbucket**.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Vercel automatically detects Next.js:
   - **Framework Preset**: `Next.js`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
4. Click **Deploy**. Your game will be live globally on Vercel's Edge Network with HTTPS and custom domain support!

---

### Option 2: Netlify

1. Connect your repository in [Netlify Dashboard](https://app.netlify.com/).
2. Build Settings:
   - **Base directory**: `.`
   - **Build command**: `npm run build`
   - **Publish directory**: `.next` (or `out` if using static export)
3. Deploy site.

---

### Option 3: Node.js / Docker / VPS Server

To run the production build on any Linux/Windows server or Docker container:

```bash
# 1. Install dependencies
npm install

# 2. Build optimized production bundle
npm run build

# 3. Launch production server
npm start
```
The game will be available at `http://localhost:3000` (or `PORT` environment variable).

---

### Option 4: Pure Static Export (GitHub Pages, Cloudflare Pages, S3, Apache, Nginx)

To generate static HTML/CSS/JS files:

```bash
# Set static export flag and build
NEXT_EXPORT=true npm run build
```
Or simply serve the project folder using any static web server:
```bash
npx serve .
# or
python -m http.server 3000
```
Open `http://localhost:3000` to play!

---

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI & State**: React 19, Vanilla CSS Design System, TailwindCSS
- **Graphics & 3D Engine**: Three.js (WebGL, PBR MeshStandardMaterial, PCF Soft Shadow Mapping)
- **3D Asset Pipeline**: GLTFLoader (`/models/car.glb`)
- **Procedural Graphics**: Offscreen HTML5 Canvas procedural texturing

---

## 📄 License

MIT License. Free to use, modify, and distribute.
