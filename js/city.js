// 지하 산업도시 생성
//
// 두 층으로 나눠 만든다.
//  1) 선로 청크(60m): 레일·침목, 정비 터널(벽·늑골 기둥·배관·작업등·정비문). 열차 주변만 유지.
//     세부 배치(배관 수, 작업등, 문)는 시드에 따라 달라진다.
//  2) 구역 세트(하역장): 방벽, 맞은편 작업층, 철교, 크레인, 화물판, 승강기 등 '한 공간'을 통째로.
//     멀리서도 보여야 하므로 구역에 다가가기 전(앞 터널 안)에 여러 프레임에 나눠 미리 만든다.
//     일반 구역은 시드 기반으로 합성하고, 예약된 이벤트 구역만 직접 설계한 세트를 사용한다.
// 모든 정적 구조물은 Mesher 로 재질별 메시 몇 개에 합친다(그리기 호출 최소화). 그림자·충돌 없음.
import * as THREE from 'three';
import { buildHarbor, animateHarbor } from './harbor.js';
import {ordinaryHarborJobs,animateOrdinaryHarbor,ordinaryPlan} from './ordinary-harbor.js';
import {getRun} from './run-state.js';
import { C, Mesher, landMat, glowMat, woodMat, steelMat, prep, M as MX, merged } from './geo.js';
import { trackPos, frameAt, makeFrame, sector, localZ, SECTOR, U, routeZ } from './track.js';
import { scene, camera, renderer } from './scene.js';
import { CH, SEG, STEP, QUALITY } from './config.js';
import { hash, mulberry, getSeed } from './noise.js';
import { S } from './state.js';

/* ---------- 색 ---------- */
const STEELD = C('#14171b'), STEEL = C('#303a3d'), STEELL = C('#505c5c'), CONCD = C('#343c3d'), CONC = C('#434950'), CONCL = C('#5a6169'),
  RUST = C('#553222'), RUSTL = C('#80492a'), HAZ = C('#8d7743');
/* 조명은 희고 푸르게. 따뜻한 색(호박·적색)은 화물판 경고등처럼 몇 곳에만 */
const WARM = C('#e2ccb0'), WHITE = C('#a8c6ea'), AMBER = C('#ff9a30'), RED = C('#e04a30'), DIMWARM = C('#8fa3b8'), DIMWHITE = C('#587592');

/* ---------- 불빛 번짐(헤일로): 점 하나 = 불빛 하나. 수백 개도 그리기 호출 1번 ---------- */
const haloMat = new THREE.ShaderMaterial({
  uniforms: { scale: { value: 600 } },
  vertexShader: `attribute float size; attribute vec3 col; varying vec3 vC; uniform float scale;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); float d = -mv.z;
      gl_PointSize = clamp(size*scale/d*.6, 0., 55.);
      vC = col * .32 * exp(-d*.0035) * min(1., size*scale/d*.6 + .35);      // 멀수록 흐려지되 안개에 완전히 묻히지는 않음
      gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ float r = length(gl_PointCoord-.5)*2.; float a = smoothstep(1.,0.,r); gl_FragColor = vec4(vC*a*a*a, 1.); }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
});
class Halos {
  constructor(ox = 0, oy = 0, oz = 0, mz = 1) { this.p = []; this.c = []; this.s = []; this.ox = ox; this.oy = oy; this.oz = oz; this.mz = mz; }
  add(x, y, z, size, col, k = 1) { this.p.push(this.ox + x, this.oy + y, this.oz + z * this.mz); this.c.push(col.r * k, col.g * k, col.b * k); this.s.push(size); }
  raw(v, size, col, k = 1) { this.p.push(v.x, v.y, v.z); this.c.push(col.r * k, col.g * k, col.b * k); this.s.push(size); }
  build() {
    if (!this.s.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('col', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(this.s), 1));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, haloMat); pts.matrixAutoUpdate = false; return pts;
  }
}
/* 빛 웅덩이: 작업등이 벽·바닥에 떨어뜨린 빛을 덧셈 원판으로 흉내 (실제 광원 없이 넓은 면의 크기를 드러냄) */
const poolMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
poolMat.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
    float attenuation = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    gl_FragColor.rgb *= attenuation;
  #endif`);
};
class Pools {
  constructor() { this.p = []; this.c = []; }
  /** 중심 c, 면을 이루는 두 축 u·v, 반지름 r */
  disc(cx, cy, cz, ux, uy, uz, vx, vy, vz, r, col, k) {
    const N = 24, P = this.p, Cc = this.c; k *= .36;
    for (let i = 0; i < N; i++) {
      const a = i / N * 6.2832, b = (i + 1) / N * 6.2832, ca = Math.cos(a) * r, sa = Math.sin(a) * r, cb = Math.cos(b) * r, sb = Math.sin(b) * r;
      P.push(cx, cy, cz, cx + ux * ca + vx * sa, cy + uy * ca + vy * sa, cz + uz * ca + vz * sa, cx + ux * cb + vx * sb, cy + uy * cb + vy * sb, cz + uz * cb + vz * sb);
      Cc.push(col.r * k, col.g * k, col.b * k, 0, 0, 0, 0, 0, 0);
    }
  }
  build() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    const m = new THREE.Mesh(g, poolMat); m.matrixAutoUpdate = false; return m;
  }
}
/* 빛기둥(크레인 투광등): 위는 밝고 아래로 사라지는 덧셈 원뿔 */
const coneMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: false });
function lightCone(h, r, col, k) {
  const g = new THREE.ConeGeometry(r, h, 14, 1, true).toNonIndexed(); g.translate(0, -h / 2, 0);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const f = Math.pow(1 + p.getY(i) / h, 2) * k; c[i * 3] = col.r * f; c[i * 3 + 1] = col.g * f; c[i * 3 + 2] = col.b * f; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return new THREE.Mesh(g, coneMat);
}

/* ---------- 트인 구간 설비 (안드로이드가 나오는 곳) ---------- */
function openFeatureMesh(f, M, G, H, P, FR, PL) {
  const sd = f.side;
  if (f.type === 'gantry') {                       // 선로를 가로지르는 문형 크레인: 다리는 어둠 아래로, 위 보에 안드로이드가 웅크림
    for (const s of [-1, 1]) { M.fbox(P, FR, 0, -6, s * 3.7, .5, 31, .5, STEELD); M.fbox(P, FR, 0, 3, s * 3.7, .7, .3, .7, HAZ); }
    M.fbox(P, FR, 0, 9.55, 0, .8, .6, 8.2, STEEL); M.fbox(P, FR, 0, 9.95, 0, .9, .2, 8.2, STEELD);
    M.fbox(P, FR, 0, 9.0, f.r, 1.3, .5, 1.1, STEELD);                                               // 주행 대차
    _Q.copy(P).addScaledVector(FR.U, 9).addScaledVector(FR.R, f.r + .6); _B.copy(_Q).addScaledVector(FR.U, -1.8); M.pipe(_Q.x, _Q.y, _Q.z, _B.x, _B.y, _B.z, .04, STEELD, 4, true);
    M.fbox(P, FR, 0, 7.05, f.r + .6, .4, .35, .25, HAZ);                                             // 늘어진 갈고리
    G.fbox(P, FR, .45, 9.2, -sd * 2.6, .2, .1, .5, WHITE); _Q.copy(P).addScaledVector(FR.U, 9.1).addScaledVector(FR.R, -sd * 2.6); H.raw(_Q, 3.4, WHITE, .7);
    G.fbox(P, FR, 0, 10.1, sd * 3.7, .2, .2, .2, RED); _Q.copy(P).addScaledVector(FR.U, 10.1).addScaledVector(FR.R, sd * 3.7); H.raw(_Q, 2.6, RED, .7);
  } else if (f.type === 'stairs') {                // 상판 옆 층계참 + 앞쪽 아래 어둠으로 내려가는 계단
    M.fbox(P, FR, 0, -.22, sd * 3.6, 2.6, .2, 2.4, STEEL); M.fbox(P, FR, 0, .55, sd * 4.75, 2.6, .05, .05, STEELL); M.fbox(P, FR, 0, 1.0, sd * 4.75, 2.6, .06, .06, STEELL);
    for (const x of [-1.25, 1.25]) M.fbox(P, FR, x, .4, sd * 4.75, .06, 1.1, .06, STEELL);
    M.fbox(P, FR, 0, -.18, sd * 2.45, 2.6, .08, .1, HAZ);                                             // 끝선
    for (let i = 0; i < 17; i++) M.fbox(P, FR, 1.45 + i * .34, -.3 - i * .31, sd * 3.6, .36, .07, 1.25, STEELL);
    for (const z of [3.0, 4.2]) { _A.copy(P).addScaledVector(FR.T, 1.3).addScaledVector(FR.U, -.3).addScaledVector(FR.R, sd * z); _B.copy(P).addScaledVector(FR.T, 7.1).addScaledVector(FR.U, -5.6).addScaledVector(FR.R, sd * z);
      M.pipe(_A.x, _A.y, _A.z, _B.x, _B.y, _B.z, .07, STEELD, 4, true); _A.addScaledVector(FR.U, 1); _B.addScaledVector(FR.U, 1); M.pipe(_A.x, _A.y, _A.z, _B.x, _B.y, _B.z, .035, STEELL, 4, true); }
    M.fbox(P, FR, 7.8, -5.75, sd * 3.6, 1.8, .2, 1.8, STEEL); M.fbox(P, FR, 7.8, -21, sd * 3.6, .35, 30, .35, STEELD);
    G.fbox(P, FR, -1.1, 2.1, sd * 4.75, .14, .14, .14, AMBER); M.fbox(P, FR, -1.1, 1.0, sd * 4.75, .07, 2.1, .07, STEELL);
    _Q.copy(P).addScaledVector(FR.T, -1.1).addScaledVector(FR.U, 2.1).addScaledVector(FR.R, sd * 4.75); H.raw(_Q, 3, AMBER, .8);
    _Q.copy(P).addScaledVector(FR.U, -.1).addScaledVector(FR.R, sd * 3.6); PL.disc(_Q.x, _Q.y, _Q.z, FR.T.x, FR.T.y, FR.T.z, FR.R.x, FR.R.y, FR.R.z, 2.6, AMBER, .25);
  } else {                                         // 작업 발판: 콘솔·화물·조명. 열차 폭 바로 바깥
    M.fbox(P, FR, 0, -.25, sd * 5.1, 4.6, .25, 3.6, STEEL); M.fbox(P, FR, 0, -.2, sd * 3.3, 4.6, .1, .1, HAZ);
    for (const x of [-2.2, 2.2]) M.fbox(P, FR, x, -10, sd * 5.8, .3, 19.5, .3, STEELD);
    M.fbox(P, FR, 0, .55, sd * 6.85, 4.6, .05, .05, STEELL); M.fbox(P, FR, 0, 1.0, sd * 6.85, 4.6, .06, .06, STEELL);
    M.fbox(P, FR, -1.1, .45, sd * 6.1, .9, 1.0, .6, STEELD); G.fbox(P, FR, -1.1, .85, sd * 5.78, .6, .3, .03, C('#3f7f8a'));       // 콘솔과 화면
    M.fbox(P, FR, 1.3, .3, sd * 6.0, 1.1, .7, 1.0, RUST); M.fbox(P, FR, 1.5, .85, sd * 6.1, .7, .4, .7, CONC);
    M.fbox(P, FR, -2.0, 1.35, sd * 6.7, .08, 3.3, .08, STEELL); G.fbox(P, FR, -2.0, 3.0, sd * 6.4, .3, .14, .4, WHITE);
    _Q.copy(P).addScaledVector(FR.T, -2).addScaledVector(FR.U, 2.95).addScaledVector(FR.R, sd * 6.4); H.raw(_Q, 3.4, WHITE, .8);
    _Q.copy(P).addScaledVector(FR.U, -.1).addScaledVector(FR.R, sd * 5.2); PL.disc(_Q.x, _Q.y, _Q.z, FR.T.x, FR.T.y, FR.T.z, FR.R.x, FR.R.y, FR.R.z, 3.2, WHITE, .2);
  }
}

