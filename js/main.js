// 진입점: 초기화와 메인 루프
import * as THREE from 'three';
import { S } from './state.js';
import {getRun, resetRun} from './run-state.js';
import {EVENT_TYPES} from './run-director.js';
import { setSeed, getSeed } from './noise.js';
import { RAIL_JOINT, QUALITY, VMAX, START_S } from './config.js';
import { arcScale, regionAt, SECTOR } from './track.js';
import { renderer, scene, camera, sky, applyQuality } from './scene.js';
import { updateChunks, processQueue, resetWorld, animateWorld, queueLength, updateLights, setCargoListener, worldStats } from './city.js';
import { placeTrain, toTrainCoord, trainToWorld, HALF_W, locoCar, LEVER_POS } from './train.js';
import { player, ext, updatePlayer, updateCamera, updateAvatar, playerWorld, reelIn } from './player.js';
import { updateEnv } from './env.js';

import { initAudio, setMuted, clack, whistle, updateAudio, chainGroan } from './audio.js';
import { initUI, updateHUD, toast, fade, setMuteLabel, showError } from './ui.js';
import { Session, FLAG_GROUND, FLAG_GRAV, FLAG_SPRINT } from './net/session.js';
import { addInteractable, updateInteract } from './interact.js';
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
function regenerate() { resetWorld(); snap = true; updateChunks(S.sTrain); startLoading(); }

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
  getTrain: () => ({ s: S.sTrain, speed: S.loading ? 0 : S.speed * timeScale, targetSpeed: S.targetSpeed, seed: getSeed(), run: getRun().snapshot() }),
  applyTrain(st, ageMs) {
    if (!st || !Number.isFinite(st.s) || !Number.isFinite(st.speed) || !Number.isFinite(st.targetSpeed) || !Number.isInteger(st.seed)) return;
    const seedChanged = st.seed !== getSeed();
    if (seedChanged) setSeed(st.seed);
    const result = getRun().apply(st.run);
    const predicted = st.s + st.speed * Math.max(0, ageMs) / 1000 / arcScale(st.s);
    if (seedChanged || result.needsRebuild) { S.sTrain = predicted; regenerate(); toast('기관사의 운행과 이벤트 배치를 맞췄어요'); }
    netTrain = { s: st.s, speed: st.speed, at: now() - ageMs };
    if (S.targetSpeed !== st.targetSpeed) S.targetSpeed = st.targetSpeed;
  },
  onWorldOffer(st) { netHooks.applyTrain(st, 0); },
  onControl(ts, by) { const was = S.targetSpeed; S.targetSpeed = ts; if (was === 0 && ts > 0) { whistle(); toast(`${by} 님이 열차를 출발시켰어요`); } else if (ts === 0 && was > 0) toast(`${by} 님이 열차를 세웠어요`); },
  onPick() {}, takenList: () => [], applyTaken() {},
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
const controlChanged = () => session?.sendControl(S.targetSpeed);
const hostOnly = () => { if (isClient()) { toast('이건 기관사(방장)만 할 수 있어요'); return false; } return true; };

