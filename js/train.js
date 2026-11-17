// 걸어다닐 수 있는 3량 열차: 시각 메시 + 차량 로컬 충돌 박스
import * as THREE from 'three';
import { clamp } from './noise.js';
import { C, prep, M, merged, landMat, glowMat, glassMat } from './geo.js';
import { trackPos, frameAt, makeFrame } from './track.js';
import { scene } from './scene.js';
import { F } from './config.js';
import { S } from './state.js';

// 시작 기차 팔레트: 차콜 · 철 · 구리 (CarB 기본 부품이 쓰는 이름은 같은 톤으로 재정의)
const CHAR = C('#2b2b2f'), CHAR2 = C('#38383d'), IRON = C('#6b7078'), IRON_D = C('#4b4f56'), COPPER = C('#a28c4c'), COPPER_D = C('#665d3d'),
  GLOWC = C('#dbe6f2'), FIRE = C('#ff7a2e');
const DARK = CHAR, GOLD = COPPER, WOOD = C('#5a4a3e'), FLOOR = C('#343e40'), CREAM = C('#515d5d'), CEIL = C('#414e50');
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
  let glowMesh = null; if (B.glow.length) { glowMesh = new THREE.Mesh(merged(B.glow), glowMat); g.add(glowMesh); }
  if (B.glass.length) g.add(new THREE.Mesh(merged(B.glass), glassMat));
  const wheels = [], wg = new THREE.CylinderGeometry(.5, .5, .22, 16).rotateX(Math.PI / 2);
  for (const x of wheelXs) for (const z of [-.86, .86]) {
    const w = new THREE.Mesh(prep(wg.clone(), DARK), landMat); w.position.set(x, .5, z); w.castShadow = true; g.add(w); wheels.push(w);
    w.add(new THREE.Mesh(prep(new THREE.BoxGeometry(.75, .12, .24), IRON_D), landMat));
  }
  scene.add(g);
  const car = { g, x0, x1, boxes: B.boxes, name, off: 0, wheels, glowMesh, frame: makeFrame(), inv: new THREE.Matrix4() };
  CARS.push(car); return car;
}
const bogie = (x0, x1) => [x0 + 1.1, x0 + 2.2, x1 - 2.2, x1 - 1.1];

/* ================= 열차 3량 (역할 고정, 정비 구역에서 업그레이드) =================
 *   운전차   : 앞유리가 있는 운전실. 조작대의 레버 3개(주행 단수 · 브레이크 · 전후진)와 전력 계기
 *   객실     : 유일하게 안전한 실내. 사다리로 지붕에 올라가면 포탑
 *   동력차   : 맨 뒤의 열린 작업차. 배터리 랙 · 발전기 · 작업대 · 비상 크랭크
 * 가장 중요한 배터리가 맨 뒤에 있어, 누군가는 열차 끝까지 오가야 한다.
 */
const RED = C('#b5432f'), SIGN = C('#7fa89a');
const mesh = (geo, col, m) => new THREE.Mesh(prep(geo, col, m), landMat);

