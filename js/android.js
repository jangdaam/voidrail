// 안드로이드: 도시의 정비용 인간형 기계. 맵 곳곳에 숨어 있다가 열차가 지나가면 덤벼든다.
//
// 숨어 있는 자리 (city.anchorsIn — 시드로 정해짐)
//   door  : 터널 정비문 안. 다가오면 문을 두드리다가 문짝을 박차고 나와 보행로에 웅크린 뒤 뛰어든다
//   ceil  : 터널 천장 늑골에 거꾸로 매달림. 열차가 밑을 지나면 지붕 위로 떨어진다
//   under : 철교·고가 상판 가장자리 아래에 매달림. 손이 먼저 보이고, 옆을 지나는 객차로 옮겨 붙는다
// 붙은 뒤: 옆면에 매달림 → (빠르면 버티다 떨어짐 / 느리면) 기어오름 → 바닥은 걷고 지붕은 네 발로 기어 와 때린다
//
// 몸은 관절 리그(골반·척추·목·어깨·팔꿈치·손·엉덩이·무릎·발)로, 팔다리는 2관절 IK 로 푼다.
// 손발을 둘 자리만 정하면 팔꿈치·무릎이 따라 굽는다. 동작은 일부러 뚝뚝 끊기게(고개 홱 돌리기, 잠깐 멈췄다 움직이기).
// 위치는 숨어 있을 땐 월드 좌표, 열차에 붙은 뒤엔 '열차 통합 좌표'(운전차 기준 x, 차량 로컬 y·z)로 다룬다.
import * as THREE from 'three';
import { C, prep, M, merged } from './geo.js';
import { scene, camera } from './scene.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { anchorsIn, doorLeaves } from './city.js';
import { trainToWorld, carForTrainX, cabinCar, powerCar, driveCar, HALF_W, ROOF_Y } from './train.js';
import { ANDROID as CFG, F } from './config.js';
import { S } from './state.js';
import * as A from './audio.js';

let H = {};                                   // { hurt(n, fromWorld), reward(worldPos) }
export const initAndroids = hooks => H = hooks;

/* ================= 모델 ================= */
const SKIN = C('#a3acaf'), SKIN2 = C('#7d878a'), JOINT = C('#2b3033'), DARK = C('#1a1e20'), RUSTC = C('#6b4a35');
const limbGeo = (w, L, col) => prep(new THREE.BoxGeometry(w, L, w), col, M(0, -L / 2, 0));
const LEN = { ua: .46, fa: .56, th: .5, sh: .52, spine: .6 };
const GEO = {
  torso: merged([
    prep(new THREE.BoxGeometry(.4, .34, .22), SKIN, M(0, .43, .01)),             // 가슴판
    prep(new THREE.BoxGeometry(.3, .26, .16), JOINT, M(0, .14, 0)),               // 배 (드러난 골조)
    prep(new THREE.BoxGeometry(.06, .5, .06), SKIN2, M(0, .3, -.11)),             // 척추 막대
    prep(new THREE.BoxGeometry(.42, .05, .2), DARK, M(0, .26, 0)),
    prep(new THREE.BoxGeometry(.14, .1, .04), RUSTC, M(.1, .5, .12)),            // 벗겨진 번호판
  ]),
  pelvis: merged([prep(new THREE.BoxGeometry(.3, .14, .2), SKIN2), prep(new THREE.BoxGeometry(.1, .1, .1), JOINT, M(.14, -.03, 0)), prep(new THREE.BoxGeometry(.1, .1, .1), JOINT, M(-.14, -.03, 0))]),
  head: merged([
    prep(new THREE.BoxGeometry(.16, .24, .19), SKIN, M(0, .14, 0)),
    prep(new THREE.BoxGeometry(.17, .07, .04), DARK, M(0, .16, .09)),             // 얼굴 대신 검은 띠
    prep(new THREE.BoxGeometry(.05, .08, .05), JOINT, M(0, .0, -.02)),
  ]),
  ua: limbGeo(.085, LEN.ua, SKIN2), fa: limbGeo(.07, LEN.fa, SKIN), th: limbGeo(.1, LEN.th, SKIN2), sh: limbGeo(.085, LEN.sh, SKIN),
  hand: merged([prep(new THREE.BoxGeometry(.09, .12, .04), JOINT, M(0, -.06, 0)), prep(new THREE.BoxGeometry(.02, .1, .02), JOINT, M(.03, -.16, 0)), prep(new THREE.BoxGeometry(.02, .11, .02), JOINT, M(-.01, -.17, 0)), prep(new THREE.BoxGeometry(.02, .1, .02), JOINT, M(-.035, -.15, 0))]),
  foot: prep(new THREE.BoxGeometry(.09, .06, .22), JOINT, M(0, -.03, .06)),
  knob: prep(new THREE.BoxGeometry(.11, .11, .11), JOINT),
  eye: new THREE.BoxGeometry(.05, .035, .02),
};
for (const k in GEO) if (k !== 'eye') GEO[k].computeVertexNormals();
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a0605 });
const eyeOnMat = new THREE.MeshBasicMaterial({ color: 0xff4636 });
/* 눈 번짐: 어둠 속에서 멀리서도 붉은 점으로 보이게 (안개 무시) */
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.18, 'rgba(255,120,100,.8)'); g.addColorStop(.5, 'rgba(255,40,30,.18)'); g.addColorStop(1, 'rgba(255,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const TRAIN_BACK = powerCar.off + 3.5, CAB_BACK = cabinCar.off + 3.5;
const DOWN = new THREE.Vector3(0, -1, 0), UPV = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1), ZERO = new THREE.Vector3();

