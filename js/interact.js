// 상호작용 대상: 바라보는 방향 + 거리로 하나를 고르고, 화면 프롬프트와 E 키 동작을 정한다.
import * as THREE from 'three';
import { camera } from './scene.js';
import { player, playerWorld } from './player.js';
import { S } from './state.js';

const list = [];
/**
 * it: { car, pos(Vector3 차량 로컬), r(거리), prompt() → 문자열|null, act() → 처리했으면 true }
 *     prompt 가 null 이면 이번 프레임엔 대상이 아님
 */
export function addInteractable(it) { list.push(it); return it; }

const _w = new THREE.Vector3(), _eye = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3();
let current = null, currentText = '';

export function updateInteract() {
  current = null; currentText = '';
  if (!S.started || !player.inGrav) return;
  const fp = S.viewMode === 'fp';
  if (fp) { _eye.copy(camera.position); camera.getWorldDirection(_f); } else playerWorld(_eye, 1.2);
  let best = -1e9;
  for (const it of list) {
    _w.copy(it.pos).applyMatrix4(it.car.g.matrixWorld);
    const d = _d.subVectors(_w, _eye).length();
    if (d > it.r) continue;
    const facing = fp ? _d.dot(_f) / Math.max(d, 1e-3) : 1;
    if (fp && facing < .55 && d > .9) continue;            // 바로 옆이 아니면 바라봐야 함
    const text = it.prompt(); if (!text) continue;
    const score = facing * 2 - d / it.r;
    if (score > best) { best = score; current = it; currentText = text; }
  }
}
export const promptText = () => currentText;
export const currentTarget = () => current;
/** E 키 */
export function interact() { return current ? current.act('use') !== false : false; }
/** Q 키 (레버를 반대로 등) */
export function interactAlt() { return current?.alt ? current.alt() !== false : false; }
