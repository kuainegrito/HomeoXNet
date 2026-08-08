'use strict';

const assert = require('node:assert/strict');
const {
  SYSTEM_PROMPT,
  buildMedicalEvidence,
  normalizeMedicalMarkdown,
  buildUserPrompt,
  callMedicalAnalysis,
  configuration,
  isConfigured
} = require('./medicalAi');

const report={
  language:'en',
  metadata:{
    sessionRunId:'private-run-id-must-not-leave-server',
    browserLocalSessionId:'private-browser-id-must-not-leave-server',
    normalizedSimulationDurationSeconds:42,
    totalInterventions:2,
    minimumStabilityScore:61,
    finalStabilityScore:72,
    stabilityReachedZero:false
  },
  scenariosUsed:[{majorId:'emergency',majorLabel:'Emergency & Shock',minorId:'hemorrhage',minorLabel:'Acute hemorrhagic shock',normalizedElapsed:0}],
  definitions:[
    {key:'map',label:'Mean arterial pressure',unit:'mmHg',base:93,warn:[65,145],danger:[45,180]},
    {key:'bloodVolume',label:'Blood volume',unit:'L',base:5,warn:[4.2,5.9],danger:[3,7]}
  ],
  interventions:[
    {normalizedElapsed:5,parameterId:'map',parameterName:'Mean arterial pressure',unit:'mmHg',valueBefore:70,valueAfter:85,absoluteChange:15,direction:'increase',source:'slider',interventionType:'parameter adjustment'},
    {normalizedElapsed:20,parameterId:'bloodVolume',parameterName:'Blood volume',unit:'L',valueBefore:3,valueAfter:4,absoluteChange:1,direction:'increase',source:'slider',interventionType:'parameter adjustment'}
  ],
  parameterStatistics:[
    {key:'map',label:'Mean arterial pressure',unit:'mmHg',initial:70,final:88,minimum:65,maximum:90,greatestNormalizedDeviation:.3,greatestDeviationElapsed:10},
    {key:'bloodVolume',label:'Blood volume',unit:'L',initial:3,final:4,minimum:2.8,maximum:4,greatestNormalizedDeviation:.44,greatestDeviationElapsed:15}
  ],
  samples:[
    {normalizedElapsed:0,stabilityScore:100,status:'running',parameters:{map:{actual:70,normalized:.753},bloodVolume:{actual:3,normalized:.6}}},
    {normalizedElapsed:20,stabilityScore:61,status:'unstable',parameters:{map:{actual:82,normalized:.882},bloodVolume:{actual:3.2,normalized:.64}}},
    {normalizedElapsed:42,stabilityScore:72,status:'running',parameters:{map:{actual:88,normalized:.946},bloodVolume:{actual:4,normalized:.8}}}
  ]
};