/* 1) 운전차 */
const D = new CarB();
D.base(-3.5, 3.5, ['rear']);
D.box(2.26, 3.5, F, F + .9, -1.5, 1.5, CHAR2);                                         // 낮은 앞코 (앞 시야를 가리지 않음)
D.box(2.3, 3.46, F + .9, F + .96, -1.54, 1.54, IRON_D, { collide: false });
for (let x = 2.5; x < 3.3; x += .22) for (const sd of [-1, 1]) D.box(x, x + .08, F + .25, F + .7, sd > 0 ? 1.505 : -1.56, sd > 0 ? 1.56 : -1.505, CHAR, { collide: false });
D.box(3.5, 3.95, .6, 1.0, -1.5, 1.5, CHAR); D.box(3.8, 4.0, .72, .88, -1.3, 1.3, COPPER_D, { collide: false });
for (const z of [-1.1, 1.1]) D.box(3.5, 3.56, F + .45, F + .75, z - .22, z + .22, GLOWC, { collide: false, kind: 'glow' });
D.sideWall(1.64, -3.5, 2.2, [], IRON); D.sideWall(-1.64, -3.5, 2.2, [], IRON);
D.endWall(-3.5, IRON);
D.box(2.14, 2.26, F, F + 1.0, -1.7, 1.7, IRON); D.box(2.14, 2.26, F + 1.95, F + 2.6, -1.7, 1.7, IRON);   // 앞벽: 아래·위만 막고 가운데는 유리
D.box(2.14, 2.26, F + 1.0, F + 1.95, -1.7, 1.7, IRON, { visual: false });
for (const z of [-1.62, -.55, .55, 1.62]) D.box(2.13, 2.27, F + 1.0, F + 1.95, z - .05, z + .05, IRON, { collide: false });
D.box(2.19, 2.21, F + 1.0, F + 1.95, -1.6, 1.6, GLOWC, { collide: false, kind: 'glass' });
D.roof(-3.5, 2.2, IRON_D);
// 조작대
D.box(1.5, 2.14, F, F + .95, -1.35, 1.35, CHAR2);
D.box(1.44, 2.14, F + .95, F + 1.02, -1.4, 1.4, IRON_D, { collide: false });
D.box(1.47, 1.5, F + .5, F + .86, -1.2, -.25, CHAR, { collide: false });                // 계기판
D.box(-3.3, -2.5, F, F + .5, 1.0, 1.58, IRON_D);                                         // 공구 상자
D.box(-.15, .15, F + 2.2, F + 2.45, -.15, .15, GLOWC, { collide: false, kind: 'glow' });
export const driveCar = finishCar(D, -3.5, 3.5, [-2.5, -1.4, 1.4, 2.5], '운전차');
driveCar.enclosed = true;
export const locoCar = driveCar;
/* 레버 3개 (조작대 위). 각도는 placeTrain 에서 상태에 맞춰 갱신 */
function makeLever(z, cap) {
  const g = new THREE.Group(); g.position.set(1.72, F + 1.0, z);
  g.add(mesh(new THREE.BoxGeometry(.06, .5, .06), IRON, M(0, .25, 0))); g.add(mesh(new THREE.IcosahedronGeometry(.085, 0), cap, M(0, .53, 0)));
  driveCar.g.add(g); driveCar.g.add(mesh(new THREE.BoxGeometry(.3, .08, .16), CHAR, M(1.72, F + 1.03, z)));
  return g;
}
export const LEVERS = { notch: makeLever(zmap(-.75) + .55, COPPER), brake: makeLever(0, RED), dir: makeLever(zmap(.75) - .55, CREAM) };
export const LEVER_AT = { notch: new THREE.Vector3(1.72, F + 1.25, LEVERS.notch.position.z), brake: new THREE.Vector3(1.72, F + 1.25, 0), dir: new THREE.Vector3(1.72, F + 1.25, LEVERS.dir.position.z) };
export const LEVER_POS = LEVER_AT.notch;
/* 전력 계기: 조작대 계기판의 10칸 (동력차 랙에도 같은 표시) */
const segMatOn = new THREE.MeshBasicMaterial({ color: 0x9fe0c8 }), segMatLow = new THREE.MeshBasicMaterial({ color: 0xe0563a }), segMatOff = new THREE.MeshBasicMaterial({ color: 0x1c2224 });
export const batterySegs = [];
for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(.012, .26, .07), segMatOff); m.position.set(1.462, F + .68, -1.72 + i * .092); driveCar.g.add(m); batterySegs.push(m); }

