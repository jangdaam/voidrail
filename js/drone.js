// 회수 드론: 도시가 '무단 이동 중인 전력'을 되찾으려 보내는 비행 기계. 노리는 건 사람이 아니라 배터리 칸의 배터리다.
//
// 1) 어둠 저편에서 탐조등 빛줄기가 먼저 보이고, 회전익 소리가 다가온다.
// 2) 곧장 달려들지 않는다. 열차 위를 좌우로 크게 가로지르며(갈지자) 앞뒤로 맴돌고, 빛으로 열차를 훑는다.
//    방향을 틀 때마다 관성으로 크게 휘며 기울고, 가끔 사람 쪽으로 내리꽂는 척하다 홱 솟구친다.
//    빛이 사람에게 닿으면 '삑삑삑' 하고 붙잡은 듯 빛을 고정한다.
// 3) 몇 번 맴돈 뒤 배터리 랙으로 급강하해 집게를 물린다(clamp). 이때가 가장 약하다 — 쏘거나 걷어차서 떼어 내야 한다.
// 4) 다 물면 배터리 전력을 뜯어 들고 달아난다. 달아나는 중에 격추하면 되찾는다.
// 위치는 '배터리 칸 기준 선로 좌표'(a: 선로 따라 앞뒤, h: 선로 위 높이, r: 좌우)로 다뤄 열차와 함께 굽은 선로를 따라간다.
import * as THREE from 'three';
import { C, prep, M, merged } from './geo.js';
import { scene, camera } from './scene.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { powerCar, RACK_AT } from './train.js';
import { DRONE as CFG } from './config.js';
import { S } from './state.js';
import * as A from './audio.js';

let H = {};                                    // { toast, reward(worldPos), spark(pos,n,col) }
export const initDrones = hooks => H = hooks;
const rnd = (a, b) => a + Math.random() * (b - a);

