// 운전과 전력: 레버 3개(주행 단수 · 브레이크 · 전후진), 배터리, 발전기, 방전 시 수동 크랭크
//
//  - 단수가 높을수록 빠르지만 전력을 많이 쓴다 (1단 분당 20% ~ 4단 분당 60%).
//  - 발전기가 늘 조금씩 충전하지만(분당 4%) 그것만으로 달리려면 멈춰서 오래 기다려야 한다.
//  - 0%가 되면 조명이 꺼지고 열차가 선다. 누군가 맨 뒤 크랭크를 돌리는 동안에만 천천히 움직인다.
//  - 운전실을 비워도 열차는 그대로 달린다 (자동 브레이크 없음).
import { DRIVE } from './config.js';
import { S } from './state.js';
import { clamp } from './noise.js';
import { showBattery, crank } from './train.js';
import * as A from './audio.js';

let H = {};                       // { toast, send(op) }
export const initPower = hooks => H = hooks;
let remoteCrank = 0, crankAng = 0, crankTickT = 0;

/** 조작 한 번. 내 조작은 다른 승객에게도 보내고(send), 받은 조작은 그대로 적용한다 */
export function applyOp(op, arg, remote = false) {
  let ok = true;
  if (op === 'notch+') { if (S.powered && S.notch < 4) S.notch++; else ok = false; }
  else if (op === 'notch-') { if (S.notch > 0) S.notch--; else ok = false; }
  else if (op === 'brake') S.brake = !S.brake;
  else if (op === 'dir') { if (Math.abs(S.speed) < .6) S.dir = -S.dir; else ok = false; }
  else if (op === 'charge') S.battery = clamp(S.battery + arg, 0, DRIVE.capacity);
  else if (op === 'crank') remoteCrank = arg ? performance.now() + 600 : 0;
  if (!remote) {
    if (ok) { if (op !== 'crank' && op !== 'charge') A.leverClick(); H.send?.({ k: 'op', op, arg }); }
    else if (op === 'dir') H.toast?.('완전히 멈춘 뒤에 방향을 바꿀 수 있어요');
    else if (op === 'notch+' && !S.powered) H.toast?.('전력이 없어요');
  }
  return ok;
}
export const resetPower = () => Object.assign(S, { notch: 0, brake: true, dir: 1, battery: DRIVE.capacity, powered: true, speed: 0, targetSpeed: 0, cranking: false });

/** authority: 전력 계산을 맡는 쪽(혼자거나 방장). crankHeld: 내가 크랭크를 돌리고 있는가 */
export function updatePower(dt, authority, crankHeld) {
  if (authority) {
    const drain = S.powered && !S.brake ? DRIVE.drain[S.notch] : 0;
    S.battery = clamp(S.battery + (DRIVE.generator - drain) * dt / 60, 0, DRIVE.capacity);
    if (S.powered && S.battery <= 0) { S.powered = false; S.notch = 0; }
    else if (!S.powered && S.battery >= DRIVE.restore) S.powered = true;
  }
  if (S.powered !== wasPowered) { wasPowered = S.powered; if (S.powered) { A.powerUp(); H.toast?.('전원이 돌아왔어요'); } else { A.powerDown(); H.toast?.('전력이 바닥났어요 — 맨 뒤 크랭크를 돌려야 움직여요'); } }
  if (crankHeld !== sentCrank || (crankHeld && (crankSendT -= dt) <= 0)) { sentCrank = crankHeld; crankSendT = .4; H.send?.({ k: 'op', op: 'crank', arg: crankHeld ? 1 : 0 }); }
  S.cranking = !S.powered && (crankHeld || performance.now() < remoteCrank);

  let target = 0;
  if (!S.brake) target = S.powered ? S.dir * DRIVE.speeds[S.notch] : S.cranking ? S.dir * DRIVE.crankSpeed : 0;
  const speeding = Math.abs(target) > Math.abs(S.speed) && target * S.speed >= 0;
  const rate = S.brake ? DRIVE.brake : speeding ? DRIVE.accel : S.powered ? DRIVE.coast : DRIVE.dead;      // 방전되면 모터 저항으로 금방 선다
  const d = target - S.speed; S.speed += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  S.targetSpeed = target;

  showBattery(S.battery / DRIVE.capacity * 100, S.powered);
  if (S.cranking) { crankAng += dt * 5; crank.rotation.x = crankAng; if ((crankTickT -= dt) <= 0) { crankTickT = .32; A.crankTick(); } }
}
let wasPowered = true, sentCrank = false, crankSendT = 0;

export const powerState = () => ({ n: S.notch, b: S.brake ? 1 : 0, d: S.dir, e: +S.battery.toFixed(2), p: S.powered ? 1 : 0 });
export function applyPowerState(st) {
  if (!st || typeof st.e !== 'number') return;
  S.notch = st.n | 0; S.brake = !!st.b; S.dir = st.d < 0 ? -1 : 1; S.battery = st.e; S.powered = !!st.p;
}
