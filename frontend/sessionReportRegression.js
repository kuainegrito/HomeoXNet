'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');
const { createSession, continueObservation, tick } = require('../backend/simEngine');

const storage = new Map();
const windowObject = {
  crypto: require('crypto').webcrypto,
  localStorage: {
    getItem:key=>storage.get(key)||null,
    setItem:(key,value)=>storage.set(key,String(value))
  },
  dispatchEvent(){},
  open(){ return null; }
};
const context = {
  window:windowObject,
  performance,
  CustomEvent:class CustomEvent{
    constructor(type,options={}){ this.type=type; this.detail=options.detail; }
  },
  Blob,
  URL,
  console,
  setTimeout,
  clearTimeout
};
vm.createContext(context);
const source=fs.readFileSync(path.join(__dirname,'session-report.js'),'utf8');
const appSource=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
const simulatorHtml=fs.readFileSync(path.join(__dirname,'simulator.html'),'utf8');
vm.runInContext(source,context,{filename:'session-report.js'});

const { SessionRecorder, buildInteractiveReportHtml, prepareInteractiveReport, timestampFilename }=windowObject.HomeostasisSessionReporting;
const meta={
  lang:'en',
  groups:{cv:'Cardiovascular'},
  defs:[
    {key:'map',label:'Mean arterial pressure',unit:'mmHg',group:'cv',base:100,scale:30},
    {key:'hr',label:'Heart rate',unit:'bpm',group:'cv',base:80,scale:40},
    {key:'temperature',label:'Temperature',unit:'°C',group:'cv',base:37,scale:2}
  ]
};
const snapshot=(simTime,health,map,hr,control=0)=>({
  simTime,
  health,
  params:[
    {key:'map',label:'Mean arterial pressure',unit:'mmHg',value:map,control},
    {key:'hr',label:'Heart rate',unit:'bpm',value:hr,control:0},
    {key:'temperature',label:'Temperature',unit:'°C',value:37,control:0}
  ]
});

const recorder=new SessionRecorder({meta,sampleIntervalMs:500,maxSamples:500});
const before=snapshot(3,100,100,80,0);
recorder.beginDrag('map',before,0);
recorder.markDragChanged('map','running');
const after=snapshot(3.1,98,112,84,40);
assert.strictEqual(recorder.finishDrag('map',after,40,'running'),true);
recorder.capture(snapshot(4,95,110,86,40),'running',true);
recorder.capture(snapshot(1,94,109,87,40),'running',true);
recorder.capture(snapshot(2.5,93,108.5,87.5,40),'running',true);
recorder.recordMultiParameterAction({
  keys:['map'],
  beforeSnapshot:snapshot(2.5,93,108.5,87.5,40),
  afterSnapshot:snapshot(2.6,92.5,107,87,35),
  source:'preset_event',
  interventionType:'Hemorrhage',
  scenarioSelection:{majorId:'shock',majorLabel:'Shock',minorId:'hemorrhage',minorLabel:'Hemorrhage'},
  status:'running'
});
recorder.recordMultiParameterAction({
  keys:['map'],
  beforeSnapshot:snapshot(2.6,92.5,107,87,35),
  afterSnapshot:snapshot(2.6,92.5,107,87,0),
  source:'button',
  interventionType:'zero interventions',
  status:'running'
});
const report=recorder.buildSnapshot(snapshot(5,92,108,88,40),'paused');

