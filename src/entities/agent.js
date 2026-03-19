/**
 * @file agent.js
 * @module entities/agent
 * @description Autonomous worker agents for Isometric Ops.
 *
 * Exports:
 *   buildAgent(palIdx)                    — build and return mesh parts
 *   spawnAgent(startX, startZ, palIdx, speed) — create, add to scene, register in globalState
 *   updateAgents(dt, t)                   — per-frame state machine for all agents
 */

'use strict';

import { scene }                           from '../core/scene.js';
import { globalState }                     from '../core/state.js';
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
import { applySeparation, isInFurniture, randSafePt } from '../logic/collision.js';

// ─────────────────────────────────────────────────────────────
// COLOUR PALETTE (5 entries, cycles via palIdx % 5)
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

/**
 * Lerps angle `a` toward `b` by factor `t`, taking the shortest arc.
 * @param {number} a - Current angle (radians)
 * @param {number} b - Target angle (radians)
 * @param {number} t - Lerp factor [0–1]
 * @returns {number}
 */
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ─────────────────────────────────────────────────────────────
// MESH FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Builds and returns the Three.js mesh parts for one agent.
 * Group origin = hip (local y=0), feet reach local y = -AGENT_BASE_Y.
 *
 * @param {number} palIdx - Palette index (wraps with modulo)
 * @returns {{ grp: THREE.Group, torso, head, legL, legR, botCap }}
 */
export function buildAgent(palIdx) {
  const pal      = PALETTE[palIdx % PALETTE.length];
  const bodyMat  = new THREE.MeshStandardMaterial({ color: pal.body, roughness: 0.6,  metalness: 0.05 });
  const accMat   = new THREE.MeshStandardMaterial({ color: pal.acc,  roughness: 0.55, metalness: 0.05 });
  const skinMat  = new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.7 });

  const grp   = new THREE.Group();
  const bR    = 0.2;
  const bH    = 0.6;

  // torso (hip = y=0, top = y=bH)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(bR, bR * 0.92, bH, 12), bodyMat);
  torso.position.set(0, bH / 2, 0);
  torso.castShadow = true;
  grp.add(torso);

  // rounded shoulder cap
  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(bR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    bodyMat
  );
  topCap.position.set(0, bH, 0);
  grp.add(topCap);

  // rounded hip cap (hidden when seated)
  const botCap = new THREE.Mesh(
    new THREE.SphereGeometry(bR * 0.92, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    bodyMat
  );
  botCap.position.set(0, 0, 0);
  grp.add(botCap);

  // head
  const hR   = 0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(hR, 14, 10), skinMat);
  head.position.set(0, bH + hR + 0.05, 0);
  head.castShadow = true;
  grp.add(head);

  // hair (upper hemisphere)
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(hR * 1.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    accMat
  );
  hair.position.set(0, head.position.y + 0.02, 0);
  grp.add(hair);

  // legs — geometry translated so pivot is at hip (local y=0), feet at y=-AGENT_LEG_H
  const legGeoL = new THREE.CylinderGeometry(AGENT_LEG_TOP_R, AGENT_LEG_BOT_R, AGENT_LEG_H, 8);
  legGeoL.translate(0, -AGENT_LEG_H / 2, 0);
  const legL = new THREE.Mesh(legGeoL, accMat);
  legL.position.set(-0.075, 0, 0);
  legL.castShadow = true;
  grp.add(legL);

  const legGeoR = new THREE.CylinderGeometry(AGENT_LEG_TOP_R, AGENT_LEG_BOT_R, AGENT_LEG_H, 8);
  legGeoR.translate(0, -AGENT_LEG_H / 2, 0);
  const legR = new THREE.Mesh(legGeoR, accMat);
  legR.position.set(0.075, 0, 0);
  legR.castShadow = true;
  grp.add(legR);

  // ground shadow disc — in local space, floor = -AGENT_BASE_Y (computed after init)
  const shad = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 16),
    new THREE.MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0.15, depthWrite: false })
  );
  shad.rotation.x = -Math.PI / 2;
  shad.position.set(0, -AGENT_BASE_Y + 0.002, 0); // AGENT_BASE_Y set after initGroundConstants()
  grp.add(shad);

  return { grp, torso, head, legL, legR, botCap };
}

// ─────────────────────────────────────────────────────────────
// SPAWN
// ─────────────────────────────────────────────────────────────

