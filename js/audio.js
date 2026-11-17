// Web Audio 합성 사운드 (파일 없음): 레일 덜컹, 증기, 바람, 낮은 기계음, 기적, 사슬
import { S } from './state.js';

let ctx = null, master, windGain, windFilter, padGain, padFilter, noiseBuf, pads = [];
export const audioReady = () => !!ctx;

export function initAudio() {
  if (ctx) { ctx.resume?.(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; return; }
  master = ctx.createGain(); master.gain.value = S.muted ? 0 : .7; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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
function noiseBurst(freq, q, dur, vol, type = 'bandpass', when = 0) {
  const t = ctx.currentTime + when, src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = .8 + Math.random() * .4;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  src.connect(f).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + dur + .05);
}
function tone(freq, dur, vol, type = 'sine', when = 0, slide = 0) {
  const t = ctx.currentTime + when, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
}
/** 레일 이음매: 대차 두 개가 차례로 지나가는 '덜컹-덜컹' */
export function clack(speed, inside) {
  if (!ctx || speed < .5) return; const v = Math.min(1, .25 + speed / 30) * (inside ? 1 : .55), gap = Math.min(.35, 2.2 / speed);
  for (const w of [0, gap]) { noiseBurst(1700, 1.2, .07, .22 * v, 'bandpass', w); tone(85, .12, .25 * v, 'sine', w, .7); }
}
export function chuff(speed) { if (!ctx) return; noiseBurst(420 + speed * 6, .8, .22, .1 + Math.min(.12, speed / 300), 'lowpass'); }
export function whistle() {
  if (!ctx) return; const t = ctx.currentTime;
  for (const [f, v] of [[523, .07], [659, .06], [784, .045]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * .97, t); o.frequency.linearRampToValueAtTime(f, t + .15);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .08); g.gain.setValueAtTime(v, t + .9); g.gain.exponentialRampToValueAtTime(.0001, t + 1.4);
    o.connect(lp).connect(g).connect(master); o.start(t); o.stop(t + 1.5);
  }
  noiseBurst(2500, .5, 1.2, .04, 'highpass');
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
/** 매 프레임: 속도·위치에 따라 바람 소리 */
export function updateAudio(inVoid, inside) {
  if (!ctx) return; const t = ctx.currentTime;
  const w = (inVoid ? .16 : inside ? .02 : .06) + Math.min(.12, S.speed / 300);
  windGain.gain.setTargetAtTime(w, t, .4); windFilter.frequency.setTargetAtTime(inVoid ? 380 : 520 + S.speed * 8, t, .5);
}
