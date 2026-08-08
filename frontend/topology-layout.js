(function(root, factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.HomeostasisTopologyLayout=api;
})(typeof globalThis!=='undefined'?globalThis:this, function(){
  'use strict';

  const DEFAULT_WIDTH=920;
  const DEFAULT_HEIGHT=580;
  const DEFAULT_PADDING=42;
  const DEFAULT_ITERATIONS=260;
  const DEFAULT_CONTROL_THRESHOLD=.5;
  const DEFAULT_DEVIATION_THRESHOLD=28;
  const DEFAULT_MAX_SEEDS=10;
  const DEFAULT_FOOTPRINT_GAP_X=14;
  const DEFAULT_FOOTPRINT_GAP_Y=34;
  const DEFAULT_FOOTPRINT_TOP=7;
  const DEFAULT_FOOTPRINT_BOTTOM=26;

  function finiteNumber(value,fallback=0){
    const number=Number(value);
    return Number.isFinite(number)?number:fallback;
  }
  function clamp(value,min,max){ return Math.max(min,Math.min(max,value)); }
  function unique(values){
    const seen=new Set();
    return (values||[]).filter(value=>{
      if(!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }
  function keyHash(value){
    let hash=2166136261;
    String(value||'').split('').forEach(character=>{
      hash^=character.charCodeAt(0);
      hash=Math.imul(hash,16777619);
    });
    return hash>>>0;
  }
  function edgeEndpoints(edge){
    if(!edge) return [null,null];
    if(Array.isArray(edge)) return [edge[0],edge[1]];
    return [edge.from,edge.to];
  }
  function nodeOrder(meta,snapshot){
    const fromDefs=(meta?.defs||[]).map(def=>def?.key);
    const fromPositions=Object.keys(meta?.positions||{});
    const fromSnapshot=(snapshot?.params||[]).map(parameter=>parameter?.key);
    return unique([...fromDefs,...fromPositions,...fromSnapshot]);
  }
  function validIncidentKeys(meta){
    const valid=new Set(nodeOrder(meta));
    const incident=new Set();
    (meta?.edges||[]).forEach(edge=>{
      const [from,to]=edgeEndpoints(edge);
      if(from!==to && valid.has(from) && valid.has(to)){
        incident.add(from);
        incident.add(to);
      }
    });
    return incident;
  }
  function addCandidate(scores,key,score){
    if(!key || !Number.isFinite(score)) return;
    scores.set(key,Math.max(scores.get(key)||-Infinity,score));
  }
  function disturbanceDescriptor(snapshot,meta,options={}){
    if(!snapshot || !meta) return null;
    const order=nodeOrder(meta,snapshot);
    const orderIndex=new Map(order.map((key,index)=>[key,index]));
    const incident=validIncidentKeys(meta);
    if(order.length<2 || !incident.size) return null;

    const params=snapshot.params||[];
    const paramByKey=new Map(params.map(parameter=>[parameter.key,parameter]));
    const actualScenarioKeys=Array.isArray(snapshot.scenarioAffectedKeys)
      ? snapshot.scenarioAffectedKeys
      : [];
    const staticScenarioKeys=meta.scenarios?.[snapshot.scenarioName]?.affectedKeys||[];
    const scenarioKeys=unique([...actualScenarioKeys,...staticScenarioKeys]).filter(key=>incident.has(key));
    const controlThreshold=finiteNumber(options.controlThreshold,DEFAULT_CONTROL_THRESHOLD);
    const deviationThreshold=finiteNumber(options.deviationThreshold,DEFAULT_DEVIATION_THRESHOLD);
    const maxSeeds=Math.max(1,Math.round(finiteNumber(options.maxSeeds,DEFAULT_MAX_SEEDS)));
    const directScores=new Map();

    scenarioKeys.forEach(key=>{
      const parameter=paramByKey.get(key);
      addCandidate(directScores,key,500+Math.abs(finiteNumber(parameter?.stateBias)));
    });
    params.forEach(parameter=>{
      const magnitude=Math.abs(finiteNumber(parameter?.control));
      if(magnitude>=controlThreshold && incident.has(parameter.key)){
        addCandidate(directScores,parameter.key,400+magnitude);
      }
    });

    const fallbackScores=new Map();
    (snapshot.offenders||[]).forEach(key=>{
      if(incident.has(key)) addCandidate(fallbackScores,key,360+Math.abs(finiteNumber(paramByKey.get(key)?.stateBias)));
    });
    params.forEach(parameter=>{
      if(!incident.has(parameter.key)) return;
      const magnitude=Math.abs(finiteNumber(parameter.stateBias));
      if(parameter.zone==='danger') addCandidate(fallbackScores,parameter.key,320+magnitude);
      else if(parameter.zone==='warn') addCandidate(fallbackScores,parameter.key,260+magnitude);
      else if(magnitude>=deviationThreshold) addCandidate(fallbackScores,parameter.key,180+magnitude);
    });

    const scores=directScores.size?directScores:fallbackScores;
    const seedKeys=[...scores]
      .sort((a,b)=>b[1]-a[1] || (orderIndex.get(a[0])??Infinity)-(orderIndex.get(b[0])??Infinity) || a[0].localeCompare(b[0]))
      .slice(0,maxSeeds)
      .map(([key])=>key);
    if(!seedKeys.length) return null;
    const signature=`${snapshot.scenarioName||'disturbance'}|${seedKeys.slice().sort().join(',')}`;
    return {seedKeys,signature,source:scenarioKeys.length?'scenario':directScores.size?'intervention':'imbalance'};
  }

  function topologyDistances(keys,edges,seedKeys){
    const valid=new Set(keys);
    const adjacency=new Map(keys.map(key=>[key,new Set()]));
    (edges||[]).forEach(edge=>{
      const [from,to]=edgeEndpoints(edge);
      if(from===to || !valid.has(from) || !valid.has(to)) return;
      adjacency.get(from).add(to);
      adjacency.get(to).add(from);
    });
    const distances=Object.fromEntries(keys.map(key=>[key,Infinity]));
    const queue=[];
    unique(seedKeys).forEach(key=>{
      if(!valid.has(key)) return;
      distances[key]=0;
      queue.push(key);
    });
    for(let index=0;index<queue.length;index+=1){
      const key=queue[index];
      const nextDistance=distances[key]+1;
      adjacency.get(key).forEach(neighbor=>{
        if(nextDistance>=distances[neighbor]) return;
        distances[neighbor]=nextDistance;
        queue.push(neighbor);
      });
    }
    const reachable=Object.values(distances).filter(Number.isFinite);
    const disconnectedDistance=(reachable.length?Math.max(...reachable):0)+1;
    keys.forEach(key=>{
      if(!Number.isFinite(distances[key])) distances[key]=disconnectedDistance;
    });
    return {distances,adjacency};
  }

  function computeTopologyLayout(config={}){
    const sourceNodes=Array.isArray(config.nodes)?config.nodes:[];
    const keys=unique(sourceNodes.map(node=>typeof node==='string'?node:node?.key));
    if(keys.length<2) return null;
    const nodeByKey=new Map();
    sourceNodes.forEach((node,index)=>{
      const key=typeof node==='string'?node:node?.key;
      if(!key || nodeByKey.has(key)) return;
      const position=Array.isArray(node?.position)?node.position:[index,0];
      nodeByKey.set(key,{
        key,
        radius:Math.max(8,finiteNumber(node?.radius,18)),
        position:[finiteNumber(position[0],index),finiteNumber(position[1],0)]
      });
    });
    keys.forEach((key,index)=>{
      if(!nodeByKey.has(key)) nodeByKey.set(key,{key,radius:18,position:[index,0]});
    });

    const valid=new Set(keys);
    const edges=(config.edges||[]).map(edge=>{
      const [from,to]=edgeEndpoints(edge);
      return {
        from,
        to,
        weight:clamp(finiteNumber(Array.isArray(edge)?edge[3]:edge?.weight,.5),.05,1.5)
      };
    }).filter(edge=>edge.from!==edge.to && valid.has(edge.from) && valid.has(edge.to));
    const incident=new Set(edges.flatMap(edge=>[edge.from,edge.to]));
    const seedKeys=unique(config.seedKeys).filter(key=>incident.has(key));
    if(!edges.length || !seedKeys.length) return null;

    const width=Math.max(320,finiteNumber(config.width,DEFAULT_WIDTH));
    const height=Math.max(240,finiteNumber(config.height,DEFAULT_HEIGHT));
    const padding=Math.max(24,finiteNumber(config.padding,DEFAULT_PADDING));
    const iterations=Math.max(80,Math.round(finiteNumber(config.iterations,DEFAULT_ITERATIONS)));
    const footprintGapX=Math.max(8,finiteNumber(config.footprintGapX,DEFAULT_FOOTPRINT_GAP_X));
    const footprintGapY=Math.max(18,finiteNumber(config.footprintGapY,DEFAULT_FOOTPRINT_GAP_Y));
    const footprintTop=Math.max(4,finiteNumber(config.footprintTop,DEFAULT_FOOTPRINT_TOP));
    const footprintBottom=Math.max(12,finiteNumber(config.footprintBottom,DEFAULT_FOOTPRINT_BOTTOM));
    const centerX=width/2;
    const centerY=height/2-4;
    const maxRadius=Math.max(...keys.map(key=>nodeByKey.get(key).radius));
    const maxX=Math.max(80,width/2-padding-maxRadius);
    const maxY=Math.max(70,Math.min(
      centerY-padding-maxRadius-footprintTop,
      height-centerY-padding-maxRadius-footprintBottom
    ));
    const {distances}=topologyDistances(keys,edges,seedKeys);
    const maxDistance=Math.max(...keys.map(key=>distances[key]));
    const rings=new Map();
    keys.forEach(key=>{
      const distance=distances[key];
      if(!rings.has(distance)) rings.set(distance,[]);
      rings.get(distance).push(key);
    });

    const ringEntries=[...rings].sort((a,b)=>a[0]-b[0]);
    const outerCircumference=Math.PI*2*Math.sqrt((maxX*maxX+maxY*maxY)/2);
    const ringProgress={};
    let previousProgress=0;
    ringEntries.forEach(([distance,ringKeys],index)=>{
      const densityFloor=ringKeys.length*(maxRadius*2+16)/outerCircumference;
      if(distance===0){
        ringProgress[distance]=ringKeys.length===1?0:clamp(Math.max(.14,densityFloor),.14,.28);
        previousProgress=ringProgress[distance];
        return;
      }
      const base=.30+.70*Math.pow(maxDistance?distance/maxDistance:1,.82);
      const remaining=ringEntries.length-index-1;
      const minimum=previousProgress+.075;
      const maximum=1-remaining*.075;
      ringProgress[distance]=clamp(Math.max(base,densityFloor),minimum,maximum);
      previousProgress=ringProgress[distance];
    });

    const layerBands={};
    ringEntries.forEach(([distance,ringKeys],index)=>{
      const progress=ringProgress[distance];
      if(distance===0){
        layerBands[distance]=ringKeys.length===1
          ? [0,.045]
          : [Math.max(.06,progress-.055),Math.min(progress+.055,(progress+(ringProgress[ringEntries[index+1]?.[0]]??1))/2-.018)];
        return;
      }
      const previous=ringProgress[ringEntries[index-1]?.[0]]??0;
      const next=ringProgress[ringEntries[index+1]?.[0]]??1;
      layerBands[distance]=[
        (previous+progress)/2+.012,
        index===ringEntries.length-1?1:(progress+next)/2-.012
      ];
    });

    const anchor={};
    ringEntries.forEach(([distance,ringKeys])=>{
      ringKeys.sort((a,b)=>{
        const pa=nodeByKey.get(a).position;
        const pb=nodeByKey.get(b).position;
        const aa=Math.atan2(pa[1]-centerY,pa[0]-centerX);
        const ab=Math.atan2(pb[1]-centerY,pb[0]-centerX);
        return aa-ab || keys.indexOf(a)-keys.indexOf(b);
      });
      if(distance===0 && ringKeys.length===1){
        anchor[ringKeys[0]]=[centerX,centerY];
        return;
      }
      const radiusX=maxX*ringProgress[distance];
      const radiusY=maxY*ringProgress[distance];
      const phase=-Math.PI/2+(distance%2?0:Math.PI/Math.max(2,ringKeys.length));
      ringKeys.forEach((key,index)=>{
        const angle=phase+index*Math.PI*2/ringKeys.length;
        anchor[key]=[centerX+Math.cos(angle)*radiusX,centerY+Math.sin(angle)*radiusY];
      });
    });

    const indexByKey=new Map(keys.map((key,index)=>[key,index]));
    const positions=keys.map(key=>anchor[key].slice());
    const velocities=keys.map(()=>[0,0]);
    const forces=keys.map(()=>[0,0]);
    const radii=keys.map(key=>nodeByKey.get(key).radius);
    const collisionDistance=(dx,dy,i,j,extra=0)=>{
      const distance=Math.max(.001,Math.hypot(dx,dy));
      const unitX=dx/distance;
      const unitY=dy/distance;
      const minimumX=radii[i]+radii[j]+footprintGapX+extra;
      const minimumY=radii[i]+radii[j]+footprintGapY+extra;
      return 1/Math.max(.0001,Math.hypot(unitX/minimumX,unitY/minimumY));
    };
    const projectToLayer=index=>{
      const key=keys[index];
      const [minimum,maximum]=layerBands[distances[key]];
      let normalizedX=(positions[index][0]-centerX)/maxX;
      let normalizedY=(positions[index][1]-centerY)/maxY;
      let radius=Math.hypot(normalizedX,normalizedY);
      if(radius<.0001){
        const anchorX=(anchor[key][0]-centerX)/maxX;
        const anchorY=(anchor[key][1]-centerY)/maxY;
        const anchorRadius=Math.hypot(anchorX,anchorY);
        if(anchorRadius>.0001){
          normalizedX=anchorX/anchorRadius;
          normalizedY=anchorY/anchorRadius;
        }else{
          const angle=(keyHash(key)%6283)/1000;
          normalizedX=Math.cos(angle);
          normalizedY=Math.sin(angle);
        }
        radius=0;
      }else{
        normalizedX/=radius;
        normalizedY/=radius;
      }
      const projected=clamp(radius,minimum,maximum);
      positions[index][0]=centerX+normalizedX*projected*maxX;
      positions[index][1]=centerY+normalizedY*projected*maxY;
    };
    const edgeIndexes=edges.map(edge=>({
      a:indexByKey.get(edge.from),
      b:indexByKey.get(edge.to),
      weight:edge.weight
    }));

    for(let iteration=0;iteration<iterations;iteration+=1){
      forces.forEach(force=>{ force[0]=0; force[1]=0; });
      for(let i=0;i<keys.length;i+=1){
        for(let j=i+1;j<keys.length;j+=1){
          let dx=positions[j][0]-positions[i][0];
          let dy=positions[j][1]-positions[i][1];
          let distance=Math.hypot(dx,dy);
          if(distance<.001){
            const angle=(keyHash(`${keys[i]}:${keys[j]}`)%6283)/1000;
            dx=Math.cos(angle);
            dy=Math.sin(angle);
            distance=1;
          }
          const minimum=collisionDistance(dx,dy,i,j,4);
          const collision=distance<minimum?(minimum-distance)*.16:0;
          const repulsion=980/(distance*distance);
          const magnitude=collision+repulsion;
          const fx=dx/distance*magnitude;
          const fy=dy/distance*magnitude;
          forces[i][0]-=fx;
          forces[i][1]-=fy;
          forces[j][0]+=fx;
          forces[j][1]+=fy;
        }
      }
      edgeIndexes.forEach(edge=>{
        const a=edge.a;
        const b=edge.b;
        let dx=positions[b][0]-positions[a][0];
        let dy=positions[b][1]-positions[a][1];
        const distance=Math.max(1,Math.hypot(dx,dy));
        const desired=104-edge.weight*20;
        const layerDifference=Math.abs(distances[keys[a]]-distances[keys[b]]);
        const spring=(distance-desired)*(.012+edge.weight*.012)*(layerDifference===1?1.18:.92);
        const fx=dx/distance*spring;
        const fy=dy/distance*spring;
        forces[a][0]+=fx;
        forces[a][1]+=fy;
        forces[b][0]-=fx;
        forces[b][1]-=fy;
      });
      keys.forEach((key,index)=>{
        const seed=distances[key]===0;
        const anchorStrength=seed ? .115 : .052;
        forces[index][0]+=(anchor[key][0]-positions[index][0])*anchorStrength;
        forces[index][1]+=(anchor[key][1]-positions[index][1])*anchorStrength;
        velocities[index][0]=(velocities[index][0]+forces[index][0])*.72;
        velocities[index][1]=(velocities[index][1]+forces[index][1])*.72;
        const maxStep=1.3+7.2*(1-iteration/iterations);
        const speed=Math.hypot(velocities[index][0],velocities[index][1]);
        if(speed>maxStep){
          velocities[index][0]=velocities[index][0]/speed*maxStep;
          velocities[index][1]=velocities[index][1]/speed*maxStep;
        }
        positions[index][0]=clamp(positions[index][0]+velocities[index][0],padding+radii[index],width-padding-radii[index]);
        positions[index][1]=clamp(positions[index][1]+velocities[index][1],padding+radii[index]+footprintTop,height-padding-radii[index]-footprintBottom);
        projectToLayer(index);
      });
    }

    for(let pass=0;pass<72;pass+=1){
      let moved=false;
      for(let i=0;i<keys.length;i+=1){
        for(let j=i+1;j<keys.length;j+=1){
          let dx=positions[j][0]-positions[i][0];
          let dy=positions[j][1]-positions[i][1];
          let distance=Math.hypot(dx,dy);
          const minimum=collisionDistance(dx,dy,i,j);
          if(distance>=minimum) continue;
          if(distance<.001){
            const angle=(keyHash(`${keys[i]}|${keys[j]}`)%6283)/1000;
            dx=Math.cos(angle);
            dy=Math.sin(angle);
            distance=1;
          }
          const shift=(minimum-distance)/2+.05;
          const ux=dx/distance;
          const uy=dy/distance;
          positions[i][0]=clamp(positions[i][0]-ux*shift,padding+radii[i],width-padding-radii[i]);
          positions[i][1]=clamp(positions[i][1]-uy*shift,padding+radii[i]+footprintTop,height-padding-radii[i]-footprintBottom);
          positions[j][0]=clamp(positions[j][0]+ux*shift,padding+radii[j],width-padding-radii[j]);
          positions[j][1]=clamp(positions[j][1]+uy*shift,padding+radii[j]+footprintTop,height-padding-radii[j]-footprintBottom);
          moved=true;
        }
      }
      keys.forEach((_key,index)=>projectToLayer(index));
      if(!moved) break;
    }

    // Finish with collision safety as the hard constraint. The preceding
    // projection preserves topology bands, but can reintroduce an overlap in a
    // crowded ring. This final pass never projects again, so returned nodes and
    // their value labels end in a readable state while retaining the layered
    // layout's overall ordering.
    for(let pass=0;pass<180;pass+=1){
      let moved=false;
      for(let i=0;i<keys.length;i+=1){
        for(let j=i+1;j<keys.length;j+=1){
          let dx=positions[j][0]-positions[i][0];
          let dy=positions[j][1]-positions[i][1];
          let distance=Math.hypot(dx,dy);
          const minimum=collisionDistance(dx,dy,i,j)+.35;
          if(distance>=minimum) continue;
          if(distance<.001){
            const angle=(keyHash(`${keys[i]}~${keys[j]}`)%6283)/1000;
            dx=Math.cos(angle);
            dy=Math.sin(angle);
            distance=1;
          }
          const shift=(minimum-distance)/2+.05;
          const ux=dx/distance;
          const uy=dy/distance;
          positions[i][0]=clamp(positions[i][0]-ux*shift,padding+radii[i],width-padding-radii[i]);
          positions[i][1]=clamp(positions[i][1]-uy*shift,padding+radii[i]+footprintTop,height-padding-radii[i]-footprintBottom);
          positions[j][0]=clamp(positions[j][0]+ux*shift,padding+radii[j],width-padding-radii[j]);
          positions[j][1]=clamp(positions[j][1]+uy*shift,padding+radii[j]+footprintTop,height-padding-radii[j]-footprintBottom);
          moved=true;
        }
      }
      if(!moved) break;
    }

    return {
      positions:Object.fromEntries(keys.map((key,index)=>[
        key,
        [Math.round(positions[index][0]*10)/10,Math.round(positions[index][1]*10)/10]
      ])),
      distances,
      layerProgress:{...ringProgress},
      seedKeys:seedKeys.slice()
    };
  }

  return {
    disturbanceDescriptor,
    topologyDistances,
    computeTopologyLayout
  };
});
