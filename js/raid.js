// 습격 이벤트: 공허 진드기 떼가 기차를 덮친다.
//
//  - 기차가 달리는 동안 몇 분마다 경보 → 떼가 몇 번에 나눠 날아온다.
//  - 진드기는 열린 칸(기관실·연료차)이나 바깥에 있는 사람을 물고, 아니면 기차에 달라붙어 증기관을 갉는다(압력 감소).
//  - 권총(1), 렌치(2), 삽(1)으로 잡는다. 잡으면 고철 조각이 떨어져 몸으로 빨려 들어온다.
//  - 좌표는 기관차 기준 로컬로 관리 → 기차가 아무리 빨라도 떼가 따라붙는다.
import * as THREE from 'three';
import { C, prep, M, merged, landMat, glowMat } from './geo.js';
import { scene, camera } from './scene.js';
import { CARS, locoCar, tenderCar, cabinCar, HALF_W } from './train.js';
import { player, playerWorld, reelIn } from './player.js';
import { boiler } from './boiler.js';
import { sparkAt } from './fx.js';
import { F, RAID } from './config.js';
import { S } from './state.js';
import * as A from './audio.js';
import { feel } from './feel.js';

let H = {};   // { toast, banner, fade, flashInv, isClient(), sendEv(d, to?), selfId(), peers() → [{id, p(기관차 로컬), exp}] }
/* 멀티플레이: 기관사(호스트)만 진드기 AI·추적자를 돌리고, 나머지는 상태를 받아 그대로 보여 준다.
 * 다른 승객의 공격은 호스트에게 보내 판정. 처치·물기·들이받기는 이벤트로 알린다. */
const ME = 'me';
const netId = id => id === ME ? (H.selfId?.() ?? ME) : id;     // 보낼 때
const localId = id => id === (H.selfId?.() ?? ME) ? ME : id;    // 받을 때
const client = () => !!H.isClient?.();
export function initRaid(hooks) { H = hooks; }

/* ---------- 모델 ---------- */
const BODY = C('#3b2a52'), BODY2 = C('#56407a'), BELLY = C('#8a6fb0'), WING = C('#22182f');
const bodyGeo = merged([
  prep(new THREE.IcosahedronGeometry(.42, 0), BODY, M(0, 0, 0, 0, 0, 0, 1, .82, 1.15)),
  prep(new THREE.IcosahedronGeometry(.26, 0), BODY2, M(0, .1, .42)),                          // 머리
  prep(new THREE.IcosahedronGeometry(.3, 0), BELLY, M(0, -.18, -.08, 0, 0, 0, 1, .6, 1)),
  prep(new THREE.ConeGeometry(.05, .26, 4), C('#d8cfe6'), M(-.1, -.02, .66, Math.PI / 2 + .3, 0, 0)),   // 턱
  prep(new THREE.ConeGeometry(.05, .26, 4), C('#d8cfe6'), M(.1, -.02, .66, Math.PI / 2 + .3, 0, 0)),
  prep(new THREE.ConeGeometry(.1, .3, 4), BODY2, M(0, .32, -.2, -.5, 0, 0)),                     // 등가시
]);
const eyeGeo = prep(new THREE.IcosahedronGeometry(.07, 0), C('#7ffcff'));
const wingGeo = merged([prep(new THREE.BoxGeometry(.9, .03, .45), WING, M(.48, 0, 0)), prep(new THREE.BoxGeometry(.5, .035, .2), BODY2, M(.3, .02, .14))]);
const debrisGeo = prep(new THREE.TetrahedronGeometry(.13, 0), BODY2);
const shardGeo = merged([prep(new THREE.BoxGeometry(.22, .06, .14), C('#a8b0b8'), M(0, 0, 0, .3, .5, .2)), prep(new THREE.BoxGeometry(.12, .05, .1), C('#d9e2ea'), M(.06, .05, .02, -.2, .3, .4))]);

