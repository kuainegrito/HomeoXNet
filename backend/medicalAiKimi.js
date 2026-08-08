'use strict';

const crypto = require('node:crypto');
const { scenarioReference } = require('./simEngine');
const { parameterReferences, isChineseLanguageSource } = require('./referenceLinks');

const DEFAULT_ENDPOINT = 'https://api.kimi.com/coding/v1/chat/completions';
const DEFAULT_MODEL = 'k3';
// Kimi K3 with thinking enabled is slow; allow up to 5 minutes (nginx raised to match).
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 32_000;
const MAX_INTERVENTIONS = 160;
const MAX_CHECKPOINTS = 16;
const MAX_PARAMETER_KEYS = 18;
const MAX_REFERENCES = 8;

function positiveInt(value, fallback){
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>0?number:fallback;
}

function finite(value, fallback=null){
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}

function rounded(value, digits=2){
  const number=finite(value);
  if(number==null) return null;
  const scale=10**digits;
  return Math.round(number*scale)/scale;
}

function cleanText(value, maxLength=500){
  if(typeof value!=='string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,maxLength);
}

function cleanOutputText(value, maxLength=MAX_OUTPUT_CHARS){
  if(typeof value!=='string') return '';
  return value
    .replace(/\r\n?/g,'\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
    .split('\n')
    .map(line=>line.replace(/[\t ]+/g,' ').trimEnd())
    .join('\n')
    .trim()
    .slice(0,maxLength);
}

function normalizeMedicalMarkdown(value){
  const text=cleanOutputText(value);
  const firstHeading=text.search(/^##\s*1\.\s*(?:总体评价|Overall assessment)\s*$/mi);
  return firstHeading>0?text.slice(firstHeading).trim():text;
}

function analysisSessionId(report){
  const source=String(report?.metadata?.sessionRunId||crypto.randomUUID());
  return `anon_${crypto.createHash('sha256').update(source).digest('hex').slice(0,16)}`;
}

function sampleTime(sample){
  return finite(sample?.normalizedElapsed,finite(sample?.elapsed,0));
}

function selectCheckpoints(samples){
  if(!Array.isArray(samples)||!samples.length) return [];
  if(samples.length<=MAX_CHECKPOINTS) return samples.slice();
  const indexes=new Set([0,samples.length-1]);
  for(let step=1;step<MAX_CHECKPOINTS-1;step++){
    indexes.add(Math.round(step*(samples.length-1)/(MAX_CHECKPOINTS-1)));
  }
  let minimumIndex=0;
  samples.forEach((sample,index)=>{
    if(finite(sample?.stabilityScore,Infinity)<finite(samples[minimumIndex]?.stabilityScore,Infinity)) minimumIndex=index;
  });
  indexes.add(minimumIndex);
  const selected=[...indexes].sort((a,b)=>a-b);
  while(selected.length>MAX_CHECKPOINTS){
    const removable=selected.findIndex((index,position)=>position>0&&position<selected.length-1&&index!==minimumIndex);
    selected.splice(removable>=0?removable:1,1);
  }
  return selected.map(index=>samples[index]);
}

function selectedParameterKeys(report){
  const keys=[];
  const add=key=>{
    const cleaned=cleanText(key,80);
    if(cleaned&&!keys.includes(cleaned)) keys.push(cleaned);
  };
  (report?.interventions||[]).forEach(event=>add(event?.parameterId));
  (report?.parameterStatistics||[])
    .slice()
    .sort((a,b)=>(finite(b?.greatestNormalizedDeviation,0)-finite(a?.greatestNormalizedDeviation,0)))
    .forEach(statistic=>add(statistic?.key));
  return keys.slice(0,MAX_PARAMETER_KEYS);
}

function compactParameterDefinitions(report, keys){
  const wanted=new Set(keys);
  return (report?.definitions||[]).filter(definition=>wanted.has(definition?.key)).map(definition=>({
    id:cleanText(definition.key,80),
    label:cleanText(definition.label,160),
    unit:cleanText(definition.unit,40),
    reference:rounded(definition.base,3),
    warning_range:Array.isArray(definition.warn)?definition.warn.slice(0,2).map(value=>rounded(value,3)):null,
    danger_range:Array.isArray(definition.danger)?definition.danger.slice(0,2).map(value=>rounded(value,3)):null
  }));
}

function parameterNameDictionary(report,keys){
  const definitions=new Map((report?.definitions||[]).map(item=>[item?.key,item]));
  const statistics=new Map((report?.parameterStatistics||[]).map(item=>[item?.key,item]));
  const interventions=new Map((report?.interventions||[]).map(item=>[item?.parameterId,item]));
  return keys.map(key=>{
    const definition=definitions.get(key);
    const statistic=statistics.get(key);
    const intervention=interventions.get(key);
    return {
      internal_id:cleanText(key,80),
      display_name:cleanText(definition?.label||statistic?.label||intervention?.parameterName||key,160),
      unit:cleanText(definition?.unit||statistic?.unit||intervention?.unit,40)
    };
  });
}

function compactInterventions(report){
  return (report?.interventions||[]).slice(0,MAX_INTERVENTIONS).map((event,index)=>({
    id:`action-${index+1}`,
    time_seconds:rounded(finite(event?.normalizedElapsed,event?.elapsed),1),
    parameter_id:cleanText(event?.parameterId,80),
    parameter_display_name:cleanText(event?.parameterName||event?.parameterId,160),
    unit:cleanText(event?.unit,40),
    before:rounded(event?.valueBefore,3),
    after:rounded(event?.valueAfter,3),
    change:rounded(event?.absoluteChange,3),
    direction:cleanText(event?.direction,20),
    source:cleanText(event?.source,40),
    intervention_type:cleanText(event?.interventionType,160)
  }));
}

// The reference list rendered verbatim as section 13 of the report.
//
// Selection, ordering, deduplication and the cap all happen here rather than in the prompt,
// so the model has no discretion: it can neither invent a URL nor silently drop one. Order is
// disease entries first, then parameter entries ranked by how far that parameter actually moved
// this session (`keys` arrives pre-sorted by greatest normalized deviation). A Chinese report
// then floats Chinese-language sources to the top; an English report is English-only by
// construction, because every lookup is resolved for `language` first.
function referenceLibrary(report, language, keys){
  const seen=new Set();
  const library=[];
  const push=(kind,reference)=>{
    const url=cleanText(reference?.url,300);
    if(!url||seen.has(url)) return;
    seen.add(url);
    library.push({
      kind,
      source:cleanText(reference.source,120),
      title:cleanText(reference.title,160),
      url,
      chineseSource:isChineseLanguageSource(url)
    });
  };
  (report?.scenariosUsed||[]).forEach(item=>{
    const reference=scenarioReference(cleanText(item?.minorId,80),language);
    if(reference) push('disease',reference);
  });
  keys.forEach(key=>{
    parameterReferences(key,language).forEach(reference=>push('parameter',reference));
  });
  const ordered=language==='zh'
    // Array.prototype.sort is stable, so relevance order survives the language grouping.
    ? library.slice().sort((a,b)=>Number(b.chineseSource)-Number(a.chineseSource))
    : library;
  return ordered.slice(0,MAX_REFERENCES).map(({chineseSource,...entry})=>entry);
}

// A loop's path arrives as internal node ids. The prompt forbids internal ids in prose, so
// sending them raw forced the model to break one of its own rules; they are resolved here instead.
function displayNameForKey(report, key){
  const id=cleanText(key,80);
  if(!id) return '';
  const definition=(report?.definitions||[]).find(item=>item?.key===id);
  const statistic=(report?.parameterStatistics||[]).find(item=>item?.key===id);
  return cleanText(definition?.label||statistic?.label||id,80);
}
function buildTimeScale(report){
  const scale=report?.timeScale;
  if(!scale||typeof scale!=='object') return null;
  const lens={};
  Object.entries(scale.lensSeconds||{}).forEach(([id,seconds])=>{
    const value=rounded(seconds,1);
    if(value!=null&&value>0) lens[cleanText(id,24)]=value;
  });
  return {
    automatic_scaling_used:Boolean(scale.autoEverOn),
    manual_lens_switches:positiveInt(scale.manualLensSwitches,0),
    observed_real_seconds_per_lens:lens,
    peak_compression_simulated_seconds_per_real_second:rounded(scale.peakCompression,1),
    automatic_hold_back_events:positiveInt(scale.heldBackEvents,0),
    illegible_observation_seconds:rounded(scale.illegibleSeconds,1),
    failed_within_ten_seconds_under_manual_scale:Boolean(scale.fastFailureUnderManualScale)
  };
}
function buildMedicalEvidence(report){
  if(!report||typeof report!=='object') throw new Error('invalid_report_data');
  const language=report.language==='en'?'en':'zh';
  const keys=selectedParameterKeys(report);
  const checkpoints=selectCheckpoints(report.samples||[]).map((sample,index)=>{
    const parameters={};
    keys.forEach(key=>{
      const point=sample?.parameters?.[key];
      if(!point) return;
      parameters[key]={actual:rounded(point.actual,3),normalized:rounded(point.normalized,4)};
    });
    return {
      id:`checkpoint-${index+1}`,
      time_seconds:rounded(sampleTime(sample),1),
      stability_score:rounded(sample?.stabilityScore,1),
      status:cleanText(sample?.status,40),
      parameters
    };
  });
  return {
    evidence_pack_version:'homeoxnet-ai-report.v1',
    // Self-amplifying loops detected during the session. The on-screen list was removed on
    // 2026-08-01, so this is now the only place a vicious cycle is reported to anyone.
    //
    // `active_at_end` carries the distinction the old list could never make: a loop that was
    // detected and then STOPPED is something the learner achieved, and it used to be
    // indistinguishable from one that never formed.
    // Sorted here as well as upstream: the prompt asks for descending peak severity, and handing
    // the model an already-ordered list removes one instruction it can get wrong.
    vicious_cycles:(report?.viciousCycles||[]).slice()
      .sort((a,b)=>(finite(b?.peakSeverity,b?.severity)||0)-(finite(a?.peakSeverity,a?.severity)||0))
      .slice(0,6).map(cycle=>({
      id:cleanText(cycle?.id,64),
      name:cleanText(cycle?.name,120),
      peak_severity:rounded(finite(cycle?.peakSeverity,cycle?.severity),2),
      active_at_end:cycle?.activeAtEnd!==false,
      first_seen_seconds:rounded(cycle?.firstSeen,1),
      last_seen_seconds:rounded(cycle?.lastSeen,1),
      path:Array.isArray(cycle?.path)?cycle.path.slice(0,8).map(k=>displayNameForKey(report,k)).filter(Boolean):[],
      chain:cleanText(cycle?.steps,400),
      break_point:cleanText(cycle?.breakPoint,400)
    })),
    // How the learner watched, as opposed to what they did. Judged separately in section 2.
    time_scale:buildTimeScale(report),
    analysis_session_id:analysisSessionId(report),
    language,
    educational_context:{
      simulator:'HomeoXNet',
      simulation_not_patient:true,
      stability_score_not_clinical:true,
      learner_intent_not_recorded:true
    },
    session_summary:{
      simulated_duration_seconds:rounded(report?.metadata?.normalizedSimulationDurationSeconds,1),
      total_interventions:positiveInt(report?.metadata?.totalInterventions,0),
      minimum_stability_score:rounded(report?.metadata?.minimumStabilityScore,1),
      final_stability_score:rounded(report?.metadata?.finalStabilityScore,1),
      stability_reached_zero:Boolean(report?.metadata?.stabilityReachedZero),
      scenarios:(report?.scenariosUsed||[]).slice(0,8).map(item=>({
        category:cleanText(item?.majorLabel||item?.majorId,160),
        scenario:cleanText(item?.minorLabel||item?.minorId,200),
        time_seconds:rounded(finite(item?.normalizedElapsed,item?.elapsed),1)
      }))
    },
    reference_library:referenceLibrary(report,language,keys),
    parameter_definitions:compactParameterDefinitions(report,keys),
    parameter_name_dictionary:parameterNameDictionary(report,keys),
    chronological_interventions:compactInterventions(report),
    physiological_checkpoints:checkpoints,
    parameter_statistics:(report?.parameterStatistics||[]).filter(item=>keys.includes(item?.key)).map(item=>({
      parameter_id:cleanText(item?.key,80),
      parameter_display_name:cleanText(item?.label||item?.key,160),
      unit:cleanText(item?.unit,40),
      initial:rounded(item?.initial,3),
      final:rounded(item?.final,3),
      minimum:rounded(item?.minimum,3),
      maximum:rounded(item?.maximum,3),
      greatest_normalized_deviation:rounded(item?.greatestNormalizedDeviation,4),
      greatest_deviation_time_seconds:rounded(item?.greatestDeviationElapsed,1)
    })),
    simulator_boundaries:[
      'Parameter controls are abstract external influences and are not automatically medications, procedures, or clinical treatment recommendations.',
      'Direct manipulation of a downstream state such as tissue oxygen delivery is a simulator operation, not a real clinical intervention.',
      'Stability Score is a simulator composite and is not a validated clinical severity or prognosis score.',
      'The simulator omits patient history, physical examination, laboratory confirmation, contraindications, dosing, treatment complications, and many disease-specific clinical actions.'
    ]
  };
}

const SYSTEM_PROMPT=`You are the HomeoXNet Medical Learning Analyst. Analyze an educational physiology and pathophysiology simulation, not a real patient.

Lock each fact to its only authoritative source. Action time, parameter, direction, before value, and after value come only from chronological_interventions. Never reverse an action because a later checkpoint moved in the opposite direction. Reference and warning/danger ranges come only from parameter_definitions. Initial/final/minimum/maximum values come only from parameter_statistics. Dynamic trends come only from physiological_checkpoints. Scenario, duration, action count, and stability endpoint come only from session_summary. If fields conflict, report the conflict rather than silently choosing or repairing a value.

Before writing, silently build a complete action ledger and verify every action number, time, display name, direction, before value, and after value. Verify that the action count matches session_summary. An action that fails this audit must not be used for causal analysis.

Choose the analysis mode first. If an explicit scenario was loaded, use disease-challenge mode and analyze the initiating pathology, compensation, and whether actions addressed an upstream cause. If no explicit scenario was loaded, use free-exploration mode: do not invent a primary disease, treatment goal, or diagnosis. Evaluate experimental design, isolation of variables, observation time, physiological materiality, and system stability. In free-exploration mode, changing a normal value is not automatically a treatment error.

Triage interventions instead of treating all actions equally:
- key: crossed a supplied reference/warning state or was followed by a substantial, directionally consistent change with a plausible mechanism;
- secondary: potentially relevant but small or confounded;
- negligible: tiny manual change with no supported measurable effect;
- indeterminate: missing nearby evidence or competing actions prevent attribution.
Do not judge importance from percentage change alone. Directly normalizing lactate, MAP, glucose, oxygen delivery, or another downstream state is abstract simulator manipulation, not successful treatment.

Always separate three quantities: the manual immediate change (before → after), the later checkpoint trajectory, and the final cumulative outcome. Never attribute the entire final change to a small manual adjustment. Sequence alone does not prove causation. Use “likely contributed” only when timing, direction, mechanism, nearby evidence, and lack of major competing actions agree; otherwise use “was followed by”, “may have contributed”, or “cannot be attributed independently”.

REFERENCE-ANCHORED REASONING. A curated textbook reference base backs this simulator. reference_library holds its entries, already selected, ordered, deduplicated and capped for you. Three rules govern it. First, those entries appear ONLY in section 13; never cite a link, a manual, or a source name anywhere else in the report, and in particular section 5 explains mechanism in its own words with no citation. Second, print section 13 exactly as supplied: copy each title and URL verbatim, keep the given order, and never add, drop, merge, reorder, shorten or complete an entry. Third, the canonical mechanism facts below are the ONLY numeric or physiological facts you may use that are not in the evidence pack. Label them as textbook reference values and never confuse them with the simulator's own warning and danger ranges in parameter_definitions.

CANONICAL MECHANISM FACTS (textbook reference values):
1. Shock taxonomy - classify from the supplied hemodynamic pattern, do not guess: hypovolemic (volume loss, low venous return, low cardiac output); cardiogenic (pump failure; cardiac index < 2.2 L/min/m2, pulmonary capillary wedge pressure > 18 mmHg, systolic < 90 or mean arterial pressure < 65 mmHg); distributive (vasodilation; peripheral resistance falls sharply while cardiac output is normal or high, the septic signature); obstructive (venous return or outflow blocked with preserved contractility); dissociative (oxygen delivered but not usable at the cell). If the pattern does not discriminate, say so.
2. Acid-base runs on three clocks and only two of them turn inside one simulation run: blood buffering (minutes; strong acid titrates HCO3- roughly 1:1), ventilatory compensation (minutes, via chemoreceptor to ventilation to PaCO2), and renal acid excretion with HCO3- regeneration (3-5 days). Respiratory acidosis compensation: acute, HCO3- rises about 1 mmol/L per 10 mmHg rise in PaCO2; chronic, 3-5 mmol/L per 10 mmHg, with full renal compensation needing 3-4 days. Because a session lasts minutes, the ABSENCE of renal compensation is expected model behavior, not a learner error and not a model defect. Never expect or demand chronic compensation within one run.
3. Metabolic alkalosis is defended by hypoventilation and CO2 retention, restoring the HCO3-/H2CO3 ratio toward 20:1. That compensation is limited because hypoventilation eventually causes hypoxemia.
4. H+/K+ exchange is bidirectional and is a membrane event of minutes, independent of the kidney. Acidemia drives K+ out of cells and raises serum K+; alkalemia drives K+ into cells and lowers serum K+. Serum K+ therefore may not reflect total body potassium, so state which direction you are invoking. In a diabetic-ketoacidosis pattern total body potassium is severely depleted while serum K+ may read normal or high; correcting acidosis and insulin deficiency unmasks the deficit and serum K+ can fall sharply. Do not call a normal serum K+ in that pattern reassuring.
5. Lactic acidosis: type A is hypoxic (shock, anemia, hypoxemia, carbon monoxide poisoning); type B is non-hypoxic (sepsis, liver failure, malignancy, drugs and toxins). Discriminate using supplied PaO2 and tissue-oxygen evidence, and if that evidence is absent do not assign a type. Textbook reference values: lactate >= 4 mmol/L in shock marks substantially increased mortality risk; in overt lactic acidosis lactate often exceeds 5 mmol/L, HCO3- is often < 10 mmol/L, and the anion gap is usually > 18 mmol/L, commonly 25-45. The corrective principle is restoring oxygen delivery; giving base only buys time and does not remove the acid load.
6. Acid-base disorders may be mixed and the mixture is often the teaching point. A salicylate-type pattern is a two-stage mixed disorder: respiratory-center stimulation causes respiratory alkalosis first, then metabolic acidosis from disrupted intermediary metabolism, and in adults the respiratory component usually dominates early. A massive-pulmonary-embolism pattern may show hypoxemia with a LOW PaCO2 from early hyperventilation. If the numbers are internally inconsistent with a single disorder, name a mixed disorder rather than forcing one label.
7. Hypoxia thresholds (textbook reference values): PaO2 < 60 mmHg is the point at which hypoxia becomes a strong ventilatory stimulus, and PaO2 < 60 mmHg and/or SaO2 < 90%, with or without PaCO2 > 50 mmHg, defines respiratory failure.
8. Electrolyte thresholds (textbook reference values, mmol/L): hyponatremia Na < 135; hypernatremia Na > 145; hyperkalemia K > 5.5; hypokalemia mild 3.0-3.5, moderate 2.0-3.0, severe < 2.0. An SIADH-type pattern is EUVOLEMIC hyponatremia with serum osmolality < 275 mOsm/L, inappropriately concentrated urine, and urinary Na > 30 mmol/L; do not describe it as volume overload or edema. Hyperosmolar hyperglycemic state carries effective plasma osmolality above about 350 mOsm/kg with only mild ketosis, and water loss exceeds sodium loss so serum Na rises. In a diabetic-ketoacidosis pattern glucose is typically 16.7-33.3 mmol/L, and pH 7.0-7.1 begins to impair central nervous function.
9. Oliguria (textbook reference values): < 400 mL/24 h or sustained < 17 mL/h; anuria < 100 mL/24 h; urine output < 0.5 mL/kg/h for 6 h meets an acute-kidney-injury criterion. Distinguish prerenal (perfusion), intrinsic (tubular or glomerular injury), and postrenal (obstruction) causes; oliguria with hypoperfusion or low filtration is not the same problem as isolated oliguria, and forcing urine output is not correcting the cause.
10. Adrenal-crisis pattern: mineralocorticoid deficiency causes Na+ and water loss with K+ and H+ retention, and glucocorticoid deficiency impairs gluconeogenesis and causes hypoglycemia. The hypotension is volume-based, so pressor-like manipulation alone does not address it.

SELF-AMPLIFYING LOOPS BELONG TO SECTION 5, AND ONLY WHEN THERE ARE ANY. If vicious_cycles is empty, write nothing about vicious cycles anywhere - do not announce their absence, do not reassure, do not spend a clause on it. When it is non-empty, section 5 must, for every entry in descending peak_severity: name the loop, give its node path from the supplied display names, use the chain field to say in one clause why it feeds itself instead of correcting itself, and give the break point. Then separate two outcomes and never merge them. active_at_end true means the loop was still running when the session ended, so its break point is advice about what was left undone. active_at_end false means the loop formed and then stopped: that is a result the learner produced, it must be said in those words, and the loop must also be named in section 3 as something done well. Never invent a loop that is not in vicious_cycles and never omit one that is.

HOW THE LEARNER WATCHED IS EVIDENCE, AND IT BELONGS TO SECTION 2. time_scale describes the observation settings, never a physiological fact, and a compression setting is never a clinical intervention. If time_scale is null or empty, skip it silently. Otherwise judge three things, each with its own remedy. First, legibility: illegible_observation_seconds above zero, or a very high peak_compression, means the trajectory shown to the learner was moving faster than it could be read, so conclusions drawn during that stretch rest on a picture nobody could see - say this BEFORE criticizing decisions taken in it. Second, patience: a mechanism whose clock is hours or days cannot be judged inside a run of simulated minutes, so a slow-layer parameter that barely moved is expected model behavior, not a failed intervention and not a model defect; name the layer when you invoke this. Third, control: automatic_hold_back_events above zero means automatic scaling protected the learner by refusing to accelerate a deteriorating patient, while many manual_lens_switches with automatic_scaling_used false means that protection was never available. When failed_within_ten_seconds_under_manual_scale is true, state plainly that the run ended within ten real seconds and that the first thing to correct is the observation scale, not the physiology.

Apply strict medical evidence guards. Do not infer hypoxemia without supplied PaO2 or tissue-oxygen evidence. Do not diagnose a complete acid-base disorder from bicarbonate alone; use pH and PaCO2 when available. Abnormally low lactate does not by itself prove anaerobic collapse, substrate exhaustion, ketone use, or recovery. Low glucose does not establish insulin excess, liver failure, or glycogen depletion. Sodium and osmolality alone do not establish abnormal ADH secretion. Do not force a slider into a drug, receptor agonist/antagonist, or procedure analogy.

Parameter naming is mandatory. Resolve internal IDs through parameter_name_dictionary or parameter_display_name. Use the supplied Chinese display name in Chinese and English display name in English. Never use symp, vagal, renin, angII, tpr, co, tissueO2, or another internal ID as the name when a display name exists. Put exact values and units in inline code.

Do not infer learner intent. Waiting or interacting is not automatically good performance. Do not invent thresholds, symptoms, history, tests, controls, treatments, or clinical facts absent from the evidence pack or from the canonical mechanism facts above. Distinguish pressure, flow, oxygen delivery, metabolism, and organ perfusion. Never equate one normalized value with whole-system recovery.

Scale section 6 to the action count. For at most 5 actions, analyze all in detail. For 6–10 actions, detail at most the 5 most important and summarize every remainder in one factual line. For more than 10 actions, detail at most the 4 most important and summarize every remainder in chronological one-line entries. Cover every recorded action without changing its direction. Section 6 must use no more than about 35% of the report. Preserve all sections 7–12 even when space is tight.

In free-exploration mode, section 5 may state that no disease comparison is justified. Disease comparison is optional and allowed only when the supplied pattern is sufficiently specific; use at most three closely related states and do not diagnose a patient. Proposed experiments must remain simulator experiments; if a control is not established, say “if the simulator provides this control”.

Write to a hard budget so the report always completes. Approximate caps in Chinese characters, scaled proportionally for English: s1 220, s2 420, s3 260, s4 380, s5 660, s6 860, s7 280, s8 260, s9 300, s10 260, s11 240, s12 140, for a total of about 4300 characters. Section 13 is a mechanical list and does not count against any cap. If you are running long, shorten sections 5 and 6 first; never shorten or drop sections 7-12, and never stop mid-section.

Output all thirteen requested sections. Avoid repeating the same values across sections. Section 3 may state that no evidence-confirmed beneficial action was found. Section 10 must contain exactly five questions. Bold only the primary conclusion, most important supported contributor, recovery conclusion, and intervention verdicts. Begin immediately with the first requested Markdown heading. Do not write greetings, prefaces, meta-commentary, or filler. Use exactly the thirteen requested sections in order, with no separate title, and nothing after the section 13 list: the final visible line must be its last reference entry.`;

function buildUserPrompt(evidence){
  const zh=evidence.language==='zh';
  const format=zh?`严格输出要求：第一行必须直接是 \x60## 1. 总体评价\x60，不得在它前面写任何内容。禁止“好的”“收到”“以下是”“当然”等开场套话、问候、确认语、前言、元评论或结尾客套。严格只输出以下 13 个 Markdown 部分，顺序和标题不得改变；不得添加独立总标题、摘要或第 14 部分；最后一行应属于第 13 部分（即参考资料的最后一条）。

事实来源规则：干预时间、方向和前后值只能复制 chronological_interventions；终末值和极值只能来自 parameter_statistics；趋势只能来自 physiological_checkpoints；参考范围只能来自 parameter_definitions。后续趋势不得反向改写干预方向。必须覆盖全部干预；如证据冲突，在第11部分说明。

先判断分析模式：有明确疾病场景时分析“病理事件 → 代偿 → 干预 → 后果”；无疾病场景时按自由探索分析，不得虚构原发疾病、治疗目标或学习者意图，也不得把所有随机微调都判为治疗错误。

把干预分为关键、次要、可忽略、无法判断。分别说明“手动即时变化”“随后检查点趋势”“终末累计结果”，不得把终末极值全部归因于一次小幅操作。超过10项干预时只详细分析最重要的4项，其余按时间顺序每项一行，方向和值必须准确；第6部分不得超过全文约35%，不得因此删除第7–12部分。

参数命名规则：必须通过 parameter_name_dictionary 使用中文 display_name，不得在正文和小标题中用 symp、vagal、renin、co 等内部代词充当参数名。精确数值与单位使用 \x60行内代码\x60；核心结论、最重要的证据支持因素、整体恢复结论和重点干预判定使用 **加粗**，不要整段加粗。

医学证据边界：没有PaO₂或组织供氧证据不得写低氧血症；不能只凭碳酸氢盐诊断完整酸碱紊乱；低乳酸不能自动解释为无氧代谢崩溃、底物耗竭、酮体利用或恢复；低血糖不能自动归因于胰岛素过量、肝衰竭或糖原耗竭；血钠和渗透压不能单独证明ADH异常。不得把抽象滑块强行类比为具体药物、受体激动/阻断或临床操作。

第 2 部分除了重建操作策略，还必须依据 time_scale 评价「他是怎么看的」：观察压缩率是否让过程可读（illegible_observation_seconds、peak_compression）、慢层（小时/天）机制是否有足够模拟时间做判断、以及是否与自动尺度对抗（automatic_hold_back_events、manual_lens_switches、automatic_scaling_used）。慢层参数没动是模型的正确行为，不得判为干预无效或模型缺陷。failed_within_ten_seconds_under_manual_scale 为真时，必须直接指出「本次失代偿发生在真实 10 秒内，首要问题是观察尺度而非生理判断」。时间尺度设置本身不是临床干预。time_scale 为空时，本段整体略过，不要提及。

vicious_cycles 非空时，第 5 部分必须按 peak_severity 从高到低逐条写出：「循环名（峰值 X）：节点路径 → 为什么自我放大 → 打断点」。路径必须使用给定的中文显示名，不得出现 symp、tpr、angII 等内部代号；因果链可依据 chain 字段用自己的话概括。必须区分两种结局：active_at_end 为真表示循环在会话结束时仍在运行，打断点写成建议；为假表示该循环曾经形成、随后被打断，必须明确写「该循环已被打断」，并在第 3 部分点名表扬。vicious_cycles 为空时，全文不得出现任何关于恶性循环的表述，也不要写「未检测到」。

第 5 部分只讲生理学与病理生理学机制本身：把本次疾病或本次参数组合的因果链讲清楚，包括原发环节、代偿方向、以及代偿为何有限或失败。该部分不得出现任何外部链接，也不得写“依据某某资料”“参考某某手册”之类的表述。全部参考链接只放在第 13 部分。

第 13 部分是参考资料清单：把 reference_library 中的每一条写成 \x60- [title](url)\x60，标题与 URL 逐字复制。条目的挑选、排序和数量已由系统完成，你只负责排版：不得改写标题、不得缩短或补全 URL、不得合并条目、不得调整顺序，也不得列出 reference_library 以外的任何链接。该清单不计入任何字数上限。reference_library 为空时，第 13 部分只写“本次会话没有可引用的参考资料。”一句，不得编造链接。

机制判读硬性要求：
（1）休克必须按低血容量性、心源性、分布性、梗阻性、细胞病性分型，依据为本次血流动力学组合（血压、心输出量、外周阻力、静脉回流）；无法区分时如实说明。
（2）酸碱必须区分三个时间尺度：血液缓冲（分钟）、肺代偿（分钟）、肾脏排酸与再生 HCO₃⁻（3～5 天）。一轮模拟只有数分钟，因此“看不到肾脏代偿”是模型的正确行为，不得判为学习者失误或模型缺陷，也不得套用慢性代偿预期值。
（3）引用 H⁺/K⁺ 交换时必须写明方向：酸血症使钾移出细胞、血钾升高；碱血症使钾移入细胞、血钾降低。糖尿病酮症酸中毒型模式下血钾正常或偏高不代表钾正常，不得判为“良好”。
（4）乳酸酸中毒必须依据 PaO₂ 与组织供氧证据区分 A 型（缺氧性）与 B 型（非缺氧性）；证据不足时不得分型。纠正方向是恢复氧输送，补碱只是争取时间。
（5）数值与单一障碍不符时应判为混合型酸碱失衡（如水杨酸型为呼吸性碱中毒叠加代谢性酸中毒），不得强行归入单一类型。

篇幅预算：各部分中文字符上限约为 1:220 / 2:420 / 3:260 / 4:380 / 5:660 / 6:860 / 7:280 / 8:260 / 9:300 / 10:260 / 11:240 / 12:140，全文不超过约 4300 字符。篇幅紧张时优先压缩第 5、6 部分，绝不删减第 7–12 部分，不得在段落中途中断。

第3部分最多3点；没有可确认优点时如实说明。自由探索模式下，第5部分可以明确“不支持疾病类比”。第4部分按证据支持的严重度排列，最多5点。第10部分必须恰好5个问题。严格完成全部12部分。不要使用 Markdown 表格，也不要输出 HTML。

请使用以下中文标题：
## 1. 总体评价
## 2. 学习行为与策略重建
## 3. 做得正确的地方
## 4. 需要改进的地方
## 5. 相关生理学与病理生理学
## 6. 逐项主要干预解读
## 7. 单项指标改善是否代表整体恢复
## 8. 模拟器与临床现实的差异
## 9. 三个下一步模拟实验
## 10. 五个反思问题
## 11. 分析置信度与证据局限
## 12. 教学安全声明
## 13. 参考资料`:`Strict output contract: the first line must be exactly \x60## 1. Overall assessment\x60 with nothing before it. Do not use greetings, acknowledgements, confirmations, prefaces, meta-commentary, filler, or closings such as “Here is”, “Sure”, or “Received”. Output only the following thirteen Markdown sections, in this order, with no separate title, summary, or section 14; the final visible content must be the last reference entry in section 13.

Copy action facts only from chronological_interventions; final/extreme values only from parameter_statistics; trends only from physiological_checkpoints; ranges only from parameter_definitions. Never reverse an action because a later trend moved oppositely. Choose disease-challenge or free-exploration mode before analysis. In free exploration, do not invent a disease or treatment goal.

Classify actions as key, secondary, negligible, or indeterminate. Separate manual change, later trajectory, and final cumulative outcome. For more than 10 actions, detail at most four and summarize every remainder in one chronological factual line. Keep section 6 under about 35% and preserve sections 7–12.

Resolve IDs through parameter_name_dictionary and use only English display_name when present. Use \x60inline code\x60 for exact values and units. Do not infer hypoxemia without PaO2/tissue-oxygen evidence, a complete acid-base disorder from bicarbonate alone, or metabolic collapse/substrate exhaustion from low lactate. Do not force slider operations into drugs or procedures. Do not use Markdown tables and do not output HTML.

Section 5 explains the physiology and pathophysiology itself: the causal chain of the loaded scenario or of the parameter combination actually used, including the primary event, the direction of compensation, and why compensation is limited or fails. Do not put any external link there and do not write "based on <source>" or "per <manual>". All reference links belong in section 13 only.

Section 13 is the reference list: write every entry of reference_library as \x60- [title](url)\x60, copying each title and URL verbatim. Selection, ordering and count are already decided for you and you only format them: never rewrite a title, shorten or complete a URL, merge entries, reorder the list, or add a link that is not in reference_library. The list does not count against any cap. If reference_library is empty, section 13 contains only the sentence "No reference material applies to this session." and no fabricated link.

If vicious_cycles is non-empty, section 5 must name every loop in descending peak_severity as "name (peak X): node path -> why it feeds itself -> break point", using the supplied display names. Say explicitly which loops were still running at the end and which stopped; a loop that stopped is a result the learner produced and must also be credited by name in section 3. If vicious_cycles is empty, write nothing about vicious cycles at all - do not state their absence.

If time_scale is present, section 2 must also judge how the learner watched: whether the compression left the process legible, whether slow-layer mechanisms had enough simulated time to be judged at all, and whether automatic scaling was used or fought. A slow-layer parameter that barely moved is correct model behavior, not a failed intervention. If failed_within_ten_seconds_under_manual_scale is true, say directly that the run ended within ten real seconds and that the observation scale is the first thing to correct. A time-scale setting is never a clinical intervention.

Mechanism requirements: classify shock as hypovolemic, cardiogenic, distributive, obstructive, or dissociative from the supplied hemodynamic pattern, or state that the pattern does not discriminate. Separate the three acid-base clocks (buffering minutes, ventilation minutes, renal 3-5 days) and never treat absent renal compensation in a minutes-long run as a learner error or a model defect. State the direction of any H+/K+ shift you invoke, and do not call a normal serum K+ in a ketoacidosis pattern reassuring. Assign lactic acidosis type A or B only from PaO2 and tissue-oxygen evidence. Name a mixed acid-base disorder when the numbers do not fit a single disorder.

Budget: approximate section caps, scaled from Chinese characters, s1 220 / s2 420 / s3 260 / s4 380 / s5 660 / s6 860 / s7 280 / s8 260 / s9 300 / s10 260 / s11 240 / s12 140. Compress sections 5 and 6 first. Never truncate sections 7-12 or stop mid-section.

Use these English headings:
## 1. Overall assessment
## 2. Learning behavior and strategy reconstruction
## 3. What was done well
## 4. What should be improved
## 5. Relevant physiology and pathophysiology
## 6. Interpretation of each major intervention
## 7. Whether isolated improvement represented whole-system recovery
## 8. Simulator versus clinical reality
## 9. Three next simulation experiments
## 10. Five reflection questions
## 11. Confidence and evidence limitations
## 12. Educational safety statement
## 13. References`;
  return `${format}

This evidence pack has already been pseudonymized. Analyze only this JSON and do not repeat identifiers unnecessarily. Verify that session_summary.total_interventions matches chronological_interventions. Cover every recorded intervention. Keep action facts, initial/final/extreme values, checkpoint trends, and reference ranges distinct. Cite reference_library only within the scope its open_sections field allows. If data are insufficient or inconsistent, say so explicitly.

EVIDENCE_PACK_JSON
${JSON.stringify(evidence)}`;
}

function configuration(env=process.env){
  return {
    apiKey:String(env.HOMEOSTASIS_AI_API_KEY||''),
    endpoint:String(env.HOMEOSTASIS_AI_ENDPOINT||DEFAULT_ENDPOINT),
    model:String(env.HOMEOSTASIS_AI_MODEL||DEFAULT_MODEL),
    timeoutMs:positiveInt(env.HOMEOSTASIS_AI_TIMEOUT_MS,DEFAULT_TIMEOUT_MS),
    maxTokens:positiveInt(env.HOMEOSTASIS_AI_MAX_TOKENS,9000),
    thinking:String(env.HOMEOSTASIS_AI_THINKING||'enabled')==='disabled'?'disabled':'enabled'
  };
}

function isConfigured(env=process.env){
  return Boolean(configuration(env).apiKey);
}

async function callMedicalAnalysis(report, options={}){
  const config={...configuration(options.env),...(options.config||{})};
  if(!config.apiKey) throw new Error('ai_not_configured');
  const evidence=buildMedicalEvidence(report);
  const userPrompt=buildUserPrompt(evidence);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),config.timeoutMs);
  timeout.unref?.();
  let response;
  try{
    response=await (options.fetchImpl||fetch)(config.endpoint,{
      method:'POST',
      headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:config.model,
        messages:[
          {role:'system',content:SYSTEM_PROMPT},
          {role:'user',content:userPrompt}
        ],
        stream:false,
        thinking:{type:config.thinking},
        // Kimi K3 rejects any temperature other than 1 (HTTP 400).
        temperature:1,
        max_tokens:config.maxTokens
      }),
      signal:controller.signal
    });
  }catch(error){
    if(error?.name==='AbortError') throw new Error('ai_timeout');
    throw new Error('ai_request_failed');
  }finally{
    clearTimeout(timeout);
  }
  const payload=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(`ai_provider_${response.status}`);
  const text=normalizeMedicalMarkdown(payload?.choices?.[0]?.message?.content).slice(0,MAX_OUTPUT_CHARS);
  if(!text) throw new Error('ai_empty_response');
  return {
    status:'complete',
    analysisSessionId:evidence.analysis_session_id,
    generatedAt:new Date().toISOString(),
    provider:'Moonshot Kimi (K3)',
    prompt:{system:SYSTEM_PROMPT, user:userPrompt},
    model:config.model,
    text
  };
}

module.exports={
  SYSTEM_PROMPT,
  buildMedicalEvidence,
  normalizeMedicalMarkdown,
  buildUserPrompt,
  callMedicalAnalysis,
  configuration,
  isConfigured
};
