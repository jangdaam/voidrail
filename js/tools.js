// 도구 퀵슬롯: 1 렌치 · 2 삽 · 3 권총 · 4 갈고리
//  - 1인칭 손 모델은 별도 장면/카메라로 그려 벽을 뚫고 들어가 보이지 않게 한다 (깊이 버퍼를 비운 뒤 덧그리기)
//  - 좌클릭 = 도구 사용, E = 상호작용(레버·연료 상자·화실)
import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { TOOLS, BOILER, ITEM_NAMES, F } from './config.js';
import { S } from './state.js';
import { player, playerWorld } from './player.js';
import { CARS, locoCar, tenderCar, LEVER_POS } from './train.js';
import { chunks, allItems } from './world.js';
import { boiler, scoop, stoke, deposit, maxSpeed, BIN_CENTER, FIREBOX } from './boiler.js';
import { addInteractable, currentTarget } from './interact.js';
import { buildTool, hookHead, TOOL_IDS } from './toolmodels.js';
import { sparkAt } from './fx.js';
import { scoopSnd, stokeSnd, gunSnd, hookSnd, clankSnd, clickSnd, hitThwack } from './audio.js';
import { rayMite, meleeMites, hitMite } from './raid.js';
import { rayChaser, hitChaser } from './chaser.js';
import { feel } from './feel.js';

let H = {};               // { toggleTrain, toast, act(event), flashInv }

/* ---------- 퀵슬롯 UI ---------- */
const bar = document.createElement('div'); bar.id = 'hotbar';
bar.innerHTML = TOOLS.map((t, i) => `<div class="slot" data-i="${i}">${t.key}</div>`).join('');
document.body.appendChild(bar);
bar.addEventListener('pointerdown', e => { const s = e.target.closest('.slot'); if (s) { selectTool(+s.dataset.i); e.stopPropagation(); } });
const slotEls = [...bar.children];

/* ---------- 1인칭 손 모델 ---------- */
export const vmScene = new THREE.Scene();
const vmCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .01, 10);
addEventListener('resize', () => { vmCam.aspect = innerWidth / innerHeight; vmCam.updateProjectionMatrix(); });
const vmHemi = new THREE.HemisphereLight(0xfff1dc, 0x3a3440, 1.2), vmSun = new THREE.DirectionalLight(0xffffff, 1.4);
vmSun.position.set(.5, 1, .4); vmScene.add(vmHemi, vmSun);
const vmRoot = new THREE.Group(); vmScene.add(vmRoot);
const vm = TOOL_IDS.map(id => { const t = buildTool(id); t.g.visible = false; vmRoot.add(t.g); return t; });
// 도구별 기본 자세 (위치, 회전)
const POSE = {
  wrench: [.3, -.3, -.5, .25, .15, -.35],
  shovel: [.28, -.42, -.35, .32, .12, -.08],
  pistol: [.24, -.22, -.42, .02, .04, 0],
  hook: [.25, -.24, -.42, .04, .05, 0],
};

/* ---------- 상태 ---------- */
let shown = S.tool, switchT = 1, useT = 0, useDur = 1, useKind = '', cool = 0;
const hook = { phase: 'idle', pos: new THREE.Vector3(), dir: new THREE.Vector3(), item: null, t: 0, dist: 0 };
const hookMesh = hookHead(); hookMesh.visible = false; scene.add(hookMesh);
const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xd8c39a })); rope.frustumCulled = false; rope.visible = false; scene.add(rope);
const tracerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true })); tracer.frustumCulled = false; tracer.visible = false; scene.add(tracer);
let tracerT = 0;

/** H: 도구 꺼내기/넣기 */
export function toggleHolster() {
  S.holstered = !S.holstered; switchT = S.holstered ? 0 : .5; clickSnd();   // 꺼낼 땐 아래에서 올라오기만
  if (S.holstered && hook.phase !== 'idle') hook.phase = 'back';
}
export function selectTool(i) {
  if (S.holstered) return;
  i = ((i % 4) + 4) % 4; if (i === S.tool) return;
  S.tool = i; switchT = 0; clickSnd();
  if (hook.phase !== 'idle' && i !== 3) hook.phase = 'back';
}
export const toolId = () => TOOL_IDS[S.tool];

