/**
 * @file agent.js
 * @module entities/agent
 * @description Autonomous worker agents for Isometric Ops.
 *
 * Changes from v1 (separation forces) to v2 (RVO + steering):
 *   · AgentRecord gains vx / vz (smooth integrated velocity) and stuckTimer.
 *   · agentWalkTo() now runs the full velocity pipeline:
 *       preferred → computeRVO → steerAroundFurniture → smooth integration → move
 *   · 'waiting' state added: agents stuck in congestion stop briefly and
 *       re-pick a clear target instead of perpetually fighting the crowd.
 *   · Leg animation scales with actual speed (no phantom walking when stuck).
 *   · Facing direction tracks the real velocity vector, not just target direction.
 */

'use strict';

import { scene }    from '../core/scene.js';
import { globalState } from '../core/state.js';
import {
  RP_X, RP_Z,
  GROUND_Y,
  BOUNDS,
  AGENT_RADIUS,
  AGENT_LEG_H,
  AGENT_LEG_TOP_R,
  AGENT_LEG_BOT_R,
  AGENT_BASE_Y,
  CHAIR_SEAT_H,
} from '../core/state.js';
import { computeRVO, steerAroundFurniture, isInFurniture, randSafePt } from '../logic/collision.js';

// ─────────────────────────────────────────────────────────────
// TUNING
// ─────────────────────────────────────────────────────────────

const STUCK_SPEED_RATIO = 0.08; // fraction of target speed below which "stuck" accumulates
const STUCK_TIMEOUT     = 2.4;  // seconds before stuck agent enters 'waiting'
const WAIT_MIN          = 0.35;
const WAIT_MAX          = 0.75;
const VEL_SMOOTH        = 8.0;  // velocity smoothing rate (higher = snappier)

// ─────────────────────────────────────────────────────────────
// COLOUR PALETTE
// ─────────────────────────────────────────────────────────────

const PALETTE = [
  { body: 0x6B8FD4, acc: 0x4A6FB0, skin: 0xF2D8C2 },
  { body: 0xD4846B, acc: 0xB06A4A, skin: 0xF0D0B8 },
  { body: 0x7BC47A, acc: 0x5AA05A, skin: 0xEED4C0 },
  { body: 0xC49A7B, acc: 0xA07A5A, skin: 0xF4DCC8 },
  { body: 0x9B7BC4, acc: 0x7A5AA0, skin: 0xF0D4BE },
];

// ─────────────────────────────────────────────────────────────
// MATH HELPER
// ─────────────────────────────────────────────────────────────

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ─────────────────────────────────────────────────────────────
// MESH FACTORY  (unchanged from v1)
// ─────────────────────────────────────────────────────────────

/**
 * Builds and returns Three.js mesh parts for one agent.
 * Group origin = hip (local y=0), feet = y = -AGENT_BASE_Y.
 * @param {number} palIdx
 * @returns {{ grp, torso, head, legL, legR, botCap }}
 */
export function buildAgent(palIdx) {
  const pal     = PALETTE[palIdx % PALETTE.length];
  const bodyMat = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.6,  metalness: 0.05 });
  const accMat  = new THREE.MeshStandardMaterial({ color: pal.acc,  roughness: 0.55, metalness: 0.05 });
  const skinMat = new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.7 });
  const grp     = new THREE.Group();
  const bR      = 0.2;
  const bH      = 0.6;

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(bR, bR * 0.92, bH, 12), bodyMat);
  torso.position.set(0, bH / 2, 0); torso.castShadow = true; grp.add(torso);

  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(bR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
  topCap.position.set(0, bH, 0); grp.add(topCap);

  const botCap = new THREE.Mesh(
    new THREE.SphereGeometry(bR * 0.92, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bodyMat);
  botCap.position.set(0, 0, 0); grp.add(botCap);

  const hR   = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(hR, 14, 10), skinMat);
  head.position.set(0, bH + hR + 0.05, 0); head.castShadow = true; grp.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(hR * 1.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accMat);
  hair.position.set(0, head.position.y + 0.02, 0); grp.add(hair);

  const legGeoL = new THREE.CylinderGeometry(AGENT_LEG_TOP_R, AGENT_LEG_BOT_R, AGENT_LEG_H, 8);
  legGeoL.translate(0, -AGENT_LEG_H / 2, 0);
  const legL = new THREE.Mesh(legGeoL, accMat);
  legL.position.set(-0.075, 0, 0); legL.castShadow = true; grp.add(legL);

  const legGeoR = new THREE.CylinderGeometry(AGENT_LEG_TOP_R, AGENT_LEG_BOT_R, AGENT_LEG_H, 8);
  legGeoR.translate(0, -AGENT_LEG_H / 2, 0);
  const legR = new THREE.Mesh(legGeoR, accMat);
  legR.position.set(0.075, 0, 0); legR.castShadow = true; grp.add(legR);

  const shad = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 16),
    new THREE.MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0.15, depthWrite: false })
  );
  shad.rotation.x = -Math.PI / 2;
  shad.position.set(0, -AGENT_BASE_Y + 0.002, 0);
  grp.add(shad);

  return { grp, torso, head, legL, legR, botCap };
}

