// 1인칭 플레이어: 이동하는 기차 위 플랫폼 물리, 무중력 유영, 카메라
import * as THREE from 'three';
import { clamp } from './noise.js';
import { C, prep, M, landMat } from './geo.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { scene, camera } from './scene.js';
import { CARS, JOINTS, spawnCar, SPAWN_X, HALF_W } from './train.js';
import { specAt } from './city.js';
import { F } from './config.js';
import { Avatar } from './avatar.js';
import { S } from './state.js';

const PR = .3, PH = 1.75, EYE = 1.62;
export const player = { rope: null, scrape: 0, car: spawnCar, p: new THREE.Vector3(SPAWN_X, F + .05, 0), v: new THREE.Vector3(), yaw: -Math.PI / 2, pitch: 0, grounded: false, inGrav: true, bob: 0, landed: 0 };

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
const inGravity = (car, p) => p.x > car.x0 - .8 && p.x < car.x1 + .8 && Math.abs(p.z) < HALF_W + .25 && p.y > F - .7 && p.y < F + 7;

/* ---------- 안전줄 ----------
 * 열차 밖으로 떨어지면 떨어진 자리의 차량 가장자리에 짧은 줄(최대 4m)로 매달린다. 무중력이 아니다:
 * 중력으로 늘어지고, 열차가 빠를수록 맞바람에 뒤로 쏠리며 덜컹임에 크게 흔들린다. 선로 바닥에 닿으면 끌리며 다친다.
 * R 을 누르고 있는 동안 줄이 서서히 감겨 올라간다(순간이동 없음). 끝까지 감기면 난간을 넘어 올라옴. */