assert.strictEqual(report.metadata.totalInterventions,3);
assert.strictEqual(report.interventions.length,3);
assert.strictEqual(report.interventions[0].parameterId,'map');
assert.strictEqual(report.samples[0].parameters.map.normalized,1);
assert.strictEqual(report.samples.at(-1).parameters.hr.actual,88);
const normalizedTimes=Array.from(report.samples,sample=>sample.normalizedElapsed);
assert.ok(normalizedTimes.every((time,index)=>index===0||time>=normalizedTimes[index-1]),'normalized simulation time must stay monotonic when engine time resets');
assert.strictEqual(report.samples[0].normalizedElapsed,0);
assert.strictEqual(report.interventions[0].normalizedElapsed,0);
assert.ok(report.metadata.normalizedSimulationDurationSeconds>0);
assert.strictEqual(report.scenariosUsed.length,1);
assert.strictEqual(report.scenariosUsed[0].majorLabel,'Shock');
assert.strictEqual(report.scenariosUsed[0].minorLabel,'Hemorrhage');
assert.ok(report.interventions.some(event=>event.interventionType==='zero interventions'),'zero interventions must be recorded as a report marker');
assert.ok(report.defaultVisibleParameterIds.includes('map'));
assert.ok(report.defaultVisibleParameterIds.includes('hr'));
assert.ok(!report.defaultVisibleParameterIds.includes('temperature'),'unchanged parameters must be hidden by default');
assert.ok(report.parameterStatistics.every(statistic=>Number.isFinite(statistic.greatestDeviationElapsed)));
const html=buildInteractiveReportHtml(report);
const prepared=prepareInteractiveReport(report);
assert.strictEqual(prepared.html,html);
assert.match(prepared.filename,/^homeostasis-report-\d{8}-\d{6}\.html$/);
assert.ok(html.includes('Interactive parameter trends'));
assert.ok(html.includes('Separated'));
assert.ok(html.includes('REPORT_DATA='));
assert.ok(html.includes('defaultVisibleParameterIds'));
assert.ok(html.includes('Scenario used (major / minor)'));
assert.ok(html.includes('Show changed parameters only'),'report must provide a changed-parameters-only chart control');
assert.ok(!html.includes('Stability Score reached 0'),'report must not display the removed reached-zero metric');
assert.ok(!html.includes('<span>Session ID</span>'),'session ID must not be rendered as a summary metric');
assert.ok(html.includes('Session ID:'),'session ID must appear in the report subtitle');
assert.ok(html.includes('id="aiAnalysisSection"'),'report must reserve a final AI interpretation section');
assert.ok(html.includes("'stroke-width':24"),'intervention markers need a wide pointer hit target');
assert.ok(html.includes("prior.actionId===event.actionId"),'different intervention actions at the same time need separate vertical markers');
assert.ok(!/https?:\/\/[^<"']+\.js/i.test(html),'report must not require a remote script');
const reportScript=html.match(/<script>([\s\S]+)<\/script>/)?.[1];
assert.ok(reportScript,'generated report must contain an inline runtime');
assert.doesNotThrow(()=>new vm.Script(reportScript),'generated inline report runtime must parse');
assert.match(timestampFilename(new Date(2026,6,17,9,8,7)),/^homeostasis-report-20260717-090807\.html$/);
assert.ok(!appSource.includes('sessionRecorder.active&&requestedCategory'),'changing only the major disorder must not trigger the report prompt');
assert.ok(appSource.includes('showRestartReportPrompt(restartAndApply)'),'selecting a specific disorder must use the restart report prompt');
assert.ok(appSource.includes('hasManualInterventions'),'the zero-interventions button must track whether manual controls exist');
assert.ok(appSource.includes('button.disabled=manipulationLocked||!hasManualInterventions'),'the zero-interventions button must be disabled when there is nothing to clear');
assert.ok(appSource.includes('/MicroMessenger/i'),'WeChat browsers must use the hosted report fallback');
assert.ok(appSource.includes('createWeChatReportLink'),'WeChat fallback must create a temporary HTTPS report link');
assert.ok(simulatorHtml.includes('id="wechatReportModal"'),'WeChat fallback must provide report-link instructions');
assert.ok(appSource.includes('hideRestartReportPrompt({restoreSession:true})'),'closing the prompt must restore the current session');
assert.ok(simulatorHtml.includes('id="restartReportClose"'),'restart report prompt must have a close button');
const reportWithAi=JSON.parse(JSON.stringify(report));
reportWithAi.aiAnalysis={status:'complete',analysisSessionId:'anon_test1234567890',generatedAt:'2026-07-18T12:00:00.000Z',provider:'Tencent Cloud TokenHub',model:'deepseek-v4-pro',text:'Medical interpretation\nSecond line'};
const aiHtml=buildInteractiveReportHtml(reportWithAi);
assert.ok(aiHtml.includes('Medical interpretation\\nSecond line'),'AI interpretation must be embedded in report data');
assert.ok(aiHtml.indexOf('id="aiAnalysisSection"')<aiHtml.indexOf('id="parameterTitle"'),'AI interpretation section must appear before the parameter summary');
assert.ok(aiHtml.includes('function renderMarkdown('),'generated report must safely render Markdown blocks');
assert.ok(aiHtml.includes('appendMarkdownInline'),'generated report must safely render Markdown inline emphasis');
assert.ok(aiHtml.includes("renderMarkdown(document.getElementById('aiAnalysisText'),D.aiAnalysis.text)"),'AI report content must use the Markdown renderer');
assert.ok(aiHtml.includes('.ai-analysis-text h3'),'generated report must style Markdown headings');
assert.ok(appSource.includes('/api/ai-analysis'),'frontend must request AI through the Homeostasis test backend');
assert.ok(appSource.includes('aiFallbackDownloaded'),'frontend must provide explicit AI-failure fallback feedback');
assert.ok(simulatorHtml.includes('id="aiReportModal"'),'report download must ask whether AI interpretation is wanted');
assert.ok(simulatorHtml.includes('1–2'),'AI choice must disclose the expected wait');
assert.ok(simulatorHtml.includes('id="aiReportSelectView"'),'report flow must first offer standard or AI report types');
assert.ok(simulatorHtml.includes('id="aiReportConfirmView"'),'AI report flow must include a quota confirmation step');
assert.ok(simulatorHtml.includes('id="aiQuotaHiddenLink"'),'quota confirmation must retain the hidden exemption gesture target');
assert.ok(simulatorHtml.includes('id="aiSuppressReminder"'),'quota confirmation must offer a do-not-remind preference');
assert.ok(simulatorHtml.includes('id="aiWaitingRemaining"'),'AI wait state must display today’s remaining allowance');
assert.ok(appSource.includes('/api/ai-quota'),'frontend must read server-enforced AI quota status');
assert.ok(appSource.includes('/api/ai-quota/hidden-click'),'hidden exemption gesture must be validated by the backend');
assert.ok(appSource.includes('setTimeout(()=>notice.classList.remove(\'show\'),3000)'),'exemption notice must close automatically after three seconds');
assert.ok(appSource.includes('details:[{title:"多尿（Polyuria）"'),'polyuria teaching detail must belong to the urine parameter definition');
assert.ok(appSource.includes('const detailBlocks=(info.details||[])'),'parameter cards must render their parameter-specific teaching details');
recorder.reset(meta);
assert.strictEqual(recorder.active,false);
assert.strictEqual(recorder.samples.length,0);
assert.strictEqual(recorder.interventions.length,0);

const observation=createSession('en');
observation.health=0;
observation.dead=true;
observation.paused=true;
continueObservation(observation);
assert.strictEqual(observation.dead,false);
assert.strictEqual(observation.paused,false);
assert.strictEqual(observation.observationOnly,true);
const observed=tick(observation,.2,1);
assert.ok(observed.simTime>0,'continued observation must advance simulation time');
assert.strictEqual(observed.health,0,'observation-only mode keeps Stability at zero');
assert.strictEqual(observed.dead,false);

console.log('session report regression passed');