/* ================= 모델 ================= */
const HULL = C('#3a4248'), HULL2 = C('#262c30'), YEL = C('#b39a3c'), DK = C('#121517');
const hullGeo = merged([
  prep(new THREE.BoxGeometry(.9, .22, .6), HULL),
  prep(new THREE.BoxGeometry(.6, .14, .42), HULL2, M(0, .16, 0)),
  prep(new THREE.BoxGeometry(.18, .12, .5), YEL, M(-.38, .02, 0)),                  // 뒤쪽 경고 띠
  prep(new THREE.BoxGeometry(.3, .18, .3), DK, M(.34, -.12, 0)),                    // 탐조등 몸통
  ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => prep(new THREE.BoxGeometry(.55, .05, .07), HULL2, M(x * .55, .06, z * .42, 0, x * z * .6, 0))),
  ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => prep(new THREE.CylinderGeometry(.06, .06, .14, 6), DK, M(x * .75, .1, z * .56))),
]);
hullGeo.computeVertexNormals();
const rotorGeo = new THREE.CylinderGeometry(.34, .34, .012, 16);
const clawGeo = merged([prep(new THREE.BoxGeometry(.05, .45, .05), DK, M(0, -.22, 0)), prep(new THREE.BoxGeometry(.05, .05, .18), YEL, M(0, -.45, .07))]);
const battGeo = merged([prep(new THREE.BoxGeometry(.32, .42, .22), C('#4a5a52')), prep(new THREE.BoxGeometry(.2, .05, .12), C('#8fd8bf'), M(0, .23, 0))]);
const hullMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 });
const rotorMat = new THREE.MeshBasicMaterial({ color: 0x8a96a0, transparent: true, opacity: .28, depthWrite: false });
const lensOn = new THREE.MeshBasicMaterial({ color: 0xeef6ff }), lensRed = new THREE.MeshBasicMaterial({ color: 0xff5040 }), lensOff = new THREE.MeshBasicMaterial({ color: 0x1a1f22 });
const beaconOn = new THREE.MeshBasicMaterial({ color: 0xff3020 });
/* 빛줄기: 끝이 열린 원뿔, 꼭짓점이 밝고 멀수록 흐려짐 (가산 혼합 · 안개 적용) */
const BEAM_L = 26, BEAM_A = .26;
const beamGeo = (() => {
  const g = new THREE.ConeGeometry(Math.tan(BEAM_A) * BEAM_L, BEAM_L, 24, 6, true); g.translate(0, -BEAM_L / 2, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = Math.pow(1 + p.getY(i) / BEAM_L, 2.2) * .9 + .02; col[i * 3] = k * .85; col[i * 3 + 1] = k * .93; col[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
})();

class Drone {
  constructor() {
    const g = this.g = new THREE.Group(); g.visible = false; scene.add(g);
    this.mat = hullMat.clone(); this.body = new THREE.Group(); g.add(this.body);
    this.body.add(new THREE.Mesh(hullGeo, this.mat));
    this.rotors = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => { const r = new THREE.Mesh(rotorGeo, rotorMat); r.position.set(x * .75, .18, z * .56); this.body.add(r); return r; });
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(.11, 12), lensOn); this.lens.rotation.y = Math.PI / 2; this.lens.position.set(.5, -.12, 0); this.body.add(this.lens);
    this.beacon = new THREE.Mesh(new THREE.BoxGeometry(.07, .06, .07), beaconOn); this.beacon.position.set(-.1, .26, 0); this.body.add(this.beacon);
    this.claws = [-1, 1].map(s => { const c = new THREE.Mesh(clawGeo, this.mat); c.position.set(.05, -.1, s * .12); c.scale.z = s; this.body.add(c); return c; });
    this.batt = new THREE.Mesh(battGeo, landLike); this.batt.position.set(0, -.62, 0); this.batt.visible = false; this.body.add(this.batt);
    // 탐조등 (광원 수가 바뀌면 셰이더를 다시 만들어 끊기므로 미리 만들어 두고 세기만 바꿈)
    this.spot = new THREE.SpotLight(0xe6f1ff, 0, 42, BEAM_A, .45, 1.5); this.spot.castShadow = false;
    this.spot.position.set(.5, -.12, 0); this.body.add(this.spot); scene.add(this.spot.target);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.frustumCulled = false; scene.add(this.beam); this.beam.visible = false;
    const V = () => new THREE.Vector3();
    this.p = V(); this.v = V(); this.wp = V(); this.aim = V(); this.aimV = V(); this.w = V(); this.wv = V(); this.spin = V();
    this.alive = false; this.voice = null;
  }
}
const landLike = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x3a8a70, emissiveIntensity: .35 });
const pool = Array.from({ length: CFG.max }, () => new Drone());
export const __drones = pool;
export const droneCount = () => pool.filter(d => d.alive).length;

/* ================= 좌표 ================= */
const FR = makeFrame(), _P = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const sPower = () => S.sTrain - powerCar.off;
/** 배터리 칸 기준 선로 좌표 (a, h, r) → 월드 */
function relToWorld(p, out) { const s = sPower() + p.x; frameAt(s, FR); return trackPos(s, out).addScaledVector(FR.U, p.y).addScaledVector(FR.R, p.z); }
const rackWorld = out => out.copy(RACK_AT).applyMatrix4(powerCar.g.matrixWorld);
const rackRel = out => out.set(RACK_AT.x, RACK_AT.y + .3, RACK_AT.z);           // 차량 로컬 ≈ 선로 좌표 (차체가 .3 떠 있음)

