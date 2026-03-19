/**
 * @file state.js
 * @module core/state
 * @description Central state manager for Isometric Ops.
 * Defines all shared constants and the single mutable globalState object.
 * Every module that needs runtime data reads/writes through here.
 */

'use strict';

// ─────────────────────────────────────────────────────────────
// ROOM & WORLD CONSTANTS
// ─────────────────────────────────────────────────────────────

/** World position of the room group */
export const RP_X = 0;
export const RP_Y = 0.08;
export const RP_Z = 0;

export const ROOM_W  = 10;
export const ROOM_D  = 10;
export const ROOM_H  = 4.2;
export const WALL_T  = 0.18;
export const FLOOR_T = 0.12;

const _roomHW = ROOM_W / 2;
const _roomHD = ROOM_D / 2;

/**
 * Walkable area in room-local coordinates.
 * All character lx/lz values must stay inside these bounds.
 */
export const BOUNDS = {
  minX:   -_roomHW + WALL_T + 0.3,
  maxX:    _roomHW - WALL_T - 0.3,
  minZ:   -_roomHD + WALL_T + 0.3,
  maxZ:    _roomHD - 0.3,
  floorY:  FLOOR_T,
};

/** Absolute world Y of the room floor surface */
export const FLOOR_Y = RP_Y + BOUNDS.floorY;

/** Alias — Y at which character feet rest */
export const GROUND_Y = FLOOR_Y;

// ─────────────────────────────────────────────────────────────
// FURNITURE CONSTANTS
// ─────────────────────────────────────────────────────────────

export const DESK_H       = 0.72;
export const CHAIR_OFFSET = 0.62;
export const CHAIR_SEAT_H = 0.44;

// ─────────────────────────────────────────────────────────────
// CHARACTER / COLLISION CONSTANTS
// ─────────────────────────────────────────────────────────────

export const AGENT_RADIUS     = 0.28;
export const AGENT_SEPARATION = 0.6;
export const FURNITURE_MARGIN = 0.15;

export const AGENT_LEG_H     = 0.32;
export const AGENT_LEG_TOP_R = 0.065;
export const AGENT_LEG_BOT_R = 0.055;

export const MGR_LEG_H     = 0.34;
export const MGR_LEG_TOP_R = 0.07;
export const MGR_LEG_BOT_R = 0.06;

/**
 * Ground offset constants derived from geometry bounding boxes.
 * Defaults are sensible approximations; call initGroundConstants() to get exact values.
 * Exported as `let` so initGroundConstants() can update them in-place via live bindings.
 * @type {number}
 */
export let AGENT_BASE_Y = 0.32;
export let MGR_BASE_Y   = 0.34;

/**
 * Computes exact AGENT_BASE_Y and MGR_BASE_Y from geometry bounding boxes.
 * Must be called once after THREE.js is available, before any character is built.
 */
export function initGroundConstants() {
  // Agent leg — translate geometry so pivot is at hip (y=0), feet at y=-LEG_H
  const agGeo = new THREE.CylinderGeometry(AGENT_LEG_TOP_R, AGENT_LEG_BOT_R, AGENT_LEG_H, 8);
  agGeo.translate(0, -AGENT_LEG_H / 2, 0);
  agGeo.computeBoundingBox();
  AGENT_BASE_Y = -agGeo.boundingBox.min.y;
  agGeo.dispose();

  // Manager leg
  const mgGeo = new THREE.CylinderGeometry(MGR_LEG_TOP_R, MGR_LEG_BOT_R, MGR_LEG_H, 8);
  mgGeo.translate(0, -MGR_LEG_H / 2, 0);
  mgGeo.computeBoundingBox();
  MGR_BASE_Y = -mgGeo.boundingBox.min.y;
  mgGeo.dispose();
}

// ─────────────────────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DeskRecord
 * @property {THREE.Group}  deskGrp    - Desk Three.js group
 * @property {THREE.Group}  chairGrp   - Chair Three.js group
 * @property {number}       seatWX     - World X of seat anchor
 * @property {number}       seatWZ     - World Z of seat anchor
 * @property {number}       faceAngle  - Rotation agent faces when seated (toward monitor)
 * @property {Object|null}  reservedBy - Agent or 'manager' that holds this desk
 * @property {number}       obsX       - Obstacle centre local X (avoidance)
 * @property {number}       obsZ       - Obstacle centre local Z
 * @property {number}       obsRadX    - Obstacle half-width
 * @property {number}       obsRadZ    - Obstacle half-depth
 */

/**
 * @typedef {Object} AgentRecord
 * @property {Object}          mesh      - { grp, torso, head, legL, legR, botCap }
 * @property {THREE.Group}     grp       - Root Three.js group
 * @property {number}          speed     - Movement speed (units/sec)
 * @property {string}          state     - 'walk' | 'pause' | 'toDesk' | 'work'
 * @property {number}          lx        - Room-local X position
 * @property {number}          lz        - Room-local Z position
 * @property {number}          tx        - Target local X
 * @property {number}          tz        - Target local Z
 * @property {number}          ang       - Current facing angle (radians)
 * @property {number}          tAng      - Target facing angle
 * @property {number}          timer     - State countdown
 * @property {number}          phase     - Animation phase offset
 * @property {DeskRecord|null} desk      - Reserved desk or null
 * @property {number}          sitOff    - Current vertical sit offset
 * @property {number}          sitTgt    - Target sit offset
 * @property {number}          wkChance  - Probability to seek a desk vs wander [0–1]
 * @property {number}          legScale  - Leg Y scale (1 = standing, 0.5 = seated)
 */

/**
 * @typedef {Object} ManagerRecord
 * @property {string}          state     - 'seated'|'standing'|'walking'|'arriving'|'idle'
 * @property {number}          lx        - Room-local X
 * @property {number}          lz        - Room-local Z
 * @property {number}          tx        - Target local X
 * @property {number}          tz        - Target local Z
 * @property {number}          ang       - Current facing angle
 * @property {number}          tAng      - Target facing angle
 * @property {number}          sitOff    - Current sit offset
 * @property {number}          sitTgt    - Target sit offset
 * @property {number}          legScale  - Leg scale
 * @property {number}          timer     - State countdown
 * @property {number}          phase     - Walk animation phase
 * @property {DeskRecord|null} homeDesk  - Starting desk reference
 * @property {number}          idleTime  - Idle duration accumulator
 * @property {number}          worldX    - Cached world X (updated per frame, read by camera)
 * @property {number}          worldZ    - Cached world Z
 */

export const globalState = {
  /** @type {AgentRecord[]} */
  agents: [],

  /** @type {DeskRecord[]} */
  desks: [],

  /** @type {ManagerRecord} */
  manager: {
    state:    'seated',
    lx: 0,    lz: 0,
    tx: 0,    tz: 0,
    ang: 0,   tAng: 0,
    sitOff:   0,
    sitTgt:   0,
    legScale: 0.5,
    timer:    0,
    phase:    0,
    homeDesk: null,
    idleTime: 0,
    worldX:   0,  // updated every frame by updateManager(), read by camera
    worldZ:   0,
  },

  /**
   * Active camera mode.
   * 0 = PLAYER (orbit around manager)
   * 1 = TRANSITION (cubic ease between modes)
   * 2 = TOP_VIEW (velocity-driven orbital physics)
   */
  camMode: 0,
};
