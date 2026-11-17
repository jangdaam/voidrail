import * as THREE from 'three';
import { C, Mesher, glowMat, landMat } from './geo.js';
import { harborPlan } from './harbor-plan.js';
import { SECTOR } from './track.js';

const concrete=C('#434d4c'), edge=C('#64706b'), steel=C('#263236'), dark=C('#10191c');
const ochre=C('#9b8654'), rust=C('#695144'), warm=C('#8f8570'), cold=C('#607d7c');

// A single batched structural mesh and a single emission mesh per sector.
export function buildHarbor(c) {
  const plan=harborPlan(c), {far,masses}=plan;
  const M=new Mesher(c.k*SECTOR,c.y0,c.z0,c.m), G=new Mesher(c.k*SECTOR,c.y0,c.z0,c.m);
  for(const b of masses) {
    const [x0,x1,y0,y1,z0,z1]=b.bounds;
    M.span(x0,x1,y0,y1,z0,z1,b.finish==='steel'?steel:concrete);
    // Recessed vertical cuts replace an all-over facade grid.
    for(const x of [x0+5,x1-7]) M.box(x,(Math.max(y0,-360)+y1)/2,z0-.3,1.6,y1-Math.max(y0,-360),.6,dark);
    M.box((x0+x1)/2,y1-5,z0-1,x1-x0+2,3,2,edge);
  }
  // The entering rail is squeezed between two very different scales of architecture.
  for(const x of [183,222]) {
    M.box(x,9,45.4,3.5,16,1.2,steel);
    M.box(x,2,44.3,5,1,3,edge);
    M.box(x,6.8,44.6,1.3,2.2,.2,dark); // human-scale service door
  }
  M.box(246,26,79,8,4,115,steel);
  for(const z of [32,61,93]) M.box(280,25,z,78,2,2,steel);
  // Lit slit is one readable opening, not a field of luminous dots.
  M.box(255.8,21,70,.6,9,25,dark);
  G.box(256.15,22,70,.06,5,18,warm);
  for(const z of [63,70,77]) M.box(256.25,22,z,.3,5,.3,steel);

  // Process spine: a dock beneath the hoist joins the belt's loading hopper.
  M.box(641.5,-13,150,121,2,38,concrete);
  M.box(641.5,-16,134,121,4,2,steel);
  for(const x of [586,624,660,697]) M.box(x,-270,150,5,510,6,concrete);
  for(const z of [132,168]) {
    M.box(641.5,-10.8,z,121,.12,.12,edge);
    for(let x=586;x<=700;x+=8) M.box(x,-11.4,z,.12,1.2,.12,edge);
  }
  // Compact freight stacks leave a clear path beneath the hook and into the conveyor.
  for(const [x,z,n] of [[605,143,2],[622,156,1],[642,144,2],[663,158,1]]) {
    for(let j=0;j<n;j++) {
      M.box(x,-10+j*4,z,10,4,6,rust);
      for(const dx of [-3.5,3.5]) M.box(x+dx,-10+j*4,z,.25,4.1,6.1,edge);
    }
  }
  M.box(699,-10.2,139,12,.8,20,steel); // hopper-to-dock apron
  for(const x of [605,654]) {
    M.box(x,-5,166,.3,14,.3,steel);
    M.box(x,2.2,164,4,.6,4,steel);
    G.box(x,1.86,164,3,.08,2,warm);
  }
  // Belt terminal enters a deep, partly open industrial shutter.
  M.box(700,28,far-3,35,21,2,dark);
  G.box(700,28,far-4.1,28,12,.1,warm);
  for(let y=34;y<40;y+=1.2) M.box(700,y,far-26.3,35,.8,1,steel);
  for(const x of [681,719]) M.box(x,28,far-27,1.5,23,2,ochre);
  M.box(700,18.6,far-28,38,1.2,12,steel);
  // Dock apron for the existing moving lift, and a separate access bridge.
  M.box(760,18.5,far-23,20,2,28,steel);
  M.box(778,18.5,far-42,32,2,5,steel);
  for(const x of [750,770]) M.box(x,23,far-10,.4,8,.4,edge);
  M.box(760,27,far-10,20,.4,.4,edge);
  // Lift motor/ventilation core: vertical form is visible both before and after ascent.
  for(let j=0;j<9;j++) M.box(809,91+j*3,far-119,22,1.4,2,steel);
  G.box(809,131,far-118.8,17,.7,.1,cold);
  M.box(806,4,far-121,22,2,7,steel);

  // Large ducts join buildings. Floor-to-floor connections explain the overhangs.
  for(const z of [158,174]) {
    M.pipe(392,88,z,486,88,z,5,steel,20);
    M.pipe(486,88,z,486,47,z,5,steel,20);
    M.box(486,47,z,13,12,13,steel);
    for(let x=402;x<478;x+=25) M.pipe(x,88,z,x+1,88,z,5.7,edge,20);
  }
  // Asymmetric elevated bridge over the ascent; no objects within the rail envelope.
  M.box(880,c.rise+20,77,76,4,110,concrete);
  M.box(918,c.rise+13,76,4,10,108,steel);
  for(const x of [851,906]) M.box(x,c.rise+21,74,2,2,106,edge);
  // Depth anchors well below the route: lit service slots and overlapping slabs.
  for(const [x,y,z,w,d] of [[270,-175,94,150,40],[470,-292,210,200,70],[855,-120,190,110,44]]) {
    M.box(x,y,z,w,10,d,concrete);
    M.box(x,y+14,z+d/2-1,w*.62,24,3,dark);
    G.box(x,y+15,z+d/2-2,w*.53,3,.1,cold);
    for(const dx of [-w*.36,w*.36]) M.box(x+dx,y-230,z,9,450,12,concrete);
  }
  const group=new THREE.Group();
  for(const mesh of [M.build(),G.build(glowMat)]) if(mesh){mesh.updateMatrix();group.add(mesh);}
  // Three restrained loads share one mesh and move into the receiver opening.
  const B=new Mesher();B.box(0,0,0,5,3.5,4.5,rust);
  for(const dx of [-1.7,1.7])B.box(dx,0,0,.2,3.7,4.7,edge);
  const template=B.build();
  const freight=new THREE.InstancedMesh(template.geometry,landMat,3);
  freight.frustumCulled=false;
  group.add(freight);
  group.userData.freight={mesh:freight,c,from:137,to:far-10,slope:32/(far-32-128),matrix:new THREE.Matrix4()};
  group.userData.plan=plan;
  animateHarbor(group,0);
  return group;
}

export function animateHarbor(group,t) {
  const d=group.userData.freight;if(!d)return;
  const len=d.to-d.from;
  for(let i=0;i<3;i++) {
    const z=d.from+((t*.85+i*len/3)%len);
    const y=-10+(z-128)*d.slope+2.15;
    d.matrix.makeTranslation(d.c.k*SECTOR+700,d.c.y0+y,d.c.z0+z*d.c.m);
    d.mesh.setMatrixAt(i,d.matrix);
  }
  d.mesh.instanceMatrix.needsUpdate=true;
}
