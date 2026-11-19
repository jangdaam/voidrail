// 진입점: 초기화와 메인 루프
import * as THREE from 'three';
import { S } from './state.js';
import {getRun, resetRun} from './run-state.js';
import {EVENT_TYPES} from './run-director.js';
import { setSeed, getSeed } from './noise.js';
import { RAIL_JOINT, QUALITY, START_S } from './config.js';
import { arcScale, regionAt, SECTOR } from './track.js';
import { renderer, scene, camera, sky, applyQuality } from './scene.js';
import { updateChunks, processQueue, resetWorld, animateWorld, queueLength, updateLights, setCargoListener, worldStats } from './city.js';
import { placeTrain, toTrainCoord, trainToWorld, HALF_W, driveCar, cabinCar, powerCar, LEVER_AT, LADDER_AT, HATCH_AT, ROOF_Y, RACK_AT, CRANK_AT, turret } from './train.js';
import { DRIVE } from './config.js';
import { initPower, applyOp, updatePower, powerState, applyPowerState, resetPower } from './power.js';
import { initLoot, updateLoot, grab, lootPrompt, onPicked, takenList, applyTaken, resetLoot } from './loot.js';
import { initCombat, updateCombat, hurt, kick, startReload, toggleTurret, resetCombat, sparkAt } from './combat.js';
import { initAndroids, updateAndroids, spawnGroup, clearAndroids } from './android.js';
import { initDrones, updateDrones, spawnDrone, clearDrones } from './drone.js';
import { plugIn } from './audio.js';
import { player, ext, updatePlayer, updateCamera, updateAvatar, playerWorld, reelIn } from './player.js';
import { updateEnv } from './env.js';

import { initAudio, setMuted, clack, whistle, updateAudio, chainGroan } from './audio.js';
import { initUI, updateHUD, toast, fade, setMuteLabel, showError } from './ui.js';
import { Session, FLAG_GROUND, FLAG_GRAV, FLAG_SPRINT } from './net/session.js';
import { addInteractable, updateInteract, interact, currentTarget } from './interact.js';
import { makeTransport } from './net/transport.js';
import { now } from './net/clock.js';
import { initMPUI, setPeers, setMPStatus } from './mpui.js';
import { F } from './config.js';

window.__started = true;
const params = new URLSearchParams(location.search);
const NO_RENDER = params.has('norender');          // 넷코드 측정용 (로직만 실행)
if (params.has('seed')) setSeed(+params.get('seed'));
if (params.has('s')) S.sTrain = +params.get('s');   // 시험용: 원하는 지점에서 시작

renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); running = false; showError('그래픽 장치가 재설정되었습니다.<br>페이지를 새로고침해 주세요.'); });

let snap = true, running = true, loadT = 0;
const startLoading = () => { S.loading = true; loadT = 0; fade(true); };
function regenerate() { resetWorld(); resetLoot(); clearAndroids(); clearDrones(); snap = true; updateChunks(S.sTrain); startLoading(); }
function newRun() { resetPower(); resetCombat(); reelIn(); }

