// 안드로이드: 도시의 정비용 인간형 기계. 맵 곳곳에 숨어 있다가 열차가 지나가면 덤벼든다.
//
// 숨어 있는 자리 (city.anchorsIn — 시드로 정해짐)
//   door  : 터널 정비문 안. 다가오면 문을 두드리다가 문짝을 박차고 나와 보행로에 웅크린 뒤 뛰어든다
//   ceil  : 터널 천장 늑골에 거꾸로 매달림. 지붕에 떨어지거나, 옆면 지붕 가장자리를 붙잡는다
//   under : 철교·고가 상판 가장자리 아래에 매달림. 옆을 지나는 객차로 옮겨 붙는다
//
// 열차에 붙는 곳은 좌표가 아니라 '잡을 수 있는 부품'(train.GRIPS)에서 그때그때 고른다.
//   배터리 칸 난간 → 넘어 들어옴 / 운전차·객실 손잡이 봉 → 매달려 버티다 위 가장자리로 옮겨 잡음 / 지붕 가장자리 → 지붕으로
//   지붕 끝 모서리(ledge) ↔ 배터리 칸 바닥: 뛰어 잡고 올라가거나, 매달려 내려온다
// 잡은 손은 부품 위 한 점에 고정되고(차량 기준), 몸통만 속도·흔들림에 따라 진자처럼 쏠린다.
// 등반·옮겨 잡기·내려오기는 단계별 키 포즈(손 → 몸이 처짐 → 다른 손 → 골반 → 무릎 → 넘어감)로 2초 남짓.
// 좌표계를 바꿀 때(월드 → 차량, 매달린 자리 → 바닥)는 지금 자세를 새 기준으로 옮겨 담아 튀지 않게 한다(reroot).
//
// 걸음은 드로거처럼 느리고 무겁다: 발을 실제로 디디고(미끄러지지 않음), 한쪽 다리를 절며 몸이 기우뚱한다.
// 고개는 부드럽게 돌지 않고 톱니처럼 한 칸씩 끊겨 돌며(때로 뒤까지), 팔다리는 늘 미세하게 떤다.
// 예고 없이 경련하듯 굳었다가 비명을 지르며 달려들기도 한다.
import * as THREE from 'three';
import { C, prep, M, merged } from './geo.js';
import { scene, camera } from './scene.js';
import { trackPos, frameAt, makeFrame, arcScale } from './track.js';
import { anchorsIn, doorLeaves, specAt } from './city.js';
import { trainToWorld, carForTrainX, cabinCar, powerCar, driveCar, ROOF_Y, GRIPS, gripPoint, JOINTS } from './train.js';
import { ANDROID as CFG, F } from './config.js';
import { makeStairRun, sampleRun, advanceRun, poseStairRun } from './stair-run.js';
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

const TRAIN_BACK = cabinCar.off + 3.5;                       // 열차 맨 뒤 (통합 x = -TRAIN_BACK)
const DOWN = new THREE.Vector3(0, -1, 0), UPV = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1);
const rnd = (a, b) => a + Math.random() * (b - a);

class Droid {
  constructor() {
    const mat = this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const g = this.g = new THREE.Group(); g.visible = false; scene.add(g);
    const mk = geo => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); return m; };
    this.torso = mk(GEO.torso); this.pelvis = mk(GEO.pelvis); this.head = mk(GEO.head);
    this.ua = [mk(GEO.ua), mk(GEO.ua)]; this.fa = [mk(GEO.fa), mk(GEO.fa)]; this.hand = [mk(GEO.hand), mk(GEO.hand)];
    this.th = [mk(GEO.th), mk(GEO.th)]; this.sh = [mk(GEO.sh), mk(GEO.sh)]; this.foot = [mk(GEO.foot), mk(GEO.foot)];
    this.elbow = [mk(GEO.knob), mk(GEO.knob)]; this.knee = [mk(GEO.knob), mk(GEO.knob)];
    this.eye = new THREE.Mesh(GEO.eye, eyeMat); this.eye.position.set(0, .16, .11); this.head.add(this.eye);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3a2a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.glow.position.set(0, .16, .16); this.glow.scale.setScalar(.6); this.head.add(this.glow);
    const V = () => new THREE.Vector3();
    const rig = () => ({ H: V(), sd: V(0, 1, 0), look: V(0, 0, 1), hand: [V(), V()], foot: [V(), V()], ep: [V(), V()], kp: [V(), V()] });
    this.P = rig(); this.Q = rig(); this.QV = rig();          // 목표 · 현재(보간) · 속도 (루트 로컬)
    this.QV.sd.set(0, 0, 0); this.QV.look.set(0, 0, 0);
    this.J = Array.from({ length: 15 }, V); this.rp = Array.from({ length: 15 }, V); this.rq = Array.from({ length: 15 }, V);
    Object.assign(this, { blendT: 0, gait: 0, t: 0, st: 0, heading: 0, freeze: 0, stagger: 0, cool: 0, phase: 0, grip: 1, flash: 0,
      sw: 0, swv: 0, roll: 0, rollTo: 0, rT: 0, trem: .004, limp: 0, sprintCD: 8, hold: 0, bangT: 0, gr: null, mode: '' });
    this.lock = [false, false];
    this.look = V(0, 0, 1); this.lookCur = V(0, 0, 1); this.tp = V(); this.w = V(); this.v = V(); this.from = V(); this.to = V();
    this.gp = V();                                           // 잡은 점 (잡은 차량 로컬)
    this.fp = [V(), V()]; this.fs = [{ u: -1, a: V(), b: V(), dur: .5, lift: .2 }, { u: -1, a: V(), b: V(), dur: .5, lift: .2 }];   // 디딘 발 (통합 좌표)
    this.q0 = new THREE.Quaternion(); this.qFrom = new THREE.Quaternion();
    this.hitT = V(); this.hitH = V(); this.hitP = V();
    this.alive = false;
  }
}
const pool = Array.from({ length: CFG.max }, () => new Droid());
export const androidCount = () => pool.filter(d => d.alive).length;
export const __droids = pool;

/* ================= 리그 풀기 =================
 * P: 자세 함수가 정한 '목표', Q: 실제로 그리는 '현재'. Q 는 임계 감쇠 스프링으로 P 를 따라간다.
 * 잡은 손(lock)과 디딘 발은 스프링을 거치지 않고 목표 그대로 — 손발은 고정, 몸만 섞인다.
 */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _m = new THREE.Matrix4();
function ik(O, T, a, b, pole, E, Tc) {
  _a.subVectors(T, O); const L = Math.min(Math.max(_a.length(), .05), a + b - .002); _a.normalize();
  const cosA = (a * a + L * L - b * b) / (2 * a * L), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a)); if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1).addScaledVector(_a, -_a.z); _b.normalize();
  E.copy(O).addScaledVector(_a, a * cosA).addScaledVector(_b, a * sinA);
  Tc.copy(O).addScaledVector(_a, L);
}
function damp(cur, vel, target, time, dt) {
  const w = 2 / time, x = w * dt, e = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
  for (const k of ['x', 'y', 'z']) {
    const ch = cur[k] - target[k], tmp = (vel[k] + w * ch) * dt;
    vel[k] = (vel[k] - w * tmp) * e; cur[k] = target[k] + (ch + tmp) * e;
  }
}
const PAIRS = ['hand', 'foot', 'ep', 'kp'];
function smoothRig(d, dt) {
  const P = d.P, Q = d.Q, V = d.QV, b = d.blendT > 0 ? 1 + d.blendT * 6 : 1;
  d.blendT = Math.max(0, d.blendT - dt);
  const heavy = d.state === 'sprint' ? .6 : 1.25;                   // 몸이 무겁게 늦게 따라옴
  damp(Q.H, V.H, P.H, .1 * b * heavy, dt); damp(Q.sd, V.sd, P.sd, .13 * b * heavy, dt); damp(Q.look, V.look, d.look, .035, dt);
  for (let i = 0; i < 2; i++) {
    if (d.lock[i]) { Q.hand[i].copy(P.hand[i]); V.hand[i].set(0, 0, 0); } else damp(Q.hand[i], V.hand[i], P.hand[i], .09 * b, dt);
    if (d.plant) { Q.foot[i].copy(P.foot[i]); V.foot[i].set(0, 0, 0); } else damp(Q.foot[i], V.foot[i], P.foot[i], .07 * b, dt);
    damp(Q.ep[i], V.ep[i], P.ep[i], .12, dt); damp(Q.kp[i], V.kp[i], P.kp[i], .12, dt);
  }
  // 떨림: 손끝·머리·골반이 늘 미세하게 떨림 (잡은 손은 거의 안 떨림)
  const a = d.trem;
  for (let i = 0; i < 2; i++) { const k = d.lock[i] ? .15 : 1; Q.hand[i].x += (Math.random() - .5) * a * k; Q.hand[i].y += (Math.random() - .5) * a * k; Q.hand[i].z += (Math.random() - .5) * a * k; }
  Q.H.x += (Math.random() - .5) * a * .35; Q.H.y += (Math.random() - .5) * a * .25;
  Q.look.x += (Math.random() - .5) * a * .6; Q.look.y += (Math.random() - .5) * a * .6;
}
function snapRig(d) {
  const P = d.P, Q = d.Q, V = d.QV;
  Q.H.copy(P.H); Q.sd.copy(P.sd); Q.look.copy(d.look); V.H.set(0, 0, 0); V.sd.set(0, 0, 0); V.look.set(0, 0, 0);
  for (const k of PAIRS) for (let i = 0; i < 2; i++) { Q[k][i].copy(P[k][i]); V[k][i].set(0, 0, 0); }
}
function impulse(d, v, arms = .6) { d.QV.H.add(v); d.QV.sd.addScaledVector(v, 1.6); for (let i = 0; i < 2; i++) if (!d.lock[i]) d.QV.hand[i].addScaledVector(v, arms * 1.4); }
function setState(d, s) { if (d.state !== s) { d.state = s; d.st = 0; d.blendT = .22; } }

/* ---------- 루트 좌표 ↔ 열차 통합 좌표 ----------
 * 열차에 붙은 뒤 루트(몸의 기준점)는 통합 좌표 tp 와 방향 heading 으로 정한다. 루트 로컬 +z 가 앞. */
function toRoot(d, tx, ty, tz, out) { const c = Math.cos(d.heading), s = Math.sin(d.heading), vx = tx - d.tp.x, vz = tz - d.tp.z; return out.set(vx * c - vz * s, ty - d.tp.y, vx * s + vz * c); }
function fromRoot(d, L, out) { const c = Math.cos(d.heading), s = Math.sin(d.heading); return out.set(d.tp.x + L.x * c + L.z * s, d.tp.y + L.y, d.tp.z - L.x * s + L.z * c); }
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a), x = v.x; v.x = x * c + v.z * s; v.z = -x * s + v.z * c; return v; };
const _rr = new THREE.Vector3();
/** 루트를 옮겨도 지금 자세가 그대로 보이게: 자세(목표·현재)를 새 루트 기준으로 다시 담는다 */
function reroot(d, ntp, nh) {
  const pts = [], dirs = [];
  for (const R of [d.P, d.Q]) { pts.push(R.H, ...R.hand, ...R.foot); dirs.push(R.sd, ...R.ep, ...R.kp); }
  dirs.push(d.Q.look, d.look, d.lookCur, d.QV.H, d.QV.sd, ...d.QV.hand, ...d.QV.foot);
  const keep = pts.map(p => fromRoot(d, p, new THREE.Vector3()));
  const dh = nh - d.heading; d.tp.copy(ntp); d.heading = nh;
  pts.forEach((p, i) => toRoot(d, keep[i].x, keep[i].y, keep[i].z, p));
  for (const v of dirs) rotY(v, -dh);
}

function seg(mesh, A, B) { mesh.position.copy(A); _c.subVectors(B, A).normalize(); mesh.quaternion.setFromUnitVectors(DOWN, _c); }
const _sh = new THREE.Vector3(), _hp = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3(), _ch = new THREE.Vector3(), _nk = new THREE.Vector3(), _bx = new THREE.Vector3(), _hx = new THREE.Vector3();
/* 관절 번호 (랙돌과 공유): 0 골반 1 가슴 2 머리 3·4·5 왼어깨·팔꿈치·손 6·7·8 오른쪽 9·10·11 왼엉덩이·무릎·발 12·13·14 오른쪽 */
function applyRig(d) {
  const Q = d.Q, J = d.J, sd = _y.copy(Q.sd).normalize();
  _ch.copy(Q.H).addScaledVector(sd, LEN.spine);
  _bx.crossVectors(sd, FWD); if (_bx.lengthSq() < 1e-4) _bx.set(1, 0, 0); _bx.normalize();
  d.torso.position.copy(Q.H); d.torso.quaternion.setFromUnitVectors(UPV, sd);
  d.pelvis.position.copy(Q.H); d.pelvis.quaternion.copy(d.torso.quaternion);
  _nk.copy(_ch).addScaledVector(sd, .07);
  _t.copy(Q.look).normalize(); _x.crossVectors(sd, _t); if (_x.lengthSq() < 1e-4) _x.copy(_bx); _x.normalize(); _c.crossVectors(_t, _x);
  // 고개 꺾임 (얼굴 축으로 비틀림)
  const cr = Math.cos(d.roll), sr = Math.sin(d.roll); _hx.copy(_x).multiplyScalar(cr).addScaledVector(_c, sr); _c.multiplyScalar(cr).addScaledVector(_x, -sr);
  d.head.position.copy(_nk); d.head.quaternion.setFromRotationMatrix(_m.makeBasis(_hx, _c, _t));
  J[0].copy(Q.H); J[1].copy(_ch); J[2].copy(_nk).addScaledVector(sd, .2);
  for (let i = 0; i < 2; i++) {
    const s = i ? -1 : 1, o = i * 3;
    _sh.copy(_ch).addScaledVector(_bx, .24 * s).addScaledVector(sd, -.06);
    ik(_sh, Q.hand[i], LEN.ua, LEN.fa, Q.ep[i], _E, _T);
    seg(d.ua[i], _sh, _E); seg(d.fa[i], _E, _T); d.elbow[i].position.copy(_E);
    d.hand[i].position.copy(_T); d.hand[i].quaternion.copy(d.fa[i].quaternion);
    J[3 + o].copy(_sh); J[4 + o].copy(_E); J[5 + o].copy(_T);
    _hp.copy(Q.H).addScaledVector(_bx, .13 * s).addScaledVector(sd, -.05);
    ik(_hp, Q.foot[i], LEN.th, LEN.sh, Q.kp[i], _E, _T);
    seg(d.th[i], _hp, _E); seg(d.sh[i], _E, _T); d.knee[i].position.copy(_E);
    d.foot[i].position.copy(_T); d.foot[i].quaternion.identity();
    J[9 + o].copy(_hp); J[10 + o].copy(_E); J[11 + o].copy(_T);
  }
  d.g.updateMatrixWorld();
  d.hitP.copy(Q.H).applyMatrix4(d.g.matrixWorld);
  d.hitT.copy(Q.H).addScaledVector(sd, .35).applyMatrix4(d.g.matrixWorld);
  d.hitH.copy(_nk).addScaledVector(sd, .13).applyMatrix4(d.g.matrixWorld);
}

