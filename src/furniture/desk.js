/**
 * @file desk.js
 * @module furniture/desk
 * @description Desk and chair factories, and setupDesks() which builds both
 * desk stations and registers them in globalState.desks[].
 *
 * screenMat is exported so main.js can pulse emissiveIntensity each frame.
 */

'use strict';

import { scene, groundOnFloor }                    from '../core/scene.js';
import { globalState }                             from '../core/state.js';
import {
  RP_X, RP_Y, RP_Z,
  FLOOR_Y, FLOOR_T, WALL_T,
  DESK_H, CHAIR_OFFSET, CHAIR_SEAT_H,
} from '../core/state.js';

// ─────────────────────────────────────────────────────────────
// MATERIALS
// ─────────────────────────────────────────────────────────────

const deskMat      = new THREE.MeshStandardMaterial({ color: 0xd4c8b8, roughness: 0.5,  metalness: 0.05 });
const deskLegMat   = new THREE.MeshStandardMaterial({ color: 0x4a4550, roughness: 0.4,  metalness: 0.15 });
const monitorMat   = new THREE.MeshStandardMaterial({ color: 0x3a3540, roughness: 0.35, metalness: 0.15 });
const chairFrameMat= new THREE.MeshStandardMaterial({ color: 0x50505e, roughness: 0.4,  metalness: 0.12 });
const chairCushMat = new THREE.MeshStandardMaterial({ color: 0x65657a, roughness: 0.65, metalness: 0.02 });

/**
 * Screen material — exported so main.js can animate emissiveIntensity.
 * @type {THREE.MeshStandardMaterial}
 */
export const screenMat = new THREE.MeshStandardMaterial({
  color: 0x8ba4c8, roughness: 0.15, metalness: 0.05,
  emissive: 0x4a6080, emissiveIntensity: 0.35,
});

// ─────────────────────────────────────────────────────────────
// DESK FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Builds a desk group with a surface, 4 legs, monitor, screen and stand.
 * Group origin is at the bottom-center of the desk.
 *
 * @param {number} w - Desk width in world units
 * @param {number} d - Desk depth in world units
 * @returns {THREE.Group}
 */
export function buildDesk(w, d) {
  const grp = new THREE.Group();
  const th = 0.05;

  // desktop surface
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, th, d), deskMat);
  top.position.set(0, DESK_H, 0);
  top.castShadow = true; top.receiveShadow = true;
  grp.add(top);

  // 4 legs — corner positions as [xSign, zSign]
  const legCorners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [xs, zs] of legCorners) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, DESK_H - 0.02, 8),
      deskLegMat
    );
    leg.position.set(xs * (w / 2 - 0.06), (DESK_H - 0.02) / 2, zs * (d / 2 - 0.06));
    leg.castShadow = true;
    grp.add(leg);
  }

  // monitor bezel
  const mW = w * 0.45;
  const mH = mW * 0.65;
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(mW, mH, 0.03), monitorMat);
  monitor.position.set(0, DESK_H + th / 2 + mH / 2 + 0.15, -d / 2 + 0.12);
  monitor.castShadow = true;
  grp.add(monitor);

  // screen surface (uses exported screenMat)
  const screen = new THREE.Mesh(new THREE.BoxGeometry(mW - 0.04, mH - 0.04, 0.005), screenMat);
  screen.position.set(0, monitor.position.y, monitor.position.z + 0.018);
  grp.add(screen);

  // monitor stand
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8),
    deskLegMat
  );
  stand.position.set(0, DESK_H + th / 2 + 0.075, -d / 2 + 0.12);
  grp.add(stand);

  return grp;
}

// ─────────────────────────────────────────────────────────────
// CHAIR FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Builds a chair group with a 5-star base, post, seat cushion and backrest.
 *
 * @returns {THREE.Group}
 */
