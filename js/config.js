/**
 * Every tunable number in the game lives here.
 *
 * Units are metres, seconds and radians throughout. Speed is stored internally
 * in m/s and only converted to km/h for display, so the physics never has to
 * think about display units.
 */

export const RACE = {
  totalLaps: 3,
  countdownSeconds: 3,
};

export const MODES = {
  circuit: {
    id: 'circuit',
    name: 'Circuit',
    label: 'LAP',
    totalLaps: 3,
    storageKey: 'car-racing-game:best-lap:circuit',
    resultsTitle: 'Race Complete',
  },
  timeLap: {
    id: 'time-lap',
    name: 'Time Lap',
    label: 'RUN',
    totalLaps: 1,
    storageKey: 'car-racing-game:best-lap:time-lap',
    resultsTitle: 'Time Lap Complete',
  },
};

export const TRACK = {
  /** Number of centreline samples. Higher = smoother road, more memory. */
  samples: 2200,

  /** Half-width of the drivable asphalt. Full road is twice this. */
  roadHalfWidth: 9,

  /** Width of the red/white kerb strip just outside the asphalt. */
  kerbWidth: 1.2,

  /** How far the grass ribbon extends past the kerb on each side. */
  vergeWidth: 60,

  /** Barrier wall height and how far past the kerb it sits. */
  wallHeight: 0.9,
  wallOffset: 2.6,

  /**
   * Banking. Fast corners lean outward-edge-up for visual flair.
   *
   * Bank is `maxBankRadians * tanh(curvature * bankCurvatureScale)`, then smoothed
   * over `bankSmoothingMetres` either side. Both of those matter:
   *
   * `tanh` soft-limits instead of clamping, so the lean approaches the maximum
   * asymptotically and there is no corner where a hard limit starts biting. With a
   * clamp — and a scale large enough to reach it — nearly the whole circuit pins to
   * the limit and the bank becomes a square wave that flips sign in a metre. An
   * 18m-wide road rolling 12 degrees that fast throws its edges up and down like a
   * cone, which is exactly what it looks like.
   *
   * The smoothing then spreads what's left of each transition over ~110m, so the
   * road rolls gradually rather than snapping between leans. It runs twice: one
   * box pass turns a step into a straight ramp, and a ramp still has corners at
   * each end. Two passes is a triangular filter, which smooths the *derivative*
   * too — the difference is visible when the thing being ramped is rolling 18
   * metres of road.
   *
   * Scale is set against measured curvature: median 0.003 (near-straight, leans
   * about a degree), 0.011 at the fast sweepers (~3 deg), 0.028 in the hairpin
   * (5 deg, the peak). Raise it and more of the lap leans hard.
   *
   * `maxBankRadians` is the pre-smoothing ceiling, so the lean you actually see
   * is lower: smoothing costs about 30% of the peak. 0.15 rad here measures out
   * at 5.0 deg through the hairpin, and the road's outer edge then rises no more
   * than 0.105 m per 10 m travelled anywhere on the circuit.
   */
  maxBankRadians: 0.15,
  bankCurvatureScale: 40,
  bankSmoothingMetres: 55,

  /** Repeats of the asphalt texture per metre travelled along the track. */
  asphaltRepeatPerMetre: 1 / 14,
  kerbRepeatPerMetre: 1 / 3,
  grassRepeatPerMetre: 1 / 9,
  wallRepeatPerMetre: 1 / 8,

  /**
   * Surface heights above the centreline plane, along the (banked) road normal.
   *
   * The grass verges only span from the kerb outward — they deliberately do *not*
   * pass under the asphalt. A single full-width ribbon seems tidier, but its rings
   * are ~140m wide and get triangulated as two flat triangles, so wherever banking
   * transitions the flat approximation bulges a few centimetres and pokes grass up
   * through the road. Keeping the surfaces disjoint makes that impossible.
   *
   * Kerbs ramp up from the asphalt's edge to `kerbLift` at their outer lip, as real
   * ones do. Every surface therefore meets its neighbour along a shared edge with
   * no overlapping area, which is what makes z-fighting impossible rather than
   * merely unlikely.
   */
  roadLift: 0.06,
  kerbLift: 0.08,
};