class Mite {
  constructor() {
    this.mat = landMat.clone(); this.mat.emissive = new THREE.Color(0xffffff); this.mat.emissiveIntensity = 0;
    this.g = new THREE.Group();
    this.body = new THREE.Mesh(bodyGeo, this.mat); this.body.castShadow = true; this.g.add(this.body);
    for (const x of [-.12, .12]) { const e = new THREE.Mesh(eyeGeo, glowMat); e.position.set(x, .16, .62); this.body.add(e); }
    this.wl = new THREE.Mesh(wingGeo, this.mat); this.wl.position.set(.25, .2, 0); this.body.add(this.wl);
    this.wr = new THREE.Mesh(wingGeo, this.mat); this.wr.position.set(-.25, .2, 0); this.wr.scale.x = -1; this.body.add(this.wr);
    this.g.visible = false; scene.add(this.g);
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3(); this.alive = false;
  }
  spawn(p) {
    Object.assign(this, { alive: true, hp: RAID.hp, state: 'approach', t: 0, cool: 1 + Math.random(), flash: 0, squash: 0, latch: null, phase: Math.random() * 6, chewT: 0, mode: Math.random() < .5 ? 'player' : 'train' });
    this.p.copy(p); this.v.set(0, 0, 0); this.g.visible = true; this.g.scale.setScalar(.01);
    this.mat.emissiveIntensity = 0;
  }
}
const pool = Array.from({ length: 14 }, () => new Mite());

/* 달라붙는 자리 (차량 로컬) */
const LATCH = [
  [locoCar, 1.6, F + 2.0, .35], [locoCar, .3, F + 1.95, -.4], [locoCar, 2.9, F + 1.9, .5], [locoCar, -2.2, F + 2.8, -1.2],
  [tenderCar, -1.8, F + .95, -2.25], [tenderCar, 1.6, F + .95, 2.3],
  [cabinCar, -2, F + 2.95, .9], [cabinCar, 1.8, F + 2.95, -.9], [cabinCar, 0, F + 1.6, HALF_W + .25],
].map(([car, x, y, z]) => ({ car, pos: new THREE.Vector3(x, y, z), taken: null }));

/* ---------- 상태 ---------- */
export const raid = { active: false, next: RAID.firstDelay, wave: 0, toSpawn: 0, spawnT: 0, count: 0, kills: 0 };
export const aliveCount = () => pool.filter(m => m.alive).length;

export function startRaid() {
  if (raid.active) return;
  raid.active = true; raid.wave++; raid.kills = 0;
  raid.toSpawn = Math.min(RAID.maxSize, RAID.baseSize + raid.wave - 1); raid.spawnT = 2.5;
  H.banner?.('⚠ 공허 떼 습격'); H.toast?.('공허 진드기 떼가 다가와요! 권총(3)과 렌치(1)로 막아 내세요'); A.raidHorn();
  feel.shake(.15);
}
function endRaid() {
  raid.active = false; raid.next = RAID.intervalMin + Math.random() * (RAID.intervalMax - RAID.intervalMin);
  H.toast?.(`습격을 막아 냈어요! (진드기 ${raid.kills}마리)`); A.raidClear();
  for (const l of LATCH) l.taken = null;
}

/* ---------- 좌표 도우미 ---------- */
const _w = new THREE.Vector3(), _l = new THREE.Vector3(), _d = new THREE.Vector3(), _pl = new THREE.Vector3(), _q = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
const _plL = new THREE.Vector3(), _tgt = new THREE.Vector3();
const toWorld = (local, out) => out.copy(local).applyMatrix4(locoCar.g.matrixWorld);
const toLocal = (world, out) => out.copy(world).applyMatrix4(locoCar.inv);
/** 플레이어가 공격받을 수 있는가: 바깥(무중력) 또는 지붕이 없는 칸 */
export const exposed = () => !player.inGrav || !player.car.enclosed || (player.car.roofX0 !== undefined && player.p.x < player.car.roofX0);

/** 공격받을 수 있는 승객들 (기관차 로컬 좌표) */
let targets = [];
function gatherTargets() {
  playerWorld(_pl, .9); toLocal(_pl, _plL);
  targets = [{ id: ME, p: _plL, exp: exposed() }, ...(H.peers?.() || [])];
}
function nearest(p, onlyExposed, maxD = 45) {
  let best = null, bd = maxD;
  for (const T of targets) { if (onlyExposed && !T.exp) continue; const d = T.p.distanceTo(p); if (d < bd) { bd = d; best = T; } }
  return best;
}