/* ---------- 공용 ---------- */
const sleeperGeo = new THREE.BoxGeometry(.24, .12, 1.9), railGeo = new THREE.BoxGeometry(STEP + .06, .16, .14), unitBox = new THREE.BoxGeometry(1, 1, 1);
const SHARED = new Set([sleeperGeo, railGeo, unitBox]);
const FR = makeFrame(), FR2 = makeFrame(), _P = new THREE.Vector3(), _Q = new THREE.Vector3(), _A = new THREE.Vector3(), _B = new THREE.Vector3(), _m = new THREE.Matrix4();
const ID = { T: new THREE.Vector3(1, 0, 0), U: new THREE.Vector3(0, 1, 0), R: new THREE.Vector3(0, 0, 1) };
const off = (s, u, r, out) => { frameAt(s, FR2); return trackPos(s, out).addScaledVector(FR2.U, u).addScaledVector(FR2.R, r); };
function addBuilt(group, ...objs) { for (const o of objs) if (o) { o.updateMatrix?.(); group.add(o); } }
/* ---------- 열리는 정비문: 정적 메시와 따로 두어 안드로이드가 문짝을 밀고 나올 수 있게 ---------- */
export const doorLeaves = new Map();          // 마디 번호 gi → { pivot, w }
const leafGeo = merged([prep(new THREE.BoxGeometry(1.1, 2.1, .1), C('#303a3d'), MX(.55, 1.05, 0)), prep(new THREE.BoxGeometry(.9, .06, .11), C('#14171b'), MX(.55, 1.6, 0)),
  prep(new THREE.BoxGeometry(.9, .06, .11), C('#14171b'), MX(.55, .5, 0)), prep(new THREE.BoxGeometry(.05, .3, .14), C('#505c5c'), MX(.95, 1.05, 0)), prep(new THREE.BoxGeometry(.3, .18, .12), C('#8d7743'), MX(.55, 1.9, 0))]);
leafGeo.computeVertexNormals();
SHARED.add(leafGeo);
const lampGeo = new THREE.BoxGeometry(.5, .12, .1); SHARED.add(lampGeo);
const DOORLAMP = new THREE.Color('#3a1410');
/** 안드로이드가 숨어 있을 수 있는 자리 (시드로 정해짐, 모든 승객에게 같음)
 *   door  : 터널 보행로 쪽 벽의 정비문 안
 *   ceil  : 터널 천장 늑골에 거꾸로 매달림
 *   under : 철교·고가 상판 가장자리 아래에 매달림 */
export function anchorsIn(s0, s1) {
  const out = [];
  for (let gi = Math.ceil(s0 / SEG); gi * SEG < s1; gi++) {
    const sa = gi * SEG, sc = sa + SEG / 2, sp = specAt(sc); if (sa < U.gate + 50) continue;
    if (sp.tunnel) {
      const w = styleOf(sp.k).walk;
      if (hash(gi, 41) < .16 && sp.open !== w) out.push({ type: 'door', gi, s: sc + 1.2, side: w });
      else if (hash(gi, 61) < .1) out.push({ type: 'runner', gi, s: sc, side: w, n: 1 + Math.floor(hash(gi, 62) * 3) });      // 보행로를 따라 이미 달려오는 무리
      else if (hash(gi, 44) < .3) out.push({ type: hash(gi, 60) < .55 ? 'spider' : 'ceil', gi, s: sa, side: hash(gi, 45) < .5 ? -1 : 1, r: (hash(gi, 46) - .5) * 2.4 });
    } else {
      const f = openFeature(gi);
      if (f) out.push(Object.assign({ gi, s: sc }, f));
      else if (sp.k >= 0 && sector(sp.k).kind !== 'ordinary' && sp.u >= U.bridge0 && sp.u < U.ramp1 && hash(gi, 47) < .28)
        out.push({ type: hash(gi, 63) < .5 ? 'climber' : 'under', gi, s: sc, side: hash(gi, 48) < .5 ? -1 : 1 });
      else if (hash(gi, 66) < .035) out.push({ type: 'track', gi, s: sc, side: hash(gi, 67) < .5 ? -1 : 1, n: 1 + Math.floor(hash(gi, 68) * 2) });   // 선로 위를 정면으로 달려옴
    }
  }
  stairAnchors(s0, s1, out);
  return out;
}
/** 트인 구간(철교·고가)의 설비: 문형 크레인(위에서 뛰어내림) · 선로로 이어진 계단(우르르 올라옴) · 작업 발판(일하다 달려옴)
 *  지오메트리(sectorJobs)와 안드로이드 배치(anchorsIn)가 같은 결과를 쓰도록 마디 번호로만 정함 */
const planCache = new Map();
const planOf = k => { const key = getSeed() + ':' + k; if (!planCache.has(key)) planCache.set(key, ordinaryPlan(sector(k))); return planCache.get(key); };
export function openFeature(gi) {
  const sp = specAt(gi * SEG + SEG / 2);
  if (sp.tunnel || sp.k < 0 || sp.u < U.bridge0 || sp.u >= U.ramp1 - SEG) return null;
  const ord = sector(sp.k).kind === 'ordinary';
  if (ord) {                                      // 일반 구역: GPT 설계의 계단·건너는 다리와 겹치지 않게
    const pl = planOf(sp.k); if (pl.bays.some(b => Math.abs(b.x - sp.u) < 14) || pl.crossings.some(x => Math.abs(x - sp.u) < 30)) return null;
  }
  const h = hash(gi, 70), side = hash(gi, 71) < .5 ? -1 : 1;
  if (gi % 11 === 3 && h < .7) return { type: 'gantry', side, r: (hash(gi, 72) - .5) * 1.6, n: 1 + (hash(gi, 73) < .45 ? 1 : 0) };
  if (!ord && gi % 11 === 7 && h < .65) return { type: 'stairs', side, n: 3 + Math.floor(hash(gi, 74) * 3) };
  if (gi % 11 === 9 && h < .6) return { type: 'work', side, n: 1 + Math.floor(hash(gi, 75) * 3) };
  return null;
}
/** 일반 구역: 선로에서 작업장으로 내려가는 계단(GPT 설계)마다 안드로이드 무리가 아래에서 일하다 올라옴 */
function stairAnchors(s0, s1, out) {
  for (let k = Math.max(0, Math.floor(s0 / SECTOR)); k * SECTOR < s1; k++) {
    const c = sector(k); if (c.kind !== 'ordinary') continue;
    planOf(k).links.forEach((l, i) => {
      if (l.kind !== 'stairs') return; const s = k * SECTOR + l.x; if (s < s0 || s >= s1) return;
      const gi = 1e6 + k * 64 + i, side = Math.sign((l.za - routeZ(c, l.x)) * c.m) || 1;
      out.push({ type: 'stairs', gi, s, side, n: 3 + Math.floor(hash(gi, 76) * 3), bot: { u: l.yb - l.ya, lat: Math.abs(l.zb - routeZ(c, l.x)), top: Math.abs(l.za - routeZ(c, l.x)) } });
    });
  }
}