export const CAR = {
  /**
   * Engine force as an acceleration in m/s^2, before resistance.
   * 14 is about 1.4g — punchy and arcade-y rather than realistic.
   */
  enginePower: 14,
  reversePower: 7,
  brakePower: 26,

  /**
   * Resistance. `dragArea` is quadratic and dominates at speed; rolling is
   * linear and only matters at walking pace. These two are balanced against
   * `enginePower` so that terminal velocity lands on `topSpeed`:
   *     enginePower = dragArea * v^2 + rollingResistance * v
   * Change enginePower and top speed moves with it, so re-solve if you do.
   */
  dragArea: 0.00166,
  rollingResistance: 0.05,

  /** Extra deceleration when coasting with no pedal down. */
  engineBraking: 2.4,

  topSpeed: 78, // m/s == 281 km/h
  reverseTopSpeed: 9,

  /** Max front-wheel angle at a standstill. */
  maxSteerRadians: 0.62,

  /**
   * Steering authority falls off with speed, so the car is nimble in the
   * hairpin but not twitchy on the straight. At `steerFalloffSpeed` m/s the
   * available steering angle is halved.
   */
  steerFalloffSpeed: 34,
  steerFalloffFloor: 0.24,

  /** How fast the wheels swing to the requested angle, and centre again. */
  steerRate: 5.2,
  steerReturnRate: 7.5,

  /**
   * Yaw response. Rotation rate is proportional to steering angle AND forward
   * speed, so the car can't pirouette while parked.
   */
  yawFromSteer: 1.05,

  /**
   * Lateral grip is the single most important feel number. It's the fraction of
   * sideways velocity killed per second. High = planted, low = slides.
   */
  gripAsphalt: 9.5,
  gripGrass: 2.6,
  gripHandbrake: 1.5,

  /** Grass also caps speed and adds drag, so cutting corners never pays. */
  grassTopSpeedFactor: 0.42,
  grassExtraDrag: 9.0,

  /** Hitting a barrier scrubs this fraction of speed per second while scraping. */
  wallScrub: 6.0,
  wallSpeedCap: 26,

  /**
   * Geometry. Note there is no ride-height: the car mesh is built with its wheel
   * bottoms resting on local y = 0, so the mesh origin is the contact plane and
   * `wheelRadius` is the only height that matters.
   */
  wheelbase: 2.6,
  trackWidth: 1.72,
  wheelRadius: 0.34,

  /** How quickly the body settles onto the road normal (pitch/roll). */
  bodyAlignRate: 7.0,

  /** Cosmetic lean under cornering and squat under acceleration. */
  bodyRollFromSlip: 0.055,
  bodyPitchFromAccel: 0.012,
  maxBodyRoll: 0.16,
  maxBodyPitch: 0.07,

  /** Fake gearbox purely so the HUD has something to show. */
  gearRatios: [0, 12, 22, 34, 48, 62, 78], // upper speed bound of each gear, m/s
};

export const CAMERA = {
  fov: 62,
  /** FOV widens with speed for a cheap sense of rush. */
  fovAtTopSpeed: 78,
  near: 0.3,
  far: 1400,

  /**
   * `offset` is [sideways, up, forward] in the car's frame.
   * Cockpit and Hood modes have `isFPP: true` and are rigidly locked to the car body
   * to eliminate forward/backward camera shaking.
   */
  modes: [
    { name: 'Chase', offset: [0, 3.05, -8.4], pullback: 2.4, lookAhead: 11, lookHeight: 1.5, stiffness: 5.0, fovScale: 1, isFPP: false },
    { name: 'Cockpit (FPP)', offset: [0, 0.96, -0.45], pullback: 0, lookAhead: 30, lookHeight: 0.90, stiffness: Infinity, fovScale: 1.0, isFPP: true },
    { name: 'Hood (FPP)', offset: [0, 0.88, -1.25], pullback: 0, lookAhead: 30, lookHeight: 0.82, stiffness: Infinity, fovScale: 1.0, isFPP: true },
    { name: 'Wide', offset: [0, 5.6, -14.5], pullback: 3.2, lookAhead: 9, lookHeight: 2.2, stiffness: 3.4, fovScale: 0.94, isFPP: false },
  ],
};