const handlers = {
  start() { initAudio(); setMuteLabel(); whistle(); },
  toggleTrain() {
    if (S.targetSpeed > 0) { S.lastTarget = S.targetSpeed; S.targetSpeed = 0; }
    else { S.targetSpeed = S.lastTarget || 6; whistle(); S.shake = Math.max(S.shake, .08); }
    controlChanged();
  },
  faster() { const was = S.targetSpeed; S.targetSpeed = Math.min(VMAX, S.targetSpeed + 4); if (was === 0) { whistle(); } controlChanged(); },
  slower() { S.targetSpeed = Math.max(0, S.targetSpeed - 4); controlChanged(); },
  reelIn() { reelIn(); toast('안전줄을 감아 기관실로 돌아왔어요'); },
  toggleMute() { setMuted(!S.muted); setMuteLabel(); },
  snap() { snap = true; },
  applyQuality(q) { applyQuality(q); },
  nextRegion() { if (!hostOnly()) return; S.sTrain = (Math.floor(S.sTrain / SECTOR) + 1) * SECTOR + START_S; regenerate(); },
  restart() { if (!hostOnly()) return; S.sTrain = START_S; resetRun(); regenerate(); },
  newSeed() { if (!hostOnly()) return; setSeed((Math.random() * 1e9) | 0); S.sTrain = START_S; resetRun(); regenerate(); toast('새 시드: ' + getSeed()); },
  completeGoal(goal) { if (!hostOnly()) return; const r = getRun().completeGoal(goal,S.sTrain); toast(r.duplicate ? '이미 달성한 목표예요' : '목표 달성: 전방의 안전한 구간에 공간을 예약했어요'); return r; },
  jumpToEvent() { if (!hostOnly()) return; const e=getRun().events.find(e=>e.sector!==null && e.phase!=='completed'); if(!e) {toast('먼저 목표를 달성하거나 트리거를 실행해 주세요');return;} S.sTrain=e.sector*SECTOR-180; regenerate(); },
  jumpPastEvent() { if (!hostOnly()) return; const e=getRun().events.find(e=>e.sector!==null && e.phase!=='completed'); if(!e)return; S.sTrain=(e.sector+1)*SECTOR+20; regenerate(); },
  directorStatus() { const run=getRun(), e=run.events.find(e=>e.phase!=='completed'); const names={waiting:'조건 대기',reserved:'예약',approaching:'접근',active:'진행',completed:'통과 완료'}; return '목표: 명세서 ' + (run.goals.has('manifest')?'완료':'미완료') + ' · 전력 ' + (run.goals.has('power')?'완료':'미완료') + ' | ' + (e ? EVENT_TYPES[e.type].label+' · '+names[e.phase]+(e.sector===null?'':' · '+Math.max(0,Math.round(e.sector*SECTOR-S.sTrain))+'m 앞') : '일반 하역장 계속 생성') + ' | 완료 '+run.events.filter(e=>e.phase==='completed').length; },
  joinRoom, leaveRoom,
  netStats: () => session?.connected ? session.stats() : null,
  worldStats,
};
initUI(handlers);
addInteractable({
  id: 'lever', car: locoCar, pos: LEVER_POS.clone().setY(F + 1.2), r: 1.9,
  prompt: () => 'E: ' + (S.targetSpeed > 0 ? '정지' : '출발') + ' · Z/X: 속도 조절',
  act: () => { handlers.toggleTrain(); },
});
setCargoListener(() => chainGroan());
initMPUI(handlers, params);
updateChunks(S.sTrain);
startLoading();

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

  S.speed += (S.targetSpeed - S.speed) * Math.min(1, dt * (S.targetSpeed < S.speed ? .5 : .7));
  const before = S.sTrain;
  S.sTrain += S.loading && !isClient() ? 0 : S.speed * dt / arcScale(S.sTrain);
  syncTrain(realDt);              // 실제 시간 기준: 프레임이 아주 느린 탭도 기관사 위치를 따라잡음
  const travelled = S.sTrain - before;
  if (!isClient()) for(const e of getRun().update(S.sTrain)) { if(S.debug) toast(EVENT_TYPES[e.type].label + (e.phase==='completed'?' 통과 완료':e.phase==='active'?' 진입':' 접근 중')); }
  S.region = regionAt(S.sTrain);

  const inside = player.inGrav && Math.abs(player.p.z) < HALF_W - .1 && player.car.enclosed && !(player.p.x < (player.car.roofX0 ?? -1e9));
  const joint = Math.floor(S.sTrain / RAIL_JOINT);
  if (joint !== lastJoint) { lastJoint = joint; clack(S.speed, player.inGrav); if (player.inGrav && player.grounded && S.speed > 2) S.shake = Math.max(S.shake, Math.min(.03, S.speed * .0012)); }


  updateEnv();
  updateChunks(S.sTrain); PM('plan');
  placeTrain();
  if (S.started) updatePlayer(dt);
  playerWorld(wp);
  updateCamera(dt, snap); snap = false;
  updateAvatar(wp, dt);
  updateInteract();
  session?.update(dt, S.time); PM('player');

  sky.position.copy(camera.position);
  animateWorld(); updateLights(dt); 
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
window.__debug = { S, player, reelIn, camera, setView: v => import('./ui.js').then(m => m.setView(v)), regenerate, worldStats, getRun, handlers, get session() { return session; }, joinRoom };

// Reproducible design review views, shared by server and offline builds.
if(params.has('yaw')) player.yaw=Number(params.get('yaw'));
if(params.has('pitch')) player.pitch=Number(params.get('pitch'));
if(params.has('stop')) { S.targetSpeed=0; S.speed=0; }
if(params.has('ext')) import('./ui.js').then(m=>m.setView('ext'));

if(params.has('orbitYaw')) ext.yaw=Number(params.get('orbitYaw'));
if(params.has('orbitPitch')) ext.pitch=Number(params.get('orbitPitch'));
if(params.has('orbitZoom')) ext.zoom=Math.min(3,Math.max(.35,Number(params.get('orbitZoom'))));
