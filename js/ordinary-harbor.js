import * as THREE from 'three';
import {Mesher,glowMat,landMat} from './geo.js';
import {mulberry,getSeed} from './noise.js';
import {SECTOR,trackPos,frameAt,makeFrame,routeZ,routeY} from './track.js';
import {P,part,cylinder,elbow,beveled,rail,ladder,column,motor,valve,crate,camera,workLight,conveyor,crane} from './industrial-kit.js';

// Plan the rail first, reserve its sweep, then grow connected working decks on BOTH banks.
export function ordinaryPlan(c) {
  const r=mulberry(getSeed()^Math.imul(c.k+19,2654435761)),far=8+c.width,bays=[];
  for(let i=0;i<4;i++) {
    const x=250+i*185+(r()-.5)*24,width=120+r()*24;
    const samples=Array.from({length:41},(_,j)=>x-width/2-12+(width+24)*j/40);
    const zs=samples.map(u=>routeZ(c,u)),ys=samples.map(u=>routeY(c,u));
    for(const sd of [-1,1]) {
      const front=sd>0?Math.max(...zs)+15:Math.min(...zs)-15,back=sd>0?far-14:18;
      if((back-front)*sd<34)continue;
      const floor=Math.min(...ys)-6;
      bays.push({id:'bay-'+i+'-'+sd,index:i,x,width,front,back,sd,depth:Math.abs(back-front),floor,height:floor+145+r()*185,type:['cargo','process','sorting'][(i+(sd<0?1:0)+Math.floor(r()*2))%3]});
    }
  }
  const links=bays.flatMap(b=>[
    {from:'rail',to:b.id,kind:'stairs',x:b.x,za:routeZ(c,b.x)+b.sd*3.7,zb:b.front+b.sd*3,ya:routeY(c,b.x),yb:b.floor},
    {from:b.id,to:b.sd>0?'east-gallery':'west-gallery',kind:'riser',x:b.x,za:b.back,zb:b.back,ya:b.floor,yb:-32}
  ]);
  return {far,bays,links,route:c.route,crossings:[430,770]};
}
function accessStairs(M,l) {
  const count=Math.max(8,Math.ceil(Math.abs(l.yb-l.ya)/.3)),dz=(l.zb-l.za)/count;
  for(let i=0;i<count;i++) {
    const t=(i+.5)/count,y=l.ya+(l.yb-l.ya)*t,z=l.za+dz*(i+.5);
    M.box(l.x,y-.15,z,3.2,.3,Math.abs(dz)+.03,P.edge);
  }
  for(const dx of [-1.5,1.5]) {
    M.pipe(l.x+dx,l.ya-.5,l.za,l.x+dx,l.yb-.5,l.zb,.15,P.steel,8);
    M.pipe(l.x+dx,l.ya+1.1,l.za,l.x+dx,l.yb+1.1,l.zb,.055,P.edge,6);
    for(let i=0;i<=4;i++){const t=i/4;M.box(l.x+dx,l.ya+(l.yb-l.ya)*t+.5,l.za+(l.zb-l.za)*t,.08,1.2,.08,P.edge);}
  }
}
// Static floor illumination is baked into vertex colors; it costs no extra lights.
function floorWash(M,x,y,z,sd) {
  const col=(dx,dz)=>P.concrete.clone().lerp(P.light,.65*Math.pow(Math.max(0,1-Math.hypot(dx/14,dz/9)),1.4));
  const v=(dx,dz)=>{const c=col(dx,dz);M.p.push(M.ox+x+dx,M.oy+y+.015,M.oz+(z+sd*dz)*M.mz);M.c.push(c.r,c.g,c.b);};
  const start=M.p.length;
  for(let dx=-14;dx<14;dx+=3.5)for(let dz=-9;dz<9;dz+=3){
    const a=[dx,dz],b=[dx+3.5,dz],c=[dx+3.5,dz+3],d=[dx,dz+3];
    for(const p of sd>0?[a,c,b,a,d,c]:[a,b,c,a,c,d])v(...p);
  }
  M.fixBoxWinding(start);
}
export function* ordinaryHarborSteps(c) {
  const plan=ordinaryPlan(c),{far,bays}=plan;
  const M=new Mesher(c.k*SECTOR,c.y0,c.z0,c.m),G=new Mesher(c.k*SECTOR,c.y0,c.z0,c.m),lamps=[],belts=[];
  const bound=[];
  M.span(110,1012,-1600,1800,-4,8,P.concrete);M.span(110,1012,-1600,1800,far,far+12,P.concrete);
  for(const x of [110,1000]) {
    const z=routeZ(c,x),y=routeY(c,x);
    M.span(x,x+8,-1600,y-1.4,8,far,P.concrete);M.span(x,x+8,y+9,1800,8,far,P.concrete);
    if(z-10>8)M.span(x,x+8,y-1.4,y+9,8,z-10,P.concrete);
    M.span(x,x+8,y-1.4,y+9,z+10,far,P.concrete);
  }
  // The low service galleries and mains connect every production cell to the same plant.
  for(const [z,sd] of [[13,1],[far-5,-1]]) {
    M.box(555,-33,z,890,2,8,P.steel);rail(M,115,z+sd*3.8,995,z+sd*3.8,-32);
    for(const dy of [-4,-9])M.pipe(115,-32+dy,z,995,-32+dy,z,1.2,P.steel,16);
    for(let x=145;x<995;x+=70) {
      M.box(x,-38,z,.6,12,7,P.steel);M.pipe(x,-42,z-sd*4,x,-33,z+sd*4,.4,P.edge,8);
      for(const dy of [-4,-9])cylinder(M,x,-32+dy,z,1.45,.5,P.edge,'x',16);
    }
  }
  yield;
  for(const b of bays) {
    const {x,width:w,front:f,back:bk,sd,floor:y,depth:d}=b,mid=(f+bk)/2;
    bound.push({id:b.id,bounds:[x-w/2,x+w/2,y-180,b.height,Math.min(f,bk),Math.max(f,bk)]});
    // A deep quay with beams, bracing and continuous bearing columns, not a floating shelf.
    M.box(x,y-1,mid,w,2,d,P.concrete);
    for(const zz of [f+sd*2,bk-sd*2]) {
      M.box(x,y-3,zz,w,4,1.2,P.steel);
      for(const dx of [-w*.42,0,w*.42])column(M,x+dx,zz,y-2,-400,3.2);
      for(const dx of [-w*.42,w*.42])M.pipe(x+dx,y-18,zz,x+dx+(dx<0?13:-13),y-3,zz,.65,P.edge,8);
    }
    for(const dx of [-w*.3,0,w*.3])M.box(x+dx,y-2.4,mid,1.2,2.4,d,P.steel);
    // Front edge has a gap aligned with the access stair, rather than a railing through it.
    rail(M,x-w/2,f,x-2,f,y);rail(M,x+2,f,x+w/2,f,y);
    for(const dx of [-w/2,w/2])rail(M,x+dx,f,x+dx,bk,y);
    for(const dx of [-w*.38,w*.38]){
      M.box(x+dx,y+1.4,f+sd*3,.5,2.8,.5,P.ochre);
      M.box(x+dx,y+.18,f+sd*3,1.2,.35,1.2,P.steel);
    }
    // The building is split around a real receiving mouth. Side piers carry the upper mass.
    const mouth=18,face=bk+sd*1.5,z0=Math.min(bk,bk+sd*14),z1=Math.max(bk,bk+sd*14);
    M.span(x-w/2,x-mouth/2,-700,b.height,z0,z1,P.concrete);M.span(x+mouth/2,x+w/2,-700,b.height,z0,z1,P.concrete);
    M.span(x-mouth/2,x+mouth/2,y+15,b.height,z0,z1,P.concrete);
    M.box(x,y+7,bk+sd*12,mouth,14,.4,P.dark);
    G.box(x,y+12,bk+sd*11.7,14,1.3,.1,P.light);
    for(const dx of [-10,10])M.box(x+dx,y+8,bk-sd*.4,1.2,18,1.2,P.ochre);
    for(let yy=15;yy<24;yy+=1)M.box(x,y+yy,bk-sd*.4,19,.5,.6,P.steel);
    M.box(x,y+25,bk-sd*2,w+3,2,4,P.edge);
    // Anchored upper floors, ducts and small doors give a clear scale hierarchy.
    for(const dy of [48,105]) {
      M.box(x,y+dy,bk-sd*7,w*.82,3,15,P.steel);
      for(const dx of [-w*.32,w*.32])M.pipe(x+dx,y+dy-12,bk,x+dx,y+dy,bk-sd*12,.7,P.edge,8);
      rail(M,x-w*.4,bk-sd*14,x+w*.4,bk-sd*14,y+dy+1.5);
      M.box(x-w*.25,y+dy+3,bk-sd*.5,1.4,2.8,.2,P.dark);
    }
    for(const dx of [-w*.43,w*.43]) {
      M.pipe(x+dx,-32,bk-sd*3,x+dx,y+110,bk-sd*3,2.1,P.steel,20);
      for(const yy of [y+4,y+46,y+91])cylinder(M,x+dx,yy,bk-sd*3,2.4,.6,P.edge,'y',20);
      elbow(M,[[x+dx,-36,sd>0?far-5:13],[x+dx,-36,bk-sd*3],[x+dx,-31,bk-sd*3]],1.2,P.steel);
      cylinder(M,x+dx,y+110.5,bk-sd*3,2.6,1,P.edge,'y',20);
    }
    ladder(M,x+w*.3,-32,bk-sd*1,Math.max(1,y+32));
    // A control cabinet, cable tray, inspection camera and work lights sit close to the rail.
    beveled(M,x-7,y+1.4,f+sd*5,1.7,2.8,1,P.steel,.12);
    G.box(x-7,y+1.9,f+sd*4.45,.9,.5,.06,P.glass);
    M.box(x-6.4,y+1.2,f+sd*4.4,.08,.45,.08,P.edge);
    for(const dx of [-.35,0,.35])cylinder(G,x-7+dx,y+1.25,f+sd*4.4,.055,.06,dx===0?P.red:P.light,'z',10);
    M.box(x-7,y+.14,(f+bk)/2,.5,.25,d,P.steel);
    for(const dx of [-w*.3,w*.3]){workLight(M,G,x+dx,y,f+sd*8,lamps,c);floorWash(M,x+dx,y,f+sd*10,sd); }
    camera(M,G,x+w*.3,y+5.4,f+sd*8,sd);
    if(b.type==='process') {
      for(const dx of [-w*.23,w*.23]) {
        const tx=x+dx,tz=f+sd*18,h=13+(b.index%2)*5;
        cylinder(M,tx,y+h/2+.6,tz,5.4,h,P.steel,'y',28);
        cylinder(M,tx,y+h+1.4,tz,5.4,2,P.edge,'y',28,3.6);
        for(const yy of [y+1,y+h*.5,y+h])cylinder(M,tx,yy,tz,5.55,.45,P.edge,'y',28);
        cylinder(M,tx,y+h+3,tz,1,1.8,P.dark,'y',20);
        ladder(M,tx-5.8,y,tz,h+2);
        M.box(tx,y+.5,tz-sd*8,8,1,4,P.concrete);motor(M,tx,y+2,tz-sd*8,'x',1.2);
        elbow(M,[[tx,y+2,tz-sd*8],[tx+3,y+2,tz-sd*8],[tx+4,y+4,tz]],.65,P.edge);
        M.pipe(tx+4,y+4,tz,tx+4,y+4,bk,1,P.steel,16);valve(M,tx+4,y+4,tz-sd*3,1);
      }
      conveyor(M,x,y,f+sd*4,bk+sd*5,5);belts.push({x,y,za:f+sd*6,zb:bk-sd*4});
    } else {
      conveyor(M,x,y,f+sd*7,bk+sd*5,6);belts.push({x,y,za:f+sd*9,zb:bk-sd*4});
      // Fork pockets, corner bands and ribbed containers distinguish cargo from wall blocks.
      for(const [dx,dz,n] of [[-w*.26,13,2],[w*.26,17,1],[-w*.22,30,1],[w*.3,34,2]])
        for(let j=0;j<n;j++)crate(M,x+dx,y+j*3.2,f+sd*Math.min(dz,d-7),9,3,4.6);
      crane(M,G,b);
    }
    yield;
  }
  for(const l of plan.links.filter(l=>l.kind==='stairs'))accessStairs(M,l);
  // Cross-canyon utility bridges: walls -> bearing towers -> girder -> deck -> railings.
  for(const x of plan.crossings) {
    const y=routeY(c,x)+31;
    for(const z of [18,far-18]){column(M,x,z,y,-450,5);M.box(x,y-2,z,18,4,16,P.concrete);}
    M.box(x,y,(far+8)/2,9,1.4,far-8,P.steel);
    for(const dx of [-4.4,4.4]) {
      M.box(x+dx,y-5,(far+8)/2,.7,1,far-8,P.steel);
      for(let z=12;z<far-8;z+=16)M.pipe(x+dx,y-5,z,x+dx,y-.7,Math.min(far,z+16),.35,P.edge,8);
      rail(M,x+dx,9,x+dx,far,y+.7);
    }
    for(const dx of [-2,2]){M.pipe(x+dx,y+2,8,x+dx,y+2,far,1.15,P.steel,20);for(let z=20;z<far;z+=40)cylinder(M,x+dx,y+2,z,1.35,.4,P.edge,'z',20);}
    // Tall ventilating risers support and join the upper structure, leaving open sky-shaped voids.
    for(const z of [18,far-18]){
      M.pipe(x+8,y-4,z,x+8,880,z,4,P.steel,24);
      M.box(x+8,140,z,16,16,16,P.steel);
    }
  }
  // A lower freight transfer line passes beneath the train and terminates at both banks.
  const lx=586,ly=-39;M.box(lx,ly-1,(far+8)/2,14,2,far-8,P.steel);
  for(const z of [18,far-18])column(M,lx,z,ly-1,-650,6);
  conveyor(M,lx,ly,12,far-4,7,10);
  for(const dx of [-6.5,6.5])rail(M,lx+dx,12,lx+dx,far-4,ly);

  yield;
  // Rail structure follows the actual curve and grade, including the middle of the canyon.
  const W=new Mesher(),fr=makeFrame(),p=new THREE.Vector3();
  for(let u=110;u<1000;u+=10) {
    frameAt(c.k*SECTOR+u+5,fr);trackPos(c.k*SECTOR+u+5,p);
    if(u>=170) {
      W.fbox(p,fr,0,-.7,0,10.4,1.2,7.6,P.steel);
      for(const sd of [-1,1]){
        W.fbox(p,fr,0,-2.5,sd*3.3,10.4,2.5,.6,P.dark);
        W.fbox(p,fr,0,1.05,sd*3.65,10.4,.08,.08,P.edge);W.fbox(p,fr,0,.55,sd*3.65,10.4,.05,.05,P.edge);
        for(const q of [-3.3,0,3.3])W.fbox(p,fr,q,.55,sd*3.65,.08,1.1,.08,P.edge);
      }
      // Cross ties are directly below the deck, not hung in an empty volume.
      if(u%30===20)W.fbox(p,fr,0,-3.6,0,.7,.7,7.6,P.edge);
    }
    if(u%90===20){W.box(p.x,p.y-280,p.z,5,550,6,P.concrete);W.box(p.x,p.y-3.2,p.z,9,3,12,P.steel);}
  }
  yield;
  const group=new THREE.Group();for(const mesh of [M.build(),G.build(glowMat),W.build()])if(mesh){mesh.updateMatrix();group.add(mesh);}
  // Shared cargo geometry gives the belts quiet, continuous motion at one additional draw call.
  const B=new Mesher();crate(B,0,-1,0,3.8,2,2.8);const template=B.build();
  const freight=new THREE.InstancedMesh(template.geometry,landMat,belts.length*2);freight.frustumCulled=false;group.add(freight);
  group.userData={plan,lamps,bounds:bound,freight:{mesh:freight,belts,c,matrix:new THREE.Matrix4()}};
  animateOrdinaryHarbor(group,0);return group;
}
export function animateOrdinaryHarbor(group,t) {
  const d=group.userData.freight;if(!d)return;
  for(let i=0;i<d.belts.length;i++)for(let j=0;j<2;j++){
    const b=d.belts[i],len=Math.abs(b.zb-b.za),p=((t*.9+j*len/2)%len)/len,z=b.za+(b.zb-b.za)*p;
    d.matrix.makeTranslation(d.c.k*SECTOR+b.x,d.c.y0+b.y+3.65,d.c.z0+z*d.c.m);d.mesh.setMatrixAt(i*2+j,d.matrix);
  }
  d.mesh.instanceMatrix.needsUpdate=true;
}

// Synchronous builder for offline geometry verification; runtime advances one bounded step per job.
export function buildOrdinaryHarbor(c){const steps=ordinaryHarborSteps(c);let r;do{r=steps.next();}while(!r.done);return r.value;}
export function ordinaryHarborJobs(c,onComplete){const steps=ordinaryHarborSteps(c);return Array.from({length:ordinaryPlan(c).bays.length+4},()=>()=>{const r=steps.next();if(r.done)onComplete(r.value);});}
