// 절차적 월드: 청크 계획(결정론적) → 시간 분할 작업 큐로 지오메트리 생성
import * as THREE from 'three';
import { n3, chunkRng, clamp } from './noise.js';
import { C, prep, M, merged, jit, landMat, glowMat, crystalMat, woodMat, steelMat } from './geo.js';
import { trackPos, frameAt, makeFrame, biomeAt } from './track.js';
import { scene } from './scene.js';
import { CH, STEP, QUALITY } from './config.js';
import { S } from './state.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _P = new THREE.Vector3(), _Q = new THREE.Vector3(), _m = new THREE.Matrix4();
const FR = makeFrame();

/* ---------------- 공유 지오메트리 ---------------- */
const sleeperGeo = new THREE.BoxGeometry(.45, .22, 3), railGeo = new THREE.BoxGeometry(STEP + .06, .16, .14);
export const ITEM_GEO = {
  scrap: merged([
    prep(new THREE.CylinderGeometry(.42, .42, .16, 8), C('#9aa3ad'), M(0, 0, 0, Math.PI / 2, 0, 0)),
    ...[0, 1, 2, 3].map(i => prep(new THREE.BoxGeometry(.18, .22, .2), C('#7c858f'), M(Math.cos(i * 1.57) * .45, Math.sin(i * 1.57) * .45, 0, 0, 0, i * 1.57))),
    prep(new THREE.BoxGeometry(.7, .12, .12), C('#c27b46'), M(.1, .1, .14, 0, 0, .5)),
  ]),
  wood: merged([prep(new THREE.BoxGeometry(1.3, .14, .36), C('#b07a48'), M(0, 0, 0)), prep(new THREE.BoxGeometry(1.1, .14, .32), C('#946238'), M(.1, .15, .05, 0, .35, 0))]),
  crystal: merged([prep(new THREE.OctahedronGeometry(.32, 0), C('#9ff7ff'), M(0, 0, 0, 0, 0, 0, 1, 1.9, 1)), prep(new THREE.OctahedronGeometry(.2, 0), C('#d8a4ff'), M(.25, -.15, .1, .4, 0, .5, 1, 1.6, 1))]),
};
const SHARED = new Set([sleeperGeo, railGeo, ...Object.values(ITEM_GEO)]);

