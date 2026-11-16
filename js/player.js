// 1인칭 플레이어: 이동하는 기차 위 플랫폼 물리, 무중력 유영, 카메라
import * as THREE from 'three';
import { clamp } from './noise.js';
import { C, prep, M, landMat } from './geo.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { scene, camera } from './scene.js';
import { CARS, workCar, HALF_W } from './train.js';
import { F } from './config.js';
import { Avatar } from './avatar.js';
import { S } from './state.js';

const PR = .3, PH = 1.75, EYE = 1.62;
export const player = { car: workCar, p: new THREE.Vector3(0, F + .05, 0), v: new THREE.Vector3(), yaw: -Math.PI / 2, pitch: 0, grounded: false, inGrav: true, bob: 0, landed: 0 };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _w = new THREE.Vector3(), _l = new THREE.Vector3(), _vv = new THREE.Vector3(), _before = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const lookQuat = () => _q.setFromEuler(_e.set(player.pitch, player.yaw, 0, 'YXZ'));

function resolve(p, v, boxes, st) {
  for (let it = 0; it < 3; it++) for (const b of boxes) {
    const minx = p.x - PR, maxx = p.x + PR, miny = p.y, maxy = p.y + PH, minz = p.z - PR, maxz = p.z + PR;
    if (maxx <= b.min[0] || minx >= b.max[0] || maxy <= b.min[1] || miny >= b.max[1] || maxz <= b.min[2] || minz >= b.max[2]) continue;
    const px1 = b.max[0] - minx, px2 = maxx - b.min[0], py1 = b.max[1] - miny, py2 = maxy - b.min[1], pz1 = b.max[2] - minz, pz2 = maxz - b.min[2];
    const ox = Math.min(px1, px2), oy = Math.min(py1, py2), oz = Math.min(pz1, pz2), up = b.max[1] - p.y;
    if (oy <= ox && oy <= oz) {
      if (py1 < py2) { p.y = b.max[1]; if (v.y < 0) { st.impact = Math.min(st.impact, v.y); v.y = 0; } st.g = true; }
      else { p.y = b.min[1] - PH; if (v.y > 0) v.y *= -.1; }                 // 천장: 살짝 튕겨 자연스럽게
    } else if (up > 0 && up <= .45 && st.was) { p.y = b.max[1]; st.g = true; if (v.y < 0) v.y = 0; }
    else if (ox < oz) { p.x = px1 < px2 ? b.max[0] + PR : b.min[0] - PR; v.x = 0; }
    else { p.z = pz1 < pz2 ? b.max[2] + PR : b.min[2] - PR; v.z = 0; }
  }
}
const inGravity = (car, p) => p.x > car.x0 - .8 && p.x < car.x1 + .8 && Math.abs(p.z) < HALF_W + .55 && p.y > F - .7 && p.y < F + 7;

export function updatePlayer(dt) {
  const P = player, car = P.car, K = S.keys;
  const wasGrav = P.inGrav;
  P.inGrav = inGravity(car, P.p);
  const fwdIn = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0), rightIn = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
  if (P.inGrav) {
    const sp = K.ShiftLeft || K.ShiftRight ? 6.5 : 4;
    let wx = -Math.sin(P.yaw) * fwdIn + Math.cos(P.yaw) * rightIn, wz = -Math.cos(P.yaw) * fwdIn - Math.sin(P.yaw) * rightIn;
    const len = Math.hypot(wx, wz); if (len > 0) { wx = wx / len * sp; wz = wz / len * sp; }
    const k = 1 - Math.exp(-dt * (P.grounded ? 14 : 3));
    P.v.x += (wx - P.v.x) * k; P.v.z += (wz - P.v.z) * k;
    P.v.y = Math.max(-25, P.v.y - 19 * dt);
    if (!wasGrav) P.v.y = Math.min(P.v.y, 0) - 1;                              // 중력 구역 재진입: 부드럽게 끌어내림
    if (K.Space && P.grounded) { P.v.y = 6.4; P.grounded = false; }
    if (P.grounded && len > 0) P.bob += dt * (sp > 5 ? 13 : 9); else P.bob *= Math.exp(-dt * 8);
  } else {
    const q = lookQuat(), f = _a.set(0, 0, -1).applyQuaternion(q), r = _b.set(1, 0, 0).applyQuaternion(q);
    const upIn = (K.Space ? 1 : 0) - (K.ShiftLeft || K.ShiftRight ? 1 : 0);
    P.v.addScaledVector(f, fwdIn * 9 * dt).addScaledVector(r, rightIn * 9 * dt); P.v.y += upIn * 9 * dt;
    P.v.multiplyScalar(Math.exp(-dt * 1.3));
    if (P.v.length() > 7) P.v.setLength(7);
    const anchor = _l.set(clamp(P.p.x, car.x0, car.x1), F + 1, Math.sign(P.p.z || 1) * HALF_W), d = P.p.distanceTo(anchor);
    if (d > 26) P.v.addScaledVector(_w.subVectors(anchor, P.p).normalize(), (d - 26) * 4 * dt);
    P.bob *= Math.exp(-dt * 8);
  }
  const st = { g: false, was: P.grounded, impact: 0 }, n = 3;
  for (let i = 0; i < n; i++) {
    P.p.addScaledVector(P.v, dt / n);
    for (const c of CARS) {
      if (c === car) { resolve(P.p, P.v, c.boxes, st); continue; }
      _w.copy(P.p).applyMatrix4(car.g.matrixWorld).applyMatrix4(c.inv);
      if (_w.x < c.x0 - 2 || _w.x > c.x1 + 2 || Math.abs(_w.z) > 4) continue;
      _vv.copy(P.v).applyQuaternion(car.g.quaternion).applyQuaternion(_q2.copy(c.g.quaternion).invert());
      _before.copy(_w); resolve(_w, _vv, c.boxes, st);
      if (!_before.equals(_w)) {
        P.p.copy(_w).applyMatrix4(c.g.matrixWorld).applyMatrix4(car.inv);
        P.v.copy(_vv).applyQuaternion(c.g.quaternion).applyQuaternion(_q2.copy(car.g.quaternion).invert());
      }
    }
  }
  if (!P.grounded && st.g && st.impact < -6) S.shake = Math.max(S.shake, Math.min(.25, -st.impact * .02));   // 착지 충격
  P.grounded = st.g;
  // 가장 가까운 차량을 기준 좌표로
  _w.copy(P.p).applyMatrix4(car.g.matrixWorld);
  let best = car, bestD = 1e9;
  for (const c of CARS) { _l.copy(_w).applyMatrix4(c.inv); const dx = _l.x < c.x0 ? c.x0 - _l.x : _l.x > c.x1 ? _l.x - c.x1 : 0; const d = dx + Math.max(0, Math.abs(_l.z) - HALF_W - .3) * .2; if (d < bestD - .001) { bestD = d; best = c; } }
  if (best !== car) {
    P.p.copy(_w).applyMatrix4(best.inv);
    P.v.applyQuaternion(car.g.quaternion).applyQuaternion(_q2.copy(best.g.quaternion).invert());
    // 시선은 '실제로 보던 월드 방향'을 그대로 유지하도록 새 차량 기준으로 환산 (차량 간 각도 차이로 시점이 돌아가지 않게)
    const look = _a.set(0, 0, -1).applyQuaternion(lookQuat()).applyQuaternion(car.g.quaternion).applyQuaternion(_q2.copy(best.g.quaternion).invert());
    P.yaw = Math.atan2(-look.x, -look.z); P.pitch = Math.asin(clamp(look.y, -1, 1));
    P.car = best;
  }
  if (P.p.length() > 60 || !Number.isFinite(P.p.x)) reelIn();
}
export function reelIn() { player.car = workCar; player.p.set(0, F + .05, 0); player.v.set(0, 0, 0); }
export const playerWorld = (out, h = .9) => out.copy(player.p).setY(player.p.y + h).applyMatrix4(player.car.g.matrixWorld);
export const nearLever = (pos) => player.car.name === '기관실' && player.p.distanceTo(pos) < 1.8;