/* ================= 간이 랙돌 (떨어지거나 부서질 때) =================
 * 관절 15개를 점으로, 뼈를 거리 제약으로 묶은 베를레 시뮬레이션. 열차 지붕·바닥과 선로 바닥에 닿으면 멈춘다.
 */
const BONES = [[0, 1, .6], [1, 2, .27], [1, 3, 0], [1, 6, 0], [3, 6, 0], [3, 4, LEN.ua], [4, 5, LEN.fa], [6, 7, LEN.ua], [7, 8, LEN.fa],
  [0, 9, 0], [0, 12, 0], [9, 12, 0], [9, 10, LEN.th], [10, 11, LEN.sh], [12, 13, LEN.th], [13, 14, LEN.sh], [3, 9, 0], [6, 12, 0], [3, 12, 0], [6, 9, 0], [2, 3, 0], [2, 6, 0]];
const RFR = makeFrame(), _rl = new THREE.Vector3(), _rv = new THREE.Vector3(), _rt = new THREE.Vector3(), _vT = new THREE.Vector3();
function startRag(d, vel, life) {
  d.g.updateMatrixWorld();
  for (let i = 0; i < 15; i++) {
    d.rp[i].copy(d.J[i]).applyMatrix4(d.g.matrixWorld);
    _rv.copy(vel).add(_rt.set(Math.random() - .5, Math.random() - .3, Math.random() - .5).multiplyScalar(1.6));
    d.rq[i].copy(d.rp[i]).addScaledVector(_rv, -1 / 60);
  }
  d.rlen = BONES.map(([a, b, L]) => L || d.rp[a].distanceTo(d.rp[b]));
  d.state = 'rag'; d.st = 0; d.life = life; d.racc = 0;
  d.g.position.set(0, 0, 0); d.g.quaternion.identity(); d.g.updateMatrixWorld(); d.glow.visible = d.glow.visible && d.hp > 0;
}
const SURF = () => [[powerCar, F, 2.05], [cabinCar, ROOF_Y, 1.8], [driveCar, ROOF_Y, 1.8]];
function stepRag(d, dt) {
  d.racc = Math.min(.1, d.racc + dt); const h = 1 / 60;
  frameAt(S.sTrain, RFR); _vT.copy(RFR.T).multiplyScalar(S.speed * h);
  while (d.racc >= h) {
    d.racc -= h;
    for (let i = 0; i < 15; i++) { const p = d.rp[i], q = d.rq[i]; _rv.subVectors(p, q).multiplyScalar(.995); q.copy(p); p.add(_rv); p.y -= 14 * h * h; }
    for (let it = 0; it < 4; it++) for (let k = 0; k < BONES.length; k++) {
      const [a, b] = BONES[k], pa = d.rp[a], pb = d.rp[b]; _rv.subVectors(pb, pa); const L = _rv.length() || 1e-4, diff = (L - d.rlen[k]) / L * .5;
      pa.addScaledVector(_rv, diff); pb.addScaledVector(_rv, -diff);
    }
    for (let i = 0; i < 15; i++) collideRag(d.rp[i], d.rq[i], d.wheelRisk);
    if (d.wheelRisk && S.speed > 1) {
      for (const car of [driveCar, powerCar, cabinCar]) {
        // Wheels can catch a knee or shoulder before the pelvis reaches the rail.
        const hit = [0, 2, 4, 7, 10, 13].find(j => {
          _rl.copy(d.rp[j]).applyMatrix4(car.inv);
          return Math.abs(_rl.x) < car.x1 + .7 && car.wheels.some(w =>
            Math.abs(_rl.z - w.position.z) < .32 &&
            Math.hypot(_rl.x - w.position.x, _rl.y - w.position.y) < .67);
        });
        if (hit === undefined) continue;
        H.wheelImpact?.(d.rp[hit]); snd(d, 'scrape', 1.5); snd(d, 'land', 1.25);
        d.wheelRisk = false; d.life = Math.min(d.life, d.st + .16);
        break;
      }
    }
  }
  // 그리기 (월드 좌표 = 루트 좌표)
  const R = d.rp;
  _y.subVectors(R[1], R[0]).normalize(); _x.subVectors(R[3], R[6]); _x.addScaledVector(_y, -_x.dot(_y)).normalize(); _t.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _t); d.torso.position.copy(R[0]); d.torso.quaternion.setFromRotationMatrix(_m); d.pelvis.position.copy(R[0]); d.pelvis.quaternion.copy(d.torso.quaternion);
  _c.subVectors(R[2], R[1]).normalize(); _t.crossVectors(_x, _c); d.head.position.copy(R[1]).addScaledVector(_c, .07); d.head.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _c, _t));
  for (let i = 0; i < 2; i++) {
    const o = i * 3;
    seg(d.ua[i], R[3 + o], R[4 + o]); seg(d.fa[i], R[4 + o], R[5 + o]); d.elbow[i].position.copy(R[4 + o]); d.hand[i].position.copy(R[5 + o]); d.hand[i].quaternion.copy(d.fa[i].quaternion);
    seg(d.th[i], R[9 + o], R[10 + o]); seg(d.sh[i], R[10 + o], R[11 + o]); d.knee[i].position.copy(R[10 + o]); d.foot[i].position.copy(R[11 + o]); d.foot[i].quaternion.copy(d.sh[i].quaternion);
  }
  if (d.st > d.life || d.rp[0].distanceTo(camera.position) > 160) { d.alive = false; d.g.visible = false; }
}
function collideRag(p, q, underCar) {
  // 열차 지붕·동력차 바닥: 닿으면 열차와 같이 움직임
  for (const [car, ys, hz] of SURF()) {
    _rl.copy(p).applyMatrix4(car.inv);
    if (_rl.x < car.x0 || _rl.x > car.x1 || Math.abs(_rl.z) > hz || _rl.y > ys + .02 || _rl.y < ys - .5) continue;
    if (underCar && _rt.copy(q).applyMatrix4(car.inv).y < ys) continue;
    _rl.y = ys + .02; p.copy(_rl.applyMatrix4(car.g.matrixWorld));
    _rv.subVectors(p, q); q.copy(p).sub(_rv.lerp(_vT, .35)); return;
  }
  // 선로 바닥 (상판 폭 안쪽)
  _rl.copy(p).applyMatrix4(driveCar.inv); const s = S.sTrain + _rl.x;
  trackPos(s, _rt); frameAt(s, RFR); _rv.subVectors(p, _rt);
  const lat = _rv.dot(RFR.R), up = _rv.dot(RFR.U);
  if (Math.abs(lat) < (specAt(s).tunnel ? 6 : 2.0) && up < .22 && up > -1.5) { p.addScaledVector(RFR.U, .22 - up);
    _rv.subVectors(p, q).multiplyScalar(.6);
    if (underCar) _rv.addScaledVector(RFR.U, -_rv.dot(RFR.U));
    q.copy(p).sub(_rv); }
}

/* ================= 키 포즈 타임라인 =================
 * keys: [[시간(0~1), x, y, z, 이징], ...]  이징: 'o' 빠르게 시작해 감속, 'i' 천천히 시작해 가속, 그 외 부드럽게
 */
const EASE = { o: u => 1 - (1 - u) * (1 - u), i: u => u * u * u, s: u => u * u * (3 - 2 * u) };
function kf(out, keys, t) {
  if (t <= keys[0][0]) return out.set(keys[0][1], keys[0][2], keys[0][3]);
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]; if (t > k[0]) continue;
    const p = keys[i - 1], u = (EASE[k[4]] || EASE.s)((t - p[0]) / (k[0] - p[0]));
    return out.set(p[1] + (k[1] - p[1]) * u, p[2] + (k[2] - p[2]) * u, p[3] + (k[3] - p[3]) * u);
  }
  const l = keys[keys.length - 1]; return out.set(l[1], l[2], l[3]);
}

/* ---------- 키 포즈 묶음 ----------
 * 채널: H 골반, sd 척추 방향, R·L 손(오른 = hand[1], 왼 = hand[0]), F0·F1 발. 좌표는 루트 로컬. */
function playKeys(d, K, k) {
  kf(d.P.H, K.H, k); kf(d.P.sd, K.sd, k);
  if (K.R) kf(d.P.hand[1], K.R, k); if (K.L) kf(d.P.hand[0], K.L, k);
  if (K.F0) kf(d.P.foot[0], K.F0, k); if (K.F1) kf(d.P.foot[1], K.F1, k);
}
/* 서서 내려치기 — 크고 느린 예비 동작: 팔을 머리 위로 치켜든 채 덜덜 떨며 멈칫 → 한 번에 내리찍음 → 앞으로 쏠림 → 천천히 회복 */
const STRIKE = {
  dur: 1.75, hit: .64, hold: [.38, .6],
  H: [[0, 0, .93, 0], [.38, 0, .87, -.2, 'o'], [.6, 0, .85, -.22], [.66, 0, .76, .3, 'i'], [.78, 0, .72, .34, 'o'], [1, 0, .93, 0]],
  sd: [[0, 0, 1, .45], [.38, -.2, 1, -.35, 'o'], [.6, -.22, 1, -.4], [.66, .05, 1, 1.15, 'i'], [.78, .05, 1, 1.05, 'o'], [1, 0, 1, .5]],
  R: [[0, -.32, .28, .18], [.38, -.44, 2.2, -.5, 'o'], [.6, -.46, 2.25, -.55], [.66, -.04, .9, 1.1, 'i'], [.78, .02, .35, .85, 'o'], [1, -.32, .28, .18]],
  L: [[0, .32, .28, .18], [.38, .55, 1.0, .55, 'o'], [.6, .58, 1.05, .6], [.66, .34, .45, -.2, 'i'], [1, .32, .28, .18]],
};
/* 지붕 위 덮치기: 뒤로 몸을 사리고 두 팔을 치켜든 채 떨다가 → 앞으로 튀어 두 팔로 내리찍음 */
const POUNCE = {
  dur: 1.6, hit: .62, hold: [.35, .56],
  H: [[0, 0, .6, -.22], [.35, 0, .5, -.55, 'o'], [.56, 0, .52, -.6], [.62, 0, .78, .4, 'i'], [.78, 0, .52, .2, 'o'], [1, 0, .6, -.22]],
  sd: [[0, 0, .35, 1], [.35, 0, 1, .15, 'o'], [.56, 0, 1, .05], [.62, 0, .05, 1, 'i'], [1, 0, .35, 1]],
  R: [[0, -.36, 0, .7], [.35, -.5, 1.55, -.1, 'o'], [.56, -.52, 1.6, -.15], [.62, -.22, .1, 1.35, 'i'], [.78, -.3, 0, 1.0, 'o'], [1, -.36, 0, .7]],
  L: [[0, .36, 0, .7], [.37, .5, 1.5, -.05, 'o'], [.57, .52, 1.55, -.1], [.64, .22, .1, 1.3, 'i'], [.8, .3, 0, 1.0, 'o'], [1, .36, 0, .7]],
};
/* 넘어 올라가기 (잡은 점 기준): 오른손이 먼저 안쪽을 짚음 → 몸이 축 처짐 → 왼손 → 골반이 올라옴 → 무릎이 걸쳐 넘어옴 → 웅크려 착지.
 * deck: 넘어간 바닥의 높이(잡은 점 기준) */