/* ---------------- 멀티플레이: 맵은 하나뿐이고, 시드와 열차 위치는 기관사(방장) 기준 ---------------- */
let session = null, netTrain = null;
const isClient = () => session?.connected && !session.isHost() && session.remotes.size > 0;
const _tp = new THREE.Vector3(), _vReal = new THREE.Vector3();
let timeScale = 1;
const snapOut = { p: _tp, v: null, yaw: 0, pitch: 0, flags: 0 };
const netHooks = {
  scene,
  localSnapshot() {
    toTrainCoord(player.car, player.p, _tp);
    snapOut.v = _vReal.copy(player.v).multiplyScalar(timeScale);
    snapOut.yaw = player.yaw; snapOut.pitch = player.pitch;
    snapOut.flags = (player.grounded ? FLAG_GROUND : 0) | (player.inGrav ? FLAG_GRAV : 0) | (S.keys.ShiftLeft ? FLAG_SPRINT : 0);
    return snapOut;
  },
  trainToWorld,
  getTrain: () => ({ s: S.sTrain, speed: S.loading ? 0 : S.speed * timeScale, targetSpeed: S.targetSpeed, seed: getSeed(), run: getRun().snapshot(), pw: powerState() }),
  applyTrain(st, ageMs) {
    if (!st || !Number.isFinite(st.s) || !Number.isFinite(st.speed) || !Number.isFinite(st.targetSpeed) || !Number.isInteger(st.seed)) return;
    const seedChanged = st.seed !== getSeed();
    if (seedChanged) setSeed(st.seed);
    const result = getRun().apply(st.run);
    const predicted = st.s + st.speed * Math.max(0, ageMs) / 1000 / arcScale(st.s);
    if (seedChanged || result.needsRebuild) { S.sTrain = predicted; regenerate(); toast('기관사의 운행과 이벤트 배치를 맞췄어요'); }
    netTrain = { s: st.s, speed: st.speed, at: now() - ageMs };
    applyPowerState(st.pw);
  },
  onWorldOffer(st) { netHooks.applyTrain(st, 0); },
  onControl() {},
  onEv(d) { if (d.k === 'op' && typeof d.op === 'string') applyOp(d.op, d.arg, true); },
  onPick(id) { onPicked(id); }, takenList, applyTaken,
  onPeers: list => setPeers(list, session),
  log: msg => toast(msg),
};
async function joinRoom(code, name) {
  if (session) await session.stop();
  session = new Session(makeTransport(params), netHooks);
  setMPStatus('연결 중…');
  try {
    await session.start(code, name);
    setMPStatus(session.tr.kind === 'local' ? `로컬 시뮬레이션 (지연 ${session.tr.lag}ms · 손실 ${Math.round(session.tr.loss * 100)}%)` : '연결됨 · 다른 승객을 기다리는 중');
    setPeers(session.peerList(), session);
    const url = new URL(location.href); url.searchParams.set('room', code); history.replaceState(null, '', url);
  } catch (e) { console.error(e); setMPStatus('연결 실패: ' + (e.message || e)); session = null; }
}
async function leaveRoom() { if (session) await session.stop(); session = null; netTrain = null; setMPStatus('혼자 타는 중'); setPeers([], null); }
const hostOnly = () => { if (isClient()) { toast('이건 기관사(방장)만 할 수 있어요'); return false; } return true; };