/**
 * Creates one agent, places it in the scene, and pushes an AgentRecord
 * into globalState.agents[].
 *
 * @param {number} startX - Initial room-local X
 * @param {number} startZ - Initial room-local Z
 * @param {number} palIdx - Palette colour index
 * @param {number} speed  - Walk speed in units/second
 */
export function spawnAgent(startX, startZ, palIdx, speed) {
  const mesh = buildAgent(palIdx);
  mesh.grp.position.set(RP_X + startX, GROUND_Y + AGENT_BASE_Y, RP_Z + startZ);
  scene.add(mesh.grp);

  const wp = randSafePt();
  globalState.agents.push({
    mesh,
    grp:      mesh.grp,
    speed,
    state:    'walk',
    lx:       startX,
    lz:       startZ,
    tx:       wp.x,
    tz:       wp.z,
    ang:      0,
    tAng:     Math.atan2(wp.x - startX, wp.z - startZ),
    timer:    0,
    phase:    Math.random() * Math.PI * 2,
    desk:     null,
    sitOff:   0,
    sitTgt:   0,
    wkChance: 0.5,
    legScale: 1.0,
  });
}

// ─────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────

/** @param {import('../core/state.js').AgentRecord} a */
function agentPickWander(a) {
  const wp = randSafePt();
  a.tx    = wp.x;
  a.tz    = wp.z;
  a.tAng  = Math.atan2(wp.x - a.lx, wp.z - a.lz);
  a.sitTgt = 0;
  a.state  = 'walk';
}

/** Returns the first un-reserved desk, or null if all are taken. */
function findFreeDesk() {
  const { desks } = globalState;
  for (let i = 0; i < desks.length; i++) {
    if (!desks[i].reservedBy) return desks[i];
  }
  return null;
}

/**
 * Moves agent toward (a.tx, a.tz).  Returns true when arrived.
 * Animates leg swing and clamps position to room bounds.
 *
 * @param {import('../core/state.js').AgentRecord} a
 * @param {number} dt
 * @returns {boolean}
 */
function agentWalkTo(a, dt) {
  const dx   = a.tx - a.lx;
  const dz   = a.tz - a.lz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.15) return true;

  const step = Math.min(a.speed * dt / dist, 1);
  a.lx += dx * step;
  a.lz += dz * step;

  // wall bounds
  a.lx = Math.max(BOUNDS.minX + AGENT_RADIUS, Math.min(BOUNDS.maxX - AGENT_RADIUS, a.lx));
  a.lz = Math.max(BOUNDS.minZ + AGENT_RADIUS, Math.min(BOUNDS.maxZ - AGENT_RADIUS, a.lz));

  // face direction of travel
  if (dist > 0.15) a.tAng = Math.atan2(dx, dz);

  // leg swing animation
  a.phase += dt * 9;
  a.mesh.legL.rotation.x =  Math.sin(a.phase) * 0.4;
  a.mesh.legR.rotation.x = -Math.sin(a.phase) * 0.4;
  return false;
}

/**
 * Pushes agent out of furniture obstacles during 'walk' state only.
 * Skips 'toDesk' and 'work' states to avoid jitter when seated.
 *
 * @param {import('../core/state.js').AgentRecord} a
 * @param {number} dt
 */
