/**
 * @file manager.js
 * @module entities/manager
 * @description Player-controlled manager character for Isometric Ops.
 *
 * Exports:
 *   buildManager()               — build mesh, set initial state from desks[0]
 *   initManagerClickHandler()    — wire up raycasting + click/hover events
 *   updateManager(dt, t)         — per-frame 5-state machine
 *
 * The module writes globalState.manager.worldX/worldZ each frame so
 * camera.js can read the manager's position without a direct import.
 */

'use strict';

import { scene, canvas, camera }    from '../core/scene.js';
import { globalState }              from '../core/state.js';
import {
  RP_X, RP_Y, RP_Z,
  FLOOR_T,
  GROUND_Y,
  MGR_LEG_H,
  MGR_LEG_TOP_R,
  MGR_LEG_BOT_R,
  MGR_BASE_Y,
  CHAIR_SEAT_H,
  BOUNDS,
  AGENT_RADIUS,
} from '../core/state.js';
import { isInFurniture }            from '../logic/collision.js';
import { cameraInput }              from '../core/camera.js';

// ─────────────────────────────────────────────────────────────
// MOVEMENT CONSTANTS
// ─────────────────────────────────────────────────────────────

const MGR_SPEED       = 1.4;   // units / second
const MGR_ROT_SPEED   = 8.0;   // rotation lerp rate
const MGR_ARRIVE_DIST = 0.12;  // arrival threshold
const MGR_STAND_TIME  = 0.4;   // seconds for stand-up animation before walking

// ─────────────────────────────────────────────────────────────
// MODULE-LEVEL MESH REFERENCES
// ─────────────────────────────────────────────────────────────

/** @type {THREE.Group} */
let mgrGrp;
/** @type {THREE.Mesh}  */ let mgrTorso;
/** @type {THREE.Mesh}  */ let mgrHead;
/** @type {THREE.Mesh}  */ let mgrLegL;
/** @type {THREE.Mesh}  */ let mgrLegR;
/** @type {THREE.Mesh}  */ let mgrBotCap;
/** @type {THREE.Mesh}  */ let mgrDiamond;
/** @type {THREE.Mesh}  */ let markerRing;
/** @type {THREE.Mesh}  */ let markerDot;

// ─────────────────────────────────────────────────────────────
// LOCAL LERP HELPER
// ─────────────────────────────────────────────────────────────

/**
 * Lerps angle `a` toward `b` by factor `t`, taking the shortest arc.
 * @param {number} a @param {number} b @param {number} t
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
 * Builds the manager character, places it at desks[0], and initialises
 * globalState.manager.  Also marks desks[0].reservedBy = 'manager'.
 *
 * Must be called after setupDesks().
 */