/* ---------- 매 프레임 ---------- */
export function updateRaid(dt, canSpawn) {
  gatherTargets();
  if (client()) { for (const m of pool) if (m.alive) updateMite(m, dt, false); updateDebris(dt); updateShards(dt); return; }
  // 일정 (기차가 달리는 동안만 시간이 흐름)
  if (!raid.active && canSpawn && S.speed > 2 && S.started && !S.loading) { raid.next -= dt; if (raid.next <= 0) startRaid(); }
  if (raid.active && raid.toSpawn > 0) {
    raid.spawnT -= dt;
    if (raid.spawnT <= 0) {
      raid.spawnT = 1.6 + Math.random() * 2;
      const side = Math.random() < .5 ? -1 : 1, n = Math.min(raid.toSpawn, 1 + (Math.random() * 3 | 0));
      for (let i = 0; i < n; i++) {
        const m = pool.find(x => !x.alive); if (!m) break;
        m.spawn(_l.set(10 + Math.random() * 30, F + 2 + Math.random() * 12, side * (22 + Math.random() * 12)));
        raid.toSpawn--;
      }
      A.chitter(1);
    }
  }
  if (raid.active && raid.toSpawn <= 0 && aliveCount() === 0) endRaid();

  for (const m of pool) if (m.alive) updateMite(m, dt, true);
  updateDebris(dt); updateShards(dt);
}

function updateMite(m, dt, authority) {
  m.t += dt; m.cool -= dt; m.flash = Math.max(0, m.flash - dt * 6); m.squash = Math.max(0, m.squash - dt * 5);
  const grow = Math.min(1, m.t * 2);
  let speed = RAID.speed, lookAt = null;
  const T = nearest(m.p, true), pl = T ? T.p : targets[0].p;
  if (!authority) {
    // 받은 상태를 향해 부드럽게 (받은 뒤 지난 시간만큼 속도로 예측)
    const n = m.net; if (n) { const age = Math.min(.3, (performance.now() - n.at) / 1000); _tgt.copy(n.p).addScaledVector(n.v, age); m.p.lerp(_tgt, 1 - Math.exp(-dt * 12)); m.v.copy(n.v); }
    if (m.state !== 'latched') lookAt = m.v.lengthSq() > 4 && m.state !== 'approach' ? _tgt.copy(m.p).add(m.v) : pl;
    if (m.state === 'latched') { m.chewT -= dt; if (m.chewT <= 0) { m.chewT = .6 + Math.random() * .5; toWorld(m.p, _w); A.chew(); sparkAt(_w, 0xffd27a, 3, 1.5); } }
  } else if (m.state === 'latched') {
    const L = m.latch; L.car.g.updateMatrixWorld(); _w.copy(L.pos).applyMatrix4(L.car.g.matrixWorld); toLocal(_w, m.p); m.v.set(0, 0, 0);
    boiler.pressure = Math.max(0, boiler.pressure - RAID.drain * dt);
    m.chewT -= dt; if (m.chewT <= 0) { m.chewT = .6 + Math.random() * .5; A.chew(); sparkAt(_w, 0xffd27a, 3, 1.5); }
    // 플레이어가 가까이 오면 떨어져 나와 덤빈다
    if (T && m.p.distanceTo(pl) < 4 && m.cool <= 0) { detach(m); m.mode = 'player'; m.state = 'approach'; }
  } else {
    let target;
    if (m.mode === 'player' && T) {
      target = pl;
      const d = m.p.distanceTo(pl);
      if (m.state === 'retreat') { if (m.t > m.retreatUntil) m.state = 'approach'; target = _d.copy(m.p).sub(pl).setLength(8).add(m.p); }
      else if (d < 5 && m.cool <= 0) { m.state = 'dash'; speed = RAID.dash; }
      else if (m.state === 'approach' && m.cool > 0) {      // 쿨다운 중엔 주위를 맴돎
        const a = m.t * .9 + m.phase; target = _d.set(pl.x + Math.cos(a) * 4.5, pl.y + 1.5 + Math.sin(m.t * 1.7) * .8, pl.z + Math.sin(a) * 4.5);
      }
      if (m.state === 'dash') {
        speed = RAID.dash;
        if (d < 1.1) { bite(m, T); }
        if (m.t > 30) m.state = 'approach';
      }
      lookAt = pl;
    } else {
      // 기차에 달라붙기
      if (!m.latch) { const free = LATCH.filter(l => !l.taken); if (free.length) { m.latch = free[(Math.random() * free.length) | 0]; m.latch.taken = m; } else m.mode = 'player'; }
      if (m.latch) {
        m.latch.car.g.updateMatrixWorld(); _w.copy(m.latch.pos).applyMatrix4(m.latch.car.g.matrixWorld); target = toLocal(_w, _tgt);
        if (m.p.distanceTo(target) < .5) { m.state = 'latched'; A.chew(); }
      } else target = pl;
      lookAt = target;
    }
    // 흔들리며 날기
    const want = _w.subVectors(target, m.p); const dist = want.length();
    want.setLength(Math.min(speed, dist * 3));
    want.y += Math.sin(m.t * 3 + m.phase) * 1.2; want.z += Math.cos(m.t * 2.3 + m.phase) * .8;
    m.v.lerp(want, 1 - Math.exp(-dt * (m.state === 'dash' ? 6 : 2.5)));
    m.p.addScaledVector(m.v, dt);
  }
  // 그리기 (월드)
  toWorld(m.p, m.g.position);
  m.g.quaternion.copy(locoCar.g.quaternion);
  if (lookAt) { const dir = _d.subVectors(lookAt, m.p); if (dir.lengthSq() > .01) { _q.setFromUnitVectors(_Z, dir.normalize()); m.g.quaternion.multiply(_q); } }
  const flap = Math.sin(m.t * (m.state === 'latched' ? 9 : 26) + m.phase) * (m.state === 'latched' ? .25 : .7);
  m.wl.rotation.z = flap; m.wr.rotation.z = -flap;
  const sq = m.squash;
  m.g.scale.set(grow * (1 + sq * .35), grow * (1 - sq * .4), grow * (1 + sq * .35));
  m.mat.emissiveIntensity = m.flash;
}
function detach(m) { if (m.latch) { m.latch.taken = null; m.latch = null; } m.cool = 1.2; }

