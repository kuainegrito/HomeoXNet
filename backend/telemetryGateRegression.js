'use strict';

// Classroom analytics are opt-in. This suite is the guarantee behind that sentence in the README:
// a server started WITHOUT HOMEOSTASIS_LEARNING_LOG_ENABLED must accept a learning event and write
// nothing at all, and must tell the browser not to send one in the first place. The same server
// started WITH the flag must actually record. Anything less and the promise is just documentation.

const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {spawn} = require('node:child_process');

const learningEvent = {
  loggerVersion:'telemetry-gate-regression',
  eventType:'control_change',
  client:{visitorId:'visitor-should-not-be-recorded', sessionId:'visit-should-not-be-recorded'},
  action:{key:'hr', value:12}
};

async function withServer(env, run){
  const port = 36000 + Math.floor(Math.random() * 800);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {...process.env, PORT:String(port), ...env},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk=>{ output += chunk; });
  child.stderr.on('data', chunk=>{ output += chunk; });
  try{
    let ready = false;
    for(let attempt = 0; attempt < 80 && !ready; attempt++){
      if(child.exitCode != null) throw new Error(`server exited early\n${output}`);
      try{ ready = (await fetch(`${base}/api/health`)).ok; }catch(_error){}
      if(!ready) await new Promise(resolve=>setTimeout(resolve, 50));
    }
    if(!ready) throw new Error(`server did not become ready\n${output}`);
    return await run(base);
  }finally{
    child.kill();
  }
}

function post(base, route, body){
  return fetch(`${base}${route}`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
}

async function disabledByDefault(){
  const logPath = path.join(os.tmpdir(), `homeoxnet-gate-off-${process.pid}-${Date.now()}.jsonl`);
  await withServer({HOMEOSTASIS_LEARNING_LOG_PATH:logPath}, async base=>{
    // The browser is told to stay silent...
    const config = await (await fetch(`${base}/api/client-config`)).json();
    assert.equal(config.learningLogEnabled, false, 'client-config must report analytics off by default');
    assert.equal((await (await fetch(`${base}/api/health`)).json()).learningLogEnabled, false);

    // ...and a client that sends anyway is accepted and discarded, not errored at.
    assert.equal((await post(base, '/api/learning-event', learningEvent)).status, 204);
    assert.equal((await post(base, '/api/ai-prompt-log', {sid:'not-a-session', report:{}})).status, 204);

    assert.equal(fs.existsSync(logPath), false, `nothing may be written when analytics are off, but ${logPath} exists`);
  });
}

async function enabledByEnv(){
  const logPath = path.join(os.tmpdir(), `homeoxnet-gate-on-${process.pid}-${Date.now()}.jsonl`);
  await withServer({HOMEOSTASIS_LEARNING_LOG_ENABLED:'1', HOMEOSTASIS_LEARNING_LOG_PATH:logPath}, async base=>{
    const config = await (await fetch(`${base}/api/client-config`)).json();
    assert.equal(config.learningLogEnabled, true, 'the env flag must switch analytics on');

    assert.equal((await post(base, '/api/learning-event', learningEvent)).status, 204);
    assert.equal(fs.existsSync(logPath), true, 'an enabled server must actually write the learning log');
    const rows = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eventType, 'control_change');
    // The row is only useful to a teacher if it carries the identity block; this is also exactly
    // why it counts as personal data and why the default is off.
    assert.equal(rows[0].client.visitorId, 'visitor-should-not-be-recorded');

    // The gate is about logging, not about validation: a bad session id is still a 404.
    assert.equal((await post(base, '/api/ai-prompt-log', {sid:'not-a-session', report:{}})).status, 404);
  });
  fs.rmSync(logPath, {force:true});
}

(async()=>{
  await disabledByDefault();
  await enabledByEnv();
  console.log('telemetry gate regression passed: analytics are off by default, on only via HOMEOSTASIS_LEARNING_LOG_ENABLED');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
