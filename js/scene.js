// 렌더러·카메라·안개·기본 조명
// 성능 방침: 그림자 없음, 로그 깊이 버퍼 없음(조기 깊이 판정 유지), 픽셀 배율 상한.
import * as THREE from 'three';
import { QUALITY, FOG_COLOR, FOG_DENSITY } from './config.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
export const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .1, 1700);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

/* 배경: 눈높이는 안개 색, 위·아래로 갈수록 어둠 → 갱도의 천장과 바닥이 보이지 않게 */
const skyMat = new THREE.ShaderMaterial({
  uniforms: { haze: { value: new THREE.Color(FOG_COLOR) } },
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 haze; varying vec3 vP;
    void main(){
      float h = abs(vP.y + .04);
      float d = smoothstep(.0, .75, h);
      float n = .5;
      vec3 col = mix(haze, haze*.65, d) + (n-.5)/255.*2.;
      gl_FragColor = vec4(col,1.);
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide, depthWrite: false, fog: false,
});
export const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), skyMat); sky.renderOrder = -2; sky.frustumCulled = false; scene.add(sky);

/* 기본 조명: 아주 약한 차가운 주변광 + 위에서 내려오는 희미한 빛(면의 방향이 읽히도록). 나머지는 작업등 */
export const hemi = new THREE.HemisphereLight(0x8fa3b8, 0x14100e, .72); scene.add(hemi);
export const fill = new THREE.DirectionalLight(0x9db4cc, .68); fill.position.set(.3, 1, .45); scene.add(fill);

export function applyQuality(name) { renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[name].pr)); }
