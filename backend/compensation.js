'use strict';

// Is anything in this patient feeding itself?
//
// A vicious cycle is a homeostatic see-saw that has stopped correcting and started amplifying -
// the loop where compensation has become the disease. They are named explicitly rather than
// discovered by graph search, because the clinically meaningful ones are a small known set and
// a learner needs the loop's name, not an anonymous cycle of edges.
//
// The compensation-timeline ledger that used to live here was removed on 2026-08-01: the panel
// it fed was retired as redundant. Vicious cycles stay because they are still handed to the AI
// report, which names any loop that is currently self-amplifying.

function clip(x,a,b){ return Math.max(a, Math.min(b, x)); }
function pick(entry, lang){ return lang==='en' ? entry.en : entry.zh; }

// ---------------------------------------------------------------------------
// Vicious cycles
// ---------------------------------------------------------------------------
// A homeostatic see-saw that has stopped correcting and started amplifying. These are named
// explicitly rather than discovered by graph search, because the clinically meaningful loops
// are a small known set and a learner needs the loop's name, not an anonymous cycle of edges.
// `severity` is the product-like strength of the links currently carrying the loop, so a loop
// only surfaces once every step in it is actually engaged.

const VICIOUS_CYCLES = [
  {
    id:'shockSpiral',
    zh:'休克螺旋', en:'Shock spiral',
    path:['map','tissueO2','lactate','pH','contractility','co'],
    zhSteps:'低血压 → 组织灌注不足 → 乳酸堆积与酸中毒 → 心肌收缩力下降 → 心排量下降 → 血压更低',
    enSteps:'Hypotension -> inadequate perfusion -> lactate and acidosis -> weaker contraction -> lower output -> lower pressure',
    zhBreak:'打断点：先恢复有效循环量和氧输送。只升压而不解决灌注，会让这个环转得更快。',
    enBreak:'Break it at delivery: restore circulating volume and oxygen delivery. Raising pressure alone, without fixing perfusion, makes the loop turn faster.',
    // The loop has only closed once the heart itself is being hurt - either an anaerobic
    // lactate load or contraction failing despite maximal sympathetic drive. A patient with a
    // low pressure whose contractility and lactate are still intact is in compensated shock,
    // which is a different thing and must not be labelled a spiral.
    strength(c){
      return Math.min(
        clip((78-c.a('map'))/18, 0, 1.6),
        clip((88-c.a('tissueO2'))/24, 0, 1.6),
        Math.max(clip((c.a('lactate')-1.6)/2.2, 0, 1.6), clip((95-c.a('contractility'))/30, 0, 1.6))
      );
    }
  },
  {
    id:'hypoxicLactate',
    zh:'缺氧—乳酸—酸中毒环', en:'Hypoxia-lactate-acidosis loop',
    path:['paO2','tissueO2','lactate','bicarbonate','pH'],
    zhSteps:'氧输送不足 → 无氧糖酵解 → 乳酸滴定 HCO₃⁻ → pH 下降 → 收缩力与血管反应性下降 → 氧输送更差',
    enSteps:'Inadequate oxygen delivery -> anaerobic glycolysis -> lactate titrates HCO3- -> pH falls -> contraction and vascular responsiveness fall -> delivery worsens',
    zhBreak:'打断点：恢复氧输送本身。补 HCO₃⁻ 不能打断这个环——只要缺氧还在，新产生的乳酸会把补进去的缓冲重新吃掉。',
    enBreak:'Break it by restoring oxygen delivery. Giving bicarbonate does not break this loop: while hypoxia persists, new lactate consumes whatever base is added.',
    strength(c){
      return Math.min(
        clip((88-c.a('tissueO2'))/22, 0, 1.6),
        clip((c.a('lactate')-2.5)/2.5, 0, 1.6),
        clip((22-c.a('bicarbonate'))/5, 0, 1.6)
      );
    }
  },
  {
    id:'hyperkalemicArrest',
    zh:'高钾—心律—肾灌注环', en:'Hyperkalaemia-rhythm-renal loop',
    path:['potassium','rhythmStability','co','gfr'],
    zhSteps:'血钾升高 → 心肌电稳定性下降 → 有效心排量下降 → 肾灌注与 GFR 下降 → 排钾更少 → 血钾更高',
    enSteps:'Rising K+ -> falling electrical stability -> lower effective output -> lower renal perfusion and GFR -> less K+ excretion -> higher K+',
    zhBreak:'打断点：先用促 K⁺ 入细胞的手段（胰岛素、纠酸、通气）争取时间，同时恢复灌注与排钾途径。',
    enBreak:'Break it by shifting K+ into cells first (insulin, correcting acidosis, ventilation) to buy time, while restoring perfusion and an excretion route.',
    strength(c){
      return Math.min(
        clip((c.a('potassium')-5.4)/1.2, 0, 1.6),
        clip((95-c.a('rhythmStability'))/22, 0, 1.6),
        clip((78-c.a('gfr'))/30, 0, 1.6)
      );
    }
  },
  {
    id:'alkalosisHypokalemia',
    zh:'碱中毒—低钾自持环', en:'Alkalosis-hypokalaemia self-sustaining loop',
    path:['pH','potassium','bicarbonate'],
    zhSteps:'碱血症 → K⁺ 进入细胞并经肾丢失 → 缺钾促进 H⁺ 排泌与 HCO₃⁻ 重吸收 → 碱中毒被维持',
    enSteps:'Alkalaemia -> K+ moves into cells and is lost renally -> K+ depletion promotes H+ secretion and HCO3- reabsorption -> the alkalosis is sustained',
    zhBreak:'打断点：不补钾，碱中毒就纠正不了。只盯血钾数字而继续过度通气或补碱，钾会被不断推回细胞内。',
    enBreak:'Break it by replacing potassium; without that the alkalosis will not correct. Chasing the potassium number while still hyperventilating or giving base just keeps driving it back into cells.',
    strength(c){
      return Math.min(
        clip((c.a('pH')-7.45)/0.10, 0, 1.6),
        clip((4.0-c.a('potassium'))/0.6, 0, 1.6),
        clip((c.a('bicarbonate')-26)/5, 0, 1.6)
      );
    }
  },
  {
    id:'osmoticDiuresis',
    zh:'高血糖—渗透性利尿—浓缩环', en:'Hyperglycaemia-osmotic diuresis loop',
    path:['glucose','osm','urine','bloodVolume','gfr'],
    zhSteps:'高血糖 → 血浆高渗 → 渗透性利尿 → 容量丢失 → 肾灌注与 GFR 下降 → 葡萄糖排出减少 → 血糖更高',
    enSteps:'Hyperglycaemia -> plasma hyperosmolality -> osmotic diuresis -> volume loss -> lower renal perfusion and GFR -> less glucose excretion -> higher glucose',
    zhBreak:'打断点：先补容量。在容量未恢复前单纯降糖，既降不下来也会加重循环不稳定。',
    enBreak:'Break it with volume first. Lowering glucose before volume is restored neither works well nor is safe for the circulation.',
    strength(c){
      return Math.min(
        clip((c.a('glucose')-12)/6, 0, 1.6),
        clip((c.a('osm')-300)/14, 0, 1.6),
        clip((4.7-c.a('bloodVolume'))/0.8, 0, 1.6)
      );
    }
  },
  {
    id:'co2Narcosis',
    zh:'CO₂ 潴留—呼吸驱动抑制环', en:'CO2 retention-respiratory depression loop',
    path:['paCO2','pH','ventilation'],
    zhSteps:'PaCO₂ 升高 → 酸血症与 CO₂ 麻醉抑制中枢驱动 → 通气进一步下降 → PaCO₂ 更高',
    enSteps:'Rising PaCO2 -> acidaemia and CO2 narcosis depress central drive -> ventilation falls further -> PaCO2 rises further',
    zhBreak:'打断点：机械通气或解除气道阻塞。单纯给氧不能打断这个环，还可能减弱残余的低氧驱动。',
    enBreak:'Break it with ventilatory support or by relieving the obstruction. Oxygen alone does not break this loop and may remove what hypoxic drive remains.',
    strength(c){
      return Math.min(
        clip((c.a('paCO2')-52)/16, 0, 1.6),
        clip((7.32-c.a('pH'))/0.12, 0, 1.6),
        clip((5.4-c.a('ventilation'))/2.2, 0, 1.6)
      );
    }
  },
  {
    id:'volumeLossOliguria',
    zh:'容量丢失—少尿—低灌注环', en:'Volume loss-oliguria-hypoperfusion loop',
    path:['bloodVolume','map','gfr','urine'],
    zhSteps:'有效循环量下降 → 血压与肾灌注下降 → GFR 与尿量下降 → 代谢废物与容量调节能力下降 → 循环进一步恶化',
    enSteps:'Falling effective volume -> lower pressure and renal perfusion -> lower GFR and urine -> less waste clearance and volume control -> circulation deteriorates further',
    zhBreak:'打断点：补充有效循环量并止住丢失。此时“把尿量推上去”是治标——利尿只会让容量更少。',
    enBreak:'Break it by replacing effective volume and stopping the loss. Forcing urine output here treats the number, not the cause, and leaves even less volume.',
    strength(c){
      return Math.min(
        clip((4.5-c.a('bloodVolume'))/0.9, 0, 1.6),
        clip((74-c.a('map'))/18, 0, 1.6),
        clip((70-c.a('gfr'))/28, 0, 1.6)
      );
    }
  }
];

const CYCLE_THRESHOLD = 0.22;
function findViciousCycles(c){
  const lang=c.lang==='en' ? 'en' : 'zh';
  const out=[];
  VICIOUS_CYCLES.forEach(cycle=>{
    let strength=0;
    try{ strength=Number(cycle.strength(c)) || 0; }catch(e){ strength=0; }
    if(strength<CYCLE_THRESHOLD) return;
    out.push({
      id:cycle.id,
      name:pick(cycle, lang),
      severity:clip(strength, 0, 1.6),
      path:cycle.path,
      steps:lang==='en' ? cycle.enSteps : cycle.zhSteps,
      breakPoint:lang==='en' ? cycle.enBreak : cycle.zhBreak
    });
  });
  return out.sort((a,b)=>b.severity-a.severity);
}

module.exports = {VICIOUS_CYCLES, findViciousCycles};
