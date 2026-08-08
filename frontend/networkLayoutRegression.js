'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const engine=require('../backend/simEngine');
const topology=require('./topology-layout');

const meta=engine.meta('zh');
const defaultPositions=JSON.parse(JSON.stringify(meta.positions));
const nodeRadius=key=>meta.majorKeys.includes(key)?22:17.6;
const layoutInput=(seedKeys)=>({
  nodes:meta.defs.map(def=>({key:def.key,radius:nodeRadius(def.key),position:meta.positions[def.key]})),
  edges:meta.edges,
  seedKeys,
  width:920,
  height:580
});
function assertStressLayout(seedKeys,label){
  const first=topology.computeTopologyLayout(layoutInput(seedKeys));
  const second=topology.computeTopologyLayout(layoutInput(seedKeys));
  assert(first,`${label} must produce a layout`);
  assert.deepStrictEqual(first,second,`${label} layout must be deterministic`);
  assert.deepStrictEqual(Object.keys(first.positions).sort(),Object.keys(meta.positions).sort(),`${label} must preserve every node`);

  const normalizedByLayer={};
  const keys=Object.keys(first.positions);
  keys.forEach((key,index)=>{
    const position=first.positions[key];
    assert(position.every(Number.isFinite),`${label}: ${key} must have finite coordinates`);
    const radius=nodeRadius(key);
    assert(position[0]>=42+radius && position[0]<=920-42-radius,`${label}: ${key} must remain within horizontal bounds`);
    assert(position[1]>=42+radius+7 && position[1]<=580-42-radius-26,`${label}: ${key} must remain within vertical bounds`);
    const normalizedRadius=Math.hypot((position[0]-460)/396,(position[1]-286)/204);
    const distance=first.distances[key];
    (normalizedByLayer[distance]||(normalizedByLayer[distance]=[])).push(normalizedRadius);
    for(let otherIndex=index+1;otherIndex<keys.length;otherIndex+=1){
      const other=keys[otherIndex];
      const otherPosition=first.positions[other];
      const dx=position[0]-otherPosition[0];
      const dy=position[1]-otherPosition[1];
      const gap=Math.hypot(dx,dy)-nodeRadius(key)-nodeRadius(other);
      assert(gap>=8,`${label}: ${key} and ${other} must not overlap`);
      const footprintDistance=Math.hypot(
        dx/(nodeRadius(key)+nodeRadius(other)+12),
        dy/(nodeRadius(key)+nodeRadius(other)+32)
      );
      assert(footprintDistance>=.995,`${label}: ${key} and ${other} labels must remain visually separated`);
    }
  });
  const layerMeans=Object.entries(normalizedByLayer)
    .sort((a,b)=>Number(a[0])-Number(b[0]))
    .map(([,values])=>values.reduce((sum,value)=>sum+value,0)/values.length);
  layerMeans.forEach((mean,index)=>{
    if(index) assert(mean>layerMeans[index-1],`${label}: topology layers must move progressively outward`);
  });
  return first;
}

{
  const session=engine.createSession('zh');
  const snapshot=engine.snapshot(session);
  assert.strictEqual(topology.disturbanceDescriptor(snapshot,meta),null,'baseline must not offer topology layout');

  session.state.map=.08;
  const mildSnapshot=engine.snapshot(session);
  assert.strictEqual(topology.disturbanceDescriptor(mildSnapshot,meta),null,'minor numerical drift must not offer topology layout');

  engine.setControl(session,'map',45);
  const intervention=topology.disturbanceDescriptor(engine.snapshot(session),meta);
  assert(intervention,'manual intervention should offer topology layout');
  assert.deepStrictEqual(intervention.seedKeys,['map']);
  assert.strictEqual(intervention.source,'intervention');
}

let hemorrhageDescriptor;
{
  const session=engine.createSession('zh');
  engine.applyScenario(session,'hemorrhage');
  const snapshot=engine.snapshot(session);
  assert(snapshot.scenarioAffectedKeys.includes('bloodVolume'),'snapshot must expose actual scenario roots');
  hemorrhageDescriptor=topology.disturbanceDescriptor(snapshot,meta);
  assert(hemorrhageDescriptor,'disease should offer topology layout immediately');
  assert.strictEqual(hemorrhageDescriptor.source,'scenario');
  assert(hemorrhageDescriptor.seedKeys.includes('bloodVolume'));
}

{
  const session=engine.createSession('zh');
  engine.applyScenario(session,'random');
  const snapshot=engine.snapshot(session);
  assert.strictEqual(snapshot.scenarioAffectedKeys.length,4,'random disturbance must expose its four runtime roots');
  const descriptor=topology.disturbanceDescriptor(snapshot,meta);
  assert(descriptor,'random disturbance should offer topology layout immediately');
  assert.deepStrictEqual(new Set(descriptor.seedKeys),new Set(snapshot.scenarioAffectedKeys));
}

