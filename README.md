# Car Racing Game

A 3-lap time-trial circuit racer that runs in the browser. Full 3D via three.js, no build
step, no external assets — every texture is generated procedurally at load, and the track,
car and scenery are all built from primitives in code.

## Run it

The game uses ES modules and an import map, which browsers refuse to load over `file://`.
**Double-clicking `index.html` will not work.** Serve the folder over HTTP:

```bash
python -m http.server 5180 --directory "Projects/Car Racing Game"
```

Then open <http://localhost:5180>.

Any static server does the same job — `npx serve`, `php -S localhost:5180`, a VS Code Live
Server, whatever you have. Nothing needs installing beyond that.

## Controls

| Key | Action |
| --- | --- |
| `↑` / `W` | Throttle |
| `↓` / `S` | Brake, then reverse once stopped |
| `←` `→` / `A` `D` | Steer |
| `Space` | Handbrake — cuts rear grip, use it to drift the hairpin |
| `C` | Cycle camera: chase / hood / wide |
| `R` | Restart the race |
| `P` or `Esc` | Pause |

Three laps, then a results panel. Your fastest lap persists in `localStorage`, and the HUD
shows a delta against it after every lap.

## The circuit

One closed loop, about 2.9 km, roughly 72–78 s a lap at a moderate pace:

main straight → fast right sweeper → climb to a blind crest → tight left hairpin →
downhill S-chicane → long sweeping left → kink back onto the straight

Elevation runs about −3 m to +8 m (steepest grade 2.9%) and fast corners lean up to 5.0°.
Running wide onto the grass costs roughly two-thirds of your average speed, so cutting corners
never pays.

## The car and the trees

Both are built from primitives in code — there are no image or model files anywhere in the
project, which is why it runs from a bare folder with nothing installed.

The car is a mid-engine layout in yellow: cabin forward of centre, glazed engine cover on the
rear deck behind it, haunches proud of the tub, and the rear end carrying four round lamps in
pairs, twin chrome tips above a finned diffuser, low reflector strips and mirrors on stalks.
It's 5.03 × 2.09 × 1.25 m over 49 pieces. The rear is the only part of the car you really see
from the chase camera, so that's where the detail went.

Trees are a tapered trunk forking into three branches, under a broad round canopy 6.3 m across
and 4.1 m tall. The canopy is a sphere whose vertices are pushed in and out along their own
radius by a sum of three sinusoids of direction — smooth, seamless and deterministic, where a
random number per vertex would just look like static. A bare sphere reads as a lollipop.

If you'd rather use your own bitmaps, the hook is `js/textures.js`: every surface goes through
a `CanvasTexture`, so swapping one for a `TextureLoader().load('assets/whatever.png')` is a
one-line change per surface. For the trees specifically, a billboard is usually a better use of
an image than a mesh — a `PlaneGeometry` with an alpha-cut tree PNG, kept facing the camera.

## Layout

```
index.html            import map, canvas, HUD markup
css/style.css         HUD, countdown, results, loading screen
js/config.js          every tunable number in the game
js/textures.js        procedural CanvasTextures (asphalt, kerb, grass, wall, sky)
js/track.js           centreline curve → sample table → meshes, and position lookup
js/car.js             car mesh and arcade physics
js/scenery.js         sky, lighting, trees and markers (InstancedMesh), start gantry
js/input.js           keyboard state
js/chase-camera.js    camera modes and damped follow
js/hud.js             speedo, timing, minimap, best-lap persistence
js/game.js            state machine, lap timing, fixed-timestep loop
js/main.js            bootstrap: renderer, resize, requestAnimationFrame
vendor/three/         three.module.js + three.core.js (r0.185.1, MIT)
```

three.js is vendored rather than hot-linked so the game works offline. To swap back to a
CDN, change the import map in `index.html` to:

```html
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js" } }
</script>
```

## Tuning

Everything adjustable lives in [`js/config.js`](js/config.js). The game exposes its objects
on `window.game`, so you can poke at them from the console while it runs — though most
constants are read once at startup, so geometry changes need a reload.

The numbers that actually change how it feels, in order:

- **`CAR.gripAsphalt`** (9.5) — the fraction of sideways velocity killed per second. This
  one number is the whole handling model. Raise it and the car is planted; lower it and it
  slides everywhere. `gripHandbrake` (1.5) is what the handbrake drops it to.
- **`CAR.enginePower`** (14) — acceleration in m/s², about 1.4 g. Note that top speed is
  where engine force and resistance balance, so changing this moves top speed too. To keep
  `topSpeed` where it is, re-solve `enginePower = dragArea·v² + rollingResistance·v`.
- **`CAR.maxSteerRadians`** (0.62) with **`steerFalloffSpeed`** (34) — how sharp the car is,
  and how much authority it loses with speed. The falloff is what keeps it from being
  twitchy at 250 km/h.
- **`TRACK.maxBankRadians`** (0.15) — how far fast corners lean, *before* smoothing. What you
  actually see is about 30% less, because the bank is filtered twice over ±55 m; 0.15 here
  measures out at a 5.0° peak. Raising it much past this starts to read as a wall of death.
- **`CONTROL_POINTS`** in [`js/track.js`](js/track.js) — the 27 points the circuit is
  splined through. Everything geometric derives from them, so moving one reshapes the road,
  kerbs, barriers, tree placement, minimap and lap length together.

## Notes on the implementation

A few decisions that aren't obvious from reading the code, and that are easy to break:

