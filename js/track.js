// 선로: 세계 X축으로 전진하며 높이(Y)·좌우(Z)가 진행 거리 s 의 함수.
//
// 도시는 길이 1400m 의 '구역'이 끝없이 이어진 구조. 구역 하나의 흐름(구역 로컬 거리 u):
//     0 ~  110  정비 터널 (완만한 굴절로 앞 시야를 가림)
//   110 ~  170  하역장 벽을 뚫고 나온 회랑 — 한쪽 벽이 열림
//   170 ~  450  같은 높이의 철교
//   450 ~  700  하역장 안 수평 주행 (크레인 아래)
//   700 ~ 1000  경사 상승 (완만한 굴곡 → 건너온 철교가 아래로 보임)
//  1000 ~ 1400  상부 정비 통로 (중간에 수직 갱도 쪽 개구부)
// 구역마다 다음 층으로 올라가므로 높이는 누적된다. 첫 구역(0)의 하역장은 시드와 무관하게 고정.
import * as THREE from 'three';
import { hash, clamp, getSeed } from './noise.js';

export const SECTOR = 1400;
export const U = { tunnelEnd: 110, shaft0: 110, bridge0: 170, bridge1: 450, ramp0: 700, ramp1: 1000, well0: 1185, well1: 1235, gate: -60 };
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let cacheSeed = null, secs = [];
/** 구역 k(≥0)의 설계값. m: 하역장이 열리는 쪽(+1 오른쪽/-1 왼쪽) */
export function sector(k) {
  if (cacheSeed !== getSeed()) { cacheSeed = getSeed(); secs = []; }
  for (let i = secs.length; i <= k; i++) {
    const prev = secs[i - 1], first = i === 0;
    secs.push({
      k: i, m: first ? 1 : hash(i, 31) < .5 ? -1 : 1,
      rise: first ? 40 : 35 + hash(i, 32) * 10,
      width: first ? 300 : 250 + hash(i, 34) * 150,
      wob: (hash(i, 33) - .5) * 44,                      // 상부 정비 통로의 굴절 (시드마다 다름)
      y0: prev ? prev.y0 + prev.rise : 0, z0: prev ? prev.z0 + prev.m * 40 : 0,
    });
  }
  return secs[k];
}
/** 구역 로컬 좌우 위치 (하역장 쪽이 +) */
export const localZ = (u, wob = 0) => 28 * sm(50, 150, u) + 62 * sm(450, 700, u) - 50 * sm(700, 1000, u) + wob * (sm(1040, 1150, u) - sm(1270, 1380, u));
export const localY = (u, rise) => rise * sm(700, 1000, u);

export function trackPos(s, v) {
  const k = Math.floor(s / SECTOR);
  if (k < 0) return v.set(s, 0, 0);
  const c = sector(k), u = s - k * SECTOR;
  return v.set(s, c.y0 + localY(u, c.rise), c.z0 + c.m * localZ(u, c.wob));
}

export const UP = new THREE.Vector3(0, 1, 0);
export const makeFrame = () => ({ T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), m: new THREE.Matrix4() });
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
/** s 지점의 접선(T)·위(U)·오른쪽(R) 기저 */
export function frameAt(s, out) {
  trackPos(s + .6, _p0); trackPos(s - .6, _p1);
  out.T.subVectors(_p0, _p1).normalize();
  out.R.crossVectors(out.T, UP).normalize();
  out.U.crossVectors(out.R, out.T).normalize();
  out.m.makeBasis(out.T, out.U, out.R);
  return out;
}
/** 실제 이동 거리 1m 당 s 증가량 보정 (경사·굴곡에서도 속도가 일정하게) */
export const arcScale = s => trackPos(s + .5, _p0).distanceTo(trackPos(s - .5, _p1));

/** 지금 지나는 곳 이름 (디버그 표시용) */
export function regionAt(s) {
  const k = Math.floor(s / SECTOR); if (k < 0) return '정비 터널';
  const u = s - k * SECTOR, n = `${k + 1}층 `;
  return n + (u < U.shaft0 ? '정비 터널' : u < U.bridge0 ? '하역장 회랑' : u < U.bridge1 ? '철교' : u < U.ramp0 ? '하역장' : u < U.ramp1 ? '경사 선로' : '상부 정비 통로');
}
