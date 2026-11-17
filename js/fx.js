// 연출: 굴뚝 연기
import * as THREE from 'three';
import { C, prep } from './geo.js';
import { scene } from './scene.js';
import { locoCar, CHIMNEY } from './train.js';
import { S } from './state.js';

const smoke = [];
const puffGeo = prep(new THREE.IcosahedronGeometry(.6, 0), C('#ffffff')); puffGeo.computeVertexNormals();
for (let i = 0; i < 40; i++) {
  const p = new THREE.Mesh(puffGeo, new THREE.MeshLambertMaterial({ color: 0x59606a, flatShading: true, transparent: true, opacity: 0, depthWrite: false }));
  p.visible = false; p.userData = { life: 0, max: 1, vy: 0, sx: 0, big: 1 }; scene.add(p); smoke.push(p);
}
let acc = 0, idx = 0;
function spawnPuff(big = 1) {
  const p = smoke[idx++ % smoke.length], u = p.userData;
  p.position.copy(CHIMNEY).applyMatrix4(locoCar.g.matrixWorld);
  u.life = 0; u.max = (1.6 + Math.random() * 1.2) * (big > 1 ? 1.3 : 1); u.vy = (1.6 + Math.random()) * big; u.sx = (Math.random() - .5) * .8 * big; u.big = big;
  p.visible = true; p.rotation.set(Math.random() * 3, Math.random() * 3, 0);
}
export function smokeBurst(n = 12) { for (let i = 0; i < n; i++) spawnPuff(1.6); }
export function updateSmoke(dt) {
  acc += dt * (S.speed > 1 ? 4 + S.speed * .3 : 1.2);
  while (acc > 1) { acc -= 1; spawnPuff(); }
  for (const p of smoke) {
    if (!p.visible) continue; const u = p.userData; u.life += dt; if (u.life >= u.max) { p.visible = false; continue; }
    const t = u.life / u.max; p.position.y += u.vy * dt * (1 - t * .7); p.position.z += u.sx * dt;      // 낮은 천장 아래에서 퍼지듯
    p.scale.setScalar((.6 + t * 2.2) * (u.big > 1 ? 1.3 : 1)); p.material.opacity = (1 - t) * .6;
  }
}
