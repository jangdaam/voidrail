// 추적자: 선로를 타고 뒤에서 쫓아오는 '선로 포식자'
//
//  평소엔 천천히 달리며 자원을 줍다가, 추적자가 나타나면 연료를 태워 속도를 올려 따돌리거나
//  맨 뒤 칸에서 권총으로 머리를 쏴 밀어내야 한다.
//   - 나타나면 400m 뒤에서 출발, 점점 빨라짐 (최고 속도 < 기차 최고 속도)
//   - 거리가 벌어지면(560m) 포기, 일정 시간이 지나도 지쳐서 돌아감
//   - 따라잡히면 맨 뒤 칸을 들이받음: 압력 크게 감소 + 큰 흔들림 + 숙소칸 사람 피해, 잠깐 뒤로 튕겨남
//   - 머리(빛나는 눈)를 쏘면 비틀거리며 뒤로 밀림, 체력이 다하면 물러나며 고철을 흘림
import * as THREE from 'three';
import { C, prep, M, merged, landMat, glowMat } from './geo.js';
import { scene } from './scene.js';
import { trackPos, frameAt, makeFrame, arcScale } from './track.js';
import { cabinCar } from './train.js';
import { player } from './player.js';
import { boiler } from './boiler.js';
import { sparkAt } from './fx.js';
import { CHASE } from './config.js';
import { S } from './state.js';
import * as A from './audio.js';
import { feel } from './feel.js';
import { damagePlayer, dropShards, raid } from './raid.js';

let H = {};   // { toast, banner, isClient(), sendEv(d, to?), selfId() }
const client = () => !!H.isClient?.();
export function initChaser(hooks) { H = hooks; }

/* ---------- 모델: 머리 + 마디 몸통 (각 마디가 선로를 따라감) ---------- */
const SHELL = C('#2a2238'), SHELL2 = C('#43365c'), PLATE = C('#5c4a7a'), BONE = C('#d8cfe6'), LEG = C('#1c1626');
const headGeo = merged([
  prep(new THREE.IcosahedronGeometry(1.5, 0), SHELL, M(0, 1.5, 0, 0, 0, 0, 1.5, 1, 1.15)),
  prep(new THREE.IcosahedronGeometry(1.1, 0), SHELL2, M(.9, 1.9, 0, 0, 0, 0, 1.2, .8, 1)),
  prep(new THREE.ConeGeometry(.28, 1.4, 4), BONE, M(2.2, .9, .7, 0, .3, -Math.PI / 2 - .35)),     // 큰 턱
  prep(new THREE.ConeGeometry(.28, 1.4, 4), BONE, M(2.2, .9, -.7, 0, -.3, -Math.PI / 2 - .35)),
  prep(new THREE.ConeGeometry(.35, 1.2, 4), PLATE, M(-.3, 3.0, 0, 0, 0, .5)),                    // 볏
  prep(new THREE.ConeGeometry(.25, .9, 4), PLATE, M(.5, 2.8, .8, .4, 0, .4)),
  prep(new THREE.ConeGeometry(.25, .9, 4), PLATE, M(.5, 2.8, -.8, -.4, 0, .4)),
]);
const eyesGeo = merged([[1.85, 1.95, .55], [1.85, 1.95, -.55], [1.6, 2.35, .3], [1.6, 2.35, -.3]].map(([x, y, z], i) => prep(new THREE.IcosahedronGeometry(i < 2 ? .22 : .14, 0), C('#ff5ad1'), M(x, y, z))));
const segGeo = merged([
  prep(new THREE.IcosahedronGeometry(1.2, 0), SHELL, M(0, 1.3, 0, 0, 0, 0, 1.3, .9, 1.1)),
  prep(new THREE.BoxGeometry(1.6, .25, 2.2), PLATE, M(0, 2.15, 0, 0, 0, .1)),
  prep(new THREE.ConeGeometry(.22, .8, 4), PLATE, M(0, 2.6, 0)),
]);
const legGeo = prep(new THREE.BoxGeometry(.18, 1.5, .18), LEG, M(0, -.7, 0));

