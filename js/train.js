// 걸어다닐 수 있는 4량 기차: 시각 메시 + 차량 로컬 충돌 박스
import * as THREE from 'three';
import { clamp } from './noise.js';
import { C, prep, M, merged, landMat, glowMat, glassMat } from './geo.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { scene } from './scene.js';
import { F } from './config.js';
import { S } from './state.js';

const RED = C('#c9503a'), GOLD = C('#f2c14e'), DARK = C('#2e2b34'), WOOD = C('#9a6a44'), FLOOR = C('#b98b5c'),
  TEAL = C('#2f8f9d'), MUST = C('#d39b3a'), CREAM = C('#f3e6cc'), GLOWC = C('#ffd98a'), FIRE = C('#ff7a2e'), STONE = C('#5b5560'), CEIL = C('#e6d2ae');
const RAIL_H = 1.25;   // 난간 충돌 높이 (점프로 못 넘음, 시각 난간은 1.0)

/* 차량 폭 확장: 아래 부품 정의는 원래 폭(바깥 반폭 1.7m) 기준 좌표로 적혀 있고,
 * 중심선에서 ZT 보다 바깥의 z 좌표는 WIDEN 만큼 일괄로 밀어낸다 → 실내 폭 3.2m → 4.4m.
 * 문·선로·보일러처럼 중앙에 있는 것은 그대로. 최종 좌표로 직접 적을 땐 { raw: true }. */
export const WIDEN = .6, ZT = 1.1, HALF_W = 1.7 + WIDEN;     // HALF_W: 바닥 바깥 반폭
const zmap = z => Math.abs(z) > ZT + 1e-6 ? z + Math.sign(z) * WIDEN : z;

