'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_LIMIT = 3;
const DEFAULT_CACHE_PATH = '/var/lib/kuaiyu-site/homeostasis-ai-quota.json';

function positiveInt(value,fallback){
  const number=Number(value);
  return Number.isSafeInteger(number)&&number>0?number:fallback;
}

function shanghaiDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

class AiQuotaStore{
  constructor(options={}){
    this.limit=positiveInt(options.limit??process.env.HOMEOSTASIS_AI_DAILY_LIMIT,DEFAULT_LIMIT);
    this.cachePath=String(options.cachePath||process.env.HOMEOSTASIS_AI_QUOTA_PATH||DEFAULT_CACHE_PATH);
    this.salt=String(options.salt||process.env.HOMEOSTASIS_AI_QUOTA_SALT||'homeostasis-ai-quota-v1');
    this.now=typeof options.now==='function'?options.now:()=>new Date();
    this.entries={};
    this.loaded=false;
  }

  userKey(ip){
    return crypto.createHmac('sha256',this.salt).update(String(ip||'unknown')).digest('hex').slice(0,32);
  }

  ensureLoaded(){
    if(this.loaded) return;
    this.loaded=true;
    try{
      const parsed=JSON.parse(fs.readFileSync(this.cachePath,'utf8'));
      if(parsed&&typeof parsed.entries==='object') this.entries=parsed.entries;
    }catch(error){
      if(error?.code!=='ENOENT') console.warn(`Could not read Homeostasis AI quota cache: ${error.message}`);
    }
    this.cleanup();
  }

  today(){
    return shanghaiDate(this.now());
  }

  cleanup(){
    const today=this.today();
    Object.entries(this.entries).forEach(([key,entry])=>{
      if(!entry||typeof entry!=='object') delete this.entries[key];
      else if(entry.date!==today&&entry.exemptDate!==today&&!entry.suppressReminder) delete this.entries[key];
    });
  }

  entry(key){
    this.ensureLoaded();
    const today=this.today();
    let entry=this.entries[key];
    if(!entry||typeof entry!=='object') entry={};
    if(entry.date!==today){
      entry.date=today;
      entry.count=0;
      entry.hiddenClicks=0;
    }
    entry.count=Math.max(0,positiveInt(entry.count,0));
    entry.hiddenClicks=Math.max(0,positiveInt(entry.hiddenClicks,0));
    entry.suppressReminder=Boolean(entry.suppressReminder);
    this.entries[key]=entry;
    return entry;
  }

  publicStatus(key){
    const entry=this.entry(key);
    const exempt=entry.exemptDate===this.today();
    return {
      date:this.today(),
      dailyLimit:this.limit,
      used:entry.count,
      remaining:exempt?null:Math.max(0,this.limit-entry.count),
      exempt,
      suppressReminder:entry.suppressReminder
    };
  }

  save(){
    this.cleanup();
    const directory=path.dirname(this.cachePath);
    fs.mkdirSync(directory,{recursive:true});
    const temporary=`${this.cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify({version:1,updatedAt:new Date().toISOString(),entries:this.entries}),{encoding:'utf8',mode:0o600});
    fs.renameSync(temporary,this.cachePath);
  }

  reserve(key){
    const entry=this.entry(key);
    const exempt=entry.exemptDate===this.today();
    if(!exempt&&entry.count>=this.limit) return {allowed:false,status:this.publicStatus(key),charged:false};
    if(!exempt){
      entry.count+=1;
      this.save();
    }
    return {allowed:true,status:this.publicStatus(key),charged:!exempt};
  }

  refund(key,reservation){
    if(!reservation?.charged) return this.publicStatus(key);
    const entry=this.entry(key);
    entry.count=Math.max(0,entry.count-1);
    this.save();
    return this.publicStatus(key);
  }

  setSuppressReminder(key,value){
    const entry=this.entry(key);
    entry.suppressReminder=Boolean(value);
    this.save();
    return this.publicStatus(key);
  }

  registerHiddenClick(key){
    const entry=this.entry(key);
    if(entry.exemptDate===this.today()) return {granted:true,clicks:15,status:this.publicStatus(key)};
    entry.hiddenClicks=Math.min(15,entry.hiddenClicks+1);
    let granted=false;
    if(entry.hiddenClicks>=15){
      entry.exemptDate=this.today();
      granted=true;
    }
    this.save();
    return {granted,clicks:entry.hiddenClicks,status:this.publicStatus(key)};
  }
}

module.exports={AiQuotaStore,shanghaiDate};