/* ---------- 상호작용 대상 등록 ---------- */
export function initTools(hooks) {
  H = hooks;
  addInteractable({
    id: 'lever', car: locoCar, pos: LEVER_POS.clone().setY(F + 1.2), r: 1.9,
    prompt: () => 'E: ' + (S.targetSpeed > 0 ? '정지' : '출발') + ' · Z/X: 속도 조절' + (maxSpeed() < Math.max(2, S.targetSpeed) - .5 ? '  (압력 부족!)' : ''),
    act: () => { H.toggleTrain(); },
  });
  addInteractable({
    id: 'bin', car: tenderCar, pos: BIN_CENTER, r: 2.3,
    prompt() {
      const parts = [`연료 상자 ${boiler.bin}/${BOILER.binMax}삽`];
      if (S.inv.wood >= BOILER.woodPerLoad && boiler.bin < BOILER.binMax) parts.push(`E: 목재 넣기 (배낭 ${S.inv.wood})`);
      else if (S.holstered) parts.push('H: 도구 꺼내기 → 2: 삽으로 퍼 나르기');
      else if (toolId() === 'shovel') parts.push(S.shovelLoad ? '삽에 장작이 있어요 → 기관실 화실로' : boiler.bin > 0 ? '좌클릭: 장작 퍼기' : '비었어요 — 목재를 모아 오세요');
      else parts.push('2: 삽을 들면 퍼 나를 수 있어요');
      return parts.join(' · ');
    },
    act() {
      if (S.inv.wood >= BOILER.woodPerLoad && boiler.bin < BOILER.binMax) {
        const n = deposit(S.inv.wood); S.inv.wood -= n * BOILER.woodPerLoad; H.flashInv?.(); scoopSnd();
        H.toast(`목재 ${n * BOILER.woodPerLoad}개 → 연료 상자 +${n}삽`); H.act?.({ a: 'deposit', n }); return;
      }
      if (!S.holstered && toolId() === 'shovel') return useTool();
      return false;
    },
  });
  addInteractable({
    id: 'firebox', car: locoCar, pos: FIREBOX, r: 2.0,
    prompt() {
      const st = `화실 불 ${Math.round(boiler.heat * 100)}% · 압력 ${Math.round(boiler.pressure * 100)}%`;
      if (!S.holstered && toolId() === 'shovel' && S.shovelLoad) return '좌클릭: 화실에 장작 넣기 · ' + st;
      return st;
    },
    act: () => !S.holstered && toolId() === 'shovel' && S.shovelLoad ? useTool() : false,
  });
}