{
  const first=topology.computeTopologyLayout(layoutInput(hemorrhageDescriptor.seedKeys));
  const second=topology.computeTopologyLayout(layoutInput(hemorrhageDescriptor.seedKeys));
  assert(first,'valid disturbance graph should produce a layout');
  assert.deepStrictEqual(first,second,'same disturbance must produce a deterministic layout');
  assert.deepStrictEqual(meta.positions,defaultPositions,'layout calculation must not mutate default positions');
  assert.deepStrictEqual(Object.keys(first.positions).sort(),Object.keys(meta.positions).sort(),'layout must preserve every node');

  Object.entries(first.positions).forEach(([key,position])=>{
    assert(position.every(Number.isFinite),`${key} must have finite coordinates`);
    const radius=nodeRadius(key);
    assert(position[0]>=42+radius && position[0]<=920-42-radius,`${key} must remain within horizontal bounds`);
    assert(position[1]>=42+radius+7 && position[1]<=580-42-radius-26,`${key} must remain within vertical bounds`);
  });

  const keys=Object.keys(first.positions);
  keys.forEach((key,index)=>{
    for(let otherIndex=index+1;otherIndex<keys.length;otherIndex+=1){
      const other=keys[otherIndex];
      const a=first.positions[key];
      const b=first.positions[other];
      const distance=Math.hypot(a[0]-b[0],a[1]-b[1]);
      assert(distance>=nodeRadius(key)+nodeRadius(other)+8,`${key} and ${other} must not overlap`);
    }
  });

  hemorrhageDescriptor.seedKeys.forEach(key=>{
    assert.strictEqual(first.distances[key],0,`${key} must occupy the disturbance layer`);
  });
  assert(Object.values(first.distances).every(Number.isFinite),'all connected nodes must receive a topology distance');
}

{
  Object.keys(meta.scenarios).forEach(name=>{
    const session=engine.createSession('zh');
    engine.applyScenario(session,name);
    const descriptor=topology.disturbanceDescriptor(engine.snapshot(session),meta);
    assert(descriptor,`${name} must expose a computable disturbance`);
    assertStressLayout(descriptor.seedKeys,`scenario ${name}`);
  });

  meta.defs.forEach(def=>assertStressLayout([def.key],`single seed ${def.key}`));

  const allKeys=meta.defs.map(def=>def.key);
  const crowdedManualRoots=[
    ['ventilation','sodium','venousReturn','bicarbonate','adh','contractility','potassium','rhythmStability','angII','vagal'],
    ['contractility','paO2','aldosterone','hr','insulin','map','vagal','sodium','tissueO2','renin']
  ];
  crowdedManualRoots.forEach((seeds,index)=>assertStressLayout(seeds,`crowded manual roots ${index+1}`));
  for(let size=2;size<=10;size+=1){
    for(let offset=0;offset<5;offset+=1){
      const seeds=Array.from({length:size},(_value,index)=>allKeys[(offset+index*7)%allKeys.length]);
      assertStressLayout(seeds,`manual roots size ${size} sample ${offset+1}`);
    }
  }

  const randomPool=['bloodVolume','ventilation','airway','glucose','tpr','sodium','potassium','insulin','metDemand'];
  for(let a=0;a<randomPool.length-3;a+=1){
    for(let b=a+1;b<randomPool.length-2;b+=1){
      for(let c=b+1;c<randomPool.length-1;c+=1){
        for(let d=c+1;d<randomPool.length;d+=1){
          const seeds=[randomPool[a],randomPool[b],randomPool[c],randomPool[d]];
          assertStressLayout(seeds,`random roots ${seeds.join(',')}`);
        }
      }
    }
  }
}

{
  const simulator=fs.readFileSync(path.join(__dirname,'simulator.html'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
  assert(simulator.includes('id="topologyNetworkLayout"'),'network title must contain the topology button');
  assert(simulator.includes('失衡机制视图'),'the Chinese layout action must use the clinician-facing mechanism-view label');
  assert(simulator.includes('恢复网络视图'),'the reset action must clearly restore the network view');
  assert(simulator.includes('aria-controls="network"'),'layout buttons must identify the network they control');
  assert(simulator.includes('role="status" aria-live="polite"'),'layout completion feedback must be announced');
  assert(simulator.indexOf('topology-layout.js')<simulator.indexOf('app.js'),'topology engine must load before the application');
  // System captions are suppressed in topology mode, and since 2026-07-31 also while a guided
  // lesson has cut the network down to one loop, where they would label mostly empty space.
  assert(app.includes('if(!networkTopologyLayoutActive && !visibleNodeKeys()){'),
    'system labels must be conditional in topology mode and in the single-loop lesson view');
  assert(app.includes("networkTopologyLayoutActive=false;"),'reset must leave topology mode');
  assert(app.includes('clearNetworkTopologyLayoutImmediately();'),'restarting a session must restore the system layout');
  assert(app.includes('function networkContentBounds(contentPositions=networkNodePositions || meta?.positions'),'viewBox bounds must accept interpolated nodes during layout transitions');
  assert(app.includes('setNetworkLayoutTransitionViewBox(from,target);'),'topology transitions must use one stable union viewBox');
  assert(app.includes('setNetworkLayoutTransitionViewBox(nodeFrom,networkDefaultPositions);'),'layout reset must use one stable union viewBox');
  assert(app.includes('if(networkLayoutTransitionViewBox && networkViewBox===networkLayoutTransitionViewBox) return networkViewBox;'),'stable transition viewBox must avoid per-frame SVG geometry writes');
  assert(app.includes('scheduleNetworkFitBurst(true);'),'layout reset must refit and recenter the restored network');
  assert(app.includes('if(networkPointerDrag?.dragged) return networkViewBox;'),'dragging must keep the network viewBox stable');
}

console.log('network topology layout regression passed');
