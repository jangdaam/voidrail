// 안드로이드: 도시의 정비용 인간형 기계. 선로 옆에 가만히 서 있다가 열차가 지나가면 달려든다.
//
//   wait  : 선로 옆에 서서 다가오는 열차 쪽으로 고개만 돌린다
//   leap  : 열차 옆면으로 뛰어 붙는다 (열차가 너무 빠르면 붙잡지 못하고 튕겨 나감)
//   hang  : 옆면에 매달린다. 열차가 빨라지면 버티다 떨어지고, 느리면 기어오른다
//   climb : 열린 동력차로는 안으로, 지붕 있는 칸에서는 지붕 위로
//   walk  : 열차 위를 걸어 가장 가까운 사람에게 다가가 때린다
// 서행하며 파밍할수록 많이 올라타고, 속도를 올리면 떨쳐낼 수 있다. 총·포탑으로 부수거나 발로 차 떨어뜨린다.
// 위치는 '열차 통합 좌표'(운전차 기준 x, 차량 로컬 y·z)로 다룬다 → 열차가 아무리 빨라도 붙어 있다.
import * as THREE from 'three';
import { C, landMat } from './geo.js';
import { scene } from './scene.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { trainToWorld, carForTrainX, cabinCar, powerCar, driveCar, HALF_W, ROOF_Y } from './train.js';
import { ANDROID as CFG, F } from './config.js';
import { S } from './state.js';
import * as A from './audio.js';

let H = {};                                   // { hurt(n, fromWorld), reward(worldPos), toast }
export const initAndroids = hooks => H = hooks;

/* ---------- 모델: 마르고 긴 팔다리, 얼굴 없이 센서 불빛 하나. 정면 = +z ---------- */
const BODY = new THREE.Color('#8f989c'), DARK = new THREE.Color('#3a4144');
const box = (w, h, d, y = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, 0); return g; };
const GEO = { torso: box(.4, .62, .22, .31), pelvis: box(.3, .16, .2), head: box(.2, .26, .2, .13), arm: box(.085, .78, .085, -.39), leg: box(.1, .86, .1, -.43), eye: box(.07, .05, .02) };
GEO.stand = (() => { const g = new THREE.BoxGeometry(.8, 1.7, .8); g.translate(0, .85, 0); return g; })();
const PERCH = 1.7;
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5a48 });
const TRAIN_BACK = powerCar.off + 3.5, CAB_BACK = cabinCar.off + 3.5;

class Droid {
  constructor() {
    this.mat = new THREE.MeshLambertMaterial({ color: BODY, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 });
    this.matD = new THREE.MeshLambertMaterial({ color: DARK, flatShading: true });
    const g = this.g = new THREE.Group(), b = this.body = new THREE.Group(); g.add(b);
    const add = (geo, mat, x, y, z, parent = b) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    add(GEO.pelvis, this.matD, 0, .92, 0); add(GEO.torso, this.mat, 0, 1.0, 0);
    this.head = add(GEO.head, this.mat, 0, 1.66, 0); add(GEO.eye, eyeMat, 0, .15, .105, this.head);
    this.armL = add(GEO.arm, this.matD, .25, 1.56, 0); this.armR = add(GEO.arm, this.matD, -.25, 1.56, 0);
    this.legL = add(GEO.leg, this.matD, .1, .86, 0); this.legR = add(GEO.leg, this.matD, -.1, .86, 0);
    // 기다리는 동안 딛고 선 작업 발판 (열차 바닥 높이 → 지나가는 열차에서 눈높이로 마주침)
    this.stand = new THREE.Mesh(GEO.stand, this.matD); this.stand.position.y = -PERCH / 1.08; g.add(this.stand);
    g.scale.setScalar(1.08); g.visible = false; scene.add(g);
    this.tp = new THREE.Vector3(); this.w = new THREE.Vector3(); this.v = new THREE.Vector3(); this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    this.alive = false;
  }
  spawn(s0, side) {
    Object.assign(this, { alive: true, state: 'wait', s0, side, hp: CFG.hp, t: 0, st: 0, flash: 0, heading: 0, level: 'floor', cool: 0, grip: 1, stagger: 0, targetX: -1 - Math.random() * (TRAIN_BACK - 2), phase: Math.random() * 9 });
    this.g.visible = true; this.mat.emissiveIntensity = 0; this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0);
  }
  set(state) { this.state = state; this.st = 0; }
}
const pool = Array.from({ length: CFG.max }, () => new Droid());
export const androidCount = () => pool.filter(d => d.alive).length;
export const __droids = pool;

