// 무한 선로 곡선, 선로 좌표계, 지역(바이옴) 판정
import * as THREE from 'three';
import { fbm, hash, clamp, smooth } from './noise.js';
import { BIOMES, BL } from './config.js';

export const trackY = s => (fbm(s * .0032, 3) - .5) * 52;
export const trackZ = s => (fbm(s * .0022, 5) - .5) * 280;
export const trackPos = (s, v) => v.set(s, trackY(s), trackZ(s));

export const UP = new THREE.Vector3(0, 1, 0);
export const makeFrame = () => ({ T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), m: new THREE.Matrix4() });
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
/** s 지점의 접선(T)·위(U)·오른쪽(R) 기저. out 을 재사용해 할당 없음 */
export function frameAt(s, out) {
  trackPos(s + .6, _p0); trackPos(s - .6, _p1);
  out.T.subVectors(_p0, _p1).normalize();
  out.R.crossVectors(out.T, UP).normalize();
  out.U.crossVectors(out.R, out.T).normalize();
  out.m.makeBasis(out.T, out.U, out.R);
  return out;
}
/** 실제 이동 거리 1m 당 s 증가량 보정 */
export const arcScale = s => trackPos(s + .5, _p0).distanceTo(trackPos(s - .5, _p1));

let order = BIOMES.map((_, i) => i);
export function shuffleOrder() {
  order = BIOMES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(hash(i, 777) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
}
export function biomeAt(s) {
  const L = order.length, i = Math.floor(s / BL), f = s / BL - i;
  const ia = order[((i % L) + L) % L], ic = order[(((i + 1) % L) + L) % L];
  return { a: BIOMES[ia], c: BIOMES[ic], ia, ic, t: smooth(clamp((f - .76) / .24, 0, 1)) };
}
