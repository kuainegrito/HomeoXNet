'use strict';

const assert = require('assert/strict');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const port = 33000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(port),
    VISIT_LOG_PATH: path.join(__dirname, 'logs', 'rate-limit-test-visits.jsonl'),
    HOMEOSTASIS_LEARNING_LOG_PATH: path.join(__dirname, 'logs', 'rate-limit-test-learning.jsonl'),
    HOMEOSTASIS_START_RATE_LIMIT_MAX: '10',
    HOMEOSTASIS_SESSION_RATE_LIMIT_WINDOW_MS: '60000',
    HOMEOSTASIS_TICK_RATE_LIMIT_MAX: '2',
    HOMEOSTASIS_ACTION_RATE_LIMIT_MAX: '2',
    HOMEOSTASIS_INVALID_SESSION_RATE_LIMIT_MAX: '2',
    HOMEOSTASIS_LEARNING_RATE_LIMIT_MAX: '2',
    HOMEOSTASIS_AI_API_KEY: '',
    HOMEOSTASIS_AI_QUOTA_PATH: path.join(os.tmpdir(), `homeostasis-rate-limit-quota-${process.pid}.json`)
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let childOutput = '';
child.stdout.on('data', chunk=>{ childOutput += chunk; });
child.stderr.on('data', chunk=>{ childOutput += chunk; });

async function waitForServer(){
  for(let attempt=0; attempt<80; attempt++){
    if(child.exitCode != null) throw new Error(`server exited early\n${childOutput}`);
    try{
      const response = await fetch(`${baseUrl}/api/health`);
      if(response.ok) return;
    }catch(err){}
    await new Promise(resolve=>setTimeout(resolve, 50));
  }
  throw new Error(`server did not become ready\n${childOutput}`);
}

async function post(pathname, body={}){
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
}

async function startSession(){
  const response = await post('/api/session/start', {lang:'zh'});
  assert.equal(response.status, 200);
  return (await response.json()).sid;
}

async function expectStatuses(requests, expected){
  const statuses = [];
  for(const request of requests) statuses.push((await request()).status);
  assert.deepEqual(statuses, expected);
}

async function run(){
  await waitForServer();
  const firstSid = await startSession();
  const secondSid = await startSession();

  assert.equal((await post('/api/ai-analysis',{sid:'invalid-ai-session',report:{}})).status,404);
  assert.equal((await post('/api/ai-analysis',{sid:firstSid,report:{}})).status,503);

  await expectStatuses([
    ()=>post(`/api/session/${firstSid}/tick`, {dt:0.19, speed:1}),
    ()=>post(`/api/session/${firstSid}/tick`, {dt:0.19, speed:1}),
    ()=>post(`/api/session/${secondSid}/tick`, {dt:0.19, speed:1}),
    ()=>post(`/api/session/${secondSid}/tick`, {dt:0.19, speed:1}),
    ()=>post(`/api/session/${firstSid}/tick`, {dt:0.19, speed:1})
  ], [200, 200, 200, 200, 429]);

  const learningBody = sid=>({eventType:'rate_limit_test', sim:{backendSid:sid}});
  await expectStatuses([
    ()=>post('/api/learning-event', learningBody(firstSid)),
    ()=>post('/api/learning-event', learningBody(firstSid)),
    ()=>post('/api/learning-event', learningBody(secondSid)),
    ()=>post('/api/learning-event', learningBody(secondSid)),
    ()=>post('/api/learning-event', learningBody(firstSid))
  ], [204, 204, 204, 204, 429]);

  await expectStatuses([
    ()=>post('/api/session/not-a-session/tick', {dt:0.19, speed:1}),
    ()=>post('/api/session/another-invalid-session/tick', {dt:0.19, speed:1}),
    ()=>post('/api/session/third-invalid-session/tick', {dt:0.19, speed:1})
  ], [404, 404, 429]);

  console.log('Homeostasis rate-limit regression passed.');
}

run().catch(err=>{
  console.error(err);
  process.exitCode = 1;
}).finally(()=>{
  if(child.exitCode == null) child.kill();
});
