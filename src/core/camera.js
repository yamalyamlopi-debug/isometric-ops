/**
 * @file camera.js
 * @module core/camera
 * @description AAA Studio-Level Orbital Camera System for Isometric Ops.
 *
 * Architecture:
 *   Mode 0 (PLAYER)     — Smooth third-person breathing orbit around manager
 *   Mode 1 (TRANSITION) — Cubic ease-in-out between any two modes
 *   Mode 2 (TOP VIEW)   — Velocity-driven orbital physics with drag / keyboard / scroll
 *
 * Invariants:
 *   · camera.position and camera.lookAt are ALWAYS set at end of updateCamera()
 *   · All values are NaN-guarded before being applied to THREE.js
 *   · No mode transition produces a visible discontinuity
 *   · Mode 1 is the only state that sets globalState.camMode to its target on completion
 */

'use strict';

import { camera, canvas } from './scene.js';
import { globalState }     from './state.js';

// ─────────────────────────────────────────────────────────────
// NaN-SAFE MATH UTILITIES
// ─────────────────────────────────────────────────────────────

/**
 * Returns v if it is a finite number, otherwise returns fallback (default 0).
 * @param {number} v
 * @param {number} [fallback=0]
 * @returns {number}
 */
export function safe(v, fallback = 0) {
  return (typeof v === 'number' && isFinite(v)) ? v : fallback;
}

/**
 * Clamps v to [lo, hi] with NaN safety.
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clamp(v, lo, hi) {
  v = safe(v, (lo + hi) * 0.5);
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Cubic ease-in-out — used for mode transitions.
 * @param {number} t - Normalised time [0, 1]
 * @returns {number}
 */