/* ---------------- 나무·섬·구름·랜드마크 지오메트리 ---------------- */
function addTree(type, x, y, z, h, B, rng, solid, glow) {
  const trunk = C('#6b4a38');
  switch (type) {
    case 'pine':
      solid.push(prep(new THREE.CylinderGeometry(.1 * h, .14 * h, .45 * h, 5), trunk, M(x, y + .2 * h, z)));
      for (let k = 0; k < 3; k++) { const s = 1 - k * .26; solid.push(prep(new THREE.ConeGeometry(.42 * h * s, .5 * h, 6), jit(B.foliage, rng), M(x, y + .5 * h + k * .28 * h, z, 0, rng() * 6, 0))); }
      break;
    case 'round':
      solid.push(prep(new THREE.CylinderGeometry(.08 * h, .12 * h, .6 * h, 5), trunk, M(x, y + .3 * h, z)));
      solid.push(prep(new THREE.IcosahedronGeometry(.42 * h, 0), jit(B.foliage, rng), M(x, y + .78 * h, z, rng() * 3, rng() * 3, 0)));
      if (rng() < .6) solid.push(prep(new THREE.IcosahedronGeometry(.28 * h, 0), jit(B.grass2, rng), M(x + .25 * h, y + .62 * h, z + .1 * h, rng() * 3, 0, 0)));
      break;
    case 'dead':
      solid.push(prep(new THREE.CylinderGeometry(.05 * h, .1 * h, h, 4), B.foliage, M(x, y + .5 * h, z, 0, 0, (rng() - .5) * .2)));
      for (let k = 0; k < 2; k++) solid.push(prep(new THREE.CylinderGeometry(.03 * h, .05 * h, .45 * h, 4), B.foliage, M(x + (k ? .14 : -.14) * h, y + (.55 + k * .15) * h, z, 0, rng() * 6, k ? -.9 : .9)));
      break;
    case 'crystal':
      for (let k = 0; k < 3; k++) { const s = (.6 + rng() * .6) * h; glow.push(prep(new THREE.OctahedronGeometry(.2 * s, 0), jit(B.accent, rng, .15), M(x + (rng() - .5) * .5 * h, y + .35 * s, z + (rng() - .5) * .5 * h, (rng() - .5) * .5, rng() * 3, (rng() - .5) * .5, 1, 2.8, 1))); }
      break;
    case 'mushroom':
      solid.push(prep(new THREE.CylinderGeometry(.08 * h, .12 * h, .7 * h, 6), C('#efe3d2'), M(x, y + .35 * h, z)));
      solid.push(prep(new THREE.SphereGeometry(.45 * h, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), jit(B.foliage, rng), M(x, y + .66 * h, z, 0, rng() * 3, 0, 1, .7, 1)));
      glow.push(prep(new THREE.IcosahedronGeometry(.06 * h, 0), B.accent, M(x + .2 * h, y + .9 * h, z)));
      glow.push(prep(new THREE.IcosahedronGeometry(.05 * h, 0), B.accent, M(x - .15 * h, y + .88 * h, z + .18 * h)));
      break;
  }
}
function islandGeometry(r, B, rng, treeType) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position, v = new THREE.Vector3(), k = rng() * 500;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = n3(v.x * 1.9 + k, v.y * 1.9, v.z * 1.9 + k, 3), rad = 1 + (n - .5) * .55;
    const y = v.y > 0 ? v.y * .26 + (n - .5) * .05 : v.y * (1.4 + n * 1.5);
    p.setXYZ(i, v.x * rad * r, y * r, v.z * rad * r);
  }
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const col = new Float32Array(p.count * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let f = 0; f < p.count; f += 3) {
    a.fromBufferAttribute(p, f); b.fromBufferAttribute(p, f + 1); c.fromBufferAttribute(p, f + 2);
    nrm.crossVectors(_b.subVectors(c, b), _a.subVectors(a, b)).normalize();
    const cy = (a.y + b.y + c.y) / 3 / r;
    let cc;
    if (nrm.y > .5 && cy > -.12) cc = rng() < .5 ? B.grass : B.grass2;
    else if (cy > -.45) cc = rng() < .3 ? B.grass2.clone().lerp(B.rock, .6) : B.rock;
    else cc = B.rockDark.clone().lerp(B.rock, rng() * .4);
    cc = jit(cc, rng, .05);
    for (let k2 = 0; k2 < 3; k2++) col.set([cc.r, cc.g, cc.b], (f + k2) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const solid = [g], glow = [];
  const tops = []; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) tops.push(p.getX(i), p.getY(i), p.getZ(i));
  const topAt = (tx, tz) => { let best = 1e9, ty = 0; for (let i = 0; i < tops.length; i += 3) { const d = (tops[i] - tx) ** 2 + (tops[i + 2] - tz) ** 2; if (d < best) { best = d; ty = tops[i + 1]; } } return ty; };
  const nTrees = Math.floor(r * .55 + rng() * r * .45);
  for (let t = 0; t < nTrees; t++) {
    const ang = rng() * 6.283, rr = Math.sqrt(rng()) * r * .62, tx = Math.cos(ang) * rr, tz = Math.sin(ang) * rr;
    addTree(treeType, tx, topAt(tx, tz) - .15, tz, 1.6 + rng() * 2.6 + (rng() < .1 ? 2.5 : 0), B, rng, solid, glow);
  }
  for (let t = 0; t < 3; t++) { const ang = rng() * 6.283, rr = r * (.2 + rng() * .5), x = Math.cos(ang) * rr, z = Math.sin(ang) * rr; solid.push(prep(new THREE.DodecahedronGeometry(.25 + rng() * .5, 0), jit(B.rock, rng), M(x, topAt(x, z), z, rng() * 3, rng() * 3, 0))); }
  for (let t = 0; t < 4; t++) { const ang = rng() * 6.283, rr = r * (1.15 + rng() * .5); solid.push(prep(new THREE.IcosahedronGeometry(.3 + rng() * r * .08, 0), jit(B.rockDark, rng), M(Math.cos(ang) * rr, -r * (.1 + rng() * .5), Math.sin(ang) * rr, rng() * 3, rng() * 3, 0))); }
  return { solid: merged(solid), glow: merged(glow), topAt };
}
function cloudGeometry(rng) {
  const parts = [], n = 4 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) { const s = 3 + rng() * 6; parts.push(prep(new THREE.IcosahedronGeometry(s, 1), C('#ffffff').offsetHSL(0, 0, -rng() * .05), M(i * 4.5 - n * 2.2, (rng() - .3) * 2, (rng() - .5) * 6, rng() * 3, rng() * 3, 0, 1, .7, 1))); }
  return merged(parts);
}
/* 지역별 랜드마크: 섬 위에 큰 구조물 하나 */
function landmarkGeometry(kind, B, rng) {
  const base = islandGeometry(14, B, rng, null);
  base.solid.deleteAttribute('normal'); if (base.glow) base.glow.deleteAttribute('normal');
  const solid = [base.solid], glow = base.glow ? [base.glow] : [];
  const y0 = base.topAt(0, 0) - .2, stone = C('#c9bfae'), stoneD = C('#9c9284');
  switch (kind) {
    case 'arch':
      for (const z of [-6, 6]) { solid.push(prep(new THREE.BoxGeometry(3, 16, 3), jit(stone, rng), M(0, y0 + 8, z, 0, 0, (rng() - .5) * .05))); solid.push(prep(new THREE.BoxGeometry(3.8, 1.2, 3.8), stoneD, M(0, y0 + .6, z))); }
      solid.push(prep(new THREE.BoxGeometry(4, 2.6, 17), jit(stone, rng), M(0, y0 + 17, 0, .04, 0, 0)));
      solid.push(prep(new THREE.BoxGeometry(2.6, 2.4, 3), stoneD, M(4, y0 + 1.2, 8, .3, .6, .2)));
      solid.push(prep(new THREE.IcosahedronGeometry(1.4, 0), B.foliage, M(0, y0 + 19, -5)));
      break;
    case 'giantTree':
      solid.push(prep(new THREE.CylinderGeometry(1.4, 2.6, 20, 7), C('#6b4a38'), M(0, y0 + 10, 0)));
      for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283, rr = 4 + rng() * 4; solid.push(prep(new THREE.IcosahedronGeometry(5 + rng() * 3, 0), jit(B.foliage, rng, .1), M(Math.cos(a) * rr, y0 + 20 + rng() * 6, Math.sin(a) * rr, rng() * 3, rng() * 3, 0))); }
      solid.push(prep(new THREE.IcosahedronGeometry(7, 0), jit(B.grass2, rng), M(0, y0 + 27, 0)));
      break;
    case 'spire':
      for (let k = 0; k < 7; k++) { const h = 10 + rng() * 22, a = rng() * 6.283, rr = rng() * 5; glow.push(prep(new THREE.OctahedronGeometry(1, 0), jit(B.accent, rng, .2), M(Math.cos(a) * rr, y0 + h * .45, Math.sin(a) * rr, (rng() - .5) * .4, rng() * 3, (rng() - .5) * .4, h * .12, h * .5, h * .12))); }
      break;
    case 'station': {
      const wood = C('#8a5a3c'), roof = C('#3d4a6b');
      solid.push(prep(new THREE.BoxGeometry(16, 1, 6), stoneD, M(0, y0 + .5, 0)));
      solid.push(prep(new THREE.BoxGeometry(7, 5, 5), wood, M(-3, y0 + 3.5, -.5)));
      solid.push(prep(new THREE.ConeGeometry(5.6, 3, 4), roof, M(-3, y0 + 7.5, -.5, 0, Math.PI / 4, 0, 1, 1, .8)));
      solid.push(prep(new THREE.BoxGeometry(16.4, .3, 1.4), C('#f6f9ff'), M(0, y0 + 1.1, 2.6)));
      solid.push(prep(new THREE.CylinderGeometry(.15, .15, 4, 5), C('#2e2b34'), M(5, y0 + 3, 2)));
      solid.push(prep(new THREE.BoxGeometry(3, 1, .2), C('#f3e6cc'), M(5, y0 + 4.6, 2)));
      glow.push(prep(new THREE.BoxGeometry(1.4, 1.4, .1), C('#ffd98a'), M(-3, y0 + 3.6, 2.08)));
      glow.push(prep(new THREE.OctahedronGeometry(.4, 0), C('#ffd98a'), M(5, y0 + 5.4, 2)));
      break;
    }
    case 'chain':
      for (let k = 0; k < 9; k++) solid.push(prep(new THREE.TorusGeometry(1.1, .32, 4, 8), C('#4a4048'), M(0, y0 + 3 + k * 1.7, 0, 0, k % 2 ? Math.PI / 2 : 0, 0)));
      solid.push(prep(new THREE.DodecahedronGeometry(5, 0), jit(B.rock, rng), M(0, y0 + 22, 0, rng(), rng(), 0, 1.4, 1, 1.2)));
      glow.push(prep(new THREE.OctahedronGeometry(1.2, 0), B.accent, M(0, y0 + 1.5, 0, 0, 0, 0, 1, 1.6, 1)));
      break;
    case 'mushroom':
      solid.push(prep(new THREE.CylinderGeometry(1.6, 2.4, 18, 8), C('#efe3d2'), M(0, y0 + 9, 0, 0, 0, .08)));
      solid.push(prep(new THREE.SphereGeometry(10, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), jit(B.foliage, rng), M(.7, y0 + 17.5, 0, 0, 0, .08, 1, .55, 1)));
      for (let k = 0; k < 10; k++) { const a = rng() * 6.283, rr = 3 + rng() * 6; glow.push(prep(new THREE.IcosahedronGeometry(.5 + rng() * .5, 0), B.accent, M(.7 + Math.cos(a) * rr, y0 + 17.5 + Math.sqrt(Math.max(0, 1 - (rr / 10) ** 2)) * 5.5, Math.sin(a) * rr))); }
      break;
  }
  return { solid: merged(solid), glow: merged(glow) };
}