/* 카메라 */
const _cl = new THREE.Vector3(), _shake = new THREE.Vector3();
export const ext = { yaw: 0, pitch: 0, zoom: 1 };
const extTarget = new THREE.Vector3(), extWant = new THREE.Vector3(), EF = makeFrame(), _P = new THREE.Vector3();
export function updateCamera(dt, snap) {
  S.shake *= Math.exp(-dt * 9);
  const sh = S.shake;
  if (S.viewMode === 'fp') {
    const P = player;
    _cl.set(P.p.x, P.p.y + EYE + Math.sin(P.bob) * .05, P.p.z);
    camera.position.copy(_cl).applyMatrix4(P.car.g.matrixWorld);
    camera.quaternion.copy(P.car.g.quaternion).multiply(lookQuat());   // 타고 있는 차량과 함께 자연스럽게 회전
  } else {
    const s = S.sTrain - 14; frameAt(s, EF); trackPos(s, _P);
    const yaw = .62 + ext.yaw, pitch = clamp(.25 + ext.pitch, -.3, 1.35), d = 30 * ext.zoom;
    extWant.copy(_P).addScaledVector(EF.T, -Math.cos(pitch) * Math.cos(yaw) * d).addScaledVector(EF.R, Math.cos(pitch) * Math.sin(yaw) * d).addScaledVector(EF.U, Math.sin(pitch) * d + 2);
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.5);
    camera.position.lerp(extWant, k); extTarget.lerp(_P.addScaledVector(EF.U, 2), k); camera.lookAt(extTarget);
  }
  if (sh > .001) camera.position.add(_shake.set((Math.random() - .5) * sh, (Math.random() - .5) * sh, (Math.random() - .5) * sh));
}

/* 아바타 (외부 시점) + 안전줄 */
export const localAvatar = new Avatar(C('#ef8a3d'));
scene.add(localAvatar.holder);
const tetherGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const tether = new THREE.Line(tetherGeo, new THREE.LineBasicMaterial({ color: 0xf2c14e })); tether.frustumCulled = false; scene.add(tether);
const avState = { speed: 0, vy: 0, grounded: true, inGrav: true, yaw: 0, pitch: 0 };
export function updateAvatar(wp, dt) {
  const A = localAvatar;
  A.holder.visible = S.viewMode !== 'fp';
  A.holder.position.copy(player.p).applyMatrix4(player.car.g.matrixWorld);
  A.holder.quaternion.copy(player.car.g.quaternion);
  Object.assign(avState, { speed: Math.hypot(player.v.x, player.v.z), vy: player.v.y, grounded: player.grounded, inGrav: player.inGrav, yaw: player.yaw, pitch: player.pitch });
  A.update(dt, avState, S.time);
  tether.visible = !player.inGrav;
  if (tether.visible) {
    const c = player.car, a = _l.set(clamp(player.p.x, c.x0, c.x1), F + 1, Math.sign(player.p.z || 1) * HALF_W).applyMatrix4(c.g.matrixWorld);
    tetherGeo.attributes.position.array.set([a.x, a.y, a.z, wp.x, wp.y, wp.z]); tetherGeo.attributes.position.needsUpdate = true;
  }
}
