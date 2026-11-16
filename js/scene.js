// 렌더러·카메라·하늘·조명·구름바다
import * as THREE from 'three';
import { n3 } from './noise.js';
import { landMat } from './geo.js';
import { QUALITY } from './config.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcdeef5, 90, 700);
export const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .08, 2600);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

/* 하늘: 그라데이션 + 약한 띠 + 디더링(띠 경계 완화) */
export const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
    void main(){
      float h = clamp(vP.y*1.15+.08,0.,1.); h = pow(h,.75);
      float band = floor(h*14.)/14.;
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);
      vec3 col = mix(bottom, top, mix(h, band, .2)) + (n-.5)/255.*3.;
      gl_FragColor = vec4(col,1.);
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
export const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat); sky.renderOrder = -2; scene.add(sky);

function radialTex(hard) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (hard) { gr.addColorStop(0, '#fff'); gr.addColorStop(.32, '#fff'); gr.addColorStop(.36, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { gr.addColorStop(0, '#fff'); gr.addColorStop(.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const discTex = radialTex(true), softTex = radialTex(false);
export const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, fog: false, depthWrite: false, transparent: true }));
export const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, fog: false, depthWrite: false, transparent: true, color: 0xeef0ff }));
sunSprite.scale.setScalar(230); moonSprite.scale.setScalar(110); scene.add(sunSprite, moonSprite);

const starGeo = new THREE.BufferGeometry(); {
  const p = new Float32Array(900 * 3), v = new THREE.Vector3();
  for (let i = 0; i < 900; i++) { v.set(Math.random() - .5, Math.random() * .9 + .05, Math.random() - .5).normalize().multiplyScalar(1500); p.set([v.x, v.y, v.z], i * 3); }
  starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
}
export const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false, color: 0xfff8e8 }));
scene.add(stars);

export const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.shadow.bias = -.0004; sun.shadow.normalBias = .07;
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 500 });
scene.add(sun, sun.target);
export const moon = new THREE.DirectionalLight(0x9fb4ff, .4); scene.add(moon, moon.target);

/* 발밑 구름바다: 카메라를 따라 격자 단위로 이동, 높이는 월드 좌표 노이즈라 이음매 없음 */
const SEA = 4400, SEG = 88, CELL = SEA / SEG;
const seaGeo = new THREE.PlaneGeometry(SEA, SEA, SEG, SEG).rotateX(-Math.PI / 2).toNonIndexed();
seaGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(seaGeo.attributes.position.count * 3), 3));
const seaBase = seaGeo.attributes.position.array.slice();
const sea = new THREE.Mesh(seaGeo, landMat); sea.position.y = -95; scene.add(sea);
let seaKey = null;
export function updateSea(force) {
  const kx = Math.round(camera.position.x / CELL) * CELL, kz = Math.round(camera.position.z / CELL) * CELL, key = kx + ',' + kz;
  if (key === seaKey && !force) return; seaKey = key; sea.position.x = kx; sea.position.z = kz;
  const p = seaGeo.attributes.position.array, col = seaGeo.attributes.color.array;
  for (let i = 0; i < p.length; i += 3) { const wx = seaBase[i] + kx, wz = seaBase[i + 2] + kz; p[i + 1] = n3(wx * .006, 0, wz * .006, 9) * 26 + n3(wx * .02, 3, wz * .02, 10) * 9; }
  for (let f = 0; f < p.length; f += 9) {
    const sh = .82 + (p[f + 1] + p[f + 4] + p[f + 7]) / 3 / 35 * .18;
    for (let k = 0; k < 9; k += 3) { col[f + k] = sh; col[f + k + 1] = sh; col[f + k + 2] = Math.min(1, sh + .04); }
  }
  seaGeo.attributes.position.needsUpdate = true; seaGeo.attributes.color.needsUpdate = true; seaGeo.computeVertexNormals();
}

export function applyQuality(name) {
  const q = QUALITY[name];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr));
  scene.fog.far = q.fog;
  sun.castShadow = q.shadow > 0;
  if (q.shadow > 0 && sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  // 그림자 on/off 전환 시 재질 재컴파일
  scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
}