class CarB {
  constructor() { this.solid = []; this.glow = []; this.glass = []; this.boxes = []; this.vis = []; }
  /** 시각 상자는 바로 만들지 않고 기록 → build() 에서 겹친 면 정리 후 생성 */
  box(x0, x1, y0, y1, z0, z1, col, o = {}) {
    const { collide = true, visual = true, kind = 'solid', raw = false } = o;
    if (!raw) { z0 = zmap(z0); z1 = zmap(z1); }
    if (visual) this.vis.push({ min: [x0, y0, z0], max: [x1, y1, z1], col, kind });
    if (collide) this.boxes.push({ min: [x0, y0, z0], max: [x1, y1, z1] });
  }
  /**
   * Z-파이팅 원천 차단: 같은 방향을 보는 두 면이 같은 평면에서 겹치면(면적 > 0)
   * 나중에 추가된 상자(장식·디테일)의 그 면을 바깥으로 EPS 만큼 밀어낸다.
   * 로그 깊이 버퍼 덕분에 4mm 차이도 먼 거리에서 구분된다.
   */
  resolveCoplanar() {
    const V = this.vis, EPS = .004, T = 1e-5; let fixed = 0;
    for (let pass = 0; pass < 6; pass++) {
      let changed = 0;
      for (let j = 1; j < V.length; j++) {
        const b = V[j];
        for (let i = 0; i < j; i++) {
          const a = V[i];
          if (a.max[0] < b.min[0] - T || a.min[0] > b.max[0] + T || a.max[1] < b.min[1] - T || a.min[1] > b.max[1] + T || a.max[2] < b.min[2] - T || a.min[2] > b.max[2] + T) continue;
          for (let ax = 0; ax < 3; ax++) {
            const u = (ax + 1) % 3, v = (ax + 2) % 3;
            const ou = Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]);
            const ov = Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]);
            if (ou <= T || ov <= T) continue;
            if (Math.abs(a.max[ax] - b.max[ax]) < T) { b.max[ax] += EPS; changed++; }
            if (Math.abs(a.min[ax] - b.min[ax]) < T) { b.min[ax] -= EPS; changed++; }
          }
        }
      }
      if (!changed) return { fixed, remaining: 0 };
      fixed += changed;
    }
    return { fixed, remaining: -1 };            // 6회 안에 수렴 못함 (디버그용)
  }
  build() {
    const fixed = this.resolveCoplanar();
    for (const r of this.vis) {
      const [x0, y0, z0] = r.min, [x1, y1, z1] = r.max;
      this[r.kind].push(prep(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), r.col, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)));
    }
    return fixed;
  }
  add(geo, col, m, kind = 'solid', raw = false) {
    if (m && !raw) m.elements[14] = zmap(m.elements[14]);       // 위치(z)만 확장, 모양은 그대로
    this[kind].push(prep(geo, col, m));
  }
  base(x0, x1, plates) {
    this.box(x0, x1, F - .3, F, -1.7, 1.7, FLOOR);
    this.box(x0 + .4, x1 - .4, F - .85, F - .3, -1.2, 1.2, DARK, { collide: false });
    // 연결 발판: 커브에서도 틈이 안 생기도록 넉넉히 겹침
    if (plates.includes('front')) this.box(x1, x1 + .62, F - .14, F - .008, -.72, .72, DARK);   // 이웃 발판과 높이 엇갈림
    if (plates.includes('rear')) this.box(x0 - .62, x0, F - .12, F, -.72, .72, DARK);
  }
  sideWall(z, x0, x1, doors, col) {
    const t0 = z - .06, t1 = z + .06; let cur = x0; const segs = [];
    for (const [d0, d1] of doors) { if (d0 > cur) segs.push([cur, d0]); cur = d1; }
    if (cur < x1) segs.push([cur, x1]);
    for (const [a, b] of segs) {
      this.box(a, b, F, F + 1, t0, t1, col);
      this.box(a, b, F + 1.9, F + 2.6, t0, t1, col);
      this.box(a, b, F + 1, F + 1.9, t0, t1, col, { visual: false });
      const n = Math.max(1, Math.round((b - a) / 1.5));
      for (let i = 0; i <= n; i++) { const x = clamp(a + (b - a) * i / n, a + .08, b - .08); this.box(x - .08, x + .08, F + 1.04, F + 1.9, t0 - .03, t1 + .03, col, { collide: false }); }
      this.box(a, b, F + .97, F + 1.04, t0 - .05, t1 + .05, CREAM, { collide: false });   // 창틀
      this.box(a, b, F + 1, F + 1.9, z - .01, z + .01, GLOWC, { collide: false, kind: 'glass' });
    }
    for (const [d0, d1] of doors) {
      this.box(d0, d1, F + 2.2, F + 2.6, t0, t1, col);
      this.box(d0 - .1, d0, F, F + 2.2, t0 - .05, t1 + .05, DARK, { collide: false });
      this.box(d1, d1 + .1, F, F + 2.2, t0 - .05, t1 + .05, DARK, { collide: false });
    }
  }
  endWall(x, col, door = 1.3) {
    const t0 = x - .06, t1 = x + .06, h = door / 2;
    this.box(t0, t1, F, F + 2.6, -1.7, -h, col); this.box(t0, t1, F, F + 2.6, h, 1.7, col); this.box(t0, t1, F + 2.2, F + 2.6, -h, h, col);
  }
  roof(x0, x1, col = DARK) {
    this.box(x0 - .1, x1 + .1, F + 2.6, F + 2.8, -1.85, 1.85, col);
    this.box(x0 + .1, x1 - .1, F + 2.5, F + 2.57, -1.54, 1.54, CEIL, { collide: false });
    this.box(x0, x1, F + 2.83, F + 2.92, -1.2, 1.2, CREAM, { collide: false });
  }
  railing(x0, x1, z0, z1, gaps = []) {
    const alongX = (x1 - x0) > (z1 - z0); let cur = alongX ? x0 : z0; const end = alongX ? x1 : z1; const segs = [];
    for (const [g0, g1] of gaps) { if (g0 > cur) segs.push([cur, g0]); cur = g1; }
    if (cur < end) segs.push([cur, end]);
    for (const [a, b] of segs) {
      const n = Math.max(1, Math.ceil((b - a) / 1.2));
      if (alongX) {
        this.box(a, b, F, F + RAIL_H, z0, z1, DARK, { visual: false });
        this.box(a, b, F + .92, F + 1, z0, z1, DARK, { collide: false }); this.box(a, b, F + .45, F + .5, z0, z1, DARK, { collide: false });
        for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; this.box(x - .04, x + .04, F, F + 1, z0, z1, DARK, { collide: false }); }
      } else {
        const za = zmap(a), zb = zmap(b), nz = Math.max(1, Math.ceil((zb - za) / 1.2));   // 넓힌 뒤 기둥을 고르게
        this.box(x0, x1, F, F + RAIL_H, za, zb, DARK, { visual: false, raw: true });
        this.box(x0, x1, F + .92, F + 1, za, zb, DARK, { collide: false, raw: true });
        for (let i = 0; i <= nz; i++) { const z = za + (zb - za) * i / nz; this.box(x0, x1, F, F + 1, z - .04, z + .04, DARK, { collide: false, raw: true }); }
      }
    }
  }
}

