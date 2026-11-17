import assert from 'node:assert/strict';
import * as THREE from 'three';
import {getRun,resetRun} from '../js/run-state.js';
import { setSeed } from '../js/noise.js';
import { trackPos, sector, SECTOR, frameAt, makeFrame } from '../js/track.js';
import { harborPlan, intersectsEnvelope } from '../js/harbor-plan.js';
import { buildHarbor, animateHarbor } from '../js/harbor.js';
import { Mesher, C } from '../js/geo.js';
const p=new THREE.Vector3(), before=new THREE.Vector3(), after=new THREE.Vector3(), fr=makeFrame();
let samples=0, triangles=0;
for(const seed of [1234,9,73471,98217]) {
  setSeed(seed);resetRun();
  getRun().apply({version:1,seed,runId:"design-"+seed,revision:1,goals:[],events:Array.from({length:12},(_,i)=>({id:"test-"+i,type:i%2?"ascent":"cargo",sector:i*2,phase:"reserved",trigger:true}))});
  for(let i=0;i<12;i++) {
    const k=i*2;
    const c=sector(k),plan=harborPlan(c);
    for(let u=100;u<=1010;u+=2) {
      trackPos(k*SECTOR+u,p);p.x-=k*SECTOR;p.y-=c.y0;p.z=(p.z-c.z0)*c.m;
      for(const b of plan.masses) assert(!intersectsEnvelope(b.bounds,p),`rail clearance: seed=${seed},sector=${k},s=${u},building=${b.id}`);
      frameAt(k*SECTOR+u,fr);assert(Math.abs(fr.T.dot(fr.U))<1e-7);samples++;
    }
    trackPos((k+1)*SECTOR-.001,before);trackPos((k+1)*SECTOR+.001,after);
    assert(before.distanceTo(after)<.003,'continuous sector seam');
    const g=buildHarbor(c); assert.equal(g.children.length,3);
    animateHarbor(g,47);assert(g.userData.freight.mesh.instanceMatrix.array.every(Number.isFinite));
    let n=0;
    g.traverse(o=>{if(o.geometry){const pos=o.geometry.attributes.position;for(const v of pos.array)assert(Number.isFinite(v));n+=pos.count/3*(o.isInstancedMesh?o.count:1);o.geometry.dispose();}});
    assert(n<10000,`architecture exceeds 10k triangles: ${n}`);triangles=Math.max(triangles,n);
  }
}
// Reflected boxes and inclined belts must retain outward face winding.
for(const mz of [-1,1]) {
  const m=new Mesher(0,0,0,mz);m.box(0,0,0,2,2,2,C('#ffffff'));const mesh=m.build();
  const pos=mesh.geometry.attributes.position, norm=mesh.geometry.attributes.normal;
  for(let i=0;i<pos.count;i++)assert(pos.getX(i)*norm.getX(i)+pos.getY(i)*norm.getY(i)+pos.getZ(i)*norm.getZ(i)>.9,'box normals point outward');
  mesh.geometry.dispose();
  const ramp=new Mesher(0,0,0,mz);ramp.rampBox(0,0,0,2,2,2,.3,C('#ffffff'));
  const rm=ramp.build(),rp=rm.geometry.attributes.position,rn=rm.geometry.attributes.normal;
  for(let i=0;i<rp.count;i++) assert(rp.getX(i)*rn.getX(i)+rp.getY(i)*rn.getY(i)+rp.getZ(i)*rn.getZ(i)>.8,'inclined belt normals point outward');
  rm.geometry.dispose();
}
console.log(JSON.stringify({status:'pass',seeds:4,sectors:48,clearanceSamples:samples,architectureMaxTriangles:triangles,architectureDrawCalls:3,sectorSeams:'continuous',mirroredBoxNormals:'outward'},null,2));