function avoidFurniture(a, dt) {
  if (a.state === 'work' || a.state === 'toDesk') return;
  const { desks } = globalState;
  const { AGENT_RADIUS: AR, FURNITURE_MARGIN: FM } = { AGENT_RADIUS, FURNITURE_MARGIN: 0.15 };
  for (let i = 0; i < desks.length; i++) {
    const d    = desks[i];
    const dx   = a.lx - d.obsX;
    const dz   = a.lz - d.obsZ;
    const penX = d.obsRadX + AGENT_RADIUS + 0.15 - Math.abs(dx);
    const penZ = d.obsRadZ + AGENT_RADIUS + 0.15 - Math.abs(dz);
    if (penX > 0 && penZ > 0) {
      if (penX < penZ) {
        a.lx += (dx > 0 ? penX : -penX) * dt * 5;
      } else {
        a.lz += (dz > 0 ? penZ : -penZ) * dt * 5;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN UPDATE
// ─────────────────────────────────────────────────────────────

/**
 * Runs the per-frame state machine for every agent in globalState.agents[].
 * Called once per animation frame from main.js.
 *
 * @param {number} dt - Frame delta-time in seconds
 * @param {number} t  - Total elapsed time in seconds
 */
export function updateAgents(dt, t) {
  const { agents } = globalState;

  for (let i = 0; i < agents.length; i++) {
    const a  = agents[i];
    const rs = 1 - Math.exp(-10 * dt); // rotation lerp factor

    // ── STATE MACHINE ──────────────────────────────────────────────

    if (a.state === 'walk') {
      if (agentWalkTo(a, dt)) {
        a.state = 'pause';
        a.timer = 1.5 + Math.random() * 2.5;
      }
      applySeparation(a, dt);
      avoidFurniture(a, dt);
      a.ang = lerpAngle(a.ang, a.tAng, rs);
      a.legScale += (1.0 - a.legScale) * (1 - Math.exp(-6 * dt));
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff + Math.abs(Math.sin(a.phase)) * 0.015;

    } else if (a.state === 'pause') {
      a.timer -= dt;
      a.mesh.legL.rotation.x *= 0.92;
      a.mesh.legR.rotation.x *= 0.92;
      a.mesh.head.rotation.z  = Math.sin(t * 1.5 + a.phase) * 0.04;
      applySeparation(a, dt);

      if (a.timer <= 0) {
        if (Math.random() < a.wkChance) {
          const dk = findFreeDesk();
          if (dk) {
            dk.reservedBy = a;
            a.desk = dk;
            a.tx   = dk.seatWX - RP_X;
            a.tz   = dk.seatWZ - RP_Z;
            a.tAng = Math.atan2(a.tx - a.lx, a.tz - a.lz);
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

    } else if (a.state === 'toDesk') {
      if (agentWalkTo(a, dt)) {
        // snap to exact chair anchor
        if (a.desk) {
          a.lx   = a.desk.seatWX - RP_X;
          a.lz   = a.desk.seatWZ - RP_Z;
          a.tAng = a.desk.faceAngle;
        }
        a.state  = 'work';
        a.timer  = 5 + Math.random() * 8;
        // hip rises to chair-seat height above floor
        a.sitTgt = CHAIR_SEAT_H - AGENT_BASE_Y;
        a.mesh.torso.rotation.x = 0;
      }
      a.ang = lerpAngle(a.ang, a.tAng, rs);
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff + Math.abs(Math.sin(a.phase)) * 0.015;

    } else if (a.state === 'work') {
      a.timer -= dt;

      // smooth sit interpolation
      a.sitOff += (a.sitTgt - a.sitOff) * (1 - Math.exp(-5 * dt));

      // legs: bend forward + scale down to avoid chair clipping
      const lT = 1 - Math.exp(-6 * dt);
      a.mesh.legL.rotation.x += (1.2 - a.mesh.legL.rotation.x) * lT;
      a.mesh.legR.rotation.x += (1.2 - a.mesh.legR.rotation.x) * lT;
      a.legScale += (0.5 - a.legScale) * lT;
      a.mesh.botCap.visible = false;

      // typing head micro-motions
      a.mesh.head.rotation.x = Math.sin(t * 2.2 + a.phase) * 0.035;
      a.mesh.head.rotation.z = Math.sin(t * 0.8 + a.phase * 2) * 0.02;
      // torso lean
      a.mesh.torso.rotation.x = 0.06 + Math.sin(t + a.phase) * 0.01;
      // face monitor
      a.ang = lerpAngle(a.ang, a.tAng, rs * 0.5);
      // breathing bob
      a.grp.position.y = GROUND_Y + AGENT_BASE_Y + a.sitOff + Math.sin(t * 1.2 + a.phase) * 0.002;

      if (a.timer <= 0) {
        // stand up and wander
        if (a.desk) { a.desk.reservedBy = null; a.desk = null; }
        a.mesh.torso.rotation.x = 0;
        a.mesh.head.rotation.x  = 0;
        a.mesh.botCap.visible   = true;
        agentPickWander(a);
      }
    }

    // ── Sit-offset lerp for non-work states (stand-up return) ──
    if (a.state !== 'work') {
      a.sitOff += (a.sitTgt - a.sitOff) * (1 - Math.exp(-5 * dt));
      if (Math.abs(a.sitOff) < 0.003) a.sitOff = 0;
    }

    // ── Apply leg scale (hip-pivot: legs hang from y=0) ──
    a.mesh.legL.scale.y  = a.legScale;
    a.mesh.legR.scale.y  = a.legScale;
    a.mesh.legL.position.y = 0;
    a.mesh.legR.position.y = 0;

    // ── Apply world position + rotation ──
    a.grp.position.x = RP_X + a.lx;
    a.grp.position.z = RP_Z + a.lz;
    a.grp.rotation.y = a.ang;
  }
}