function bite(m, T) {
  m.state = 'retreat'; m.retreatUntil = m.t + 1.2 + Math.random(); m.cool = RAID.biteCool;
  m.v.multiplyScalar(-.6);
  if (T.id === ME) damagePlayer(RAID.bite, m.p);
  else H.sendEv?.({ k: 'dmg', n: RAID.bite, f: m.p.toArray() }, T.id);
}

/* ---------- 플레이어 체력 ---------- */
let sinceHurt = 99, dead = false;
export function damagePlayer(n, fromLocal) {
  if (dead) return;
  S.hp = Math.max(0, S.hp - n); sinceHurt = 0;
  A.hurt(); feel.hurt(); feel.shake(.22);
  // 맞은 방향으로 밀려남
  if (fromLocal) {
    toWorld(fromLocal, _w); playerWorld(_pl, .9); _d.subVectors(_pl, _w).normalize();
    _d.applyQuaternion(_q.copy(player.car.g.quaternion).invert());
    player.v.addScaledVector(_d, 5); player.v.y += 2.5;
  }
  if (S.hp <= 0) die();
}
function die() {
  dead = true; H.fade?.(true); A.hurt();
  setTimeout(() => {
    reelIn(); S.hp = RAID.hpMax; dead = false;
    const lw = Math.floor(S.inv.wood / 2), ls = Math.floor(S.inv.scrap / 2); S.inv.wood -= lw; S.inv.scrap -= ls;
    H.fade?.(false); H.toast?.('쓰러졌어요… 숙소칸 침대에서 깨어났어요' + (lw + ls ? ` (배낭 절반을 잃었어요)` : ''));
  }, 1400);
}
export function updateHealth(dt) {
  sinceHurt += dt;
  if (!dead && sinceHurt > RAID.regenDelay && S.hp < RAID.hpMax) S.hp = Math.min(RAID.hpMax, S.hp + RAID.regen * dt);
}