class Droid {
  constructor() {
    const mat = this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const g = this.g = new THREE.Group(); g.visible = false; scene.add(g);
    const mk = geo => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
    this.torso = mk(GEO.torso); this.pelvis = mk(GEO.pelvis); this.head = mk(GEO.head);
    this.ua = [mk(GEO.ua), mk(GEO.ua)]; this.fa = [mk(GEO.fa), mk(GEO.fa)]; this.hand = [mk(GEO.hand), mk(GEO.hand)];
    this.th = [mk(GEO.th), mk(GEO.th)]; this.sh = [mk(GEO.sh), mk(GEO.sh)]; this.foot = [mk(GEO.foot), mk(GEO.foot)];
    this.elbow = [mk(GEO.knob), mk(GEO.knob)]; this.knee = [mk(GEO.knob), mk(GEO.knob)];
    this.eye = new THREE.Mesh(GEO.eye, eyeMat); this.eye.position.set(0, .16, .11); this.head.add(this.eye);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.glow.position.set(0, .16, .16); this.glow.scale.setScalar(.6); this.head.add(this.glow);
    const V = () => new THREE.Vector3();
    this.P = { H: V(), sd: V(), hand: [V(), V()], foot: [V(), V()], ep: [V(), V()], kp: [V(), V()] };       // 리그 목표 (루트 로컬)
    this.look = V(0, 0, 1); this.tp = V(); this.w = V(); this.v = V(); this.from = V(); this.to = V();
    this.q0 = new THREE.Quaternion();
    this.hitT = V(); this.hitH = V(); this.hitP = V();
    this.alive = false;
  }
}
const pool = Array.from({ length: CFG.max }, () => new Droid());
export const androidCount = () => pool.filter(d => d.alive).length;
export const __droids = pool;

/* ================= 리그 풀기 ================= */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _m = new THREE.Matrix4();
/** 2관절 IK: 시작 O 에서 목표 T 로, 길이 a·b, 굽는 방향 pole. 관절 위치를 E 에, 닿는 끝을 Tc 에 */
function ik(O, T, a, b, pole, E, Tc) {
  _a.subVectors(T, O); const L = Math.min(Math.max(_a.length(), .05), a + b - .002); _a.normalize();
  const cosA = (a * a + L * L - b * b) / (2 * a * L), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a)); if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1).addScaledVector(_a, -_a.z); _b.normalize();
  E.copy(O).addScaledVector(_a, a * cosA).addScaledVector(_b, a * sinA);
  Tc.copy(O).addScaledVector(_a, L);
}
/** 아래로 뻗은 상자를 A → B 방향으로 */
function seg(mesh, A, B) { mesh.position.copy(A); _c.subVectors(B, A).normalize(); mesh.quaternion.setFromUnitVectors(DOWN, _c); }
const _sh = new THREE.Vector3(), _hp = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3(), _ch = new THREE.Vector3(), _nk = new THREE.Vector3(), _bx = new THREE.Vector3();
function applyRig(d) {
  const P = d.P;
  P.sd.normalize(); _ch.copy(P.H).addScaledVector(P.sd, LEN.spine);
  _bx.crossVectors(P.sd, FWD); if (_bx.lengthSq() < 1e-4) _bx.set(1, 0, 0); _bx.normalize();
  d.torso.position.copy(P.H); d.torso.quaternion.setFromUnitVectors(UPV, P.sd);
  d.pelvis.position.copy(P.H); d.pelvis.quaternion.copy(d.torso.quaternion);
  _nk.copy(_ch).addScaledVector(P.sd, .07);
  _y.copy(P.sd); _t.copy(d.look).normalize(); _x.crossVectors(_y, _t); if (_x.lengthSq() < 1e-4) _x.copy(_bx); _x.normalize(); _y.crossVectors(_t, _x);
  d.head.position.copy(_nk); d.head.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _t));
  for (let i = 0; i < 2; i++) {
    const s = i ? -1 : 1;
    _sh.copy(_ch).addScaledVector(_bx, .24 * s).addScaledVector(P.sd, -.06);
    ik(_sh, P.hand[i], LEN.ua, LEN.fa, P.ep[i], _E, _T);
    seg(d.ua[i], _sh, _E); seg(d.fa[i], _E, _T); d.elbow[i].position.copy(_E);
    d.hand[i].position.copy(_T); d.hand[i].quaternion.copy(d.fa[i].quaternion);
    _hp.copy(P.H).addScaledVector(_bx, .13 * s).addScaledVector(P.sd, -.05);
    ik(_hp, P.foot[i], LEN.th, LEN.sh, P.kp[i], _E, _T);
    seg(d.th[i], _hp, _E); seg(d.sh[i], _E, _T); d.knee[i].position.copy(_E);
    d.foot[i].position.copy(_T); d.foot[i].quaternion.identity();
  }
  d.g.updateMatrixWorld();
  d.hitP.copy(P.H).applyMatrix4(d.g.matrixWorld);
  d.hitT.copy(P.H).addScaledVector(P.sd, .35).applyMatrix4(d.g.matrixWorld);
  d.hitH.copy(_nk).addScaledVector(P.sd, .13).applyMatrix4(d.g.matrixWorld);
}