const SEGS = 7, SPACING = 3.4;
const root = new THREE.Group(); root.visible = false; scene.add(root);
const mat = landMat.clone(); mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 0;
const parts = [];
for (let i = 0; i < SEGS; i++) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(i === 0 ? headGeo : segGeo, mat); body.castShadow = true; g.add(body);
  if (i === 0) { g.add(new THREE.Mesh(eyesGeo, glowMat)); }
  const legs = [];
  for (const side of [1, -1]) { const l = new THREE.Mesh(legGeo, mat); l.position.set(0, 1.1, side * 1.15); g.add(l); legs.push(l); }
  const sc = (i === 0 ? 1 : 1 - i * .07) * 1.4; g.scale.setScalar(sc);
  root.add(g); parts.push({ g, legs, frame: makeFrame() });
}

/* ---------- 상태 ---------- */
export const chase = { active: false, gap: 0, speed: 0, hp: 0, t: 0, next: CHASE.firstDelay, stun: 0, flash: 0, rammed: 0, warned: false };
const rearS = () => S.sTrain - cabinCar.off + cabinCar.x0;     // 맨 뒤 칸 끝
export const headS = () => rearS() - chase.gap;

export function startChase() {
  if (chase.active) return;
  Object.assign(chase, { active: true, gap: CHASE.startGap, speed: CHASE.speed0, hp: CHASE.hp, t: 0, stun: 0, flash: 0, rammed: 0, warned: false });
  root.visible = true;
  H.banner?.('⚠ 뒤에서 무언가 쫓아와요'); H.toast?.('선로 포식자! 화실에 장작을 넣고 속도를 올려 따돌리거나, 맨 뒤 칸에서 머리를 쏘세요');
  A.chaseRoar(.6); feel.shake(.1);
}
function endChase(msg, drop) {
  chase.active = false; root.visible = false; A.setRumble(0);
  if (!client() && msg) H.sendEv?.({ k: 'cend', msg, drop: !!drop });
  chase.next = CHASE.intervalMin + Math.random() * (CHASE.intervalMax - CHASE.intervalMin);
  if (msg) H.toast?.(msg);
  if (drop) A.raidClear();
}

/* ---------- 매 프레임 ---------- */
const _p = new THREE.Vector3(), _w = new THREE.Vector3();
export function updateChaser(dt, authority) {
  if (!chase.active) {
    if (authority && S.started && !S.loading) { chase.next -= dt; if (chase.next <= 0) { if (raid.active) chase.next = 20; else startChase(); } }
    return;
  }
  chase.t += dt; chase.flash = Math.max(0, chase.flash - dt * 5);
  if (!authority) chase.gap += (S.speed - (chase.stun > 0 ? -6 : chase.speed)) * dt;   // 동기화 사이 예측
  if (authority) {
    chase.speed = Math.min(CHASE.speedMax, chase.speed + CHASE.accel * dt);
    const v = chase.stun > 0 ? -6 : chase.speed;        // 비틀거리는 동안은 뒤로 밀림
    chase.stun = Math.max(0, chase.stun - dt);
    chase.gap += (S.speed - v) * dt;                    // 기차가 더 빠르면 벌어짐
    if (chase.gap <= CHASE.ramGap) ram();
    if (chase.gap > CHASE.loseGap) return endChase('선로 포식자를 따돌렸어요!');
    if (chase.t > CHASE.maxTime) return endChase('선로 포식자가 지쳐서 물러났어요');
  }
  // 경고: 가까워지면 한 번 더
  if (!chase.warned && chase.gap < 90) { chase.warned = true; H.toast?.('바로 뒤까지 따라왔어요!'); A.chaseRoar(1); }
  A.setRumble(Math.max(0, 1 - chase.gap / 260));

  // 모습: 머리부터 마디마다 선로 위로
  const hs = headS();
  for (let i = 0; i < SEGS; i++) {
    const P = parts[i], s = hs - i * SPACING;
    frameAt(s, P.frame); trackPos(s, P.g.position);
    const wig = Math.sin(chase.t * 9 - i * .9);
    P.g.position.addScaledVector(P.frame.U, .2 + Math.abs(wig) * .25 + (i === 0 ? Math.sin(chase.t * 5) * .2 : 0)).addScaledVector(P.frame.R, wig * .25);
    P.g.quaternion.setFromRotationMatrix(P.frame.m);
    P.g.rotateX(wig * .08);
    if (i === 0) P.g.rotateZ(Math.sin(chase.t * 4) * .06 + (chase.stun > 0 ? .25 : 0));
    const stride = Math.sin(chase.t * 14 + i * 1.3);
    P.legs[0].rotation.z = stride * .7; P.legs[1].rotation.z = -stride * .7;
  }
  mat.emissiveIntensity = chase.flash;
  // 가까우면 선로에서 불꽃
  if (chase.gap < 60 && Math.random() < dt * 10) { trackPos(hs + 1, _p); sparkAt(_p, 0xffb060, 3, 3); }
}