/* ---------- 공격 판정 (도구에서 호출) ---------- */
const _o = new THREE.Vector3();
/** 광선과 가장 먼저 닿는 진드기 (월드 좌표 광선) */
export function rayMite(origin, dir, maxDist) {
  let best = null, bestT = maxDist;
  for (const m of pool) {
    if (!m.alive) continue;
    _o.subVectors(m.g.position, origin); const t = _o.dot(dir); if (t < 0 || t > bestT) continue;
    const r = .6 * m.g.scale.x; if (_o.lengthSq() - t * t > r * r) continue;
    bestT = t; best = m;
  }
  return best ? { mite: best, dist: bestT, point: origin.clone().addScaledVector(dir, bestT) } : null;
}
/** 근접: 눈앞 부채꼴 안의 진드기 모두 */
export function meleeMites(origin, dir, range = 2.4) {
  return pool.filter(m => {
    if (!m.alive) return false; _o.subVectors(m.g.position, origin); const d = _o.length();
    return d < range + .4 && _o.dot(dir) / Math.max(d, .01) > .45;
  });
}
/** 진드기에게 피해. dirWorld: 넉백 방향 */
export function hitMite(m, dmg, dirWorld, point, by = ME) {
  if (client() && by === ME) {
    m.flash = 1; m.squash = 1; feel.floatNumber(point || m.g.position, dmg); A.hitThwack(); feel.hitMarker(false); feel.hitstop(.035);
    H.sendEv?.({ k: 'hitm', i: pool.indexOf(m), d: dmg, dir: dirWorld.toArray() });
    return false;
  }
  if (!m.alive) return false;
  m.hp -= dmg; m.flash = 1; m.squash = 1;
  // 넉백 (월드 → 기관차 로컬)
  _d.copy(dirWorld).applyQuaternion(_q.copy(locoCar.g.quaternion).invert());
  m.v.addScaledVector(_d, dmg * 6); m.t = Math.max(m.t, .5);
  if (m.state === 'latched') { detach(m); m.state = 'approach'; m.mode = 'player'; }
  else if (m.state === 'dash') { m.state = 'retreat'; m.retreatUntil = m.t + .8; }
  if (m.hp <= 0) {
    const n = 1 + (Math.random() < RAID.extraDrop ? 1 : 0);
    killFx(m, dirWorld, by, n);
    H.sendEv?.({ k: 'kill', i: pool.indexOf(m), by: netId(by), n, dir: dirWorld.toArray() });
    return true;
  }
  if (by === ME) { feel.floatNumber(point || m.g.position, dmg); A.hitThwack(); feel.hitMarker(false); feel.hitstop(.035); }
  return false;
}
/** 처치 연출 + 고철 조각(처치한 사람에게 날아감) — 모든 화면에서 같이 실행 */
function killFx(m, dir, by, n) {
  detach(m); m.alive = false; m.g.visible = false; raid.kills++;
  A.killPop(); feel.shake(by === ME ? .06 : .02);
  if (by === ME) { feel.hitMarker(true); feel.hitstop(.07); }
  sparkAt(m.g.position, 0xb98cff, 16, 4); sparkAt(m.g.position, 0x7ffcff, 6, 2);
  for (let i = 0; i < 7; i++) spawnDebris(m.g.position, dir);
  for (let i = 0; i < n; i++) spawnShard(m.g.position, by);
}

/* ---------- 파편 (몸 조각) ---------- */
const debris = Array.from({ length: 60 }, () => { const d = new THREE.Mesh(debrisGeo, landMat); d.visible = false; d.userData = { v: new THREE.Vector3(), life: 0, spin: new THREE.Vector3() }; scene.add(d); return d; });
let dIdx = 0;
function spawnDebris(pos, dir) {
  const d = debris[dIdx++ % debris.length], u = d.userData;
  d.position.copy(pos); d.visible = true; u.life = 0;
  u.v.set(Math.random() - .5, Math.random() * .8, Math.random() - .5).multiplyScalar(5).addScaledVector(dir, 3);
  u.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10); d.scale.setScalar(.7 + Math.random() * .8);
}
function updateDebris(dt) {
  for (const d of debris) {
    if (!d.visible) continue; const u = d.userData; u.life += dt;
    if (u.life > 1.4) { d.visible = false; continue; }
    d.position.addScaledVector(u.v, dt); u.v.y -= 6 * dt; u.v.multiplyScalar(Math.exp(-dt * 1.5));
    d.rotation.x += u.spin.x * dt; d.rotation.y += u.spin.y * dt; d.scale.multiplyScalar(1 - dt * .6);
  }
}