// ─────────────────────────────────────────────────────────────
// SPAWN
// ─────────────────────────────────────────────────────────────

/**
 * Creates one agent, adds it to the scene, and registers it in globalState.agents[].
 * New fields: vx/vz (smooth velocity), stuckTimer.
 * @param {number} startX @param {number} startZ @param {number} palIdx @param {number} speed
 */
export function spawnAgent(startX, startZ, palIdx, speed) {
  const mesh = buildAgent(palIdx);
  mesh.grp.position.set(RP_X + startX, GROUND_Y + AGENT_BASE_Y, RP_Z + startZ);
  scene.add(mesh.grp);

  const wp = randSafePt();
  globalState.agents.push({
    mesh,
    grp:        mesh.grp,
    speed,
    state:      'walk',
    lx:         startX,
    lz:         startZ,
    tx:         wp.x,
    tz:         wp.z,
    ang:        0,
    tAng:       Math.atan2(wp.x - startX, wp.z - startZ),
    timer:      0,
    phase:      Math.random() * Math.PI * 2,
    desk:       null,
    sitOff:     0,
    sitTgt:     0,
    wkChance:   0.5,
    legScale:   1.0,
    // ── NEW v2 fields ──
    vx:         0,          // current velocity X (smooth)
    vz:         0,          // current velocity Z (smooth)
    stuckTimer: 0,          // seconds agent has been nearly stationary
  });
}

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

function agentPickWander(a) {
  const wp   = randSafePt();
  a.tx       = wp.x;
  a.tz       = wp.z;
  a.tAng     = Math.atan2(wp.x - a.lx, wp.z - a.lz);
  a.sitTgt   = 0;
  a.state    = 'walk';
  a.stuckTimer = 0;
}

function findFreeDesk() {
  const { desks } = globalState;
  for (let i = 0; i < desks.length; i++) {
    if (!desks[i].reservedBy) return desks[i];
  }
  return null;
}

/**
 * Moves agent toward (a.tx, a.tz) using the full RVO velocity pipeline.
 * Returns true when arrived (dist < 0.15).
 *
 * Pipeline:
 *   preferred velocity → computeRVO → steerAroundFurniture
 *   → exponential smooth integration → position update → wall clamp
 *
 * Also updates a.vx/vz (for neighbors to read), a.tAng (from real velocity),
 * and animates legs scaled to actual speed.
 *
 * @param {import('../core/state.js').AgentRecord} a
 * @param {number} dt
 * @param {boolean} [useRVO=true] - set false for toDesk final approach
 * @returns {boolean}
 */