function makeClimb(deck, dur, over = 0) {
  const D = deck, top = Math.max(.12, D + .12, over + .12), hy = over + .02;
  return { dur,
    R: [[0, -.24, 0, 0], [.12, -.24, 0, 0], [.22, -.32, .34, .22, 'o'], [.3, -.26, hy, .42, 'i'], [.66, -.26, hy, .42], [.82, -.3, D + .4, .85], [1, -.34, D + .35, .95]],
    L: [[0, .24, 0, 0], [.36, .24, 0, 0], [.46, .36, .32, .2, 'o'], [.54, .28, hy, .46, 'i'], [.74, .28, hy, .46], [.9, .32, D + .4, .85], [1, .34, D + .35, .95]],
    H: [[0, 0, -1.2, -.3], [.18, .06, -1.48, -.4, 'o'], [.32, 0, -1.26, -.3], [.58, -.05, -.45, -.14, 'i'], [.72, 0, top, .05], [.86, 0, Math.max(top, D + .45), .4], [1, 0, D + .6, .75]],
    sd: [[0, 0, 1, .12], [.18, .1, 1, -.05, 'o'], [.32, 0, 1, .2], [.58, 0, .55, .9, 'i'], [.75, 0, .22, 1], [.9, 0, .5, 1], [1, 0, .85, .6]],
    F1: [[0, -.15, -2.15, -.25], [.3, -.15, -2.05, -.2], [.46, -.2, -1.25, -.04, 'o'], [.6, -.22, hy + .03, 0, 'o'], [.78, -.2, Math.max(hy + .05, D + .07), .35], [1, -.2, D, .55]],
    F0: [[0, .15, -2.2, -.3], [.55, .15, -2.0, -.25], [.68, .2, -1.3, -.08], [.84, .22, Math.max(-.3, D), .1], [.94, .2, D, .3], [1, .2, D, .35]],
  };
}
/* 손잡이 봉 → 위 지붕 가장자리로 옮겨 잡기 (봉 위 점 기준, 가장자리는 위 1.29m · 바깥 .08m) */
const REACH = { dur: 1.9,
  R: [[0, 0, 0, 0], [.15, -.04, -.08, -.04], [.42, -.26, 1.48, -.16, 'o'], [.52, -.24, 1.29, -.08, 'i'], [1, -.24, 1.29, -.08]],
  L: [[0, 0, -.38, 0], [.48, 0, -.38, 0], [.58, .12, .2, -.12], [.76, .3, 1.46, -.16, 'o'], [.86, .24, 1.29, -.08, 'i'], [1, .24, 1.29, -.08]],
  H: [[0, 0, -.85, -.38], [.42, .05, -.78, -.42], [.55, 0, -.95, -.3, 'o'], [.72, 0, -.2, -.36, 'i'], [1, 0, .09, -.3]],
  sd: [[0, 0, 1, -.15], [.42, .1, 1, -.25], [.6, 0, 1, .15], [1, 0, 1, .12]],
  F0: [[0, .14, -1.72, -.06], [.55, .14, -1.72, -.06], [.7, .2, -.85, -.22, 'o'], [.86, .2, -.55, -.2], [1, .16, -.86, -.32]],
  F1: [[0, -.14, -1.72, -.06], [.66, -.14, -1.72, -.06], [.82, -.2, -1.05, -.28, 'o'], [1, -.15, -.9, -.3]],
};
/* 배터리 칸 바닥에서 지붕 끝 모서리로 뛰어 잡기 (모서리 기준, 바닥은 아래 fl) */
function makeJump(fl) {
  return { dur: 1.25,
    H: [[0, 0, fl + .95, -.72], [.38, 0, fl + .55, -.66, 'o'], [.56, 0, -1.0, -.36, 'i'], [.7, 0, -1.3, -.28, 'o'], [1, 0, -1.2, -.3]],
    sd: [[0, 0, 1, .4], [.38, 0, 1, .95], [.56, 0, 1, -.1], [1, 0, 1, .12]],
    R: [[0, -.32, fl + 1.25, -.55], [.38, -.4, fl + .9, -.95, 'o'], [.56, -.26, .12, -.05, 'i'], [.62, -.24, 0, 0, 'o'], [1, -.24, 0, 0]],
    L: [[0, .32, fl + 1.25, -.55], [.38, .4, fl + .9, -.95, 'o'], [.6, .28, .14, -.06, 'i'], [.67, .24, 0, 0, 'o'], [1, .24, 0, 0]],
    F0: [[0, .15, fl, -.72], [.46, .15, fl, -.72], [.6, .15, -2.0, -.4, 'o'], [1, .15, -2.2, -.3]],
    F1: [[0, -.15, fl, -.72], [.46, -.15, fl, -.72], [.62, -.15, -1.85, -.38, 'o'], [1, -.15, -2.15, -.25]],
  };
}
/* 지붕 끝에서 등을 돌려 발부터 미끄러져 내려와 매달렸다가 떨어짐 (모서리 기준, 지붕은 위 deck · 바닥은 아래 fl) */
function makeLower(deck, fl) {
  return { dur: 2.6,
    H: [[0, 0, deck + .55, .7], [.25, 0, deck + .3, .2, 's'], [.45, 0, -.45, -.22, 'i'], [.6, 0, -1.25, -.3, 'o'], [.78, .05, -1.2, -.3], [.86, 0, -1.8, -.55, 'i'], [1, 0, fl + .6, -.75, 'o']],
    sd: [[0, 0, .35, 1], [.4, 0, 1, .35], [.6, 0, 1, .12], [.86, 0, 1, .1], [1, 0, 1, .7]],
    R: [[0, -.32, deck, 1.0], [.3, -.28, deck + .02, .4], [.5, -.24, .02, .04, 'i'], [.82, -.24, 0, 0], [.9, -.38, -1.3, -.4, 'o'], [1, -.36, fl + .35, -.45]],
    L: [[0, .32, deck, 1.0], [.32, .28, deck + .02, .42], [.53, .24, .02, .04, 'i'], [.84, .24, 0, 0], [.92, .38, -1.25, -.4, 'o'], [1, .36, fl + .35, -.45]],
    F0: [[0, .2, deck, .25], [.3, .2, -.3, -.25], [.45, .18, -1.2, -.25], [.6, .15, -2.15, -.3], [.84, .15, -2.2, -.3], [.92, .18, fl, -.75, 'i'], [1, .18, fl, -.75]],
    F1: [[0, -.2, deck, .2], [.33, -.2, -.4, -.25], [.48, -.18, -1.3, -.25], [.62, -.15, -2.1, -.28], [.84, -.15, -2.15, -.28], [.92, -.18, fl, -.7, 'i'], [1, -.18, fl, -.7]],
  };
}

/* ================= 자세 (루트 로컬: +z 앞, +y 위) ================= */
const v3 = (v, x, y, z) => v.set(x, y, z);
const poles = (d, ex, ey, ez, kx = .12, ky = 0, kz = 1) => { v3(d.P.ep[0], ex, ey, ez); v3(d.P.ep[1], -ex, ey, ez); v3(d.P.kp[0], kx, ky, kz); v3(d.P.kp[1], -kx, ky, kz); };
function poseStand(d, crouch = 0) {
  const P = d.P, br = Math.sin(d.t * 1.3) * .015;
  v3(P.H, Math.sin(d.t * .7 + d.phase) * .03, .93 - crouch * .38 + br, -crouch * .1); v3(P.sd, Math.sin(d.t * .5) * .08, 1, .45 + crouch * .5);
  v3(P.hand[0], .34, .28, .14 + crouch * .25); v3(P.hand[1], -.34, .28, .14 + crouch * .25);
  v3(P.foot[0], .15, 0, crouch * .05); v3(P.foot[1], -.15, 0, crouch * .05);
  poles(d, .5, -.1, -1);
}
/** 네 발 기기 (천장에 붙어 있을 때도 같은 자세를 거꾸로 쓴다) */
function poseCrawl(d, moving = true) {
  const P = d.P, f = moving ? d.gait : 0, s = Math.sin(f), c = Math.cos(f), br = Math.sin(d.t * 1.6) * .015;
  v3(P.H, Math.sin(f * .5) * .05, .6 + br + .04 * Math.abs(s), -.22); v3(P.sd, Math.sin(f * .5) * .1, .32, 1);
  v3(P.hand[0], .38, .16 * Math.max(0, c), .7 + .24 * s); v3(P.hand[1], -.38, .16 * Math.max(0, -c), .7 - .24 * s);
  v3(P.foot[0], .26, .1 * Math.max(0, -c), -.56 - .2 * s); v3(P.foot[1], -.26, .1 * Math.max(0, c), -.56 + .2 * s);
  poles(d, 1, .4, -.3, .3, -.2, 1);
}
/** 다리 밑에 늘어진 채 매달리기 (상판 아래 숨을 자리) */
function poseDangle(d) {
  const P = d.P, sw = Math.sin(d.t * 2.1 + d.phase) * .04;
  v3(P.H, sw, .95, -.12); v3(P.sd, sw * .5, 1, .05);
  v3(P.hand[0], .26, 2.3, .06); v3(P.hand[1], -.26, 2.3, .06);
  v3(P.foot[0], .16 + sw * 2, .08, -.14); v3(P.foot[1], -.16 + sw * 1.4, .12, -.1);
  poles(d, 1, 0, -.3, .1);
}
/** 잡은 점에 매달림. 손은 잡은 점(루트 원점)에 고정, 몸은 진자 d.sw 로 열차 뒤쪽·바깥으로 쏠림
 *  ux: 루트 로컬에서 열차 뒤쪽 방향의 x 성분 (±1) */
function poseGrip(d) {
  const P = d.P, th = d.sw, ux = d.ux, kind = d.gr.kind, slip = d.grip < .45;
  if (kind === 'bar') {
    // 세로 봉: 두 손이 위아래로 봉을 쥐고 발판을 딛고 섬. 몸이 봉을 축으로 열차 뒤쪽·바깥으로 휘돌아감
    const r = .42, s = Math.sin(th), c = Math.cos(th);
    v3(P.hand[1], 0, 0, 0); v3(P.hand[0], 0, -.38, 0);
    v3(P.H, ux * s * r, -.86, -c * r); v3(P.sd, ux * s * .35, 1, -c * .2);
    v3(P.foot[0], .13 + ux * s * .1, -1.72, -.05); v3(P.foot[1], -.13 + ux * s * .1, -1.72, -.05);
    if (slip) { v3(P.foot[1], ux * s * 1.0, -1.55, -c * .9); }                       // 한 발이 발판에서 미끄러져 허공에 휘둘림
    poles(d, .3, -.2, -1, .15, 0, -1);
    if (d.bangT > 0) { const u = 1 - d.bangT / .9; d.lock[0] = false;                  // 비어 있는 손으로 창을 내리침
      if (u < .55) v3(P.hand[0], ux * .55, .15, -.45); else v3(P.hand[0], ux * .5, -.05, .16); }
    else if (slip) { d.lock[0] = false; v3(P.hand[0], ux * .6 + Math.sin(d.t * 11) * .2, -.5, -.6); }
    else d.lock[0] = true;
    d.lock[1] = true;
  } else {
    // 가로 막대(난간·가장자리·모서리): 두 손으로 매달려 몸이 늘어지고, 진자처럼 뒤로 쏠림. 가끔 발로 벽을 긁음
    const L = 1.2, s = Math.sin(th), c = Math.cos(th), s2 = Math.sin(th * 1.4), c2 = Math.cos(th * 1.4);
    v3(P.hand[1], -.24, 0, 0); v3(P.hand[0], .24, 0, 0);
    v3(P.H, ux * s * L, -c * L, -.3); v3(P.sd, -ux * s, c, .1);
    const scr = Math.max(0, Math.sin(d.t * 2.3 + d.phase)) > .8;
    v3(P.foot[0], P.H.x + .15 + ux * s2 * .9, P.H.y - c2 * .95, -.32); v3(P.foot[1], P.H.x - .15 + ux * s2 * 1.0, P.H.y - c2 * .9, scr ? -.02 : -.3);
    if (scr) P.foot[1].y += .35;
    poles(d, 1, 0, -.3, .1);
    if (slip) { d.lock[0] = false; v3(P.hand[0], .5 + ux * .3, -.35 + Math.sin(d.t * 13) * .15, -.45); } else d.lock[0] = true;
    d.lock[1] = true;
  }
}
/** 공중: 잡을 부품 쪽으로 팔을 쭉 뻗음 */
function poseReach(d, k) {
  const P = d.P;
  v3(P.H, 0, -1.0 - .25 * k, -.4); v3(P.sd, 0, 1, .3 - .2 * k);
  v3(P.hand[0], .28, .1, .25 - .2 * k); v3(P.hand[1], -.28, .15, .25 - .2 * k);
  v3(P.foot[0], .2, -1.6, -.75); v3(P.foot[1], -.2, -1.8, -.55);
  poles(d, 1, 0, -.3, .1);
}

/* ---------- 걸음: 발을 실제로 디딤 ----------
 * 발은 통합 좌표에 박혀 있고, 몸이 멀어지면 한 발씩 들어 옮긴다. 저는 다리는 낮게 질질 끌고 오래 걸림.
 * 발을 드는 동안만 몸이 앞으로 쏠려 나가서 걸음이 '쿵… 쿵…' 하고 끊긴다. */