/* 2) 객실 + 지붕 포탑 */
const K = new CarB();
K.base(-3.5, 3.5, ['front', 'rear']);
K.sideWall(1.64, -3.5, 3.5, [], IRON); K.sideWall(-1.64, -3.5, 3.5, [], IRON);
K.endWall(3.5, IRON); K.endWall(-3.5, IRON);
K.roof(-3.5, 3.5, IRON_D);
for (const sd of [-1, 1]) {                                                               // 긴 의자
  K.box(-2.9, .9, F, F + .48, sd > 0 ? 1.0 : -1.58, sd > 0 ? 1.58 : -1.0, CHAR2);
  K.box(-2.9, .9, F + .48, F + .54, sd > 0 ? .96 : -1.6, sd > 0 ? 1.6 : -.96, WOOD, { collide: false });
}
K.box(-.15, .15, F + 2.2, F + 2.45, -.15, .15, GLOWC, { collide: false, kind: 'glow' });
K.box(-3.38, -3.3, F + .9, F + 1.9, .85, 1.5, CHAR, { collide: false });                  // 개인 화기 거치대
for (const z of [.95, 1.2, 1.42]) K.box(-3.3, -3.24, F + 1.0, F + 1.75, z, z + .06, IRON_D, { collide: false });
// 사다리 (지붕 해치로)
for (const z of [-1.52, -1.02]) K.box(2.72, 2.78, F, F + 2.5, z, z + .05, IRON_D, { collide: false });
for (let y = .3; y < 2.5; y += .32) K.box(2.72, 2.78, F + y, F + y + .04, -1.5, -1.0, IRON_D, { collide: false });
// 지붕: 낮은 난간과 해치 틀, 포탑 받침
const RY = F + 2.92;
for (const sd of [-1, 1]) {
  K.box(-3.5, 3.5, F + 2.8, RY + 1.2, sd > 0 ? 1.74 : -1.85, sd > 0 ? 1.85 : -1.74, DARK, { visual: false });
  K.box(-3.5, 3.5, RY + .58, RY + .64, sd > 0 ? 1.76 : -1.82, sd > 0 ? 1.82 : -1.76, DARK, { collide: false });
  for (let x = -3.4; x <= 3.4; x += 1.36) K.box(x - .035, x + .035, F + 2.8, RY + .6, sd > 0 ? 1.76 : -1.82, sd > 0 ? 1.82 : -1.76, DARK, { collide: false });
}
K.box(2.3, 3.2, RY, RY + .07, -1.6, -.9, COPPER_D, { collide: false });                    // 해치 틀
K.box(2.4, 3.1, RY + .07, RY + .09, -1.5, -1.0, CHAR, { collide: false });
K.box(-1.0, -.2, F + 2.8, RY + .55, -.4, .4, CHAR2);                                       // 포탑 받침
export const cabinCar = finishCar(K, -3.5, 3.5, [-2.5, -1.4, 1.4, 2.5], '객실');
cabinCar.enclosed = true; cabinCar.roofY = RY;
export const ROOF_Y = RY, LADDER_AT = new THREE.Vector3(2.75, F + 1.3, zmap(-1.27)), HATCH_AT = new THREE.Vector3(2.75, RY + .1, zmap(-1.27));
/* 포탑: 받침 위에서 좌우로 도는 몸체 + 위아래로 움직이는 포신 */
export const turret = { yaw: new THREE.Group(), pitch: new THREE.Group(), muzzle: new THREE.Vector3(1.25, .12, 0), seat: new THREE.Vector3(-1.55, RY, 0), at: new THREE.Vector3(-.6, RY + .8, 0) };
turret.yaw.position.set(-.6, RY + .55, 0); cabinCar.g.add(turret.yaw);
turret.yaw.add(mesh(new THREE.CylinderGeometry(.42, .5, .22, 10), IRON_D, M(0, .11, 0)));
turret.yaw.add(mesh(new THREE.BoxGeometry(.5, .5, .1), CHAR, M(-.05, .5, .34))); turret.yaw.add(mesh(new THREE.BoxGeometry(.5, .5, .1), CHAR, M(-.05, .5, -.34)));
turret.pitch.position.set(0, .55, 0); turret.yaw.add(turret.pitch);
turret.pitch.add(mesh(new THREE.BoxGeometry(.75, .3, .46), IRON, M(.05, .08, 0)));
turret.pitch.add(mesh(new THREE.CylinderGeometry(.055, .055, 1.0, 8), CHAR, M(.75, .12, 0, 0, 0, Math.PI / 2)));
turret.pitch.add(mesh(new THREE.BoxGeometry(.5, .16, .16), IRON_D, M(.5, .12, 0)));
turret.pitch.add(mesh(new THREE.BoxGeometry(.1, .3, .7), CHAR2, M(-.38, .2, 0)));           // 방패판
export const turretHeatMat = new THREE.MeshBasicMaterial({ color: 0x1c2224 });
{ const h = new THREE.Mesh(new THREE.BoxGeometry(.34, .05, .1), turretHeatMat); h.position.set(.05, .26, 0); turret.pitch.add(h); }

