// Web Audio 합성 사운드 (파일 없음): 레일 덜컹, 증기, 바람, 지역 앰비언트, 기적, 줍기
import { BIOMES } from './config.js';
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
  padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900;
  padGain = ctx.createGain(); padGain.gain.value = 0; padFilter.connect(padGain).connect(master);
  for (let i = 0; i < 6; i++) {
    const o = ctx.createOscillator(); o.type = i < 3 ? 'triangle' : 'sine';
    const g = ctx.createGain(); g.gain.value = i < 3 ? .05 : .03; o.connect(g).connect(padFilter); o.start(); pads.push(o);
  }
  setChord(S.biomeIdx);
  padGain.gain.setTargetAtTime(1, ctx.currentTime, 2);
}
export function setMuted(m) { S.muted = m; if (ctx) master.gain.setTargetAtTime(m ? 0 : .7, ctx.currentTime, .05); }
export function setChord(biomeIdx) {
  if (!ctx) return; const ch = BIOMES[biomeIdx].chord, t = ctx.currentTime;
  pads.forEach((o, i) => o.frequency.setTargetAtTime(ch[i % 3] * (i < 3 ? 1 : 2.003), t, 1.5));
}
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
export function chime(type) {
  if (!ctx) return; const base = type === 'crystal' ? 1047 : type === 'wood' ? 659 : 784;
  tone(base, .35, .12, 'triangle'); tone(base * 1.5, .45, .09, 'sine', .07);
}
export function biomeSting() { if (!ctx) return; const ch = BIOMES[S.biomeIdx].chord; ch.forEach((f, i) => tone(f * 2, 1.6, .05, 'sine', i * .18)); }
/** 매 프레임: 속도·무중력 여부에 따라 바람, 밤에 패드 필터 낮춤 */
export function updateAudio(inVoid, inside) {
  if (!ctx) return; const t = ctx.currentTime;
  const w = (inVoid ? .16 : inside ? .02 : .06) + Math.min(.12, S.speed / 300);
  windGain.gain.setTargetAtTime(w, t, .4); windFilter.frequency.setTargetAtTime(inVoid ? 380 : 520 + S.speed * 8, t, .5);
  padFilter.frequency.setTargetAtTime(500 + 700 * S.day, t, 1);
}