/* ---------- 사용 (좌클릭) ---------- */
const _eye = new THREE.Vector3(), _f = new THREE.Vector3(), _v = new THREE.Vector3(), _hand = new THREE.Vector3();
const ray = new THREE.Raycaster();
function aim() {
  if (S.viewMode === 'fp') { _eye.copy(camera.position); camera.getWorldDirection(_f); }
  else { playerWorld(_eye, 1.3); camera.getWorldDirection(_f); }
}
export function useTool() {
  if (!S.started || S.holstered || cool > 0 || switchT < .7) return false;
  const id = toolId(), target = currentTarget();
  if (id === 'shovel') {
    if (target?.id === 'bin' && !S.shovelLoad && boiler.bin > 0) {
      scoop(); S.shovelLoad = 1; swing('scoop', .45); scoopSnd(); H.act?.({ a: 'scoop' }); return true;
    }
    if (target?.id === 'firebox' && S.shovelLoad) {
      stoke(); S.shovelLoad = 0; swing('throw', .5); stokeSnd(); H.act?.({ a: 'stoke' });
      _v.copy(FIREBOX).applyMatrix4(locoCar.g.matrixWorld); sparkAt(_v, 0xffa040, 14, 2.5); return true;
    }
    swing('swing', .4); melee = { t: .12, dmg: 1, range: 2.6 }; return false;
  }
  if (id === 'wrench') {
    swing('swing', .45); melee = { t: .11, dmg: 2, range: 2.4, target };
    return true;
  }
  if (id === 'pistol') {
    cool = .32; swing('recoil', .18); gunSnd(); feel.recoil(.05, .025); feel.shake(.025);
    vm[2].parts.flash.visible = true; setTimeout(() => vm[2].parts.flash.visible = false, 50);
    aim(); ray.set(_eye, _f); ray.far = 220;
    const targets = [...CARS.map(c => c.g)]; for (const rec of chunks.values()) targets.push(rec.group);
    const hit = ray.intersectObjects(targets, true).find(h => h.distance > .4);
    let mh = rayMite(_eye, _f, hit ? hit.distance : 220);
    const ch = rayChaser(_eye, _f, mh ? mh.dist : hit ? hit.distance : 220); if (ch) mh = null;
    const end = ch ? ch.point : mh ? mh.point : hit ? hit.point : _v.copy(_eye).addScaledVector(_f, 220);
    handWorld(_hand); tracerGeo.attributes.position.array.set([_hand.x, _hand.y, _hand.z, end.x, end.y, end.z]); tracerGeo.attributes.position.needsUpdate = true;
    tracer.visible = true; tracerT = .08; tracer.material.opacity = 1;
    if (ch) hitChaser(1, ch.point);
    else if (mh) { sparkAt(mh.point, 0xb98cff, 10, 3); hitMite(mh.mite, 1, _f, mh.point); }
    else if (hit) sparkAt(hit.point, hit.object.userData.item ? 0xffe0a0 : 0xd9e2ea, 8, 2.5);
    return true;
  }
  if (id === 'hook') {
    if (hook.phase !== 'idle') return false;
    cool = .25; swing('recoil', .2); hookSnd(false);
    aim(); handWorld(hook.pos);
    hook.item = findHookTarget(); hook.phase = 'out'; hook.t = 0; hook.dist = 0;
    hook.dir.copy(_f);
    return true;
  }
}
let hintT = 0, melee = null;
/** 휘두르기 중간(맞는 순간)에 판정 */
function updateMelee(dt) {
  if (!melee) return; melee.t -= dt; if (melee.t > 0) return;
  const M = melee; melee = null; aim();
  const hits = meleeMites(_eye, _f, M.range);
  if (hits.length) {
    for (const m of hits) { _v.subVectors(m.g.position, _eye).normalize(); hitMite(m, M.dmg, _v, m.g.position); sparkAt(m.g.position, 0xffffff, 6, 3); }
    feel.shake(.07); feel.recoil(-.03, .03); if (M.dmg > 1) clankSnd();
  } else if (M.target && M.dmg > 1) { clankSnd(); hint('아직 고칠 곳이 없어요 (고장 시스템은 다음 단계)'); }
}
function hint(msg) { if (hintT <= 0) { H.toast(msg); hintT = 4; } }
function swing(kind, dur) { useKind = kind; useT = dur; useDur = dur; }

/* 갈고리 대상: 조준선에 가장 가까운 자원 (35m 이내) */
const HOOK_RANGE = 35;
function findHookTarget() {
  aim(); let best = null, bestS = 1e9;
  for (const o of allItems()) {
    _v.subVectors(o.position, _eye); const along = _v.dot(_f);
    if (along < 1 || along > HOOK_RANGE) continue;
    const perp = _v.addScaledVector(_f, -along).length();
    if (perp > .7 + along * .07) continue;
    const s = perp / along; if (s < bestS) { bestS = s; best = o; }
  }
  return best;
}
let hookAim = null;
export function toolPrompt() {
  if (S.holstered || toolId() !== 'hook' || hook.phase !== 'idle') return '';
  return hookAim ? `좌클릭: ${ITEM_NAMES[hookAim.userData.item]} 끌어오기` : '';
}

/** 손 위치 (월드): 1인칭이면 화면 오른쪽 아래, 외부 시점이면 아바타 손 높이 */
function handWorld(out) {
  if (S.viewMode === 'fp') return out.set(.25, -.2, -.6).applyQuaternion(camera.quaternion).add(camera.position);
  return playerWorld(out, 1.3);
}