export const CARS = [];
export const coplanarReport = {};
function finishCar(B, x0, x1, wheelXs, name) {
  coplanarReport[name] = B.build();
  const g = new THREE.Group();
  const sm = new THREE.Mesh(merged(B.solid), landMat); sm.castShadow = sm.receiveShadow = true; g.add(sm);
  if (B.glow.length) g.add(new THREE.Mesh(merged(B.glow), glowMat));
  if (B.glass.length) g.add(new THREE.Mesh(merged(B.glass), glassMat));
  const wheels = [], wg = new THREE.CylinderGeometry(.5, .5, .22, 8).rotateX(Math.PI / 2);
  for (const x of wheelXs) for (const z of [-.86, .86]) {
    const w = new THREE.Mesh(prep(wg.clone(), DARK), landMat); w.position.set(x, .5, z); w.castShadow = true; g.add(w); wheels.push(w);
    w.add(new THREE.Mesh(prep(new THREE.BoxGeometry(.75, .12, .24), GOLD), landMat));
  }
  scene.add(g);
  const car = { g, x0, x1, boxes: B.boxes, name, off: 0, wheels, frame: makeFrame(), inv: new THREE.Matrix4() };
  CARS.push(car); return car;
}
const bogie = (x0, x1) => [x0 + 1.1, x0 + 2.2, x1 - 2.2, x1 - 1.1];

