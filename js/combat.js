// 전투: 개인 화기(재장전이 김) · 지붕 포탑(과열) · 발차기 · 체력
// 탄약은 무한. 개인 화기는 6발 뒤 긴 재장전, 포탑은 연사하면 과열되어 식을 때까지 못 쏜다.
import * as THREE from 'three';
import { C, prep, M, merged, landMat } from './geo.js';
import { scene, camera } from './scene.js';
import { GUN, TURRET, KICK, HP } from './config.js';
import { S } from './state.js';
import { player, reelIn } from './player.js';
import { cabinCar, turret, turretHeatMat, rayTrain } from './train.js';
import { rayAndroid, damageAndroid, kickAndroid } from './android.js';
import { rayDrone, damageDrone, kickDrone } from './drone.js';
import * as A from './audio.js';

let H = {};                                   // { toast, fade }
export const initCombat = hooks => H = hooks;
const $ = id => document.getElementById(id);

/* ---------- 손에 든 총 (카메라에 붙임) ---------- */
scene.add(camera);
const gun = new THREE.Mesh(merged([
  prep(new THREE.BoxGeometry(.05, .13, .07), C('#2b2b2f'), M(0, -.06, .03, .25)),
  prep(new THREE.BoxGeometry(.055, .07, .26), C('#4b4f56'), M(0, .03, -.08)),
  prep(new THREE.CylinderGeometry(.017, .017, .12, 8), C('#a28c4c'), M(0, .035, -.26, Math.PI / 2)),
  prep(new THREE.BoxGeometry(.012, .02, .02), C('#a28c4c'), M(0, .075, -.18)),
]), landMat);
const flash = new THREE.Mesh(new THREE.OctahedronGeometry(.045, 0), new THREE.MeshBasicMaterial({ color: 0xdfeaf5 })); flash.position.set(0, .035, -.36); flash.visible = false; gun.add(flash);
/* 두 손으로 든 대형 배터리 */
const carryMesh = new THREE.Mesh(merged([prep(new THREE.BoxGeometry(.42, .3, .26), C('#3d4a4c')), prep(new THREE.BoxGeometry(.3, .05, .02), C('#8fe0c0'), M(0, .05, -.131))]), landMat);
carryMesh.position.set(0, -.36, -.55); carryMesh.rotation.x = .25; camera.add(gun, carryMesh);

/* 총알 궤적 */
const tracers = Array.from({ length: 4 }, () => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xdfeaf5, transparent: true })); l.frustumCulled = false; l.visible = false; l.userData.t = 0; scene.add(l); return l; });
let tIdx = 0;
function tracer(a, b) { const l = tracers[tIdx++ % tracers.length]; l.geometry.attributes.position.array.set([a.x, a.y, a.z, b.x, b.y, b.z]); l.geometry.attributes.position.needsUpdate = true; l.visible = true; l.userData.t = .07; }
/* 맞은 자리 불꽃 */
const sparks = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(new THREE.TetrahedronGeometry(.05), new THREE.MeshBasicMaterial({ color: 0xdfeaf5, transparent: true })); m.visible = false; m.userData = { v: new THREE.Vector3(), t: 0 }; scene.add(m); return m; });
let sIdx = 0;
export function sparkAt(p, n = 6, col = 0xdfeaf5) { for (let i = 0; i < n; i++) { const m = sparks[sIdx++ % sparks.length]; m.position.copy(p); m.material.color.set(col); m.userData.v.set(Math.random() - .5, Math.random() - .2, Math.random() - .5).multiplyScalar(5); m.userData.t = .35; m.visible = true; } }

/* ---------- 상태 ---------- */
const g = { ammo: GUN.mag, reload: 0, cool: 0, kick: 0, recoil: 0, heat: 0, locked: false, tCool: 0, tYaw: 0, tPitch: 0, mark: 0, sinceHurt: 99, dead: false, hurtFx: 0 };
export const combatState = g;
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Vector3();