/* ================= 자세 (루트 로컬: +z 앞, +y 위) ================= */
const v3 = (v, x, y, z) => v.set(x, y, z);
function poseStand(d, crouch = 0) {
  const P = d.P, br = Math.sin(d.t * 1.7) * .012;
  v3(P.H, 0, 1.0 - crouch * .38 + br, -crouch * .1); v3(P.sd, 0, 1, .22 + crouch * .5);
  v3(P.hand[0], .34, .32, .1 + crouch * .25); v3(P.hand[1], -.34, .32, .1 + crouch * .25);
  v3(P.foot[0], .14, 0, crouch * .05); v3(P.foot[1], -.14, 0, crouch * .05);
  v3(P.ep[0], .5, -.1, -1); v3(P.ep[1], -.5, -.1, -1); v3(P.kp[0], .15, 0, 1); v3(P.kp[1], -.15, 0, 1);
}
function poseWalk(d) {
  const P = d.P, f = d.gait, s = Math.sin(f), c = Math.cos(f);
  v3(P.H, Math.sin(f * .5) * .03, .96 - .035 * Math.abs(s), 0); v3(P.sd, 0, 1, .42);
  v3(P.foot[0], .14, .15 * Math.max(0, c), .32 * s); v3(P.foot[1], -.14, .15 * Math.max(0, -c), -.32 * s);
  v3(P.hand[0], .33, .3 + .08 * Math.max(0, -s), .12 - .28 * s); v3(P.hand[1], -.33, .3 + .08 * Math.max(0, s), .12 + .28 * s);
  v3(P.ep[0], .5, 0, -1); v3(P.ep[1], -.5, 0, -1); v3(P.kp[0], .1, 0, 1); v3(P.kp[1], -.1, 0, 1);
}
/** 네 발 기기 (천장에 붙어 있을 때도 같은 자세를 거꾸로 쓴다) */
function poseCrawl(d, moving = true) {
  const P = d.P, f = moving ? d.gait : 0, s = Math.sin(f), c = Math.cos(f), br = Math.sin(d.t * 2.1) * .015;
  v3(P.H, 0, .6 + br + .025 * Math.abs(s), -.22); v3(P.sd, 0, .32, 1);
  v3(P.hand[0], .36, .12 * Math.max(0, c), .7 + .2 * s); v3(P.hand[1], -.36, .12 * Math.max(0, -c), .7 - .2 * s);
  v3(P.foot[0], .24, .1 * Math.max(0, -c), -.56 - .18 * s); v3(P.foot[1], -.24, .1 * Math.max(0, c), -.56 + .18 * s);
  v3(P.ep[0], 1, .4, -.3); v3(P.ep[1], -1, .4, -.3); v3(P.kp[0], .3, -.2, 1); v3(P.kp[1], -.3, -.2, 1);
}
/** 매달리기: 손은 위(루트 로컬 y 2.3)를 붙잡고 몸은 늘어짐. drag: 속도에 끌리는 방향(루트 로컬) */
function poseHang(d, drag, k = 0) {
  const P = d.P, sw = Math.sin(d.t * 3.1 + d.phase) * (.04 + Math.min(.1, Math.abs(S.speed) * .005));
  v3(P.H, sw + drag.x * .25, .95 + Math.max(0, k) * .1, -.12 + drag.z * .25); v3(P.sd, sw * .5 + drag.x * .1, 1, .05);
  v3(P.hand[0], .26, 2.3, .06); v3(P.hand[1], -.26, 2.3, .06);
  v3(P.foot[0], .16 + sw * 2 + drag.x * .6, .08, -.14 + drag.z * .6); v3(P.foot[1], -.16 + sw * 1.4 + drag.x * .6, .12, -.1 + drag.z * .6);
  v3(P.ep[0], 1, 0, -.3); v3(P.ep[1], -1, 0, -.3); v3(P.kp[0], .1, 0, 1); v3(P.kp[1], -.1, 0, 1);
}
function poseClimb(d, k) {
  const P = d.P, a = Math.sin(k * Math.PI * 3), b = Math.sin(k * Math.PI * 3 + Math.PI);
  poseHang(d, ZERO, k);
  P.hand[0].y = 2.3 + .3 * Math.max(0, a); P.hand[0].z = .06 + .25 * k; P.hand[1].y = 2.3 + .3 * Math.max(0, b); P.hand[1].z = .06 + .25 * k;
  v3(P.foot[0], .17, .55 + .35 * Math.max(0, b), .28); v3(P.foot[1], -.17, .55 + .35 * Math.max(0, a), .28);
  v3(P.sd, 0, 1, .25 + .4 * k);
}
function poseStrike(d, k) {
  poseStand(d, .15); const P = d.P;
  if (k < .55) { v3(P.hand[1], -.32, 1.95, -.2); v3(P.ep[1], -1, .3, 0); v3(P.sd, 0, 1, .05); }
  else { v3(P.hand[1], -.12, .95, .85); v3(P.ep[1], -1, 0, -.2); v3(P.sd, 0, 1, .7); v3(P.H, 0, .9, .05); }
  v3(P.hand[0], .38, .6, .35);
}
function poseFlail(d) {
  const P = d.P, t = d.t * 9;
  v3(P.H, 0, 1, 0); v3(P.sd, Math.sin(t) * .2, 1, .1);
  v3(P.hand[0], .6 + Math.sin(t) * .2, 1.4 + Math.cos(t) * .3, .3); v3(P.hand[1], -.6, 1.3 + Math.sin(t * 1.3) * .3, -.2);
  v3(P.foot[0], .3, .15 + Math.sin(t * .8) * .2, .3); v3(P.foot[1], -.25, .3, -.3);
  v3(P.ep[0], 1, 0, -.3); v3(P.ep[1], -1, 0, -.3); v3(P.kp[0], .2, 0, 1); v3(P.kp[1], -.2, 0, 1);
}

