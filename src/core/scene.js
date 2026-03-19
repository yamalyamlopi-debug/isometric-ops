/**
 * @file scene.js
 * @module core/scene
 * @description Creates and exports the WebGL renderer, THREE.Scene, perspective camera,
 * background gradient sphere, full lighting rig, platform surface, and room shell
 * (3-wall cutaway with baseboards). Also exports the groundOnFloor() utility.
 *
 * NOTE: THREE is loaded as a global via CDN <script> in index.html — it is NOT imported here.
 */

'use strict';

import {
  RP_X, RP_Y, RP_Z,
  ROOM_W, ROOM_D, ROOM_H, WALL_T, FLOOR_T, FLOOR_Y,
} from './state.js';

// ─────────────────────────────────────────────────────────────
// RENDERER + CANVAS
// ─────────────────────────────────────────────────────────────

export const canvas = document.createElement('canvas');
document.body.prepend(canvas);

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.physicallyCorrectLights = true;
renderer.toneMapping             = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure     = 1.15;
renderer.outputEncoding          = THREE.sRGBEncoding;
renderer.shadowMap.enabled       = true;
renderer.shadowMap.type          = THREE.PCFSoftShadowMap;

// ─────────────────────────────────────────────────────────────
// SCENE + CAMERA
// ─────────────────────────────────────────────────────────────

export const scene = new THREE.Scene();

/** Perspective camera — aspect and size are kept in sync with the window. */
export const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.05,
  150,
);
camera.position.set(18, 12, 18);
camera.lookAt(0, 1.5, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────────
// BACKGROUND — vertex-coloured gradient sphere
// ─────────────────────────────────────────────────────────────

const bgGeo  = new THREE.SphereGeometry(90, 48, 48);
const bgCols = [];
const bgPos  = bgGeo.attributes.position;
const bgC    = new THREE.Color();
const bgBot  = new THREE.Color(0x1a1520);
const bgMid  = new THREE.Color(0x2a2435);
const bgTop  = new THREE.Color(0x181525);

for (let i = 0; i < bgPos.count; i++) {
  const ny = (bgPos.getY(i) + 90) / 180;
  if (ny < 0.5) bgC.lerpColors(bgBot, bgMid, ny * 2);
  else          bgC.lerpColors(bgMid, bgTop, (ny - 0.5) * 2);
  bgCols.push(bgC.r, bgC.g, bgC.b);
}
bgGeo.setAttribute('color', new THREE.Float32BufferAttribute(bgCols, 3));

const bgMesh = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({
  vertexColors: true,
  side:         THREE.BackSide,
  depthWrite:   false,
}));
bgMesh.renderOrder = -1;
scene.add(bgMesh);

// ─────────────────────────────────────────────────────────────
// LIGHTING
// ─────────────────────────────────────────────────────────────

// Soft fill from above
const ambLight = new THREE.AmbientLight(0xd5c8e0, 0.35);
scene.add(ambLight);

// Primary directional (sun) — casts shadows
const keyLight = new THREE.DirectionalLight(0xffecd2, 2.8);
keyLight.position.set(12, 20, 8);
keyLight.castShadow                   = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left           = -20;
keyLight.shadow.camera.right          =  20;
keyLight.shadow.camera.top            =  20;
keyLight.shadow.camera.bottom         = -20;
keyLight.shadow.bias                  = -0.001;
keyLight.shadow.normalBias            =  0.02;
scene.add(keyLight);

// Cool counter-key fill
const fillLight = new THREE.DirectionalLight(0xb8c8e8, 0.8);
fillLight.position.set(-10, 12, -6);
scene.add(fillLight);

// Rim accent from behind
const rimLight = new THREE.DirectionalLight(0xd0b0e0, 0.5);
rimLight.position.set(-4, 8, -15);
scene.add(rimLight);

// Warm centre glow
const centerGlow = new THREE.PointLight(0xffe0c0, 0.6, 30, 2);
centerGlow.position.set(0, 3, 0);
scene.add(centerGlow);

// ─────────────────────────────────────────────────────────────
// PLATFORM
// ─────────────────────────────────────────────────────────────

/**
 * Creates a rounded-rectangle THREE.Shape for use with ExtrudeGeometry.
 * @param {number} w - Width
 * @param {number} d - Depth
 * @param {number} r - Corner radius
 * @returns {THREE.Shape}
 */
function makeRoundedRect(w, d, r) {
  const s  = new THREE.Shape();
  const hw = w / 2, hd = d / 2;
  r = Math.min(r, hw, hd);
  s.moveTo(-hw + r, -hd);
  s.lineTo(hw - r, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r);
  s.quadraticCurveTo(hw, hd, hw - r, hd);
  s.lineTo(-hw + r, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - r);
  s.lineTo(-hw, -hd + r);
  s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return s;
}

// Platform base
const platGeo = new THREE.ExtrudeGeometry(makeRoundedRect(28, 28, 2), {
  depth: 0.7, bevelEnabled: true, bevelThickness: 0.12,
  bevelSize: 0.12, bevelSegments: 6, curveSegments: 20,
});
platGeo.rotateX(-Math.PI / 2);
platGeo.translate(0, -0.35, 0);
const platMesh = new THREE.Mesh(platGeo,
  new THREE.MeshStandardMaterial({ color: 0xf0ebe4, roughness: 0.75, metalness: 0.02 }));
platMesh.receiveShadow = true;
scene.add(platMesh);