/* ---------------- 결정론적 청크 계획 (겹침·선로 침범 검사) ---------------- */
/** 선로(기차 높이 포함) 와 겹치지 않는지. half: 수평 반경, top/bottom: 중심 기준 위·아래 범위 */
function clearOfTrack(x, y, z, half, top, bottom) {
  const span = half + 14;
  for (let t = x - span; t <= x + span; t += 3) {
    trackPos(t, _P);
    if (Math.hypot(x - _P.x, z - _P.z) < half + 6 && y - bottom < _P.y + 8 && y + top > _P.y - 3) return false;
  }
  return true;
}
const sph = (x, y, z, r) => ({ x, y, z, r });
const overlaps = (a, list, pad = 1) => list.some(b => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < (a.r + b.r) * pad);

const rawPlans = new Map();
function rawPlan(ci) {
  if (rawPlans.has(ci)) return rawPlans.get(ci);
  // 카테고리마다 독립 난수열 → 품질 설정이 달라도 자원 위치·ID 가 모든 플레이어에게 같음
  let rng = chunkRng(ci, 11);
  const islands = [], spheres = [];
  const n = 6 + Math.floor(rng() * 5);
  for (let k = 0; k < n; k++) {
    const s = ci * CH + rng() * CH; trackPos(s, _P);
    const side = rng() < .5 ? -1 : 1, near = rng() < .35, giant = !near && rng() < .12;
    let lateral = near ? 15 + rng() * 22 : 45 + rng() * 300;
    const r = near ? 3 + rng() * 4.5 : giant ? 45 + rng() * 35 : 8 + rng() * 20 + lateral * .03;
    const yo = near ? -5 + rng() * 5 : (rng() - .45) * (giant ? 160 : 100);
    const jx = (rng() - .5) * 20, bm = biomeAt(s), pick = rng(), seedI = (rng() * 1e9) | 0, rot = rng() * 6.283;
    for (let tries = 0; tries < 4; tries++) {
      const x = _P.x + jx, y = _P.y + yo, z = _P.z + side * lateral;
      const sp = sph(x, y - r * .8, z, r * 1.7);
      if (clearOfTrack(x, y, z, r * 1.7, r * .3 + 8, r * 3) && !overlaps(sp, spheres, .85)) {
        const B = pick < bm.t ? bm.c : bm.a;
        islands.push({ x, y, z, r, B, seed: seedI, rot, near, keep: (seedI % 1000) / 1000 }); spheres.push(sp); break;
      }
      lateral = lateral * 1.35 + r + 12;                // 밀어내고 재시도
    }
  }
  // 랜드마크 (지역 대표 구조물)
  let landmark = null;
  rng = chunkRng(ci, 12);
  if (rng() < .3) {
    const s = ci * CH + rng() * CH; trackPos(s, _P); const side = rng() < .5 ? -1 : 1, bm = biomeAt(s), B = bm.t < .5 ? bm.a : bm.c;
    const lat = 70 + rng() * 90, x = _P.x, y = _P.y + (rng() - .3) * 30, z = _P.z + side * lat, sp = sph(x, y, z, 32);
    if (clearOfTrack(x, y, z, 30, 32, 40) && !overlaps(sp, spheres, .9)) { landmark = { x, y, z, B, kind: B.landmark, seed: (rng() * 1e9) | 0, rot: rng() * 6.283 }; spheres.push(sp); }
  }
  // 구름
  const clouds = [];
  rng = chunkRng(ci, 13);
  const nc = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < nc; k++) {
    const s = ci * CH + rng() * CH; trackPos(s, _P);
    const x = _P.x, y = _P.y + (rng() - .4) * 90, z = _P.z + (rng() < .5 ? -1 : 1) * (35 + rng() * 220), seedC = (rng() * 1e9) | 0, rot = rng() * 6;
    if (clearOfTrack(x, y, z, 26, 8, 8) && !overlaps(sph(x, y, z, 18), spheres, .9)) clouds.push({ x, y, z, seed: seedC, rot, drift: .5 + rng() });
  }
  // 떠다니는 자원
  const items = [];
  rng = chunkRng(ci, 14);
  for (let k = 0; k < 10; k++) {
    const s = ci * CH + rng() * CH; frameAt(s, FR); trackPos(s, _P);
    const side = rng() < .5 ? -1 : 1, r = rng(), type = r < .5 ? 'scrap' : r < .85 ? 'wood' : 'crystal';
    _Q.copy(_P).addScaledVector(FR.R, side * (3.8 + rng() * 12)).addScaledVector(FR.U, -1.5 + rng() * 8);
    const rx = rng() * 6, ry = rng() * 6, spin = .4 + rng();
    if (!overlaps(sph(_Q.x, _Q.y, _Q.z, 1), spheres, 1)) items.push({ id: ci + ':' + k, x: _Q.x, y: _Q.y, z: _Q.z, type, rx, ry, spin });
  }
  const plan = { islands, spheres, landmark, clouds, items };
  rawPlans.set(ci, plan);
  return plan;
}
/** 이전 청크 계획과 겹치는 섬 제거 (항상 같은 결과) */
function plan(ci) {
  const p = rawPlan(ci), prev = rawPlan(ci - 1), next = rawPlan(ci + 1);
  const islands = p.islands.filter(is => !overlaps(sph(is.x, is.y - is.r * .8, is.z, is.r * 1.7), prev.spheres, .85));
  // 구름·자원·랜드마크는 이웃 청크의 섬과도 겹치지 않게
  const nb = [...prev.spheres, ...next.spheres];
  return {
    ...p, islands,
    clouds: p.clouds.filter(c => !overlaps(sph(c.x, c.y, c.z, 18), nb, .9)),
    items: p.items.filter(it => !overlaps(sph(it.x, it.y, it.z, 1), nb, 1)),
    landmark: p.landmark && !overlaps(sph(p.landmark.x, p.landmark.y, p.landmark.z, 32), prev.spheres, .9) ? p.landmark : null,
  };
}

