// 애니메이션 아바타 (로컬 외부 시점 + 원격 플레이어 공용)
// 관절 각도는 목표값을 향해 지수 감쇠로 따라가 자세 전환이 항상 부드럽다.
import * as THREE from 'three';
import { C, prep, M, landMat } from './geo.js';
import { lerpAngle } from './net/interp.js';

const SKIN = C('#f5d7b8'), PANTS = C('#3f4a5c'), BOOT = C('#2e2b34'), PACK = C('#5b6b3a');
const part = (geo, col, m) => { const mesh = new THREE.Mesh(prep(geo, col, m), landMat); mesh.castShadow = true; return mesh; };

function nameTag(text, color) {
  const c = document.createElement('canvas'), g = c.getContext('2d'); c.width = 256; c.height = 64;
  g.font = 'bold 30px Trebuchet MS, sans-serif'; const w = Math.min(240, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(10,12,24,.6)'; g.beginPath(); g.roundRect((256 - w) / 2, 8, w, 46, 23); g.fill();
  g.fillStyle = '#' + color.getHexString(); g.beginPath(); g.arc((256 - w) / 2 + 16, 31, 6, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128 + 6, 32);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(1.6, .4, 1); s.position.y = 2.15; s.renderOrder = 5; return s;
}

export class Avatar {
  constructor(color = C('#ef8a3d'), name = null) {
    this.color = color;
    this.holder = new THREE.Group();               // 위치 + 차량 방향 (밖에서 설정)
    this.root = new THREE.Group(); this.holder.add(this.root);   // 몸 방향(yaw)
    this.body = new THREE.Group(); this.body.position.y = .9; this.root.add(this.body);   // 엉덩이 기준 (유영 시 기울임)
    const torso = part(new THREE.BoxGeometry(.46, .6, .3), color, M(0, .32, 0)); this.body.add(torso);
    this.body.add(part(new THREE.BoxGeometry(.36, .48, .22), PACK, M(0, .36, -.25)));
    this.head = new THREE.Group(); this.head.position.y = .7; this.body.add(this.head);
    this.head.add(part(new THREE.IcosahedronGeometry(.24, 1), SKIN, M(0, .2, 0)));
    this.head.add(part(new THREE.CylinderGeometry(.27, .29, .1, 8), color.clone().offsetHSL(0, 0, .12), M(0, .36, 0)));
    this.head.add(part(new THREE.CylinderGeometry(.16, .2, .14, 8), color.clone().offsetHSL(0, 0, .12), M(0, .45, 0)));
    this.head.add(part(new THREE.BoxGeometry(.22, .06, .04), C('#2e2b34'), M(0, .22, .22)));   // 고글
    const limb = (x, y, len, w, col, footCol) => {
      const g = new THREE.Group(); g.position.set(x, y, 0);
      g.add(part(new THREE.BoxGeometry(w, len, w), col, M(0, -len / 2, 0)));
      if (footCol) g.add(part(new THREE.BoxGeometry(w * 1.1, .1, w * 1.7), footCol, M(0, -len + .03, .05)));
      return g;
    };
    this.armL = limb(-.31, .58, .55, .14, color.clone().offsetHSL(0, 0, -.05), SKIN); this.armR = limb(.31, .58, .55, .14, color.clone().offsetHSL(0, 0, -.05), SKIN);
    this.legL = limb(-.12, .02, .78, .17, PANTS, BOOT); this.legR = limb(.12, .02, .78, .17, PANTS, BOOT);
    this.body.add(this.armL, this.armR); this.root.add(this.legL, this.legR);
    this.legL.position.y = this.legR.position.y = .9;
    if (name) { this.tag = nameTag(name, color); this.root.add(this.tag); }
    this.phase = 0; this.yaw = 0; this.j = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, lean: 0, bob: 0, head: 0 };
  }
  setName(name) { if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); } this.tag = nameTag(name, this.color); this.root.add(this.tag); }
  /** st: { speed(수평 m/s), vy, grounded, inGrav, yaw, pitch } */
  update(dt, st, time) {
    const k = 1 - Math.exp(-dt * 14), j = this.j, T = {};
    const walk = Math.min(1, st.speed / 4);
    if (!st.inGrav) {                                    // 무중력 유영
      const stroke = Math.sin(time * 3.2);
      T.lean = .9 * Math.min(1, .3 + st.speed / 4); T.armL = -2.4 + stroke * .7; T.armR = -2.4 - stroke * .7; T.armLz = -.4; T.armRz = .4;
      T.legL = Math.sin(time * 6) * .35; T.legR = -Math.sin(time * 6) * .35; T.bob = 0; T.head = .6;
    } else if (!st.grounded) {                           // 점프·낙하
      T.lean = -.05; T.armL = -.6; T.armR = -.6; T.armLz = -.9; T.armRz = .9; T.legL = -.7; T.legR = .25; T.bob = 0; T.head = 0;
    } else {                                             // 걷기·서기
      this.phase += dt * (2.2 + st.speed * 1.6);
      const s = Math.sin(this.phase) * .75 * walk;
      T.lean = .08 * walk; T.legL = s; T.legR = -s; T.armL = -s * .8; T.armR = s * .8; T.armLz = -.08; T.armRz = .08;
      T.bob = Math.abs(Math.cos(this.phase)) * .05 * walk + Math.sin(time * 2) * .006; T.head = 0;
    }
    for (const key in T) j[key] += (T[key] - j[key]) * k;
    this.body.rotation.x = j.lean; this.body.position.y = .9 + j.bob;
    this.legL.rotation.x = j.legL; this.legR.rotation.x = j.legR;
    this.armL.rotation.x = j.armL; this.armR.rotation.x = j.armR; this.armL.rotation.z = j.armLz; this.armR.rotation.z = j.armRz;
    this.head.rotation.x = Math.max(-.6, Math.min(.6, -st.pitch * .6)) - j.head * .5;
    this.yaw = lerpAngle(this.yaw, st.yaw + Math.PI, 1 - Math.exp(-dt * 18));
    this.root.rotation.y = this.yaw;
  }
  dispose() { this.holder.parent?.remove(this.holder); this.root.traverse(o => { o.geometry?.dispose(); if (o.material?.map) o.material.map.dispose(); }); }
}
export const colorFor = id => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return new THREE.Color().setHSL((h % 360) / 360, .62, .56); };