export function buildManager() {
  const { desks, manager } = globalState;

  // ── Materials ──
  const suitMat = new THREE.MeshStandardMaterial({ color: 0x2a3045, roughness: 0.5,  metalness: 0.08 });
  const accMat  = new THREE.MeshStandardMaterial({ color: 0x1e2538, roughness: 0.45, metalness: 0.1  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0d0b4, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6,  metalness: 0.05 });

  mgrGrp = new THREE.Group();
  const bR = 0.22;
  const bH = 0.65;

  // torso
  mgrTorso = new THREE.Mesh(new THREE.CylinderGeometry(bR, bR * 0.9, bH, 12), suitMat);
  mgrTorso.position.set(0, bH / 2, 0);
  mgrTorso.castShadow = true;
  mgrGrp.add(mgrTorso);

  // top shoulder cap
  const topCap = new THREE.Mesh(
    new THREE.SphereGeometry(bR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    suitMat
  );
  topCap.position.set(0, bH, 0);
  mgrGrp.add(topCap);

  // lower hip cap (hidden when seated)
  mgrBotCap = new THREE.Mesh(
    new THREE.SphereGeometry(bR * 0.9, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    suitMat
  );
  mgrBotCap.position.set(0, 0, 0);
  mgrGrp.add(mgrBotCap);

  // head
  const hR = 0.17;
  mgrHead  = new THREE.Mesh(new THREE.SphereGeometry(hR, 14, 10), skinMat);
  mgrHead.position.set(0, bH + hR + 0.06, 0);
  mgrHead.castShadow = true;
  mgrGrp.add(mgrHead);

  // hair
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(hR * 1.06, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
    hairMat
  );
  hair.position.set(0, mgrHead.position.y + 0.02, 0);
  mgrGrp.add(hair);

  // legs — hip-pivot (geometry translated so pivot = hip = local y=0)
  const legGeoL = new THREE.CylinderGeometry(MGR_LEG_TOP_R, MGR_LEG_BOT_R, MGR_LEG_H, 8);
  legGeoL.translate(0, -MGR_LEG_H / 2, 0);
  mgrLegL = new THREE.Mesh(legGeoL, accMat);
  mgrLegL.position.set(-0.08, 0, 0);
  mgrLegL.castShadow = true;
  mgrGrp.add(mgrLegL);

  const legGeoR = new THREE.CylinderGeometry(MGR_LEG_TOP_R, MGR_LEG_BOT_R, MGR_LEG_H, 8);
  legGeoR.translate(0, -MGR_LEG_H / 2, 0);
  mgrLegR = new THREE.Mesh(legGeoR, accMat);
  mgrLegR.position.set(0.08, 0, 0);
  mgrLegR.castShadow = true;
  mgrGrp.add(mgrLegR);

  // shadow disc (floor in local space = -MGR_BASE_Y)
  const shad = new THREE.Mesh(
    new THREE.CircleGeometry(0.24, 16),
    new THREE.MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shad.rotation.x = -Math.PI / 2;
  shad.position.set(0, -MGR_BASE_Y + 0.002, 0);
  mgrGrp.add(shad);

  // floating diamond indicator above head
  mgrDiamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.08, 0),
    new THREE.MeshStandardMaterial({
      color: 0x6BE88A, emissive: 0x3AC060, emissiveIntensity: 0.6,
      roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.85,
    })
  );
  mgrDiamond.position.set(0, mgrHead.position.y + 0.35, 0);
  mgrGrp.add(mgrDiamond);

  // ── Click destination marker ──
  markerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.25, 24),
    new THREE.MeshBasicMaterial({
      color: 0x6BE88A, transparent: true, opacity: 0.6,
      depthWrite: false, side: THREE.DoubleSide,
    })
  );
  markerRing.rotation.x = -Math.PI / 2;
  markerRing.visible = false;
  scene.add(markerRing);

  markerDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 12),
    new THREE.MeshBasicMaterial({ color: 0x6BE88A, transparent: true, opacity: 0.8, depthWrite: false })
  );
  markerDot.rotation.x = -Math.PI / 2;
  markerDot.visible = false;
  scene.add(markerDot);

  // ── Seed globalState.manager from desks[0] ──
  const seat0 = desks[0];
  const MGR_SEATED_Y = CHAIR_SEAT_H - MGR_BASE_Y;

  manager.lx      = seat0.seatWX - RP_X;
  manager.lz      = seat0.seatWZ - RP_Z;
  manager.ang     = seat0.faceAngle;
  manager.tAng    = seat0.faceAngle;
  manager.sitOff  = MGR_SEATED_Y;
  manager.sitTgt  = MGR_SEATED_Y;
  manager.legScale= 0.5;
  manager.homeDesk= seat0;
  manager.worldX  = seat0.seatWX;
  manager.worldZ  = seat0.seatWZ;

  // initial pose (seated)
  mgrLegL.rotation.x = 1.2;
  mgrLegR.rotation.x = 1.2;
  mgrLegL.scale.y    = 0.5;
  mgrLegR.scale.y    = 0.5;
  mgrLegL.position.y = 0;
  mgrLegR.position.y = 0;
  mgrBotCap.visible  = false;
  mgrTorso.rotation.x= 0.04;

  mgrGrp.position.set(
    seat0.seatWX,
    GROUND_Y + MGR_BASE_Y + MGR_SEATED_Y,
    seat0.seatWZ
  );
  mgrGrp.rotation.y = seat0.faceAngle;

  // reserve desk for manager
  seat0.reservedBy = 'manager';

  scene.add(mgrGrp);
}

// ─────────────────────────────────────────────────────────────
// CLICK HANDLER
// ─────────────────────────────────────────────────────────────

/**
 * Sets up the raycasting click handler (point-and-click movement)
 * and the hover cursor.  Must be called after buildManager().
 */
