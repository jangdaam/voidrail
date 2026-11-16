// 보일러: 화실 연료 → 불 세기 → 압력 → 낼 수 있는 최고 속도
//
//  연료 상자(연료차) ──삽으로 퍼서 나르기──▶ 화실(기관실 운전대 앞)
//  화실 연료는 시간이 지나면 타서 줄고, 불 세기가 압력을 올린다.
//  기차가 빠를수록 증기(압력)를 많이 쓰고, 연료도 빨리 탄다.
//  압력이 너무 높으면 안전밸브가 열려 증기를 뿜고, 너무 낮으면 기차가 서서히 멈춘다.
import * as THREE from 'three';
import { C, prep, M, landMat } from './geo.js';
import { locoCar, tenderCar, gaugeNeedle, lamps, FUEL_BIN } from './train.js';
import { BOILER as B, F } from './config.js';
import { clamp } from './noise.js';
import { S } from './state.js';

export const boiler = { fire: B.fireStart, heat: .8, pressure: B.pressureStart, bin: B.binStart, venting: 0 };

/** 지금 압력으로 낼 수 있는 최고 속도 (m/s) */
export const maxSpeed = () => B.vmax * clamp((boiler.pressure - B.minWork) / (B.fullWork - B.minWork), 0, 1);

/* ---------- 시각: 화실 불, 연료 상자 장작 ---------- */
const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a2e });
const fire = new THREE.Mesh(new THREE.BoxGeometry(.013, .4, .5), fireMat);
fire.position.set(-.968, F + .6, 0); locoCar.g.add(fire);
const emberMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
const embers = new THREE.Mesh(new THREE.BoxGeometry(.012, .1, .42), emberMat);
embers.position.set(-.978, F + .45, 0); locoCar.g.add(embers);

const LOG = C('#7a5534'), LOG_END = C('#c9a06a');
export function logGeometry(len = .7, r = .09) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(prep(new THREE.CylinderGeometry(r, r, len, 6), LOG, M(0, 0, 0, 0, 0, Math.PI / 2)), landMat));
  for (const s of [-1, 1]) g.add(new THREE.Mesh(prep(new THREE.CylinderGeometry(r * .8, r * .8, .012, 6), LOG_END, M(s * (len / 2 + .004), 0, 0, 0, 0, Math.PI / 2)), landMat));
  return g;
}
/* 상자 안: 한 삽 분량 = 장작 한 묶음. 4열 × 3줄 × 2층 */
const binLogs = [];
{
  const xs = [-1.95, -1.15, -.35, .45], zs = [-1.85, -1.35, -.85];
  for (let layer = 0; layer < 2; layer++) for (const z of zs) for (const x of xs) {
    const g = new THREE.Group();
    for (let k = 0; k < 2; k++) { const l = logGeometry(.68, .085); l.position.set(0, .09 + k * .17, k ? .09 : -.09); l.rotation.y = (k - .5) * .12; g.add(l); }
    g.position.set(x + (layer ? .12 : 0), F + .06 + layer * .32, z); g.visible = false;
    tenderCar.g.add(g); binLogs.push(g);
  }
}

/* ---------- 조작 ---------- */
export const canScoop = () => boiler.bin > 0;
export function scoop() { if (boiler.bin <= 0) return false; boiler.bin--; return true; }
export function stoke() { boiler.fire = Math.min(boiler.fire + B.load, B.load * 4); return true; }
/** 배낭 목재를 상자로: 넣은 삽 수를 돌려줌 */
export function deposit(wood) { const n = Math.min(Math.floor(wood / B.woodPerLoad), B.binMax - boiler.bin); boiler.bin += n; return n; }

/* ---------- 매 프레임 ---------- */
let fireWarned = false, ventSound = 0;
export function updateBoiler(dt, hooks) {
  const b = boiler, throttle = clamp(S.speed / B.vmax, 0, 1);
  if (!hooks.remoteAuthority) {
    b.fire = Math.max(0, b.fire - (B.burnIdle + B.burnMax * throttle) * dt);
    const want = b.fire > 0 ? clamp(.35 + b.fire / 80, 0, 1) : 0;
    b.heat += (want - b.heat) * Math.min(1, dt * B.heatRate);
    b.pressure = clamp(b.pressure + (b.heat * B.gain - (B.useIdle + B.useMax * throttle)) * dt, 0, 1);
    if (b.pressure > B.valve) { b.pressure -= (b.pressure - B.valve) * Math.min(1, dt * 3); b.venting = .6; }
  }
  b.venting = Math.max(0, b.venting - dt);
  ventSound -= dt;
  if (b.venting > 0 && ventSound <= 0) { ventSound = .5; hooks.vent?.(); }
  if (b.fire < 12 && b.fire > 0 && !fireWarned) { fireWarned = true; hooks.warn?.('화실 불이 약해지고 있어요 — 연료차에서 장작을 퍼다 넣어 주세요'); }
  if (b.fire > 20) fireWarned = false;
  S.heat = b.heat; S.pressure = b.pressure;

  // 시각
  gaugeNeedle.rotation.x = 1.2 - b.pressure * 2.4 + (b.venting > 0 ? Math.sin(S.time * 60) * .04 : 0);
  const flick = .85 + Math.sin(S.time * 13) * .08 + Math.sin(S.time * 31) * .07;
  fireMat.color.setRGB(.12 + .95 * b.heat * flick, .05 + .45 * b.heat * flick, .03 + .1 * b.heat);
  emberMat.color.setRGB(.2 + .8 * Math.min(1, b.fire / 20), .08 + .7 * Math.min(1, b.fire / 20) * flick, .04);
  fire.scale.y = .3 + .7 * b.heat * flick;
  lamps[0].userData.dayI = 4 * b.heat * flick; lamps[0].userData.nightI = 1 + 7 * b.heat;
  for (let i = 0; i < binLogs.length; i++) binLogs[i].visible = i < b.bin;
}

/* 연료 상자·화실의 위치 (상호작용용, 차량 로컬) */
export const BIN_CENTER = new THREE.Vector3((FUEL_BIN.x0 + FUEL_BIN.x1) / 2, F + .7, (FUEL_BIN.z0 + FUEL_BIN.z1) / 2);
export const FIREBOX = new THREE.Vector3(-.97, F + .6, 0);

/* 멀티플레이: 기관사 기준 상태 공유 */
export const boilerState = () => ({ f: +boiler.fire.toFixed(2), h: +boiler.heat.toFixed(3), p: +boiler.pressure.toFixed(3), b: boiler.bin });
export function applyBoilerState(st) {
  if (!st) return;
  boiler.fire = st.f; boiler.bin = st.b;
  boiler.heat += (st.h - boiler.heat) * .5; boiler.pressure += (st.p - boiler.pressure) * .5;
}
export function resetBoiler() { Object.assign(boiler, { fire: B.fireStart, heat: .8, pressure: B.pressureStart, bin: B.binStart, venting: 0 }); }