/* ================= 등장 ================= */
const FR = makeFrame(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const used = new Map();                        // 이미 쓴 숨을 자리 gi → 다시 쓸 수 있게 되는 열차 위치
function setWorldPose(d, pos, up, fwd) { d.g.position.copy(pos); _x.crossVectors(up, fwd).normalize(); d.g.quaternion.setFromRotationMatrix(_m.makeBasis(_x, up, fwd)); }
function spawnAt(d, a) {
  Object.assign(d, { alive: true, a, hp: CFG.hp, t: 0, st: 0, flash: 0, heading: 0, level: 'floor', cool: 0, grip: 1, stagger: 0, gait: 0, freeze: 0, snapT: 0, eyeOn: false, eyeT: 0, knockT: 0, side: a.side, phase: Math.random() * 9, swung: false });
  d.targetX = -.5 - Math.random() * (TRAIN_BACK - 1.5); d.wake = 34 + Math.random() * 46;
  frameAt(a.s, FR); trackPos(a.s, _p);
  if (a.type === 'door') { _p.addScaledVector(FR.R, a.side * 5.85).addScaledVector(FR.U, 1.35); _f.copy(FR.R).multiplyScalar(-a.side); setWorldPose(d, _p, FR.U, _f); d.state = 'inside'; }
  else if (a.type === 'ceil') { _p.addScaledVector(FR.U, 7.05).addScaledVector(FR.R, a.r); _f.copy(FR.T).multiplyScalar(-1); _r.copy(FR.U).multiplyScalar(-1); setWorldPose(d, _p, _r, _f); d.state = 'ceil'; }
  else { _p.addScaledVector(FR.R, a.side * 3.98).addScaledVector(FR.U, -1.0 - 2.3); _f.copy(FR.R).multiplyScalar(-a.side); setWorldPose(d, _p, FR.U, _f); d.state = 'under'; }
  d.fr = { T: FR.T.clone(), U: FR.U.clone(), R: FR.R.clone() };
  d.home = d.g.position.clone(); d.g.visible = true; d.g.scale.setScalar(1); d.mat.emissiveIntensity = 0; d.eye.material = eyeMat; d.glow.visible = false;
  d.look.set(0, 0, 1);
  used.set(a.gi, a.s + 200);
}
/** 앞쪽 숨을 자리에서 n 기를 깨운다 (실제로 덤비는 건 열차가 지나갈 때) */
export function spawnGroup(n = 1 + (Math.random() * 3 | 0)) {
  for (const [gi, until] of used) if (until < S.sTrain) used.delete(gi);
  const list = anchorsIn(S.sTrain + 60, S.sTrain + 170).filter(a => !used.has(a.gi) && (a.type !== 'door' || doorLeaves.has(a.gi)));
  for (let i = list.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  let made = 0;
  for (const a of list) { if (made >= n) break; const d = pool.find(x => !x.alive); if (!d) break; spawnAt(d, a); made++; }
  return made;
}
let nextT = CFG.firstDelay;
export function clearAndroids() { for (const d of pool) { d.alive = false; d.g.visible = false; } used.clear(); nextT = CFG.firstDelay; }

/* ================= 매 프레임 ================= */
const _pan = new THREE.Vector3(), _cr = new THREE.Vector3();
/** 방향과 거리가 들리는 소리 */
function snd(d, kind, mul = 1) {
  _pan.subVectors(d.g.position, camera.position); const dist = _pan.length(); _pan.normalize();
  _cr.setFromMatrixColumn(camera.matrixWorld, 0);
  A.droidSnd(kind, _pan.dot(_cr), Math.min(1, 7 / (dist + 4)) * mul);
}
/** targets: [{ x(통합), y, z, roof }] — 지금은 내 캐릭터만 */
export function updateAndroids(dt, authority, targets) {
  if (authority && S.dir > 0 && Math.abs(S.speed) > 1) { nextT -= dt; if (nextT <= 0) nextT = spawnGroup() ? CFG.gapMin + Math.random() * (CFG.gapMax - CFG.gapMin) : 4; }
  for (const d of pool) if (d.alive) step(d, dt, targets);
}
const HIDDEN = ['inside', 'knock', 'burst', 'lurk', 'ceil', 'under'];
const _drag = new THREE.Vector3(), _w2 = new THREE.Vector3(), _hd = new THREE.Vector3(0, 1.65, .1);
function step(d, dt, targets) {
  d.t += dt; d.st += dt; d.cool -= dt; d.stagger -= dt; d.flash = Math.max(0, d.flash - dt * 5); d.mat.emissiveIntensity = d.flash * .8;
  const speed = Math.abs(S.speed), X = d.a.s - S.sTrain;
  // 눈: 열차가 가까워지면 깜빡이며 켜짐
  if (!d.eyeOn && X < d.wake && d.state !== 'inside' && d.state !== 'knock') { d.eyeOn = true; d.eyeT = .5; snd(d, 'wake', .9); }
  if (d.eyeOn) { d.eyeT -= dt; const on = d.eyeT <= 0 || Math.sin(d.eyeT * 60) > 0; d.eye.material = on ? eyeOnMat : eyeMat; d.glow.visible = on && d.eyeT < 50; }
  if (HIDDEN.includes(d.state) && (X < -TRAIN_BACK - 45 || X > 260)) { d.alive = false; d.g.visible = false; return; }
  // 가끔 모든 동작이 잠깐 멈춤 (기계적인 끊김)
  d.freeze -= dt; if (d.freeze <= 0 && Math.random() < dt * .6 && !['fall', 'leap', 'drop', 'burst'].includes(d.state)) d.freeze = .12 + Math.random() * .25;
  const frozen = d.freeze > 0;

  switch (d.state) {
    case 'inside': { if (X < d.wake) { d.state = 'knock'; d.st = 0; } poseStand(d, .05); break; }
    case 'knock': {                                          // 문을 두드림: 문짝이 덜컹이고 쿵 소리
      const door = doorLeaves.get(d.a.gi); d.knockT -= dt;
      if (d.knockT <= 0) { d.knockT = .38 + Math.random() * .25; snd(d, 'knock', 1.3); if (door) door.kick = .12; }
      if (door) { door.kick = Math.max(0, (door.kick || 0) - dt); door.pivot.userData.leaf.rotation.y = d.side * Math.abs(Math.sin(door.kick * 40)) * .06;
        door.pivot.userData.lamp.material.color.setRGB(Math.sin(d.t * 14) > 0 ? 1 : .25, .12, .08); }       // 문 위 경고등이 깜빡임
      poseStand(d); d.P.hand[1].set(-.25, 1.3, .3 + Math.max(0, Math.sin(d.t * 16)) * .3);
      if (d.st > 1.3 && X < 17) { d.state = 'burst'; d.st = 0; snd(d, 'door', 1.4); d.eyeOn = true; d.eyeT = 0; }
      break;
    }
    case 'burst': {                                          // 문짝을 박차고 보행로로 나옴
      const door = doorLeaves.get(d.a.gi), k = Math.min(1, d.st / .7);
      if (door) { door.pivot.userData.leaf.rotation.y = d.side * 1.45 * Math.min(1, d.st / .22); door.pivot.userData.lamp.material.color.setRGB(1, .12, .08); }
      d.g.position.copy(d.home).addScaledVector(d.fr.R, -d.side * 1.15 * k);
      d.gait += dt * 9; poseWalk(d); if (k >= 1) { d.state = 'lurk'; d.st = 0; snd(d, 'servo'); }
      break;
    }
    case 'lurk': {                                           // 발판 끝에 웅크려 열차를 지켜봄
      poseStand(d, .55); d.P.hand[0].set(.3, .9, .5); d.P.hand[1].set(-.32, .5, .3);
      if (X <= d.targetX && X > -TRAIN_BACK) { if (speed <= CFG.latchMaxSpeed) startLeap(d, .42, 1.2); else d.targetX = -999; }
      break;
    }
    case 'ceil': { poseCrawl(d, false); if (X <= d.targetX && X > -TRAIN_BACK) startDrop(d); break; }
    case 'under': {
      poseHang(d, ZERO);
      if (X <= d.targetX && X > -TRAIN_BACK) { if (speed <= CFG.latchMaxSpeed) startLeap(d, .5, .6); else d.targetX = -999; }
      break;
    }
    case 'leap': {
      const k = Math.min(1, d.st / d.dur); trainToWorld(d.to, _p);
      d.w.lerpVectors(d.from, _p, k).addScaledVector(d.fr.U, Math.sin(k * Math.PI) * d.arc); d.g.position.copy(d.w);
      const car = carForTrainX(d.to.x); d.g.quaternion.copy(car.g.quaternion).multiply(_q.setFromAxisAngle(UPV, d.side > 0 ? Math.PI : 0));
      poseHang(d, ZERO); d.P.foot[0].z += .3; d.P.foot[1].z += .3; d.P.H.y -= .2 * Math.sin(k * Math.PI);
      if (k >= 1) { d.state = 'hang'; d.st = 0; d.grip = 1; d.tp.copy(d.to); snd(d, 'grip', 1.2); S.shake = Math.max(S.shake, .06); }
      break;
    }
    case 'drop': {
      const k = Math.min(1, d.st / d.dur), car = carForTrainX(d.to.x);
      d.tp.lerpVectors(d.from, d.to, k); d.tp.y = d.from.y + (d.to.y - d.from.y) * k * k;
      trainToWorld(d.tp, d.w); d.g.position.copy(d.w);
      d.g.quaternion.copy(car.g.quaternion).multiply(_q2.slerpQuaternions(d.q0, _q.setFromAxisAngle(UPV, d.heading), Math.min(1, k * 1.8)));
      poseFlail(d);
      if (k >= 1) { d.state = 'land'; d.st = 0; snd(d, 'land', 1.4); S.shake = Math.max(S.shake, .14); }
      break;
    }
    case 'land': { place(d, d.heading); poseCrawl(d, false); d.P.H.y -= .2 * Math.max(0, 1 - d.st * 2); if (d.st > .55) { d.state = 'walk'; d.st = 0; } break; }
    case 'hang': {
      const hq = d.side > 0 ? Math.PI : 0; place(d, hq);
      _drag.set(-1, 0, 0).applyQuaternion(_q.setFromAxisAngle(UPV, hq).invert()).multiplyScalar(Math.min(1, speed / 25));
      poseHang(d, _drag);
      if (speed > CFG.shakeSpeed) { d.grip -= dt * (.18 + (speed - CFG.shakeSpeed) * .035); if (Math.random() < dt * 3) snd(d, 'scrape', .7); if (d.grip <= 0) toFall(d, 1); }
      else if (d.st > CFG.climb) {
        const car = carForTrainX(d.tp.x); d.from.copy(d.tp);
        if (car === powerCar) { d.level = 'floor'; d.to.set(d.tp.x, F, d.side * 1.2); } else { d.level = 'roof'; d.to.set(d.tp.x, ROOF_Y, d.side * 1.15); }
        d.state = 'climb'; d.st = 0; snd(d, 'scrape');
      }
      break;
    }
    case 'climb': {
      const dur = d.level === 'roof' ? 1.7 : 1.1, k = Math.min(1, d.st / dur);
      d.tp.x = d.from.x; d.tp.y = d.from.y + (d.to.y - d.from.y) * Math.min(1, k * 1.25); d.tp.z = d.from.z + (d.to.z - d.from.z) * Math.max(0, (k - .55) / .45);
      place(d, d.side > 0 ? Math.PI : 0); poseClimb(d, k);
      if (k >= 1) { d.state = 'walk'; d.st = 0; d.heading = d.side > 0 ? Math.PI : 0; snd(d, 'servo'); }
      break;
    }
    case 'walk': case 'windup': stepWalk(d, dt, targets, frozen); break;
    case 'fall': {
      d.v.y -= 14 * dt; d.w.addScaledVector(d.v, dt); d.g.position.copy(d.w);
      d.g.rotateX(dt * 4.5); d.g.rotateZ(dt * 2.1); poseFlail(d);
      if (d.st > d.life) { d.alive = false; d.g.visible = false; return; }
      break;
    }
  }
  // 고개: 사람(지금은 카메라) 쪽으로 홱홱 끊어 돌림
  d.snapT -= dt;
  if (d.snapT <= 0 && !frozen && d.state !== 'fall') {
    d.snapT = .08 + Math.random() * .3; d.g.updateMatrixWorld();
    _w2.copy(camera.position); d.g.worldToLocal(_w2).sub(_hd).normalize();
    if (d.state === 'ceil' || d.state === 'under') _w2.y = Math.max(_w2.y, .2);
    if (_w2.z < -.3) _w2.z = -.3; d.look.copy(_w2.normalize());
  }
  if (!frozen || d.state === 'fall') applyRig(d); else d.g.updateMatrixWorld();
}
function place(d, heading) { const car = trainToWorld(d.tp, d.w); d.g.position.copy(d.w); d.g.quaternion.copy(car.g.quaternion).multiply(_q.setFromAxisAngle(UPV, heading)); }

/** 숨을 자리 → 지나가는 객차 옆면으로 */
function startLeap(d, dur, arc) {
  const X = d.a.s - S.sTrain, car = carForTrainX(X), lx = Math.max(car.x0 + .6, Math.min(car.x1 - .6, X + car.off));
  d.from.copy(d.g.position); d.to.set(lx - car.off, F + .95 - 2.3, d.side * (HALF_W + .2));
  d.state = 'leap'; d.st = 0; d.dur = dur; d.arc = arc; snd(d, 'servo', 1.3);
}
/** 천장 → 열차 지붕(또는 열린 동력차 바닥)으로 */
function startDrop(d) {
  const X = d.a.s - S.sTrain, car = carForTrainX(X);
  if (Math.abs(S.speed) > CFG.latchMaxSpeed + 4) {          // 너무 빠르면 떨어져도 열차를 놓침
    d.w.copy(d.g.position); d.v.copy(d.fr.U).multiplyScalar(-2); d.life = 2; d.state = 'fall'; d.st = 0; snd(d, 'servo'); return;
  }
  _p.copy(d.g.position).applyMatrix4(car.inv);
  let lx = Math.max(car.x0 + .7, Math.min(car.x1 - .7, _p.x)); if (car === driveCar) lx = Math.min(lx, 1.7);
  d.from.set(_p.x - car.off, _p.y, _p.z); d.to.set(lx - car.off, car === powerCar ? F : ROOF_Y, Math.max(-1.2, Math.min(1.2, _p.z)));
  d.level = car === powerCar ? 'floor' : 'roof';
  d.q0.copy(car.g.quaternion).invert().multiply(d.g.quaternion);
  d.heading = Math.random() < .5 ? Math.PI / 2 : -Math.PI / 2;
  d.state = 'drop'; d.st = 0; d.dur = .55; snd(d, 'servo', 1.3);
}

function stepWalk(d, dt, targets, frozen) {
  let tg = null, bd = 1e9;
  for (const T of targets) { if (!!T.roof !== (d.level === 'roof')) continue; const dd = Math.abs(T.x - d.tp.x) + Math.abs(T.z - d.tp.z) * .5; if (dd < bd) { bd = dd; tg = T; } }
  let gx = d.tp.x, gz = 0, moved = 0;
  if (tg) { gx = tg.x; gz = Math.abs(tg.x - d.tp.x) < 1.6 ? tg.z : 0; }
  else if (d.level === 'roof') gx = -CAB_BACK - 1.2;                      // 지붕에 아무도 없으면 뒤로 가서 동력차로 내려감
  const car = carForTrainX(d.tp.x), lx = d.tp.x + car.off, nearEnd = d.level === 'floor' && (lx > car.x1 - .7 || lx < car.x0 + .7);
  if (nearEnd) gz = 0;
  const dx = gx - d.tp.x, dz = gz - d.tp.z, dist = tg ? Math.hypot(tg.x - d.tp.x, tg.z - d.tp.z) : 99;
  const roof = d.level === 'roof', spd = CFG.walk * (roof ? 1.15 : 1);
  if (d.state === 'walk' && d.stagger <= 0 && !frozen) {
    const stp = spd * dt, blockX = nearEnd && Math.abs(d.tp.z) > .35;
    if (Math.abs(dz) > .05) { const m = Math.sign(dz) * Math.min(Math.abs(dz), stp); d.tp.z += m; moved += Math.abs(m); }
    if (!blockX && Math.abs(dx) > (tg ? .9 : .1)) { const m = Math.sign(dx) * Math.min(Math.abs(dx), stp); d.tp.x += m; moved += Math.abs(m); }
    if (Math.hypot(dx, dz) > .1) { const want = Math.atan2(dx, dz + 1e-4); let dh = want - d.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); d.heading += Math.sign(dh) * Math.min(Math.abs(dh), dt * 5); }
    if (roof && d.tp.x < -CAB_BACK - .6) { d.level = 'floor'; d.tp.set(-CAB_BACK - 1.6, F, 0); }
    if (tg && dist < (roof ? 1.5 : 1.3) && d.cool <= 0) { d.state = 'windup'; d.st = 0; d.swung = false; snd(d, 'servo', 1.2); }
  }
  d.gait += moved / (roof ? .45 : .55) * Math.PI;
  if (d.state === 'windup') {
    if (roof) { poseCrawl(d, false); d.P.hand[1].set(-.3, .9 - (d.st > .45 ? .8 : 0), .9); d.P.H.y += d.st > .45 ? -.1 : .15; }
    else poseStrike(d, d.st / .8);
    if (d.st > .45 && !d.swung) { d.swung = true; if (tg && dist < 1.8) { trainToWorld(d.tp, _p); H.hurt?.(CFG.hit, _p); } }
    if (d.st > .8) { d.cool = CFG.hitCool; d.state = 'walk'; d.st = 0; }
  } else if (roof) poseCrawl(d, moved > 0); else if (moved > 0) poseWalk(d); else poseStand(d, .2);
  if (d.stagger > 0) { d.P.sd.set(0, 1, -.35); d.P.hand[0].set(.55, 1.1, -.2); d.P.hand[1].set(-.55, 1.1, -.2); }
  if (d.tp.y < F - .1) d.tp.y = F;
  place(d, d.heading);
}
/** 열차에서 떨어져 나감: 뒤로 밀려나며 추락 */
function toFall(d, life) {
  frameAt(S.sTrain, FR);
  d.v.copy(FR.T).multiplyScalar(-Math.min(12, Math.abs(S.speed) * .5) - 1).addScaledVector(FR.R, d.side * 2.5).addScaledVector(FR.U, 1.5);
  d.w.copy(d.g.position); d.life = life + 1.2; d.state = 'fall'; d.st = 0; snd(d, 'scrape', 1.2);
}

/* ================= 공격받기 ================= */
const _o = new THREE.Vector3();
/** 광선에 맞는 안드로이드 (머리·몸통·골반 구) */
export function rayAndroid(origin, dir, maxDist) {
  let best = null, bt = maxDist, head = false;
  for (const d of pool) {
    if (!d.alive || d.state === 'fall' || d.state === 'inside' || d.state === 'knock') continue;
    for (const [p, r, isHead] of [[d.hitH, .2, true], [d.hitT, .32, false], [d.hitP, .24, false]]) {
      _o.copy(p).sub(origin); const t = _o.dot(dir);
      if (t < 0 || t > bt || _o.lengthSq() - t * t > r * r) continue;
      bt = t; best = d; head = isHead;
    }
  }
  return best ? { droid: best, dist: bt, head, point: origin.clone().addScaledVector(dir, bt) } : null;
}
/** 피해. 부서졌으면 true */
export function damageAndroid(d, dmg) {
  if (!d.alive) return false;
  d.hp -= dmg; d.flash = 1; d.stagger = Math.max(d.stagger, .3); d.freeze = 0;
  if (d.hp > 0) { A.hitSnd(false); return false; }
  A.hitSnd(true); H.reward?.(d.hitT.clone());
  d.eye.material = eyeMat; d.glow.visible = false; d.eyeOn = true; d.eyeT = 99;
  if (HIDDEN.includes(d.state)) { d.w.copy(d.g.position); d.v.copy(d.fr.R).multiplyScalar(-d.side * .5).addScaledVector(d.fr.U, 1); d.life = 1.5; d.state = 'fall'; d.st = 0; }
  else toFall(d, .6);
  return true;
}
/** 발차기: 눈앞의 안드로이드를 떨어뜨리거나 밀어냄. 맞았으면 true */
export function kickAndroid(origin, dir, range) {
  let hit = null, bd = range;
  for (const d of pool) {
    if (!d.alive || !['hang', 'climb', 'walk', 'windup', 'land', 'leap'].includes(d.state)) continue;
    _o.copy(d.hitT).sub(origin);
    const dist = _o.length(); if (dist > bd + (d.state === 'hang' ? 1.1 : 0) || _o.dot(dir) / Math.max(dist, .01) < .3) continue;
    bd = dist; hit = d;
  }
  if (!hit) return false;
  hit.flash = 1; hit.freeze = 0;
  if (hit.state === 'hang' || hit.state === 'leap' || hit.state === 'climb') toFall(hit, 1);
  else {
    _o.copy(dir).applyQuaternion(_q.copy(carForTrainX(hit.tp.x).g.quaternion).invert());
    hit.tp.x += _o.x * 1.6; hit.tp.z += _o.z * 1.6; hit.stagger = 1.1; hit.state = 'walk'; hit.st = 0; hit.swung = false;
    if (Math.abs(hit.tp.z) > (hit.level === 'roof' ? 1.75 : 2.05) && (hit.level === 'roof' || carForTrainX(hit.tp.x) === powerCar)) { hit.side = Math.sign(hit.tp.z); place(hit, hit.heading); toFall(hit, 1); }
    else { hit.tp.z = Math.max(-1.5, Math.min(1.5, hit.tp.z)); damageAndroid(hit, 1); }
  }
  return true;
}
/* 시험용: 특정 숨을 자리에 바로 배치 */
export function __spawnAt(a) { const d = pool.find(x => !x.alive); if (d) spawnAt(d, a); return d; }