const _fh = new THREE.Vector3(), _fv = new THREE.Vector3();
function resetFeet(d) { for (let i = 0; i < 2; i++) { fromRoot(d, d.Q.foot[i], d.fp[i]); d.fp[i].y = d.tp.y; d.fs[i].u = -1; } }
function stepFeet(d, dt, vx, vz, run) {
  let swinging = -1;
  for (let i = 0; i < 2; i++) {
    const f = d.fs[i]; if (f.u < 0) continue; swinging = i;
    f.u = Math.min(1, f.u + dt / f.dur); const e = EASE.s(f.u);
    d.fp[i].lerpVectors(f.a, f.b, e); d.fp[i].y = d.tp.y + Math.sin(f.u * Math.PI) * f.lift;
    if (f.u >= 1) { f.u = -1; d.fp[i].y = d.tp.y; snd(d, 'step', run ? .7 : .9); impulse(d, _imp.set(0, run ? -.6 : -1.1, 0), .3);
      if (i === d.limp && !run && Math.random() < .5) snd(d, 'scrape', .35); }
  }
  if (swinging < 0) {
    let best = -1, be = 0;
    for (let i = 0; i < 2; i++) {
      v3(_fh, i ? -.15 : .15, 0, 0); fromRoot(d, _fh, _fh); _fh.x += vx * .35; _fh.z += vz * .35; _fh.y = d.tp.y;
      const e = Math.hypot(_fh.x - d.fp[i].x, _fh.z - d.fp[i].z); if (e > be) { be = e; best = i; }
    }
    const moving = Math.hypot(vx, vz) > .05;
    if (best >= 0 && (be > (run ? .22 : .3) || (!moving && be > .1))) {
      const f = d.fs[best], lame = best === d.limp && !run;
      v3(_fh, best ? -.15 : .15, 0, 0); fromRoot(d, _fh, _fh);
      f.a.copy(d.fp[best]); f.b.set(_fh.x + vx * (run ? .2 : .42), d.tp.y, _fh.z + vz * (run ? .2 : .42));
      f.u = 0; f.dur = run ? .2 : lame ? .8 : .52; f.lift = run ? .2 : lame ? .05 : .2; swinging = best;
    }
  }
  for (let i = 0; i < 2; i++) toRoot(d, d.fp[i].x, d.fp[i].y, d.fp[i].z, d.P.foot[i]);
  d.plant = true;
  return swinging;
}
/** 걷는 몸: 디딘 발 쪽으로 기우뚱, 저는 다리로 디딜 땐 푹 꺼짐, 팔은 늘어져 흔들리다 한 팔이 앞으로 뻗침 */
function poseLurch(d, swinging, run) {
  const P = d.P, u = swinging >= 0 ? d.fs[swinging].u : 0, stance = swinging >= 0 ? 1 - swinging : -1;
  const sx = stance < 0 ? 0 : (stance === 0 ? .1 : -.1), dip = Math.sin(u * Math.PI) * (stance === d.limp ? .16 : .05);
  if (run) {
    v3(P.H, sx * .5, .86 - dip * .5, .12); v3(P.sd, sx * .6, 1, 1.25);
    const a = Math.sin(d.t * 15);
    v3(P.hand[0], .35, .9 + .4 * a, .7 + .3 * a); v3(P.hand[1], -.35, .9 - .4 * a, .7 - .3 * a);    // 두 팔을 앞으로 마구 휘저음
    poles(d, .8, .3, -.6, .1, 0, 1);
  } else {
    v3(P.H, sx + Math.sin(d.t * .9 + d.phase) * .02, .9 - dip, 0); v3(P.sd, sx * (stance === d.limp ? 2.2 : 1.1), 1, .62);
    const sw = swinging < 0 ? 0 : (swinging ? 1 : -1) * Math.sin(u * Math.PI) * .22;
    v3(P.hand[0], .36, .2, .1 + sw); v3(P.hand[1], -.3, .55 + .1 * Math.sin(d.t * 2.1), .55 - sw * .3);           // 오른팔은 반쯤 앞으로 뻗침
    poles(d, .6, -.1, -1);
  }
}

