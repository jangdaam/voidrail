// 지하 산업도시 생성
//
// 두 층으로 나눠 만든다.
//  1) 선로 청크(60m): 레일·침목, 정비 터널(벽·늑골 기둥·배관·작업등·정비문). 열차 주변만 유지.
//     세부 배치(배관 수, 작업등, 문)는 시드에 따라 달라진다.
//  2) 구역 세트(하역장): 방벽, 맞은편 작업층, 철교, 크레인, 화물판, 승강기 등 '한 공간'을 통째로.
//     멀리서도 보여야 하므로 구역에 다가가기 전(앞 터널 안)에 여러 프레임에 나눠 미리 만든다.
//     구도는 직접 설계한 것으로, 첫 구역은 시드와 무관하게 같다.
// 모든 정적 구조물은 Mesher 로 재질별 메시 몇 개에 합친다(그리기 호출 최소화). 그림자·충돌 없음.
import * as THREE from 'three';
import { C, Mesher, landMat, glowMat, woodMat, steelMat } from './geo.js';
import { trackPos, frameAt, makeFrame, sector, localZ, SECTOR, U } from './track.js';
import { scene, camera, renderer } from './scene.js';
import { CH, SEG, STEP, QUALITY } from './config.js';
import { hash, mulberry, getSeed } from './noise.js';
import { S } from './state.js';

/* ---------- 색 ---------- */
const STEELD = C('#14171b'), STEEL = C('#22262d'), STEELL = C('#363c45'), CONCD = C('#2b3037'), CONC = C('#434950'), CONCL = C('#5a6169'),
  RUST = C('#553222'), RUSTL = C('#80492a'), HAZ = C('#6e5a1f');
/* 조명은 희고 푸르게. 따뜻한 색(호박·적색)은 화물판 경고등처럼 몇 곳에만 */
const WARM = C('#e6eef6'), WHITE = C('#a8c6ea'), AMBER = C('#ff9a30'), RED = C('#e04a30'), DIMWARM = C('#8fa3b8'), DIMWHITE = C('#587592');

