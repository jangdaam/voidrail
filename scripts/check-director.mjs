import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RunDirector, SECTOR_LENGTH as L, SAFE_LOOKAHEAD} from '../js/run-director.js';
import {getRun, resetRun} from '../js/run-state.js';
import {setSeed} from '../js/noise.js';
import {sector, trackPos, frameAt, makeFrame} from '../js/track.js';
import {ordinaryPlan, buildOrdinaryHarbor} from '../js/ordinary-harbor.js';
import {harborPlan, intersectsEnvelope} from '../js/harbor-plan.js';
let checks=0;
const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
test('30-minute maximum-speed simulation stays ordinary without a condition',()=>{
  const d=new RunDirector(1234,'unbounded');
  for(let second=0;second<=1800;second++) {
    const s=second*30; d.commitThrough(Math.floor((s+490)/L)); d.update(s);
    assert.equal(d.typeAt(Math.floor(s/L)),'ordinary');
  }
  assert.equal(d.events.length,0);
});
test('goal waits; duplicate completion and trigger packets cannot duplicate a room',()=>{
  const d=new RunDirector(1234,'goals');
  d.request('ascent','lift-1',100);assert.equal(d.events[0].phase,'waiting');
  d.update(100000);assert.equal(d.events[0].sector,null);
  d.completeGoal('power',20000);const k=d.events[0].sector;
  for(let i=0;i<50;i++){d.completeGoal('power',20001);d.request('ascent','lift-1',20001);}
  assert.equal(d.events.length,1);assert(k*L>=20000+SAFE_LOOKAHEAD);
});
test('explicit trigger bypasses objectives but respects frozen geometry and spacing',()=>{
  const d=new RunDirector(7,'trigger');d.commitThrough(20);
  d.request('cargo','sensor-1',100,{trigger:true});d.request('ascent','sensor-2',100,{trigger:true});
  assert.equal(d.events[0].sector,21);assert.equal(d.events[1].sector,23);
  assert.equal(d.typeAt(22),'ordinary');
  assert.equal(d.request('invalid','bad',0).ok,false);
});
test('event lifecycle is position-based and never replays on rewind',()=>{
  const d=new RunDirector(1,'phases');d.completeGoal('manifest',0);const s=d.events[0].sector*L;
  assert.equal(d.update(s-241).length,0);
  assert.equal(d.update(s-240)[0].phase,'approaching');
  assert.equal(d.update(s)[0].phase,'active');
  assert.equal(d.update(s+L)[0].phase,'completed');
  assert.equal(d.update(s-10).length,0);assert.equal(d.events[0].phase,'completed');
});
test('late join, stale snapshots, immutable tickets, and atomic invalid-state rejection',()=>{
  const host=new RunDirector(55,'host');host.completeGoal('manifest',300);host.completeGoal('power',300);
  const peer=new RunDirector(55,'peer');peer.commitThrough(10);
  const state=JSON.parse(JSON.stringify(host.snapshot()));
  assert(peer.apply(state).needsRebuild);assert.deepEqual(peer.snapshot(),state);
  assert.equal(peer.apply(state).accepted,false);
  const bad=structuredClone(state);bad.revision++;bad.events[1].sector=bad.events[0].sector;
  assert.equal(peer.apply(bad).accepted,false);assert.deepEqual(peer.snapshot(),state);
  const moved=structuredClone(state);moved.revision++;moved.events[1].sector+=2;
  assert.equal(peer.apply(moved).accepted,false);
  host.update(10000);assert(peer.apply(host.snapshot()).accepted);assert.deepEqual(peer.snapshot(),host.snapshot());
});
test('adding a future ascent preserves all visible rail positions and joins continuously',()=>{
  setSeed(1234);resetRun();const d=getRun(),a=new THREE.Vector3(),b=new THREE.Vector3(),fr=makeFrame();
  const old=[];for(let s=0;s<=2100;s+=13)old.push([s,trackPos(s,a).clone()]);
  d.commitThrough(1);d.completeGoal('power',100);
  for(const [s,p] of old)assert(trackPos(s,a).distanceTo(p)<1e-9);
  const event=d.events[0].sector;assert.equal(sector(event).rise,78);assert.equal(sector(event+1).y0,78);
  for(let k=0;k<12;k++) {
    trackPos((k+1)*L-.001,a);trackPos((k+1)*L+.001,b);assert(a.distanceTo(b)<.003);
    frameAt(k*L+850,fr);assert(Math.abs(fr.T.dot(fr.U))<1e-7);
  }
});
test('host and late peer generate identical tracks and ordinary bay layouts',()=>{
  setSeed(701);resetRun();getRun().completeGoal('power',2000);getRun().completeGoal('manifest',3000);
  const snapshot=getRun().snapshot(),p=new THREE.Vector3();
  const before=Array.from({length:12},(_,k)=>({pos:trackPos(k*L+843,p).toArray(),plan:ordinaryPlan(sector(k))}));
  resetRun();getRun().apply(snapshot);
  const after=Array.from({length:12},(_,k)=>({pos:trackPos(k*L+843,p).toArray(),plan:ordinaryPlan(sector(k))}));
  assert.deepEqual(after,before);
});
let maxTriangles=0, layouts=new Set(), clearanceSamples=0;
test('seeded ordinary geometry is bounded, varied, finite and off the rail; authored ascent clearance holds',()=>{
  for(const seed of [1234,9,73471,98217]) {
    setSeed(seed);resetRun();getRun().completeGoal('power',100);
    for(let k=0;k<12;k++) {
      const c=sector(k),plan=ordinaryPlan(c);layouts.add(JSON.stringify(plan));
      const masses=c.kind==='ordinary'?plan.bays.map(b=>({id:b.id,bounds:[b.x-b.width/2,b.x+b.width/2,b.floor-180,b.height,Math.min(b.front,b.back),Math.max(b.front,b.back)]})):harborPlan(c).masses;
      for(let u=170;u<1000;u+=2) {
        const p=trackPos(k*L+u,new THREE.Vector3());p.x-=k*L;p.y-=c.y0;p.z=(p.z-c.z0)*c.m;
        for(const b of masses)assert(!intersectsEnvelope(b.bounds,p));clearanceSamples++;
      }
      if(c.kind!=='ordinary')continue;
      const group=buildOrdinaryHarbor(c);let n=0;
      assert.equal(group.children.length,4);
      group.traverse(o=>{if(o.geometry){const pos=o.geometry.attributes.position;assert(pos.array.every(Number.isFinite));n+=pos.count/3*(o.isInstancedMesh?o.count:1);o.geometry.dispose();}});
      maxTriangles=Math.max(maxTriangles,n);assert(n<130000,'ordinary sector triangle budget: '+n);
    }
  }
  assert.equal(layouts.size,48);
});
console.log(JSON.stringify({checks,distinctLayouts:layouts.size,clearanceSamples,ordinaryMaxTriangles:maxTriangles,ordinaryDrawCalls:4}));