export function initManagerClickHandler() {
  const { manager } = globalState;

  // invisible floor plane for raycasting
  const rayFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10), // ROOM_W × ROOM_D
    new THREE.MeshBasicMaterial({ visible: false })
  );
  rayFloor.rotation.x = -Math.PI / 2;
  rayFloor.position.set(RP_X, RP_Y + FLOOR_T + 0.01, RP_Z);
  scene.add(rayFloor);

  const raycaster  = new THREE.Raycaster();
  const mouseNDC   = new THREE.Vector2();
  const hoverMouse = new THREE.Vector2();

  /** Returns true if room-local point is walkable. */
  function isWalkable(lx, lz) {
    if (lx < BOUNDS.minX + 0.3 || lx > BOUNDS.maxX - 0.3) return false;
    if (lz < BOUNDS.minZ + 0.3 || lz > BOUNDS.maxZ - 0.3) return false;
    if (isInFurniture(lx, lz, AGENT_RADIUS + 0.1))         return false;
    return true;
  }

  // ── Click — move manager to floor point ──
  canvas.addEventListener('click', (e) => {
    if (cameraInput.dragActive) return; // ignore drag releases

    mouseNDC.x = ( e.clientX / window.innerWidth)  *  2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight)  *  2 + 1;

    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObject(rayFloor);
    if (hits.length === 0) return;

    const pt      = hits[0].point;
    const clickLX = pt.x - RP_X;
    const clickLZ = pt.z - RP_Z;
    if (!isWalkable(clickLX, clickLZ)) return;

    manager.tx = clickLX;
    manager.tz = clickLZ;

    // show destination marker
    markerRing.position.set(pt.x, RP_Y + FLOOR_T + 0.02, pt.z);
    markerDot.position.set( pt.x, RP_Y + FLOOR_T + 0.02, pt.z);
    markerRing.visible = true;
    markerDot.visible  = true;
    markerRing.material.opacity = 0.6;
    markerDot.material.opacity  = 0.8;

    if (manager.state === 'seated') {
      manager.state   = 'standing';
      manager.timer   = MGR_STAND_TIME;
      manager.sitTgt  = 0;
      if (manager.homeDesk) manager.homeDesk.reservedBy = null;
    } else {
      manager.state = 'walking';
    }

    const dx = manager.tx - manager.lx;
    const dz = manager.tz - manager.lz;
    if (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05) {
      manager.tAng = Math.atan2(dx, dz);
    }
  });

  // ── Hover — pointer cursor on walkable floor ──
  canvas.addEventListener('mousemove', (e) => {
    if (globalState.camMode === 2 || cameraInput.dragActive) return;
    hoverMouse.x = ( e.clientX / window.innerWidth)  *  2 - 1;
    hoverMouse.y = -(e.clientY / window.innerHeight)  *  2 + 1;
    raycaster.setFromCamera(hoverMouse, camera);
    const hh = raycaster.intersectObject(rayFloor);
    if (hh.length > 0) {
      const hlx = hh[0].point.x - RP_X;
      const hlz = hh[0].point.z - RP_Z;
      canvas.style.cursor = isWalkable(hlx, hlz) ? 'pointer' : 'not-allowed';
    } else {
      canvas.style.cursor = 'default';
    }
  });
}

// ─────────────────────────────────────────────────────────────
// PER-FRAME UPDATE
// ─────────────────────────────────────────────────────────────

/**
 * Runs the manager's 5-state machine and applies the result to the mesh.
 * Writes globalState.manager.worldX/worldZ at the end of each frame
 * so camera.js can read the live position.
 *
 * States: seated → standing → walking → arriving → idle
 *
 * @param {number} dt - Frame delta-time in seconds
 * @param {number} t  - Total elapsed time in seconds
 */
