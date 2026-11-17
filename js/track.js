// Rail endpoint contract: every sector connects at local (1400, rise, 40*m).
// Ordinary ridges return to their entry height; only a reserved ascent changes the endpoint elevation.
import * as THREE from 'three';
import {getRun} from './run-state.js';
import {EVENT_TYPES} from './run-director.js';
import { hash, clamp, getSeed } from './noise.js';

export const SECTOR = 1400;
export const U = { tunnelEnd: 110, shaft0: 110, bridge0: 170, bridge1: 450, ramp0: 700, ramp1: 1000, well0: 1185, well1: 1235, gate: -60 };
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let cacheSeed = null, cacheRun = null, cacheLayout = -1, secs = [];
/** 구역 k(≥0)의 설계값. m: 하역장이 열리는 쪽(+1 오른쪽/-1 왼쪽) */
export function sector(k) {
  const run = getRun();
  if (cacheSeed !== getSeed() || cacheRun !== run || cacheLayout !== run.layoutRevision) { cacheSeed = getSeed(); cacheRun = run; cacheLayout = run.layoutRevision; secs = []; }
  for (let i = secs.length; i <= k; i++) {
    const prev = secs[i - 1], first = i === 0, kind = run.typeAt(i);
    const width=first?300:250+hash(i,34)*150;
    const route=kind!=='ordinary'?'authored':first?'ridge':['central','ridge','weave'][Math.floor(hash(i,61)*3)];
    secs.push({
      k: i, kind, route, crest:18+hash(i,62)*18, m: first ? 1 : hash(i, 31) < .5 ? -1 : 1,
      rise: EVENT_TYPES[kind]?.rise || 0,
      width,
      wob: (hash(i, 33) - .5) * 44,                      // 상부 정비 통로의 굴절 (시드마다 다름)
      y0: prev ? prev.y0 + prev.rise : 0, z0: prev ? prev.z0 + prev.m * 40 : 0,
    });
  }
  return secs[k];
}
/** 구역 로컬 좌우 위치 (하역장 쪽이 +) */
export const localZ = (u, wob = 0) => 28 * sm(50, 150, u) + 62 * sm(450, 700, u) - 50 * sm(700, 1000, u) + wob * (sm(1040, 1150, u) - sm(1270, 1380, u));
export const localY = (u, rise) => rise * sm(700, 1000, u);

// Courses share entry/exit sockets but cross the canyon at different heights.
export function routeZ(c,u) {
  if(c.kind!=='ordinary')return localZ(u,c.wob);
  const cross=sm(170,460,u)-sm(740,1000,u);
  const center=(c.width*.5-55)*cross;
  const weave=c.route==='weave'?c.width*.16*(sm(250,470,u)-2*sm(470,680,u)+sm(680,930,u)):0;
  return localZ(u,c.wob)+center+weave;
}
export function routeY(c,u) {
  if(c.kind!=='ordinary')return localY(u,c.rise);
  return c.route==='ridge'?c.crest*(sm(230,580,u)-sm(700,1000,u)):0;
}
export function trackPos(s, v) {
  const k = Math.floor(s / SECTOR);
  if (k < 0) return v.set(s, 0, 0);
  const c = sector(k), u = s - k * SECTOR;
  return v.set(s, c.y0 + routeY(c,u), c.z0 + c.m * routeZ(c,u));
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
  const c = sector(k), u = s - k * SECTOR, n = '하역장 · ' + (c.kind === 'ordinary' ? ({central:'중앙 횡단교 ',ridge:'상승 조망교 ',weave:'교차 운송교 '}[c.route]) : EVENT_TYPES[c.kind].label + ' ');
  return n + (u < U.shaft0 ? '정비 터널' : u < U.bridge0 ? '하역장 회랑' : u < U.bridge1 ? '철교' : u < U.ramp0 ? '하역장' : u < U.ramp1 ? (c.rise ? '경사 선로' : '운송 고가') : '정비 통로');
}