/* 1) 기관차 */
const L = new CarB();
L.base(-4.5, 4.5, ['rear']);
L.sideWall(1.64, -4.5, -.7, [[-2.3, -1.4]], RED); L.sideWall(-1.64, -4.5, -.7, [[-2.3, -1.4]], RED);
L.endWall(-4.5, RED);
L.box(-.84, -.7, F, F + 2.6, -1.05, 1.05, DARK);
L.box(-.84, -.7, F + 2.2, F + 2.6, 1.05, 1.7, RED); L.box(-.84, -.7, F + 2.2, F + 2.6, -1.7, -1.05, RED);
L.roof(-4.5, -.7);
L.box(-.68, -.62, F + .3, F + .95, -.38, .38, FIRE, { collide: false, kind: 'glow' });
L.box(-.68, -.62, F + 1.75, F + 2.0, -.6, -.35, GLOWC, { collide: false, kind: 'glow' });
L.box(-.68, -.62, F + 1.75, F + 2.0, .35, .6, GLOWC, { collide: false, kind: 'glow' });
L.box(-4.3, -3.6, F, F + .5, 1.6, 2.18, WOOD, { raw: true });                          // 기관사 의자
L.box(-4.4, -3.3, F, F + .9, -2.18, -1.2, DARK, { raw: true });                        // 석탄통
L.add(new THREE.DodecahedronGeometry(.45, 0), C('#232027'), M(-3.85, F + .95, -1.69, 0, 0, 0, 1.2, .5, 1), 'solid', true);
L.add(new THREE.CylinderGeometry(1.05, 1.05, 4.4, 10), RED, M(1.5, F + 1.15, 0, 0, 0, Math.PI / 2));
for (const x of [.3, 1.5, 2.7]) L.add(new THREE.CylinderGeometry(1.09, 1.09, .14, 10), GOLD, M(x, F + 1.15, 0, 0, 0, Math.PI / 2));
L.add(new THREE.CylinderGeometry(.95, .95, .3, 10), DARK, M(3.8, F + 1.15, 0, 0, 0, Math.PI / 2));
L.box(-.7, 3.95, F, F + 2.2, -1.05, 1.05, RED, { visual: false });
L.add(new THREE.CylinderGeometry(.28, .22, 1.3, 7), DARK, M(2.8, F + 2.75, 0)); L.add(new THREE.CylinderGeometry(.5, .28, .45, 7), DARK, M(2.8, F + 3.55, 0));
L.box(2.5, 3.1, F + 2.1, F + 3.8, -.3, .3, DARK, { visual: false });
L.add(new THREE.SphereGeometry(.42, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), GOLD, M(1.2, F + 2.1, 0)); L.box(.85, 1.55, F + 2.1, F + 2.5, -.4, .4, GOLD, { visual: false });
L.railing(-.7, 4.45, 1.62, 1.7); L.railing(-.7, 4.45, -1.7, -1.62); L.railing(4.38, 4.46, -1.7, 1.7);
L.add(new THREE.CylinderGeometry(.26, .26, .25, 8), GLOWC, M(4.0, F + 2.35, 0, 0, 0, Math.PI / 2), 'glow');
L.box(3.85, 4.15, F + 2.15, F + 2.55, -.2, .2, DARK, { visual: false });
L.add(new THREE.ConeGeometry(.9, 1.1, 4), DARK, M(5.0, .75, 0, 0, Math.PI / 4, -Math.PI / 2));
export const locoCar = finishCar(L, -4.5, 4.5, [-3.4, -2.2, 1.2, 2.6, 3.8], '기관실');
export const LEVER_POS = new THREE.Vector3(-.95, F, .62);
export const lever = new THREE.Group(); lever.position.set(-.95, F + .95, .62);
lever.add(new THREE.Mesh(prep(new THREE.BoxGeometry(.08, .8, .08), GOLD, M(0, .4, 0)), landMat));
lever.add(new THREE.Mesh(prep(new THREE.IcosahedronGeometry(.1, 0), RED, M(0, .82, 0)), landMat));
locoCar.g.add(lever);
locoCar.g.add(new THREE.Mesh(prep(new THREE.BoxGeometry(.25, .2, .3), DARK, M(-.95, F + .9, .62)), landMat));

/* 2) 작업실 */
const Wk = new CarB();
Wk.base(-4.5, 4.5, ['front', 'rear']);
Wk.sideWall(1.64, -4.5, 4.5, [[-.7, .7]], MUST); Wk.sideWall(-1.64, -4.5, 4.5, [[-.7, .7]], MUST);
Wk.endWall(-4.5, MUST); Wk.endWall(4.5, MUST); Wk.roof(-4.5, 4.5);
Wk.box(-3.7, -1.2, F, F + .9, 1.6, 2.18, WOOD, { raw: true });                         // 작업대
Wk.box(-3.4, -3.0, F + .9, F + 1.15, 1.75, 2.05, C('#6b7a86'), { collide: false, raw: true });
Wk.box(-2.4, -1.6, F + .9, F + 1.0, 1.7, 2.1, C('#7c858f'), { collide: false, raw: true });
Wk.add(new THREE.CylinderGeometry(.06, .06, .5, 5), C('#c27b46'), M(-2.0, F + 1.0, 1.85, 0, 0, Math.PI / 2), 'solid', true);
Wk.box(1.2, 3.9, F, F + 2.0, -1.58, -1.15, WOOD, { visual: false });
// 선반: 뒤판은 창틀(벽 안쪽 -1.53)보다 확실히 안쪽에 두고, 선반널·물건은 판 사이에 끼움
Wk.box(1.2, 3.9, F, F + 2.0, -1.5, -1.45, WOOD, { collide: false }); Wk.box(1.2, 1.27, F, F + 2.0, -1.45, -1.15, WOOD, { collide: false }); Wk.box(3.83, 3.9, F, F + 2.0, -1.45, -1.15, WOOD, { collide: false });
for (const y of [.08, .65, 1.3, 1.95]) Wk.box(1.27, 3.83, F + y - .05, F + y, -1.45, -1.17, C('#7a5233'), { collide: false });
for (let i = 0; i < 6; i++) Wk.box(1.4 + i * .42, 1.7 + i * .42, F + .652 + (i % 3) * .65, F + .9 + (i % 3) * .65, -1.42, -1.22, [C('#5fa8d3'), C('#e07a5f'), C('#81b29a'), C('#f2cc8f')][i % 4], { collide: false });
Wk.box(-4.3, -3.2, F, F + 1.3, -2.18, -1.4, STONE, { raw: true });                     // 화로
Wk.box(-3.95, -3.55, F + .25, F + .7, -1.38, -1.32, FIRE, { collide: false, kind: 'glow', raw: true });
Wk.add(new THREE.CylinderGeometry(.15, .15, 1.4, 6), STONE, M(-3.75, F + 2.0, -1.2));
Wk.box(2.5, 3.3, F, F + .8, 1.45, 2.18, C('#b9874f'), { raw: true }); Wk.box(3.4, 4.2, F, F + .6, 1.6, 2.18, C('#c8955a'), { raw: true }); Wk.box(2.7, 3.2, F + .8, F + 1.3, 1.6, 2.1, C('#a8763f'), { raw: true });
Wk.box(-.15, .15, F + 2.15, F + 2.45, -.15, .15, GLOWC, { collide: false, kind: 'glow' });
Wk.box(-.02, .02, F + 2.45, F + 2.52, -.02, .02, DARK, { collide: false });
Wk.box(-.9, .9, F, F + .035, -.5, .5, C('#3f7cac'), { collide: false });   // 러그
export const workCar = finishCar(Wk, -4.5, 4.5, bogie(-4.5, 4.5), '작업실');