function ram() {
  chase.gap = CHASE.ramGap + CHASE.knockback; chase.stun = 1.2; chase.rammed++;
  boiler.pressure = Math.max(0, boiler.pressure - CHASE.ramPressure);
  S.speed *= .6;
  ramFx(); H.sendEv?.({ k: 'ram' });
}
function ramFx() {
  feel.shake(.6); A.ramCrash(); H.toast?.('들이받혔어요! 압력이 크게 떨어졌어요');
  if (player.car === cabinCar && player.inGrav) damagePlayer(CHASE.ramDamage, null);
}

/* ---------- 사격 판정 ---------- */
const _o = new THREE.Vector3();
/** 광선이 머리에 맞는지 (월드) */
export function rayChaser(origin, dir, maxDist) {
  if (!chase.active) return null;
  const head = parts[0].g; _w.set(1.2, 1.9, 0).applyMatrix4(head.matrixWorld);
  _o.subVectors(_w, origin); const t = _o.dot(dir);
  if (t < 0 || t > maxDist || _o.lengthSq() - t * t > CHASE.headR * CHASE.headR) return null;
  return { dist: t, point: origin.clone().addScaledVector(dir, t) };
}
export function hitChaser(dmg, point, by = 'me') {
  if (client() && by === 'me') {               // 판정은 기관사가: 연출만 먼저
    chase.flash = 1; feel.floatNumber(point, dmg); feel.hitMarker(false); feel.hitstop(.03); sparkAt(point, 0xff5ad1, 10, 4); A.hitThwack();
    H.sendEv?.({ k: 'hitc', d: dmg, p: point.toArray() }); return;
  }
  if (!chase.active) return;
  chase.hp -= dmg; chase.flash = 1; chase.gap += CHASE.hitPush * dmg; chase.stun = Math.max(chase.stun, .25);
  sparkAt(point, 0xff5ad1, 10, 4);
  if (by === 'me') { feel.floatNumber(point, dmg); feel.hitMarker(chase.hp <= 0); feel.hitstop(.03); }
  if (chase.hp <= 0) {
    killFx(point, by);
    H.sendEv?.({ k: 'ckill', by: by === 'me' ? H.selfId?.() : by, p: point.toArray() });
    endChase('선로 포식자가 비명을 지르며 물러났어요!', true);
  } else A.hitThwack();
}
function killFx(point, by) { A.chaseRoar(1.2); feel.shake(.25); if (by === 'me') feel.hitMarker(true); dropShards(point, CHASE.dropScrap, by); }
/** 추적자 관련 이벤트 수신 */
const _pt = new THREE.Vector3();
export function onChaseEv(d, from) {
  if (d.k === 'hitc' && !client()) hitChaser(d.d, _pt.fromArray(d.p).clone(), from);
  else if (d.k === 'ram') ramFx();
  else if (d.k === 'ckill') killFx(_pt.fromArray(d.p).clone(), d.by === H.selfId?.() ? 'me' : d.by);
  else if (d.k === 'cend') { if (chase.active) { chase.active = false; root.visible = false; A.setRumble(0); } H.toast?.(d.msg); if (d.drop) A.raidClear(); }
}

/* 멀티플레이: 기관사 기준 */
export const chaseState = () => chase.active ? { g: +chase.gap.toFixed(1), h: chase.hp, v: +chase.speed.toFixed(2), st: +chase.stun.toFixed(2) } : null;
export function applyChaseState(st) {
  if (!st) { if (chase.active) endChase(); return; }
  if (!chase.active) { chase.active = true; root.visible = true; chase.warned = false; H.banner?.('⚠ 뒤에서 무언가 쫓아와요'); }
  chase.gap += (st.g - chase.gap) * .5; chase.hp = st.h; chase.speed = st.v; chase.stun = st.st;
}
export const headWorld = out => out.set(1.2, 1.9, 0).applyMatrix4(parts[0].g.matrixWorld);
export const chaseInfo = () => chase.active ? { gap: chase.gap, hp: chase.hp } : null;