/* ================= 생성 ================= */
let nextT = CFG.firstDelay;
export function spawnDrone() {
  const d = pool.find(x => !x.alive); if (!d) return null;
  const ahead = Math.random() < .55;
  Object.assign(d, { alive: true, state: 'approach', t: 0, st: 0, hp: CFG.hp, legs: 0, maxLegs: 3 + (Math.random() * 4 | 0), side: Math.random() < .5 ? 1 : -1,
    clampT: 0, stolen: 0, lockCD: 0, flash: 0, feint: false, roll: 0, pitch: 0, yaw: ahead ? Math.PI : 0, flick: 0 });
  d.p.set(ahead ? rnd(70, 95) : -rnd(60, 80), rnd(6, 6.8), d.side * rnd(1, 3)); d.v.set(ahead ? -CFG.speed : CFG.speed, 0, 0);
  pickWaypoint(d); d.g.visible = true; d.beam.visible = true; d.batt.visible = false; d.mat.emissiveIntensity = 0;
  relToWorld(d.p, d.g.position); d.aim.copy(d.g.position).addScaledVector(FR.T, ahead ? -10 : 10); d.aim.y -= 6; d.aimV.set(0, 0, 0);
  return d;
}
export function clearDrones() { for (const d of pool) kill(d, true); nextT = CFG.firstDelay; }
function kill(d) { d.alive = false; d.g.visible = false; d.beam.visible = false; d.spot.intensity = 0; d.voice?.set(0, 0, 1); }

/** 갈지자: 열차 반대편으로 건너가며 앞뒤로 크게 오감. 가끔 사람 쪽으로 내리꽂는 척 */
function pickWaypoint(d) {
  d.side = -d.side; d.feint = false;
  const far = Math.random() < .5;
  d.wp.set(far ? rnd(-26, -12) : rnd(6, 22), rnd(5.4, 6.7), d.side * rnd(2.6, 4.6));
  if (d.legs > 0 && Math.random() < .3) {                          // 덮치는 척: 사람 바로 위로 낮게 → 도착하면 홱 솟구침
    camWorldToRel(_a); d.wp.set(Math.max(-30, Math.min(25, _a.x)), Math.min(6.4, Math.max(4.6, _a.y + 1.4)), Math.max(-3, Math.min(3, _a.z * .6))); d.feint = true;
  }
}
/** 카메라(내 위치)를 배터리 칸 기준 선로 좌표로 (근사: 배터리 칸 프레임) */
function camWorldToRel(out) { _a.copy(camera.position).applyMatrix4(powerCar.inv); return out.set(_a.x, _a.y + .3, _a.z); }

