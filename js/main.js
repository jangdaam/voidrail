// 진입점: 초기화와 메인 루프
import * as THREE from 'three';
import { S } from './state.js';
import { setSeed, getSeed } from './noise.js';
import { RAIL_JOINT, BL, QUALITY } from './config.js';
import { arcScale, trackPos, shuffleOrder } from './track.js';
import { renderer, scene, camera, sky, stars, sunSprite, moonSprite, sun, moon, updateSea, applyQuality } from './scene.js';
import { updateChunks, processQueue, resetWorld, animateWorld, updatePickups, queueLength, taken, removeItem } from './world.js';
import { placeTrain, toTrainCoord, trainToWorld, HALF_W } from './train.js';
import { player, updatePlayer, updateCamera, updateAvatar, playerWorld, reelIn, localAvatar } from './player.js';
import { updateEnv, sunDir, setBiomeListener } from './env.js';
import { updateWeather } from './weather.js';
import { updateSmoke, smokeBurst, steamPuff, updateWhale, hideWhale, pickupFx, updateFx } from './fx.js';
import { initAudio, setMuted, setChord, clack, chuff, whistle, chime, biomeSting, updateAudio, hiss } from './audio.js';
import { initUI, updateHUD, banner, toast, fade, flashInv, setMuteLabel, showError } from './ui.js';
import { RAID } from './config.js';
import { Session, FLAG_GROUND, FLAG_GRAV, FLAG_SPRINT, toolFlags } from './net/session.js';
import { boiler, updateBoiler, maxSpeed, boilerState, applyBoilerState } from './boiler.js';
import { updateInteract } from './interact.js';
import { initTools, updateTools, renderViewmodel, applyRemoteAct } from './tools.js';
import { initRaid, updateRaid, updateHealth, startRaid, raid, aliveCount, clearRaid } from './raid.js';
import { updateFeel, applyKick, timeFactor } from './feel.js';
import { makeTransport } from './net/transport.js';
import { now } from './net/clock.js';
import { initMPUI, setPeers, setMPStatus } from './mpui.js';

window.__started = true;
const params = new URLSearchParams(location.search);
const NO_RENDER = params.has('norender');          // 넷코드 측정용 (로직만 실행)

/* 그래픽 컨텍스트 손실 대비 */
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); running = false; showError('그래픽 장치가 재설정되었습니다.<br>페이지를 새로고침해 주세요.'); });

let snap = true, running = true, loadT = 0;
const startLoading = () => { S.loading = true; loadT = 0; fade(true); };
function regenerate() { clearRaid(); resetWorld(); hideWhale(); snap = true; updateSea(true); updateChunks(S.sTrain); startLoading(); }