/* ================= 등장 ================= */
const FR = makeFrame(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const used = new Map();
function setWorldPose(d, pos, up, fwd) { d.g.position.copy(pos); _x.crossVectors(up, fwd).normalize(); d.g.quaternion.setFromRotationMatrix(_m.makeBasis(_x, up, fwd)); }
/** 선로 좌표 (s, 위 u, 옆 r) → 월드 */
function wpos(s, u, r, out) { frameAt(s, FR); return trackPos(s, out).addScaledVector(FR.U, u).addScaledVector(FR.R, r); }
const ACTIVE = { runner: 1, spider: 1, climber: 1, track: 1, stairs: 1 };            // 처음부터 움직이는 무리 (눈이 켜진 채)
function spawnAt(d, a, idx = 0, count = a.n || 1) {
  d.rs = undefined; d.stairs = null; d.wheelRisk = false;
  Object.assign(d, { alive: true, a: Object.assign({}, a), hp: CFG.hp, legHit: 0, kneel: 0, slipT: 0, decided: false, prepT: 0, go: false, t: 0, st: 0, flash: 0, heading: 0, level: 'floor', cool: 0, grip: 1, stagger: 0, gait: 0, freeze: 0, rT: 0,
    eyeOn: false, eyeT: 0, knockT: 0, side: a.side, phase: Math.random() * 9, swung: false, blendT: 0, sw: 0, swv: 0, roll: 0, rollTo: 0, trem: .004,
    limp: Math.random() < .5 ? 0 : 1, sprintCD: rnd(4, 9), gr: null, hold: 0, bangT: 0, plant: false, mode: '' });
  d.lock[0] = d.lock[1] = false;
  d.targetX = -.5 - Math.random() * (TRAIN_BACK - 1.5); d.wake = 34 + Math.random() * 46;
  frameAt(a.s, FR); trackPos(a.s, _p);
  if (a.type === 'door') { _p.addScaledVector(FR.R, a.side * 5.85).addScaledVector(FR.U, 1.35); _f.copy(FR.R).multiplyScalar(-a.side); setWorldPose(d, _p, FR.U, _f); d.state = 'inside'; poseStand(d, .05); }
  else if (a.type === 'ceil') { _p.addScaledVector(FR.U, 7.05).addScaledVector(FR.R, a.r); _f.copy(FR.T).multiplyScalar(-1); _r.copy(FR.U).multiplyScalar(-1); setWorldPose(d, _p, _r, _f); d.state = 'ceil'; poseCrawl(d, false); }
  else if (a.type === 'under' || a.type === 'climber') { d.rs = a.s + idx * 2; wpos(d.rs, -1.0 - 2.3, a.side * 2.25, _p); _f.copy(FR.R).multiplyScalar(-a.side); setWorldPose(d, _p, FR.U, _f); d.state = a.type === 'under' ? 'under' : 'creep'; poseDangle(d); }
  else if (a.type === 'runner') { d.rs = a.s + idx * rnd(1.2, 2.4); d.lat = a.side * (4.55 + rnd(-.2, .25)); d.state = 'run'; }
  else if (a.type === 'track') { d.rs = a.s + idx * 3; d.lat = (idx ? -1 : 1) * rnd(0, .4); d.state = 'trackrun'; }
  else if (a.type === 'spider') { d.rs = a.s + idx * 2; d.lat = a.r; d.state = 'spider'; }
  else if (a.type === 'gantry') { d.rs = a.s + (idx ? .3 : -.3); d.lat = a.r + (idx ? -.9 : .4); wpos(d.rs, 10.05, d.lat, _p); _f.copy(FR.T).multiplyScalar(-1); setWorldPose(d, _p, FR.U, _f); d.state = 'perch'; poseStand(d, .8); }
  else if (a.type === 'stairs') {
    const run = d.stairs = makeStairRun(a, idx, count);
    // Pair arrivals so shoulders can touch; leave the last rank a clear jump.
    const cars = [driveCar, powerCar, cabinCar];
    d.targetX = -cars[Math.min(2, Math.floor(idx / 2))].off - (idx % 2) * .5;
    run.mishap = count >= 3 && idx === 1 ? (a.gi % 2 ? 'short' : 'shove')
      : count >= 5 && idx === 3 ? (a.gi % 2 ? 'shove' : 'short') : '';
    d.state = 'stairs'; poseStand(d, .25);
    _f.subVectors(run.points[1], run.points[0]).setY(0).normalize();
    setWorldPose(d, run.points[0], UPV, _f);
  } else if (a.type === 'work') {                                    // 작업 발판에서 일하는 중
    d.rs = a.s + (idx - 1) * 1.4; d.u = -.12; d.lat = a.side * rnd(5.2, 5.7); wpos(d.rs, d.u, d.lat, _p); _f.copy(FR.R).multiplyScalar(a.side); setWorldPose(d, _p, FR.U, _f); d.state = 'work'; poseStand(d, .3);
  }
  if (ACTIVE[a.type]) { d.eyeOn = true; d.eyeT = 0; }
  if (d.rs !== undefined && ['run', 'trackrun', 'spider', 'stairs'].includes(d.state)) moveWorld(d, 0);
  d.fr = { T: FR.T.clone(), U: FR.U.clone(), R: FR.R.clone() };
  d.home = d.g.position.clone(); d.g.visible = true; d.mat.emissiveIntensity = 0; d.eye.material = eyeMat; d.glow.visible = false;
  d.look.set(0, 0, 1); d.lookCur.set(0, 0, 1); snapRig(d); applyRig(d);
  used.set(a.gi, a.s + 200);
}
export function spawnGroup(n = 1 + (Math.random() * 3 | 0)) {
  for (const [gi, until] of used) if (until < S.sTrain) used.delete(gi);
  const rate = Math.max(0, S.speed) / arcScale(S.sTrain);
  const ahead = Math.max(170, Math.min(520, rate * 18));
  const list = anchorsIn(S.sTrain + 60, S.sTrain + ahead).filter(a => {
    if (used.has(a.gi)) return false;
    const gap = a.s - S.sTrain;
    if (a.type !== 'stairs') return gap <= 170 && (a.type !== 'door' || doorLeaves.has(a.gi));
    const flight = a.bot ? Math.hypot(a.bot.lat - a.bot.top, a.bot.u) : 8;
    return gap >= rate * (flight + (a.bot ? 10 : 2)) / 6.5;
  });
  for (let i = list.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  let made = 0;
  let groups = 0;
  for (const a of list) {
    if (groups >= n) break; groups++;
    const count = Math.min(a.n || 1, pool.filter(d => !d.alive).length);
    for (let i = 0; i < count; i++) { const d = pool.find(x => !x.alive); if (!d) return made; spawnAt(d, a, i, count); made++; }
  }
  return made;
}
let nextT = CFG.firstDelay;
export function clearAndroids() { for (const d of pool) { d.alive = false; d.g.visible = false; } used.clear(); nextT = CFG.firstDelay; }

/** 월드에서 움직이는 중: 선로 좌표(rs, u, lat)에 두고 진행 방향(선로 뒤쪽 = 열차 쪽)을 봄. yaw: 선로 기준 진행 각 */
function moveWorld(d, dt, yaw) {
  const up = d.state === 'spider' ? -1 : 1, u = d.state === 'spider' ? 7.05 : d.state === 'trackrun' ? .3 : d.u !== undefined && d.state !== 'run' ? d.u : .3;
  wpos(d.rs, u, d.lat, _p); d.g.position.copy(_p);
  if (yaw === undefined) _f.copy(FR.T).multiplyScalar(-1); else _f.copy(FR.T).multiplyScalar(Math.cos(yaw)).addScaledVector(FR.R, Math.sin(yaw)).multiplyScalar(yaw === undefined ? -1 : 1);
  if (up < 0) setWorldPose(d, _p, _r.copy(FR.U).multiplyScalar(-1), _f); else setWorldPose(d, _p, FR.U, _f);
}
const stairFace = new THREE.Vector3();
function tumbleFromStairs(d, rail) {
  frameAt(d.stairs.points[3].x, FR);
  const run = d.stairs;
  if (rail) {
    _imp.copy(FR.R).multiplyScalar(-d.side * 4.8).addScaledVector(FR.U, .55);
  } else {
    // Across the unguarded side of the landing, clear of the adjoining stair.
    _imp.copy(FR.T).multiplyScalar(run.points[2].x < run.points[3].x ? 4.2 : -4.2)
      .addScaledVector(FR.R, d.side * 1.6).addScaledVector(FR.U, 1.75);
  }
  snd(d, 'scrape', 1.1);
  startRag(d, _imp, 3.5);
  d.wheelRisk = rail;
}

function stepStairs(d, dt) {
  const run = d.stairs, lip = run.points[3];
  const gap = lip.x - S.sTrain - d.targetX;
  const distance = advanceRun(run, gap, Math.max(0, S.speed) / arcScale(S.sTrain), dt);
  if (!run.started) {
    poseStand(d, .25);
    d.P.sd.x = .2 * Math.sin(d.t + d.phase);
    d.P.hand[d.limp].y += .16 * Math.sin(2*d.t + d.phase);
    return;
  }
  const stride = run.stride;
  sampleRun(run, run.distance, _p);
  sampleRun(run, run.distance + .15, stairFace).sub(_p).setY(0);
  if (stairFace.lengthSq() < .00001) stairFace.subVectors(lip, run.points[2]).setY(0);
  setWorldPose(d, _p, UPV, stairFace.normalize());
  poseStairRun(d);
  if (Math.floor((run.distance-distance)/stride + run.phase) < Math.floor(run.distance/stride + run.phase)) snd(d, 'step', .75);

  if (run.mishap === 'shove' && run.distance >= run.ends[2] && run.distance < run.length) {
    const other = pool.find(o => o !== d && o.alive && o.state === 'stairs' && o.a.gi === d.a.gi &&
      o.stairs.started && o.g.position.distanceToSquared(d.g.position) < 1.15 ** 2);
    if (other) {
      other.QV.hand[other.limp].z += 2.6; other.rollTo = .48;
      tumbleFromStairs(d, false); return;
    }
  }
  if (run.distance < run.length) return;
  d.a.s = lip.x;
  frameAt(lip.x, FR);
  d.fr.T.copy(FR.T); d.fr.U.copy(FR.U); d.fr.R.copy(FR.R);
  const x = lip.x - S.sTrain;
  if (x < -TRAIN_BACK || x > driveCar.x1 || S.speed > CFG.latchMaxSpeed ||
      run.mishap === 'short') {
    tumbleFromStairs(d, true); return;
  }
  const duration = .39;
  startLeap(d, duration, .88, x - S.speed * duration / arcScale(lip.x));
}

/** 달리기 (월드, 발 디딤 없이): 상체는 질주 자세, 다리는 크게 */
function poseRun(d) {
  poseLurch(d, -1, true); const s = Math.sin(d.gait), c = Math.cos(d.gait);
  v3(d.P.foot[0], .15, .3 * Math.max(0, c), .5 * s); v3(d.P.foot[1], -.15, .3 * Math.max(0, -c), -.5 * s);
  d.P.H.y = .88 + .06 * Math.abs(s);
}

/* ================= 잡을 부품 고르기 ================= */
const _gl = new THREE.Vector3();
function taken(d, g, x) { return pool.some(o => o !== d && o.alive && o.gr === g && Math.abs(o.gp.x - x) < .9); }
/** 차량 car 의 s 쪽에서 로컬 x 가까운 부품. kinds 순서대로 시도, 먼저 찾은 것 중 가장 가까운 점 */
function pickGrip(d, car, x, s, kinds) {
  let best = null, bd = 1e9;
  for (const g of GRIPS) {
    if (g.car !== car || !kinds.includes(g.kind) || (s && g.s !== s)) continue;
    for (const dx of [0, .9, -.9, 1.8, -1.8]) {
      gripPoint(g, _gl.set(x + dx, g.a.y, g.a.z), _gl); if (taken(d, g, _gl.x)) continue;
      const dd = Math.abs(_gl.x - x) + kinds.indexOf(g.kind) * .8 + Math.random() * .6;
      if (dd < bd) { bd = dd; best = { g, x: _gl.x }; } break;
    }
  }
  return best;
}
/** 부품을 잡음: 잡은 점과 그 자리에서의 루트 방향 (몸이 바깥, 얼굴이 열차 쪽) */
function setGrip(d, g, x) {
  d.gr = g; gripPoint(g, _gl.set(x, g.kind === 'bar' ? F + 1.55 : g.a.y, g.a.z), d.gp);
  if (g.kind === 'bar') d.gp.y = F + 1.55;
  d.gh = Math.atan2(-g.n.x, -g.n.z);
  d.ux = Math.sign(-(Math.cos(d.gh))) || 1;               // 열차 뒤쪽(통합 -x)이 루트 로컬 x 에서 어느 쪽인지
}
const gripTrain = (d, out) => out.set(d.gp.x - d.gr.car.off, d.gp.y, d.gp.z);

/* ================= 매 프레임 ================= */
const _pan = new THREE.Vector3(), _cr = new THREE.Vector3();
function snd(d, kind, mul = 1) {
  _pan.subVectors(d.state === 'rag' ? d.rp[0] : d.g.position, camera.position); const dist = _pan.length(); _pan.normalize();
  _cr.setFromMatrixColumn(camera.matrixWorld, 0);
  A.droidSnd(kind, _pan.dot(_cr), Math.min(1, 7 / (dist + 4)) * mul);
}
export function updateAndroids(dt, authority, targets) {
  if (authority && S.dir > 0 && Math.abs(S.speed) > 1) { nextT -= dt; if (nextT <= 0) nextT = spawnGroup() ? CFG.gapMin + Math.random() * (CFG.gapMax - CFG.gapMin) : 4; }
  for (const d of pool) if (d.alive) step(d, dt, targets);
}
const HIDDEN = ['inside', 'knock', 'burst', 'lurk', 'ceil', 'under', 'prep', 'unhook', 'run', 'trackrun', 'spider', 'creep', 'perch', 'stairs', 'work', 'notice', 'dash'];
const ON_GRIP = ['hang', 'climb', 'reach', 'jump', 'lower'];
const _w2 = new THREE.Vector3(), _hd = new THREE.Vector3(0, 1.65, .1), _imp = new THREE.Vector3(), _g = new THREE.Vector3();
function step(d, dt, targets) {
  d.t += dt; d.st += dt; d.cool -= dt; d.stagger -= dt; d.sprintCD -= dt; d.flash = Math.max(0, d.flash - dt * 5); d.mat.emissiveIntensity = d.flash * .8;
  if (d.state === 'rag') { stepRag(d, dt); return; }
  const speed = Math.abs(S.speed), X = d.a.s - S.sTrain;
  if (!d.eyeOn && X < d.wake && d.state !== 'inside' && d.state !== 'knock') { d.eyeOn = true; d.eyeT = .5; snd(d, 'wake', .9); }
  if (d.eyeOn) { d.eyeT -= dt; const on = d.eyeT <= 0 || Math.sin(d.eyeT * 60) > 0; d.eye.material = on ? eyeOnMat : eyeMat; d.glow.visible = on && d.eyeT < 50; }
  if (HIDDEN.includes(d.state) && (X < -TRAIN_BACK - 45 || X > (d.state === 'stairs' ? 540 : 260))) { d.alive = false; d.g.visible = false; return; }
  // 경련: 예고 없이 잠깐 굳으며 한쪽 팔이 튐
  d.freeze -= dt;
  if (d.freeze <= 0 && Math.random() < dt * .18 && ['walk', 'lurk', 'ceil', 'under', 'rise', 'perch', 'work'].includes(d.state)) {
    d.freeze = .15 + Math.random() * .35; const i = Math.random() < .5 ? 0 : 1; if (!d.lock[i]) d.QV.hand[i].add(_imp.set(rnd(-2, 2), rnd(0, 3), rnd(-1, 2)));
    d.rollTo = rnd(-1, 1) * .9; snd(d, 'tick', 1.2);
  }
  const frozen = d.freeze > 0;
  d.plant = false; d.trem = .004 + (d.hp <= 1 ? .012 : 0);
  d.slipT = Math.max(0, (d.slipT || 0) - dt); d.kneel = Math.max(0, (d.kneel || 0) - dt);

  if (!frozen) switch (d.state) {
    case 'inside': { if (X < d.wake) setState(d, 'knock'); poseStand(d, .05); break; }
    case 'knock': {
      const door = doorLeaves.get(d.a.gi); d.knockT -= dt;
      if (d.knockT <= 0) { d.knockT = .38 + Math.random() * .25; snd(d, 'knock', 1.3); if (door) door.kick = .12; }
      if (door) { door.kick = Math.max(0, (door.kick || 0) - dt); door.pivot.userData.leaf.rotation.y = d.side * Math.abs(Math.sin(door.kick * 40)) * .06;
        door.pivot.userData.lamp.material.color.setRGB(Math.sin(d.t * 14) > 0 ? 1 : .25, .12, .08); }
      poseStand(d); const pk = Math.max(0, Math.sin(d.t * 16)); d.P.hand[1].set(-.25, 1.3, .25 + pk * .35); d.P.sd.set(0, 1, .2 + pk * .2);
      if (d.st > 1.3 && X < 17) { setState(d, 'burst'); snd(d, 'door', 1.4); d.eyeOn = true; d.eyeT = 0; impulse(d, _imp.set(0, .3, 2.5)); }
      break;
    }
    case 'burst': {
      const door = doorLeaves.get(d.a.gi), k = Math.min(1, d.st / 1.1), e = EASE.o(k);
      if (door) { door.pivot.userData.leaf.rotation.y = d.side * 1.45 * EASE.o(Math.min(1, d.st / .22)); door.pivot.userData.lamp.material.color.setRGB(1, .12, .08); }
      d.g.position.copy(d.home).addScaledVector(d.fr.R, -d.side * 1.15 * e);
      // 비틀거리며 두 걸음
      const u = Math.sin(k * Math.PI * 2); v3(d.P.H, u * .1, .88, 0); v3(d.P.sd, u * .25, 1, .8);
      v3(d.P.foot[0], .15, Math.max(0, u) * .2, .2 * u); v3(d.P.foot[1], -.15, Math.max(0, -u) * .2, -.2 * u);
      v3(d.P.hand[0], .4, .4, .4); v3(d.P.hand[1], -.4, .9, .6); poles(d, .5, 0, -1);
      if (k >= 1) { setState(d, 'lurk'); snd(d, 'servo'); }
      break;
    }
    case 'lurk': {
      poseStand(d, .55); d.P.hand[0].set(.3, .9, .5); d.P.hand[1].set(-.32, .5, .3); d.trem = .02;
      d.P.H.x += Math.sin(d.t * 1.1) * .06;                                        // 앞뒤로 흔들흔들
      if (X <= d.targetX + 2.5 && X > -TRAIN_BACK && speed <= CFG.latchMaxSpeed) setState(d, 'prep');
      else if (speed > CFG.latchMaxSpeed && X <= d.targetX) d.targetX = -999;
      break;
    }
    case 'prep': {
      const under = d.a.type === 'under';
      if (under) { poseDangle(d); d.P.H.y = .75; d.P.foot[0].set(.18, .55, .25); d.P.foot[1].set(-.18, .5, .25); }
      else { poseStand(d, .95); d.P.hand[0].set(.4, .6, -.35); d.P.hand[1].set(-.4, .6, -.35); d.P.sd.set(0, 1, .9); }
      d.trem = .03;
      if (d.st > .35) startLeap(d, under ? .55 : .5, under ? .6 : 1.1);
      break;
    }
    case 'ceil': { poseCrawl(d, false); d.trem = .01; if (X <= d.targetX + 3 && X > -TRAIN_BACK) setState(d, 'unhook'); break; }
    case 'unhook': {
      poseCrawl(d, false); d.P.hand[1].set(-.3, .55, .45); if (d.st > .2) d.P.hand[0].set(.3, .6, .4);
      d.P.H.y = .6 + d.st * .8; d.P.foot[0].y = d.st * .6; d.P.foot[1].y = d.st * .6;
      if (d.st > .36) startDrop(d);
      break;
    }
    case 'run': case 'trackrun': {                             // 보행로·선로 위를 이미 달려오는 중
      const track = d.state === 'trackrun', v = track ? 5.2 : 4.6; d.rs -= v * dt; d.a.s = d.rs;
      d.gait += v * dt / .9 * Math.PI; moveWorld(d, dt); poseRun(d); d.trem = .02;
      if (Math.random() < dt * 2.5) snd(d, 'step', .8);
      const Xn = d.rs - S.sTrain;
      if (!track) { if (Xn <= d.targetX + 3 && Xn > -TRAIN_BACK && speed <= CFG.latchMaxSpeed) { d.home = d.g.position.clone(); d.side = d.a.side; startLeap(d, .5, 1.0); } }
      else if (!d.decided && Xn < 8) {                                   // 정면: 느리면 앞코로 뛰어 붙고, 빠르면 그대로 치임
        d.decided = true; if (speed <= CFG.latchMaxSpeed + 2) { d.side = Math.random() < .5 ? -1 : 1; startLeap(d, .42, 1.3); snd(d, 'shriek', 1.3); } }
      else if (d.decided && Xn < 4.3) {
        frameAt(S.sTrain, FR); _imp.copy(FR.T).multiplyScalar(S.speed * 1.2 + 2).addScaledVector(FR.U, 3 + speed * .2).addScaledVector(FR.R, (Math.random() - .5) * 6);
        snd(d, 'land', 1.8); S.shake = Math.max(S.shake, .22); startRag(d, _imp, 4); H.reward?.(d.hitT.clone());
      }
      break;
    }
    case 'spider': {                                         // 천장을 거미처럼 기어 열차 쪽으로
      d.rs -= 3.4 * dt; d.a.s = d.rs; d.gait += 3.4 * dt / .5 * Math.PI; moveWorld(d, dt); poseCrawl(d, true); d.trem = .015;
      if (Math.random() < dt * 4) snd(d, 'tick', .6);
      const Xn = d.rs - S.sTrain; if (Xn <= d.targetX + 3 && Xn > -TRAIN_BACK) { d.fr = { T: FR.T.clone(), U: FR.U.clone(), R: FR.R.clone() }; setState(d, 'unhook'); }
      break;
    }
    case 'creep': {                                          // 상판 가장자리 아래를 손을 번갈아 옮기며 다가옴
      d.rs -= 1.7 * dt; d.a.s = d.rs; d.gait += 1.7 * dt / .45 * Math.PI;
      wpos(d.rs, -3.3, d.side * 2.25, _p); _f.copy(FR.R).multiplyScalar(-d.side); setWorldPose(d, _p, FR.U, _f); d.fr = { T: FR.T, U: FR.U, R: FR.R };
      poseDangle(d); const s1 = Math.sin(d.gait); d.P.hand[0].x = .26 + .25 * s1; d.P.hand[1].x = -.26 + .25 * s1; d.P.hand[s1 > 0 ? 0 : 1].y -= .25 * Math.abs(s1); d.P.H.x = .15 * s1;
      if (X <= d.targetX + 2.5 && X > -TRAIN_BACK && speed <= CFG.latchMaxSpeed) setState(d, 'prep');
      break;
    }
    case 'perch': {                                          // 문형 크레인 위: 웅크려 떨며 내려다보다 뛰어내림
      poseStand(d, .85); d.P.hand[0].set(.35, .35, .35); d.P.hand[1].set(-.35, .3, .4); d.trem = .02; d.P.sd.z = 1.1;
      if (X <= d.targetX + 4.5 && X > -TRAIN_BACK) { if (!d.prepT) { d.prepT = .35; snd(d, 'servo', 1.2); } d.prepT -= dt; d.P.H.y -= .2; if (d.prepT <= 0) { d.prepT = 0; startDrop(d); if (d.state === 'drop') d.dur = .95; } }
      break;
    }
    case 'stairs': stepStairs(d, dt); break;
    case 'work': {                                           // 콘솔 앞에서 뭔가를 두드림 → 열차를 알아챔
      poseStand(d, .35); const hm = Math.max(0, Math.sin(d.t * 5 + d.phase)); d.P.hand[1].set(-.25, .9 + hm * .4, .45); d.P.hand[0].set(.3, .7, .4); d.P.sd.z = .9;
      if (hm > .98 && Math.random() < .3) snd(d, 'knock', .35);
      if (X < 46) { setState(d, 'notice'); d.eyeOn = true; d.eyeT = .5; snd(d, 'wake', 1); d.rollTo = rnd(-1, 1); }
      break;
    }
    case 'notice': { poseStand(d, .2); d.trem = .05; if (d.st > rnd(.3, .8)) { setState(d, 'dash'); snd(d, 'shriek', 1.2); } break; }
    case 'dash': {                                           // 발판 끝으로 달려옴
      const v = 4 * dt, edge = d.side * 3.1; d.lat += Math.sign(edge - d.lat) * Math.min(v, Math.abs(edge - d.lat)); d.u = -.1;
      d.gait += v / .9 * Math.PI; moveWorld(d, dt, -d.side * Math.PI / 2); poseRun(d);
      if (Math.abs(d.lat - edge) < .05) { d.a.s = d.rs; d.home = d.g.position.clone(); d.fr = { T: FR.T.clone(), U: FR.U.clone(), R: FR.R.clone() }; setState(d, 'lurk'); }
      break;
    }
    case 'under': {
      poseDangle(d);
      if (X <= d.targetX + 2.5 && X > -TRAIN_BACK && speed <= CFG.latchMaxSpeed) setState(d, 'prep');
      else if (speed > CFG.latchMaxSpeed && X <= d.targetX) d.targetX = -999;
      break;
    }
    case 'leap': {                                           // 월드 → 잡을 부품. 날아가는 동안 그 부품 쪽으로 손을 뻗음
      const k = Math.min(1, d.st / d.dur), e = EASE.s(k); trainToWorld(gripTrain(d, _g), _p);
      d.w.lerpVectors(d.from, _p, e).addScaledVector(d.fr.U, Math.sin(k * Math.PI) * d.arc); d.g.position.copy(d.w);
      const car = carForTrainX(_g.x); d.g.quaternion.slerpQuaternions(d.qFrom, _q.copy(car.g.quaternion).multiply(_q2.setFromAxisAngle(UPV, d.gh)), Math.min(1, k * 2));
      poseReach(d, k);
      if (k >= 1) { d.tp.copy(_g); d.heading = d.gh; setState(d, 'hang'); d.blendT = 0; d.grip = 1; d.hold = holdTime(d);
        d.sw = .5; d.swv = 2.5; snd(d, 'grip', 1.3); S.shake = Math.max(S.shake, .06); impulse(d, _imp.set(0, -2.5, 1.8), 0); }
      break;
    }
    case 'drop': {                                           // 천장 → 지붕/바닥
      const k = Math.min(1, d.st / d.dur), car = carForTrainX(d.to.x);
      d.tp.lerpVectors(d.from, d.to, EASE.s(k)); d.tp.y = d.from.y + (d.to.y - d.from.y) * k * k;
      trainToWorld(d.tp, d.w); d.g.position.copy(d.w);
      d.g.quaternion.copy(car.g.quaternion).multiply(_q2.slerpQuaternions(d.q0, _q.setFromAxisAngle(UPV, d.heading), EASE.s(Math.min(1, k * 1.6))));
      v3(d.P.H, 0, .95, 0); v3(d.P.sd, 0, 1, .15); v3(d.P.hand[0], .6, 1.1, .3); v3(d.P.hand[1], -.6, 1.1, .3); v3(d.P.foot[0], .2, .05, .15); v3(d.P.foot[1], -.2, .1, -.15);
      if (k >= 1) { setState(d, 'land'); d.blendT = 0; snd(d, 'land', 1.4); S.shake = Math.max(S.shake, .14); impulse(d, _imp.set(0, -3.6, .4), 1); }
      break;
    }
    case 'land': { place(d); if (d.level === 'roof') poseCrawl(d, false); else poseStand(d, .9); d.P.H.y -= .25 * Math.max(0, 1 - d.st * 1.6); d.trem = .02;
      if (d.st > 1.0) { setState(d, 'rise'); } break; }
    case 'hang': stepHang(d, dt, speed, targets); break;
    case 'climb': case 'reach': case 'jump': case 'lower': stepKeyed(d, dt, speed); break;
    case 'rise': {                                           // 넘어온 뒤 천천히 몸을 일으킴 (고개부터 사람 쪽으로)
      place(d); const k = Math.min(1, d.st / 1.4);
      if (d.level === 'roof') poseCrawl(d, false); else { poseStand(d, .85 * (1 - EASE.s(k))); d.P.sd.x += Math.sin(d.st * 5) * .15 * (1 - k); }
      d.trem = .015; if (k >= 1) { setState(d, 'walk'); resetFeet(d); }
      break;
    }
    case 'hop': stepHop(d, dt); break;
    case 'walk': case 'windup': case 'twitch': case 'sprint': stepWalk(d, dt, targets); break;
  }
  else place(d);
  if (d.state === 'rag') return;
  if (d.state !== 'leap' && !HIDDEN.includes(d.state) && d.state !== 'drop') place(d);
  if (d.slipT > 0) { d.lock[d.slipI] = false; v3(d.P.hand[d.slipI], (d.slipI ? -1 : 1) * .55, d.P.H.y + .3, -.5); }        // 맞은 팔: 잠깐 놓쳤다 다시 잡음
  if (d.kneel > 0 && (d.state === 'walk' || d.state === 'windup')) d.P.H.y -= .35 * Math.min(1, d.kneel * 2);               // 다리 맞음: 주저앉았다 일어남
  stepHead(d, dt, frozen);
  smoothRig(d, dt); applyRig(d);
  if (d.glow.visible) { const dist = d.hitH.distanceTo(camera.position), k = Math.min(1, Math.max(0, (dist - 1.5) / 7)); d.glow.material.opacity = .25 + .75 * k; d.glow.scale.setScalar(.18 + .42 * k); }
}
function place(d) { if (HIDDEN.includes(d.state) || d.state === 'leap') return; const car = trainToWorld(d.tp, d.w); d.g.position.copy(d.w); d.g.quaternion.copy(car.g.quaternion).multiply(_q.setFromAxisAngle(UPV, d.heading)); }

/* 고개: 톱니처럼 한 칸씩 걸리며 돈다 (기기긱). 몸이 앞을 봐도 고개는 뒤까지 돌아가고, 가끔 옆으로 꺾임 */
const _lk = new THREE.Vector3(), _ax = new THREE.Vector3();
function stepHead(d, dt, frozen) {
  d.g.updateMatrixWorld();
  _w2.copy(camera.position); d.g.worldToLocal(_w2).sub(_hd).normalize();
  if (d.state === 'ceil' || d.state === 'under') _w2.y = Math.max(_w2.y, .2);
  _w2.y = Math.max(-.7, Math.min(.8, _w2.y)); _w2.normalize();
  d.rT -= dt;
  if (d.rT <= 0) {
    d.rT = frozen ? .03 : .06 + Math.random() * .12;
    const ang = d.lookCur.angleTo(_w2);
    if (ang > .1) {
      const stepA = Math.min(ang, .2 + Math.random() * .25);
      _ax.crossVectors(d.lookCur, _w2); if (_ax.lengthSq() < 1e-6) _ax.set(0, 1, 0); _ax.normalize();
      d.lookCur.applyAxisAngle(_ax, stepA).normalize(); d.look.copy(d.lookCur);
      d.QV.look.addScaledVector(_lk.subVectors(_w2, d.lookCur), 2.5);                 // 걸릴 때마다 살짝 튕김
      if (d.hitH.distanceTo(camera.position) < 11) snd(d, 'tick', .5 + stepA);
    }
    if (Math.random() < .035) { d.rollTo = Math.random() < .4 ? 0 : rnd(-1, 1) * 1.1; }
  }
  // 꺾임도 끊어서
  if (Math.abs(d.rollTo - d.roll) > .02 && Math.random() < dt * 12) d.roll += Math.sign(d.rollTo - d.roll) * Math.min(Math.abs(d.rollTo - d.roll), .22);
}

/* ---------- 매달린 채 ---------- */
function holdTime(d) { return d.gr.kind === 'bar' ? rnd(2.5, 5.5) : d.gr.kind === 'rail' ? rnd(1.2, 2.6) : rnd(.8, 2.2); }
function stepHang(d, dt, speed, targets) {
  place(d);
  // 진자: 속도가 빠를수록 뒤쪽·바깥으로 크게 쏠리고, 선로 충격에 덜컥 튐
  const bar = d.gr.kind === 'bar', eq = d.gr.kind === 'ledge' ? 0 : bar ? Math.min(1.25, speed * .05) : Math.min(.75, speed * .032);
  d.swv += (-(bar ? 10 : 7) * (d.sw - eq) - 1.4 * d.swv) * dt;
  if (Math.random() < dt * (1 + speed * .15)) d.swv += (Math.random() - .5) * (1 + speed * .12);
  d.sw += d.swv * dt;
  poseGrip(d); d.trem = .012 + Math.min(.03, speed * .001);
  if (Math.random() < dt * .4) snd(d, 'servo', .5);
  // 객실·운전실 창에 붙어 있으면 안쪽 사람을 보고 창을 내리친다
  d.bangT = Math.max(0, d.bangT - dt);
  if (bar && d.bangT <= 0 && Math.random() < dt * .9) {
    const gx = d.gp.x - d.gr.car.off;
    if (targets.some(T => !T.roof && Math.abs(T.x - gx) < 3.2 && Math.sign(T.z) === d.gr.s)) d.bangT = .9;
  }
  if (bar && d.bangT > 0 && d.bangT < .42 && !d.banged) { d.banged = true; snd(d, 'glass', 1.5); S.shake = Math.max(S.shake, .05); impulse(d, _imp.set(0, 0, -1.5), 0); }
  if (d.bangT <= 0) d.banged = false;
  if (speed > CFG.shakeSpeed) {
    d.grip -= dt * (bar ? .1 : .16 + (speed - CFG.shakeSpeed) * .035) * (1 + Math.abs(d.sw) * .5);
    if (Math.random() < dt * 3) snd(d, 'scrape', .7);
    if (d.grip <= 0) { toFall(d, 2.5); return; }
    return;
  }
  d.hold -= dt;
  if (d.hold > 0 || d.bangT > 0) return;
  // 다음 행동: 봉 → 위 가장자리로 옮겨 잡기, 그 밖엔 넘어 올라감
  if (bar) {
    const up = GRIPS.find(g => g.car === d.gr.car && g.kind === 'gutter' && g.s === d.gr.s);
    if (up) { d.next = up; d.lock[0] = d.lock[1] = true; setState(d, 'reach'); snd(d, 'servo', 1.1); return; }
  }
  d.lock[0] = d.lock[1] = true; setState(d, 'climb'); d.K = makeClimb(d.gr.to - d.gp.y, d.gr.kind === 'rail' ? 2.4 : 2.9, d.gr.over || 0); snd(d, 'scrape');
}
/** 키 포즈로 움직이는 동안 (등반·옮겨 잡기·뛰어 잡기·내려오기). 손은 키 포즈가 정한 자리에 고정 */
function stepKeyed(d, dt, speed) {
  place(d);
  const K = d.state === 'reach' ? REACH : d.K, k = Math.min(1, d.st / K.dur);
  playKeys(d, K, k); d.lock[0] = d.lock[1] = true; d.trem = .008;
  poles(d, 1, 0, -.4, .12, .3, 1);
  if (d.state === 'climb' && k > .55 && k < .62 && !d.kneed) { d.kneed = true; snd(d, 'scrape', 1.1); impulse(d, _imp.set(0, .6, .5), 0); }
  if (d.state === 'jump' && k > .6 && !d.kneed) { d.kneed = true; snd(d, 'grip', 1.3); impulse(d, _imp.set(0, -2, .8), 0); }
  if (d.state === 'lower' && k > .9 && !d.kneed) { d.kneed = true; snd(d, 'land', 1.1); impulse(d, _imp.set(0, -2.6, 0), .5); }
  if (k < 1) return;
  d.kneed = false; d.lock[0] = d.lock[1] = false;
  if (d.state === 'reach') {                                // 봉 → 가장자리: 루트를 가장자리 점으로 옮겨 계속 매달림
    const g = d.next, x = d.gp.x; setGrip(d, g, x); gripTrain(d, _g); reroot(d, _g, d.gh);
    setState(d, 'hang'); d.blendT = 0; d.hold = rnd(.6, 1.6); d.lock[0] = d.lock[1] = true; return;
  }
  if (d.state === 'jump') { setState(d, 'hang'); d.blendT = 0; d.hold = rnd(.3, .9); d.sw = 0; d.swv = 1.5; d.lock[0] = d.lock[1] = true; return; }
  if (d.state === 'climb') {                                // 넘어옴: 루트를 바닥/지붕 위로 옮김
    const deck = d.gr.to - d.gp.y; _g.set(0, deck, .75); fromRoot(d, _g, _g); _g.y = d.gr.to;
    d.level = d.gr.to > F + 1 ? 'roof' : 'floor'; clampOnTrain(d, _g);
    reroot(d, _g, d.heading); d.gr = null; setState(d, 'rise'); d.blendT = .3; snd(d, 'servo', 1.2); return;
  }
  if (d.state === 'lower') {
    const fl = F - d.gp.y; _g.set(0, fl, -.75); fromRoot(d, _g, _g); _g.y = F;
    d.level = 'floor'; reroot(d, _g, d.heading + Math.PI); d.gr = null; setState(d, 'rise'); d.blendT = .3; return;
  }
}
/** 열차 위에서 설 수 있는 곳으로 */
function clampOnTrain(d, p) {
  const car = carForTrainX(p.x), lx = p.x + car.off;
  if (d.level === 'floor') { p.x = Math.max(car.x0 + .4, Math.min(car.x1 - .4, lx)) - car.off; p.z = Math.max(-1.0, Math.min(1.0, p.z)); }
  else { const x1 = car === driveCar ? 1.9 : car.x1 - .3; p.x = Math.max(car.x0 + .3, Math.min(x1, lx)) - car.off; p.z = Math.max(-1.4, Math.min(1.4, p.z)); }
  return p;
}

/** 숨을 자리 → 지나가는 차량의 부품으로 뛰어 붙음 */
function startLeap(d, dur, arc, X = d.a.s - S.sTrain) {
  const car = carForTrainX(X), lx = X + car.off, s = d.side;
  const kinds = car === powerCar ? ['rail'] : Math.random() < .7 ? ['bar', 'gutter'] : ['gutter', 'bar'];
  const pick = pickGrip(d, car, lx, s, kinds) || pickGrip(d, car, lx, s, ['rail', 'bar', 'gutter']);
  if (!pick) { startRag(d, _imp.copy(d.fr.R).multiplyScalar(-s * 3), 3); return; }
  setGrip(d, pick.g, pick.x);
  d.from.copy(d.g.position); d.qFrom.copy(d.g.quaternion);
  setState(d, 'leap'); d.blendT = .1; d.dur = dur * (1 + Math.abs(pick.x - lx) * .08); d.arc = arc; snd(d, 'servo', 1.3); impulse(d, _imp.set(0, 2, 1.5));
}
/** 천장 → 지붕(또는 배터리 칸 바닥)에 떨어지거나, 옆면 지붕 가장자리를 붙잡음 */
function startDrop(d) {
  const X = d.a.s - S.sTrain, car = carForTrainX(X);
  if (Math.abs(S.speed) > CFG.latchMaxSpeed + 4) { snd(d, 'servo'); startRag(d, _imp.copy(d.fr.U).multiplyScalar(-1.5), 3); return; }
  _p.copy(d.g.position).applyMatrix4(car.inv);
  if (car !== powerCar && Math.random() < .45) {                          // 옆면 가장자리를 붙잡고 매달림
    const s = _p.z >= 0 ? 1 : -1, pick = pickGrip(d, car, _p.x, s, ['gutter']);
    if (pick) { setGrip(d, pick.g, pick.x); d.from.copy(d.g.position); d.qFrom.copy(d.g.quaternion); setState(d, 'leap'); d.dur = .55; d.arc = .2; snd(d, 'servo', 1.3); return; }
  }
  let lx = Math.max(car.x0 + .7, Math.min(car.x1 - .7, _p.x)); if (car === driveCar) lx = Math.min(lx, 1.7);
  d.from.set(_p.x - car.off, _p.y, _p.z); d.to.set(lx - car.off, car === powerCar ? F : ROOF_Y, Math.max(-1.1, Math.min(1.1, _p.z)));
  d.level = car === powerCar ? 'floor' : 'roof';
  d.q0.copy(car.g.quaternion).invert().multiply(d.g.quaternion);
  d.heading = rnd(-Math.PI, Math.PI);
  setState(d, 'drop'); d.blendT = .1; d.dur = .6; snd(d, 'servo', 1.3);
}

/* ---------- 지붕 끝 → 배터리 칸 바닥으로 뛰어내림 ---------- */
function stepHop(d, dt) {
  const k = Math.min(1, d.st / d.dur), t0 = .32, t1 = .75;
  if (k < t0) { poseCrawl(d, false); d.P.H.y -= .25 * EASE.o(k / t0); d.P.sd.y += .2; d.trem = .03; }
  else if (k < t1) {
    const u = (k - t0) / (t1 - t0); d.tp.x = d.from.x + (d.to.x - d.from.x) * EASE.s(u); d.tp.y = d.from.y + (d.to.y - d.from.y) * u * u + Math.sin(u * Math.PI) * d.arc; d.tp.z = d.from.z + (d.to.z - d.from.z) * u;
    v3(d.P.H, 0, .95, 0); v3(d.P.sd, 0, 1, .3); v3(d.P.hand[0], .55, 1.25, .4); v3(d.P.hand[1], -.55, 1.25, .4); v3(d.P.foot[0], .18, .15 + .3 * (1 - u), .2); v3(d.P.foot[1], -.18, .3 * (1 - u), -.1);
  } else { if (!d.landed) { d.landed = true; d.tp.copy(d.to); snd(d, 'land', 1.2); S.shake = Math.max(S.shake, .08); impulse(d, _imp.set(0, -3, .4)); } poseStand(d, .9 - (k - t1) * 2); }
  place(d); if (k >= 1) { d.level = 'floor'; setState(d, 'rise'); }
}

/* ---------- 열차 위에서 ---------- */
/* 칸 사이 문(통로) 구간 [앞쪽 차량 뒤 끝 - 뒤 차량 앞 끝] (통합 x) */
const DOORS = () => [[-powerCar.off + powerCar.x1, driveCar.x0], [-cabinCar.off + cabinCar.x1, -powerCar.off + powerCar.x0]].map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
const DRIVE_LEDGE = () => GRIPS.find(g => g.kind === 'ledge' && g.car === driveCar), CABIN_LEDGE = () => GRIPS.find(g => g.kind === 'ledge' && g.car === cabinCar);
function stepWalk(d, dt, targets) {
  const roof = d.level === 'roof', car = carForTrainX(d.tp.x), lx = d.tp.x + car.off;
  // 같은 층 · (지붕이면) 같은 차량의 가장 가까운 사람
  let tg = null, bd = 1e9;
  for (const T of targets) {
    if (!!T.roof !== roof) continue; if (roof && carForTrainX(T.x) !== car) continue;
    const dd = Math.abs(T.x - d.tp.x) + Math.abs(T.z - d.tp.z) * .5; if (dd < bd) { bd = dd; tg = T; }
  }
  let gx, gz, goal = null;
  if (tg) { gx = tg.x; gz = tg.z;
    // 다른 칸에 있는 사람에게: 사이의 문(통로) 가까이에선 가운데로 붙어서 지나감
    if (!roof) for (const [a, b] of DOORS()) { const c = (a + b) / 2; if ((d.tp.x - c) * (gx - c) < 0 && Math.abs(d.tp.x - c) < 2.4) { gz = 0; break; } }
  }
  else if (roof) {                                          // 지붕에 상대가 없으면 배터리 칸 쪽 끝으로 가서 내려감
    const toBack = car === driveCar; gx = toBack ? -3.25 : -cabinCar.off + 3.25; gz = d.tp.z; goal = 'down';
  } else {
    const up = targets.find(T => T.roof);
    if (up) {                                               // 지붕 위 사람에게: 가까운 쪽 지붕 모서리로 가서 뛰어 잡음
      const g = carForTrainX(up.x) === driveCar ? DRIVE_LEDGE() : CABIN_LEDGE();
      gx = g.a.x - g.car.off + g.n.x * .75; gz = Math.max(-.55, Math.min(.55, d.tp.z)); goal = g;
    } else { gx = -powerCar.off + .2 + Math.sin(d.t * .2 + d.phase) * 1.5; gz = -.6; }   // 아무도 없으면 배터리 랙 근처를 서성임
  }
  const dx = gx - d.tp.x, dz = gz - d.tp.z, dist = tg ? Math.hypot(tg.x - d.tp.x, tg.z - d.tp.z) : Math.hypot(dx, dz);
  let vx = 0, vz = 0;

  if (d.state === 'twitch') {                               // 굳어서 부들부들 떨다가 → 비명과 함께 달려듦
    d.trem = .06; if (roof) poseCrawl(d, false); else poseLurch(d, -1, false);
    d.P.sd.z = .1; d.P.H.y += .05; d.P.hand[0].y += .3; d.P.hand[1].y += .4;
    if (!roof) stepFeet(d, dt, 0, 0, false);
    if (d.st > .5) { setState(d, 'sprint'); d.blendT = .05; snd(d, 'shriek', 1.6); }
    return;
  }
  if (d.state === 'windup') {
    const Kk = roof ? POUNCE : STRIKE, dur = Kk.dur * (d.fast ? .6 : 1), k = d.st / dur;
    if (roof) poseCrawl(d, false); else { poseStand(d, .15); stepFeet(d, dt, 0, 0, false); }
    playKeys(d, Kk, k); poles(d, .7, -.2, -1);
    if (k > Kk.hold[0] && k < Kk.hold[1]) { d.trem = .07; if (Math.random() < dt * 8) snd(d, 'tick', .8); }
    if (k > Kk.hit && !d.swung) { d.swung = true; snd(d, 'servo', 1.4); if (tg && dist < 1.95) { trainToWorld(d.tp, _p); H.hurt?.(CFG.hit, _p); } }
    if (k >= 1) { d.cool = CFG.hitCool; d.fast = false; setState(d, 'walk'); }
    return;
  }
  // 이동
  const sprint = d.state === 'sprint', blocked = d.stagger > 0;
  if (sprint && (!tg || dist < 1.4 || d.st > 2.4)) { setState(d, 'walk'); if (tg && dist < 1.9) { setState(d, 'windup'); d.fast = true; d.swung = false; d.blendT = .05; } }
  const run = d.state === 'sprint';
  let spd = roof ? CFG.crawl * (run ? 3.6 : 1) : run ? CFG.sprint : CFG.walk;
  if ((d.legHit || 0) >= 2) spd = CFG.crawl * (run ? 2.2 : .8);
  const stopAt = tg ? 1.15 : .1;
  if (!blocked && Math.hypot(dx, dz) > stopAt) {
    // 몸을 먼저 돌리고(둔하게), 바라보는 쪽으로만 나아감
    const want = Math.atan2(dx, dz + 1e-6); let dh = want - d.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    d.heading += Math.sign(dh) * Math.min(Math.abs(dh), dt * (run ? 5 : 1.6));
    const face = Math.max(0, Math.cos(dh));
    // 발을 드는 동안만 쏠려 나감
    const pushing = roof || d.fs[0].u >= 0 || d.fs[1].u >= 0;
    const m = spd * face * (roof ? 1 : pushing ? 1.35 : .3);
    vx = Math.sin(d.heading) * m; vz = Math.cos(d.heading) * m;
    d.tp.x += vx * dt; d.tp.z += vz * dt;
  }
  // 걸을 수 있는 곳에서 벗어나지 않게 (배터리 칸 양 끝 통로는 가운데만)
  if (roof) { const x1 = car === driveCar ? 1.9 : car.x1 - .2, l = d.tp.x + car.off; d.tp.x = Math.max(car.x0 + .15, Math.min(x1, l)) - car.off; d.tp.z = Math.max(-1.45, Math.min(1.45, d.tp.z)); }
  else {
    // 바닥은 세 칸 모두 걸어 다님 (운전실·객실 문으로 드나듦). 문 근처·통로에선 가운데로만
    d.tp.x = Math.max(-cabinCar.off + cabinCar.x0 + .4, Math.min(driveCar.x0 + 4.7, d.tp.x));
    const here = carForTrainX(d.tp.x), inDoor = DOORS().some(([a, b]) => d.tp.x > a - .45 && d.tp.x < b + .45);
    const zl = inDoor ? .42 : here === powerCar ? 1.05 : 1.4; d.tp.z = Math.max(-zl, Math.min(zl, d.tp.z));
  }
  d.tp.y = roof ? ROOF_Y : F;
  // 자세
  if (roof) { d.gait += Math.hypot(vx, vz) * dt / .5 * Math.PI; poseCrawl(d, Math.hypot(vx, vz) > .05); if (run) { d.P.H.y -= .1; d.P.sd.z += .2; } }
  else if ((d.legHit || 0) >= 2) { d.gait += Math.hypot(vx, vz) * dt / .45 * Math.PI; poseCrawl(d, Math.hypot(vx, vz) > .05); d.P.foot[d.limp].y += .25; d.P.foot[d.limp].z -= .3; }   // 다리가 망가져 끌며 기어 옴
  else { const sw = stepFeet(d, dt, vx, vz, run); poseLurch(d, sw, run); }
  separate(d, roof);
  if (run) d.trem = .02;
  if (blocked) return;
  // 공격 · 돌발 질주 (열차 위에선 드물게)
  if (tg && dist < (roof ? 1.5 : 1.4) && d.cool <= 0 && !run) { setState(d, 'windup'); d.blendT = .1; d.swung = false; snd(d, 'servo', 1.2); return; }
  if (tg && dist > 2.6 && d.sprintCD <= 0 && Math.random() < dt * .1) { d.sprintCD = rnd(14, 26); setState(d, 'twitch'); snd(d, 'tick', 1.5); d.rollTo = rnd(-1, 1); return; }
  // 목적지에 닿았을 때
  if (goal === 'down' && Math.hypot(dx, dz) < .35) startDescend(d, car);
  else if (goal && goal !== 'down' && Math.hypot(dx, dz) < .3) {          // 모서리 밑: 몸을 돌려 뛰어 잡음
    setGrip(d, goal, gripPoint(goal, _gl.set(0, 0, d.tp.z), _gl).x); d.gp.z = Math.max(-1.2, Math.min(1.2, d.tp.z));
    gripTrain(d, _g); reroot(d, _g, d.gh); d.K = makeJump(F - d.gp.y); setState(d, 'jump'); d.blendT = .15; snd(d, 'servo', 1.2);
  }
}
/* 객차·다른 안드로이드와 겹치지 않게: 골반·가슴·머리를 구로 보고 충돌 상자에서 밀어냄(수평만) */
const _cl = new THREE.Vector3(), _push = new THREE.Vector3();
function separate(d, roof) {
  d.g.updateMatrixWorld(); _push.set(0, 0, 0);
  const car = carForTrainX(d.tp.x);
  for (const c of [car, ...JOINTS]) {
    for (const ji of [0, 1, 2]) {
      _cl.copy(d.J[ji]).applyMatrix4(d.g.matrixWorld).applyMatrix4(c.inv); const r = ji === 2 ? .16 : .22;
      for (const b of c.boxes) {
        if (_cl.y < b.min[1] - r || _cl.y > b.max[1] + r) continue;
        if (b.max[1] <= F + .02 && _cl.y > b.max[1]) continue;                     // 바닥판은 무시
        const cx = Math.max(b.min[0], Math.min(b.max[0], _cl.x)), cz = Math.max(b.min[2], Math.min(b.max[2], _cl.z)), cy = Math.max(b.min[1], Math.min(b.max[1], _cl.y));
        let dx = _cl.x - cx, dz = _cl.z - cz; const dy = _cl.y - cy, dist = Math.hypot(dx, dy, dz);
        if (dist >= r) continue;
        if (Math.hypot(dx, dz) < 1e-4) {                                         // 상자 안: 가장 얕은 쪽으로
          const ox0 = _cl.x - b.min[0], ox1 = b.max[0] - _cl.x, oz0 = _cl.z - b.min[2], oz1 = b.max[2] - _cl.z, m = Math.min(ox0, ox1, oz0, oz1);
          if (m === ox0) dx = -(ox0 + r); else if (m === ox1) dx = ox1 + r; else if (m === oz0) dz = -(oz0 + r); else dz = oz1 + r;
          _push.x += dx; _push.z += dz;
        } else { const k = (r - dist) / Math.hypot(dx, dz); _push.x += dx * k; _push.z += dz * k; }
      }
    }
  }
  d.tp.x += Math.max(-.08, Math.min(.08, _push.x)); d.tp.z += Math.max(-.08, Math.min(.08, _push.z));
  for (const o of pool) {
    if (o === d || !o.alive || o.level !== d.level || !['walk', 'windup', 'sprint', 'twitch', 'rise'].includes(o.state)) continue;
    const dx = d.tp.x - o.tp.x, dz = d.tp.z - o.tp.z, dd = Math.hypot(dx, dz);
    if (dd < .62 && dd > 1e-4) { const k = (.62 - dd) * .5 / dd; d.tp.x += dx * k; d.tp.z += dz * k; }
  }
}
/** 지붕 끝에서 내려가는 방법을 그때그때: 뛰어내리기(착지 지점 제각각) / 모서리에 매달려 내려오기 */
function startDescend(d, car) {
  const dirX = car === driveCar ? -1 : 1, edgeX = car === driveCar ? -3.5 : -cabinCar.off + 3.5;
  if (Math.random() < .45) {
    const g = car === driveCar ? DRIVE_LEDGE() : CABIN_LEDGE();
    setGrip(d, g, 0); d.gp.z = Math.max(-1.2, Math.min(1.2, d.tp.z)); gripTrain(d, _g);
    reroot(d, _g, d.gh); d.K = makeLower(ROOF_Y - d.gp.y, F - d.gp.y); setState(d, 'lower'); d.blendT = .2; snd(d, 'scrape', .9);
    return;
  }
  d.from.copy(d.tp); d.to.set(edgeX + dirX * rnd(1.2, 3.2), F, rnd(-.9, .9));
  d.heading = Math.atan2(d.to.x - d.from.x, d.to.z - d.from.z); d.landed = false; d.dur = rnd(.85, 1.25); d.arc = rnd(.3, .9);
  setState(d, 'hop'); place(d);
}
function toFall(d, life) {
  frameAt(S.sTrain, FR);
  _imp.copy(FR.T).multiplyScalar(S.speed - Math.min(4, Math.abs(S.speed) * .25)).addScaledVector(FR.R, (d.gr ? d.gr.s : d.side) * 2.2).addScaledVector(FR.U, 1.2);
  d.gr = null; snd(d, 'scrape', 1.2); startRag(d, _imp, life);
}

/* ================= 공격받기 ================= */
const _o = new THREE.Vector3();
/* 부위: 머리(구) · 몸통 · 팔 2마디 · 다리 2마디(캡슐). 쓰러진 몸(랙돌)도 맞으면 그 관절이 튕긴다 */
const PARTS = [['torso', 0, 1, .24, -1], ['arm', 3, 4, .11, 0], ['arm', 4, 5, .1, 0], ['arm', 6, 7, .11, 1], ['arm', 7, 8, .1, 1],
  ['leg', 9, 10, .13, 0], ['leg', 10, 11, .12, 0], ['leg', 12, 13, .13, 1], ['leg', 13, 14, .12, 1]];
const JW = Array.from({ length: 15 }, () => new THREE.Vector3()), _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _w0 = new THREE.Vector3();
/** 광선(o + t·u, t≥0)과 선분 a-b 의 가장 가까운 거리. [t, 거리, 선분 위 비율] */
function raySeg(o, u, a, b) {
  const ab = _sb.subVectors(b, a), ao = _sa.subVectors(o, a), L2 = ab.lengthSq() || 1e-6;
  const ud = u.dot(ab), uo = u.dot(ao), abo = ab.dot(ao), den = L2 - ud * ud;
  let s = den > 1e-8 ? (abo - ud * uo) / den : 0; s = Math.max(0, Math.min(1, s));
  let t = ud * s - uo; if (t < 0) { t = 0; s = Math.max(0, Math.min(1, abo / L2)); }
  _w0.copy(a).addScaledVector(ab, s).sub(o).addScaledVector(u, -t);
  return [t, _w0.length(), s];
}
export function rayAndroid(origin, dir, maxDist) {
  let best = null, bt = maxDist;
  for (const d of pool) {
    if (!d.alive || d.state === 'inside' || d.state === 'knock') continue;
    const rag = d.state === 'rag';
    for (let i = 0; i < 15; i++) rag ? JW[i].copy(d.rp[i]) : JW[i].copy(d.J[i]).applyMatrix4(d.g.matrixWorld);
    // 머리
    const hp = rag ? JW[2] : d.hitH; _o.copy(hp).sub(origin); const th = _o.dot(dir);
    if (th > 0 && th < bt && _o.lengthSq() - th * th < .19 * .19) { bt = th; best = { droid: d, part: 'head', side: -1, joint: 2 }; }
    for (const [part, ia, ib, r, side] of PARTS) {
      const [tt, dist, s] = raySeg(origin, dir, JW[ia], JW[ib]);
      if (dist < r && tt < bt && tt > 0) { bt = tt; best = { droid: d, part, side, joint: s < .5 ? ia : ib }; }
    }
  }
  if (!best) return null;
  return Object.assign(best, { dist: bt, head: best.part === 'head', point: origin.clone().addScaledVector(dir, bt) });
}
const _ld = new THREE.Vector3();
/** 맞은 부위에 따라 다르게 반응 (방향은 루트 로컬로 바꿔서) */
function hitReact(d, dirWorld, power, part = 'torso', side = -1) {
  if (!dirWorld) return;
  _ld.copy(dirWorld).applyQuaternion(_q.copy(d.g.quaternion).invert());
  const V = d.QV;
  if (part === 'head') {                                     // 고개가 홱 꺾여 젖혀지고 몸은 반 박자 늦게 휘청
    V.look.addScaledVector(_ld, power * 3.2); V.look.y += power * .8; d.rollTo = (Math.random() < .5 ? -1 : 1) * rnd(.7, 1.3); d.roll += d.rollTo * .6;
    V.sd.addScaledVector(_ld, power * 1.4); V.H.addScaledVector(_ld, power * .3); d.stagger = Math.max(d.stagger, .6); d.freeze = 0;
  } else if (part === 'arm') {                               // 그 팔이 뒤로 튕겨 나가고 상체가 비틀림. 붙잡고 있던 손이면 놓침
    const i = side < 0 ? 1 : side; d.lock[i] = false; d.slipT = .6; d.slipI = i;
    V.hand[i].addScaledVector(_ld, power * 3.5).y += power * .8; V.sd.addScaledVector(_ld, power * .9);
    if (d.state === 'hang') d.grip -= .3;
    d.stagger = Math.max(d.stagger, .3);
  } else if (part === 'leg') {                               // 다리가 꺾여 주저앉음. 맞은 쪽을 절게 되고, 두 번 맞으면 기어서 다가옴
    const i = side < 0 ? 0 : side; d.limp = i; d.legHit = (d.legHit || 0) + 1;
    V.H.y -= power * .9; V.H.addScaledVector(_ld, power * .4); V.sd.addScaledVector(_ld, -power * .6);
    if (d.plant && d.fp) { _o.copy(dirWorld).applyQuaternion(_q.copy(carForTrainX(d.tp.x).g.quaternion).invert()); d.fp[i].x += _o.x * .3; d.fp[i].z += _o.z * .3; }
    else V.foot[i].addScaledVector(_ld, power * 2);
    d.stagger = Math.max(d.stagger, .9); d.kneel = .9;
    if (d.state === 'hang') d.swv += (Math.random() < .5 ? -1 : 1) * power;
  } else {                                                   // 몸통: 통째로 밀리며 허리가 꺾임
    impulse(d, _imp.copy(_ld).multiplyScalar(power).setY(_ld.y * power + .3), .9);
    V.sd.addScaledVector(_ld, power * 1.6); d.stagger = Math.max(d.stagger, .45);
    if (d.state === 'hang') d.swv += (Math.random() < .5 ? -1 : 1) * power * .6;
  }
}
/** 쓰러진 몸의 한 관절을 튕김 */
function ragKick(d, j, dirWorld, k) { if (j >= 0 && dirWorld) { d.rq[j].addScaledVector(dirWorld, -k); d.life = Math.max(d.life, d.st + 1.5); } }
export function damageAndroid(d, dmg, dirWorld, point, part = 'torso', side = -1, joint = 1) {
  if (!d.alive) return false;
  if (d.state === 'rag') { ragKick(d, joint, dirWorld, .14); return false; }
  d.hp -= dmg; d.flash = 1; d.freeze = 0;
  if (d.hp > 0) { A.hitSnd(false); hitReact(d, dirWorld, 2.6, part, side); if (d.state === 'hang' && d.grip <= 0) toFall(d, 2.5); return false; }
  A.hitSnd(true); H.reward?.(d.hitT.clone());
  d.eye.material = eyeMat; d.glow.visible = false; d.eyeOn = true; d.eyeT = 99;
  frameAt(S.sTrain, FR);
  _f.copy(dirWorld || FR.R).multiplyScalar(2.5).addScaledVector(FR.U, .8);
  if (!HIDDEN.includes(d.state)) _f.addScaledVector(FR.T, S.speed * .85);
  d.gr = null; startRag(d, _f, 4);
  ragKick(d, joint, dirWorld, part === 'head' ? .2 : .13);                // 맞은 곳이 먼저 꺾여 나감
  return true;
}
export function kickAndroid(origin, dir, range) {
  let hit = null, bd = range;
  for (const d of pool) {
    if (!d.alive || d.state === 'rag' || d.state === 'drop' || HIDDEN.includes(d.state)) continue;
    _o.copy(d.hitT).sub(origin);
    const dist = _o.length(); if (dist > bd + (ON_GRIP.includes(d.state) ? 1.1 : 0) || _o.dot(dir) / Math.max(dist, .01) < .3) continue;
    bd = dist; hit = d;
  }
  if (!hit) return false;
  hit.flash = 1; hit.freeze = 0;
  if (ON_GRIP.includes(hit.state) || hit.state === 'leap') { frameAt(S.sTrain, FR); hit.gr = null; startRag(hit, _imp.copy(dir).multiplyScalar(4).addScaledVector(FR.T, S.speed * .8).addScaledVector(FR.U, 1), 2.5); snd(hit, 'scrape', 1.2); }
  else {
    _o.copy(dir).applyQuaternion(_q.copy(carForTrainX(hit.tp.x).g.quaternion).invert());
    hit.tp.x += _o.x * 1.3; hit.tp.z += _o.z * 1.3; hit.stagger = 1.1; if (hit.state !== 'walk') setState(hit, 'walk'); hit.swung = false; resetFeet(hit);
    hitReact(hit, dir, 4.5, 'torso');
    const edge = hit.level === 'roof' ? 1.75 : 1.5;
    if (Math.abs(hit.tp.z) > edge && (hit.level === 'roof' || carForTrainX(hit.tp.x) === powerCar)) { hit.side = Math.sign(hit.tp.z); place(hit); frameAt(S.sTrain, FR); startRag(hit, _imp.copy(dir).multiplyScalar(4).addScaledVector(FR.T, S.speed * .8), 2.5); }
    else damageAndroid(hit, 1, dir);
  }
  return true;
}
export function __spawnAt(a, idx = 0) { const d = pool.find(x => !x.alive); if (d) spawnAt(d, a, idx); return d; }
/* 시험용: 열차 부품에 바로 매달린 상태로 */
export function __hangOn(car, kind, x, s) {
  const d = pool.find(o => !o.alive); if (!d) return null;
  spawnAt(d, { type: 'door', s: S.sTrain, side: s, gi: -1 - Math.random() * 1e6 });
  const pick = pickGrip(d, car, x, s, [kind]); if (!pick) return null;
  setGrip(d, pick.g, pick.x); gripTrain(d, d.tp); d.heading = d.gh; d.state = 'hang'; d.hold = holdTime(d); d.eyeOn = true; d.eyeT = 0;
  poseGrip(d); snapRig(d); place(d); applyRig(d); return d;
}
/* 시험용: 바닥/지붕에 바로 세움 */
export function __placeOn(x, level) {
  const d = pool.find(o => !o.alive); if (!d) return null;
  spawnAt(d, { type: 'door', s: S.sTrain, side: 1, gi: -1 - Math.random() * 1e6 });
  d.level = level; d.tp.set(x, level === 'roof' ? ROOF_Y : F, 0); d.heading = Math.PI / 2; d.state = 'walk'; d.eyeOn = true; d.eyeT = 0;
  poseStand(d); snapRig(d); place(d); resetFeet(d); applyRig(d); return d;
}