/* 3) 정원 평판차 + 옥상 계단 */
const Gd = new CarB();
Gd.base(-4, 4, ['front', 'rear']);
Gd.railing(-4, 4, 1.62, 1.7, [[-.8, .8]]); Gd.railing(-4, 4, -1.7, -1.62, [[-.8, .8]]);
// 계단: 시각은 디딤판(위 7cm)+챌판으로 얇게, 충돌은 통짜 블록 → 블록끼리 맞닿는 면이 화면에 안 생김
for (let k = 0; k < 7; k++) {
  const x1 = -.4 - .5 * k, top = F + .4 * (k + 1), col = k % 2 ? WOOD : C('#a8774a');
  Gd.box(x1 - .5, x1, F, top, -1.55, -.35, col, { visual: false });
  Gd.box(x1 - .52, x1 + .02, top - .07, top, -1.56, -.34, col, { collide: false });             // 디딤판 (앞으로 2cm 돌출)
  Gd.box(x1 - .02, x1, top - .4, top - .07, -1.54, -.36, C('#7a5233'), { collide: false });       // 챌판
  for (const [z0, z1] of [[-1.56, -1.54], [-.38, -.36]]) Gd.box(x1 - .5, x1, F, top - .07, z0, z1, C('#6a4632'), { collide: false });   // 옆판
}
Gd.box(-4.15, -.4, F, F + .03, -1.54, -.36, C('#7a5233'), { collide: false });                    // 계단 바닥판
Gd.box(-4.12, -4.08, F, F + 2.75, -1.54, -.36, C('#7a5233'), { collide: false });                  // 계단 뒷판
Gd.box(-4.65, -3.4, F + 2.62, F + 2.81, -1.55, -.35, DARK);                                        // 지붕으로 건너가는 발판 (객실 지붕보다 1cm 높게)
Gd.box(-3.9, -3.85, F + 2.81, F + 3.7, -1.62, -1.57, DARK, { collide: false }); Gd.box(-3.9, -.4, F + 3.2, F + 3.25, -1.62, -1.57, DARK, { collide: false });
for (const x of [-.45, -2.15]) Gd.box(x - .025, x + .025, F + .4 + (x === -.45 ? 0 : 1.6), F + 3.2, -1.62, -1.57, DARK, { collide: false });
Gd.box(.9, 3.4, F, F + .5, .35, 1.45, C('#6a4632'));
for (let i = 0; i < 9; i++) { const x = 1.1 + (i % 5) * .5, z = .6 + Math.floor(i / 5) * .5; Gd.add(new THREE.ConeGeometry(.18, .45 + (i % 3) * .15, 5), C(i % 4 === 0 ? '#e86a8c' : '#6cc04a'), M(x, F + .72, z)); }
Gd.box(-1.6, -1, F, F + .6, .7, 1.4, C('#b9874f')); Gd.box(-2.6, -1.8, F, F + .4, .9, 1.5, C('#a8763f'));
Gd.box(3.55, 3.65, F, F + 2.4, -1.35, -1.25, DARK);
Gd.box(3.45, 3.75, F + 2.3, F + 2.6, -1.45, -1.15, GLOWC, { collide: false, kind: 'glow' });
export const gardenCar = finishCar(Gd, -4, 4, bogie(-4, 4), '정원칸');