function dispose(group) {
  scene.remove(group);
  group.traverse(o => { if (o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
}

/* =====================================================================
 *  1) 선로 청크
 * ===================================================================== */
/** s 지점이 터널인지, 어느 쪽 벽이 열려 있는지 */
export function specAt(s) {
  const k = Math.floor(s / SECTOR);
  if (k < 0) return { k, u: s, tunnel: s >= U.gate, open: 0, m: 1 };
  const u = s - k * SECTOR, c = sector(k);
  return { k, u, m: c.m, tunnel: u < U.bridge0 || u >= U.ramp1, open: u >= U.shaft0 && u < U.bridge0 ? c.m : c.kind !== 'ordinary' && u >= U.well0 && u < U.well1 ? -c.m : 0 };
}
/** 구역의 정비 통로 꾸밈새 (시드로 결정): 배관 묶음, 작업등 간격, 보행로 쪽 */
function tunnelStyle(k) {
  const r = mulberry(getSeed() ^ Math.imul(k + 7, 2246822519)), walk = r() < .5 ? -1 : 1, pipes = [];
  pipes.push({ side: -walk, y: 3.1 + r() * .8, d: 4.35, rad: .75 + r() * .3, col: r() < .4 ? RUST : STEELL });      // 객차 가까이 붙는 굵은 배관
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) pipes.push({ side: r() < .65 ? -walk : walk, y: 5.2 + r() * 1.9, d: 5.05 - r() * .5, rad: .14 + r() * .22, col: r() < .3 ? RUSTL : STEEL });
  return { walk, pipes, lampEvery: 3 + Math.floor(r() * 3), lampPhase: Math.floor(r() * 5), cold: r() < .35 };
}
const styles = new Map();
const styleOf = k => { const key = getSeed() + ':' + k; if (!styles.has(key)) styles.set(key, tunnelStyle(k)); return styles.get(key); };

function buildChunk(ci) {
  const group = new THREE.Group(), lamps = [], s0 = ci * CH;
  const rec = { ci, group, lamps };
  if (s0 + CH <= U.gate) return rec;
  // 레일·침목
  const nS = Math.ceil(CH / STEP), sl = new THREE.InstancedMesh(sleeperGeo, steelMat, nS), rl = new THREE.InstancedMesh(railGeo, steelMat, nS * 2);
  let n = 0;
  for (let i = 0; i < nS; i++) {
    const s = s0 + i * STEP; if (s < U.gate) continue;
    frameAt(s, FR); trackPos(s, _P);
    _m.copy(FR.m).setPosition(_P); sl.setMatrixAt(n, _m);
    for (let k = 0; k < 2; k++) { _Q.copy(_P).addScaledVector(FR.R, k ? .72 : -.72).addScaledVector(FR.U, .19); _m.copy(FR.m).setPosition(_Q); rl.setMatrixAt(n * 2 + k, _m); }
    n++;
  }
  sl.count = n; rl.count = n * 2; sl.frustumCulled = rl.frustumCulled = false; group.add(sl, rl);

  // 터널 마디
  const M = new Mesher(), G = new Mesher(), H = new Halos(), PL = new Pools();
  for(let j=0;j<CH/SEG;j++){frameAt(s0+j*SEG+SEG/2,FR);trackPos(s0+j*SEG+SEG/2,_P); M.fbox(_P,FR,0,-.22,0,SEG+.2,.35,3.4,CONCD);for(const sd of [-1,1])M.fbox(_P,FR,0,.02,sd*1.8,SEG+.2,.26,.28,STEELD);}      // 좁은 선로 (열차 폭보다 좁음)
  for (let j = 0; j < CH / SEG; j++) {
    const sa = s0 + j * SEG, sc = sa + SEG / 2, sp = specAt(sc); if (!sp.tunnel) continue;
    const gi = Math.round(sa / SEG), st = styleOf(sp.k), L = SEG + .5;
    frameAt(sc, FR); trackPos(sc, _P);
    M.fbox(_P, FR, 0, -.72, 0, L, 1.2, 13.4, CONCD);                       // 바닥
    M.fbox(_P, FR, 0, 8.15, 0, L, 1.1, 13.4, CONCD);                       // 천장
    for (const side of [-1, 1]) {
      if (sp.open === side) {                                              // 열린 쪽: 기둥과 낮은 난간만
        M.fbox(_P, FR, -SEG / 2, 3.75, side * 6.1, 1.3, 7.7, 1.2, CONC);
        M.fbox(_P, FR, 0, .95, side * 6.2, L, .08, .08, STEELL); M.fbox(_P, FR, 0, .5, side * 6.2, L, .05, .05, STEELL);
        for (let q = -1; q <= 1; q++) M.fbox(_P, FR, q * 3.3, .42, side * 6.2, .07, 1.1, .07, STEELL);
      } else M.fbox(_P, FR, 0, 3.75, side * 6.2, L, 7.7, 1.2, CONC);       // 벽
      M.fbox(_P, FR, -SEG / 2, 3.7, side * 5.35, .55, 7.6, .5, STEEL);     // 늑골 기둥 (속도감)
    }
    M.fbox(_P, FR, -SEG / 2, 7.3, 0, .55, .5, 11.2, STEEL);
    // 보행로와 난간 (사람 크기의 기준)
    const w = st.walk;
    M.fbox(_P, FR, 0, .06, w * 4.75, L, .36, 1.7, CONCL);
    M.fbox(_P, FR, 0, 1.28, w * 3.95, L, .06, .06, STEELL); M.fbox(_P, FR, 0, .78, w * 3.95, L, .04, .04, STEELL);
    for (let q = -2; q <= 2; q++) M.fbox(_P, FR, q * 2, .76, w * 3.95, .06, 1.08, .06, STEELL);
    // 배관: 마디 양 끝의 선로 위치를 이어 굴절에서도 끊기지 않게
    for (const p of st.pipes) {
      if (sp.open === p.side) continue;
      off(sa, p.y, p.side * p.d, _A); off(sa + SEG, p.y, p.side * p.d, _B);
      M.pipe(_A.x, _A.y, _A.z, _B.x, _B.y, _B.z, p.rad, p.col, p.rad > .5 ? 8 : 5, true);
      if (p.rad > .5) {                                                    // 플랜지와 받침
        _Q.copy(_B).sub(_A).normalize().multiplyScalar(.35).add(_A);
        M.pipe(_A.x, _A.y, _A.z, _Q.x, _Q.y, _Q.z, p.rad + .14, STEELL, 8, true);
        M.fbox(_P, FR, -SEG / 2 + .2, p.y - p.rad - .25, p.side * 5.1, .4, .3, 1.9, STEEL);
      }
    }
    // 작업등 (일부는 꺼져 있음)
    if ((gi + st.lampPhase) % (st.lampEvery * 2) === 0 && hash(gi, 51) > .22) {
      const side = hash(gi, 52) < .5 ? -1 : 1, col = st.cold ? WHITE : WARM;
      if (sp.open !== side) {
        M.fbox(_P, FR, 0, 6.75, side * 5.25, .5, .16, .5, STEELD); G.fbox(_P, FR, 0, 6.58, side * 5.25, .34, .2, .34, col);
        _Q.copy(_P).addScaledVector(FR.U, 6.5).addScaledVector(FR.R, side * 5.2); H.raw(_Q, 3.2, col, .8);
        _Q.addScaledVector(FR.R, side * .38).addScaledVector(FR.U, -1.6); PL.disc(_Q.x, _Q.y, _Q.z, FR.T.x, FR.T.y, FR.T.z, 0, 1, 0, 4.2, col, .2);
        _Q.addScaledVector(FR.R, -side * 2).addScaledVector(FR.U, .7); lamps.push({ p: _Q.clone(), c: col });
      }
    }
    // 정비문 (사람 크기)
    if (hash(gi, 41) < .16 && sp.open !== w) {
      // 정비문은 열차 창문 높이의 작업 발판 위에 있다 (보행로에서 사다리로 오름)
      const DH = 1.15;
      M.fbox(_P, FR, 1.2, 1.3 + DH, w * 5.66, 1.25, 2.5, .3, C('#07090a'));     // 문 안쪽의 어둠
      for (const d of [-.68, .68]) M.fbox(_P, FR, 1.2 + d, 1.3 + DH, w * 5.52, .18, 2.6, .3, STEELD);   // 문틀
      M.fbox(_P, FR, 1.2, 2.66 + DH, w * 5.52, 1.54, .18, .3, STEELD);
      M.fbox(_P, FR, 1.2, 1.25, w * 5.0, 1.9, .12, 1.25, STEEL);                // 작업 발판
      M.fbox(_P, FR, 1.2, 1.32, w * 4.4, 1.9, .06, .06, HAZ);                    // 발판 끝 경고색
      for (const d of [-.8, .8]) M.fbox(_P, FR, 1.2 + d, .9, w * 5.45, .1, .7, .1, STEELD);   // 까치발
      for (const d of [2.35, 2.75]) M.fbox(_P, FR, d, .72, w * 4.45, .05, 1.2, .05, STEELL);  // 사다리
      for (let y = .35; y < 1.3; y += .3) M.fbox(_P, FR, 2.55, y, w * 4.45, .45, .04, .04, STEELL);
      const pv = new THREE.Group(); off(sc + 1.2 - .55, .2 + DH, w * 5.5, pv.position); pv.quaternion.setFromRotationMatrix(FR.m);
      const leaf = new THREE.Mesh(leafGeo, landMat); pv.add(leaf); pv.userData.leaf = leaf;
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: DOORLAMP })); lamp.position.set(.55, 2.7, -w * .1); pv.add(lamp); pv.userData.lamp = lamp;
      group.add(pv); (rec.doors ||= []).push(gi);
      doorLeaves.set(gi, { pivot: pv, w, open: 0 });
    }
    // 천장: 늑골 사이로 처진 전선 묶음과 케이블 트레이, 늑골 모서리 버팀대
    M.fbox(_P, FR, 0, 7.42, -4.1, L, .12, .9, STEELD); M.fbox(_P, FR, 0, 7.42, 4.1, L, .12, .9, STEELD);
    for (const sd of [-1, 1]) { M.fbox(_P, FR, -SEG / 2, 6.55, sd * 4.75, .4, .4, 1.4, STEEL); }
    if (hash(gi, 49) < .55) { const r = (hash(gi, 50) - .5) * 5; off(sa, 7.05, r, _A); off(sa + SEG, 7.05, r, _B); _Q.lerpVectors(_A, _B, .5).addScaledVector(FR.U, -.8 - hash(gi, 53) * .7);
      M.pipe(_A.x, _A.y, _A.z, _Q.x, _Q.y, _Q.z, .07, STEELD, 4, true); M.pipe(_Q.x, _Q.y, _Q.z, _B.x, _B.y, _B.z, .07, STEELD, 4, true); }
    if (gi % 3 === 0) M.fbox(_P, FR, -SEG / 2 + .4, 6.9, (hash(gi, 54) - .5) * 6, .5, .6, .4, CONCL);       // 늑골에 붙은 배전함
    // 벽 아래 경고 띠, 보행로 쪽 벽의 케이블 트레이
    M.fbox(_P, FR, 0, .35, -w * 5.58, L, .5, .06, HAZ);
    if (sp.open !== w) { M.fbox(_P, FR, 0, 4.6, w * 5.45, L, .14, .3, STEELD); M.fbox(_P, FR, 0, 4.72, w * 5.35, L, .1, .1, C('#22282a')); }

    // Wall-mounted CCTV: bracket, pivot, weather hood, recessed lens and a single status light.
    if(gi % 17 === 5 && sp.open !== st.walk){
      const sd=st.walk;
      M.fbox(_P,FR,1,4.2,sd*5.2,.22,.45,1.1,STEEL);
      M.fbox(_P,FR,1,4.35,sd*4.7,.25,.45,.25,STEELL);
      M.fbox(_P,FR,1.2,4.65,sd*4.7,1.15,.48,.46,CONCL);
      M.fbox(_P,FR,1.25,4.94,sd*4.7,1.45,.08,.59,STEELL);
      M.fbox(_P,FR,1.79,4.65,sd*4.7,.04,.32,.33,STEELD);
      M.fbox(_P,FR,1.82,4.65,sd*4.7,.025,.15,.15,C('#214047'));
      G.fbox(_P,FR,1.83,4.53,sd*4.7+.1,.02,.035,.035,RED);
    }
    // 가끔 벽 사다리·배전함
    if (hash(gi, 43) < .1 && sp.open !== -w) { M.fbox(_P, FR, -2, 3.2, -w * 5.5, .9, 1.4, .3, RUST); G.fbox(_P, FR, -2.25, 3.6, -w * 5.33, .08, .08, .04, AMBER); }
  }
  // 출발선 뒤의 닫힌 격문
  if (s0 <= U.gate && s0 + CH > U.gate) {
    trackPos(U.gate, _P);
    M.fbox(_P, ID, -1, 3.7, 0, 2, 8.6, 13.4, STEELD);
    for (let q = -2; q <= 2; q++) M.fbox(_P, ID, .1, 3.7, q * 2.4, .3, 7.8, .5, STEEL);
    M.fbox(_P, ID, .1, 2.2, 0, .3, .7, 11, HAZ);
    G.fbox(_P, ID, .2, 6.9, 0, .1, .25, .9, RED); _Q.copy(_P).setY(_P.y + 6.9); H.raw(_Q, 4, RED, .7);
  }
  addBuilt(group, M.build(), G.build(glowMat), H.build(), PL.build());
  return rec;
}