function hitMark(kill) { g.mark = kill ? .3 : .14; const el = $('hitmark'); el.className = kill ? 'on kill' : 'on'; }
function shoot(origin, dir, range, dmg, from) {
  const full = range; range = rayTrain(origin, dir, range);          // 객차 벽·지붕·바닥에서 막힘 (유리창은 통과)
  const h = rayAndroid(origin, dir, range), hd = rayDrone(origin, dir, h ? h.dist : range);
  _e.copy(origin).addScaledVector(dir, hd ? hd.dist : h ? h.dist : range); tracer(from, _e);
  if (!h && !hd && range < full) sparkAt(_e, 4, 0x9aa4ad);                // 철판에 튄 불꽃
  if (hd) { sparkAt(hd.point, 9, 0xffc080); hitMark(damageDrone(hd.drone, dmg, dir)); }
  else if (h) { sparkAt(h.point, 7); hitMark(damageAndroid(h.droid, h.head ? dmg * 2 : h.part === 'torso' ? dmg : dmg * .75, dir, h.point, h.part, h.side, h.joint)); }
}
export function startReload() { if (g.reload > 0 || g.ammo === GUN.mag) return; g.reload = GUN.reload; A.reloadSnd(false); }

/** 발차기 (F) */
export function kick() {
  if (g.kick > 0 || g.dead || S.onTurret) return; g.kick = KICK.cool; A.kickSnd(); S.shake = Math.max(S.shake, .05);
  camera.getWorldDirection(_d); if (kickDrone(camera.position, _d, KICK.range) || kickAndroid(camera.position, _d, KICK.range)) { hitMark(false); S.shake = Math.max(S.shake, .1); }
}
/* 포탑 타기/내리기 */
export function toggleTurret() {
  if (S.carry) { H.toast?.('두 손에 든 걸 내려놓아야 해요'); return; }
  S.onTurret = !S.onTurret;
  if (S.onTurret) { player.car = cabinCar; player.p.copy(turret.seat); player.v.set(0, 0, 0); }
  A.leverClick();
}