/* 4) 객실 + 뒷발코니 + 옥상 전망대 */
const Co = new CarB();
Co.base(-4.5, 4.5, ['front']);
Co.sideWall(1.64, -3.5, 4.5, [], TEAL); Co.sideWall(-1.64, -3.5, 4.5, [], TEAL);
Co.endWall(4.5, TEAL); Co.endWall(-3.5, TEAL);
Co.box(-3.6, 4.6, F + 2.6, F + 2.8, -1.85, 1.85, DARK);
Co.box(-3.4, 4.4, F + 2.5, F + 2.57, -1.54, 1.54, CEIL, { collide: false });
for (const s of [1, -1]) {
  Co.box(-3.6, 4.6, F + 2.8, F + 2.8 + RAIL_H, s > 0 ? 1.75 : -1.85, s > 0 ? 1.85 : -1.75, DARK, { visual: false });
  Co.box(-3.6, 4.6, F + 3.5, F + 3.6, s > 0 ? 1.75 : -1.85, s > 0 ? 1.85 : -1.75, DARK, { collide: false });
  for (let x = -3.5; x <= 4.6; x += 1.35) Co.box(x - .04, x + .04, F + 2.8, F + 3.6, s > 0 ? 1.76 : -1.84, s > 0 ? 1.84 : -1.76, DARK, { collide: false });
}
Co.box(-3.7, -3.6, F + 2.8, F + 2.8 + RAIL_H, -1.85, 1.85, DARK, { visual: false }); Co.box(-3.7, -3.6, F + 3.5, F + 3.6, -1.85, 1.85, DARK, { collide: false });
Co.box(-1, 1, F + 2.8, F + 3.25, .7, 1.25, WOOD);
Co.railing(-4.5, -4.42, -1.7, 1.7); Co.railing(-4.5, -3.5, 1.62, 1.7); Co.railing(-4.5, -3.5, -1.7, -1.62);
Co.box(-3.3, -.6, F, F + .55, -1.58, -.75, C('#e9dcc4'));
Co.box(-3.3, -2.8, F + .55, F + .7, -1.5, -.85, C('#ffffff'), { collide: false });
Co.box(-2.7, -.7, F + .55, F + .62, -1.58, -.75, C('#c94f6d'), { collide: false });
Co.box(-3.3, -.6, F + 1.5, F + 1.7, -1.58, -.75, WOOD);
Co.box(-2.7, -.7, F + 1.7, F + 1.77, -1.58, -.75, C('#5fa8d3'), { collide: false });
Co.box(1.6, 2.6, F, F + .75, .6, 1.58, WOOD); Co.box(2.8, 3.4, F, F + .45, .7, 1.58, C('#7a5233')); Co.box(.8, 1.4, F, F + .45, .7, 1.58, C('#7a5233'));
Co.box(-2.5, 3, F, F + .035, -.6, .6, C('#a34d5c'), { collide: false });
Co.box(-.15, .15, F + 2.15, F + 2.45, -.15, .15, GLOWC, { collide: false, kind: 'glow' });
Co.box(2.0, 2.2, F + .75, F + .95, 1.7, 1.9, GLOWC, { collide: false, kind: 'glow', raw: true });
export const coachCar = finishCar(Co, -4.5, 4.5, bogie(-4.5, 4.5), '객실');

