'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {AiQuotaStore,shanghaiDate} = require('./aiQuota');

const cachePath=path.join(os.tmpdir(),`homeostasis-ai-quota-${process.pid}-${Date.now()}.json`);
const rawIp='203.0.113.42';
let currentDate=new Date('2026-07-18T04:00:00.000Z');

try{
  const store=new AiQuotaStore({cachePath,salt:'quota-regression-salt',now:()=>currentDate});
  const key=store.userKey(rawIp);
  assert.notEqual(key,rawIp);
  assert.equal(store.publicStatus(key).remaining,3);

  const first=store.reserve(key);
  const second=store.reserve(key);
  const third=store.reserve(key);
  assert.equal(first.allowed,true);
  assert.equal(second.allowed,true);
  assert.equal(third.status.remaining,0);
  assert.equal(store.reserve(key).allowed,false);
  assert.equal(store.refund(key,third).remaining,1);
  assert.equal(store.setSuppressReminder(key,true).suppressReminder,true);

  const reloaded=new AiQuotaStore({cachePath,salt:'quota-regression-salt',now:()=>currentDate});
  assert.equal(reloaded.publicStatus(key).suppressReminder,true);
  for(let click=1;click<=14;click++) assert.equal(reloaded.registerHiddenClick(key).granted,false);
  const exemption=reloaded.registerHiddenClick(key);
  assert.equal(exemption.granted,true);
  assert.equal(exemption.status.exempt,true);
  assert.equal(exemption.status.remaining,null);
  assert.equal(reloaded.reserve(key).charged,false);

  const cacheText=fs.readFileSync(cachePath,'utf8');
  assert.ok(!cacheText.includes(rawIp),'quota cache must not contain the raw IP address');

  currentDate=new Date('2026-07-19T04:00:00.000Z');
  const nextDay=reloaded.publicStatus(key);
  assert.equal(nextDay.date,shanghaiDate(currentDate));
  assert.equal(nextDay.used,0);
  assert.equal(nextDay.remaining,3);
  assert.equal(nextDay.exempt,false);
  assert.equal(nextDay.suppressReminder,true);

  console.log('Homeostasis AI quota regression passed.');
}finally{
  try{ fs.unlinkSync(cachePath); }catch(error){ if(error.code!=='ENOENT') throw error; }
}
