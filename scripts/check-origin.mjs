import assert from 'node:assert/strict';
import {RoomOrigin} from '../js/net/room-origin.js';
// A late incumbent offer must defeat a fresh host even if another newcomer was heard first.
const origin=new RoomOrigin('new-b',0);
assert(origin.offer({id:'new-a',age:80},100));
assert(origin.offer({id:'established-z',age:120000},150));
assert.equal(origin.accepts({id:'new-a'}),false);
assert.equal(origin.accepts({id:'established-z'}),true);
assert.equal(origin.offer({id:'new-0',age:100},300),false);
// All possible arrival orders of three peer introductions converge to the incumbent world.
const offers=[{id:'new-a',age:100},{id:'new-b',age:80},{id:'established-z',age:120000}];
function permutations(xs){return xs.length===0?[[]]:xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>i!==j)).map(t=>[x,...t]));}
for(const seq of permutations(offers)) {const r=new RoomOrigin('new-c',0);for(const o of seq)r.offer(o,100);assert.equal(r.id,'established-z');}
assert.equal(origin.offer({id:'bad',age:NaN},400),false);
console.log('PASS established world survives newcomer host election and reordered introductions');