**One curve, everything derived.** A single closed `CatmullRomCurve3` is the only source of
truth. The asphalt, kerbs, verges, barriers, tree positions, minimap, lap progress,
off-road detection and the car's ride height and body angle all come out of the same sample
table.

**Frames are built by hand, not with `computeFrenetFrames()`.** Frenet frames twist
wherever curvature changes sign, and that twist shows up as the road visibly rolling on a
straight. Deriving `right` from `tangent × worldUp` every sample can't twist. Banking is
then applied deliberately on top, via a Rodrigues rotation driven by smoothed curvature.

**Banking is soft-limited and filtered twice, and both matter.** Clamping the bank instead of
running it through `tanh` pins almost the whole circuit to the limit — 98% of samples, when the
curvature scale is large enough to reach it — which turns the bank into a square wave that flips
sign within a metre. An 18 m-wide road rolling 12° that fast throws its edges up and down like a
cone, which is exactly what it looks like. And one smoothing pass isn't enough either: a box
filter turns a step into a straight ramp, and a ramp still has corners at each end that are
plainly visible when the thing being ramped is rolling 18 m of road. Two passes is a triangular
filter, which smooths the derivative too. Together these took the worst rate of roll from
96°/10 m to 0.67°/10 m.

**The car mesh's nose is at local −Z, and that isn't a free choice.** three.js objects face
their local −Z, and `updateVisuals` orients the car with `makeBasis(right, up, BACKWARD)` —
whose third column is where local +Z ends up. Build the nose at +Z and the car drives
tail-first, which is easy to miss because every other thing about it looks right. The same sign
governs the wheels: `wheelSpin` grows going forward, but a positive rotation about local +X
carries the top of a wheel toward +Z, so it's applied negated.

**Ground surfaces never overlap.** The road, kerbs and grass verges meet edge-to-edge, with
no shared area. A single full-width grass ribbon passing under the road looks tidier, but
its rings are ~140 m wide and get triangulated as two flat triangles, so wherever banking
transitions the flat approximation bulges a few centimetres and pokes grass up through the
asphalt. Disjoint surfaces make that impossible rather than merely unlikely.

**Ribbon winding matters.** `buildStrip` makes the front face point along
`up · (latB − latA)`, so a ribbon whose lateral offsets descend faces *downward* and is
silently backface-culled. `surfaceRibbonBetween` orders the pair, which is what keeps the
left-hand kerb and verge visible.

**The car mesh origin is the contact plane.** Wheel bottoms rest at local y = 0, so the
road surface height is the entire answer for `position.y` — there is no ride height to add.
And because banking tilts the road away from the centreline, the height has to step out
along the banked lateral axis by however far off-centre the car is; skipping that buries
the inside wheels and floats the outside ones on every banked corner.

**Drift comes from operation order.** Velocity is kept in world space. Each step it's split
into forward and lateral components in the *current* heading's frame, modified, recomposed
in that *same* frame — and only then is `yaw` updated. Because the velocity vector doesn't
get rotated along with the car, turning the nose leaves sideways velocity behind. That
leftover is the slip. Update yaw first and the drift disappears entirely.

**Yaw rate is a bicycle model**, proportional to forward speed, so the car can't pirouette
while parked and reverses correctly when backing up.

**Physics runs on a fixed 1/120 s step** with an accumulator, so handling is identical at
60 Hz and 144 Hz. `RENDER.maxFrameTime` caps how much time one frame may simulate, so
returning from an alt-tab can't fast-forward the car through a barrier.

**Lap counting accumulates signed progress** rather than watching for the distance value to
wrap. The naive version breaks in two ways players find immediately: idling on the start
line double-counts as the value jitters across the boundary, and reversing over the line
hands out a free lap. Accumulating signed progress and requiring a full track length of it
makes both impossible — jitter can't retrigger, and reversing genuinely subtracts.

**Smoothing is exponential everywhere** — `1 − e^(−k·dt)` rather than a fixed lerp factor —
so the camera and body settle at the same rate regardless of frame rate.

## Verified behaviour

Measured by pumping the real game loop under an autopilot harness (pure pursuit on the
centreline), and by reading the generated geometry back:

- Three laps complete and the race finishes: 44.82 s / 41.69 s / 41.72 s, 239 km/h average,
  274 km/h peak, without touching a barrier or putting a wheel on the grass.
- Banking: 5.01° peak, 1.18° median. The road's outer edge rises at most 0.105 m per 10 m
  travelled anywhere on the circuit, and nothing is pinned at the limit.
- The car's lowest point is exactly local y = 0, so the mesh origin is the contact plane and
  the wheels rest on the asphalt rather than in it or above it.
- Wheels roll rather than skid: the contact patch's slip per metre travelled tends to 0
  (0.0007 at a 0.5 mm step). With the rotation sign inverted it tends to 2, i.e. spinning
  backwards at road speed.
- All three camera modes snap cleanly on reset — 62° / 64.5° / 58.3° — and the hood camera
  holds 1.5 m ahead of the car at speed instead of drifting back inside the bodywork.
- Tree geometry merges correctly: indices in range, zero degenerate triangles, no non-finite
  normals.
- One frame renders in 70 draw calls with no WebGL error, and the console is silent.
- Best lap round-trips through `localStorage` and survives a reload.

## Not included

No traffic or AI opponents, no audio, no touch controls. Each could be added without
restructuring anything, but none are here.

## Licence

three.js in `vendor/` is MIT, © three.js authors.
