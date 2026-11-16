// HUD, 입력, 버튼, 로딩 페이드, 토스트, 자동 품질 조절, 디버그 패널
import { renderer } from './scene.js';
import { player, ext } from './player.js';
import { interact, promptText } from './interact.js';
import { selectTool, useTool, toolPrompt } from './tools.js';
import { queueLength } from './world.js';
import { QUALITY, QUALITY_ORDER } from './config.js';
import { clamp } from './noise.js';
import { S } from './state.js';

const $ = id => document.getElementById(id);
let H = {};                        // main 이 넘겨주는 동작들

export function initUI(handlers) {
  H = handlers;
  addEventListener('keydown', e => {
    S.keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat || !S.started) return;
    if (e.code === 'KeyE') interact();
    if (/^Digit[1-4]$/.test(e.code)) selectTool(+e.code[5] - 1);
    if (e.code === 'KeyX') H.faster(); if (e.code === 'KeyZ') H.slower();
    if (e.code === 'KeyR') H.reelIn();
    if (e.code === 'KeyV') setView(S.viewMode === 'fp' ? 'ext' : 'fp');
    if (e.code === 'KeyM') H.toggleMute();
  });
  addEventListener('keyup', e => { S.keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in S.keys) S.keys[k] = false; });

  const cvs = renderer.domElement;
  let dragging = false;
  document.addEventListener('pointerlockchange', () => { S.locked = document.pointerLockElement === cvs; updateResume(); });
  cvs.addEventListener('pointerdown', e => {
    if (S.locked && S.viewMode === 'fp' && e.button === 0) { useTool(); return; }
    dragging = true; if (!S.locked) tryLock();
  });
  addEventListener('pointerup', () => dragging = false);
  addEventListener('mousemove', e => {
    if (!S.locked && !dragging) return;
    if (S.viewMode === 'fp') { player.yaw -= e.movementX * .0022; player.pitch = clamp(player.pitch - e.movementY * .0022, -1.5, 1.5); }
    else { ext.yaw += e.movementX * .006; ext.pitch = clamp(ext.pitch + e.movementY * .004, -.5, 1.1); }
  });
  cvs.addEventListener('wheel', e => { if (S.viewMode === 'fp' && S.started) { selectTool(S.tool + (e.deltaY > 0 ? 1 : -1)); e.preventDefault(); return; } if (S.viewMode !== 'fp') { ext.zoom = clamp(ext.zoom * (e.deltaY > 0 ? 1.1 : .9), .35, 3); e.preventDefault(); } }, { passive: false });

  $('go').onclick = () => { $('start').style.display = 'none'; S.started = true; H.start(); tryLock(); updateResume(); };
  $('bView').onclick = () => setView(S.viewMode === 'fp' ? 'ext' : 'fp');
  $('bNext').onclick = () => H.nextRegion();
  $('bTime').onclick = e => { S.timeMul = S.timeMul === 1 ? 10 : 1; e.target.textContent = '시간 ×' + S.timeMul; };
  $('bSeed').onclick = () => H.newSeed();
  $('bQual').onclick = () => { autoQuality = false; setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(S.quality) + 1) % 3]); };
  $('bMute').onclick = () => H.toggleMute();
  $('resume').onclick = () => tryLock();
  if (S.debug) $('debug').hidden = false;
  setQuality(S.quality, true);
}
function tryLock() {
  if (S.viewMode !== 'fp' || !S.started) return;
  try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* 일부 환경은 포인터 락 불가 → 드래그로 시점 조작 */ }
}
function updateResume() { $('resume').hidden = !(S.started && S.viewMode === 'fp' && !S.locked); }
export function setView(v) {
  S.viewMode = v; H.snap?.();
  $('bView').textContent = '시점: ' + (v === 'fp' ? '1인칭' : '외부') + ' (V)';
  if (v !== 'fp' && document.pointerLockElement) document.exitPointerLock();
  updateResume();
}
export function setQuality(q, silent) {
  S.quality = q; H.applyQuality(q);
  $('bQual').textContent = '품질: ' + QUALITY[q].label;
  if (!silent) toast(`그래픽 품질: ${QUALITY[q].label}`);
}
export function setMuteLabel() { $('bMute').textContent = S.muted ? '🔇 소리 꺼짐 (M)' : '🔊 소리 켜짐 (M)'; }

/* 배너·토스트·페이드 */
let bannerTimer, toastTimer;
export function banner(name) { const el = $('banner'); el.textContent = name; el.classList.add('on'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('on'), 2800); }
export function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2600); }
export function fade(on) { $('fade').classList.toggle('on', on); }
export function showError(msg) { const el = $('err'); el.innerHTML = msg; el.style.display = 'flex'; }

/* 자동 품질: 3초 평균 FPS가 낮으면 한 단계씩 낮춤 */
let autoQuality = location.hash !== '#test', fpsAcc = 0, fpsN = 0, fpsT = 0, lastFps = 60;
function perf(dt) {
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT < 3) return;
  lastFps = fpsN / fpsAcc; fpsAcc = fpsN = fpsT = 0;
  if (autoQuality && S.started && !S.loading && lastFps < 38 && S.quality !== 'low') {
    const next = QUALITY_ORDER[QUALITY_ORDER.indexOf(S.quality) + 1];
    setQuality(next, true); toast(`프레임이 낮아 그래픽 품질을 '${QUALITY[next].label}'(으)로 낮췄어요`);
  }
}

let invFlash = 0;
export const flashInv = () => invFlash = .4;
export function updateHUD(dt) {
  perf(dt);
  $('sBiome').textContent = '지역 · ' + S.biomeName;
  $('sDist').textContent = '거리 · ' + (S.sTrain / 1000).toFixed(2) + ' km';
  $('sSpeed').textContent = '속도 · ' + Math.round(S.speed * 3.6) + ' km/h' + (S.targetSpeed === 0 ? ' (정지 중)' : '');
  const m = Math.floor(S.tod * 1440); $('sTime').textContent = '시각 · ' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  $('mode').textContent = player.inGrav ? '⚙ ' + player.car.name : '🪢 무중력 유영 — R: 안전줄 감기';
  invFlash = Math.max(0, invFlash - dt);
  const iv = S.inv; $('inv').textContent = `배낭 · 목재 ${iv.wood} · 고철 ${iv.scrap}`;
  $('inv').classList.toggle('flash', invFlash > 0);
  $('prompt').textContent = promptText() || toolPrompt();
  $('boil').textContent = `🔥 불 ${Math.round(S.heat * 100)}% · 압력 ${Math.round(S.pressure * 100)}%`;
  $('boil').classList.toggle('low', S.pressure < .3);
  $('cross').style.display = S.viewMode === 'fp' && S.started ? 'block' : 'none';
  if (S.debug) {
    const info = renderer.info.render;
    $('debug').textContent = `FPS ${lastFps.toFixed(0)} · draw ${info.calls} · tris ${(info.triangles / 1000).toFixed(0)}k · 생성 대기 ${queueLength()} · 품질 ${S.quality}\n` +
      `player ${player.car.name} (${player.p.x.toFixed(2)}, ${player.p.y.toFixed(2)}, ${player.p.z.toFixed(2)}) ${player.grounded ? 'ground' : 'air'} ${player.inGrav ? 'grav' : 'void'}` +
      (H.netStats?.() || []).map(n => `\nnet ${n.name}: rtt ${n.rtt}ms · 재생지연 ${n.delay}ms · 지터 ${n.jitter}ms · 외삽 ${n.extrap}% · ${n.fast ? '비신뢰채널' : '신뢰채널'}`).join('');
  }
}