function cubicEase(t) {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Wraps an angle to [-π, +π].
 * @param {number} a
 * @returns {number}
 */
function wrapAngle(a) {
  a = safe(a);
  while (a >  Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

/**
 * Returns the shortest signed angular distance from `from` to `to`.
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
function shortAngleDist(from, to) {
  let d = safe(to) - safe(from);
  while (d >  Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/**
 * Lerps angle `cur` toward `tgt` along the shortest arc.
 * @param {number} cur
 * @param {number} tgt
 * @param {number} f   - Blend factor [0, 1]
 * @returns {number}
 */
export function lerpAngleSafe(cur, tgt, f) {
  f = clamp(f, 0, 1);
  return safe(cur) + shortAngleDist(cur, tgt) * f;
}

/**
 * Linear interpolation with NaN safety.
 * @param {number} cur
 * @param {number} tgt
 * @param {number} f
 * @returns {number}
 */
export function lerpSafe(cur, tgt, f) {
  f = clamp(f, 0, 1);
  return safe(cur) + (safe(tgt) - safe(cur)) * f;
}

/**
 * Remaps v from [lo1,hi1] to [lo2,hi2], clamped at both ends.
 * @param {number} v
 * @param {number} lo1
 * @param {number} hi1
 * @param {number} lo2
 * @param {number} hi2
 * @returns {number}
 */
function remapClamped(v, lo1, hi1, lo2, hi2) {
  const t = clamp((safe(v) - lo1) / (hi1 - lo1), 0, 1);
  return lo2 + t * (hi2 - lo2);
}

/**
 * Returns an exponential smoothing blend factor for the given rate and dt.
 * @param {number} dt   - Delta time in seconds
 * @param {number} rate - Smoothing rate (higher = faster)
 * @returns {number}
 */
export function expSmooth(dt, rate) {
  return 1 - Math.exp(-safe(rate, 1) * safe(dt, 0.016));
}

// ─────────────────────────────────────────────────────────────
// PHYSICS & TUNING CONSTANTS
// ─────────────────────────────────────────────────────────────

const TWO_PI = Math.PI * 2;

const EL_MIN       = 0.08;           // minimum elevation (prevents floor-level camera)
const EL_MAX       = Math.PI * 0.47;
const R_MIN        = 6;
const R_MAX        = 55;
const CAM_MIN_Y    = 0.8;            // absolute minimum world Y for camera position

const MAX_VEL_AZ   = 4.0;
const MAX_VEL_EL   = 2.5;
const MAX_VEL_R    = 25.0;

const FRIC_AZ_DRAG = 3.0;  // lower friction while dragging (momentum preserved)
const FRIC_AZ_FREE = 5.5;
const FRIC_EL_DRAG = 3.5;
const FRIC_EL_FREE = 6.0;
const FRIC_R       = 7.0;

const MOUSE_IMPULSE   = 0.008;
const MOUSE_EL_RATIO  = 0.55;
const KEY_ACCEL       = 3.0;
const KEY_EL_RATIO    = 0.55;
const KEY_ZOOM_ACCEL  = 16.0;
const WHEEL_IMPULSE   = 5.0;

const DEAD_AZ = 0.0003;  // dead-zone thresholds (kill micro-drift)
const DEAD_EL = 0.0003;
const DEAD_R  = 0.008;

const LAG_RATE     = 7.0;  // how quickly camCur tracks orbital state
const BREATHE_RATE = 4.0;  // how quickly playerCam breathes
const FOV_CLOSE    = 50;   // FOV when zoomed in (R_MIN)
const FOV_FAR      = 32;   // FOV when zoomed out (R_MAX)

// ─────────────────────────────────────────────────────────────
// CAMERA PRESETS
// ─────────────────────────────────────────────────────────────

// Initialised with defaults; call initCameraPresets() after desks/manager are built.
let playerCam = { az: 0, el: Math.PI / 5.5, r: 8, fov: 38, lookY: 1.04 };
const topCam  = { az: Math.PI * 0.25, el: Math.PI * 0.35, r: 22, fov: 40, lookY: 1.0 };

// ─────────────────────────────────────────────────────────────
// RUNTIME CAMERA STATE
// ─────────────────────────────────────────────────────────────

/** The rendered camera state — what THREE.js uses each frame */
const camCur = { az: 0, el: 0.57, r: 8, fov: 38, lookX: 0, lookY: 1.04, lookZ: 0 };

/** Transition: start snapshot */
const camFrom = { az: 0, el: 0, r: 0, fov: 0, lookX: 0, lookY: 0, lookZ: 0 };

/** Transition: end target */
const camTo   = { az: 0, el: 0, r: 0, fov: 0, lookX: 0, lookY: 0, lookZ: 0 };

let camTransT      = 0;
const camTransDur  = 1.8;
let camTransTarget = 0;

/** Orbital physics state for Top View (separate from camCur to allow lag) */
const orbState = { az: topCam.az, el: topCam.el, r: topCam.r };
let velAz = 0, velEl = 0, velR = 0;

// ─────────────────────────────────────────────────────────────
// INPUT STATE
// Exported so manager.js can check dragActive before processing clicks.
// ─────────────────────────────────────────────────────────────

/**
 * Shared camera input state.
 * @type {{ dragActive: boolean, isDragging: boolean, heldKeys: Record<string, boolean> }}
 */
export const cameraInput = {
  dragActive: false,
  isDragging: false,
  heldKeys:   {},
};

// ─────────────────────────────────────────────────────────────
// PRESET INITIALISATION
// ─────────────────────────────────────────────────────────────

/**
 * Seeds the playerCam preset and initialises camCur from the manager's starting position.
 * Must be called after buildManager() has set globalState.manager.worldX/worldZ.
 *
 * @param {number} faceAngle  - Manager's initial facing angle (from desk.faceAngle)
 * @param {number} mgrLookY   - World Y the camera should look at (eye-level pivot)
 * @param {number} mgrStartX  - Manager world X at spawn
 * @param {number} mgrStartZ  - Manager world Z at spawn
 */
export function initCameraPresets(faceAngle, mgrLookY, mgrStartX, mgrStartZ) {
  playerCam.az    = faceAngle + Math.PI + 0.3;
  playerCam.lookY = mgrLookY;

  // Seed camCur from playerCam so first frame has no jump
  camCur.az    = playerCam.az;
  camCur.el    = playerCam.el;
  camCur.r     = playerCam.r;
  camCur.fov   = playerCam.fov;
  camCur.lookX = mgrStartX;
  camCur.lookY = playerCam.lookY;
  camCur.lookZ = mgrStartZ;

  // Seed orbital state for clean Top View entry
  orbState.az = topCam.az;
  orbState.el = topCam.el;
  orbState.r  = topCam.r;
}

// ─────────────────────────────────────────────────────────────
// TOGGLE — initiates a mode transition
// ─────────────────────────────────────────────────────────────

/**
 * Starts a smooth transition between Player View (mode 0) and Top View (mode 2).
 * Blocked while a transition is already in progress (mode 1).
 */
export function toggleCam() {
  if (globalState.camMode === 1) return; // block during transition

  const goTop = (globalState.camMode === 0);
  camTransTarget      = goTop ? 2 : 0;
  globalState.camMode = 1;
  camTransT = 0;

  // Snapshot current state as the transition start
  Object.assign(camFrom, camCur);

  if (goTop) {
    Object.assign(camTo, {
      az: topCam.az, el: topCam.el, r: topCam.r, fov: topCam.fov,
      lookX: 0, lookY: topCam.lookY, lookZ: 0,
    });
    // Pre-seed orbital state for a clean physics handoff
    orbState.az = topCam.az;
    orbState.el = topCam.el;
    orbState.r  = topCam.r;
    velAz = 0; velEl = 0; velR = 0;
  } else {
    const mgr = globalState.manager;
    Object.assign(camTo, {
      az: playerCam.az, el: playerCam.el, r: playerCam.r, fov: playerCam.fov,
      lookX: safe(mgr.worldX), lookY: playerCam.lookY, lookZ: safe(mgr.worldZ),
    });
  }

  // Update HUD
  const btn  = document.getElementById('cam-btn');
  const hint = document.getElementById('cam-hint');
  btn.classList.toggle('on', goTop);
  btn.textContent = goTop ? 'Player View (T)' : 'Top View (T)';
  hint.classList.toggle('on', goTop);
  canvas.style.cursor = goTop ? 'grab' : 'default';
}

// ─────────────────────────────────────────────────────────────
// INPUT HANDLERS
// Modify velocity/flags only — never position directly.
// ─────────────────────────────────────────────────────────────

let dragPrevX = 0;
let dragPrevY = 0;

canvas.addEventListener('mousedown', (e) => {
  if (globalState.camMode !== 2) return;
  cameraInput.dragActive = true;
  cameraInput.isDragging = false;
  dragPrevX = e.clientX;
  dragPrevY = e.clientY;
  canvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!cameraInput.dragActive || globalState.camMode !== 2) return;
  cameraInput.isDragging = true;
  const dx = e.clientX - dragPrevX;
  const dy = e.clientY - dragPrevY;
  dragPrevX = e.clientX;
  dragPrevY = e.clientY;
  const rScale = safe(orbState.r / topCam.r, 1);
  velAz -= dx * MOUSE_IMPULSE * rScale;
  velEl += dy * MOUSE_IMPULSE * MOUSE_EL_RATIO * rScale;
});

window.addEventListener('mouseup', () => {
  if (!cameraInput.dragActive) return;
  cameraInput.dragActive = false;
  cameraInput.isDragging = false;
  if (globalState.camMode === 2) canvas.style.cursor = 'grab';
});

canvas.addEventListener('wheel', (e) => {
  if (globalState.camMode !== 2) return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
  velR += dir * WHEEL_IMPULSE;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  cameraInput.heldKeys[e.key] = true;
  if (e.key === 't' || e.key === 'T') toggleCam();
});
window.addEventListener('keyup', (e) => {
  cameraInput.heldKeys[e.key] = false;
});

document.getElementById('cam-btn').addEventListener('click', toggleCam);

// ─────────────────────────────────────────────────────────────
// UPDATE — called every frame from main.js
// ─────────────────────────────────────────────────────────────

/**
 * Updates the THREE.js camera for the current frame.
 * Handles all three modes (PLAYER / TRANSITION / TOP_VIEW) and applies
 * NaN-guarded spherical-to-Cartesian conversion at the end.
 *
 * @param {number} dt - Delta time in seconds (clamped externally)
 * @param {number} t  - Elapsed time in seconds
 */
export function updateCamera(dt, t) {
  dt = clamp(dt, 0.0001, 0.1);
  t  = safe(t);

  const mode      = globalState.camMode;
  const { heldKeys, isDragging } = cameraInput;

  // ── MODE 1: TRANSITION — cubic ease between two camera states ──
  if (mode === 1) {
    camTransT += dt / camTransDur;
    const progress = clamp(camTransT, 0, 1);
    const ease     = cubicEase(progress);

    // Interpolate all 7 channels independently
    camCur.az    = camFrom.az    + (camTo.az    - camFrom.az)    * ease;
    camCur.el    = camFrom.el    + (camTo.el    - camFrom.el)    * ease;
    camCur.r     = camFrom.r     + (camTo.r     - camFrom.r)     * ease;
    camCur.fov   = camFrom.fov   + (camTo.fov   - camFrom.fov)   * ease;
    camCur.lookX = camFrom.lookX + (camTo.lookX - camFrom.lookX) * ease;
    camCur.lookY = camFrom.lookY + (camTo.lookY - camFrom.lookY) * ease;
    camCur.lookZ = camFrom.lookZ + (camTo.lookZ - camFrom.lookZ) * ease;

    // Transition complete — hand off to target mode
    if (progress >= 1) {
      globalState.camMode = camTransTarget;
      if (globalState.camMode === 2) {
        // Seed orbital state from endpoint so there's no pop
        orbState.az = safe(camCur.az, topCam.az);
        orbState.el = safe(camCur.el, topCam.el);
        orbState.r  = safe(camCur.r,  topCam.r);
        velAz = 0; velEl = 0; velR = 0;
      }
    }

  // ── MODE 0: PLAYER — breathing orbit around manager ──
  } else if (mode === 0) {
    // Multi-frequency breathing targets
    const tAz = playerCam.az + Math.sin(t * 0.035) * 0.025 + Math.sin(t * 0.08) * 0.008;
    const tEl = playerCam.el + Math.sin(t * 0.22)  * 0.004;
    const tR  = playerCam.r  + Math.sin(t * 0.14)  * 0.08;
    const tLY = playerCam.lookY + Math.sin(t * 0.2) * 0.03;

    const bf  = expSmooth(dt, BREATHE_RATE);
    const mgr = globalState.manager;

    camCur.az    = lerpAngleSafe(camCur.az, tAz, bf);
    camCur.el    = lerpSafe(camCur.el, tEl, bf);
    camCur.r     = lerpSafe(camCur.r,  tR,  bf);
    camCur.fov   = lerpSafe(camCur.fov, playerCam.fov, bf);
    camCur.lookY = lerpSafe(camCur.lookY, tLY, bf);
    // Pivot follows manager world position (updated by updateManager each frame)
    camCur.lookX = lerpSafe(camCur.lookX, safe(mgr.worldX), bf);
    camCur.lookZ = lerpSafe(camCur.lookZ, safe(mgr.worldZ), bf);

    canvas.style.cursor = 'default';

  // ── MODE 2: TOP VIEW — velocity-driven orbital physics ──
  } else if (mode === 2) {
    // STEP 1: Keyboard → acceleration (adds to velocity while held)
    if (heldKeys['ArrowLeft']  || heldKeys['a'] || heldKeys['A']) velAz += KEY_ACCEL * dt;
    if (heldKeys['ArrowRight'] || heldKeys['d'] || heldKeys['D']) velAz -= KEY_ACCEL * dt;
    if (heldKeys['ArrowUp']    || heldKeys['w'] || heldKeys['W']) velEl -= KEY_ACCEL * KEY_EL_RATIO * dt;
    if (heldKeys['ArrowDown']  || heldKeys['s'] || heldKeys['S']) velEl += KEY_ACCEL * KEY_EL_RATIO * dt;
    if (heldKeys['q'] || heldKeys['Q']) velR -= KEY_ZOOM_ACCEL * dt;
    if (heldKeys['e'] || heldKeys['E']) velR += KEY_ZOOM_ACCEL * dt;

    // STEP 2: Velocity cap
    velAz = clamp(velAz, -MAX_VEL_AZ, MAX_VEL_AZ);
    velEl = clamp(velEl, -MAX_VEL_EL, MAX_VEL_EL);
    velR  = clamp(velR,  -MAX_VEL_R,  MAX_VEL_R);

    // STEP 3: Dual-rate friction (lighter while dragging to preserve momentum)
    const fAz = isDragging ? FRIC_AZ_DRAG : FRIC_AZ_FREE;
    const fEl = isDragging ? FRIC_EL_DRAG : FRIC_EL_FREE;
    velAz *= Math.exp(-fAz * dt);
    velEl *= Math.exp(-fEl * dt);
    velR  *= Math.exp(-FRIC_R * dt);

    // STEP 4: Dead zone — kill micro-drift below threshold
    if (Math.abs(velAz) < DEAD_AZ) velAz = 0;
    if (Math.abs(velEl) < DEAD_EL) velEl = 0;
    if (Math.abs(velR)  < DEAD_R)  velR  = 0;

    // STEP 5: Semi-implicit Euler integration
    orbState.az += velAz * dt;
    orbState.el += velEl * dt;
    orbState.r  += velR  * dt;

    // STEP 6: Constraints with velocity absorption (no bounce)
    if (orbState.el < EL_MIN) { orbState.el = EL_MIN; if (velEl < 0) velEl = 0; }
    if (orbState.el > EL_MAX) { orbState.el = EL_MAX; if (velEl > 0) velEl = 0; }
    if (orbState.r  < R_MIN)  { orbState.r  = R_MIN;  if (velR  < 0) velR  = 0; }
    if (orbState.r  > R_MAX)  { orbState.r  = R_MAX;  if (velR  > 0) velR  = 0; }
    orbState.az = wrapAngle(orbState.az);

    // STEP 7: NaN guard on orbital state
    orbState.az = safe(orbState.az, topCam.az);
    orbState.el = safe(orbState.el, topCam.el);
    orbState.r  = safe(orbState.r,  topCam.r);

    // STEP 8: FOV coupling — closer zoom = wider FOV
    const tgtFov = remapClamped(orbState.r, R_MIN, R_MAX, FOV_CLOSE, FOV_FAR);

    // STEP 9: Smooth lag — camCur trails orbital state with exponential smoothing
    const sf = expSmooth(dt, LAG_RATE);
    camCur.az  = lerpAngleSafe(camCur.az, orbState.az, sf);
    camCur.el  = lerpSafe(camCur.el, orbState.el, sf);
    camCur.r   = lerpSafe(camCur.r,  orbState.r,  sf);
    camCur.fov = lerpSafe(camCur.fov, tgtFov, sf);

    // STEP 10: Pivot follows room centre with micro-breathing
    const breathY = topCam.lookY + Math.sin(t * 0.12) * 0.04 + Math.sin(t * 0.31) * 0.015;
    camCur.lookX = lerpSafe(camCur.lookX, 0, sf);
    camCur.lookY = lerpSafe(camCur.lookY, breathY, sf);
    camCur.lookZ = lerpSafe(camCur.lookZ, 0, sf);
  }

  // ── FINAL: Apply NaN-guarded spherical → Cartesian → THREE.js ──
  const finalAz    = safe(camCur.az,  playerCam.az);
  const finalEl    = clamp(safe(camCur.el,  0.3), 0.01, Math.PI * 0.49);
  const finalR     = clamp(safe(camCur.r,   20),  1,    100);
  const finalFov   = clamp(safe(camCur.fov, 38),  10,   120);
  const finalLookX = safe(camCur.lookX, 0);
  const finalLookY = safe(camCur.lookY, 1.5);
  const finalLookZ = safe(camCur.lookZ, 0);

  const cosEl = Math.cos(finalEl);
  const sinEl = Math.sin(finalEl);
  const sinAz = Math.sin(finalAz);
  const cosAz = Math.cos(finalAz);

  let camX = finalLookX + finalR * cosEl * sinAz;
  let camY = finalR * sinEl;
  const camZ = finalLookZ + finalR * cosEl * cosAz;

  // Floor clamp — camera never goes below CAM_MIN_Y
  if (camY < CAM_MIN_Y) camY = CAM_MIN_Y;

  camera.position.set(
    isFinite(camX) ? camX : 18,
    isFinite(camY) ? camY : 12,
    isFinite(camZ) ? camZ : 18,
  );
  camera.fov = finalFov;
  camera.updateProjectionMatrix();
  camera.lookAt(finalLookX, finalLookY, finalLookZ);
}