const handlers = {
  start() { initAudio(); setMuteLabel(); whistle(); },
  use() { if (!interact()) grab(); },           // E: 레버·사다리·랙 등. 없으면 손 닿는 자원 집기
  kick, reload: startReload, lootPrompt,
  spawnDroids() { if (hostOnly()) toast('앞쪽에 안드로이드 ' + spawnGroup(3) + '기가 숨었어요'); },
  spawnDrone() { if (hostOnly()) toast(spawnDrone() ? '회수 드론이 다가와요 — 배터리 칸을 지켜요' : '드론이 이미 많아요'); },
  drain() { if (hostOnly()) { S.battery = 0; S.powered = false; S.notch = 0; } },
  charge() { if (hostOnly()) applyOp('charge', 100); },
  reelIn() { reelIn(); toast('안전줄을 감아 객실로 돌아왔어요'); },
  toggleMute() { setMuted(!S.muted); setMuteLabel(); },
  snap() { snap = true; },
  applyQuality(q) { applyQuality(q); },
  nextRegion() { if (!hostOnly()) return; S.sTrain = (Math.floor(S.sTrain / SECTOR) + 1) * SECTOR + START_S; regenerate(); },
  restart() { if (!hostOnly()) return; S.sTrain = START_S; resetRun(); newRun(); regenerate(); },
  newSeed() { if (!hostOnly()) return; setSeed((Math.random() * 1e9) | 0); S.sTrain = START_S; resetRun(); newRun(); regenerate(); toast('새 시드: ' + getSeed()); },
  completeGoal(goal) { if (!hostOnly()) return; const r = getRun().completeGoal(goal,S.sTrain); toast(r.duplicate ? '이미 달성한 목표예요' : '목표 달성: 전방의 안전한 구간에 공간을 예약했어요'); return r; },
  jumpToEvent() { if (!hostOnly()) return; const e=getRun().events.find(e=>e.sector!==null && e.phase!=='completed'); if(!e) {toast('먼저 목표를 달성하거나 트리거를 실행해 주세요');return;} S.sTrain=e.sector*SECTOR-180; regenerate(); },
  jumpPastEvent() { if (!hostOnly()) return; const e=getRun().events.find(e=>e.sector!==null && e.phase!=='completed'); if(!e)return; S.sTrain=(e.sector+1)*SECTOR+20; regenerate(); },
  directorStatus() { const run=getRun(), e=run.events.find(e=>e.phase!=='completed'); const names={waiting:'조건 대기',reserved:'예약',approaching:'접근',active:'진행',completed:'통과 완료'}; return '목표: 명세서 ' + (run.goals.has('manifest')?'완료':'미완료') + ' · 전력 ' + (run.goals.has('power')?'완료':'미완료') + ' | ' + (e ? EVENT_TYPES[e.type].label+' · '+names[e.phase]+(e.sector===null?'':' · '+Math.max(0,Math.round(e.sector*SECTOR-S.sTrain))+'m 앞') : '일반 하역장 계속 생성') + ' | 완료 '+run.events.filter(e=>e.phase==='completed').length; },
  joinRoom, leaveRoom,
  netStats: () => session?.connected ? session.stats() : null,
  worldStats,
};
initUI(handlers);
/* ---------------- 열차의 조작 지점 ---------------- */
const netSend = d => session?.sendEv(d);
initPower({ toast, send: netSend });
initLoot({ toast, sendPick: id => session?.sendPick(id) });
initCombat({ toast, fade });
initAndroids({ hurt, wheelImpact(pos) { sparkAt(pos, 16, 0xffc67a); }, reward(pos) { S.scrap++; if (Math.random() < .25) S.parts++; sparkAt(pos, 10, 0xa8c6ea); } });
initDrones({ toast, spark: sparkAt, reward(pos) { S.scrap += 2; S.parts++; sparkAt(pos, 14, 0xffb070); } });
// 운전차: 레버 3개
addInteractable({ id: 'notch', car: driveCar, pos: LEVER_AT.notch, r: 1.7, prompt: () => `주행 ${S.notch}단 · E: 올리기 · Q: 내리기`, act: () => { applyOp('notch+'); }, alt: () => { applyOp('notch-'); } });
addInteractable({ id: 'brake', car: driveCar, pos: LEVER_AT.brake, r: 1.7, prompt: () => 'E: 브레이크 ' + (S.brake ? '풀기' : '걸기'), act: () => { applyOp('brake'); } });
addInteractable({ id: 'dir', car: driveCar, pos: LEVER_AT.dir, r: 1.7, prompt: () => (S.dir > 0 ? '전진' : '후진') + ' · E: 방향 바꾸기 (정차 중에만)', act: () => { applyOp('dir'); } });
// 객실: 사다리 ↔ 지붕 해치, 포탑
addInteractable({ id: 'ladder', car: cabinCar, pos: LADDER_AT, r: 1.8, prompt: () => player.p.y < F + 2 ? 'E: 지붕으로 올라가기' : null, act: () => { player.p.set(2.6, ROOF_Y + .05, -1.35); player.v.set(0, 0, 0); } });
addInteractable({ id: 'hatch', car: cabinCar, pos: HATCH_AT, r: 1.9, prompt: () => player.p.y > F + 2.5 && !S.onTurret ? 'E: 객실로 내려가기' : null, act: () => { player.p.set(2.1, F + .05, -1.2); player.v.set(0, 0, 0); } });
addInteractable({ id: 'turret', car: cabinCar, pos: turret.at, r: 2.3, prompt: () => player.p.y > F + 2.5 ? (S.onTurret ? 'E: 포탑에서 내리기 · 좌클릭: 사격' : 'E: 포탑 잡기') : null, act: () => { toggleTurret(); } });
// 동력차: 배터리 랙, 비상 크랭크
addInteractable({
  id: 'rack', car: powerCar, pos: RACK_AT, r: 2.2,
  prompt: () => `전력 ${S.battery.toFixed(0)}%` + (S.carry ? ' · E: 대형 배터리 꽂기' : S.cells ? ` · E: 소형 전지 넣기 (${S.cells})` : ''),
  act() {
    if (S.carry) { S.carry = null; applyOp('charge', DRIVE.large); plugIn(); }
    else if (S.cells > 0) { S.cells--; applyOp('charge', DRIVE.small); plugIn(); }
    else return false;
  },
});
addInteractable({ id: 'crank', car: powerCar, pos: CRANK_AT, r: 1.8, prompt: () => S.powered ? null : 'E 누르고 있기: 크랭크 돌리기', act: () => {} });
setCargoListener(() => chainGroan());
initMPUI(handlers, params);
updateChunks(S.sTrain);
startLoading();

