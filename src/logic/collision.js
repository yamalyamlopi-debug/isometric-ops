/**
 * @file collision.js
 * @module logic/collision
 * @description Velocity-space collision avoidance for Isometric Ops.
 *
 * Exports:
 *   isInFurniture(lx, lz, margin)     — point-in-box furniture test
 *   randSafePt()                      — random safe spawn point
 *   computeRVO(a, prefVX, prefVZ)     — Reciprocal Velocity Obstacles
 *   steerAroundFurniture(a, vx, vz)   — tangential steering around desks
 *
 * RVO replaces the old applySeparation (position-space push forces).
 * It works in velocity space: for each neighbor, build a Velocity Obstacle
 * cone (set of velocities that cause a collision within TAU seconds),
 * shift it by ½·vNeighbor (reciprocal split), and if preferred velocity
 * falls inside the cone, steer sideways to the nearest edge.
 *
 * Result: agents predict conflicts ahead of time, sidestep smoothly,
 * and avoid equal-and-opposite push oscillations.
 */

'use strict';

import { globalState }    from '../core/state.js';
import {
  BOUNDS,
  AGENT_RADIUS,
  FURNITURE_MARGIN,
  RP_X, RP_Z,
} from '../core/state.js';

// ─────────────────────────────────────────────────────────────
// TUNING
// ─────────────────────────────────────────────────────────────

const TAU    = 2.5;               // RVO time horizon (seconds)
const COMB_R = AGENT_RADIUS * 1.85; // combined avoidance radius
const FURN_M = AGENT_RADIUS + FURNITURE_MARGIN; // furniture clearance

// ─────────────────────────────────────────────────────────────
// FURNITURE QUERY
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if (lx, lz) falls inside any desk/chair footprint.
 * @param {number} lx
 * @param {number} lz
 * @param {number} margin
 * @returns {boolean}
 */
export function isInFurniture(lx, lz, margin) {
  const { desks } = globalState;
  for (let i = 0; i < desks.length; i++) {
    const d = desks[i];
    if (
      Math.abs(lx - d.obsX) < d.obsRadX + margin &&
      Math.abs(lz - d.obsZ) < d.obsRadZ + margin
    ) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// SAFE RANDOM POINT
// ─────────────────────────────────────────────────────────────

/**
 * Returns a random walkable room-local point not inside furniture.
 * @returns {{ x: number, z: number }}
 */
export function randSafePt() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const px = BOUNDS.minX + 0.5 + Math.random() * (BOUNDS.maxX - BOUNDS.minX - 1);
    const pz = BOUNDS.minZ + 0.5 + Math.random() * (BOUNDS.maxZ - BOUNDS.minZ - 1);
    if (!isInFurniture(px, pz, AGENT_RADIUS + FURNITURE_MARGIN)) {
      return { x: px, z: pz };
    }
  }
  return { x: 0, z: BOUNDS.maxZ - 1 };
}

// ─────────────────────────────────────────────────────────────
// RVO — RECIPROCAL VELOCITY OBSTACLES
// ─────────────────────────────────────────────────────────────

/**
 * Given agent `a` and preferred velocity (prefVX, prefVZ), returns an
 * adjusted velocity that avoids predicted collisions.
 *
 * Per neighbor:
 *   1. Compute relative position and reciprocal relative velocity (subtracts ½·vB).
 *   2. Check if relative velocity lies inside the VO cone.
 *   3. If so, steer sideways to the nearest cone boundary.
 *   4. Hard-overlap fallback: direct push if already penetrating.
 *
 * @param {import('../core/state.js').AgentRecord} a
 * @param {number} prefVX
 * @param {number} prefVZ
 * @returns {{ vx: number, vz: number }}
 */