/* =====================================================================
 *  2) 구역 세트: 하역장
 *     좌표는 구역 로컬 (x = u, y = 층 기준 높이, z = 하역장 쪽이 +). Mesher 가 월드로 옮기고 좌우를 뒤집는다.
 * ===================================================================== */
const ZN = 8;                                  // 열차 쪽 방벽 위치 (선로에서 약 20m)
const X0 = U.shaft0, X1 = U.ramp1;
const CRANE = { x: 560, zA: ZN + 70, zB: ZN + 230, y: 96, cargoZ: ZN + 142, lo: -82, hi: 52 };

function sectorJobs(rec) {
  if (rec.c.kind === 'ordinary') {
    const jobs = ordinaryHarborJobs(rec.c,g=>{rec.ordinary=g;rec.group.add(g);rec.lamps.push(...g.userData.lamps);});
    jobs.push(() => {                              // (Claude) 문형 크레인·작업 발판 — 안드로이드가 나오는 곳
      const M = new Mesher(), G = new Mesher(), H = new Halos(), PL = new Pools(), ox = rec.c.k * SECTOR;
      for (let u = U.bridge0; u < U.ramp1; u += SEG) { const fe = openFeature(Math.round((ox + u) / SEG)); if (!fe) continue; const s = ox + u + SEG / 2; frameAt(s, FR); trackPos(s, _P); openFeatureMesh(fe, M, G, H, _P, FR, PL); }
      addBuilt(rec.group, M.build(), G.build(glowMat), H.build(), PL.build());
    });
    return jobs;
  }
  const c = rec.c, k = c.k, ox = k * SECTOR, ZF = ZN + c.width, R = mulberry(977 + k * 131 + (k ? getSeed() : 0));
  const mk = () => [new Mesher(ox, c.y0, c.z0, c.m), new Mesher(ox, c.y0, c.z0, c.m), new Halos(ox, c.y0, c.z0, c.m)];
  const done = (M, G, H) => addBuilt(rec.group, M.build(), G.build(glowMat), H.build());
  const W = (x, y, z, out) => out.set(ox + x, c.y0 + y, c.z0 + z * c.m);
  const lamp = (x, y, z, col) => rec.lamps.push({ p: W(x, y, z, new THREE.Vector3()), c: col });
  const PL = new Pools();
  const wash = (x, y, z, r, col, k) => { W(x, y, z, _Q); PL.disc(_Q.x, _Q.y, _Q.z, 1, 0, 0, 0, 1, 0, r, col, k); };      // 벽면(z 평면)에 비친 빛
  const washX = (x, y, z, r, col, k) => { W(x, y, z, _Q); PL.disc(_Q.x, _Q.y, _Q.z, 0, 0, 1, 0, 1, 0, r, col, k); };    // 끝 벽(x 평면)
  const zt0 = localZ(X0), zt1 = localZ(X1);
  const jobs = [];
  jobs.push(() => { rec.harbor=buildHarbor(c); rec.group.add(rec.harbor); });

  /* 방벽: 위아래 끝이 보이지 않는 벽 */
  jobs.push(() => {
    const [M, G, H] = mk(), Y0 = -1600, Y1 = 1800;
    M.span(X0 - 12, X1 + 12, Y0, Y1, ZN - 10, ZN, CONCD); M.span(X0 - 12, X1 + 12, Y0, Y1, ZF, ZF + 10, CONCD);
    // 양 끝 벽 (터널이 뚫고 지나는 구멍)
    for (const [x, zt, y, hw] of [[X0 - 10, zt0, 0, 9.5], [X1, zt1, c.rise, 7.4]]) {
      M.span(x, x + 10, Y0, y - 1.4, ZN, ZF, CONCD); M.span(x, x + 10, y + 8.8, Y1, ZN, ZF, CONCD);
      M.span(x, x + 10, y - 1.4, y + 8.8, ZN, zt - hw, CONCD); M.span(x, x + 10, y - 1.4, y + 8.8, zt + hw, ZF, CONCD);
    }

    // Massive retaining walls have sparse load-bearing buttresses and recessed service seams.
    for (const x of [160, 395, 690, 925]) {
      M.box(x, 0, ZN + 5, 13, 2700, 10, CONCD);
      M.box(x + 9, 80, ZN + .3, 1.5, 620, .6, STEELD);
    }
    for (const y of [-165, 68, 240]) M.span(X0, X1, y, y + 7, ZN, ZN + 3.6, CONCD);
    for (const x of [215, 520, 810]) {
      M.box(x, 95, ZN + .1, 34, 190, .3, STEELD);
      M.box(x + 20, 25, ZN + 2, 3, 65, 4, CONC);
    }
    G.box(X0 + .4, 8.9, zt0, .3, .14, 6, DIMWARM);
    washX(X0 + .25, 5, zt0, 12, WARM, .06);
    G.box(X1 - .4, c.rise + 8.3, zt1, .3, .14, 5, DIMWARM);
    // Overlapping transfer floors conceal the upper termination without a flat ceiling.
    for (const [x,y,w] of [[240,180,110],[670,285,190],[420,420,140]]) {
      M.box(x,y,ZN+c.width*.55,w,12,c.width*.9,STEELD);
      M.box(x-w*.42,y-22,ZN+c.width*.55,8,44,c.width*.9,CONCD);
      M.pipe(x, y-16, ZN, x, y-16, ZF, 7, STEEL, 14);
    }

    done(M, G, H);
  });


  /* Process wall: loading portals, pump houses, service towers and grouped access platforms. */
  jobs.push(() => {
    const [M,G,H] = mk();
    for (const [x,y,w,h,d] of [[220,15,95,125,24],[480,-48,165,100,36],[780,78,110,155,30]]) {
      M.box(x,y,ZF-d/2,w,h,d,CONCD);
      M.box(x,y-h*.20,ZF-d-.15,w*.68,h*.35,.3,STEELD);
      M.box(x,y-h*.20,ZF-d-.4,w*.60,h*.28,.3,C('#0a1013'));
      for (const sd of [-1,1]) M.box(x+sd*w*.39,y,ZF-d-1.5,4,h+10,3,CONC);
      for (const j of [-1,0,1]) M.box(x+j*w*.20,y+h*.3,ZF-d-1,8,9,2,STEELD);
      M.box(x,y-h*.4,ZF-d-8,w+12,2,16,STEEL);
      for(const sd of [-1,1]) {
        const lx=x+sd*w*.24, ly=y-h*.03;
        M.box(lx,ly+1,ZF-d-1,3.8,1.2,2,STEEL);
        G.box(lx,ly,ZF-d-1.8,2.5,.2,1,DIMWARM);
        H.add(lx,ly,ZF-d-2,3,WARM,.35);
        wash(lx,ly-8,ZF-d-.5,18,WARM,.07);
      }
      for(let j=0;j<6;j++) M.box(x-w*.3+j*w*.12,y-h*.4+1.8,ZF-d-15,.18,3.2,.18,STEELL);
      M.box(x,y-h*.4+3.4,ZF-d-15,w*.66,.15,.15,STEELL);
    }
    for (const x of [325,650,900]) {
      const z=ZF-12;
      M.box(x,0,z,18,1000,22,STEELD);
      for (let y=-180;y<260;y+=75) {
        M.box(x,y,z-16,28,2,25,STEEL);
        M.box(x+5,y+4,z-28,9,7,1,STEELD);
      }
    }
    for(const [x,r] of [[580,5],[604,3],[620,2]]) {
      M.pipe(x,-480,ZF-15,x,850,ZF-15,r,STEEL,16);
      for(let y=-150;y<300;y+=80) M.pipe(x,y,ZF-15,x,y+2,ZF-15,r+.45,STEELL,16);
    }
    done(M,G,H);
  });


  /* 열차 쪽 방벽: 캣워크·정비문·사다리, 객차보다 굵은 배관과 큰 밸브 */
  jobs.push(() => {
    const [M, G, H] = mk();
    for (const y of [-34, -12, 10, 32, 54]) {
      const xe = y > 20 ? X1 : 760;
      M.span(X0, xe, y - .2, y, ZN, ZN + 2.4, STEEL);
      M.span(X0, xe, y + 1.05, y + 1.12, ZN + 2.32, ZN + 2.4, STEELL); M.span(X0, xe, y + .55, y + .6, ZN + 2.33, ZN + 2.39, STEELL);
      for (let x = X0 + 4; x < xe; x += 8) M.box(x, y + .55, ZN + 2.36, .08, 1.1, .08, STEELL);
      for (let x = X0 + 12; x < xe; x += 24) M.box(x, y - .9, ZN + 1.1, .3, 1.4, 2.2, STEELD);     // 까치발
      for (let x = X0 + 20; x < xe - 10; x += 34) {
        const h = R();
        M.box(x, y + 1.1, ZN + .05, 1.3, 2.2, .3, STEELD);                                        // 정비문
        if (h < .10) G.box(x, y + 2.45, ZN + .2, .5, .14, .1, h < .12 ? RED : DIMWARM);
        if (h < .08) { G.box(x + 3, y + 2.3, ZN + .25, .3, .2, .3, WARM); H.add(x + 3, y + 2.2, ZN + .6, 3.4, WARM, .75); wash(x + 3, y + .6, ZN + .12, 6.5, WARM, .22); if (y === 10) lamp(x + 3, y + 1.8, ZN + 2.5, WARM); }
        if (h > .72) { M.box(x + 6, y + 11, ZN + .5, .08, 22, .08, STEELL); M.box(x + 6.6, y + 11, ZN + .5, .08, 22, .08, STEELL); for (let q = 0; q < 22; q += 1.1) M.box(x + 6.3, y + q, ZN + .5, .6, .05, .05, STEELL); }   // 사다리
      }
    }
    // 주 배관 (직경 6~10m)
    const pipes = [[18, ZN + 6.5, 4, STEELL, X0, 640], [28.5, ZN + 5, 3, STEEL, X0, X1], [-23, ZN + 7.5, 5, RUST, 240, X1]];
    for (const [y, z, r, col, a, b] of pipes) {
      M.pipe(a, y, z, b, y, z, r, col, 10);
      for (let x = a + 15; x < b; x += 30) { M.pipe(x, y, z, x + 1.4, y, z, r + .55, STEELL, 10); M.box(x + 8, y - r - .8, (ZN + z) / 2 + 1, 2, 1.4, z - ZN + 3, STEELD); M.box(x + 8, y - r - 5, ZN + 1, 1.6, 8, 1.6, STEELD); }
    }
    M.pipe(640, 18, ZN + 6.5, 640, -430, ZN + 6.5, 4, STEELL, 10); M.box(640, 18, ZN + 6.5, 9.5, 9.5, 9.5, STEEL);   // 굽어 내려가는 관
    M.pipe(240, -23, ZN + 7.5, 240, -430, ZN + 7.5, 5, RUST, 10); M.box(240, -23, ZN + 7.5, 11.5, 11.5, 11.5, RUST);
    // 큰 밸브 (색이 벗겨진 녹빛 손바퀴) — 진입할 땐 올려다보고, 위에서는 내려다보게 되는 기준 물체
    const vx = 318, vy = 18, vz = ZN + 6.5;
    M.box(vx, vy, vz, 9, 11, 11, STEEL); M.pipe(vx, vy, vz + 5, vx, vy, vz + 12.5, 1.1, STEELL, 8);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283, b = (i + 1) / 12 * 6.283; M.pipe(vx + Math.cos(a) * 7, vy + Math.sin(a) * 7, vz + 12, vx + Math.cos(b) * 7, vy + Math.sin(b) * 7, vz + 12, .55, RUSTL, 6); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * 3.1416 + .3; M.pipe(vx - Math.cos(a) * 7, vy - Math.sin(a) * 7, vz + 12, vx + Math.cos(a) * 7, vy + Math.sin(a) * 7, vz + 12, .38, RUSTL, 5); }
    wash(vx, vy, ZN + 1.5, 26, WARM, .16);
    G.box(vx, vy + 9.5, vz + 6, .5, .3, .5, WARM); H.add(vx, vy + 9.3, vz + 6.4, 7, WARM, .9); G.box(vx - 9, vy - 9, vz + 6, .4, .3, .4, WARM); H.add(vx - 9, vy - 9, vz + 6.4, 5, WARM, .7);
    done(M, G, H);
  });

  /* 선로 구조물: 철교(170~450) → 고가(450~700) → 경사 고가(700~1000). 터널 회랑(110~170)의 교각 포함 */
  jobs.push(() => {
    const M = new Mesher(), G = new Mesher(), H = new Halos();
    for (let u = X0; u < X1; u += SEG) {
      const s = ox + u + SEG / 2, bridge = u >= U.bridge0 && u < U.bridge1, gi = Math.round(u / SEG);
      frameAt(s, FR); trackPos(s, _P);
      if (u >= U.bridge0) {
        // 상판은 열차 폭보다 좁다(난간 없음): 객차 밖으로 떨어지면 아래는 허공 → 안전줄에 매달림
        M.fbox(_P, FR, 0, -.62, 0, SEG + .4, 1, 4.0, STEEL);                                      // 상판
        for (const sd of [-1, 1]) {
          M.fbox(_P, FR, 0, -1.95, sd * 1.75, SEG + .4, 1.7, .4, STEELD);
          if (bridge) { M.fbox(_P, FR, 0, -7.2, sd * 1.75, SEG + .4, .7, .5, STEELD); M.fbox(_P, FR, -SEG / 2, -4.6, sd * 1.75, .4, 5.4, .4, STEELD); }   // 철교의 하부 트러스
        }
        if (bridge) M.fbox(_P, FR, -SEG / 2, -7.2, 0, .5, .5, 3.6, STEELD);
        for (const sd of [-1, 1]) {
          if (bridge) { off(s - SEG / 2, -1.9, sd * 1.75, _A); off(s + SEG / 2, -7, sd * 1.75, _B); M.pipe(_A.x, _A.y, _A.z, _B.x, _B.y, _B.z, .12, STEELD, 4, true);
            off(s - SEG / 2, -7, sd * 1.75, _A); off(s + SEG / 2, -1.9, sd * 1.75, _B); M.pipe(_A.x, _A.y, _A.z, _B.x, _B.y, _B.z, .12, STEELD, 4, true); }
          M.fbox(_P, FR, 0, -1.2, sd * 2.05, SEG + .4, .4, .12, STEELL);                                    // 상판 가장자리 (매달릴 곳)
          if (gi % 2 === 0) M.fbox(_P, FR, -SEG / 2 + .5, -1.6, sd * 2.0, .5, .8, .3, STEEL);               // 덧판
        }
        if (bridge && gi % 2 === 1) { M.fbox(_P, FR, 0, -3.3, -c.m * 1.2, SEG + .4, .08, 1.0, STEEL); M.fbox(_P, FR, 0, -2.6, -c.m * .72, SEG + .4, .05, .05, STEELL); }   // 하부 점검 통로
        // 난간등: 철교는 따뜻한 불빛이 촘촘히, 고가는 차가운 불빛이 드문드문 → 위에서 내려다볼 때 구분됨
        if (gi % (bridge ? 12 : 18) === 0) {
          const sd = -c.m, col = bridge ? WARM : WHITE;
          M.fbox(_P, FR, 0, -.9, sd * 2.6, .2, .2, 1.3, STEELD); M.fbox(_P, FR, 0, 1.9, sd * 3.15, .1, 5.6, .1, STEELL); G.fbox(_P, FR, 0, 4.7, sd * 2.95, .28, .18, .5, col);   // 바깥으로 내민 까치발 위 등주
          _Q.copy(_P).addScaledVector(FR.U, 4.65).addScaledVector(FR.R, sd * 2.9); H.raw(_Q, bridge ? 4.2 : 3.4, col, .85);
          _Q.copy(_P).addScaledVector(FR.U, -.1).addScaledVector(FR.R, sd * 1.6); PL.disc(_Q.x, _Q.y, _Q.z, FR.T.x, FR.T.y, FR.T.z, FR.R.x, FR.R.y, FR.R.z, bridge ? 5.5 : 4.5, col, .2);      // 상판에 떨어진 빛
          _Q.addScaledVector(FR.U, 2.9); rec.lamps.push({ p: _Q.clone(), c: col });
        }
      }
      const fe = openFeature(Math.round((ox + u) / SEG));
      if (fe) openFeatureMesh(fe, M, G, H, _P, FR, PL);
      if (gi % 6 === 2) {                                                                          // 교각: 어둠 속으로 내려감
        M.fbox(_P, ID, 0, -217, 0, 5, 430, 5, CONCD); M.fbox(_P, ID, 0, -2.6, 0, 7, 2.6, 9, CONC);
        if (u >= U.bridge0) for (const d of [60, 130]) M.fbox(_P, ID, 0, -d, 0, 6.2, 1.2, 6.2, CONC);
        for (let d = 8; d < 200; d += 23) { M.fbox(_P, ID, 0, -d, 0, 5.6, .5, 5.6, STEELD); M.fbox(_P, ID, 2.62, -d - 4, 0, .12, 8, .12, STEELL); }      // 띠쇠와 점검 사다리
        G.fbox(_P, ID, 2.56, -6, 0, .06, .2, .2, RED); H.raw(_Q.copy(_P).setY(_P.y - 6), 2.6, RED, .7);
      }
    }
    addBuilt(rec.group, M.build(), G.build(glowMat), H.build());
  });

  /* 가로지르는 철교들, 탱크, 컨베이어, 늘어진 사슬 */
  jobs.push(() => {
    const [M, G, H] = mk();
    for (const [x, y, col] of [[345, -46, WHITE], [625, -86, DIMWHITE], [905, 74, WHITE], [250, 132, DIMWHITE]]) {
      M.span(x - 4, x + 4, y - 1, y, ZN, ZF, STEEL);
      for (const dx of [-4.2, 4.2]) { M.span(x + dx - .25, x + dx + .25, y + 5, y + 5.6, ZN, ZF, STEELD); M.span(x + dx - .2, x + dx + .2, y, y + 1.1, ZN, ZF, STEELD); }
      for (let z = ZN + 6; z < ZF; z += 12) { for (const dx of [-4.2, 4.2]) M.box(x + dx, y + 2.8, z, .35, 5.2, .35, STEELD); M.box(x, y + 5.3, z, 8.4, .3, .3, STEELD); }
      for (let z = ZN + 45; z < ZF; z += 110) { G.box(x, y + 4.8, z, .4, .2, .4, col); H.add(x, y + 4.6, z, 3.4, col, .8); }
    }
    // 저장 탱크 (중간 거리의 큰 덩어리)
    const tz = ZF - 46, ty = -38;
    M.span(390, 560, ty - 3, ty, tz - 30, ZF, CONC);
    for (let x = 400; x <= 550; x += 50) { M.box(x, ty - 30, tz - 24, 3, 56, 3, CONCD); M.pipe(x, ty - 3, tz - 24, x, ty - 40, ZF - 2, 1.4, STEELD, 4); }
    for (const [x, r, h, col] of [[425, 17, 66, STEEL], [475, 14, 52, RUST], [522, 17, 72, STEEL]]) {
      M.pipe(x, ty, tz, x, ty + h, tz, r, col, 24);
      M.box(x, ty + h + .5, tz, r * 1.85, 1, r * 1.85, STEELL); M.box(x, ty + h + .5, tz, r * 1.85, 1, r * 1.85, STEELL, .785);
      M.pipe(x, ty + h, tz, x, ty + h + 9, tz, 2.2, STEELD, 6);
      for (let y = ty + 12; y < ty + h; y += 16) M.pipe(x, y, tz, x, y + 1, tz, r + .5, STEELL, 24);
      G.box(x, ty + h + 9.6, tz, .6, .6, .6, RED); H.add(x, ty + h + 9.8, tz, 6, RED, .9);
      M.box(x - r - .8, ty + h / 2, tz, .12, h, .7, STEELL);                                       // 탱크 사다리
    }

    // A belt is a broad dark deck, twin side rails, rollers, a drive motor and a discharge hopper.
    const cx = 700, za = ZN+120, zb = ZF-32, ya=-10, yb=22;
    const slope=(yb-ya)/(zb-za);
    M.rampBox(cx,(ya+yb)/2,(za+zb)/2,10,.7,zb-za,slope,C('#182123'));
    for(const sd of [-1,1]) M.rampBox(cx+sd*5.8,(ya+yb)/2+.7,(za+zb)/2,.6,2,zb-za,slope,HAZ);
    M.box(cx,-69,(za+zb)/2,18,2,zb-za+20,CONCD);
    for(let z=za;z<zb;z+=70) M.box(cx,-310,z,5,480,5,CONCD);
    for(let z=za;z<zb;z+=5) {
      const y=ya+(z-za)*slope;

      M.pipe(cx-5.5,y-.6,z,cx+5.5,y-.6,z,.6,STEELL,12);

      if(Math.round((z-za)/5)%7===0) {
        for(const sd of [-1,1]) M.box(cx+sd*6,(y-68)/2,z,1,y+68,1,STEEL);
        M.box(cx,y-2,z,14,1.5,3,STEEL);
      }
    }
    for(const z of [za,zb]) {
      const y=ya+(z-za)*slope;
      M.pipe(cx-5,y,z,cx+5,y,z,2,STEELL,20);
      M.pipe(cx+6,y,z,cx+11,y,z,1.4,STEEL,16);
      for(let x=cx+6;x<cx+10;x+=.7) M.pipe(x,y,z,x+.2,y,z,1.65,STEELL,12);
    }
    M.box(cx,ya-6,za-4,15,10,11,STEELD);
    M.box(cx,ya,za-4,17,1,13,HAZ);
    M.box(cx,ya-16,za-4,6,12,6,STEEL);
    for(const [z,sd] of [[za+18,-1],[zb-18,1]]) {
      const y=ya+(z-za)*slope;
      M.box(cx+sd*8,y+5,z,.35,10,.35,STEEL);
      M.box(cx+sd*7,y+10,z,3,.7,1,STEELD);
      G.box(cx+sd*7,y+9.6,z,2,.12,.7,DIMWARM);
    }
    // Moving freight is instanced by harbor.js.

    // 천장에서 늘어진 사슬과 갈고리 (선로 위는 피함)
    for (let i = 0; i < 16; i++) {
      const x = X0 + 40 + R() * (X1 - X0 - 80), z = ZN + 105 + R() * (c.width - 150), len = 150 + R() * 260, yb = 470 - len;
      if (Math.abs(x - CRANE.x) < 40 || Math.abs(x - 760) < 30) continue;
      M.box(x, 900 - len / 2, z, .55, len+860, .55, STEELD);
      if (R() < .6) { M.box(x, yb - 2.5, z, 3.4, 5, 2.2, STEEL); M.box(x, yb - 6.5, z, .8, 3, .8, STEELD); M.box(x + 1.2, yb - 8, z, 3.2, .8, .8, STEELD); }
    }
    done(M, G, H);
  });

  /* 하역 크레인(주행 레일·지지 트러스·거더·횡행대차)과 화물 승강기 탑 */
  jobs.push(() => {
    const [M, G, H] = mk(), K = CRANE;
    for (const z of [K.zA, K.zB]) {
      M.span(380, 820, K.y - 2, K.y + 2, z - 1.6, z + 1.6, STEEL); M.span(380, 820, K.y + 2, K.y + 2.4, z - .5, z + .5, STEELL);
      for (let x = 400; x <= 800; x += 80) { M.box(x, K.y + 202, z, 1.8, 400, 1.8, STEELD); M.box(x, K.y + 6, z, 5, 8, 5, STEEL); M.pipe(x - 22, K.y + 2, z, x, K.y + 30, z, .7, STEELD, 4); M.pipe(x + 22, K.y + 2, z, x, K.y + 30, z, .7, STEELD, 4); }
    }
    // 거더 (위험 표시색) 와 양 끝 주행 대차
    M.span(K.x - 6, K.x - 3, K.y + 3, K.y + 10, K.zA - 5, K.zB + 5, HAZ); M.span(K.x + 3, K.x + 6, K.y + 3, K.y + 10, K.zA - 5, K.zB + 5, HAZ);
    for (let z = K.zA; z <= K.zB; z += 16) M.span(K.x - 6, K.x + 6, K.y + 9.4, K.y + 10, z - .4, z + .4, STEELD);
    for (const z of [K.zA, K.zB]) { M.box(K.x, K.y + 4.5, z, 22, 5, 6, STEELD); G.box(K.x - 11.2, K.y + 5, z, .4, .5, .5, RED); G.box(K.x + 11.2, K.y + 5, z, .4, .5, .5, RED); H.add(K.x - 11.6, K.y + 5, z, 5, RED, .8); H.add(K.x + 11.6, K.y + 5, z, 5, RED, .8); }

    // Triangulated girder webs and the hoist drum make the crane's load path readable.
    for(let z=K.zA;z<K.zB;z+=16)for(const dx of [-5,5]){
      M.pipe(K.x+dx,K.y+3,z,K.x+dx,K.y+9,z+16,.45,STEELL,6);
      M.pipe(K.x+dx,K.y+9,z,K.x+dx,K.y+3,z+16,.45,STEELL,6);
    }
    M.pipe(K.x-10,K.y+12,K.cargoZ,K.x+10,K.y+12,K.cargoZ,3.5,STEELL,24);
    for(let x=K.x-8;x<K.x+9;x+=1)M.pipe(x,K.y+12,K.cargoZ,x+.25,K.y+12,K.cargoZ,3.65,STEELD,20);
    // 횡행대차 (권상기)
    M.box(K.x, K.y + 5, K.cargoZ, 18, 7, 26, STEEL); M.box(K.x, K.y + 10.5, K.cargoZ, 10, 4, 12, STEELD);
    for (const [dx, dz] of [[-8, -11], [8, -11], [-8, 11], [8, 11]]) { M.pipe(K.x + dx, K.y + 1.5, K.cargoZ + dz - 1.5, K.x + dx, K.y + 1.5, K.cargoZ + dz + 1.5, 1.6, STEELD, 8); G.box(K.x + dx, K.y + .9, K.cargoZ + dz * .6, .9, .3, .9, WARM); H.add(K.x + dx, K.y + .5, K.cargoZ + dz * .6, 8, WARM, .9); }
    // 운전실 (사람 크기의 창)
    M.box(K.x + 12, K.y - 1.5, K.cargoZ - 20, 4, 3.4, 4, STEEL); G.box(K.x + 12, K.y - 1.2, K.cargoZ - 22.05, 3, 1.2, .1, DIMWARM); M.box(K.x + 12, K.y + 1, K.cargoZ - 20, .3, 3, .3, STEELD);
    // 승강기 탑 (격자 기둥)
    const ex = 760, ez = ZF - 36;
    for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) M.box(ex + dx, 35, ez + dz, 1.6, 2800, 1.6, STEELD);
    for (let y = -900; y < 1400; y += 40) { M.box(ex, y, ez - 8, 16, .7, .7, STEELD); M.box(ex, y, ez + 8, 16, .7, .7, STEELD); M.box(ex - 8, y, ez, .7, .7, 16, STEELD); M.box(ex + 8, y, ez, .7, .7, 16, STEELD); M.pipe(ex - 8, y, ez - 8, ex + 8, y + 24, ez - 8, .3, STEELD, 4); }
    for (let y = -196; y < 300; y += 132) { M.span(ex - 8, ex + 8, y - .6, y, ez + 8, ZF, STEEL); G.box(ex, y + 3.4, ez + 8.3, .5, .3, .3, AMBER); H.add(ex, y + 3.4, ez + 7.6, 3, AMBER, .6); }
    done(M, G, H); addBuilt(rec.group, PL.build());
    buildMoving(rec, W);
  });

  /* 상부 정비 통로 옆의 수직 갱도: 위로 남은 작업층과 오르내리는 승강대를 잠깐 내다보는 곳 */
  jobs.push(() => {
    const M = new Mesher(), G = new Mesher(), H = new Halos(), sd = -c.m;
    trackPos(ox + (U.well0 + U.well1) / 2, _P);
    const xa = _P.x - 62, xb = _P.x + 62, za = _P.z + sd * 6.9, zb = _P.z + sd * 104, zc = (za + zb) / 2, Y = _P.y, D = Math.abs(zb - za);
    const zbox = (x0, x1, y0, y1, z0, z1, col, MM = M) => MM.span(x0, x1, y0, y1, Math.min(z0, z1), Math.max(z0, z1), col);
    zbox(xa - 8, xb + 8, Y - 1600, Y + 1800, zb, zb + sd * 8, CONCD); zbox(xa - 8, xa, Y - 430, Y + 520, za, zb, CONCD); zbox(xb, xb + 8, Y - 430, Y + 520, za, zb, CONCD);
    zbox(xa, xb, Y - 430, Y - 1.3, za, za - sd * 3, CONCD); zbox(xa, xb, Y + 8.7, Y + 1800, za, za - sd * 3, CONCD);                // 통로 위아래의 벽
    zbox(xa, _P.x - 25, Y - 1.3, Y + 8.7, za, za - sd * 3, CONCD); zbox(_P.x + 25, xb, Y - 1.3, Y + 8.7, za, za - sd * 3, CONCD);
    for (let y = Y - 396; y < Y + 900; y += 66) {
      zbox(xa, xb, y - .7, y, zb, zb - sd * 7, CONC); zbox(xa, xb, y + 1.05, y + 1.15, zb - sd * 7, zb - sd * 7.1, STEELL);
      for (let x = xa + 10; x < xb; x += 20) M.box(x, y + 10.6, zb - sd * 6.4, 1.2, 21.3, 1.2, CONCD);
      for (let x = xa + 6; x < xb; x += 12) { const h = R(); if (h > .055) continue; G.box(x, y + 1.15, zb - sd * .05, 1.2, 2.2, .2, h < .2 ? DIMWARM : DIMWHITE); if (h < .09) H.raw(_Q.set(x, y + 1.6, zb - sd * .7), 3, WARM, .7); }
    }
    for (const dx of [-44, -36, 40]) M.pipe(_P.x + dx, Y - 430, zc + sd * 30, _P.x + dx, Y + 520, zc + sd * 30, dx > 0 ? 4.5 : 3, dx > 0 ? RUST : STEELL, 10);
    for (const [dx, dz] of [[-17, -15], [17, -15], [-17, 15], [17, 15]]) M.box(_P.x + dx, Y + 45, zc + dz, 1.5, 950, 1.5, STEELD);     // 승강대 가이드
    for (let y = Y - 400; y < Y + 900; y += 80) { M.box(_P.x, y, zc - 15, 34, .6, .6, STEELD); M.box(_P.x, y, zc + 15, 34, .6, .6, STEELD); }
    addBuilt(rec.group, M.build(), G.build(glowMat), H.build());
    // 움직이는 승강대
    const P = new Mesher(), PG = new Mesher(), PH = new Halos();
    P.box(0, 0, 0, 32, 1.6, 28, STEEL); P.box(0, -1.4, 0, 30, 1.2, 3, STEELD); P.box(0, 1.2, -13.6, 32, .1, .1, STEELL); P.box(0, 1.2, 13.6, 32, .1, .1, STEELL);
    P.box(-7, 3.6, 2, 12, 5.6, 6, RUST); P.box(6, 2.8, -5, 8, 4, 8, CONCL); P.box(9, 6.2, -5, 5, 2.8, 5, STEELL);
    for (const [dx, dz] of [[-15, -13], [15, -13], [-15, 13], [15, 13]]) { P.box(dx, 2, dz, .4, 4, .4, STEELD); PG.box(dx, 4.2, dz, .5, .5, .5, AMBER); PH.add(dx, 4.3, dz, 6, AMBER, .9); }
    const lift = new THREE.Group(); lift.add(P.build(), PG.build(glowMat), PH.build()); lift.position.set(_P.x, Y, zc); rec.group.add(lift);
    rec.lift = { g: lift, y: Y };
  });
  return jobs;
}