const ROPE_MAX = 4, REEL = 1.15;
const _an = new THREE.Vector3(), _rn = new THREE.Vector3(), FRp = makeFrame();
function attachRope(P) {
  const c = P.car, p = P.p, roof = p.y > F + 2.2, side = Math.sign(p.z || 1);
  const a = new THREE.Vector3();
  if (p.x < c.x0 + .2) a.set(c.x0, roof ? F + 3.6 : F + .95, clamp(p.z, -.6, .6));
  else if (p.x > c.x1 - .2) a.set(c.x1, roof ? F + 3.6 : F + .95, clamp(p.z, -.6, .6));
  else a.set(clamp(p.x, c.x0 + .3, c.x1 - .3), roof ? F + 3.6 : F + .95, side * (HALF_W + .05));
  P.rope = { car: c, a, L: clamp(Math.max(2.6, p.distanceTo(a) + .4), 1, ROPE_MAX), roof };
}
const ropeAnchor = (P, out) => out.copy(P.rope.a).applyMatrix4(P.rope.car.g.matrixWorld).applyMatrix4(P.car.inv);
function climbBack(P) {
  const r = P.rope; P.car = r.car;
  const x = clamp(r.a.x, r.car.x0 + .6, r.car.x1 - .6), z = Math.abs(r.a.z) > 1 ? Math.sign(r.a.z) * (HALF_W - .9) : r.a.z;
  P.p.set(x, r.roof ? F + 2.95 : F + .05, z); P.v.set(0, 0, 0); P.rope = null; S.shake = Math.max(S.shake, .08);
}

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
    if (!P.rope) attachRope(P);
    // 중력 + 맞바람(열차 속도에 대해 상대) + 덜컹임. 손발로 조금 버둥거려 몸을 틀 수 있음
    const sp = S.speed, rel = sp + P.v.x;
    P.v.y -= 19 * dt;
    P.v.x -= .016 * rel * Math.abs(rel) * dt;
    const jolt = Math.abs(sp) * .9 * dt; P.v.x += (Math.random() - .5) * jolt; P.v.z += (Math.random() - .5) * jolt * 1.4; P.v.y += (Math.random() - .5) * jolt;
    const sw = -Math.sin(P.yaw) * fwdIn + Math.cos(P.yaw) * rightIn, sz = -Math.cos(P.yaw) * fwdIn - Math.sin(P.yaw) * rightIn;
    P.v.x += sw * 3 * dt; P.v.z += sz * 3 * dt;
    P.v.multiplyScalar(Math.exp(-dt * .35));
    if (K.KeyR) P.rope.L = Math.max(.3, P.rope.L - REEL * dt);
    P.bob *= Math.exp(-dt * 8);
  }
  const st = { g: false, was: P.grounded, impact: 0 }, n = 3;
  for (let i = 0; i < n; i++) {
    P.p.addScaledVector(P.v, dt / n);
    if (P.rope && !P.inGrav) ropeConstraint(P, st, dt / n);
    for (const c of COLLIDERS) {
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
  if (P.rope) {
    if (st.g && !st.bed && P.p.y > F - .2 && Math.abs(P.p.z) < HALF_W + .2) P.rope = null;                    // 열차 위에 다시 섬
    else if (P.rope.L <= .32) climbBack(P);
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
export function reelIn() { player.rope = null; player.car = spawnCar; player.p.set(SPAWN_X, F + .05, 0); player.v.set(0, 0, 0); }
const COLLIDERS = [...CARS, ...JOINTS];
/** 줄 길이 제약 + 선로 바닥·터널 벽 */
function ropeConstraint(P, st, h) {
  const a = ropeAnchor(P, _an), p = P.p;
  _rn.subVectors(p, a); const d = _rn.length();
  if (d > P.rope.L) { _rn.divideScalar(d); p.copy(a).addScaledVector(_rn, P.rope.L); const vr = P.v.dot(_rn); if (vr > 0) P.v.addScaledVector(_rn, -vr * 1.15); }
  // 선로 바닥: 차량 로컬에서 선로는 y≈-.3. 터널은 바닥이 넓고, 철교·고가는 차량 폭보다 좁다(밖으로 벗어나면 허공)
  const sp = specAt(S.sTrain - P.car.off + p.x), tunnel = sp.tunnel, gy = tunnel ? -.42 : -.05, hw = tunnel ? 6 : 1.95;
  if (p.y < gy && Math.abs(p.z) < hw && p.y > gy - 1) {
    p.y = gy; if (P.v.y < 0) P.v.y = 0; st.bed = true;
    const sp2 = Math.abs(S.speed); if (sp2 > 1.5) { P.scrape += sp2 * .45 * h; P.v.x -= sp2 * .02; S.shake = Math.max(S.shake, Math.min(.2, sp2 * .006)); }
  }
  if (tunnel) p.z = clamp(p.z, -5.2, 5.2);
}
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
const RN = 18, ropeSeg = new THREE.InstancedMesh(new THREE.CylinderGeometry(.028, .028, 1, 6).translate(0, .5, 0), new THREE.MeshLambertMaterial({ color: 0xb8913a }), RN - 1);
ropeSeg.frustumCulled = false; ropeSeg.visible = false; scene.add(ropeSeg);
const hook = new THREE.Mesh(prep(new THREE.BoxGeometry(.16, .22, .12), C('#3a3e44')), landMat); hook.visible = false; scene.add(hook);
const rp = Array.from({ length: RN }, () => new THREE.Vector3()), rq = Array.from({ length: RN }, () => new THREE.Vector3());
let ropeLive = false;
const _r0 = new THREE.Vector3(), _r1 = new THREE.Vector3(), _rm = new THREE.Matrix4(), _rqq = new THREE.Quaternion(), _rs = new THREE.Vector3(), UPY = new THREE.Vector3(0, 1, 0);
function updateRope(dt) {
  const P = player, on = !!P.rope && !P.inGrav;
  ropeSeg.visible = hook.visible = on; if (!on) { ropeLive = false; return; }
  const a = ropeAnchor(P, _r0), b = _r1.set(P.p.x, P.p.y + 1.25, P.p.z);         // 차량 로컬
  if (!ropeLive) { for (let i = 0; i < RN; i++) { rp[i].lerpVectors(a, b, i / (RN - 1)); rq[i].copy(rp[i]); } ropeLive = true; }
  const seg = P.rope.L / (RN - 1) * 1.02, wind = -.0035 * S.speed * Math.abs(S.speed);
  for (let i = 1; i < RN - 1; i++) { const v = _rs.subVectors(rp[i], rq[i]).multiplyScalar(.97); rq[i].copy(rp[i]); rp[i].add(v); rp[i].y -= 9.8 * dt * dt; rp[i].x += wind * dt * dt; }
  for (let it = 0; it < 10; it++) {
    rp[0].copy(a); rp[RN - 1].copy(b);
    for (let i = 0; i < RN - 1; i++) { const d = _rs.subVectors(rp[i + 1], rp[i]), L = d.length() || 1e-4; if (L <= seg) continue; const k = (L - seg) / L * .5; if (i > 0) rp[i].addScaledVector(d, k); if (i + 1 < RN - 1) rp[i + 1].addScaledVector(d, -k); }
  }
  const M = P.car.g.matrixWorld;
  for (let i = 0; i < RN - 1; i++) {
    _rs.copy(rp[i]).applyMatrix4(M); _r1.copy(rp[i + 1]).applyMatrix4(M); const d = _r1.sub(_rs), L = d.length();
    _rqq.setFromUnitVectors(UPY, d.divideScalar(L || 1)); _rm.compose(_rs, _rqq, _r0.set(1, L, 1)); ropeSeg.setMatrixAt(i, _rm);
  }
  ropeSeg.instanceMatrix.needsUpdate = true;
  hook.position.copy(rp[0]).applyMatrix4(M); hook.quaternion.copy(P.car.g.quaternion);
}
const avState = { speed: 0, vy: 0, grounded: true, inGrav: true, yaw: 0, pitch: 0 };
export function updateAvatar(wp, dt) {
  const A = localAvatar;
  A.holder.visible = S.viewMode !== 'fp';
  A.holder.position.copy(player.p).applyMatrix4(player.car.g.matrixWorld);
  A.holder.quaternion.copy(player.car.g.quaternion);
  Object.assign(avState, { speed: Math.hypot(player.v.x, player.v.z), vy: player.v.y, grounded: player.grounded, inGrav: player.inGrav, yaw: player.yaw, pitch: player.pitch });
  A.update(dt, avState, S.time);
  updateRope(Math.min(dt, 1 / 30));
}
