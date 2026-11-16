// 연출: 굴뚝 연기, 하늘 고래, 줍기 반짝임·떠오르는 글자
import * as THREE from 'three';
import { C, prep, M, merged, landMat, glowMat } from './geo.js';
import { trackPos } from './track.js';
import { scene, camera } from './scene.js';
import { locoCar, CHIMNEY } from './train.js';
import { F, ITEM_NAMES } from './config.js';
import { S } from './state.js';

/* 연기: 공용 재질 대신 개별 투명도가 필요해 풀링 */
const smoke = [];
const puffGeo = prep(new THREE.IcosahedronGeometry(.6, 0), C('#ffffff')); puffGeo.computeVertexNormals();
for (let i = 0; i < 56; i++) {
  const p = new THREE.Mesh(puffGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0, roughness: 1, depthWrite: false }));
  p.visible = false; p.userData = { life: 0, max: 1, vy: 0, sx: 0, big: 1 }; scene.add(p); smoke.push(p);
}
let acc = 0, idx = 0;
function spawnPuff(big = 1) {
  const p = smoke[idx++ % smoke.length], u = p.userData;
  p.position.copy(CHIMNEY).applyMatrix4(locoCar.g.matrixWorld);
  u.life = 0; u.max = (2.2 + Math.random() * 1.6) * (big > 1 ? 1.3 : 1); u.vy = (2.2 + Math.random()) * big; u.sx = (Math.random() - .5) * .8 * big; u.big = big;
  p.visible = true; p.rotation.set(Math.random() * 3, Math.random() * 3, 0);
}
export function smokeBurst(n = 12) { for (let i = 0; i < n; i++) spawnPuff(1.6); }
export function updateSmoke(dt) {
  acc += dt * (S.speed > 1 ? 5 + S.speed * .35 : 1.5);
  while (acc > 1) { acc -= 1; spawnPuff(); }
  for (const p of smoke) {
    if (!p.visible) continue; const u = p.userData; u.life += dt; if (u.life >= u.max) { p.visible = false; continue; }
    const t = u.life / u.max; p.position.y += u.vy * dt; p.position.z += u.sx * dt;
    p.scale.setScalar((.6 + t * 2.4) * (u.big > 1 ? 1.3 : 1)); p.material.opacity = (1 - t) * .85; p.material.color.setScalar(.72 + .28 * S.day);
  }
}

/* 하늘 고래 */
const whale = new THREE.Group();
whale.add(new THREE.Mesh(merged([
  prep(new THREE.IcosahedronGeometry(1, 1), C('#7d93c9'), M(0, 0, 0, 0, 0, 0, 9, 2.8, 3.2)),
  prep(new THREE.IcosahedronGeometry(1, 1), C('#e8ecf7'), M(.8, -.9, 0, 0, 0, 0, 7, 1.8, 2.6)),
  prep(new THREE.ConeGeometry(1.2, 4, 4), C('#6d82b8'), M(-1, -1.2, 3.2, 1.1, 0, .3, 1, 1, .4)),
  prep(new THREE.ConeGeometry(1.2, 4, 4), C('#6d82b8'), M(-1, -1.2, -3.2, -1.1, 0, .3, 1, 1, .4)),
]), landMat));
const tail = new THREE.Mesh(merged([prep(new THREE.ConeGeometry(1.4, 5, 4), C('#7d93c9'), M(-2, 0, 0, 0, 0, Math.PI / 2, 1, 1, .5)), prep(new THREE.BoxGeometry(1.4, .3, 6), C('#6d82b8'), M(-4.6, 0, 0))]), landMat);
tail.position.x = -8; whale.add(tail);
const eye = new THREE.Mesh(prep(new THREE.IcosahedronGeometry(.25, 0), C('#ffffff')), glowMat); eye.position.set(6.6, .3, 1.9); whale.add(eye);
whale.visible = false; scene.add(whale);
let whaleT = 10;
const _p = new THREE.Vector3();
export function updateWhale(dt) {
  if (!whale.visible) {
    whaleT -= dt; if (whaleT > 0) return;
    trackPos(S.sTrain + 300, _p); const side = Math.random() < .5 ? -1 : 1;
    whale.position.set(_p.x, _p.y + 30 + Math.random() * 30, _p.z + side * (90 + Math.random() * 80)); whale.rotation.set(0, Math.PI, 0); whale.scale.setScalar(1.4 + Math.random()); whale.visible = true;
  }
  whale.position.x -= 9 * dt; whale.position.y += Math.sin(S.time * .6) * .6 * dt;
  tail.rotation.y = Math.sin(S.time * 1.8) * .35; whale.rotation.z = Math.sin(S.time * .9) * .05;
  if (whale.position.x < S.sTrain - 260) { whale.visible = false; whaleT = 22 + Math.random() * 30; }
}
export const hideWhale = () => { whale.visible = false; whaleT = 10; };

/* 줍기 반짝임 */
const sparkGeo = prep(new THREE.OctahedronGeometry(.09, 0), C('#ffffff'));
const SPARK_COL = { scrap: C('#d9e2ea'), wood: C('#ffcf8a'), crystal: C('#9ff7ff') };
const sparks = [];
for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); m.visible = false; m.userData = { v: new THREE.Vector3(), life: 0 }; scene.add(m); sparks.push(m); }
let sIdx = 0;
const floatLayer = document.getElementById('floats');
export function pickupFx(type, pos, silent = false) {
  for (let i = 0; i < 14; i++) {
    const m = sparks[sIdx++ % sparks.length]; m.visible = true; m.position.copy(pos);
    m.userData.v.set(Math.random() - .5, Math.random() - .3, Math.random() - .5).normalize().multiplyScalar(2 + Math.random() * 3); m.userData.life = 0;
    m.material.color.copy(SPARK_COL[type]); m.material.opacity = 1;
  }
  if (silent) return;                       // 다른 승객이 주운 것: 반짝임만
  const el = document.createElement('div'); el.className = 'float'; el.textContent = '+1 ' + ITEM_NAMES[type];
  el.dataset.x = pos.x; el.dataset.y = pos.y; el.dataset.z = pos.z; el.dataset.t = 0;
  floatLayer.appendChild(el);
}
const _v = new THREE.Vector3();
export function updateFx(dt) {
  for (const m of sparks) {
    if (!m.visible) continue; const u = m.userData; u.life += dt;
    if (u.life > .7) { m.visible = false; continue; }
    m.position.addScaledVector(u.v, dt); u.v.multiplyScalar(Math.exp(-dt * 3)); m.material.opacity = 1 - u.life / .7; m.rotation.y += dt * 8;
  }
  for (const el of [...floatLayer.children]) {
    const t = +el.dataset.t + dt; el.dataset.t = t;
    if (t > 1.2) { el.remove(); continue; }
    _v.set(+el.dataset.x, +el.dataset.y + .5 + t * .8, +el.dataset.z).project(camera);
    if (_v.z > 1) { el.style.opacity = 0; continue; }
    el.style.transform = `translate(${(_v.x * .5 + .5) * innerWidth}px, ${(-_v.y * .5 + .5) * innerHeight}px) translate(-50%,-50%)`;
    el.style.opacity = Math.min(1, (1.2 - t) * 2);
  }
}