const chainMat = new THREE.MeshLambertMaterial({ color: 0x14171b, flatShading: true });
/* 움직이는 것: 화물판(사슬·빛기둥)과 승강기 칸 */
function buildMoving(rec, W) {
  const c = rec.c, K = CRANE;
  const P = new Mesher(), PG = new Mesher(), PH = new Halos();
  P.box(0, -1, 0, 32, 2, 26, CONC); P.box(0, -2.6, 0, 34, 1.4, 4, STEELD); P.box(0, -2.6, -9, 34, 1.4, 2, STEELD); P.box(0, -2.6, 9, 34, 1.4, 2, STEELD);
  for (const dz of [-12.8, 12.8]) P.box(0, .15, dz, 32, .3, .5, HAZ);
  for (const dx of [-15.8, 15.8]) P.box(dx, .15, 0, .5, .3, 26, HAZ);
  // 화물: 열차 한 량만 한 상자들과 사람 크기의 난간 → 크기 비교
  P.box(-7, 2.6, -5, 13, 5.2, 5.4, RUST); P.box(-7, 2.6, 2.5, 13, 5.2, 5.4, STEELL); P.box(-7, 7.8, -1.5, 13, 5.2, 5.4, RUSTL); P.box(8, 2, 6, 9, 4, 7, CONCL); P.box(9, 1.4, -6, 6, 2.8, 6, STEEL);
  P.box(0, 1.1, 12.6, 14, .08, .08, STEELL); for (let q = -3; q <= 3; q++) P.box(q * 2.3, .55, 12.6, .07, 1.1, .07, STEELL);
  for (const [dx, dz] of [[-14, -11], [14, -11], [-14, 11], [14, 11]]) { P.box(dx, 1.6, dz, .6, 3.2, .6, STEELD); PG.box(dx, 3.4, dz, .7, .5, .7, AMBER); PH.add(dx, 3.6, dz, 9, AMBER, 1); }
  const cargo = new THREE.Group(); cargo.add(P.build(), PG.build(glowMat), PH.build());
  const base = W(K.x, 0, K.cargoZ, new THREE.Vector3()); cargo.position.copy(base); rec.group.add(cargo);
  const chains = [];
  for (const [dx, dz] of [[-13, -10], [13, -10], [-13, 10], [13, 10]]) {
    const m = new THREE.Mesh(unitBox, chainMat);
    m.userData.at = [base.x + dx, base.z + dz]; rec.group.add(m); chains.push(m);
  }
  const cone = lightCone(115, 18, WARM, .005); cone.position.set(base.x, c.y0 + K.y, base.z); rec.group.add(cone);
  // 승강기 칸
  const E = new Mesher(), EG = new Mesher(), EH = new Halos();

  E.box(0,-4,0,15,1,15,STEEL);
  E.box(0,4,0,15,.7,15,STEEL);
  for(const dx of [-6.5,6.5])for(const dz of [-6.5,6.5])E.box(dx,0,dz,.6,8,.6,HAZ);
  for(const y of [-2.8,-1.2])for(const dz of [-6.5,6.5])E.box(0,y,dz,13,.2,.2,STEELL);
  E.box(0,-2,-3,7,3,4,RUST);
  EG.box(0,3.6,-6.55,3,.12,.6,WARM);

  EH.add(0, .6, -7.4, 10, WARM, .8); EH.add(0, -4.6, 0, 6, RED, .8);
  const cab = new THREE.Group(); cab.add(E.build(), EG.build(glowMat), EH.build());
  W(760, 0, ZN + c.width - 36, cab.position); rec.group.add(cab);
  rec.dyn = { cargo, chains, cab, top: c.y0 + K.y - 2, phase: -1 };
}

