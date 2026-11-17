// 선로 옆 선반의 자원: 고철 · 부품 · 소형 전지 · 대형 배터리
//
// 손이 닿는 거리(약 3m)에서 바라보고 E 로 집는다. 열차가 느려야 집을 수 있으므로
// '서행하며 파밍할지, 빨리 지나갈지'가 선택이 된다. 배치는 시드로 정해져 모든 승객에게 같다.
import * as THREE from 'three';
import { C, prep, M, merged, landMat, glowMat } from './geo.js';
import { trackPos, frameAt, makeFrame, U } from './track.js';
import { scene, camera } from './scene.js';
import { LOOT, DRIVE, SEG } from './config.js';
import { hash } from './noise.js';
import { S } from './state.js';
import * as A from './audio.js';

let H = {};                                  // { toast, sendPick(id) }
export const initLoot = hooks => H = hooks;

const STEELD = C('#14171b'), STEEL = C('#2a2f37');
const postGeo = merged([prep(new THREE.BoxGeometry(.09, 4.4, .09), STEELD, M(0, -1.1, 0)), prep(new THREE.BoxGeometry(.5, .05, .5), STEEL, M(0, 1.1, 0)), prep(new THREE.BoxGeometry(.5, .16, .04), STEELD, M(0, 1.2, .25))]);
const GEO = {
  scrap: merged([prep(new THREE.BoxGeometry(.3, .08, .2), C('#8a929a'), M(0, .04, 0, 0, .4, .1)), prep(new THREE.BoxGeometry(.18, .07, .22), C('#5d646b'), M(.05, .11, .02, .2, -.5, 0)), prep(new THREE.TetrahedronGeometry(.11), C('#a8b0b8'), M(-.08, .13, -.04))]),
  part: merged([prep(new THREE.CylinderGeometry(.14, .14, .07, 8), C('#a28c4c'), M(0, .06, 0)), prep(new THREE.CylinderGeometry(.05, .05, .2, 6), C('#665d3d'), M(0, .12, 0)), prep(new THREE.BoxGeometry(.34, .05, .06), C('#a28c4c'), M(0, .06, 0)), prep(new THREE.BoxGeometry(.06, .05, .34), C('#a28c4c'), M(0, .06, 0))]),
  small: merged([prep(new THREE.CylinderGeometry(.07, .07, .24, 8), C('#3d4a4c'), M(0, .12, 0)), prep(new THREE.CylinderGeometry(.04, .04, .04, 6), C('#a28c4c'), M(0, .26, 0))]),
  large: merged([prep(new THREE.BoxGeometry(.4, .3, .26), C('#3d4a4c'), M(0, .15, 0)), prep(new THREE.BoxGeometry(.3, .04, .04), C('#14171b'), M(0, .36, 0)), prep(new THREE.BoxGeometry(.04, .08, .04), C('#14171b'), M(-.13, .32, 0)), prep(new THREE.BoxGeometry(.04, .08, .04), C('#14171b'), M(.13, .32, 0))]),
};
/* 어둠 속에서 종류를 알아볼 수 있는 작은 표시등 */
const MARK = { scrap: prep(new THREE.BoxGeometry(.05, .03, .02), C('#8fa3b8')), part: prep(new THREE.BoxGeometry(.05, .03, .02), C('#e0b050')), small: prep(new THREE.BoxGeometry(.05, .05, .02), C('#8fe0c0')), large: prep(new THREE.BoxGeometry(.3, .05, .02), C('#8fe0c0')) };
const NAME = { scrap: '고철', part: '부품', small: '소형 전지', large: '대형 배터리' };

const items = new Map(), taken = new Set(), FR = makeFrame(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3();
function typeFor(gi) { let r = hash(gi, 73), acc = 0; for (const [t, w] of LOOT.table) { acc += w; if (r < acc) return t; } return 'scrap'; }

export function updateLoot() {
  const g0 = Math.floor((S.sTrain - 60) / SEG), g1 = Math.floor((S.sTrain + 170) / SEG);
  for (let gi = g0; gi <= g1; gi++) {
    if (items.has(gi)) continue; items.set(gi, null);
    const s = gi * SEG + 5; if (s < U.gate + 30 || hash(gi, 71) > LOOT.chance || taken.has('L' + gi)) continue;
    const type = typeFor(gi), side = hash(gi, 72) < .5 ? -1 : 1, g = new THREE.Group();
    frameAt(s, FR); trackPos(s, _p).addScaledVector(FR.R, side * 3.35);
    g.position.copy(_p); g.quaternion.setFromRotationMatrix(FR.m);
    g.add(new THREE.Mesh(postGeo, landMat));
    const it = new THREE.Mesh(GEO[type], landMat); it.position.y = 1.125; it.rotation.y = hash(gi, 74) * 6; g.add(it);
    const mk = new THREE.Mesh(MARK[type], glowMat); mk.position.set(0, 1.2, .275); g.add(mk); const mk2 = mk.clone(); mk2.position.z = -.275; g.add(mk2);
    g.userData = { id: 'L' + gi, type, at: _p.clone().setY(_p.y + 1.25), item: it, marks: [mk, mk2] };
    scene.add(g); items.set(gi, g);
  }
  for (const [gi, g] of items) if (gi < g0 - 2 || gi > g1 + 2) { if (g) scene.remove(g); items.delete(gi); }
}
/** 지금 손이 닿는 자원 (바라보는 방향 기준) */
function reachable() {
  camera.getWorldDirection(_f); let best = null, bs = .45;
  for (const g of items.values()) {
    if (!g || !g.userData.item.visible) continue;
    _d.subVectors(g.userData.at, camera.position); const d = _d.length(); if (d > LOOT.reach) continue;
    const dot = _d.dot(_f) / d; if (dot > bs) { bs = dot; best = g; }
  }
  return best;
}
export function lootPrompt() { const g = S.viewMode === 'fp' ? reachable() : null; return g ? 'E: ' + NAME[g.userData.type] + ' 집기' : ''; }
function remove(g) { g.userData.item.visible = false; for (const m of g.userData.marks) m.visible = false; }
/** E 키: 집었으면 true */
export function grab() {
  const g = S.viewMode === 'fp' ? reachable() : null; if (!g) return false;
  const t = g.userData.type;
  if (t === 'small' && S.cells >= DRIVE.pocket) { H.toast?.('소형 전지는 주머니에 ' + DRIVE.pocket + '개까지예요'); return true; }
  if (t === 'large' && S.carry) { H.toast?.('이미 두 손에 들고 있어요'); return true; }
  if (t === 'scrap') S.scrap++; else if (t === 'part') S.parts++; else if (t === 'small') S.cells++; else S.carry = 'large';
  taken.add(g.userData.id); remove(g); A.pickupSnd(t === 'large'); H.sendPick?.(g.userData.id);
  return true;
}
/* 멀티플레이: 누가 집은 자원은 모두에게서 사라진다 */
export function onPicked(id) { taken.add(id); for (const g of items.values()) if (g && g.userData.id === id) remove(g); }
export const takenList = () => [...taken];
export const applyTaken = ids => ids.forEach(onPicked);
export function resetLoot() { for (const g of items.values()) if (g) scene.remove(g); items.clear(); taken.clear(); }