/* ---------- 매 프레임 ---------- */
export function updateTools(dt) {
  cool = Math.max(0, cool - dt); hintT -= dt; updateMelee(dt);
  // 퀵슬롯 표시
  slotEls.forEach((el, i) => el.classList.toggle('on', i === S.tool));
  slotEls[1].classList.toggle('loaded', !!S.shovelLoad);
  bar.style.display = S.started && !S.holstered ? 'flex' : 'none';

  // 도구 바꾸기: 내렸다가 올리기
  switchT = Math.min(1, switchT + dt * 4);
  if (switchT >= .5 && shown !== S.tool) shown = S.tool;
  const lower = switchT < .5 ? switchT * 2 : 2 - switchT * 2;   // 0 → 1 → 0
  vm.forEach((t, i) => t.g.visible = i === shown && !(S.holstered && switchT >= .5));
  vm[1].parts.load.visible = !!S.shovelLoad;
  vm[3].parts.tip.visible = hook.phase === 'idle';

  // 자세
  const [px, py, pz, rx, ry, rz] = POSE[TOOL_IDS[shown]];
  const walk = player.grounded ? Math.sin(player.bob) : 0, k = useT > 0 ? useT / useDur : 0, a = Math.sin((1 - k) * Math.PI);
  useT = Math.max(0, useT - dt);
  let ox = walk * .012, oy = Math.abs(walk) * .01 - lower * .4, oz = 0, orx = 0, ory = 0, orz = 0;
  if (useT > 0) {
    if (useKind === 'scoop') { orx = -.5 * a; oz = -.15 * a; oy -= .12 * a; }
    else if (useKind === 'throw') { orx = .5 * a; oz = -.25 * a; oy += .08 * a; }
    else if (useKind === 'swing') { orx = -.9 * a; orz = .3 * a; oz = -.1 * a; }
    else if (useKind === 'recoil') { orx = .35 * a; oz = .05 * a; }
  }
  vmRoot.position.set(px + ox, py + oy, pz + oz); vmRoot.rotation.set(rx + orx, ry + ory, rz + orz);
  vmHemi.intensity = .45 + .9 * S.day + .25 * (S.heat || 0) * (player.car === locoCar ? 1 : 0); vmSun.intensity = .3 + 1.2 * S.day;

  // 총알 궤적
  if (tracerT > 0) { tracerT -= dt; tracer.material.opacity = Math.max(0, tracerT / .08); if (tracerT <= 0) tracer.visible = false; }

  // 갈고리
  hookAim = !S.holstered && toolId() === 'hook' && hook.phase === 'idle' && S.started ? findHookTarget() : null;
  updateHook(dt);
}
function updateHook(dt) {
  const h = hook;
  if (h.phase === 'idle') { hookMesh.visible = rope.visible = false; return; }
  h.t += dt; handWorld(_hand);
  if (h.item && !h.item.parent) { h.item = null; if (h.phase !== 'back') h.phase = 'back'; }   // 이미 주웠거나 사라짐
  if (h.phase === 'out') {
    const step = 75 * dt;
    if (h.item) {
      _v.subVectors(h.item.position, h.pos); const d = _v.length();
      if (d <= step) { h.pos.copy(h.item.position); h.phase = 'pull'; h.t = 0; hookSnd(true); }
      else h.pos.addScaledVector(_v.normalize(), step);
    } else {
      h.pos.addScaledVector(h.dir, step); h.dist += step;
      if (h.dist > HOOK_RANGE) h.phase = 'back';
    }
  } else if (h.phase === 'pull') {
    const o = h.item; _v.subVectors(_hand, o.position); const d = _v.length();
    o.position.addScaledVector(_v.normalize(), Math.min(d, (10 + h.t * 14) * dt));
    h.pos.copy(o.position);
    if (h.t > 5) { h.item = null; h.phase = 'back'; }
  } else if (h.phase === 'back') {
    _v.subVectors(_hand, h.pos); const d = _v.length(), step = 90 * dt;
    if (d <= step + .2) { h.phase = 'idle'; return; }
    h.pos.addScaledVector(_v.normalize(), step);
  }
  hookMesh.visible = rope.visible = true;
  hookMesh.position.copy(h.pos); hookMesh.lookAt(_hand); hookMesh.rotateY(Math.PI);
  ropeGeo.attributes.position.array.set([_hand.x, _hand.y, _hand.z, h.pos.x, h.pos.y, h.pos.z]); ropeGeo.attributes.position.needsUpdate = true;
}

/** 메인 장면을 그린 다음 호출: 깊이만 지우고 손 모델을 덧그린다 */
export function renderViewmodel(renderer) {
  if (S.viewMode !== 'fp' || !S.started) return;
  const ac = renderer.autoClear; renderer.autoClear = false;
  renderer.clearDepth(); renderer.render(vmScene, vmCam);
  renderer.autoClear = ac;
}

/* 원격 동기화: 다른 승객의 행동 */
export function applyRemoteAct(d) {
  if (d?.a === 'scoop') scoop();
  else if (d?.a === 'stoke') stoke();
  else if (d?.a === 'deposit' && typeof d.n === 'number') boiler.bin = Math.min(BOILER.binMax, boiler.bin + d.n);
}
export const hookBusy = () => hook.phase !== 'idle';
export const hookState = () => hook;
