// 입력, 버튼, 로딩 페이드, 토스트, 자동 품질 조절, 디버그 패널 (평소 화면엔 조준점뿐)
import { renderer } from './scene.js';
import { player, ext } from './player.js';
import { interact, promptText } from './interact.js';
import { QUALITY, QUALITY_ORDER } from './config.js';
import { clamp } from './noise.js';
import { S } from './state.js';

const $ = id => document.getElementById(id);
let H = {};                        // main 이 넘겨주는 동작들

export function initUI(handlers) {
  H = handlers;
  addEventListener('keydown', e => {
    S.keys[e.code] = true;
    if (e.code === 'F3') e.preventDefault();          // 브라우저 '찾기' 막기
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat || !S.started) return;
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyP') import('./mpui.js').then(m => m.toggleMP());
    if (e.code === 'KeyX') H.faster(); if (e.code === 'KeyZ') H.slower();
    if (e.code === 'KeyR') H.reelIn();
    if (e.code === 'KeyV') setView(S.viewMode === 'fp' ? 'ext' : 'fp');
    if (e.code === 'KeyM') H.toggleMute();
    if (e.code === 'F3' || e.code === 'Backquote') { e.preventDefault(); setDebug(!S.debug); }
  });
  addEventListener('keyup', e => { S.keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in S.keys) S.keys[k] = false; });

  const cvs = renderer.domElement;
  let dragging = false;
  document.addEventListener('pointerlockchange', () => { S.locked = document.pointerLockElement === cvs; updateResume(); });
  cvs.addEventListener('pointerdown', e => {
    dragging = true; if (!S.locked) tryLock();
  });
  addEventListener('pointerup', () => dragging = false);
  addEventListener('mousemove', e => {
    if (!S.locked && !dragging) return;
    if (S.viewMode === 'fp') { player.yaw -= e.movementX * .0022; player.pitch = clamp(player.pitch - e.movementY * .0022, -1.5, 1.5); }
    else { ext.yaw += e.movementX * .006; ext.pitch = clamp(ext.pitch + e.movementY * .004, -.5, 1.1); }
  });
  cvs.addEventListener('wheel', e => { if (S.viewMode !== 'fp') { ext.zoom = clamp(ext.zoom * (e.deltaY > 0 ? 1.1 : .9), .35, 3); e.preventDefault(); } }, { passive: false });

  // 안내 카드 없이 바로 탑승. 소리·마우스 고정은 브라우저 규칙상 첫 클릭/키 입력 때 시작
  $('start').style.display = 'none'; S.started = true;
  let primed = false;
  const prime = () => { if (primed) return; primed = true; H.start(); };
  addEventListener('pointerdown', prime, { capture: true }); addEventListener('keydown', prime, { capture: true });
  $('go').onclick = () => { prime(); tryLock(); updateResume(); };     // (테스트 호환)
  $('bView').onclick = () => setView(S.viewMode === 'fp' ? 'ext' : 'fp');
  $('bNext').onclick = () => H.nextRegion();
  $('bHome').onclick = () => H.restart();
  $('bSeed').onclick = () => H.newSeed();
  $('bQual').onclick = () => { autoQuality = false; setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(S.quality) + 1) % 3]); };
  $('bMute').onclick = () => H.toggleMute();
  $('resume').onclick = () => tryLock();
  setDebug(S.debug, true);
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
/** 디버그 모드(F3): 상태 표시·버튼·측정 패널 */
export function setDebug(on, silent) {
  S.debug = on; document.body.classList.toggle('dbg', on); $('debug').hidden = !on;
  if (!silent) toast(on ? '디버그 모드 켜짐 (F3로 끄기)' : '디버그 모드 꺼짐');
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

export function updateHUD(dt) {
  perf(dt);
  const ptxt = promptText();
  $('prompt').textContent = ptxt;
  $('cross').classList.toggle('target', !!ptxt);   // 평소 화면: 글자 대신 조준점이 고리로
  $('cross').style.display = S.viewMode === 'fp' && S.started ? 'block' : 'none';
  if (!S.debug) return;
  $('sBiome').textContent = S.region;
  $('sDist').textContent = '거리 · ' + (S.sTrain / 1000).toFixed(2) + ' km';
  $('sSpeed').textContent = '속도 · ' + Math.round(S.speed * 3.6) + ' km/h' + (S.targetSpeed === 0 ? ' (정지 중)' : '');
  $('mode').textContent = player.inGrav ? '⚙ ' + player.car.name : '🪢 열차 밖 — R: 안전줄 감기';
  if (S.debug) {
    const info = renderer.info.render, w = H.worldStats();
    $('debug').textContent = `FPS ${lastFps.toFixed(0)} · draw ${info.calls} · tris ${(info.triangles / 1000).toFixed(0)}k · 생성 대기 ${w.queue} · 품질 ${S.quality} · 청크 ${w.chunks} · 구역 ${w.sectors} · 지오메트리 ${w.geometries}\n` +
      `player ${player.car.name} (${player.p.x.toFixed(2)}, ${player.p.y.toFixed(2)}, ${player.p.z.toFixed(2)}) ${player.grounded ? 'ground' : 'air'} ${player.inGrav ? 'grav' : 'void'}` +
      (H.netStats?.() || []).map(n => `\nnet ${n.name}: rtt ${n.rtt}ms · 재생지연 ${n.delay}ms · 지터 ${n.jitter}ms · 외삽 ${n.extrap}% · ${n.fast ? '비신뢰채널' : '신뢰채널'}`).join('');
  }
}