/* 3) 동력차 (열린 작업차) */
const W = new CarB();
W.base(-3.5, 3.5, ['front']);
for (const s of [1, -1]) {
  const z0 = s > 0 ? 1.58 : -1.7, z1 = s > 0 ? 1.7 : -1.58;
  W.box(-3.5, 3.5, F, F + .9, z0, z1, CHAR2); W.box(-3.5, 3.5, F + .9, F + .97, z0 - .03, z1 + .03, COPPER_D, { collide: false });
  W.box(-3.5, 3.5, F + .9, F + RAIL_H, z0, z1, CHAR2, { visual: false });
}
W.box(3.42, 3.5, F, F + .9, -1.7, -.75, CHAR2); W.box(3.42, 3.5, F, F + .9, .75, 1.7, CHAR2);         // 앞 (객실 쪽 통로)
W.railing(-3.5, -3.42, -1.7, 1.7);
const raw = { raw: true };
// 배터리 랙: 왼쪽 벽을 따라 3단
for (const x of [-.9, .2, 1.3]) {
  W.box(x - .45, x + .45, F, F + 1.15, -2.16, -1.25, IRON_D, raw);
  W.box(x - .47, x + .47, F + 1.15, F + 1.2, -2.18, -1.23, COPPER_D, { raw: true, collide: false });
  W.box(x - .3, x + .3, F + .2, F + 1.0, -1.25, -1.235, CHAR, { raw: true, collide: false });
}
// 발전기
W.box(-3.1, -1.75, F, F + 1.05, -2.16, -1.1, CHAR2, raw);
for (let x = -3.0; x < -1.85; x += .2) W.box(x, x + .08, F + .3, F + .85, -1.1, -1.07, CHAR, { raw: true, collide: false });
W.box(-2.6, -2.3, F + 1.05, F + 1.45, -1.8, -1.5, IRON_D, { raw: true, collide: false });
W.box(-1.9, -1.84, F + .9, F + .96, -1.1, -1.08, SIGN, { raw: true, collide: false, kind: 'glow' });
// 작업대와 보관함
W.box(.3, 2.4, F, F + .9, 1.45, 2.16, IRON_D, raw); W.box(.26, 2.44, F + .9, F + .96, 1.4, 2.2, WOOD, { raw: true, collide: false });
W.box(1.9, 2.25, F + .96, F + 1.18, 1.6, 1.95, CHAR, { raw: true, collide: false });
W.box(-2.6, -1.3, F, F + .6, 1.5, 2.16, CHAR2, raw); W.box(-2.62, -1.28, F + .6, F + .65, 1.48, 2.18, COPPER_D, { raw: true, collide: false });
W.box(2.95, 3.05, F, F + 2.3, 1.95, 2.05, CHAR, raw);                                                  // 등 기둥
W.box(2.7, 3.25, F + 2.25, F + 2.4, 1.75, 2.2, CHAR, { raw: true, collide: false }); W.box(2.76, 3.2, F + 2.22, F + 2.25, 1.8, 2.15, GLOWC, { raw: true, collide: false, kind: 'glow' });
// 비상 크랭크 받침 (뒤 끝)
W.box(-3.38, -3.1, F, F + 1.0, .5, .8, CHAR2);
export const powerCar = finishCar(W, -3.5, 3.5, [-2.5, -1.4, 1.4, 2.5], '동력차');
powerCar.enclosed = false;
export const tenderCar = powerCar;
export const RACK_AT = new THREE.Vector3(.2, F + .8, -1.3), CRANK_AT = new THREE.Vector3(-3.0, F + 1.15, .65), BENCH_AT = new THREE.Vector3(1.3, F + 1.0, 1.5);
export const crank = new THREE.Group(); crank.position.set(-3.05, F + 1.12, .65); powerCar.g.add(crank);
crank.add(mesh(new THREE.CylinderGeometry(.3, .3, .06, 12), IRON, M(0, 0, 0, 0, 0, Math.PI / 2))); crank.add(mesh(new THREE.BoxGeometry(.12, .07, .07), COPPER, M(.1, .24, 0)));
export const rackSegs = [];
for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(.2, .5, .012), segMatOff); m.position.set(-1.15 + i * .3, F + .6, -1.225); powerCar.g.add(m); rackSegs.push(m); }
export function showBattery(pct, powered) {
  const n = Math.ceil(pct / 10 - 1e-6);
  for (let i = 0; i < 10; i++) { const mat = i < n ? (pct <= 20 ? segMatLow : segMatOn) : segMatOff; batterySegs[i].material = mat; rackSegs[i].material = mat; }
}

driveCar.off = 0; cabinCar.off = 3.5 + .72 + 3.5; powerCar.off = cabinCar.off + 3.5 + .72 + 3.5;
export const spawnCar = cabinCar;           // 시작·복귀 지점: 객실
export const SPAWN_X = 0;

/* 조명 */
export const headLight = new THREE.SpotLight(0xdbe8f5, 420, 150, .5, .7, 1.3);
headLight.position.set(3.6, F + .7, 0); driveCar.g.add(headLight, headLight.target); headLight.target.position.set(25, 0, 0);
export const lamps = [[driveCar, 0, F + 2.0, 0, 0xc9dcf0], [cabinCar, 0, F + 2.0, 0, 0xc9dcf0], [powerCar, 2.9, F + 2.1, 1.9, 0xc9dcf0]]
  .map(([car, x, y, z, c]) => { const l = new THREE.PointLight(c, 5, 11, 2); l.position.set(x, y, z); car.g.add(l); return l; });
export const CHIMNEY = new THREE.Vector3(-2.45, F + 1.6, -1.65);          // 발전기 배기구

/* 객차 사이 주름막: 양쪽이 모두 막힌 차량일 때만 (시작 기차엔 없음) */
const bellows = [];
function placeBellows() {}

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
  LEVERS.notch.rotation.z = .7 - .35 * (S.notch || 0); LEVERS.brake.rotation.z = S.brake ? -.7 : .7; LEVERS.dir.rotation.z = (S.dir || 1) > 0 ? -.6 : .6;
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