const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);
let onCargoStart = null;
export const setCargoListener = fn => onCargoStart = fn;
/** 설비 움직임. 모든 승객이 같은 장면을 보도록 벽시계(공유 시간)에 맞춘다 */
export function animateWorld() {
  const t = Date.now() / 1000;
  haloMat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  for (const rec of sectors.values()) {
    const d = rec.dyn, c = rec.c;
    if(rec.harbor) animateHarbor(rec.harbor,t);
    if(rec.ordinary) animateOrdinaryHarbor(rec.ordinary,t);
    if (d) {
      // 화물판: 천천히 움직이기 시작해 끝에서 다시 감속 (무게감). 72초 주기
      const ph = (t % 72) / 72, K = CRANE;
      const e = ph < .06 ? 0 : ph < .46 ? smoother((ph - .06) / .4) : ph < .54 ? 1 : ph < .94 ? 1 - smoother((ph - .54) / .4) : 0;
      const y = c.y0 + K.lo + (K.hi - K.lo) * e;
      d.cargo.position.y = y;
      for (const ch of d.chains) { const len = d.top - (y + 3); ch.position.set(ch.userData.at[0], y + 3 + len / 2, ch.userData.at[1]); ch.scale.set(.5, len, .5); }
      if (d.phase >= 0 && d.phase < .06 && ph >= .06) { const u = S.sTrain - c.k * SECTOR; if (u > 60 && u < 1020) onCargoStart?.(); }
      d.phase = ph;
      d.cab.position.y = c.y0 + 10 + 150 * Math.sin(t * 6.2832 / 96 + c.k);
    }
    if (rec.lift) rec.lift.g.position.y = rec.lift.y - 60 + 150 * (.5 - .5 * Math.cos(t * 6.2832 / 64));
  }
}