export function computeRVO(a, prefVX, prefVZ) {
  const { agents, manager } = globalState;
  let vx = prefVX;
  let vz = prefVZ;

  // Build neighbor list: walking agents + manager
  const neighbors = [];
  for (let i = 0; i < agents.length; i++) {
    const b = agents[i];
    if (b === a || b.state === 'work') continue;
    neighbors.push({ lx: b.lx, lz: b.lz, bvx: b.vx || 0, bvz: b.vz || 0 });
  }
  neighbors.push({
    lx: manager.worldX - RP_X,
    lz: manager.worldZ - RP_Z,
    bvx: 0,
    bvz: 0,
  });

  for (let ni = 0; ni < neighbors.length; ni++) {
    const nb   = neighbors[ni];
    const dx   = nb.lx - a.lx;
    const dz   = nb.lz - a.lz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.001) continue;

    // Hard overlap: direct repulsion
    if (dist < COMB_R) {
      const pen  = (COMB_R - dist) / COMB_R;
      const invD = 1 / dist;
      vx -= dx * invD * pen * a.speed * 1.6;
      vz -= dz * invD * pen * a.speed * 1.6;
      continue;
    }

    // Skip if well outside time horizon
    if (dist > TAU * a.speed * 1.5 + COMB_R) continue;

    // Reciprocal relative velocity: A's velocity minus half of B's
    const rvx = vx - nb.bvx * 0.5;
    const rvz = vz - nb.bvz * 0.5;

    // VO cone axis: direction from A toward B
    const invDist = 1 / dist;
    const axX = dx * invDist;
    const axZ = dz * invDist;

    // Closing speed along axis
    const projLen = rvx * axX + rvz * axZ;
    if (projLen <= 0) continue; // separating in relative frame

    // VO reach along axis: dist / TAU
    const voReach = dist / TAU;
    if (projLen > voReach * 2.2) continue; // already "past" in velocity space

    // Perpendicular component of relative velocity
    const perpX   = rvx - projLen * axX;
    const perpZ   = rvz - projLen * axZ;
    const perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ);

    // VO half-angle: sin = COMB_R / dist
    const sinA = Math.min(COMB_R / dist, 0.97);
    const cosA = Math.sqrt(1 - sinA * sinA);
    const tanA = sinA / cosA;

    // Inside cone? |perp| < proj · tan(A)
    if (perpLen >= projLen * tanA) continue;

    // Determine exit side: sign of cross product (axis × perp)
    const crossSign = (axX * perpZ - axZ * perpX) >= 0 ? 1 : -1;

    // Tangent direction of the cone boundary on the correct side
    const tX = crossSign *  axZ * sinA + axX * cosA;
    const tZ = crossSign * -axX * sinA + axZ * cosA;

    // Correction magnitude (scales with cone depth + urgency)
    const depth        = 1.0 - perpLen / (projLen * tanA + 0.0001);
    const timeUrgency  = 1.0 - Math.min(projLen / (voReach + 0.001), 1.0);
    const spaceUrgency = COMB_R / (dist + 0.001);
    const corrStr      = depth * timeUrgency * spaceUrgency * a.speed * 1.4 * 0.5;

    vx += tX * corrStr;
    vz += tZ * corrStr;
  }

  // Clamp output to agent's max speed
  const spd = Math.sqrt(vx * vx + vz * vz);
  if (spd > a.speed * 1.15) {
    const inv = (a.speed * 1.15) / spd;
    vx *= inv;
    vz *= inv;
  }

  return { vx, vz };
}

// ─────────────────────────────────────────────────────────────
// FURNITURE STEERING
// ─────────────────────────────────────────────────────────────

/**
 * Steers agent velocity to slide around desk obstacles.
 * AABB tangential approach:
 *   · The axis with smaller penetration depth → repulsion axis.
 *   · The other axis is left free → agent slides along the desk edge.
 *   · Deep embedding triggers both axes.
 *
 * @param {import('../core/state.js').AgentRecord} a
 * @param {number} vx
 * @param {number} vz
 * @returns {{ vx: number, vz: number }}
 */
export function steerAroundFurniture(a, vx, vz) {
  const { desks } = globalState;

  for (let i = 0; i < desks.length; i++) {
    const d = desks[i];

    const dx   = a.lx - d.obsX;
    const dz   = a.lz - d.obsZ;
    const penX = d.obsRadX + FURN_M - Math.abs(dx);
    const penZ = d.obsRadZ + FURN_M - Math.abs(dz);

    if (penX <= 0 || penZ <= 0) continue;

    if (penX > 0.1 || penZ > 0.1) {
      vx = 0;
      vz = 0;
      return { vx, vz };
    }

    const sgnX = dx >= 0 ? 1 : -1;
    const sgnZ = dz >= 0 ? 1 : -1;

    if (penX < penZ) {
      // Near left/right face: repel X, slide Z
      vx += sgnX * penX * 9.0;
      if (vx * sgnX < 0) vx *= 0.3; // cancel inward velocity
      if (penX > 0.08)   vz += sgnZ * penZ * 4.0; // deep embed
    } else {
      // Near front/back face: repel Z, slide X
      vz += sgnZ * penZ * 9.0;
      if (vz * sgnZ < 0) vz *= 0.3;
      if (penZ > 0.08)   vx += sgnX * penX * 4.0;
    }
  }

  return { vx, vz };
}