/* ---------- 불빛 번짐(헤일로): 점 하나 = 불빛 하나. 수백 개도 그리기 호출 1번 ---------- */
const haloMat = new THREE.ShaderMaterial({
  uniforms: { scale: { value: 600 } },
  vertexShader: `attribute float size; attribute vec3 col; varying vec3 vC; uniform float scale;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); float d = -mv.z;
      gl_PointSize = clamp(size*scale/d*1.7, 3., 300.);
      vC = col * exp(-d*.0011) * min(1., size*scale/d*.6 + .35);      // 멀수록 흐려지되 안개에 완전히 묻히지는 않음
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
const poolMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
class Pools {
  constructor() { this.p = []; this.c = []; }
  /** 중심 c, 면을 이루는 두 축 u·v, 반지름 r */
  disc(cx, cy, cz, ux, uy, uz, vx, vy, vz, r, col, k) {
    const N = 12, P = this.p, Cc = this.c;
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

/* ---------- 공용 ---------- */
const sleeperGeo = new THREE.BoxGeometry(.45, .22, 3), railGeo = new THREE.BoxGeometry(STEP + .06, .16, .14), unitBox = new THREE.BoxGeometry(1, 1, 1);
const SHARED = new Set([sleeperGeo, railGeo, unitBox]);
const FR = makeFrame(), FR2 = makeFrame(), _P = new THREE.Vector3(), _Q = new THREE.Vector3(), _A = new THREE.Vector3(), _B = new THREE.Vector3(), _m = new THREE.Matrix4();
const ID = { T: new THREE.Vector3(1, 0, 0), U: new THREE.Vector3(0, 1, 0), R: new THREE.Vector3(0, 0, 1) };
const off = (s, u, r, out) => { frameAt(s, FR2); return trackPos(s, out).addScaledVector(FR2.U, u).addScaledVector(FR2.R, r); };
function addBuilt(group, ...objs) { for (const o of objs) if (o) { o.updateMatrix?.(); group.add(o); } }
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
  return { k, u, m: c.m, tunnel: u < U.bridge0 || u >= U.ramp1, open: u >= U.shaft0 && u < U.bridge0 ? c.m : u >= U.well0 && u < U.well1 ? -c.m : 0 };
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
  const nS = Math.ceil(CH / STEP), sl = new THREE.InstancedMesh(sleeperGeo, woodMat, nS), rl = new THREE.InstancedMesh(railGeo, steelMat, nS * 2);
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
    if ((gi + st.lampPhase) % st.lampEvery === 0 && hash(gi, 51) > .22) {
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
      M.fbox(_P, FR, 1.2, 1.3, w * 5.55, 1.5, 2.4, .16, STEELD); M.fbox(_P, FR, 1.2, 1.28, w * 5.5, 1.1, 2.1, .16, STEEL);
      G.fbox(_P, FR, 1.2, 2.72, w * 5.5, .5, .14, .1, hash(gi, 42) < .3 ? RED : DIMWARM);
      M.fbox(_P, FR, 1.62, 1.25, w * 5.42, .05, .3, .05, STEELL);          // 손잡이
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

  /* 방벽: 위아래 끝이 보이지 않는 벽 */
  jobs.push(() => {
    const [M, G, H] = mk(), Y0 = -430, Y1 = 500;
    M.span(X0 - 12, X1 + 12, Y0, Y1, ZN - 10, ZN, CONCD); M.span(X0 - 12, X1 + 12, Y0, Y1, ZF, ZF + 10, CONCD);
    // 양 끝 벽 (터널이 뚫고 지나는 구멍)
    for (const [x, zt, y, hw] of [[X0 - 10, zt0, 0, 9.5], [X1, zt1, c.rise, 7.4]]) {
      M.span(x, x + 10, Y0, y - 1.4, ZN, ZF, CONCD); M.span(x, x + 10, y + 8.8, Y1, ZN, ZF, CONCD);
      M.span(x, x + 10, y - 1.4, y + 8.8, ZN, zt - hw, CONCD); M.span(x, x + 10, y - 1.4, y + 8.8, zt + hw, ZF, CONCD);
    }
    // 방벽의 버팀기둥과 수평 띠 → 크기를 재는 눈금
    for (let x = X0 + 30; x < X1; x += 55) M.box(x, 35, ZN + 1.6, 6, 930, 3.2, CONC);
    for (let y = -400; y < 480; y += 44) M.span(X0, X1, y, y + 2.6, ZN, ZN + 1.3, CONC);
    for (const x of [X0, X1]) for (let y = -390; y < 480; y += 66) M.span(x - (x === X0 ? 0 : 1.2), x + (x === X0 ? 1.2 : 0), y, y + 3, ZN, ZF, CONC);
    // 입구 표지: 호박색 틀 (위에서 돌아볼 때 '저기서 나왔다'를 알아보는 기준)
    for (const dz of [-7.2, 7.2]) { G.box(X0 + .4, 3.6, zt0 + dz, .3, 7.6, .3, WARM); H.add(X0 + .6, 6.5, zt0 + dz, 6, WARM); }
    G.box(X0 + .4, 8.9, zt0, .3, .3, 14.6, WARM); washX(X0 + .25, 5, zt0, 24, WARM, .2); washX(X1 - .25, c.rise + 5, zt1, 18, WHITE, .12);
    for (let x = X0 + 58; x < X1; x += 110) { const y = 60 + R() * 120; wash(x, y, ZN + 1.4, 40 + R() * 16, WHITE, .05); G.box(x, y + 26, ZN + 3.4, .8, .5, .8, WHITE); H.add(x, y + 26, ZN + 4, 7, WHITE, .8); }
    for (const dz of [-6.4, 6.4]) { G.box(X1 - .4, c.rise + 3.6, zt1 + dz, .3, 7.6, .3, WHITE); H.add(X1 - .6, c.rise + 6.5, zt1 + dz, 4, WHITE); }
    done(M, G, H);
  });

  /* 맞은편 작업층: 층층이 쌓인 난간과 불 켜진 문 */
  jobs.push(() => {
    const [M, G, H] = mk();
    for (let y = -220, lv = 0; y <= 290; y += 22, lv++) {
      M.span(X0, X1, y - .7, y, ZF - 9, ZF, CONC);
      M.span(X0, X1, y + 1.05, y + 1.15, ZF - 9.1, ZF - 9, STEELL);
      for (let x = X0 + 15; x < X1; x += 30) M.box(x, y + 10.6, ZF - 8.4, 1.3, 21.3, 1.3, CONCD);
      for (let x = X0 + 8; x < X1 - 8; x += 15) {
        const h = R(); if (h > .2) continue;
        const col = h < .03 ? WHITE : h < .17 ? DIMWARM : DIMWHITE;
        G.box(x, y + 1.15, ZF - .05, 1.2, 2.2, .2, col);                   // 사람 크기의 문
        if (h < .07) H.add(x, y + 1.6, ZF - .6, 3.2, col === WHITE ? WHITE : WARM, .7);
      }
    }
    for (let i = 0; i < 10; i++) { const x = X0 + 40 + R() * (X1 - X0 - 80), y = -150 + R() * 330, r = 28 + R() * 22, warm = R() < .35; wash(x, y, ZF - .2, r * 1.3, warm ? WARM : WHITE, .05); G.box(x, y + r * .7, ZF - 2, .9, .6, .9, warm ? WARM : WHITE); H.add(x, y + r * .7, ZF - 2.6, 8, warm ? WARM : WHITE, .8); }
    done(M, G, H);
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
        if (h < .6) G.box(x, y + 2.45, ZN + .2, .5, .14, .1, h < .12 ? RED : DIMWARM);
        if (h < .28) { G.box(x + 3, y + 2.3, ZN + .25, .3, .2, .3, WARM); H.add(x + 3, y + 2.2, ZN + .6, 3.4, WARM, .75); wash(x + 3, y + .6, ZN + .12, 6.5, WARM, .22); if (y === 10) lamp(x + 3, y + 1.8, ZN + 2.5, WARM); }
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
        M.fbox(_P, FR, 0, -.62, 0, SEG + .4, 1, 7.6, STEEL);                                      // 상판
        for (const sd of [-1, 1]) {
          M.fbox(_P, FR, 0, -1.95, sd * 3.3, SEG + .4, 1.7, .5, STEELD);
          M.fbox(_P, FR, 0, .98, sd * 3.68, SEG + .4, .07, .07, STEELL); M.fbox(_P, FR, 0, .5, sd * 3.68, SEG + .4, .05, .05, STEELL);   // 난간
          for (let q = -1; q <= 1; q++) M.fbox(_P, FR, q * 3.3, .43, sd * 3.68, .07, 1.1, .07, STEELL);
          if (bridge) { M.fbox(_P, FR, 0, -7.2, sd * 3.3, SEG + .4, .7, .6, STEELD); M.fbox(_P, FR, -SEG / 2, -4.6, sd * 3.3, .45, 5.4, .45, STEELD); }   // 철교의 하부 트러스
        }
        if (bridge) M.fbox(_P, FR, -SEG / 2, -7.2, 0, .5, .5, 6.6, STEELD);
        // 난간등: 철교는 따뜻한 불빛이 촘촘히, 고가는 차가운 불빛이 드문드문 → 위에서 내려다볼 때 구분됨
        if (gi % (bridge ? 3 : 6) === 0) {
          const sd = -c.m, col = bridge ? WARM : WHITE;
          M.fbox(_P, FR, 0, 1.9, sd * 3.68, .1, 2.9, .1, STEELL); G.fbox(_P, FR, 0, 3.3, sd * 3.5, .28, .18, .5, col);
          _Q.copy(_P).addScaledVector(FR.U, 3.25).addScaledVector(FR.R, sd * 3.4); H.raw(_Q, bridge ? 4.2 : 3.4, col, .85);
          _Q.copy(_P).addScaledVector(FR.U, -.1).addScaledVector(FR.R, sd * 1.6); PL.disc(_Q.x, _Q.y, _Q.z, FR.T.x, FR.T.y, FR.T.z, FR.R.x, FR.R.y, FR.R.z, bridge ? 5.5 : 4.5, col, .2);      // 상판에 떨어진 빛
          _Q.addScaledVector(FR.U, 2.9); rec.lamps.push({ p: _Q.clone(), c: col });
        }
      }
      if (gi % 6 === 2) {                                                                          // 교각: 어둠 속으로 내려감
        M.fbox(_P, ID, 0, -217, 0, 5, 430, 5, CONCD); M.fbox(_P, ID, 0, -2.6, 0, 7, 2.6, 9, CONC);
        if (u >= U.bridge0) for (const d of [60, 130]) M.fbox(_P, ID, 0, -d, 0, 6.2, 1.2, 6.2, CONC);
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
      for (let z = ZN + 18; z < ZF; z += 36) { G.box(x, y + 4.8, z, .4, .2, .4, col); H.add(x, y + 4.6, z, 3.4, col, .8); }
    }
    // 저장 탱크 (중간 거리의 큰 덩어리)
    const tz = ZF - 46, ty = -38;
    M.span(390, 560, ty - 3, ty, tz - 30, ZF, CONC);
    for (let x = 400; x <= 550; x += 50) { M.box(x, ty - 30, tz - 24, 3, 56, 3, CONCD); M.pipe(x, ty - 3, tz - 24, x, ty - 40, ZF - 2, 1.4, STEELD, 4); }
    for (const [x, r, h, col] of [[425, 17, 66, STEEL], [475, 14, 52, RUST], [522, 17, 72, STEEL]]) {
      M.pipe(x, ty, tz, x, ty + h, tz, r, col, 12);
      M.box(x, ty + h + .5, tz, r * 1.85, 1, r * 1.85, STEELL); M.box(x, ty + h + .5, tz, r * 1.85, 1, r * 1.85, STEELL, .785);
      M.pipe(x, ty + h, tz, x, ty + h + 9, tz, 2.2, STEELD, 6);
      for (let y = ty + 12; y < ty + h; y += 16) M.pipe(x, y, tz, x, y + 1, tz, r + .5, STEELL, 12);
      G.box(x, ty + h + 9.6, tz, .6, .6, .6, RED); H.add(x, ty + h + 9.8, tz, 6, RED, .9);
      M.box(x - r - .8, ty + h / 2, tz, .12, h, .7, STEELL);                                       // 탱크 사다리
    }
    // 컨베이어: 맞은편 벽의 하역구에서 내려오는 긴 경사 다리
    const cx = 700;
    M.pipe(cx, 24, ZF - 4, cx, -14, ZN + 150, 3.2, STEEL, 4); M.box(cx, -17, ZN + 146, 16, 12, 16, STEELD);
    for (let z = ZN + 170; z < ZF - 10; z += 34) { const y = -14 + (z - ZN - 150) / (c.width - 154) * 38; M.box(cx - 3, y - 215, z, 1.2, 426, 1.2, STEELD); M.box(cx + 3, y - 215, z, 1.2, 426, 1.2, STEELD); M.box(cx, y - 6, z, 7, .8, .8, STEELD); }
    G.box(cx, 26, ZF - .3, 9, 6, .4, DIMWARM); H.add(cx, 27, ZF - 2, 9, WARM, .6);
    for (let z = ZN + 170; z < ZF - 10; z += 68) { const y = -10 + (z - ZN - 150) / (c.width - 154) * 38; G.box(cx + 3.4, y, z, .3, .3, .3, WHITE); H.add(cx + 3.6, y, z, 2.8, WHITE, .7); }
    // 천장에서 늘어진 사슬과 갈고리 (선로 위는 피함)
    for (let i = 0; i < 16; i++) {
      const x = X0 + 40 + R() * (X1 - X0 - 80), z = ZN + 105 + R() * (c.width - 150), len = 150 + R() * 260, yb = 470 - len;
      if (Math.abs(x - CRANE.x) < 40 || Math.abs(x - 760) < 30) continue;
      M.box(x, 470 - len / 2, z, .55, len, .55, STEELD);
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
    // 횡행대차 (권상기)
    M.box(K.x, K.y + 5, K.cargoZ, 18, 7, 26, STEEL); M.box(K.x, K.y + 10.5, K.cargoZ, 10, 4, 12, STEELD);
    for (const [dx, dz] of [[-8, -11], [8, -11], [-8, 11], [8, 11]]) { M.pipe(K.x + dx, K.y + 1.5, K.cargoZ + dz - 1.5, K.x + dx, K.y + 1.5, K.cargoZ + dz + 1.5, 1.6, STEELD, 8); G.box(K.x + dx, K.y + .9, K.cargoZ + dz * .6, .9, .3, .9, WARM); H.add(K.x + dx, K.y + .5, K.cargoZ + dz * .6, 8, WARM, .9); }
    // 운전실 (사람 크기의 창)
    M.box(K.x + 12, K.y - 1.5, K.cargoZ - 20, 4, 3.4, 4, STEEL); G.box(K.x + 12, K.y - 1.2, K.cargoZ - 22.05, 3, 1.2, .1, DIMWARM); M.box(K.x + 12, K.y + 1, K.cargoZ - 20, .3, 3, .3, STEELD);
    // 승강기 탑 (격자 기둥)
    const ex = 760, ez = ZF - 36;
    for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) M.box(ex + dx, 35, ez + dz, 1.6, 930, 1.6, STEELD);
    for (let y = -420; y < 490; y += 24) { M.box(ex, y, ez - 8, 16, .7, .7, STEELD); M.box(ex, y, ez + 8, 16, .7, .7, STEELD); M.box(ex - 8, y, ez, .7, .7, 16, STEELD); M.box(ex + 8, y, ez, .7, .7, 16, STEELD); M.pipe(ex - 8, y, ez - 8, ex + 8, y + 24, ez - 8, .3, STEELD, 4); }
    for (let y = -196; y < 300; y += 44) { M.span(ex - 8, ex + 8, y - .6, y, ez + 8, ZF, STEEL); G.box(ex, y + 3.4, ez + 8.3, .5, .3, .3, AMBER); H.add(ex, y + 3.4, ez + 7.6, 3, AMBER, .6); }
    done(M, G, H); addBuilt(rec.group, PL.build());
    buildMoving(rec, W);
  });

  /* 상부 정비 통로 옆의 수직 갱도: 위로 남은 작업층과 오르내리는 승강대를 잠깐 내다보는 곳 */
  jobs.push(() => {
    const M = new Mesher(), G = new Mesher(), H = new Halos(), sd = -c.m;
    trackPos(ox + (U.well0 + U.well1) / 2, _P);
    const xa = _P.x - 62, xb = _P.x + 62, za = _P.z + sd * 6.9, zb = _P.z + sd * 104, zc = (za + zb) / 2, Y = _P.y, D = Math.abs(zb - za);
    const zbox = (x0, x1, y0, y1, z0, z1, col, MM = M) => MM.span(x0, x1, y0, y1, Math.min(z0, z1), Math.max(z0, z1), col);
    zbox(xa - 8, xb + 8, Y - 430, Y + 520, zb, zb + sd * 8, CONCD); zbox(xa - 8, xa, Y - 430, Y + 520, za, zb, CONCD); zbox(xb, xb + 8, Y - 430, Y + 520, za, zb, CONCD);
    zbox(xa, xb, Y - 430, Y - 1.3, za, za - sd * 3, CONCD); zbox(xa, xb, Y + 8.7, Y + 520, za, za - sd * 3, CONCD);                // 통로 위아래의 벽
    zbox(xa, _P.x - 25, Y - 1.3, Y + 8.7, za, za - sd * 3, CONCD); zbox(_P.x + 25, xb, Y - 1.3, Y + 8.7, za, za - sd * 3, CONCD);
    for (let y = Y - 396; y < Y + 500; y += 22) {
      zbox(xa, xb, y - .7, y, zb, zb - sd * 7, CONC); zbox(xa, xb, y + 1.05, y + 1.15, zb - sd * 7, zb - sd * 7.1, STEELL);
      for (let x = xa + 10; x < xb; x += 20) M.box(x, y + 10.6, zb - sd * 6.4, 1.2, 21.3, 1.2, CONCD);
      for (let x = xa + 6; x < xb; x += 12) { const h = R(); if (h > .3) continue; G.box(x, y + 1.15, zb - sd * .05, 1.2, 2.2, .2, h < .2 ? DIMWARM : DIMWHITE); if (h < .09) H.raw(_Q.set(x, y + 1.6, zb - sd * .7), 3, WARM, .7); }
    }
    for (const dx of [-44, -36, 40]) M.pipe(_P.x + dx, Y - 430, zc + sd * 30, _P.x + dx, Y + 520, zc + sd * 30, dx > 0 ? 4.5 : 3, dx > 0 ? RUST : STEELL, 10);
    for (const [dx, dz] of [[-17, -15], [17, -15], [-17, 15], [17, 15]]) M.box(_P.x + dx, Y + 45, zc + dz, 1.5, 950, 1.5, STEELD);     // 승강대 가이드
    for (let y = Y - 400; y < Y + 500; y += 30) { M.box(_P.x, y, zc - 15, 34, .6, .6, STEELD); M.box(_P.x, y, zc + 15, 34, .6, .6, STEELD); }
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
  const cone = lightCone(190, 34, WARM, .09); cone.position.set(base.x, c.y0 + K.y, base.z); rec.group.add(cone);
  // 승강기 칸
  const E = new Mesher(), EG = new Mesher(), EH = new Halos();
  E.box(0, 0, 0, 13, 8, 13, STEEL); E.box(0, 4.6, 0, 5, 1.6, 5, STEELD); EG.box(0, .6, -6.55, 10, 2, .1, WARM); EG.box(-6.55, .6, 0, .1, 2, 10, WARM); EG.box(6.55, .6, 0, .1, 2, 10, DIMWARM);
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
const BACK = 250, AHEAD = 430;

export function updateChunks(s) {
  const c0 = Math.floor((s - BACK) / CH), c1 = Math.floor((s + AHEAD) / CH), here = Math.floor(s / CH);
  for (let ci = c0; ci <= c1; ci++) if (!chunks.has(ci)) { chunks.set(ci, null); queue.push({ ci, pri: Math.abs(ci - here) }); }
  for (const [ci, rec] of chunks) if (ci < c0 - 1 || ci > c1 + 1) { if (rec) dispose(rec.group); chunks.delete(ci); lampsDirty = true; }
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
  chunks.clear(); sectors.clear(); queue.length = 0; styles.clear(); lampsDirty = true;
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
    L.position.copy(src.p); L.color.copy(src.c); L.intensity = 95;
  }
}