/* ---------------- 청크 생성 / 작업 큐 ---------------- */
export const chunks = new Map();
const queue = [];
export const queueLength = () => queue.length;

function buildTrack(rec) {
  const ci = rec.ci, rng = chunkRng(ci, 7), group = rec.group;
  const nS = Math.ceil(CH / STEP), sl = new THREE.InstancedMesh(sleeperGeo, woodMat, nS), rl = new THREE.InstancedMesh(railGeo, steelMat, nS * 2);
  const deco = [], decoGlow = [];
  for (let i = 0; i < nS; i++) {
    const s = ci * CH + i * STEP; frameAt(s, FR); trackPos(s, _P);
    _m.copy(FR.m).setPosition(_P); sl.setMatrixAt(i, _m);
    for (let k = 0; k < 2; k++) { _Q.copy(_P).addScaledVector(FR.R, k ? .72 : -.72).addScaledVector(FR.U, .19); _m.copy(FR.m).setPosition(_Q); rl.setMatrixAt(i * 2 + k, _m); }
    if (i % 7 === 3) { _Q.copy(_P).addScaledVector(FR.U, -1.3 - rng()); deco.push(prep(new THREE.DodecahedronGeometry(.9 + rng() * .8, 0), C('#6f6258').offsetHSL(0, 0, (rng() - .5) * .08), M(_Q.x, _Q.y, _Q.z, rng() * 3, rng() * 3, 0, 1.4, .8, 1.2))); }
    if (Math.round(s / STEP) % 25 === 0) {
      _Q.copy(_P).addScaledVector(FR.R, 2.9);
      deco.push(prep(new THREE.CylinderGeometry(.08, .1, 3, 5), C('#3a3440'), M(_Q.x, _Q.y + 1.3, _Q.z)));
      deco.push(prep(new THREE.BoxGeometry(.5, .08, .5), C('#3a3440'), M(_Q.x, _Q.y + 2.85, _Q.z)));
      decoGlow.push(prep(new THREE.OctahedronGeometry(.28, 0), C('#ffd27a'), M(_Q.x, _Q.y + 2.55, _Q.z)));
    }
  }
  sl.castShadow = sl.receiveShadow = rl.castShadow = true;
  group.add(sl, rl);
  const dg = merged(deco); if (dg) { const dm = new THREE.Mesh(dg, landMat); dm.castShadow = dm.receiveShadow = true; group.add(dm); }
  const dgg = merged(decoGlow); if (dgg) group.add(new THREE.Mesh(dgg, glowMat));
}
function addHolder(rec, geo, x, y, z, rot, bobAmp, cast = true) {
  const holder = new THREE.Group(); holder.position.set(x, y, z); holder.rotation.y = rot;
  const mesh = new THREE.Mesh(geo.solid, landMat); mesh.castShadow = cast; mesh.receiveShadow = true; holder.add(mesh);
  if (geo.glow) holder.add(new THREE.Mesh(geo.glow, crystalMat));
  holder.userData.bob = { base: y, ph: (x * .37) % 6.28, amp: bobAmp };
  rec.group.add(holder); rec.bobbers.push(holder);
}
function createChunk(ci) {
  const rec = { ci, group: new THREE.Group(), bobbers: [], clouds: [], items: [] };
  scene.add(rec.group); chunks.set(ci, rec);
  const p = plan(ci);
  queue.push({ rec, fn: () => buildTrack(rec) });
  const density = QUALITY[S.quality].density;
  for (const is of p.islands) if (is.keep < density || is.near) queue.push({ rec, fn: () => { const g = islandGeometry(is.r, is.B, chunkRng(is.seed, 3), is.B.tree); addHolder(rec, g, is.x, is.y, is.z, is.rot, .4 + (is.seed % 100) / 125, is.r < 40); } });
  if (p.landmark) { const L = p.landmark; queue.push({ rec, fn: () => addHolder(rec, landmarkGeometry(L.kind, L.B, chunkRng(L.seed, 5)), L.x, L.y, L.z, L.rot, .6) }); }
  queue.push({ rec, fn: () => {
    for (const c of p.clouds) { const m = new THREE.Mesh(cloudGeometry(chunkRng(c.seed, 9)), landMat); m.position.set(c.x, c.y, c.z); m.rotation.y = c.rot; m.userData.drift = c.drift; rec.group.add(m); rec.clouds.push(m); }
    for (const it of p.items) { if (taken.has(it.id)) continue; const m = new THREE.Mesh(ITEM_GEO[it.type], it.type === 'crystal' ? crystalMat : landMat); m.position.set(it.x, it.y, it.z); m.rotation.set(it.rx, it.ry, 0); m.castShadow = true; m.userData = { item: it.type, spin: it.spin, id: it.id }; rec.group.add(m); rec.items.push(m); }
  } });
}
function disposeChunk(rec) {
  rec.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh && !SHARED.has(o.geometry)) o.geometry.dispose(); });
  scene.remove(rec.group);
}
export function updateChunks(s) {
  const c0 = Math.floor((s - 160) / CH), c1 = Math.floor((s + 820) / CH), cNow = Math.floor(s / CH);
  for (const [ci, rec] of chunks) if (ci < c0 || ci > c1) { disposeChunk(rec); chunks.delete(ci); }
  for (let i = queue.length - 1; i >= 0; i--) if (!chunks.has(queue[i].rec.ci) || chunks.get(queue[i].rec.ci) !== queue[i].rec) queue.splice(i, 1);
  // 기차 가까운 청크부터 생성
  const order = []; for (let ci = cNow; ci <= c1; ci++) order.push(ci); for (let ci = cNow - 1; ci >= c0; ci--) order.push(ci);
  for (const ci of order) if (!chunks.has(ci)) createChunk(ci);
  for (const ci of [...rawPlans.keys()]) if (ci < c0 - 2 || ci > c1 + 2) rawPlans.delete(ci);
}
/** 예산(ms) 안에서 작업 처리. 같은 청크 작업은 넣은 순서대로 */
export function processQueue(budgetMs) {
  const t0 = performance.now();
  queue.sort((a, b) => Math.abs(a.rec.ci * CH - S.sTrain) - Math.abs(b.rec.ci * CH - S.sTrain));
  while (queue.length && performance.now() - t0 < budgetMs) queue.shift().fn();
}
/* 멀티플레이: 누군가 주운 자원은 모두의 세계에서 사라짐 */
export const taken = new Set();
export function removeItem(id) {
  taken.add(id);
  for (const rec of chunks.values()) { const i = rec.items.findIndex(o => o.userData.id === id); if (i >= 0) { const o = rec.items[i]; rec.group.remove(o); rec.items.splice(i, 1); return { type: o.userData.item, pos: o.position.clone() }; } }
  return null;
}
export function resetWorld() { for (const rec of chunks.values()) disposeChunk(rec); chunks.clear(); queue.length = 0; rawPlans.clear(); }

export function animateWorld(t, dt) {
  for (const rec of chunks.values()) {
    for (const o of rec.bobbers) { const b = o.userData.bob; o.position.y = b.base + Math.sin(t * .4 + b.ph) * b.amp; }
    for (const o of rec.clouds) o.position.x += o.userData.drift * dt;
    for (const o of rec.items) { o.rotation.x += o.userData.spin * dt * .6; o.rotation.y += o.userData.spin * dt * .8; }
  }
}
/** 플레이어 근처 자원 끌어오기·줍기. 주운 목록 반환 */
export function updatePickups(wp, out) {
  out.length = 0;
  for (const rec of chunks.values()) for (let i = rec.items.length - 1; i >= 0; i--) {
    const o = rec.items[i], d = o.position.distanceTo(wp);
    if (d < 4 && d > 1.4) o.position.lerp(wp, .04);
    if (d < 1.4) { out.push({ type: o.userData.item, id: o.userData.id, pos: o.position.clone() }); taken.add(o.userData.id); rec.group.remove(o); rec.items.splice(i, 1); }
  }
  return out;
}