locoCar.off = 0; workCar.off = 9.72; gardenCar.off = 9.72 + 4.5 + .72 + 4; coachCar.off = gardenCar.off + 4 + .72 + 4.5;

/* 조명 */
export const headLight = new THREE.SpotLight(0xffe2a8, 0, 90, .45, .6, 1.2);
headLight.position.set(4.3, F + 2.35, 0); locoCar.g.add(headLight, headLight.target); headLight.target.position.set(25, 0, 0);
export const lamps = [[locoCar, -.4, F + .6, 0, 0xff8a3c], [workCar, 0, F + 2.0, 0, 0xffc870], [gardenCar, 3.6, F + 2.3, -1.3 - WIDEN, 0xffc870], [coachCar, 0, F + 2.0, 0, 0xffc870]]
  .map(([car, x, y, z, c]) => { const l = new THREE.PointLight(c, 0, 10, 2); l.position.set(x, y, z); car.g.add(l); return l; });

/* 객차 사이 주름막 (시각 전용) */
const bellowsGeo = merged([0, 1, 2, 3, 4].flatMap(i => {
  const col = i % 2 ? C('#1f1d24') : DARK, x = -.35 + i * .175, inset = (i % 2) * .06;
  return [prep(new THREE.BoxGeometry(.18, 2.3, .06), col, M(x, 0, .75 - inset)), prep(new THREE.BoxGeometry(.18, 2.3, .06), col, M(x, 0, -.75 + inset)), prep(new THREE.BoxGeometry(.18, .06, 1.56), col, M(x, 1.15 - inset, 0))];
}));
const bellows = [[locoCar, workCar], [workCar, gardenCar], [gardenCar, coachCar]].map(([a, b]) => {
  const m = new THREE.Mesh(bellowsGeo, landMat); scene.add(m); return { a, b, m, enclosed: b !== gardenCar && a !== gardenCar };
});
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
function placeBellows() {
  for (const B of bellows) {
    B.a.g.localToWorld(_pa.set(B.a.x0, F + 1.15, 0)); B.b.g.localToWorld(_pb.set(B.b.x1, F + 1.15, 0));
    B.m.position.addVectors(_pa, _pb).multiplyScalar(.5);
    B.m.quaternion.copy(B.a.g.quaternion).slerp(B.b.g.quaternion, .5);
    B.m.scale.set(Math.max(.2, _pa.distanceTo(_pb) / .7), 1, 1);
    B.m.visible = B.enclosed;
  }
}

/* 위치 갱신 */
export function placeTrain() {
  for (const c of CARS) {
    const s = S.sTrain - c.off; frameAt(s, c.frame);
    trackPos(s, c.g.position).addScaledVector(c.frame.U, .3);
    c.g.quaternion.setFromRotationMatrix(c.frame.m);
    for (const w of c.wheels) w.rotation.z = -S.sTrain / .5;
    c.g.updateMatrixWorld(true);
    c.inv.copy(c.g.matrixWorld).invert();
  }
  lever.rotation.z = -.9 + 1.5 * (S.targetSpeed / 40);
  placeBellows();
}

/* ---------- 기차 통합 좌표 (멀티플레이) ----------
 * 차량마다 로컬 좌표가 따로라 차량을 넘나들면 값이 불연속이 된다.
 * 'x - off' 로 모든 차량을 기관차 기준 하나의 직선 좌표로 펴서 주고받으면
 * 차량 경계를 지날 때도 보간이 끊기지 않는다.                              */
export const toTrainCoord = (car, p, out) => out.set(p.x - car.off, p.y, p.z);
export function carForTrainX(x) {
  let best = CARS[0], bd = 1e9;
  for (const c of CARS) { const lx = x + c.off, d = lx < c.x0 ? c.x0 - lx : lx > c.x1 ? lx - c.x1 : 0; if (d < bd) { bd = d; best = c; } }
  return best;
}
export function trainToWorld(tp, out) { const c = carForTrainX(tp.x); out.set(tp.x + c.off, tp.y, tp.z).applyMatrix4(c.g.matrixWorld); return c; }