export function updateManager(dt, t) {
  const { manager } = globalState;
  const MGR_SEATED_Y = CHAIR_SEAT_H - MGR_BASE_Y;
  const rs = 1 - Math.exp(-MGR_ROT_SPEED * dt);

  // ── STATE MACHINE ──────────────────────────────────────────────

  if (manager.state === 'seated') {
    manager.sitOff += (manager.sitTgt - manager.sitOff) * (1 - Math.exp(-5 * dt));
    mgrHead.rotation.x  = Math.sin(t * 2.0 + 1.5) * 0.03;
    mgrHead.rotation.z  = Math.sin(t * 0.7) * 0.02;
    mgrTorso.rotation.x = 0.04 + Math.sin(t * 0.9) * 0.008;
    manager.legScale += (0.5 - manager.legScale) * (1 - Math.exp(-6 * dt));
    mgrBotCap.visible = false;

  } else if (manager.state === 'standing') {
    manager.timer  -= dt;
    manager.sitOff += (manager.sitTgt - manager.sitOff) * (1 - Math.exp(-5 * dt));
    manager.legScale += (1.0 - manager.legScale) * (1 - Math.exp(-6 * dt));
    mgrTorso.rotation.x *= 0.9;
    mgrBotCap.visible = true;
    if (manager.timer <= 0 && Math.abs(manager.sitOff) < 0.02) {
      manager.sitOff = 0;
      manager.state  = 'walking';
    }
    manager.ang = lerpAngle(manager.ang, manager.tAng, rs * 0.3);

  } else if (manager.state === 'walking') {
    const dx   = manager.tx - manager.lx;
    const dz   = manager.tz - manager.lz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < MGR_ARRIVE_DIST) {
      manager.state = 'arriving';
      manager.timer = 0.2;
    } else {
      manager.tAng = Math.atan2(dx, dz);

      const step = Math.min(MGR_SPEED * dt / dist, 1);
      manager.lx += dx * step;
      manager.lz += dz * step;

      manager.lx = Math.max(BOUNDS.minX + 0.3, Math.min(BOUNDS.maxX - 0.3, manager.lx));
      manager.lz = Math.max(BOUNDS.minZ + 0.3, Math.min(BOUNDS.maxZ - 0.3, manager.lz));

      manager.phase += dt * 10;
      mgrLegL.rotation.x =  Math.sin(manager.phase) * 0.45;
      mgrLegR.rotation.x = -Math.sin(manager.phase) * 0.45;
      manager.sitOff = Math.abs(Math.sin(manager.phase)) * 0.018;
    }
    manager.legScale += (1.0 - manager.legScale) * (1 - Math.exp(-6 * dt));
    mgrBotCap.visible = true;
    mgrTorso.rotation.x *= 0.95;
    mgrHead.rotation.x  *= 0.9;
    mgrHead.rotation.z  *= 0.9;
    manager.ang = lerpAngle(manager.ang, manager.tAng, rs);

  } else if (manager.state === 'arriving') {
    manager.timer -= dt;
    mgrLegL.rotation.x *= 0.85;
    mgrLegR.rotation.x *= 0.85;
    manager.sitOff     *= 0.9;
    if (manager.timer <= 0) {
      manager.state    = 'idle';
      manager.idleTime = 0;
      markerRing.visible = false;
      markerDot.visible  = false;
    }
    manager.ang = lerpAngle(manager.ang, manager.tAng, rs * 0.5);

  } else if (manager.state === 'idle') {
    mgrLegL.rotation.x  *= 0.92;
    mgrLegR.rotation.x  *= 0.92;
    mgrHead.rotation.z   = Math.sin(t * 1.2) * 0.03;
    manager.sitOff      *= 0.95;
    manager.legScale    += (1.0 - manager.legScale) * (1 - Math.exp(-6 * dt));
    mgrBotCap.visible    = true;
    mgrTorso.rotation.x *= 0.95;
  }

  // ── Apply leg scale ──
  mgrLegL.scale.y    = manager.legScale;
  mgrLegR.scale.y    = manager.legScale;
  mgrLegL.position.y = 0;
  mgrLegR.position.y = 0;

  // ── Apply world position ──
  mgrGrp.position.x = RP_X + manager.lx;
  mgrGrp.position.z = RP_Z + manager.lz;
  mgrGrp.position.y = GROUND_Y + MGR_BASE_Y + manager.sitOff;
  mgrGrp.rotation.y = manager.ang;

  // ── Publish position for camera.js ──
  manager.worldX = mgrGrp.position.x;
  manager.worldZ = mgrGrp.position.z;

  // ── Pulsing destination marker ──
  if (markerRing.visible && manager.state === 'walking') {
    const pulse = 1 + Math.sin(t * 4) * 0.08;
    markerRing.scale.set(pulse, pulse, 1);
    markerRing.material.opacity = 0.3 + Math.sin(t * 3) * 0.15;
  }

  // ── Floating diamond ──
  mgrDiamond.rotation.y  = t * 1.5;
  mgrDiamond.position.y  = mgrHead.position.y + 0.35 + Math.sin(t * 2.0) * 0.04;
}