async function run(){
  const evidence=buildMedicalEvidence(report);
  assert.match(evidence.analysis_session_id,/^anon_[a-f0-9]{16}$/);
  assert.equal(evidence.session_summary.scenarios[0].scenario,'Acute hemorrhagic shock');
  assert.equal(evidence.chronological_interventions.length,2);
  assert.equal(evidence.physiological_checkpoints.length,3);
  assert.equal(evidence.parameter_name_dictionary.find(item=>item.internal_id==='map')?.display_name,'Mean arterial pressure');
  assert.equal(evidence.chronological_interventions[0].parameter_display_name,'Mean arterial pressure');
  assert.equal(evidence.parameter_statistics[0].parameter_display_name,'Mean arterial pressure');
  const zhReport={
    ...report,
    language:'zh',
    definitions:[{key:'symp',label:'交感张力',unit:'%',base:50,warn:[20,85],danger:[0,100]}],
    interventions:[{normalizedElapsed:5,parameterId:'symp',parameterName:'交感张力',unit:'%',valueBefore:73.48,valueAfter:42.885,absoluteChange:-30.595,direction:'decrease',source:'slider',interventionType:'参数调节'}],
    parameterStatistics:[{key:'symp',label:'交感张力',unit:'%',initial:50,final:42.885,minimum:42.885,maximum:73.48,greatestNormalizedDeviation:.67,greatestDeviationElapsed:5}],
    samples:[{normalizedElapsed:0,stabilityScore:100,status:'运行中',parameters:{symp:{actual:50,normalized:1}}}]
  };
  const zhEvidence=buildMedicalEvidence(zhReport);
  assert.equal(zhEvidence.parameter_name_dictionary[0].internal_id,'symp');
  assert.equal(zhEvidence.parameter_name_dictionary[0].display_name,'交感张力');
  assert.equal(zhEvidence.chronological_interventions[0].parameter_display_name,'交感张力');
  assert.match(buildUserPrompt(zhEvidence),/使用中文 display_name/);

  // Reference library feeds section 13 only, and is language-specific end to end.
  // English report: disease entry first, then parameter entries, all English sources.
  assert.equal(evidence.reference_library[0].kind,'disease');
  assert.equal(evidence.reference_library[0].source,'MSD Manual Professional Edition');
  assert.match(evidence.reference_library[0].url,/^https:\/\/www\.merckmanuals\.com\//);
  assert.ok(evidence.reference_library.length>1,'parameter references should follow the disease entry');
  assert.ok(evidence.reference_library.slice(1).every(item=>item.kind==='parameter'));
  // An English report must never carry a Chinese-language source.
  assert.ok(evidence.reference_library.every(item=>!/msdmanuals\.cn|\/zh-hans\/|pmphai\.com/.test(item.url)));
  // No entry may repeat, and the cap holds.
  assert.equal(new Set(evidence.reference_library.map(item=>item.url)).size,evidence.reference_library.length);
  assert.ok(evidence.reference_library.length<=8);
  assert.ok(evidence.reference_library.every(item=>!('open_sections' in item)&&!('chineseSource' in item)));

  // Chinese report: Chinese-language sources sort ahead of English-only ones.
  assert.equal(zhEvidence.reference_library[0].source,'人卫智数疾病知识库');
  assert.match(zhEvidence.reference_library[0].url,/^https:\/\/test\.pmphai\.com\/jeesitede\/appdisease\//);
  const zhChineseFlags=zhEvidence.reference_library.map(item=>/msdmanuals\.cn|\/zh-hans\/|pmphai\.com/.test(item.url));
  assert.deepEqual(zhChineseFlags,zhChineseFlags.slice().sort((a,b)=>Number(b)-Number(a)));

  // A scenario without a curated entry must not fabricate one; only parameter links remain.
  const randomEvidence=buildMedicalEvidence({
    ...report,
    scenariosUsed:[{majorId:'exploratory',minorId:'random',minorLabel:'Unknown random disturbance'}]
  });
  assert.ok(randomEvidence.reference_library.every(item=>item.kind==='parameter'));

  // Section 5 must not cite; section 13 carries the list.
  assert.match(buildUserPrompt(zhEvidence),/第 5 部分只讲生理学与病理生理学机制本身/);
  assert.match(buildUserPrompt(zhEvidence),/## 13\. 参考资料/);
  assert.doesNotMatch(buildUserPrompt(zhEvidence),/第 12 部分再次说明/);
  assert.match(buildUserPrompt(evidence),/All reference links belong in section 13 only/);
  assert.match(buildUserPrompt(evidence),/## 13\. References/);
  const serialized=JSON.stringify(evidence);
  assert.ok(!serialized.includes('private-run-id-must-not-leave-server'));
  assert.ok(!serialized.includes('private-browser-id-must-not-leave-server'));
  assert.ok(!serialized.includes('browserLocalSessionId'));
  assert.match(buildUserPrompt(evidence),/EVIDENCE_PACK_JSON/);
  assert.match(SYSTEM_PROMPT,/not a real patient/i);

  // --- Vicious cycles and observation time scale -----------------------------------------
  // Both fold into existing sections: loops into 5, time scale into 2. No section was added,
  // so the report still has thirteen headings and the same total character budget.
  const cycleEvidence=buildMedicalEvidence({
    ...zhReport,
    viciousCycles:[
      {id:'shockSpiral',name:'休克螺旋',path:['symp','tpr'],steps:'交感升高→阻力升高→灌注下降',
       breakPoint:'恢复血容量',peakSeverity:.9,firstSeen:12,lastSeen:44,activeAtEnd:false},
      {id:'acidSpiral',name:'酸中毒螺旋',path:['symp'],steps:'乳酸堆积',breakPoint:'恢复氧输送',
       peakSeverity:1.2,firstSeen:20,lastSeen:60,activeAtEnd:true}
    ],
    timeScale:{lensSeconds:{seconds:12.4,minutes:31},peakCompression:3600,manualLensSwitches:4,
      autoEverOn:false,heldBackEvents:2,illegibleSeconds:8.5,fastFailureUnderManualScale:true}
  });
  // Ranked by the worst severity reached, not by whatever was running at the end.
  assert.deepEqual(cycleEvidence.vicious_cycles.map(c=>c.id),['acidSpiral','shockSpiral']);
  assert.equal(cycleEvidence.vicious_cycles[0].peak_severity,1.2);
  assert.equal(cycleEvidence.vicious_cycles[0].active_at_end,true);
  // A loop that was broken must survive as a distinct outcome, with its history intact.
  assert.equal(cycleEvidence.vicious_cycles[1].active_at_end,false);
  assert.equal(cycleEvidence.vicious_cycles[1].first_seen_seconds,12);
  assert.equal(cycleEvidence.vicious_cycles[1].last_seen_seconds,44);
  assert.equal(cycleEvidence.vicious_cycles[1].chain,'交感升高→阻力升高→灌注下降');
  // The path is display names: the prompt forbids internal ids in prose, so it cannot ship them.
  assert.deepEqual(cycleEvidence.vicious_cycles[1].path,['交感张力','tpr']);
  assert.ok(!cycleEvidence.vicious_cycles.some(c=>c.path.includes('symp')));
  assert.equal(cycleEvidence.time_scale.automatic_scaling_used,false);
  assert.equal(cycleEvidence.time_scale.manual_lens_switches,4);
  assert.equal(cycleEvidence.time_scale.automatic_hold_back_events,2);
  assert.equal(cycleEvidence.time_scale.illegible_observation_seconds,8.5);
  assert.equal(cycleEvidence.time_scale.failed_within_ten_seconds_under_manual_scale,true);
  assert.deepEqual(cycleEvidence.time_scale.observed_real_seconds_per_lens,{seconds:12.4,minutes:31});
  // A session with neither must carry neither, so the prompt's "say nothing" branch is reachable.
  assert.deepEqual(buildMedicalEvidence(zhReport).vicious_cycles,[]);
  assert.equal(buildMedicalEvidence(zhReport).time_scale,null);
  assert.match(SYSTEM_PROMPT,/SELF-AMPLIFYING LOOPS BELONG TO SECTION 5/);
  assert.match(SYSTEM_PROMPT,/If vicious_cycles is empty, write nothing about vicious cycles anywhere/);
  assert.match(SYSTEM_PROMPT,/HOW THE LEARNER WATCHED IS EVIDENCE, AND IT BELONGS TO SECTION 2/);
  assert.match(SYSTEM_PROMPT,/a compression setting is never a clinical intervention/);
  assert.match(buildUserPrompt(cycleEvidence),/vicious_cycles 非空时，第 5 部分/);
  assert.match(buildUserPrompt(cycleEvidence),/第 2 部分除了重建操作策略/);
  // Budget moved between sections; the total did not, because 7500 output tokens did not.
  assert.match(SYSTEM_PROMPT,/s2 420, s3 260, s4 380, s5 660, s6 860/);
  assert.match(SYSTEM_PROMPT,/total of about 4300 characters/);

  let requestBody=null;
  const fetchImpl=async(_url,options)=>{
    requestBody=JSON.parse(options.body);
    return {
      ok:true,
      status:200,
      async json(){
        return {choices:[{message:{content:'Overall assessment\n\nMedically grounded test interpretation.'}}]};
      }
    };
  };
  const result=await callMedicalAnalysis(report,{
    config:{apiKey:'test-only-key',endpoint:'https://example.invalid/v1/chat/completions',model:'deepseek-v4-pro',timeoutMs:1000,maxTokens:2000,thinking:'enabled'},
    fetchImpl
  });
  assert.equal(result.status,'complete');
  assert.equal(result.model,'deepseek-v4-pro');
  assert.match(result.text,/\n\nMedically grounded/);
  assert.equal(requestBody.stream,false);
  assert.deepEqual(requestBody.thinking,{type:'enabled'});
  assert.equal(requestBody.messages[0].role,'system');
  assert.match(requestBody.messages[1].content,/Markdown/);
  assert.match(requestBody.messages[1].content,/do not output HTML/i);
  assert.match(requestBody.messages[1].content,/first line must be exactly `## 1\. Overall assessment`/i);
  assert.match(requestBody.messages[1].content,/parameter_name_dictionary/);
  assert.match(requestBody.messages[1].content,/Copy action facts only from chronological_interventions/i);
  assert.match(requestBody.messages[1].content,/## 12\. Educational safety statement/);
  assert.match(SYSTEM_PROMPT,/Sequence alone does not prove causation/i);
  assert.match(SYSTEM_PROMPT,/Never reverse an action/i);
  assert.match(SYSTEM_PROMPT,/free-exploration mode/i);
  assert.match(SYSTEM_PROMPT,/manual immediate change/i);
  assert.match(SYSTEM_PROMPT,/Abnormally low lactate does not by itself prove/i);
  assert.match(SYSTEM_PROMPT,/For more than 10 actions/i);
  assert.match(SYSTEM_PROMPT,/Preserve all sections 7–12/i);
  assert.match(SYSTEM_PROMPT,/begin immediately with the first requested Markdown heading/i);
  assert.match(SYSTEM_PROMPT,/Do not write greetings/i);
  // Reference-anchored reasoning and the canonical mechanism facts.
  assert.match(SYSTEM_PROMPT,/REFERENCE-ANCHORED REASONING/);
  assert.match(SYSTEM_PROMPT,/appear ONLY in section 13/);
  assert.match(SYSTEM_PROMPT,/section 5 explains mechanism in its own words with no citation/);
  assert.match(SYSTEM_PROMPT,/thirteen requested sections/);
  assert.match(SYSTEM_PROMPT,/the final visible line must be its last reference entry/);
  assert.match(SYSTEM_PROMPT,/CANONICAL MECHANISM FACTS/);
  assert.match(SYSTEM_PROMPT,/dissociative/i);
  assert.match(SYSTEM_PROMPT,/ABSENCE of renal compensation is expected model behavior/);
  assert.match(SYSTEM_PROMPT,/H\+\/K\+ exchange is bidirectional/);
  assert.match(SYSTEM_PROMPT,/type A is hypoxic/);
  assert.match(SYSTEM_PROMPT,/name a mixed disorder rather than forcing one label/);
  assert.match(SYSTEM_PROMPT,/EUVOLEMIC hyponatremia/);
  assert.match(SYSTEM_PROMPT,/never shorten or drop sections 7-12/);
  assert.equal(normalizeMedicalMarkdown('好的，以下是报告。\n\n## 1. Overall assessment\n正文'),'## 1. Overall assessment\n正文');
  assert.ok(!JSON.stringify(requestBody).includes('private-run-id-must-not-leave-server'));

  assert.equal(isConfigured({HOMEOSTASIS_AI_API_KEY:'x'}),true);
  assert.equal(isConfigured({}),false);
  assert.equal(configuration({}).model,'deepseek-v4-pro');
  assert.equal(configuration({}).maxTokens,9000);
  assert.equal(configuration({HOMEOSTASIS_AI_MAX_TOKENS:'7500'}).maxTokens,7500);
  await assert.rejects(()=>callMedicalAnalysis(report,{env:{}}),/ai_not_configured/);
  console.log('Homeostasis medical AI regression passed.');
}

run().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
