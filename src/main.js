/**
 * @file main.js
 * @module main
 * @description Entry point for Isometric Ops.
 *
 * Initialisation order (critical — dependencies cascade downward):
 *   1. initGroundConstants()      — bbox-derived AGENT_BASE_Y / MGR_BASE_Y
 *   2. setupDesks()               — fills globalState.desks[]
 *   3. spawnAgent() × 3          — fills globalState.agents[]
 *   4. buildManager()             — mesh + globalState.manager seed
 *   5. initManagerClickHandler()  — raycasting events
 *   6. initCameraPresets()        — seeds playerCam from manager start pos
 *   7. particles                  — decorative
 *   8. animate()                  — main loop
 */

'use strict';

import { renderer, scene, camera }             from './core/scene.js';
import { globalState, initGroundConstants }    from './core/state.js';
import { GROUND_Y, MGR_BASE_Y, CHAIR_SEAT_H } from './core/state.js';
import { initCameraPresets, updateCamera }     from './core/camera.js';
import { setupDesks, screenMat }              from './furniture/desk.js';
import { spawnAgent, updateAgents }            from './entities/agent.js';
import { buildManager, initManagerClickHandler, updateManager } from './entities/manager.js';

// ─────────────────────────────────────────────────────────────
// 1. GROUND CONSTANTS — must run before any character is built
// ─────────────────────────────────────────────────────────────

initGroundConstants();

// ─────────────────────────────────────────────────────────────
// 2. DESKS
// ─────────────────────────────────────────────────────────────

setupDesks();

// ─────────────────────────────────────────────────────────────
// 3. AGENTS
// ─────────────────────────────────────────────────────────────

spawnAgent( 1.5,  1.2, 0, 0.60);
spawnAgent(-1.0,  2.5, 1, 0.45);
spawnAgent( 2.5, -1.0, 4, 0.52);

// ─────────────────────────────────────────────────────────────
// 4 + 5. MANAGER
// ─────────────────────────────────────────────────────────────

buildManager();
initManagerClickHandler();

// ─────────────────────────────────────────────────────────────
// 6. CAMERA PRESETS — seeded from manager's starting position
// ─────────────────────────────────────────────────────────────

const { desks, manager } = globalState;
const mgrLookY = GROUND_Y + CHAIR_SEAT_H + 0.4; // = 1.04 (seated eye level)

initCameraPresets(
  desks[0].faceAngle,  // manager faces -Z, camera orbits from behind
  mgrLookY,
  manager.worldX,
  manager.worldZ
);

// ─────────────────────────────────────────────────────────────
// 7. PARTICLES — ambient floating dust
// ─────────────────────────────────────────────────────────────

const PARTICLE_COUNT = 50;
const partData = new Float32Array(PARTICLE_COUNT * 3);
for (let pi = 0; pi < PARTICLE_COUNT; pi++) {
  partData[pi * 3    ] = (Math.random() - 0.5) * 40;
  partData[pi * 3 + 1] = Math.random() * 18 + 2;
  partData[pi * 3 + 2] = (Math.random() - 0.5) * 40;
}
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.Float32BufferAttribute(partData, 3));
scene.add(new THREE.Points(partGeo, new THREE.PointsMaterial({
  color: 0xffecd2, size: 0.07, transparent: true, opacity: 0.2,
  sizeAttenuation: true, depthWrite: false,
})));
const partPos = partGeo.attributes.position;

// ─────────────────────────────────────────────────────────────
// 8. ANIMATE LOOP
// ─────────────────────────────────────────────────────────────

const clock   = new THREE.Clock();
let   elapsed = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  updateCamera(dt, elapsed);
  updateAgents(dt, elapsed);
  updateManager(dt, elapsed);

  // screen glow pulse
  screenMat.emissiveIntensity = 0.3 + Math.sin(elapsed * 0.8) * 0.06;

  // particle drift
  for (let i = 0; i < partPos.count; i++) {
    partPos.setY(i, partPos.getY(i) + Math.sin(elapsed * 0.5 + i * 0.3) * 0.002);
  }
  partPos.needsUpdate = true;

  renderer.render(scene, camera);
}

animate();

// ─────────────────────────────────────────────────────────────
// LOADER FADE — remove after first frame
// ─────────────────────────────────────────────────────────────

setTimeout(() => {
  document.getElementById('ld').classList.add('ok');
  setTimeout(() => document.getElementById('ld').remove(), 800);
}, 500);