export const WORLD = {
  /** Fog and the sky's horizon band share this colour so the ribbon edge vanishes. */
  horizonColor: 0xbed6ea,
  zenithColor: 0x27649f,
  fogDensity: 0.0020,

  sunPosition: [190, 240, 130],
  sunIntensity: 2.7,
  hemiIntensity: 1.25,
  groundColor: 0x5a6d46,

  /** Ortho half-size of the shadow frustum that follows the car. */
  shadowRadius: 48,
  shadowMapSize: 2048,

  /** Roadside scenery counts. */
  treeCount: 460,
  bushCount: 320,
  markerSpacing: 42, // metres between distance markers, each side
  grandstandCount: 6,
  tireWallCount: 56,
  sponsorBannerCount: 34,
};

export const ENVIRONMENTS = {
  'circuit': {
    id: 'circuit',
    name: 'Circuit',
    zenithColor: 0x140b24, // Deep midnight indigo
    horizonColor: 0x754b6c, // Cool twilight mauve/rose fog (no yellowish or orange haze)
    skyMidColor: '#5c2259', // Twilight plum/violet
    groundColor: 0x3d5930, // Rich green championship turf ground
    fogDensity: 0.0018,
    sunPosition: [280, 135, -170], // Dramatic low-angle twilight sun
    sunColor: 0xfff0f6, // Crisp neutral soft-white light (clean white markings, no yellow cast)
    sunIntensity: 2.85,
    hemiSkyColor: 0x9b7ab5, // Cool lavender sky bounce
    hemiGroundColor: 0x243b1e, // Deep green turf bounce
    hemiIntensity: 1.25,
    exposure: 1.05,
    leafPalette: [
      0x275522, // Rich forest green
      0x34692c, // Vibrant green
      0x1f441b, // Deep pine green
      0x3d7b34, // Fresh emerald green
      0x2c5025, // Cool spruce green
      0x4a8c3e, // Bright leaf green
    ],
    bushPalette: [
      0x22491e, // Deep hedge green
      0x2f5f29, // Shrub green
      0x3d7434, // Vibrant foliage green
      0x1b3c18, // Shadow green
      0x48853d, // Highlight green
    ],
    treeCount: 520,
    bushCount: 360,
    showGrandstands: true,
    showSponsors: true,
    showTireWalls: true,
  },
  'time-lap': {
    id: 'time-lap',
    name: 'Time Lap',
    zenithColor: 0x27649f,
    horizonColor: 0xbed6ea,
    skyMidColor: '#4484be',
    groundColor: 0x5a6d46,
    fogDensity: 0.0019,
    sunPosition: [190, 240, 130],
    sunColor: 0xfff4df,
    sunIntensity: 2.8,
    hemiSkyColor: 0xa8d2f5,
    hemiGroundColor: 0x5a6d46,
    hemiIntensity: 1.25,
    exposure: 1.05,
    leafPalette: [
      0x326922, 0x43852b, 0x569a35, 0x3a7527, 0x62a33c, 0x2d5f1f,
    ],
    bushPalette: [
      0x28591a, 0x3a7526, 0x4e9334, 0x336821, 0x5ba43d,
    ],
    treeCount: 460,
    bushCount: 320,
    showGrandstands: false, // Scenic open mountain road without commercial stadium bleachers
    showSponsors: false,    // Pristine mountain sprint vista without billboards
    showTireWalls: true,
  },
};

export function getEnvironment(modeId = 'time-lap') {
  return ENVIRONMENTS[modeId] || ENVIRONMENTS['time-lap'];
}

export const RENDER = {
  maxPixelRatio: 2,
  /** Physics tick. Fixed so handling is identical at 60Hz and 144Hz. */
  fixedStep: 1 / 120,
  /** Never simulate more than this much time in one frame (alt-tab guard). */
  maxFrameTime: 0.25,
};

export const STORAGE_KEY = MODES.timeLap.storageKey;