/* ================= 매 프레임 ================= */
const _w = new THREE.Vector3(), _dir = new THREE.Vector3(), _t = new THREE.Vector3(), _acc = new THREE.Vector3(), _pan = new THREE.Vector3(), _cr = new THREE.Vector3(), _rk = new THREE.Vector3();
export function updateDrones(dt, authority) {
  if (authority && S.dir > 0 && Math.abs(S.speed) > 2) { nextT -= dt; if (nextT <= 0) { nextT = rnd(CFG.gapMin, CFG.gapMax); spawnDrone(); if (Math.random() < .25) spawnDrone(); } }
  for (const d of pool) {
    if (!d.voice) d.voice = A.droneVoice();
    if (d.alive) step(d, dt); else if (d.voice) d.voice.set(0, 0, 1);
  }
}
/** 목표 지점으로 가속 제한을 두고 조향 → 방향을 틀 때 관성으로 크게 휘며 지나침 */
function steer(d, target, maxSpeed, accel, dt, arrive = 3) {
  _t.subVectors(target, d.p); const dist = _t.length();
  const want = Math.min(maxSpeed, dist / arrive * maxSpeed);
  _t.setLength(want).sub(d.v); const l = _t.length(); if (l > accel * dt) _t.multiplyScalar(accel * dt / l);
  _acc.copy(_t).divideScalar(Math.max(dt, 1e-4)); d.v.add(_t); d.p.addScaledVector(d.v, dt);
  return dist;
}
function step(d, dt) {
  d.t += dt; d.st += dt; d.lockCD -= dt; d.flash = Math.max(0, d.flash - dt * 4); d.mat.emissiveIntensity = d.flash;
  _acc.set(0, 0, 0);
  let aimAt = null, beamK = 1, hover = .25;
  switch (d.state) {
    case 'approach': {                                          // 멀리서 빛부터 보이며 다가옴
      steer(d, d.wp, CFG.speed * .8, 6, dt, 6);
      if (Math.abs(d.p.x - d.wp.x) < 14) setS(d, 'circle');
      break;
    }
    case 'circle': {
      const dist = steer(d, d.wp, d.feint ? CFG.dive * .8 : CFG.speed, d.feint ? 16 : 9, dt, d.feint ? 1.2 : 4);
      if (dist < (d.feint ? 1.2 : 2.2) || d.st > 7) { d.st = 0;
        if (d.feint) { d.v.y += 7; d.v.x += rnd(-5, 5); A.droneSnd('dive', pan(d), vol(d) * .8); }      // 홱 솟구침
        d.legs++; if (d.legs >= d.maxLegs) { setS(d, 'dive'); A.droneSnd('dive', pan(d), vol(d)); break; }
        pickWaypoint(d);
      }
      if (d.feint) beamK = 1.2;
      break;
    }
    case 'dive': {                                              // 배터리 랙 위로 급강하
      rackRel(_rk); _rk.y += 1.25; _rk.z -= .25;
      const dist = steer(d, _rk, CFG.dive, 26, dt, 2.2); aimAt = rackWorld(_w);
      if (dist < .35) { setS(d, 'clamp'); d.clampT = 0; A.droneSnd('clamp', pan(d), vol(d)); }
      break;
    }
    case 'clamp': {                                             // 집게를 물리고 전력을 뜯어냄 — 가장 약한 순간
      rackRel(_rk); _rk.y += 1.05 + Math.sin(d.t * 9) * .04; _rk.z -= .25;
      steer(d, _rk, 4, 30, dt, .6); aimAt = rackWorld(_w); hover = .06;
      d.clampT += dt; if (Math.random() < dt * 6) H.spark?.(rackWorld(_w).add(_t.set(0, .3, 0)), 3, 0x9fe0c8);
      if (Math.random() < dt * 2) A.droneSnd('clamp', pan(d), vol(d) * .5);
      if (d.clampT >= CFG.clamp) {
        d.stolen = Math.min(S.battery, 25 + Math.random() * 10); S.battery -= d.stolen;
        if (S.battery <= 0) { S.battery = 0; S.powered = false; S.notch = 0; }
        d.batt.visible = true; A.droneSnd('steal', pan(d), vol(d) * 1.2); H.toast?.(`회수 드론이 배터리 ${Math.round(d.stolen)}%를 뜯어 갔어요! 쏴서 떨어뜨리면 되찾아요`);
        setS(d, 'flee'); d.wp.set(Math.random() < .5 ? -45 : 45, 7.5, d.side * 3);
      }
      break;
    }
    case 'flee': {
      steer(d, d.wp, CFG.speed * 1.2, 12, dt, 1); beamK = .6;
      if (d.st > 4.5) kill(d);
      break;
    }
    case 'knocked': {                                           // 걷어차이거나 맞아서 떨어져 나감 → 다시 맴돔
      d.v.multiplyScalar(1 - dt * 1.5); d.p.addScaledVector(d.v, dt); d.p.y = Math.max(d.p.y, 4.6);
      if (d.st > 1.1) { setS(d, 'circle'); d.legs = Math.max(0, d.maxLegs - 2); pickWaypoint(d); }
      break;
    }
    case 'fall': stepFall(d, dt); return;
  }
  if (!d.alive) return;
  // 터널 안을 벗어나지 않게
  d.p.y = Math.min(d.p.y, 6.8); d.p.z = Math.max(-5, Math.min(5, d.p.z));
  // 월드 배치 + 기울기: 진행 방향을 향하고, 꺾는 가속 쪽으로 몸을 기울임
  relToWorld(d.p, d.g.position);
  frameAt(sPower() + d.p.x, FR);
  const along = d.v.x, side = d.v.z, sp = Math.hypot(along, side);
  if (sp > .6) { const yw = Math.atan2(-side, along); let dy = yw - d.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); d.yaw += dy * Math.min(1, dt * 3); }
  const cy = Math.cos(d.yaw), sy = Math.sin(d.yaw);
  const fwdAcc = _acc.x * cy - _acc.z * sy, latAcc = _acc.x * sy + _acc.z * cy;
  d.roll += (Math.max(-.7, Math.min(.7, latAcc * .05)) - d.roll) * Math.min(1, dt * 5);
  d.pitch += (Math.max(-.5, Math.min(.5, -fwdAcc * .035 - sp * .012)) - d.pitch) * Math.min(1, dt * 5);
  d.g.quaternion.setFromRotationMatrix(FR.m).multiply(_q.setFromEuler(new THREE.Euler(d.roll, d.yaw, d.pitch, 'YXZ')));
  d.body.position.y = Math.sin(d.t * 3.3) * hover;
  for (const r of d.rotors) r.rotation.y += dt * 60;
  d.beacon.visible = Math.sin(d.t * 7) > .6;
  const open = d.state === 'clamp' ? .9 : d.state === 'dive' ? .5 : .1; for (const c of d.claws) c.rotation.x += ((c.scale.z > 0 ? -1 : 1) * open - c.rotation.x) * Math.min(1, dt * 6);
  // 탐조등: 평소엔 열차를 이리저리 훑고, 사람이 빛에 걸리면 붙잡듯 따라감
  d.g.updateMatrixWorld();
  d.lens.getWorldPosition(_w);
  if (!aimAt) {
    _t.copy(camera.position);
    const sweep = _b.copy(FR.R).multiplyScalar(Math.sin(d.t * .9) * 3).addScaledVector(FR.T, Math.sin(d.t * .53) * 5);
    const locked = d.lockT > 0;
    aimAt = locked ? _t : relToWorld(_a.set(d.p.x * .6, 1.6, 0), _P).add(sweep);
  }
  d.aimV.multiplyScalar(Math.exp(-dt * 6)).addScaledVector(_t.subVectors(aimAt, d.aim), dt * 20); d.aim.addScaledVector(d.aimV, dt);
  _dir.subVectors(d.aim, _w).normalize();
  // 사람이 빛줄기 안에 들어오면 잠금
  _a.subVectors(camera.position, _w); const cd = _a.length();
  d.lockT = (d.lockT || 0) - dt;
  if (cd < BEAM_L && _a.normalize().dot(_dir) > Math.cos(BEAM_A * .9) && d.state === 'circle') {
    if (d.lockCD <= 0) { d.lockCD = 3; d.lockT = 1.6; d.flick = .5; A.droneSnd('lock', pan(d), vol(d) * 1.3); }
  }
  d.flick = Math.max(0, d.flick - dt);
  const on = d.flick > 0 ? (Math.sin(d.t * 70) > -.2 ? 1 : .15) : 1;
  d.spot.position.copy(d.lens.position); d.spot.target.position.copy(d.aim); d.spot.target.updateMatrixWorld();
  d.spot.intensity = 520 * beamK * on; d.spot.color.setHex(d.state === 'clamp' || d.state === 'dive' ? 0xff6a55 : 0xe6f1ff);
  d.lens.material = d.state === 'clamp' || d.state === 'dive' ? lensRed : lensOn;
  d.beam.position.copy(_w); d.beam.quaternion.setFromUnitVectors(_b.set(0, -1, 0), _dir);
  d.beam.material.opacity = .13 * beamK * on; d.beam.material.color.setHex(d.state === 'clamp' || d.state === 'dive' ? 0xff7766 : 0xffffff);
  // 소리
  d.voice?.set(pan(d), vol(d) * .55, .85 + sp * .03 + (d.state === 'dive' ? .35 : 0));
}
function setS(d, s) { d.state = s; d.st = 0; }
function pan(d) { _pan.subVectors(d.g.position, camera.position).normalize(); _cr.setFromMatrixColumn(camera.matrixWorld, 0); return _pan.dot(_cr); }
function vol(d) { return Math.min(1, 9 / (d.g.position.distanceTo(camera.position) + 3)); }

