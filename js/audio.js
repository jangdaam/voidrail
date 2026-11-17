// Web Audio 합성 사운드 (파일 없음): 레일 덜컹, 증기, 바람, 낮은 기계음, 기적, 사슬
import { S } from './state.js';

let ctx = null, master, windGain, windFilter, padGain, padFilter, noiseBuf, motor, motorGain, pads = [];
export const audioReady = () => !!ctx;

export function initAudio() {
  if (ctx) { ctx.resume?.(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; return; }
  master = ctx.createGain(); master.gain.value = S.muted ? 0 : .7; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  motor=ctx.createOscillator(); motor.type='triangle'; motor.frequency.value=42;
  motorGain=ctx.createGain(); motorGain.gain.value=0;
  motor.connect(motorGain).connect(master); motor.start();
  // 바람
  const wn = ctx.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
  windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 500; windFilter.Q.value = .6;
  windGain = ctx.createGain(); windGain.gain.value = 0;
  wn.connect(windFilter).connect(windGain).connect(master); wn.start();
  // 지역 앰비언트 패드 (화음 3음 + 약한 디튠)
  padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 260;
  padGain = ctx.createGain(); padGain.gain.value = 0; padFilter.connect(padGain).connect(master);
  for (let i = 0; i < 6; i++) {
    const o = ctx.createOscillator(); o.type = i < 3 ? 'triangle' : 'sine';
    const g = ctx.createGain(); g.gain.value = i < 3 ? .05 : .03; o.connect(g).connect(padFilter); o.start(); pads.push(o);
  }
  const DRONE = [55, 82.4, 110.6];        // 낮게 깔리는 기계음
  pads.forEach((o, i) => o.frequency.value = DRONE[i % 3] * (i < 3 ? 1 : 1.006));
  padGain.gain.setTargetAtTime(1, ctx.currentTime, 2);
}
export function setMuted(m) { S.muted = m; if (ctx) master.gain.setTargetAtTime(m ? 0 : .7, ctx.currentTime, .05); }
function noiseBurst(freq, q, dur, vol, type = 'bandpass', when = 0, dest = master) {
  const t = ctx.currentTime + when, src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = .8 + Math.random() * .4;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  src.connect(f).connect(g).connect(dest); src.start(t, Math.random()); src.stop(t + dur + .05);
}
function tone(freq, dur, vol, type = 'sine', when = 0, slide = 0, dest = master) {
  const t = ctx.currentTime + when, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + .05);
}
/** 레일 이음매: 대차 두 개가 차례로 지나가는 '덜컹-덜컹' */
export function clack(speed, inside) {
  if (!ctx || speed < .5) return; const v = Math.min(1, .25 + speed / 30) * (inside ? 1 : .55), gap = Math.min(.35, 2.2 / speed);
  for (const w of [0, gap]) { noiseBurst(1700, 1.2, .07, .22 * v, 'bandpass', w); tone(85, .12, .25 * v, 'sine', w, .7); }
}
export function chuff(speed) { if (!ctx) return; noiseBurst(420 + speed * 6, .8, .22, .1 + Math.min(.12, speed / 300), 'lowpass'); }
export function whistle() {
  if(!ctx)return;
  tone(220,.35,.045,'triangle');tone(293,.4,.035,'triangle',.4);
}
/** 화물판이 움직이기 시작할 때: 사슬이 팽팽해지는 금속 신음 + 낮은 권상기 소리 (한 번) */
export function chainGroan() {
  if (!ctx) return; const t = ctx.currentTime;
  for (const [f, v, w] of [[62, .16, 0], [93, .08, .15], [47, .12, .5]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * .8, t + w); o.frequency.linearRampToValueAtTime(f, t + w + 1.2); o.frequency.linearRampToValueAtTime(f * .96, t + w + 4.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t + w); g.gain.linearRampToValueAtTime(v, t + w + .9); g.gain.setValueAtTime(v, t + w + 2.6); g.gain.exponentialRampToValueAtTime(.0001, t + w + 5);
    o.connect(lp).connect(g).connect(master); o.start(t + w); o.stop(t + w + 5.2);
  }
  for (let i = 0; i < 7; i++) noiseBurst(900 + Math.random() * 1600, 9, .18, .05, 'bandpass', .2 + i * .22 + Math.random() * .1);   // 사슬 고리가 차례로 당겨지는 소리
  tone(1480, 1.6, .025, 'triangle', .9, .97);
}
/* 조작·전력 */
export function leverClick() { if (!ctx) return; tone(520, .05, .08, 'square'); noiseBurst(2400, 3, .05, .1); }
export function powerDown() { if (!ctx) return; tone(180, 1.4, .16, 'sawtooth', 0, .2); noiseBurst(300, .7, .6, .12, 'lowpass', .1); }
export function powerUp() { if (!ctx) return; tone(70, .9, .12, 'sawtooth', 0, 3); tone(660, .25, .05, 'triangle', .7); }
export function crankTick() { if (!ctx) return; noiseBurst(1300, 4, .05, .12); tone(160, .06, .08, 'square'); }
export function pickupSnd(big) { if (!ctx) return; tone(big ? 330 : 620, .1, .08, 'triangle'); tone(big ? 495 : 930, .14, .06, 'triangle', .07); }
export function plugIn() { if (!ctx) return; noiseBurst(900, 2, .09, .16); tone(220, .3, .09, 'sawtooth', .05, 2.2); tone(880, .2, .05, 'triangle', .3); }
/* 전투 */
export function gunSnd() { if (!ctx) return; noiseBurst(1500, .5, .22, .42, 'lowpass'); tone(120, .16, .28, 'square', 0, .4); noiseBurst(3800, 1, .3, .05, 'highpass', .04); }
export function turretSnd() { if (!ctx) return; noiseBurst(900, .6, .12, .3, 'lowpass'); tone(90, .09, .22, 'square', 0, .5); }
export function reloadSnd(end) { if (!ctx) return; if (end) { tone(700, .05, .09, 'square'); noiseBurst(2600, 4, .06, .12, 'bandpass', .06); } else { noiseBurst(1800, 3, .07, .1); tone(300, .08, .06, 'square', .12); } }
export function overheatSnd() { if (!ctx) return; noiseBurst(5200, .7, .8, .09, 'highpass'); }
export function hitSnd(kill) { if (!ctx) return; noiseBurst(kill ? 500 : 800, 1.2, kill ? .3 : .1, .3, 'lowpass'); tone(kill ? 300 : 1500, kill ? .3 : .05, kill ? .1 : .06, kill ? 'sawtooth' : 'triangle', 0, kill ? .3 : 1); }
export function kickSnd() { if (!ctx) return; noiseBurst(260, .8, .16, .4, 'lowpass'); tone(90, .12, .25, 'sine', 0, .6); }
export function hurtSnd() { if (!ctx) return; tone(110, .3, .28, 'sawtooth', 0, .5); noiseBurst(420, .8, .22, .22, 'lowpass'); }
export function servo(v = 1) { if (!ctx) return; tone(1900 + Math.random() * 600, .07, .03 * v, 'square', 0, .7); tone(240, .12, .03 * v, 'sawtooth', .05, 1.6); }
export function clangSnd() { if (!ctx) return; tone(820, .3, .1, 'triangle', 0, .98); noiseBurst(2200, 3, .08, .2); tone(130, .18, .2, 'sine'); }
/* 안드로이드: 방향(좌우)과 거리가 들리는 소리. pan -1(왼쪽)~1(오른쪽), vol 0~1 */
function panned(pan, vol) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); const g = ctx.createGain(); g.gain.value = vol; p.connect(g).connect(master); return p; }
export function droidSnd(kind, pan = 0, vol = 1) {
  if (!ctx || vol < .02) return; const d = panned(pan, vol);
  if (kind === 'wake') { for (let i = 0; i < 4; i++) tone(2600 + i * 180, .05, .05, 'square', i * .07, 1, d); tone(150, .5, .06, 'sawtooth', .1, 1.8, d); }
  else if (kind === 'servo') { tone(1700 + Math.random() * 700, .08, .05, 'square', 0, .7, d); tone(230, .16, .05, 'sawtooth', .04, 1.7, d); }
  else if (kind === 'knock') { noiseBurst(180, .7, .25, .5, 'lowpass', 0, d); tone(70, .2, .3, 'sine', 0, .6, d); noiseBurst(1400, 2, .08, .15, 'bandpass', .02, d); }
  else if (kind === 'door') { noiseBurst(300, .5, .5, .5, 'lowpass', 0, d); tone(95, .5, .2, 'sawtooth', 0, .5, d); noiseBurst(2600, 3, .3, .12, 'bandpass', .05, d); }
  else if (kind === 'scrape') { noiseBurst(2200 + Math.random() * 900, 6, .35, .12, 'bandpass', 0, d); noiseBurst(600, 2, .25, .08, 'bandpass', .1, d); }
  else if (kind === 'land') { noiseBurst(220, .6, .35, .6, 'lowpass', 0, d); tone(60, .3, .4, 'sine', 0, .5, d); noiseBurst(3000, 3, .12, .16, 'bandpass', .02, d); }
  else if (kind === 'tick') { tone(3200 + Math.random() * 900, .018, .05, 'square', 0, .9, d); noiseBurst(5000, 8, .03, .12, 'bandpass', 0, d); }      // 고개가 한 칸 걸리는 소리
  else if (kind === 'shriek') { tone(1900, .7, .06, 'sawtooth', 0, .45, d); tone(2050, .7, .05, 'square', .02, .5, d); noiseBurst(3400, 2, .5, .14, 'bandpass', 0, d); tone(110, .6, .1, 'sawtooth', 0, .6, d); }
  else if (kind === 'glass') { noiseBurst(900, .9, .18, .55, 'lowpass', 0, d); noiseBurst(4200, 5, .12, .22, 'bandpass', .01, d); tone(85, .18, .25, 'sine', 0, .6, d); }
  else if (kind === 'step') { noiseBurst(160, .8, .12, .35, 'lowpass', 0, d); noiseBurst(2400, 6, .05, .06, 'bandpass', .01, d); }
  else if (kind === 'grip') { tone(900, .25, .08, 'triangle', 0, .97, d); noiseBurst(1900, 4, .1, .2, 'bandpass', 0, d); }
}
/* 회수 드론: 회전익 웅웅거림(지속음, 드론마다 하나) + 경고음 */
export function droneVoice() {
  if (!ctx) return null;
  const p = ctx.createStereoPanner(), g = ctx.createGain(); g.gain.value = 0; p.connect(g).connect(master);
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(); o1.type = 'sawtooth'; o2.type = 'square';
  o1.frequency.value = 118; o2.frequency.value = 121; f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 1.2;
  const og = ctx.createGain(); og.gain.value = .5; o1.connect(f); o2.connect(og).connect(f); f.connect(p); o1.start(); o2.start();
  return { set(pan, vol, pitch) { const t = ctx.currentTime; p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, .05); g.gain.setTargetAtTime(vol, t, .08);
      o1.frequency.setTargetAtTime(118 * pitch, t, .1); o2.frequency.setTargetAtTime(121.5 * pitch, t, .1); f.frequency.setTargetAtTime(420 + 300 * pitch, t, .1); },
    stop() { try { o1.stop(); o2.stop(); } catch (e) {} g.disconnect(); } };
}
export function droneSnd(kind, pan = 0, vol = 1) {
  if (!ctx || vol < .02) return; const d = panned(pan, vol);
  if (kind === 'lock') { for (let i = 0; i < 3; i++) tone(1320, .06, .07, 'square', i * .11, 1, d); }
  else if (kind === 'dive') { tone(900, .9, .07, 'sawtooth', 0, .3, d); noiseBurst(1800, 1.5, .6, .1, 'bandpass', 0, d); }
  else if (kind === 'clamp') { noiseBurst(700, 1, .2, .45, 'lowpass', 0, d); tone(240, .25, .12, 'square', 0, .5, d); }
  else if (kind === 'steal') { tone(300, .6, .1, 'sawtooth', 0, 2.4, d); tone(1200, .2, .06, 'triangle', .3, 1.4, d); }
  else if (kind === 'crash') { noiseBurst(400, .6, .7, .6, 'lowpass', 0, d); noiseBurst(3000, 3, .3, .2, 'bandpass', .05, d); tone(70, .6, .3, 'sine', 0, .4, d); }
}
/** 매 프레임: 속도·위치에 따라 바람 소리 */
export function updateAudio(inVoid, inside) {
  if (!ctx) return; const t = ctx.currentTime;
  const sp = Math.abs(S.speed);
  motor.frequency.setTargetAtTime(42+sp*2.2,t,.5); motorGain.gain.setTargetAtTime(S.powered ? Math.min(.05,sp*.002) : 0,t,.4);
  const w = (inVoid ? .16 : inside ? .02 : .06) + Math.min(.12, sp / 300);
  windGain.gain.setTargetAtTime(w, t, .4); windFilter.frequency.setTargetAtTime(inVoid ? 380 : 520 + sp * 8, t, .5);
}
