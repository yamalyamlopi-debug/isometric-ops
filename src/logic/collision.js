/**
 * @file collision.js
 * @module logic/collision
 * @description Collision and separation utilities for Isometric Ops.
 *
 * All functions operate on room-local coordinates (lx / lz).
 * They read globalState.desks, globalState.agents, and globalState.manager
 * but never write to the scene or THREE.js objects directly.
 */

'use strict';

import { globalState }                              from '../core/state.js';
import {
  BOUNDS,
  AGENT_RADIUS,
  AGENT_SEPARATION,
  FURNITURE_MARGIN,
  RP_X, RP_Z,
} from '../core/state.js';

// ─────────────────────────────────────────────────────────────
// FURNITURE QUERY
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if the room-local point (lx, lz) falls inside any
 * registered furniture obstacle (desk + chair footprint).
 *
 * @param {number} lx     - Room-local X position
 * @param {number} lz     - Room-local Z position
 * @param {number} margin - Extra clearance added around each obstacle's half-extents
 * @returns {boolean}
 */
export function isInFurniture(lx, lz, margin) {
  const { desks } = globalState;
  for (let i = 0; i < desks.length; i++) {
    const d = desks[i];
    if (
      Math.abs(lx - d.obsX) < d.obsRadX + margin &&
      Math.abs(lz - d.obsZ) < d.obsRadZ + margin
    ) {
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// AGENT–AGENT + AGENT–MANAGER SEPARATION
// ─────────────────────────────────────────────────────────────

/**
 * Computes and applies a separation push-force for agent `a` against all
 * other walking agents and the manager.  Modifies a.lx / a.lz in place.
 *
 * Seated agents (state === 'work') are skipped as push targets; they are
 * locked in place by the desk system.
 *
 * @param {import('../core/state.js').AgentRecord} a  - Agent to push
 * @param {number} dt - Frame delta-time in seconds
 */
export function applySeparation(a, dt) {
  const { agents, manager } = globalState;
  let pushX = 0;
  let pushZ = 0;

  // agent ↔ agent
  for (let j = 0; j < agents.length; j++) {
    const b = agents[j];
    if (b === a)                continue; // skip self
    if (b.state === 'work')     continue; // don't push seated agents

    const dx   = a.lx - b.lx;
    const dz   = a.lz - b.lz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < AGENT_SEPARATION && dist > 0.01) {
      const overlap = AGENT_SEPARATION - dist;
      pushX += (dx / dist) * overlap * 2.0;
      pushZ += (dz / dist) * overlap * 2.0;
    }
  }

  // agent ↔ manager
  const mDx   = a.lx - (manager.worldX - RP_X);
  const mDz   = a.lz - (manager.worldZ - RP_Z);
  const mDist = Math.sqrt(mDx * mDx + mDz * mDz);
  if (mDist < AGENT_SEPARATION && mDist > 0.01) {
    const mOver = AGENT_SEPARATION - mDist;
    pushX += (mDx / mDist) * mOver * 2.0;
    pushZ += (mDz / mDist) * mOver * 2.0;
  }

  if (pushX !== 0 || pushZ !== 0) {
    a.lx += pushX * dt * 3;
    a.lz += pushZ * dt * 3;
  }
}

// ─────────────────────────────────────────────────────────────
// SAFE RANDOM POINT
// ─────────────────────────────────────────────────────────────

/**
 * Returns a random walkable room-local point that is not inside any
 * furniture obstacle.  Attempts up to 20 random positions before
 * falling back to a known-safe location at the front of the room.
 *
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
  // fallback: open area near the front (positive-Z side of room)
  return { x: 0, z: BOUNDS.maxZ - 1 };
}