function agentWalkTo(a, dt, useRVO = true) {
  const dx   = a.tx - a.lx;
  const dz   = a.tz - a.lz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.15) return true;

  // 1. Preferred velocity: full speed toward target
  const invDist = 1 / dist;
  let prefVX = dx * invDist * a.speed;
  let prefVZ = dz * invDist * a.speed;

  if (dist < 0.5) {
    prefVX *= dist / 0.5;
    prefVZ *= dist / 0.5;
  }

  if (useRVO) {
    // 2. RVO: adjust for neighbors in velocity space
    const rvo = computeRVO(a, prefVX, prefVZ);
    prefVX = rvo.vx;
    prefVZ = rvo.vz;

    // 3. Furniture steering: tangential slide around desks
    const steered = steerAroundFurniture(a, prefVX, prefVZ);
    prefVX = steered.vx;
    prefVZ = steered.vz;
  }

  const targetSpeed = a.speed;
  const currentSpeed = Math.sqrt(prefVX * prefVX + prefVZ * prefVZ);
  if (currentSpeed < targetSpeed * 0.3 && dist > 0.8) {
    const factor = (targetSpeed * 0.3) / (currentSpeed + 0.001);
    prefVX *= factor;
    prefVZ *= factor;
  }

  // 4. Exponential velocity smoothing (organic feel, no snapping)
  const smooth = 1 - Math.exp(-VEL_SMOOTH * dt);
  a.vx += (prefVX - a.vx) * smooth;
  a.vz += (prefVZ - a.vz) * smooth;

  // 5. Integrate position
  a.lx += a.vx * dt;
  a.lz += a.vz * dt;

  // 6. Wall clamp
  a.lx = Math.max(BOUNDS.minX + AGENT_RADIUS, Math.min(BOUNDS.maxX - AGENT_RADIUS, a.lx));
  a.lz = Math.max(BOUNDS.minZ + AGENT_RADIUS, Math.min(BOUNDS.maxZ - AGENT_RADIUS, a.lz));

  // 7. Facing: track actual velocity direction (not just target direction)
  const actualSpd = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
  if (actualSpd > 0.05) {
    a.tAng = Math.atan2(a.vx, a.vz);
  }

  // 8. Leg animation scaled to actual speed
  const speedRatio = Math.min(actualSpd / a.speed, 1.0);
  a.phase += dt * 9 * Math.max(speedRatio, 0.1);
  a.mesh.legL.rotation.x =  Math.sin(a.phase) * 0.4 * speedRatio;
  a.mesh.legR.rotation.x = -Math.sin(a.phase) * 0.4 * speedRatio;

  return false;
}

// ─────────────────────────────────────────────────────────────
// MAIN UPDATE
// ─────────────────────────────────────────────────────────────

/**
 * Per-frame state machine for all agents.
 * States: walk | pause | toDesk | work | waiting
 *
 * @param {number} dt
 * @param {number} t
 */