// Surface layer
const surfGeo = new THREE.ExtrudeGeometry(makeRoundedRect(26.5, 26.5, 1.5), {
  depth: 0.06, bevelEnabled: true, bevelThickness: 0.04,
  bevelSize: 0.04, bevelSegments: 3, curveSegments: 20,
});
surfGeo.rotateX(-Math.PI / 2);
surfGeo.translate(0, 0.01, 0);
const surfMesh = new THREE.Mesh(surfGeo, new THREE.MeshStandardMaterial({
  color: 0xf5f0ea, roughness: 0.65, metalness: 0.01,
  polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
}));
surfMesh.receiveShadow = true;
scene.add(surfMesh);

// Subtle grid lines
const gridMat = new THREE.LineBasicMaterial({ color: 0xc8bfb4, transparent: true, opacity: 0.06 });
for (let gi = -13; gi <= 13; gi += 2) {
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-13, 0.06, gi), new THREE.Vector3(13, 0.06, gi),
  ]), gridMat));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(gi, 0.06, -13), new THREE.Vector3(gi, 0.06, 13),
  ]), gridMat));
}

// Soft underside shadow disc
const shadowDisc = new THREE.Mesh(
  new THREE.CircleGeometry(16, 64),
  new THREE.MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0.12, depthWrite: false }),
);
shadowDisc.rotation.x = -Math.PI / 2;
shadowDisc.position.y = -0.55;
scene.add(shadowDisc);

// ─────────────────────────────────────────────────────────────
// ROOM — 3-wall cutaway (back + left + right, no front wall)
// ─────────────────────────────────────────────────────────────

const roomHW = ROOM_W / 2;
const roomHD = ROOM_D / 2;

const wallMat    = new THREE.MeshStandardMaterial({ color: 0xf7f3ee, roughness: 0.78 });
const wallOutMat = new THREE.MeshStandardMaterial({ color: 0xf2ede6, roughness: 0.82 });
const floorMat   = new THREE.MeshStandardMaterial({
  color: 0xe6dfd5, roughness: 0.72, metalness: 0.01,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
const bbMat = new THREE.MeshStandardMaterial({ color: 0xded6ca, roughness: 0.6, metalness: 0.02 });

export const roomGrp = new THREE.Group();
roomGrp.position.set(RP_X, RP_Y, RP_Z);

// Floor
const roomFloor = new THREE.Mesh(
  new THREE.BoxGeometry(ROOM_W - 0.04, FLOOR_T, ROOM_D - 0.04), floorMat);
roomFloor.position.y = FLOOR_T / 2;
roomFloor.receiveShadow = true;
roomGrp.add(roomFloor);

// Back wall (inner + outer shell)
const bWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, ROOM_H, WALL_T), wallMat);
bWall.position.set(0, FLOOR_T + ROOM_H / 2, -roomHD + WALL_T / 2);
bWall.castShadow = true; bWall.receiveShadow = true;
roomGrp.add(bWall);

const bWallOut = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W + 0.02, ROOM_H + 0.02, 0.04), wallOutMat);
bWallOut.position.set(0, FLOOR_T + ROOM_H / 2, -roomHD - 0.01);
bWallOut.castShadow = true;
roomGrp.add(bWallOut);

// Left wall
const lWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), wallMat);
lWall.position.set(-roomHW + WALL_T / 2, FLOOR_T + ROOM_H / 2, 0);
lWall.castShadow = true; lWall.receiveShadow = true;
roomGrp.add(lWall);

const lWallOut = new THREE.Mesh(new THREE.BoxGeometry(0.04, ROOM_H + 0.02, ROOM_D + 0.02), wallOutMat);
lWallOut.position.set(-roomHW - 0.01, FLOOR_T + ROOM_H / 2, 0);
lWallOut.castShadow = true;
roomGrp.add(lWallOut);

// Right wall
const rWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), wallMat);
rWall.position.set(roomHW - WALL_T / 2, FLOOR_T + ROOM_H / 2, 0);
rWall.castShadow = true; rWall.receiveShadow = true;
roomGrp.add(rWall);

const rWallOut = new THREE.Mesh(new THREE.BoxGeometry(0.04, ROOM_H + 0.02, ROOM_D + 0.02), wallOutMat);
rWallOut.position.set(roomHW + 0.01, FLOOR_T + ROOM_H / 2, 0);
rWallOut.castShadow = true;
roomGrp.add(rWallOut);

// Baseboards
const bbH = 0.22;
const bbBack = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W - WALL_T * 2, bbH, 0.04), bbMat);
bbBack.position.set(0, FLOOR_T + bbH / 2, -roomHD + WALL_T + 0.02);
roomGrp.add(bbBack);

const bbLeft = new THREE.Mesh(new THREE.BoxGeometry(0.04, bbH, ROOM_D - WALL_T), bbMat);
bbLeft.position.set(-roomHW + WALL_T + 0.02, FLOOR_T + bbH / 2, 0);
roomGrp.add(bbLeft);

const bbRight = new THREE.Mesh(new THREE.BoxGeometry(0.04, bbH, ROOM_D - WALL_T), bbMat);
bbRight.position.set(roomHW - WALL_T - 0.02, FLOOR_T + bbH / 2, 0);
roomGrp.add(bbRight);

scene.add(roomGrp);

// ─────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────

/**
 * Positions a group so its bounding-box bottom rests exactly on the floor surface.
 * Uses the actual geometry bounds — no hard-coded Y offsets.
 * @param {THREE.Group} grp    - The group to ground
 * @param {number}      floorY - World Y of the target floor surface
 */
export function groundOnFloor(grp, floorY) {
  grp.position.y = 0;
  grp.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(grp);
  grp.position.y = floorY - bb.min.y;
}