const aTargets = [{ x: 0, y: 0, z: 0, roof: false }], NO_TARGETS = [];
setTimeout(() => toast('운전차 조작대: 브레이크를 풀고 주행 단수를 올리면 출발해요'), 2500);
const clock = new THREE.Clock();
const wp = new THREE.Vector3();
let lastJoint = 0;

function syncTrain(dt) {
  if (!isClient() || !netTrain) return;
  const expected = netTrain.s + netTrain.speed * (now() - netTrain.at) / 1000 / arcScale(netTrain.s);
  const err = expected - S.sTrain;
  if (Math.abs(err) > 250) { S.sTrain = expected; regenerate(); }
  else S.sTrain += err * Math.min(1, dt * 1.5);
  S.speed += (netTrain.speed - S.speed) * Math.min(1, dt * 2);
}

/* 프레임 구간 측정 (?prof 또는 디버그): 긴 프레임만 기록 → window.__prof */
const PROF = S.debug || params.has('prof'), profRec = [], profCur = {}; let profT = 0, profStart = 0, profGap = 0;
window.__prof = profRec;
function PM(name) { if (!PROF) return; const t = performance.now(); if (name) profCur[name] = (profCur[name] || 0) + t - profT; else { for (const k in profCur) delete profCur[k]; profStart = t; } profT = t; }
function PE() { if (!PROF) return; const tot = performance.now() - profStart; if ((tot > 12 || profGap > 45) && profRec.length < 400) profRec.push({ s: Math.round(S.sTrain), gap: Math.round(profGap), tot: +tot.toFixed(1), q: queueLength(), ...Object.fromEntries(Object.entries(profCur).filter(([, v]) => v > 1).map(([k, v]) => [k, +v.toFixed(1)])) }); }