export function updateCombat(dt, fireHeld) {
  g.cool -= dt; g.kick -= dt; g.tCool -= dt; g.recoil *= Math.exp(-dt * 14); g.sinceHurt += dt;
  const fp = S.viewMode === 'fp', canGun = fp && !S.carry && !S.onTurret && !g.dead;
  // 개인 화기
  if (g.reload > 0) { g.reload -= dt; if (g.reload <= 0) { g.ammo = GUN.mag; A.reloadSnd(true); } }
  else if (canGun && fireHeld && g.cool <= 0 && S.locked) {
    if (g.ammo <= 0) startReload();
    else {
      g.ammo--; g.cool = GUN.rate; g.recoil = 1; A.gunSnd(); S.shake = Math.max(S.shake, .03);
      camera.getWorldDirection(_d); gun.getWorldPosition(_m);
      shoot(camera.position, _d, GUN.range, GUN.dmg, _m);
      flash.visible = true; setTimeout(() => flash.visible = false, 45);
      if (g.ammo <= 0) startReload();
    }
  }
  // 포탑: 바라보는 쪽으로 천천히 돌아감 (조악한 초기 성능)
  if (S.onTurret) {
    player.p.copy(turret.seat); player.v.set(0, 0, 0);
    camera.getWorldDirection(_d).applyQuaternion(_q.copy(cabinCar.g.quaternion).invert());          // 객실 기준 조준 방향
    const wantYaw = Math.atan2(-_d.z, _d.x), wantPitch = Math.max(-.35, Math.min(.9, Math.asin(_d.y)));
    let dy = wantYaw - g.tYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.tYaw += Math.sign(dy) * Math.min(Math.abs(dy), TURRET.slew * dt); g.tPitch += Math.sign(wantPitch - g.tPitch) * Math.min(Math.abs(wantPitch - g.tPitch), TURRET.slew * dt);
    turret.yaw.rotation.y = g.tYaw; turret.pitch.rotation.z = g.tPitch;
    if (g.locked && g.heat < TURRET.lockBelow) g.locked = false;
    if (fireHeld && !g.locked && g.tCool <= 0 && S.locked && S.powered) {
      g.tCool = TURRET.rate; g.heat += TURRET.heat; A.turretSnd(); S.shake = Math.max(S.shake, .04);
      turret.pitch.updateWorldMatrix(true, false);
      _m.copy(turret.muzzle).applyMatrix4(turret.pitch.matrixWorld);
      _d.set(1, (Math.random() - .5) * 2 * TURRET.spread, (Math.random() - .5) * 2 * TURRET.spread).normalize().transformDirection(turret.pitch.matrixWorld);
      shoot(_m, _d, TURRET.range, TURRET.dmg, _m.clone());
      if (g.heat >= 100) { g.heat = 100; g.locked = true; A.overheatSnd(); }
    }
  }
  g.heat = Math.max(0, g.heat - TURRET.cool * dt);
  const hk = g.heat / 100; turretHeatMat.color.setRGB(.1 + hk * (g.locked ? 1 : .9), .13 + hk * (g.locked ? .1 : .45), .14);

  // 손 모델
  gun.visible = canGun; carryMesh.visible = fp && !!S.carry && !g.dead;
  const rl = g.reload > 0 ? Math.sin(Math.min(1, (GUN.reload - g.reload) * 3) * Math.PI / 2) * Math.min(1, g.reload * 4) : 0;
  const walk = player.grounded ? Math.sin(player.bob) : 0;
  gun.position.set(.3 + walk * .008, -.25 - rl * .22 + Math.abs(walk) * .008, -.52 + g.recoil * .06); gun.rotation.set(g.recoil * .35 + rl * .9, .03, rl * .5);
  if (g.kick > KICK.cool - .2) camera.position.y -= .0;

  for (const l of tracers) if (l.visible) { l.userData.t -= dt; l.material.opacity = Math.max(0, l.userData.t / .07); if (l.userData.t <= 0) l.visible = false; }
  for (const m of sparks) if (m.visible) { const u = m.userData; u.t -= dt; if (u.t <= 0) { m.visible = false; continue; } u.v.y -= 9 * dt; m.position.addScaledVector(u.v, dt); m.material.opacity = u.t / .35; }

  // 체력
  if (!g.dead && g.sinceHurt > HP.regenDelay && S.hp < HP.max) S.hp = Math.min(HP.max, S.hp + HP.regen * dt);
  g.hurtFx = Math.max(0, g.hurtFx - dt); g.mark -= dt; if (g.mark <= 0) $('hitmark').className = '';
  const low = S.hp < 35 ? (35 - S.hp) / 35 * (.5 + .2 * Math.sin(S.time * 6)) : 0;
  $('vign').style.opacity = Math.min(1, g.hurtFx * 1.8 + low).toFixed(3);
  $('hpfill').style.width = (S.hp / HP.max * 100) + '%'; $('hp').classList.toggle('low', S.hp < 35);
  // 상태 한 줄: 재장전 · 과열 · 든 것
  const bits = [];
  if (S.onTurret) bits.push(g.locked ? '포탑 과열 — 식는 중' : !S.powered ? '포탑 전원 없음' : '포탑 열 ' + Math.round(g.heat) + '%');
  else if (g.reload > 0) bits.push('재장전 ' + g.reload.toFixed(1) + '초'); else if (canGun) bits.push('●'.repeat(g.ammo) + '○'.repeat(GUN.mag - g.ammo));
  if (S.carry) bits.push('대형 배터리 운반 중');
  const inv = []; if (S.cells) inv.push('전지 ' + S.cells); if (S.scrap) inv.push('고철 ' + S.scrap); if (S.parts) inv.push('부품 ' + S.parts);
  $('status').textContent = bits.join('  ·  '); $('inv').textContent = inv.join('  ·  ');
}

/** 피해를 입음. from: 때린 쪽의 월드 위치 (밀려나는 방향) */
export function hurt(n, from) {
  if (g.dead) return;
  S.hp = Math.max(0, S.hp - n); g.sinceHurt = 0; g.hurtFx = .5; A.hurtSnd(); S.shake = Math.max(S.shake, .22);
  if (from && !S.onTurret) { _o.copy(player.p).setY(player.p.y + .9).applyMatrix4(player.car.g.matrixWorld).sub(from).setY(0).normalize().applyQuaternion(_q.copy(player.car.g.quaternion).invert()); player.v.addScaledVector(_o, 4.5); player.v.y += 2; }
  if (S.hp <= 0) {
    g.dead = true; S.onTurret = false; H.fade?.(true);
    setTimeout(() => { reelIn(); S.hp = HP.max; S.carry = null; g.dead = false; g.ammo = GUN.mag; g.reload = 0; H.fade?.(false); H.toast?.('쓰러졌어요… 객실에서 깨어났어요'); }, 1500);
  }
}
export function resetCombat() { S.hp = HP.max; S.carry = null; S.cells = 0; S.scrap = 0; S.parts = 0; S.onTurret = false; g.ammo = GUN.mag; g.reload = 0; g.heat = 0; g.locked = false; }