/* ---------------- 멀티플레이 ---------------- */
let session = null, netTrain = null, todTarget = null;
const isClient = () => session?.connected && !session.isHost() && session.remotes.size > 0;
const _tp = new THREE.Vector3(), _vReal = new THREE.Vector3();
let timeScale = 1;                       // 게임 dt / 실제 dt (프레임이 아주 느리면 1 미만)
const snapOut = { p: _tp, v: null, yaw: 0, pitch: 0, flags: 0 };
const netHooks = {
  scene,
  localSnapshot() {
    toTrainCoord(player.car, player.p, _tp);
    snapOut.v = _vReal.copy(player.v).multiplyScalar(timeScale);   // 게임 시간 → 실제 시간 기준 속도
    snapOut.yaw = player.yaw; snapOut.pitch = player.pitch;
    snapOut.flags = (player.grounded ? FLAG_GROUND : 0) | (player.inGrav ? FLAG_GRAV : 0) | (S.keys.ShiftLeft ? FLAG_SPRINT : 0) | toolFlags(S.tool, S.shovelLoad);
    return snapOut;
  },
  trainToWorld,
  getTrain: () => ({ s: S.sTrain, speed: S.loading ? 0 : S.speed * timeScale, targetSpeed: S.targetSpeed, tod: S.tod, timeMul: S.timeMul, seed: getSeed(), boiler: boilerState() }),
  applyTrain(st, ageMs) {
    const predicted = st.s + st.speed * Math.max(0, ageMs) / 1000 / arcScale(st.s);
    if (st.seed !== getSeed()) { setSeed(st.seed); shuffleOrder(); S.biomeName = ''; S.sTrain = predicted; regenerate(); toast('기관사의 세계로 맞췄어요'); }
    netTrain = { s: st.s, speed: st.speed, at: now() - ageMs };
    if (S.targetSpeed !== st.targetSpeed) S.targetSpeed = st.targetSpeed;
    applyBoilerState(st.boiler);
    S.timeMul = st.timeMul; todTarget = st.tod + (ageMs / 1000) * st.timeMul / 240;
  },
  onControl(ts, by) { const was = S.targetSpeed; S.targetSpeed = ts; if (was === 0 && ts > 0) { whistle(); smokeBurst(10); toast(`${by} 님이 기차를 출발시켰어요`); } else if (ts === 0 && was > 0) toast(`${by} 님이 기차를 세웠어요`); },
  onPick(id) { const r = removeItem(id); if (r) pickupFx(r.type, r.pos, true); },
  takenList: () => [...taken].slice(-400),
  applyTaken(ids) { for (const id of ids) removeItem(id); },
  onAct(d) { applyRemoteAct(d); },
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
const hostOnly = () => { if (isClient()) { toast('세계를 바꾸는 건 기관사(방장)만 할 수 있어요'); return false; } return true; };

const handlers = {
  start() { initAudio(); setMuteLabel(); whistle(); smokeBurst(10); },
  toggleTrain() {
    if (S.targetSpeed > 0) { S.lastTarget = S.targetSpeed; S.targetSpeed = 0; }
    else {
      S.targetSpeed = S.lastTarget || 6; whistle(); smokeBurst(14 * (.3 + .7 * S.heat)); S.shake = Math.max(S.shake, .08);
      if (maxSpeed() < 2) toast('압력이 부족해요 — 화실에 장작을 넣어 압력을 올리세요');
    }
    controlChanged();
  },
  faster() { const was = S.targetSpeed; S.targetSpeed = Math.min(40, S.targetSpeed + 4); if (was === 0) { whistle(); smokeBurst(10); } controlChanged(); },
  slower() { S.targetSpeed = Math.max(0, S.targetSpeed - 4); controlChanged(); },
  reelIn() { reelIn(); toast('안전줄을 감아 숙소칸으로 돌아왔어요'); },
  toggleMute() { setMuted(!S.muted); setMuteLabel(); },
  snap() { snap = true; },
  applyQuality(q) { applyQuality(q); },
  nextRegion() {
    if (!hostOnly()) return;
    let target = (Math.floor((S.sTrain + 40) / BL) + 1) * BL; if (target - (S.sTrain + 40) < .3 * BL) target += BL;
    S.sTrain = target - .26 * BL - 40; regenerate();
  },
  newSeed() { if (!hostOnly()) return; setSeed((Math.random() * 1e9) | 0); shuffleOrder(); S.biomeName = ''; regenerate(); },
  joinRoom, leaveRoom,
  raidNow() { if (!hostOnly()) return; if (S.targetSpeed === 0) handlers.toggleTrain(); startRaid(); },
  raidInfo: () => ({ active: raid.active, alive: aliveCount() + raid.toSpawn, next: raid.next }),
  netStats: () => session?.connected ? session.stats() : null,
};
setBiomeListener((B, idx) => { banner(B.name); setChord(idx); if (S.started && !S.loading) biomeSting(); });

initUI(handlers);
initTools({ toggleTrain: handlers.toggleTrain, toast, flashInv, act: d => session?.sendAct(d) });
initRaid({ toast, banner, fade, flashInv });
initMPUI(handlers, params);
shuffleOrder();
updateChunks(S.sTrain);
startLoading();

const clock = new THREE.Clock();
const wp = new THREE.Vector3(), picks = [], _P = new THREE.Vector3();
let lastJoint = 0, chuffAcc = 0;

function syncTrain(dt) {
  if (!isClient() || !netTrain) return;
  const expected = netTrain.s + netTrain.speed * (now() - netTrain.at) / 1000 / arcScale(netTrain.s);
  const err = expected - S.sTrain;
  if (Math.abs(err) > 250) { S.sTrain = expected; regenerate(); }
  else S.sTrain += err * Math.min(1, dt * 1.5);              // 작은 오차는 부드럽게
  S.speed += (netTrain.speed - S.speed) * Math.min(1, dt * 2);
  if (todTarget !== null) { let d = ((todTarget + (now() - netTrain.at) / 1000 * S.timeMul / 240 - S.tod) % 1 + 1.5) % 1 - .5; S.tod = (S.tod + (Math.abs(d) > .05 ? d : d * Math.min(1, dt)) + 1) % 1; }
}

/* 프레임 구간 측정 (#debug): 긴 프레임만 기록 → window.__prof */
const PROF = S.debug || params.has('prof'), profRec = [], profCur = {}; let profT = 0, profStart = 0;
window.__prof = profRec;
function PM(name) { if (!PROF) return; const t = performance.now(); if (name) profCur[name] = (profCur[name] || 0) + t - profT; else { for (const k in profCur) delete profCur[k]; profStart = t; } profT = t; }
let profGap = 0;
function PE() { if (!PROF) return; const tot = performance.now() - profStart; if ((tot > 12 || profGap > 45) && profRec.length < 400) profRec.push({ at: Math.round(S.time * 10) / 10, gap: Math.round(profGap), tot: +tot.toFixed(1), q: queueLength(), ...Object.fromEntries(Object.entries(profCur).filter(([, v]) => v > 1).map(([k, v]) => [k, +v.toFixed(1)])) }); }

function frame() {
  if (!running) return;
  requestAnimationFrame(frame);
  PM(null);
  const realDt = clock.getDelta(); updateFeel(Math.min(.1, realDt));
  const dt = Math.min(.1, realDt) * timeFactor(); S.time += dt;
  profGap = realDt * 1000;
  timeScale += ((realDt > 0 ? dt / realDt : 1) - timeScale) * .2;

  if (S.loading) {
    processQueue(60); loadT += dt;
    if (queueLength() === 0 || loadT > 4) { S.loading = false; fade(false); }
  } else processQueue(QUALITY[S.quality].budget); PM('queue');

  // 기차 이동 (+ 접속 중이면 기관사 기준으로 보정)
  // 보일러: 압력이 낼 수 있는 속도까지만 (압력이 떨어지면 서서히 감속)
  updateBoiler(dt, { remoteAuthority: isClient(), vent: () => { hiss(); steamPuff(); steamPuff(); }, warn: toast });
  const want = Math.min(S.targetSpeed, maxSpeed());
  S.speed += (want - S.speed) * Math.min(1, dt * (want < S.speed ? .35 : .8));
  const moveS = S.loading && !isClient() ? 0 : S.speed * dt / arcScale(S.sTrain);
  const before = S.sTrain;
  S.sTrain += moveS;
  syncTrain(dt); PM('train');
  const travelled = S.sTrain - before;

  const inside = player.inGrav && Math.abs(player.p.z) < HALF_W - .1 && player.car.enclosed;
  const joint = Math.floor(S.sTrain / RAIL_JOINT);
  if (joint !== lastJoint) { lastJoint = joint; clack(S.speed, player.inGrav); if (player.inGrav && player.grounded && S.speed > 2) S.shake = Math.max(S.shake, Math.min(.03, S.speed * .0012)); }
  chuffAcc += Math.max(0, travelled); if (chuffAcc > 3.14) { chuffAcc %= 3.14; chuff(S.speed); }

  updateEnv(dt); PM('env');
  updateChunks(S.sTrain); PM('chunks');
  placeTrain(); PM('place');
  if (S.started) updatePlayer(dt);
  playerWorld(wp);
  updateCamera(dt, snap); snap = false; applyKick(); PM('player');
  localAvatar.setTool(S.tool, S.shovelLoad);
  updateAvatar(wp, dt);
  updateInteract(); updateTools(dt);
  updateRaid(dt, !isClient()); updateHealth(dt); PM('tools');
  for (const p of updatePickups(wp, picks)) { S.inv[p.type]++; pickupFx(p.type, p.pos); chime(p.type); flashInv(); session?.sendPick(p.id); }
  session?.update(dt, S.time); PM('pickups');

  sky.position.copy(camera.position); stars.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 1300);
  moonSprite.position.copy(camera.position).addScaledVector(sunDir, -1300);
  trackPos(S.sTrain - 14, _P);
  sun.position.copy(_P).addScaledVector(sunDir, 220); sun.target.position.copy(_P);
  moon.position.copy(_P).addScaledVector(sunDir, -220); moon.target.position.copy(_P);
  updateSea(false); animateWorld(S.time, dt); updateSmoke(dt); updateWhale(dt); updateWeather(dt); updateFx(dt); PM('anim');
  updateAudio(!player.inGrav, inside);
  if (!NO_RENDER) { renderer.info.autoReset = false; renderer.info.reset(); renderer.render(scene, camera); renderViewmodel(renderer); } PM('render');
  updateHUD(dt); PM('hud'); PE();
}
placeTrain();
frame();

// 개발·테스트용 훅
window.__debug = { S, player, boiler, maxSpeed, reelIn, setView: v => import('./ui.js').then(m => m.setView(v)), regenerate, get session() { return session; }, joinRoom };
import('./train.js').then(t => { window.__coplanar = t.coplanarReport; if (S.debug) console.info('겹친 면 자동 정리:', JSON.stringify(t.coplanarReport)); });
