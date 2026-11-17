import assert from 'node:assert/strict';
import * as THREE from 'three';
import {setSeed} from '../js/noise.js';
import {resetRun} from '../js/run-state.js';
import {sector,routeZ,routeY,trackPos,SECTOR} from '../js/track.js';
import {ordinaryPlan,ordinaryHarborJobs,buildOrdinaryHarbor,animateOrdinaryHarbor} from '../js/ordinary-harbor.js';
import {Mesher} from '../js/geo.js';
import {beveled,P} from '../js/industrial-kit.js';
let courses=new Set(),mirrors=new Set(),samples=0,maxGrade=0;
for(const seed of [1234,9,73471,98217]){
 setSeed(seed);resetRun();
 for(let k=0;k<12;k++){
  const c=sector(k),plan=ordinaryPlan(c);courses.add(c.route);mirrors.add(c.m);
  assert.equal(routeY(c,0),0);assert.equal(routeY(c,1400),0);
  assert.equal(routeZ(c,0),0);assert.equal(routeZ(c,1400),40);
  if(c.route==='ridge')assert(routeY(c,625)>=18);
  for(let u=480;u<=700;u+=10){const z=routeZ(c,u);assert(z>c.width*.25 && z<c.width*.76,'central viewing clearance');}
  for(let u=0;u<=1400;u+=2){const grade=Math.abs(routeY(c,u+.1)-routeY(c,u-.1))/.2;maxGrade=Math.max(maxGrade,grade);assert(grade<.181);samples++;}
  assert(plan.bays.some(b=>b.sd===1)&&plan.bays.some(b=>b.sd===-1));
  for(const b of plan.bays){const l=plan.links.find(l=>l.to===b.id);assert(l);assert.equal(l.ya,routeY(c,b.x));assert.equal(l.yb,b.floor);assert.equal(l.zb,b.front+b.sd*3);assert(b.height>b.floor+125);}
  const a=trackPos((k+1)*SECTOR-.001,new THREE.Vector3()),b=trackPos((k+1)*SECTOR+.001,new THREE.Vector3());assert(a.distanceTo(b)<.003);
 }
}
assert.equal(courses.size,3);assert.equal(mirrors.size,2);
// Chamfered shells must face outward for both reflected banks.
for(const mirror of [-1,1]){
 const m=new Mesher(0,0,0,mirror);beveled(m,0,0,0,4,3,6,P.steel);const mesh=m.build(),p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
 for(let i=0;i<p.count;i+=3){const centroid=new THREE.Vector3();for(let j=0;j<3;j++)centroid.add(new THREE.Vector3().fromBufferAttribute(p,i+j));centroid.multiplyScalar(1/3);assert(centroid.dot(new THREE.Vector3().fromBufferAttribute(n,i))>0);}
 mesh.geometry.dispose();
}
setSeed(1234);resetRun();const c=sector(0);let staged=null,completed=0;
const jobs=ordinaryHarborJobs(c,g=>{staged=g;completed++;});for(const fn of jobs)fn();assert.equal(completed,1);
const direct=buildOrdinaryHarbor(c);assert.deepEqual(staged.children.map(o=>o.geometry.attributes.position.count),direct.children.map(o=>o.geometry.attributes.position.count));
for(const t of [0,10,1800,36000]){animateOrdinaryHarbor(staged,t);assert(staged.userData.freight.mesh.instanceMatrix.array.every(Number.isFinite));}
for(const group of [staged,direct])group.traverse(o=>o.geometry?.dispose());
console.log(JSON.stringify({status:'pass',courses:[...courses],mirrors:[...mirrors],samples,maxGrade,stagedJobs:jobs.length,mirroredChamfers:'outward',freight:'finite'}));