export function updateAgents(dt, t) {
  const { agents } = globalState;

  for (let i = 0; i < agents.length; i++) {
    const a  = agents[i];
    const rs = 1 - Math.exp(-10 * dt);

    // ── STATE MACHINE ──────────────────────────────────────────────

    if (a.state === 'walk') {
      const prevLx = a.lx;
      const prevLz = a.lz;

      if (agentWalkTo(a, dt)) {
        a.state      = 'pause';
        a.timer      = 1.5 + Math.random() * 2.5;
        a.stuckTimer = 0;
      } else {
        // Stuck detection: if actual speed is very low relative to desired speed
        const moved       = Math.sqrt((a.lx - prevLx) ** 2 + (a.lz - prevLz) ** 2);
        const actualRatio = (moved / (a.speed * dt + 0.0001));
        if (actualRatio < STUCK_SPEED_RATIO) {
          a.stuckTimer += dt;
        } else {
          a.stuckTimer = Math.max(0, a.stuckTimer - dt * 2);
        }
        // Enter waiting if stuck too long
        if (a.stuckTimer > STUCK_TIMEOUT) {
          a.state      = 'waiting';
          a.timer      = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
          a.stuckTimer = 0;
          a.vx         = 0;
          a.vz         = 0;
        }
      }
      a.ang = lerpAngle(a.ang, a.tAng, rs);
      a.legScale += (1.0 - a.legScale) * (1 - Math.exp(-6 * dt));
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff + Math.abs(Math.sin(a.phase)) * 0.015;

    } else if (a.state === 'pause') {
      a.timer -= dt;
      a.mesh.legL.rotation.x *= 0.92;
      a.mesh.legR.rotation.x *= 0.92;
      a.mesh.head.rotation.z  = Math.sin(t * 1.5 + a.phase) * 0.04;
      // Light RVO separation even while paused (avoid overlap with passing agents)
      const sep = computeRVO(a, 0, 0);
      a.lx += sep.vx * dt * 0.5;
      a.lz += sep.vz * dt * 0.5;

      if (a.timer <= 0) {
        if (Math.random() < a.wkChance) {
          const dk = findFreeDesk();
          if (dk) {
            dk.reservedBy = a;
            a.desk  = dk;
            a.tx    = dk.seatWX - RP_X;
            a.tz    = dk.seatWZ - RP_Z;
            a.tAng  = Math.atan2(a.tx - a.lx, a.tz - a.lz);
            a.state = 'toDesk';
          } else {
            agentPickWander(a);
          }
        } else {
          agentPickWander(a);
        }
      }
      a.ang = lerpAngle(a.ang, a.tAng, rs);
      a.legScale += (1.0 - a.legScale) * (1 - Math.exp(-6 * dt));
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff;

    } else if (a.state === 'waiting') {
      // Brief freeze after being stuck — let the crowd clear
      a.timer -= dt;
      a.mesh.legL.rotation.x *= 0.88;
      a.mesh.legR.rotation.x *= 0.88;
      a.mesh.head.rotation.z  = Math.sin(t * 1.8 + a.phase) * 0.05; // look around
      a.vx *= 0.7; // bleed off remaining velocity
      a.vz *= 0.7;
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff;
      a.legScale += (1.0 - a.legScale) * (1 - Math.exp(-6 * dt));

      if (a.timer <= 0) {
        // Pick a fresh wander target — don't retry the stuck one
        agentPickWander(a);
      }
      a.ang = lerpAngle(a.ang, a.tAng, rs * 0.4);

    } else if (a.state === 'toDesk') {
      // Use RVO disabled for final desk approach (avoid furniture jitter near chair)
      if (agentWalkTo(a, dt, false)) {
        if (a.desk) {
          a.lx   = a.desk.seatWX - RP_X;
          a.lz   = a.desk.seatWZ - RP_Z;
          a.tAng = a.desk.faceAngle;
        }
        a.state  = 'work';
        a.timer  = 5 + Math.random() * 8;
        a.sitTgt = CHAIR_SEAT_H - AGENT_BASE_Y;
        a.mesh.torso.rotation.x = 0;
        a.vx = 0;
        a.vz = 0;
      }
      a.ang = lerpAngle(a.ang, a.tAng, rs);
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff + Math.abs(Math.sin(a.phase)) * 0.015;

    } else if (a.state === 'work') {
      a.timer -= dt;
      a.sitOff += (a.sitTgt - a.sitOff) * (1 - Math.exp(-5 * dt));

      const lT = 1 - Math.exp(-6 * dt);
      a.mesh.legL.rotation.x += (1.2 - a.mesh.legL.rotation.x) * lT;
      a.mesh.legR.rotation.x += (1.2 - a.mesh.legR.rotation.x) * lT;
      a.legScale += (0.5 - a.legScale) * lT;
      a.mesh.botCap.visible = false;

      a.mesh.head.rotation.x = Math.sin(t * 2.2 + a.phase) * 0.035;
      a.mesh.head.rotation.z = Math.sin(t * 0.8 + a.phase * 2) * 0.02;
      a.mesh.torso.rotation.x = 0.06 + Math.sin(t + a.phase) * 0.01;
      a.ang = lerpAngle(a.ang, a.tAng, rs * 0.5);
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff + Math.sin(t * 1.2 + a.phase) * 0.002;

      if (a.timer <= 0) {
        if (a.desk) { a.desk.reservedBy = null; a.desk = null; }
        a.mesh.torso.rotation.x = 0;
        a.mesh.head.rotation.x  = 0;
        a.mesh.botCap.visible   = true;
        agentPickWander(a);
      }
    }

    // ── Sit-offset lerp for non-work states ──
    if (a.state !== 'work') {
      a.sitOff += (a.sitTgt - a.sitOff) * (1 - Math.exp(-5 * dt));
      if (Math.abs(a.sitOff) < 0.003) a.sitOff = 0;
    }

    // ── Apply leg scale (hip-pivot) ──
    a.mesh.legL.scale.y    = a.legScale;
    a.mesh.legR.scale.y    = a.legScale;
    a.mesh.legL.position.y = 0;
    a.mesh.legR.position.y = 0;

    // ── World position + rotation ──
    a.grp.position.x = RP_X + a.lx;
    a.grp.position.z = RP_Z + a.lz;
    a.grp.rotation.y = a.ang;

    // ── Foot clamp: prevent legs sinking below ground ──
    const footY = a.grp.position.y - AGENT_BASE_Y * a.legScale;
    if (footY < GROUND_Y - 0.02) {
      a.grp.position.y += (GROUND_Y - footY);
    }
  }
}
