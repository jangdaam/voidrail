// 도구 모델 (1인칭 손 모델 · 아바타 손 공용). 모두 '앞 = -z, 위 = +y' 기준, 손잡이가 원점.
import * as THREE from 'three';
import { C, prep, M, merged, landMat } from './geo.js';

const IRON = C('#7a8088'), IRON_D = C('#4b4f56'), CHAR = C('#2b2b2f'), COPPER = C('#b8733f'), COPPER_D = C('#8a5732'), HANDLE = C('#6b4a2f'), LOG = C('#7a5534'), LOG_END = C('#c9a06a');
const mesh = list => { const m = new THREE.Mesh(merged(list), landMat); m.castShadow = true; return m; };

export const TOOL_IDS = ['wrench', 'shovel', 'pistol', 'hook'];

/** 도구 하나를 만든다. 반환: { g, parts } — parts 는 애니메이션용 하위 객체 */
export function buildTool(id) {
  const g = new THREE.Group(), parts = {};
  if (id === 'wrench') {
    g.add(mesh([
      prep(new THREE.BoxGeometry(.045, .03, .44), IRON, M(0, 0, -.12)),
      prep(new THREE.BoxGeometry(.06, .045, .14), COPPER_D, M(0, 0, .05)),          // 손잡이 감개
      prep(new THREE.BoxGeometry(.16, .035, .07), IRON, M(0, 0, -.36)),             // 머리
      prep(new THREE.BoxGeometry(.04, .035, .09), IRON_D, M(-.06, 0, -.43)),        // 턱
      prep(new THREE.BoxGeometry(.04, .035, .09), IRON_D, M(.06, 0, -.43)),
    ]));
  } else if (id === 'shovel') {
    g.add(mesh([
      prep(new THREE.BoxGeometry(.035, .035, .95), HANDLE, M(0, 0, -.3)),
      prep(new THREE.BoxGeometry(.13, .04, .04), CHAR, M(0, 0, .19)),               // T자 손잡이
      prep(new THREE.BoxGeometry(.03, .03, .1), IRON_D, M(0, 0, -.8)),              // 목
      prep(new THREE.BoxGeometry(.26, .02, .28), IRON, M(0, -.01, -.98, .18)),      // 날
      prep(new THREE.BoxGeometry(.02, .06, .26), IRON_D, M(-.13, .015, -.98, .18)),
      prep(new THREE.BoxGeometry(.02, .06, .26), IRON_D, M(.13, .015, -.98, .18)),
    ]));
    const load = new THREE.Group();                                               // 날 위 장작
    load.add(mesh([
      prep(new THREE.CylinderGeometry(.055, .055, .24, 6), LOG, M(-.04, .05, -.95, 0, .3, Math.PI / 2)),
      prep(new THREE.CylinderGeometry(.05, .05, .22, 6), LOG, M(.05, .06, -1.02, 0, -.4, Math.PI / 2)),
      prep(new THREE.CylinderGeometry(.045, .045, .2, 6), LOG, M(0, .12, -.98, 0, .1, Math.PI / 2)),
      prep(new THREE.BoxGeometry(.03, .03, .03), LOG_END, M(.08, .03, -.9)),
    ]));
    load.visible = false; g.add(load); parts.load = load;
  } else if (id === 'pistol') {
    g.add(mesh([
      prep(new THREE.BoxGeometry(.05, .13, .07), CHAR, M(0, -.05, .03, .25)),       // 손잡이
      prep(new THREE.BoxGeometry(.06, .07, .24), IRON_D, M(0, .04, -.07)),          // 몸통
      prep(new THREE.CylinderGeometry(.018, .018, .14, 8), COPPER, M(0, .045, -.25, Math.PI / 2)),   // 총열
      prep(new THREE.BoxGeometry(.012, .02, .02), COPPER, M(0, .085, -.16)),        // 가늠쇠
      prep(new THREE.CylinderGeometry(.04, .04, .05, 6), COPPER_D, M(0, .04, -.02, 0, 0, Math.PI / 2)),   // 탄창 원통
    ]));
    const flash = new THREE.Mesh(new THREE.OctahedronGeometry(.05, 0), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    flash.position.set(0, .045, -.35); flash.visible = false; g.add(flash); parts.flash = flash;
  } else if (id === 'hook') {
    g.add(mesh([
      prep(new THREE.BoxGeometry(.05, .12, .07), CHAR, M(0, -.05, .05, .25)),
      prep(new THREE.BoxGeometry(.08, .08, .3), COPPER_D, M(0, .03, -.08)),
      prep(new THREE.CylinderGeometry(.06, .06, .05, 8), IRON, M(0, .04, .02, 0, 0, Math.PI / 2)),   // 줄 감개
      prep(new THREE.BoxGeometry(.03, .03, .08), IRON_D, M(0, .03, -.26)),
    ]));
    const tip = hookHead(); tip.position.set(0, .03, -.31); g.add(tip); parts.tip = tip;
  }
  return { g, parts };
}
/** 갈고리 끝 (발사체로도 사용) */
export function hookHead() {
  return mesh([
    prep(new THREE.ConeGeometry(.035, .1, 5), IRON, M(0, 0, -.05, -Math.PI / 2)),
    prep(new THREE.BoxGeometry(.12, .015, .015), IRON, M(0, 0, 0)),
    prep(new THREE.BoxGeometry(.015, .015, .05), IRON, M(-.06, 0, .02)),
    prep(new THREE.BoxGeometry(.015, .015, .05), IRON, M(.06, 0, .02)),
  ]);
}