/* ---------- 고철 조각: 잠깐 떠 있다가 플레이어에게 빨려 옴 ---------- */
const shards = Array.from({ length: 20 }, () => { const s = new THREE.Mesh(shardGeo, landMat); s.visible = false; s.userData = { p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0 }; scene.add(s); return s; });
export function dropShards(worldPos, n, owner = ME) { for (let i = 0; i < n; i++) spawnShard(worldPos, owner); }
function spawnShard(worldPos, owner = ME) {
  const s = shards.find(x => !x.visible); if (!s) return; const u = s.userData;
  toLocal(worldPos, u.p); u.v.set(Math.random() - .5, 1 + Math.random(), Math.random() - .5).multiplyScalar(2.5); u.t = 0; u.owner = owner; s.visible = true;
}
function updateShards(dt) {
  for (const s of shards) {
    if (!s.visible) continue; const u = s.userData; u.t += dt;
    const T = targets.find(x => x.id === u.owner);
    if (!T) { s.visible = false; continue; }                 // 주인이 내렸음
    if (u.t < .7) u.v.multiplyScalar(Math.exp(-dt * 3));
    else {
      _d.subVectors(T.p, u.p); const d = _d.length(); u.v.lerp(_d.setLength(Math.min(25, 6 + u.t * 10)), 1 - Math.exp(-dt * 5));
      if (d < .9) { s.visible = false; if (u.owner === ME) { S.inv.scrap++; A.chime('scrap'); H.flashInv?.(); feel.pickup(s.position); } continue; }
    }
    u.p.addScaledVector(u.v, dt); toWorld(u.p, s.position); s.rotation.y += dt * 5; s.rotation.x += dt * 3;
    if (u.t > 12) s.visible = false;
  }
}
export function clearRaid() { for (const m of pool) { m.alive = false; m.g.visible = false; } for (const l of LATCH) l.taken = null; raid.active = false; raid.toSpawn = 0; }
export const __pool = pool;
export const __inv = () => locoCar.inv;

/* ---------- 멀티플레이 동기화 ---------- */
const STATES = ['approach', 'dash', 'retreat', 'latched'];
/** 호스트 → 모두: 습격 상태 (10Hz) */
export function raidNetState() {
  return { a: raid.active ? 1 : 0, w: raid.wave, n: raid.toSpawn, m: pool.map((m, i) => m.alive ? [i, ...m.p.toArray().map(v => +v.toFixed(2)), ...m.v.toArray().map(v => +v.toFixed(2)), STATES.indexOf(m.state)] : null).filter(Boolean) };
}
export function applyRaidNet(st) {
  if (st.a && !raid.active) { raid.active = true; raid.wave = st.w; raid.kills = 0; H.banner?.('⚠ 공허 떼 습격'); H.toast?.('공허 진드기 떼가 다가와요! 권총(3)과 렌치(1)로 막아 내세요'); A.raidHorn(); feel.shake(.15); }
  if (!st.a && raid.active) { raid.active = false; H.toast?.('습격을 막아 냈어요!'); A.raidClear(); }
  raid.toSpawn = st.n;
  const seen = new Set();
  for (const [i, x, y, z, vx, vy, vz, s] of st.m) {
    const m = pool[i]; if (!m) continue; seen.add(i);
    if (!m.alive) { _l.set(x, y, z); m.spawn(_l); }
    m.net = m.net || { p: new THREE.Vector3(), v: new THREE.Vector3(), at: 0 };
    m.net.p.set(x, y, z); m.net.v.set(vx, vy, vz); m.net.at = performance.now();
    if (STATES[s] === 'latched' && m.state !== 'latched') A.chew();
    m.state = STATES[s] || 'approach';
  }
  for (let i = 0; i < pool.length; i++) if (pool[i].alive && !seen.has(i)) { pool[i].alive = false; pool[i].g.visible = false; }   // 놓친 처치 보정
}
const _v3 = new THREE.Vector3();
/** 습격 관련 이벤트 수신 (from: 보낸 승객 id) */
export function onRaidEv(d, from) {
  if (d.k === 'hitm' && !client()) { const m = pool[d.i]; if (m?.alive) hitMite(m, d.d, _v3.fromArray(d.dir), null, from); }
  else if (d.k === 'kill') { const m = pool[d.i]; if (m && (m.alive || m.g.visible)) { m.alive = true; killFx(m, _v3.fromArray(d.dir), localId(d.by), d.n); } }
  else if (d.k === 'dmg') damagePlayer(d.n, _v3.fromArray(d.f));
}
