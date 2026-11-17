// Authored spaces with bounded procedural variation; all coordinates are sector-local.
export const HARBOR_BEATS = [
  { id: 'cleft', start: 170, end: 340, label: '건물 사이 협곡' },
  { id: 'receiving', start: 340, end: 700, label: '중앙 하역장' },
  { id: 'ascent', start: 700, end: 930, label: '상부 연결선' },
  { id: 'overlook', start: 930, end: 1000, label: '하역장 전망 회랑' },
];

export function harborPlan(c) {
  const far = 8 + c.width;
  const variant = c.k % 3;
  // Only depth/height vary. Track openings, crane envelope and belt terminals stay fixed.
  const masses = [
    { id:'entry-abutment', bounds:[176,256,-1000,280,46,118], finish:'concrete' },
    { id:'entry-crown', bounds:[240,326,28,69,18,146], finish:'concrete' },
    { id:'deep-processing-block', bounds:[306,392,-1100,318+variant*28,144,far-28], finish:'concrete' },
    { id:'suspended-service-block', bounds:[406,478,126,205+variant*16,58,174], finish:'steel' },
    { id:'receiving-left', bounds:[650,682,-760,188,far-26,far], finish:'concrete' },
    { id:'receiving-right', bounds:[718,746,-760,188,far-26,far], finish:'concrete' },
    { id:'receiving-header', bounds:[682,718,39,188,far-26,far], finish:'concrete' },
    { id:'receiving-sill', bounds:[682,718,-760,18,far-26,far], finish:'concrete' },
    { id:'lift-core', bounds:[792,826,-1100,510,far-118,far-85], finish:'concrete' },
    { id:'upper-overhang', bounds:[842,932,c.rise+22,c.rise+106,18,132], finish:'steel' },
    { id:'upper-abutment', bounds:[854,920,-1100,c.rise+22,122,150], finish:'concrete' },
  ];
  return { far, variant, masses, receiving:{x:700,y:22,z:far-32}, staging:{x:620,y:-12,z:150}, beats:HARBOR_BEATS };
}

// Broad-phase envelope for the entire train plus railings and a safety margin.
export function intersectsEnvelope(bounds, p, halfWidth=7, below=2, above=9) {
  const [x0,x1,y0,y1,z0,z1]=bounds;
  return p.x>=x0-2 && p.x<=x1+2 && p.y+above>y0 && p.y-below<y1 && p.z+halfWidth>z0 && p.z-halfWidth<z1;
}
