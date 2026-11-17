import assert from 'node:assert/strict';
import {LocalTransport} from '../js/net/transport.js';
globalThis.addEventListener=()=>{};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const room='director-test-'+Date.now();
const a=new LocalTransport({lag:120,jitter:0}), b=new LocalTransport({lag:120,jitter:0});
let join=0,leave=0,late=0, helloA=0, helloB=0;
a.on('join',id=>a.sendRel('hello',{name:'A'},id));
a.on('rel',(id,type)=>{if(type==='hello')helloA++;});
b.on('join',id=>{join++;b.sendRel('hello',{name:'B'},id);});b.on('leave',()=>leave++);b.on('rel',(id,type)=>{if(type==='hello')helloB++;else late++;});b.on('fast',()=>late++);
try {
  await a.join(room);await b.join(room);await wait(180);
  assert.equal(helloA,1,'new peer receives initial state before heartbeat');assert.equal(helloB,1);
  assert.equal(join,1);a.sendRel('train',{run:{}});a.sendFast(new ArrayBuffer(1));
  await wait(25);await a.leave();await wait(180);
  assert.equal(join,1,'late packets must not resurrect departed peers');
  assert.equal(leave,1);assert.equal(late,0);assert.equal(b.peers().length,0);
  // Locally queued deliveries are also cancelled when this tab itself leaves.
  b.seen.set('other',performance.now());b.recv({from:'other',k:'rel',t:'train',d:{}});
  await b.leave();await wait(150);assert.equal(late,0);
  console.log('PASS local transport initial handshake and cancellation of delayed packets on leave');
} finally {if(a.active)await a.leave();if(b.active)await b.leave();}