function frame() {
  if (!running) return;
  requestAnimationFrame(frame);
  PM(null);
  const realDt = clock.getDelta(), dt = Math.min(.1, realDt); S.time += dt;
  profGap = realDt * 1000;
  timeScale += ((realDt > 0 ? dt / realDt : 1) - timeScale) * .2;

  if (S.loading) {
    processQueue(60); loadT += dt;
    if (queueLength() === 0 || loadT > 6) { S.loading = false; fade(false); }
  } else processQueue(QUALITY[S.quality].budget); PM('build');

  const crankHeld = !S.powered && !!S.keys.KeyE && currentTarget()?.id === 'crank';
  updatePower(dt, !isClient(), crankHeld);
  const before = S.sTrain;
  S.sTrain += S.loading && !isClient() ? 0 : S.speed * dt / arcScale(S.sTrain);
  if (S.sTrain < -20) { S.sTrain = -20; S.speed = 0; }                       // 출발선 뒤의 닫힌 격문
  syncTrain(realDt);              // 실제 시간 기준: 프레임이 아주 느린 탭도 기관사 위치를 따라잡음
  const travelled = S.sTrain - before;
  if (!isClient()) for(const e of getRun().update(S.sTrain)) { if(S.debug) toast(EVENT_TYPES[e.type].label + (e.phase==='completed'?' 통과 완료':e.phase==='active'?' 진입':' 접근 중')); }
  S.region = regionAt(S.sTrain);

  const inside = player.inGrav && Math.abs(player.p.z) < HALF_W - .1 && player.car.enclosed && !(player.p.x < (player.car.roofX0 ?? -1e9));
  const joint = Math.floor(S.sTrain / RAIL_JOINT);
  if (joint !== lastJoint) { lastJoint = joint; clack(Math.abs(S.speed), player.inGrav); if (player.inGrav && player.grounded && Math.abs(S.speed) > 2) S.shake = Math.max(S.shake, Math.min(.03, Math.abs(S.speed) * .0012)); }


  updateEnv();
  updateChunks(S.sTrain); PM('plan');
  placeTrain();
  if (S.started && !S.onTurret) updatePlayer(dt);
  if (player.scrape >= 4) { player.scrape -= 4; hurt(4); }                 // 매달린 채 선로 바닥에 끌림
  playerWorld(wp);
  updateCamera(dt, snap); snap = false;
  if (window.__camHook) window.__camHook(camera);                       // 시험용: 카메라를 열차 밖 원하는 곳에
  updateAvatar(wp, dt);
  updateInteract();
  updateLoot();
  aTargets[0].x = player.p.x - player.car.off; aTargets[0].y = player.p.y; aTargets[0].z = player.p.z; aTargets[0].roof = player.p.y > F + 2.4;
  updateAndroids(dt, !isClient(), player.inGrav && S.hp > 0 ? aTargets : NO_TARGETS);
  updateDrones(dt, !isClient());
  session?.update(dt, S.time); PM('player');

  sky.position.copy(camera.position);
  animateWorld(); updateLights(dt); 
  updateCombat(dt, !!S.fire);
  updateAudio(!player.inGrav, inside); PM('anim');
  if (!NO_RENDER) renderer.render(scene, camera); PM('render');
  updateHUD(dt); PE();
}
placeTrain();
frame();

// Goal systems and world triggers call this on the authoritative host after validating gameplay.
// A client cannot grant itself objectives; future interactions must be validated by the host.
window.voidrailEvents = Object.freeze({
  completeGoal: goal => hostOnly() ? getRun().completeGoal(goal, S.sTrain) : {ok:false,reason:'host-only'},
  request: (type, id) => hostOnly() ? getRun().request(type,id,S.sTrain) : {ok:false,reason:'host-only'},
  trigger: (type, id) => hostOnly() ? getRun().request(type,id,S.sTrain,{trigger:true}) : {ok:false,reason:'host-only'},
  snapshot: () => getRun().snapshot(),
});

// 개발·테스트용 훅
window.__debug = { S, player, spawnDrone, applyOp, spawnGroup, hurt, reelIn, camera, setView: v => import('./ui.js').then(m => m.setView(v)), regenerate, worldStats, getRun, handlers, get session() { return session; }, joinRoom };

// Reproducible design review views, shared by server and offline builds.
if(params.has('yaw')) player.yaw=Number(params.get('yaw'));
if(params.has('pitch')) player.pitch=Number(params.get('pitch'));
if(params.has('go')) { S.brake=false; S.notch=Math.max(1,Math.min(4,+params.get('go')||1)); }
if(params.has('ext')) import('./ui.js').then(m=>m.setView('ext'));

if(params.has('orbitYaw')) ext.yaw=Number(params.get('orbitYaw'));
if(params.has('orbitPitch')) ext.pitch=Number(params.get('orbitPitch'));
if(params.has('orbitZoom')) ext.zoom=Math.min(3,Math.max(.35,Number(params.get('orbitZoom'))));
