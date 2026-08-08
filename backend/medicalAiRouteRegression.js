'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {spawn} = require('node:child_process');

const appPort=35000+Math.floor(Math.random()*500);
const providerPort=35500+Math.floor(Math.random()*500);
const appBase=`http://127.0.0.1:${appPort}`;
let providerRequest=null;
const quotaPath=path.join(os.tmpdir(),`homeostasis-ai-route-quota-${process.pid}-${Date.now()}.json`);

const provider=http.createServer((req,res)=>{
  let body='';
  req.setEncoding('utf8');
  req.on('data',chunk=>{ body+=chunk; });
  req.on('end',()=>{
    providerRequest=JSON.parse(body);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:'1. Overall assessment\n\nIntegrated medical AI route test.'}}]}));
  });
});

const child=spawn(process.execPath,['server.js'],{
  cwd:__dirname,
  env:{
    ...process.env,
    PORT:String(appPort),
    HOMEOSTASIS_AI_API_KEY:'route-test-key',
    HOMEOSTASIS_AI_ENDPOINT:`http://127.0.0.1:${providerPort}/v1/chat/completions`,
    HOMEOSTASIS_AI_MODEL:'deepseek-v4-pro',
    HOMEOSTASIS_AI_TIMEOUT_MS:'2000',
    HOMEOSTASIS_AI_QUOTA_PATH:quotaPath,
    HOMEOSTASIS_AI_QUOTA_SALT:'medical-ai-route-regression-salt',
    VISIT_LOG_PATH:path.join(__dirname,'logs','medical-ai-route-visits.jsonl'),
    HOMEOSTASIS_LEARNING_LOG_PATH:path.join(__dirname,'logs','medical-ai-route-learning.jsonl')
  },
  stdio:['ignore','pipe','pipe']
});
let childOutput='';
child.stdout.on('data',chunk=>{ childOutput+=chunk; });
child.stderr.on('data',chunk=>{ childOutput+=chunk; });

async function waitForServer(){
  for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!=null) throw new Error(`server exited early\n${childOutput}`);
    try{
      const response=await fetch(`${appBase}/api/health`);
      if(response.ok){
        const health=await response.json();
        assert.equal(health.medicalAiConfigured,true);
        return;
      }
    }catch(_error){}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error(`server did not become ready\n${childOutput}`);
}

async function post(pathname,body){
  return fetch(`${appBase}${pathname}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

async function run(){
  await new Promise(resolve=>provider.listen(providerPort,'127.0.0.1',resolve));
  await waitForServer();
  const start=await post('/api/session/start',{lang:'en'});
  assert.equal(start.status,200);
  const {sid}=await start.json();
  const report={
    language:'en',
    metadata:{normalizedSimulationDurationSeconds:10,totalInterventions:1,minimumStabilityScore:80,finalStabilityScore:85,stabilityReachedZero:false},
    definitions:[{key:'map',label:'Mean arterial pressure',unit:'mmHg',base:93,warn:[65,145],danger:[45,180]}],
    scenariosUsed:[],
    interventions:[{normalizedElapsed:2,parameterId:'map',parameterName:'Mean arterial pressure',unit:'mmHg',valueBefore:70,valueAfter:80,absoluteChange:10,direction:'increase',source:'slider',interventionType:'parameter adjustment'}],
    parameterStatistics:[{key:'map',label:'Mean arterial pressure',unit:'mmHg',initial:70,final:80,minimum:70,maximum:80,greatestNormalizedDeviation:.25,greatestDeviationElapsed:0}],
    samples:[{normalizedElapsed:0,stabilityScore:80,status:'unstable',parameters:{map:{actual:70,normalized:.75}}},{normalizedElapsed:10,stabilityScore:85,status:'running',parameters:{map:{actual:80,normalized:.86}}}]
  };
  const response=await post('/api/ai-analysis',{sid,report});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.analysis.status,'complete');
  assert.equal(payload.analysis.model,'deepseek-v4-pro');
  assert.equal(payload.quota.used,1);
  assert.equal(payload.quota.remaining,2);
  assert.match(payload.analysis.analysisSessionId,/^anon_[a-f0-9]{16}$/);
  assert.match(payload.analysis.text,/Integrated medical AI route test/);
  assert.equal(providerRequest.model,'deepseek-v4-pro');
  assert.equal(providerRequest.stream,false);
  assert.equal(providerRequest.messages[0].role,'system');
  let hiddenPayload;
  for(let click=1;click<=15;click++) hiddenPayload=await (await post('/api/ai-quota/hidden-click',{})).json();
  assert.equal(hiddenPayload.granted,true);
  assert.equal(hiddenPayload.quota.exempt,true);
  const exemptResponse=await post('/api/ai-analysis',{sid,report});
  assert.equal(exemptResponse.status,200);
  const exemptPayload=await exemptResponse.json();
  assert.equal(exemptPayload.quota.used,1,'an exempt AI report must not consume another daily use');
  assert.equal(exemptPayload.quota.remaining,null);

  // --- The prompt is logged for sessions that never asked for an AI report ------------------
  const providerCallsBefore=providerRequest;
  const promptOnly=await post('/api/ai-prompt-log',{sid,trigger:'report_download',report});
  assert.equal(promptOnly.status,204);
  assert.equal(await promptOnly.text(),'','the prompt must never be returned to the browser');
  // No model call, and no quota spent: this path exists purely to leave a record.
  assert.equal(providerRequest,providerCallsBefore);
  const quotaAfter=await (await fetch(`${appBase}/api/ai-quota`)).json();
  assert.equal(quotaAfter.quota.used,1,'a prompt-only log must not consume an AI report');
  // An unknown session is refused, so the log cannot be written by an arbitrary caller.
  assert.equal((await post('/api/ai-prompt-log',{sid:'not-a-session',report})).status,404);

  const logLines=fs.readFileSync(path.join(__dirname,'logs','medical-ai-route-learning.jsonl'),'utf8')
    .trim().split('\n').map(line=>JSON.parse(line));
  const promptEvents=logLines.filter(event=>event.eventType==='ai_report_prompt');
  assert.ok(promptEvents.length>=3,'each analysis and each prompt-only call writes one record');
  const logged=promptEvents.at(-1);
  assert.equal(logged.action.aiIncluded,false,'the record must say the model was never called');
  assert.equal(logged.action.trigger,'report_download');
  assert.ok(logged.aiPrompt.user.includes('EVIDENCE_PACK_JSON'));
  assert.ok(logged.aiPrompt.system.length>1000);
  // The analysis path still marks its own records as real AI reports.
  assert.equal(promptEvents[0].action.aiIncluded,true);
  console.log('Homeostasis medical AI route regression passed.');
}

run().catch(error=>{
  console.error(error);
  process.exitCode=1;
}).finally(()=>{
  provider.close();
  if(child.exitCode==null) child.kill();
  try{ fs.unlinkSync(quotaPath); }catch(error){ if(error.code!=='ENOENT') console.error(error); }
});