/* =====================================================================
 *  생성 대기열과 수명 관리
 * ===================================================================== */
const chunks = new Map(), sectors = new Map(), queue = [];
export const queueLength = () => queue.length;
const BACK = 390, AHEAD = 430;

export function updateChunks(s) {
  getRun().commitThrough(Math.max(0, Math.floor((s + AHEAD + CH) / SECTOR)));
  const c0 = Math.floor((s - BACK) / CH), c1 = Math.floor((s + AHEAD) / CH), here = Math.floor(s / CH);
  for (let ci = c0; ci <= c1; ci++) if (!chunks.has(ci)) { chunks.set(ci, null); queue.push({ ci, pri: Math.abs(ci - here) }); }
  for (const [ci, rec] of chunks) if (ci < c0 - 1 || ci > c1 + 1) { if (rec) { dispose(rec.group); rec.doors?.forEach(g => doorLeaves.delete(g)); } chunks.delete(ci); lampsDirty = true; }
  // 구역 세트: 앞 터널 안에 있을 때 미리 만들기 시작, 다음 구역 깊숙이 들어가면 정리
  const k0 = Math.floor((s - 160) / SECTOR), k1 = Math.floor((s + 330) / SECTOR);
  for (let k = Math.max(0, k0); k <= k1; k++) if (!sectors.has(k)) {
    const rec = { c: sector(k), group: new THREE.Group(), lamps: [], pending: 0 }; rec.group.matrixAutoUpdate = false;
    sectors.set(k, rec); scene.add(rec.group);
    const jobs = sectorJobs(rec); rec.pending = jobs.length;
    jobs.forEach((fn, i) => queue.push({ rec, fn, pri: 20 + i }));
  }
  for (const [k, rec] of sectors) if (k < k0 || k > k1) { rec.dead = true; dispose(rec.group); sectors.delete(k); lampsDirty = true; }
  queue.sort((a, b) => a.pri - b.pri);
}
export function processQueue(budget) {
  const t0 = performance.now(); let n = 0;
  while (queue.length && n < budget && (n === 0 || performance.now() - t0 < 7)) {
    const q = queue.shift(); n++;
    if (q.fn) { if (!q.rec.dead) { q.fn(); q.rec.pending--; lampsDirty = true; } continue; }
    if (!chunks.has(q.ci) || chunks.get(q.ci)) continue;
    const rec = buildChunk(q.ci); rec.group.matrixAutoUpdate = false; scene.add(rec.group); chunks.set(q.ci, rec); lampsDirty = true;
  }
}
export function resetWorld() {
  for (const rec of chunks.values()) if (rec) dispose(rec.group);
  for (const rec of sectors.values()) { rec.dead = true; dispose(rec.group); }
  chunks.clear(); sectors.clear(); doorLeaves.clear(); queue.length = 0; styles.clear(); lampsDirty = true;
}
/** 디버그: 현재 살아 있는 것들의 수 */
export const worldStats = () => ({ chunks: [...chunks.values()].filter(Boolean).length, sectors: sectors.size, queue: queue.length, lamps: allLamps.length, geometries: renderer.info.memory.geometries });

/* ---------- 실제 조명: 작업등마다 광원을 두지 않고, 카메라에 가장 가까운 몇 개에만 돌려 쓴다 ---------- */
const pool = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xdfeaf5, 0, 34, 1.7); scene.add(l); return l; });
let allLamps = [], lampsDirty = true, lampT = 0;
export function updateLights(dt) {
  lampT -= dt; if (lampT > 0) return; lampT = .12;
  if (lampsDirty) { lampsDirty = false; allLamps = []; for (const r of chunks.values()) if (r) allLamps.push(...r.lamps); for (const r of sectors.values()) allLamps.push(...r.lamps); }
  const cp = camera.position, n = QUALITY[S.quality].lights;
  for (const l of allLamps) l.d = l.p.distanceToSquared(cp);
  const near = allLamps.filter(l => l.d < 70 * 70).sort((a, b) => a.d - b.d);
  for (let i = 0; i < pool.length; i++) {
    const L = pool[i], src = i < n ? near[i] : null;
    if (!src) { L.intensity = 0; continue; }
    L.position.copy(src.p); L.color.copy(src.c); L.intensity = src.intensity ?? 95; L.distance = src.distance ?? 34;
  }
}
