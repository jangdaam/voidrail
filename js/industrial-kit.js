import * as THREE from 'three';
import {C,Mesher} from './geo.js';
export const P={concrete:C('#4a5350'),steel:C('#455551'),edge:C('#83928a'),dark:C('#152125'),belt:C('#202b2a'),ochre:C('#9e8959'),rust:C('#806452'),light:C('#c3b799'),glass:C('#526f72'),red:C('#a95038')};
// Append detailed parts into the same static batch; no object/draw-call per bolt or roller.
export function part(M,g,col,x=0,y=0,z=0,rx=0,ry=0,rz=0) {
  const geo=g.index?g.toNonIndexed():g;
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1)));
  const a=geo.attributes.position.array,start=M.p.length;
  for(let i=0;i<a.length;i+=3){M.p.push(M.ox+a[i],M.oy+a[i+1],M.oz+a[i+2]*M.mz);M.c.push(col.r,col.g,col.b);}
  M.fixBoxWinding(start);geo.dispose();if(g!==geo)g.dispose();
}
export function cylinder(M,x,y,z,r,h,col,axis='y',n=20,top=r) {
  part(M,new THREE.CylinderGeometry(top,r,h,n,1),col,x,y,z,axis==='z'?Math.PI/2:0,0,axis==='x'?Math.PI/2:0);
}
export function elbow(M,points,r,col=P.steel) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  part(M,new THREE.TubeGeometry(curve,10,r,12,false),col);
}
export function beveled(M,x,y,z,w,h,d,col,cut=.18) {
  const c=Math.min(cut,w/4,d/4),pts=[[-w/2+c,-d/2],[w/2-c,-d/2],[w/2,-d/2+c],[w/2,d/2-c],[w/2-c,d/2],[-w/2+c,d/2],[-w/2,d/2-c],[-w/2,-d/2+c]];
  const start=M.p.length;
  const tri=(a,b,c)=>{for(const p of [a,b,c]){M.p.push(M.ox+x+p[0],M.oy+y+p[1],M.oz+(z+p[2])*M.mz);M.c.push(col.r,col.g,col.b);}};
  for(let i=0;i<8;i++){const j=(i+1)%8,a=pts[i],b=pts[j];tri([a[0],-h/2,a[1]],[b[0],h/2,b[1]],[b[0],-h/2,b[1]]);tri([a[0],-h/2,a[1]],[a[0],h/2,a[1]],[b[0],h/2,b[1]]);}
  for(let i=1;i<7;i++){tri([pts[0][0],h/2,pts[0][1]],[pts[i+1][0],h/2,pts[i+1][1]],[pts[i][0],h/2,pts[i][1]]);tri([pts[0][0],-h/2,pts[0][1]],[pts[i][0],-h/2,pts[i][1]],[pts[i+1][0],-h/2,pts[i+1][1]]);}
  M.fixBoxWinding(start);
}
export function rail(M,x0,z0,x1,z1,y,height=1.15,postSpacing=7) {
  const len=Math.hypot(x1-x0,z1-z0),n=Math.max(1,Math.ceil(len/postSpacing));
  for(const h of [height,.55])M.pipe(x0,y+h,z0,x1,y+h,z1,.055,P.edge,6);
  for(let i=0;i<=n;i++){const t=i/n;M.box(x0+(x1-x0)*t,y+height/2,z0+(z1-z0)*t,.09,height,.09,P.edge);}
}
export function ladder(M,x,y,z,h) {
  for(const dx of [-.42,.42])M.box(x+dx,y+h/2,z,.08,h,.1,P.edge);
  for(let yy=.3;yy<h;yy+=.42)M.box(x,y+yy,z,.86,.06,.1,P.edge);
}
export function column(M,x,z,top,bottom=-240,width=2) {
  M.box(x,(top+bottom)/2,z,width,top-bottom,width,P.steel);
  M.box(x,top-.4,z,width+1,.8,width+1,P.edge);
  M.box(x,bottom+.3,z,width+1.4,.6,width+1.4,P.concrete);
}
export function motor(M,x,y,z,axis='x',r=.8) {
  cylinder(M,x,y,z,r,r*3,P.steel,axis,24);
  for(let i=-2;i<=2;i++){const a=i*r*.34;cylinder(M,x+(axis==='x'?a:0),y,z+(axis==='z'?a:0),r*1.15,.1,P.edge,axis,12);}
  M.box(x,y-r,z,r*2.6,.4,r*2.5,P.steel);
  M.box(x,y+r+.2,z,r*.8,.5,r*.8,P.rust);
}
export function valve(M,x,y,z,r=.8) {
  cylinder(M,x,y,z,r*.55,1.6,P.ochre,'z',16);
  part(M,new THREE.TorusGeometry(r,.09,6,24),P.rust,x,y,z-1);
  for(let i=0;i<3;i++){const a=i*Math.PI/3;M.pipe(x-Math.cos(a)*r,y-Math.sin(a)*r,z-1,x+Math.cos(a)*r,y+Math.sin(a)*r,z-1,.06,P.edge,6);}
}
export function crate(M,x,y,z,w=6,h=3,d=3.4) {
  beveled(M,x,y+h/2,z,w,h,d,P.rust,.18);
  for(const dx of [-w*.36,w*.36])M.box(x+dx,y+h/2,z,.14,h+.08,d+.08,P.edge);
  for(let dx=-w*.3;dx<w*.4;dx+=1)M.box(x+dx,y+h*.5,z-d/2-.025,.08,h*.82,.05,P.dark);
  M.box(x,y+.16,z,w+.2,.32,d+.2,P.dark);
}
export function camera(M,G,x,y,z,sd) {
  M.box(x,y,z,.2,.5,1.8,P.steel);cylinder(M,x,y+.4,z+sd*.7,.18,.6,P.edge);
  beveled(M,x,y+.85,z+sd*.7,1.5,.55,.6,P.edge,.12);
  M.box(x+.1,y+1.17,z+sd*.7,1.8,.09,.8,P.steel);
  cylinder(M,x+.78,y+.84,z+sd*.7,.19,.09,P.dark,'x',20);
  cylinder(G,x+.835,y+.84,z+sd*.7,.085,.015,P.glass,'x',16);
}
export function workLight(M,G,x,y,z,lamps,c) {
  M.box(x,y+3.7,z,.14,7.4,.14,P.steel);
  M.box(x,y+7.4,z-.8,3,.4,2.4,P.steel);G.box(x,y+7.17,z-.8,2.6,.06,1.8,P.light);
  G.box(x,y+7.25,z-2.02,2.6,.18,.035,P.light);
  lamps.push({intensity:240,distance:46,p:new THREE.Vector3(c.k*1400+x,c.y0+y+6.8,c.z0+(z-.8)*c.m),c:P.light});
}
// The conveyor has end drums, idlers, motor, guarded return belt and legs to the deck.
export function conveyor(M,x,y,za,zb,width=5,rollerSpacing=5) {
  const lo=Math.min(za,zb),hi=Math.max(za,zb),len=hi-lo,mid=(lo+hi)/2;
  M.box(x,y+2.5,mid,width,.22,len,P.belt);M.box(x,y+1.2,mid,width,.16,len,P.dark);
  for(const sd of [-1,1]){M.box(x+sd*(width/2+.2),y+2,mid,.22,1.5,len,P.steel);M.box(x+sd*(width/2+.35),y+3,mid,.12,.5,len,P.ochre);}
  for(let z=lo+2;z<hi;z+=rollerSpacing)cylinder(M,x,y+2.1,z,.36,width+.5,P.edge,'x',12);
  for(let z=lo+2;z<hi;z+=12){for(const sd of [-1,1])M.box(x+sd*(width/2+.2),y+1,z,.28,2,.28,P.steel);M.box(x,y+.2,z,width+1,.3,1,P.steel);}
  for(const z of [lo,hi])cylinder(M,x,y+2.1,z,.65,width+.5,P.edge,'x',20);
  motor(M,x+width/2+1.4,y+2,lo,'x',.65);
  M.box(x+width/2+1,y+.6,lo,3,.4,3,P.steel);
}
export function crane(M,G,b) {
  const {x,floor:y,front,back,sd,width:w}=b,zc=(front+back)/2,h=25+b.index%3*4;
  const zA=front+sd*5,zB=back-sd*5;
  for(const z of [zA,zB]){
    M.box(x,y+h,z,w*.8,1.4,1.8,P.steel);M.box(x,y+h+.8,z,w*.8,.18,.6,P.edge);
    for(const dx of [-w*.35,w*.35]){
      column(M,x+dx,z,y+h,y-160,1.6);
      M.pipe(x+dx,y+h-10,z,x+dx+(dx<0?8:-8),y+h,z,.4,P.edge,8);
    }
  }
  // Twin box girders with triangular web braces, end trucks and a visible winch drum.
  for(const dx of [-2.8,2.8]){
    M.box(x+dx,y+h+2,zc,1.2,3.2,Math.abs(zB-zA)+4,P.ochre);
    for(let z=Math.min(zA,zB);z<Math.max(zA,zB)-5;z+=6)M.pipe(x+dx,y+h+.5,z,x+dx,y+h+3.5,z+6,.18,P.edge,6);
  }
  for(const z of [zA,zB]){beveled(M,x,y+h+1,z,12,2,3,P.steel);for(const dx of [-4,4])cylinder(M,x+dx,y+h,z,.75,1.1,P.dark,'z',16);}
  beveled(M,x,y+h+3,zc,9,2,7,P.steel);cylinder(M,x,y+h+5,zc,1.3,5,P.edge,'x',24);motor(M,x+3.5,y+h+5,zc,'x',.8);
  const hookY=y+8;
  for(const dx of [-1.4,1.4])M.pipe(x+dx,hookY+2,zc,x+dx,y+h+4,zc,.075,P.dark,6);
  beveled(M,x,hookY+1.6,zc,3,1.8,2,P.ochre);
  part(M,new THREE.TorusGeometry(1.1,.22,8,16,Math.PI*1.55),P.edge,x,hookY-.1,zc,0,0,-.5);
  beveled(M,x+7,y+h-2,zA+sd*4,3.6,3.2,3.6,P.steel);
  G.box(x+7,y+h-1.7,zA+sd*2.15,2.7,1.2,.08,P.glass);
  ladder(M,x-w*.35,y,zA+sd*1.1,h);
}
