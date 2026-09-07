'use strict';

// Guarantees behind campusRedirect.js:
//  - off by default: a plain clone never redirects anyone, even with a request that would
//    otherwise match every condition.
//  - once enabled, a redirect needs BOTH a campus-range IP and a fresh heartbeat; either one
//    missing means "stay put", never "redirect to something unreachable".
//  - the heartbeat endpoint rejects requests without the shared secret.
//  - API routes and non-GET requests are never redirected, even when on-campus and alive.

const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');

async function withServer(env, run){
  const port = 37000 + Math.floor(Math.random() * 800);
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

const CAMPUS_IP = '128.164.5.10';
const OFF_CAMPUS_IP = '8.8.8.8';
const BASE_ENV = {
  CAMPUS_IP_CIDRS: '128.164.0.0/16',
  CAMPUS_HEARTBEAT_SECRET: 'test-secret',
  CAMPUS_INTRANET_HOST: '10.9.53.252'
};

function fetchAs(base, path, ip){
  // trust proxy is 'loopback' in server.js, so an X-Forwarded-For from 127.0.0.1 is honoured.
  return fetch(`${base}${path}`, {headers:{'X-Forwarded-For': ip}, redirect:'manual'});
}

async function disabledByDefault(){
  await withServer(BASE_ENV, async base=>{
    await fetch(`${base}/api/campus/heartbeat`, {method:'POST', headers:{'X-Campus-Heartbeat-Secret':'test-secret'}});
    const res = await fetchAs(base, '/HomeoXNet/', CAMPUS_IP);
    assert.equal(res.status, 200, 'CAMPUS_REDIRECT_ENABLED unset must never redirect');
  });
}

async function needsBothIpAndHeartbeat(){
  await withServer({...BASE_ENV, CAMPUS_REDIRECT_ENABLED:'1'}, async base=>{
    // No heartbeat yet: even a campus IP must not redirect.
    let res = await fetchAs(base, '/HomeoXNet/', CAMPUS_IP);
    assert.equal(res.status, 200, 'no heartbeat yet, must not redirect');

    // Heartbeat with the wrong secret is rejected and still does not arm redirects.
    let hb = await fetch(`${base}/api/campus/heartbeat`, {method:'POST', headers:{'X-Campus-Heartbeat-Secret':'wrong'}});
    assert.equal(hb.status, 401);
    res = await fetchAs(base, '/HomeoXNet/', CAMPUS_IP);
    assert.equal(res.status, 200);

    // Correct heartbeat arms it, but only for a campus-range IP.
    hb = await fetch(`${base}/api/campus/heartbeat`, {method:'POST', headers:{'X-Campus-Heartbeat-Secret':'test-secret'}});
    assert.equal(hb.status, 204);

    res = await fetchAs(base, '/HomeoXNet/', OFF_CAMPUS_IP);
    assert.equal(res.status, 200, 'off-campus IP must not redirect even when the intranet box is alive');

    res = await fetchAs(base, '/HomeoXNet/', CAMPUS_IP);
    assert.equal(res.status, 302, 'campus IP + fresh heartbeat must redirect');
    assert.equal(res.headers.get('location'), 'http://10.9.53.252/HomeoXNet/');

    // API routes and the heartbeat route itself are never redirected.
    res = await fetchAs(base, '/api/health', CAMPUS_IP);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('location'), null);

    // A POST is never redirected either, even to a matching path.
    res = await fetch(`${base}/HomeoXNet/`, {method:'POST', headers:{'X-Forwarded-For':CAMPUS_IP}, redirect:'manual'});
    assert.equal(res.status !== 302, true, 'POST must not be redirected');

    const status = await (await fetch(`${base}/api/campus/status`)).json();
    assert.equal(status.enabled, true);
    assert.equal(status.intranetAlive, true);
    assert.equal(status.cidrCount, 1);
  });
}

(async()=>{
  await disabledByDefault();
  await needsBothIpAndHeartbeat();
  console.log('campus redirect regression passed: off by default, needs both a campus IP and a live heartbeat');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