/* ================= 맞기 · 떨어지기 ================= */
export function rayDrone(origin, dir, maxDist) {
  let best = null, bt = maxDist;
  for (const d of pool) {
    if (!d.alive || d.state === 'fall') continue;
    d.body.getWorldPosition(_w); _a.copy(_w).sub(origin); const t = _a.dot(dir);
    if (t < 0 || t > bt || _a.lengthSq() - t * t > .6 * .6) continue;
    bt = t; best = d;
  }
  return best ? { drone: best, dist: bt, point: origin.clone().addScaledVector(dir, bt) } : null;
}
/** 피해. 떨어졌으면 true */
export function damageDrone(d, dmg, dirWorld) {
  if (!d.alive || d.state === 'fall') return false;
  d.hp -= dmg; d.flash = 1; A.hitSnd(d.hp <= 0);
  if (d.hp > 0) {
    if (d.state === 'clamp' || d.state === 'dive') { knock(d, dirWorld, 5); H.toast?.('드론이 배터리에서 떨어져 나갔어요'); }
    else { d.v.x += rnd(-3, 3); d.v.y += 2; d.roll += rnd(-.6, .6); }
    return false;
  }
  startFall(d, dirWorld); return true;
}
function knock(d, dirWorld, power) {
  frameAt(sPower() + d.p.x, FR);
  if (dirWorld) { d.v.x += dirWorld.dot(FR.T) * power; d.v.z += dirWorld.dot(FR.R) * power; }
  d.v.y += power * .7; setS(d, 'knocked'); A.droneSnd('dive', pan(d), vol(d) * .7);
}
/** 발차기: 랙에 붙은 드론을 걷어참 */
export function kickDrone(origin, dir, range) {
  for (const d of pool) {
    if (!d.alive || (d.state !== 'clamp' && d.state !== 'dive')) continue;
    d.body.getWorldPosition(_w); _a.subVectors(_w, origin); const dist = _a.length();
    if (dist > range + .8 || _a.dot(dir) / dist < .2) continue;
    d.hp -= 1; d.flash = 1; if (d.hp <= 0) startFall(d, dir); else knock(d, dir, 7); return true;
  }
  return false;
}
function startFall(d, dirWorld) {
  d.body.getWorldPosition(d.w); frameAt(sPower() + d.p.x, FR);
  d.wv.copy(FR.T).multiplyScalar(S.speed + d.v.x).addScaledVector(FR.U, d.v.y + 2).addScaledVector(FR.R, d.v.z);
  if (dirWorld) d.wv.addScaledVector(dirWorld, 3);
  d.spin.set(rnd(-6, 6), rnd(-8, 8), rnd(-6, 6)); setS(d, 'fall');
  d.spot.intensity = 0; d.beam.visible = false; d.lens.material = lensOff;
  H.reward?.(d.w.clone());
  if (d.stolen > 0) { S.battery = Math.min(100, S.battery + d.stolen); H.toast?.(`배터리 ${Math.round(d.stolen)}%를 되찾았어요`); d.stolen = 0; d.batt.visible = false; }
  A.droneSnd('crash', pan(d), vol(d) * .6);
}
function stepFall(d, dt) {
  d.wv.y -= 14 * dt; d.w.addScaledVector(d.wv, dt);
  d.g.position.copy(d.w); d.body.position.set(0, 0, 0);
  _q.setFromEuler(new THREE.Euler(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt)); d.g.quaternion.multiply(_q);
  for (const r of d.rotors) r.rotation.y += dt * 8;
  if (Math.random() < dt * 25) H.spark?.(d.w, 2, 0xffa060);
  d.voice?.set(pan(d), vol(d) * .3 * Math.max(0, 1 - d.st), .6 - d.st * .2);
  // 선로 바닥에 닿으면 부서짐
  _P.copy(d.w).applyMatrix4(powerCar.inv);
  if (_P.y < .1 || d.st > 4) { A.droneSnd('crash', pan(d), vol(d)); H.spark?.(d.w, 12, 0xffa060); S.shake = Math.max(S.shake, vol(d) * .12); kill(d); }
}