export function buildChair() {
  const grp = new THREE.Group();

  // central post
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, CHAIR_SEAT_H - 0.06, 8),
    chairFrameMat
  );
  post.position.set(0, (CHAIR_SEAT_H - 0.06) / 2, 0);
  post.castShadow = true;
  grp.add(post);

  // 5-star base
  for (let ci = 0; ci < 5; ci++) {
    const angle = (ci / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.02), chairFrameMat);
    arm.position.set(Math.sin(angle) * 0.1, 0.01, Math.cos(angle) * 0.1);
    arm.rotation.y = angle;
    grp.add(arm);

    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), chairFrameMat);
    wheel.position.set(Math.sin(angle) * 0.18, 0.018, Math.cos(angle) * 0.18);
    grp.add(wheel);
  }

  // seat cushion
  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.175, 0.055, 16),
    chairCushMat
  );
  seat.position.set(0, CHAIR_SEAT_H, 0);
  seat.castShadow = true; seat.receiveShadow = true;
  grp.add(seat);

  // backrest
  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.035), chairCushMat);
  backrest.position.set(0, CHAIR_SEAT_H + 0.17, -0.18);
  backrest.rotation.x = -0.06;
  backrest.castShadow = true;
  grp.add(backrest);

  return grp;
}

// ─────────────────────────────────────────────────────────────
// DESK SETUP — builds both stations and fills globalState.desks[]
// ─────────────────────────────────────────────────────────────

/**
 * Creates and places both desk/chair pairs in the scene.
 * Populates globalState.desks[] with DeskRecord objects.
 * desks[0] is the manager's home desk (reservedBy set in manager.js).
 * Must be called after initGroundConstants().
 */
export function setupDesks() {
  // ── Desk 1: center, against back wall, facing +Z ──
  const desk1 = buildDesk(2.0, 0.88);
  desk1.position.set(RP_X, 0, RP_Z - 3.5);
  groundOnFloor(desk1, FLOOR_Y);
  scene.add(desk1);

  const chair1 = buildChair();
  chair1.position.set(desk1.position.x, 0, desk1.position.z + CHAIR_OFFSET);
  groundOnFloor(chair1, FLOOR_Y);
  chair1.rotation.y = Math.PI; // backrest faces -Z (toward desk)
  scene.add(chair1);

  globalState.desks.push({
    deskGrp:    desk1,
    chairGrp:   chair1,
    seatWX:     chair1.position.x,
    seatWZ:     chair1.position.z,
    faceAngle:  Math.PI,       // seated occupant faces -Z (toward monitor)
    reservedBy: null,          // manager.js sets this to 'manager' after buildManager()
    // furniture avoidance bounds (room-local)
    obsX:    desk1.position.x - RP_X,
    obsZ:    desk1.position.z - RP_Z,
    obsRadX: 1.2,
    obsRadZ: 0.9,
  });

  // ── Desk 2: left side, rotated 90° (facing +X) ──
  const desk2 = buildDesk(1.6, 0.76);
  desk2.position.set(RP_X - 2.8, 0, RP_Z - 0.5);
  desk2.rotation.y = Math.PI / 2;
  groundOnFloor(desk2, FLOOR_Y);
  scene.add(desk2);

  // chair offset along desk's local +Z, which is world +X after 90° rotation
  const c2X     = desk2.position.x + Math.sin(desk2.rotation.y) * CHAIR_OFFSET;
  const c2Z     = desk2.position.z + Math.cos(desk2.rotation.y) * CHAIR_OFFSET;
  const c2Angle = Math.PI * 1.5; // agent faces -X (toward monitor on left wall)

  const chair2 = buildChair();
  chair2.position.set(c2X, 0, c2Z);
  groundOnFloor(chair2, FLOOR_Y);
  chair2.rotation.y = c2Angle;
  scene.add(chair2);

  globalState.desks.push({
    deskGrp:    desk2,
    chairGrp:   chair2,
    seatWX:     chair2.position.x,
    seatWZ:     chair2.position.z,
    faceAngle:  c2Angle,
    reservedBy: null,
    obsX:    desk2.position.x - RP_X,
    obsZ:    desk2.position.z - RP_Z,
    obsRadX: 0.9,
    obsRadZ: 1.0,
  });
}