/* ---------- 등장 ---------- */
let nextT = CFG.firstDelay;
export function spawnGroup(n = 1 + (Math.random() * 3 | 0)) {
  const side = Math.random() < .5 ? -1 : 1; let made = 0;
  for (let i = 0; i < n; i++) { const d = pool.find(x => !x.alive); if (!d) break; d.spawn(S.sTrain + 85 + Math.random() * 50 + i * 7, Math.random() < .75 ? side : -side); made++; }
  return made;
}
export function clearAndroids() { for (const d of pool) { d.alive = false; d.g.visible = false; } nextT = CFG.firstDelay; }

/* ---------- 매 프레임 ---------- */
const FR = makeFrame(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
/** targets: [{ x(통합), y, z, roof }] — 지금은 내 캐릭터만 */
export function updateAndroids(dt, authority, targets) {
  if (authority && S.dir > 0 && S.speed > 1) { nextT -= dt; if (nextT <= 0) { nextT = CFG.gapMin + Math.random() * (CFG.gapMax - CFG.gapMin); spawnGroup(); } }
  for (const d of pool) if (d.alive) step(d, dt, targets);
}
const jerk = t => Math.floor(t * 9) / 9;                       // 뚝뚝 끊기는 기계 동작

function step(d, dt, targets) {
  d.t += dt; d.st += dt; d.cool -= dt; d.stagger -= dt; d.flash = Math.max(0, d.flash - dt * 5); d.mat.emissiveIntensity = d.flash;
  const speed = Math.abs(S.speed), tq = jerk(d.t + d.phase);
  let armL = 0, armR = 0, legL = 0, legR = 0, headYaw = 0, lean = 0, roll = 0;

  if (d.state === 'wait') {
    frameAt(d.s0, FR); trackPos(d.s0, d.w).addScaledVector(FR.R, d.side * 3.4).addScaledVector(FR.U, PERCH - .1);
    d.g.position.copy(d.w);
    _f.copy(FR.R).multiplyScalar(-d.side); _x.crossVectors(FR.U, _f); d.g.quaternion.setFromRotationMatrix(_m.makeBasis(_x, FR.U, _f));
    const X = d.s0 - S.sTrain;                                   // 열차 기준 내 위치 (앞이 +)
    headYaw = Math.max(-1.3, Math.min(1.3, Math.atan2(X, 3) * d.side));     // 다가오는 열차 쪽으로 고개만
    armL = armR = .05;
    if (X < -TRAIN_BACK - 30 || X > 260) { d.alive = false; d.g.visible = false; return; }      // 지나쳤거나 너무 멀어짐
    if (X <= d.targetX && X > -TRAIN_BACK) {
      if (speed > CFG.latchMaxSpeed) { A.clangSnd(); toFall(d, 1.2); }
      else {
        const car = carForTrainX(X), lx = Math.max(car.x0 + .5, Math.min(car.x1 - .5, X + car.off));
        d.from.copy(d.w); d.to.set(lx - car.off, F - 1.05, d.side * (HALF_W + .22)); d.tp.copy(d.to);
        d.set('leap'); A.servo(1.5);
      }
    }
  } else if (d.state === 'leap') {
    const k = Math.min(1, d.st / .3); trainToWorld(d.to, _p);
    d.w.lerpVectors(d.from, _p, k); d.w.y += Math.sin(k * Math.PI) * 1.1; d.g.position.copy(d.w);
    armL = armR = -2.6 * k; legL = .5; legR = -.4;
    if (k >= 1) { d.set('hang'); d.grip = 1; A.clangSnd(); S.shake = Math.max(S.shake, .05); }
  } else if (d.state === 'hang') {
    place(d, d.side > 0 ? Math.PI : 0);
    armL = armR = -2.9; const sway = Math.sin(tq * 5) * (.08 + speed * .012); legL = sway + speed * .03; legR = -sway * .7 + speed * .03; roll = sway * .6; lean = -speed * .012;
    if (speed > CFG.shakeSpeed) { d.grip -= dt * (.18 + (speed - CFG.shakeSpeed) * .035); if (d.grip <= 0) toFall(d, 1); }
    else if (d.st > CFG.climb) {
      const car = carForTrainX(d.tp.x); d.from.copy(d.tp);
      if (car === powerCar) { d.level = 'floor'; d.to.set(d.tp.x, F, d.side * 1.25); } else { d.level = 'roof'; d.to.set(d.tp.x, ROOF_Y, d.side * 1.2); }
      d.set('climb'); A.servo();
    }
  } else if (d.state === 'climb') {
    const k = Math.min(1, d.st / (d.level === 'roof' ? 1.5 : .9));
    d.tp.lerpVectors(d.from, d.to, k); d.tp.y = d.from.y + (d.to.y - d.from.y) * Math.min(1, k * 1.5); d.tp.z = d.from.z + (d.to.z - d.from.z) * Math.max(0, k * 2 - 1);
    place(d, d.side > 0 ? Math.PI : 0); armL = armR = -2.9 + 2.2 * k; legL = Math.sin(tq * 9) * .6; legR = -legL;
    if (k >= 1) d.set('walk');
  } else if (d.state === 'walk' || d.state === 'windup') {
    // 목표: 같은 높이(바닥/지붕)에 있는 가장 가까운 사람
    let tg = null, bd = 1e9;
    for (const T of targets) { if (!!T.roof !== (d.level === 'roof')) continue; const dd = Math.abs(T.x - d.tp.x) + Math.abs(T.z - d.tp.z) * .5; if (dd < bd) { bd = dd; tg = T; } }
    let gx = d.tp.x, gz = 0, moving = false;
    if (tg) { gx = tg.x; gz = Math.abs(tg.x - d.tp.x) < 1.6 ? tg.z : 0; }
    else if (d.level === 'roof') gx = -CAB_BACK - 1.2;                      // 지붕에 아무도 없으면 뒤로 가서 동력차로 내려감
    else gx = d.tp.x + Math.sin(tq * .7) * .02;
    const car = carForTrainX(d.tp.x), lx = d.tp.x + car.off, nearEnd = d.level === 'floor' && (lx > car.x1 - .7 || lx < car.x0 + .7);
    if (nearEnd) gz = 0;                                                    // 칸 사이 문은 가운데로만 지남
    const dx = gx - d.tp.x, dz = gz - d.tp.z, dist = Math.hypot(tg ? tg.x - d.tp.x : dx, tg ? tg.z - d.tp.z : dz);
    if (d.state === 'walk' && d.stagger <= 0) {
      const step = CFG.walk * dt, blockX = nearEnd && Math.abs(d.tp.z) > .35;
      if (Math.abs(dz) > .05) { d.tp.z += Math.sign(dz) * Math.min(Math.abs(dz), step); moving = true; }
      if (!blockX && Math.abs(dx) > (tg ? .9 : .1)) { d.tp.x += Math.sign(dx) * Math.min(Math.abs(dx), step); moving = true; }
      if (Math.hypot(dx, dz) > .1) d.heading = Math.atan2(dx, dz + 1e-4 * Math.sign(dz || 1));
      if (d.level === 'roof' && d.tp.x < -CAB_BACK - .6) { d.level = 'floor'; d.from.copy(d.tp); d.to.set(-CAB_BACK - 1.6, F, 0); d.set('climb'); }
      if (tg && dist < 1.3 && d.cool <= 0) { d.set('windup'); A.servo(1.2); }
    }
    if (d.state === 'windup') {
      armR = -2.4 + (d.st > .4 ? 2.2 : 0); armL = -.6; lean = d.st > .4 ? .25 : -.15;
      if (d.st > .45 && !d.swung) { d.swung = true; if (tg && dist < 1.75) { trainToWorld(d.tp, _p); H.hurt?.(CFG.hit, _p); } }
      if (d.st > .8) { d.swung = false; d.cool = CFG.hitCool; d.set('walk'); }
    } else if (moving) { const sw = Math.sin(tq * 8) * .7; legL = sw; legR = -sw; armL = -sw * .5 - .5; armR = sw * .5 - .5; lean = .12; }
    else { armL = armR = -.25; headYaw = Math.sin(tq * 1.3) * .5; }
    if (d.stagger > 0) { lean = -.35; armL = armR = -1.2; }
    place(d, d.heading);
  } else if (d.state === 'fall') {
    d.v.y -= 14 * dt; d.w.addScaledVector(d.v, dt); d.g.position.copy(d.w);
    d.body.rotation.x += dt * 5; d.body.rotation.z += dt * 2.3; armL = armR = -1.5; legL = .8; legR = -.5;
    if (d.st > d.life) { d.alive = false; d.g.visible = false; return; }
  }
  d.stand.visible = d.state === 'wait';
  d.armL.rotation.x = armL; d.armR.rotation.x = armR; d.legL.rotation.x = legL; d.legR.rotation.x = legR; d.head.rotation.y = headYaw;
  if (d.state !== 'fall') { d.body.rotation.x = lean; d.body.rotation.z = roll; }
}
/** 열차 통합 좌표 → 월드 배치 */
function place(d, heading) {
  const car = trainToWorld(d.tp, d.w); d.g.position.copy(d.w);
  d.g.quaternion.copy(car.g.quaternion).multiply(_q.setFromAxisAngle(_Y, heading));
}
/** 열차에서 떨어져 나감: 뒤로 밀려나며 추락 */
function toFall(d, life) {
  frameAt(S.sTrain, FR);
  d.v.copy(FR.T).multiplyScalar(-Math.min(12, Math.abs(S.speed) * .5) - 1).addScaledVector(FR.R, d.side * 2.5).addScaledVector(FR.U, 1.5);
  d.w.copy(d.g.position); d.life = life + 1.2; d.set('fall');
}

/* ---------- 공격받기 ---------- */
const _o = new THREE.Vector3();
/** 광선에 맞는 안드로이드 (몸통·머리를 구 두 개로 근사) */
export function rayAndroid(origin, dir, maxDist) {
  let best = null, bt = maxDist, head = false;
  for (const d of pool) {
    if (!d.alive || d.state === 'fall') continue;
    _up.set(0, 1, 0).applyQuaternion(d.g.quaternion);
    for (const [h, r, isHead] of [[1.15, .5, false], [1.86, .26, true], [.5, .4, false]]) {
      _o.copy(d.g.position).addScaledVector(_up, h * 1.08).sub(origin); const t = _o.dot(dir);
      if (t < 0 || t > bt || _o.lengthSq() - t * t > r * r) continue;
      bt = t; best = d; head = isHead;
    }
  }
  return best ? { droid: best, dist: bt, head, point: origin.clone().addScaledVector(dir, bt) } : null;
}
/** 피해. 부서졌으면 true */
export function damageAndroid(d, dmg) {
  if (!d.alive) return false;
  d.hp -= dmg; d.flash = 1; d.stagger = Math.max(d.stagger, .25);
  if (d.hp > 0) { A.hitSnd(false); return false; }
  A.hitSnd(true); H.reward?.(d.g.position);
  if (d.state === 'wait') { frameAt(d.s0, FR); d.v.copy(FR.R).multiplyScalar(d.side * 1.5).setY(1); d.w.copy(d.g.position); d.life = 1.5; d.set('fall'); }
  else toFall(d, .6);
  return true;
}
/** 발차기: 눈앞의 안드로이드를 떨어뜨리거나 밀어냄. 맞았으면 true */
export function kickAndroid(origin, dir, range) {
  let hit = null, bd = range;
  for (const d of pool) {
    if (!d.alive || d.state === 'fall' || d.state === 'wait') continue;
    _up.set(0, 1, 0).applyQuaternion(d.g.quaternion); _o.copy(d.g.position).addScaledVector(_up, 1.1).sub(origin);
    const dist = _o.length(); if (dist > bd + (d.state === 'hang' ? .9 : 0) || _o.dot(dir) / Math.max(dist, .01) < .3) continue;
    bd = dist; hit = d;
  }
  if (!hit) return false;
  hit.flash = 1;
  if (hit.state === 'hang' || hit.state === 'leap' || hit.state === 'climb') toFall(hit, 1);
  else {
    // 걷는 중: 뒤로 밀려나며 잠깐 비틀거림. 지붕 끝이나 동력차 옆이면 떨어짐
    _o.copy(dir).applyQuaternion(_q.copy(carForTrainX(hit.tp.x).g.quaternion).invert());
    hit.tp.x += _o.x * 1.6; hit.tp.z += _o.z * 1.6; hit.stagger = 1.1; hit.set('walk'); hit.swung = false;
    if (Math.abs(hit.tp.z) > (hit.level === 'roof' ? 1.75 : 2.05) && (hit.level === 'roof' || carForTrainX(hit.tp.x) === powerCar)) { hit.side = Math.sign(hit.tp.z); place(hit, hit.heading); toFall(hit, 1); }
    else { hit.tp.z = Math.max(-1.5, Math.min(1.5, hit.tp.z)); damageAndroid(hit, 1); }
  }
  return true;
}
