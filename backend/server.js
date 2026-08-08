'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  createSession, resetSession, zeroControls, continueObservation, setControl,
  setThreatScoring, evaluateIntervention, tick, applyScenario, snapshot, meta, explainParameter
} = require('./simEngine');
// AI provider switch: default is the Tencent TokenHub module (./medicalAi);
// set HOMEOSTASIS_AI_PROVIDER=kimi to use the Kimi K3 module (./medicalAiKimi).
const medicalAiProvider = String(process.env.HOMEOSTASIS_AI_PROVIDER || '').trim().toLowerCase();
const {callMedicalAnalysis, isConfigured:isMedicalAiConfigured, buildMedicalEvidence, buildUserPrompt, SYSTEM_PROMPT} =
  medicalAiProvider === 'kimi' ? require('./medicalAiKimi') : require('./medicalAi');
if(medicalAiProvider === 'kimi') console.log('Homeostasis AI provider: Moonshot Kimi (medicalAiKimi)');
const {AiQuotaStore} = require('./aiQuota');

const app = express();
const PORT = process.env.PORT || 3002;
const SESSION_TTL_MS = 1000 * 60 * 60 * 3;
const REPORT_TTL_MS = 1000 * 60 * 60;
const REPORT_MAX_BYTES = 8 * 1024 * 1024;
const REPORT_MAX_ITEMS = 40;
// An evidence pack runs to tens of KB; keep the whole thing so the prompt is replayable.
const AI_PROMPT_LOG_MAX_CHARS = 200000;
// Classroom analytics are OPT-IN. A plain clone of this repository must not write a visitor id,
// an IP address or a learner's click stream anywhere: the person running it has made no promise to
// their users about that, and cannot make one on the author's behalf. Set
// HOMEOSTASIS_LEARNING_LOG_ENABLED=1 to turn the learning log and the AI-prompt log back on, and
// tell your users you have. The browser asks the server which mode it is in (GET /api/client-config)
// and stays silent - no fetch, no beacon, no localStorage id - unless the answer is yes.
const LEARNING_LOG_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.HOMEOSTASIS_LEARNING_LOG_ENABLED || '').trim());
const LEARNING_LOG_PATH = process.env.HOMEOSTASIS_LEARNING_LOG_PATH || path.join(__dirname, 'logs', 'homeostasis-learning-events.jsonl');
const FALLBACK_LEARNING_LOG_PATH = path.join(__dirname, 'logs', 'homeostasis-learning-events.jsonl');
const sessions = new Map();
const temporaryReports = new Map();
const aiQuotaStore = new AiQuotaStore();
let activeLearningLogPath = null;
let learningLogPathReady = null;

app.set('trust proxy', 'loopback');
app.use(helmet({ contentSecurityPolicy: false }));
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function positiveIntEnv(name, fallback){
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const SESSION_RATE_LIMIT_WINDOW_MS = positiveIntEnv('HOMEOSTASIS_SESSION_RATE_LIMIT_WINDOW_MS', 10 * 1000);
const startSessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_START_RATE_LIMIT_MAX', 180),
  standardHeaders: true,
  legacyHeaders: false
});
const invalidSessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_INVALID_SESSION_RATE_LIMIT_MAX', 120),
  standardHeaders: true,
  legacyHeaders: false,
  skip: req=>sessions.has(String(req.params.sid || ''))
});
function sessionLimiter(maxEnvName, fallback){
  return rateLimit({
    windowMs: SESSION_RATE_LIMIT_WINDOW_MS,
    max: positiveIntEnv(maxEnvName, fallback),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: req=>`session:${String(req.params.sid || '')}`,
    skip: req=>!sessions.has(String(req.params.sid || ''))
  });
}
const sessionTickLimiter = sessionLimiter('HOMEOSTASIS_TICK_RATE_LIMIT_MAX', 80);
const sessionActionLimiter = sessionLimiter('HOMEOSTASIS_ACTION_RATE_LIMIT_MAX', 180);
const reportCreateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_REPORT_RATE_LIMIT_MAX', 20),
  standardHeaders: true,
  legacyHeaders: false
});
const aiPromptLogLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_AI_PROMPT_LOG_RATE_LIMIT_MAX', 30),
  standardHeaders: true,
  legacyHeaders: false
});
const medicalAiLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_AI_RATE_LIMIT_MAX', 6),
  standardHeaders: true,
  legacyHeaders: false,
  skip: req=>aiQuotaStore.publicStatus(aiQuotaUserKey(req)).exempt
});
const aiQuotaActionLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_AI_QUOTA_ACTION_RATE_LIMIT_MAX', 60),
  standardHeaders: true,
  legacyHeaders: false
});

function aiQuotaUserKey(req){
  return aiQuotaStore.userKey(req.ip || req.socket?.remoteAddress || 'unknown');
}

app.get('/api/ai-quota', aiQuotaActionLimiter, (req,res)=>{
  try{
    res.json({ok:true,quota:aiQuotaStore.publicStatus(aiQuotaUserKey(req))});
  }catch(error){
    console.warn(`Homeostasis AI quota status failed: ${error?.code||'quota_failed'}`);
    res.status(500).json({error:'quota_failed'});
  }
});

app.post('/api/ai-quota/preferences', aiQuotaActionLimiter, express.json({limit:'4kb'}), (req,res)=>{
  try{
    const quota=aiQuotaStore.setSuppressReminder(aiQuotaUserKey(req),Boolean(req.body?.suppressReminder));
    res.json({ok:true,quota});
  }catch(error){
    console.warn(`Homeostasis AI quota preference failed: ${error?.code||'quota_failed'}`);
    res.status(500).json({error:'quota_failed'});
  }
});

app.post('/api/ai-quota/hidden-click', aiQuotaActionLimiter, (req,res)=>{
  try{
    const result=aiQuotaStore.registerHiddenClick(aiQuotaUserKey(req));
    res.json({ok:true,granted:result.granted,clicks:result.clicks,quota:result.status});
  }catch(error){
    console.warn(`Homeostasis AI quota exemption failed: ${error?.code||'quota_failed'}`);
    res.status(500).json({error:'quota_failed'});
  }
});

// The client sends every loop it saw during the run; the engine says which are still running.
// Neither alone is enough: the engine has forgotten the ones that stopped, and the browser is not
// trusted to be the last word on what is happening inside the model.
function mergeViciousCycleHistory(report, liveCycles){
  const live=Array.isArray(liveCycles)?liveCycles:[];
  const liveIds=new Set(live.map(cycle=>cycle?.id).filter(Boolean));
  const merged=new Map();
  (Array.isArray(report?.viciousCycles)?report.viciousCycles:[]).forEach(cycle=>{
    if(!cycle?.id) return;
    merged.set(cycle.id, {...cycle, activeAtEnd:liveIds.has(cycle.id)});
  });
  live.forEach(cycle=>{
    if(!cycle?.id) return;
    const seen=merged.get(cycle.id);
    // The engine's own text always wins; only the history it cannot know is taken from the client.
    merged.set(cycle.id, {
      ...cycle,
      peakSeverity:Math.max(Number(seen?.peakSeverity)||0, Number(cycle.severity)||0),
      firstSeen:seen?.firstSeen ?? null,
      lastSeen:seen?.lastSeen ?? null,
      activeAtEnd:true
    });
  });
  return {...report, viciousCycles:[...merged.values()].sort((a,b)=>(b.peakSeverity||0)-(a.peakSeverity||0)).slice(0,6)};
}

// The prompt, for every session, whether or not an AI report was ever asked for.
//
// Until now the prompt was only written when a learner actually spent one of their three daily AI
// reports, which meant the great majority of sessions left no analysable trace at all - and those
// are exactly the sessions a teacher wants to run through a model afterwards. This endpoint builds
// the identical evidence pack and prompt and logs it, without calling any model, without touching
// the quota, and without returning the prompt to the browser.
app.post('/api/ai-prompt-log', aiPromptLogLimiter, express.json({limit:'2mb'}), async (req,res)=>{
  // Opt-in only: the prompt carries the learner's full evidence pack alongside their IP.
  if(!LEARNING_LOG_ENABLED) return res.status(204).end();
  const sid=String(req.body?.sid||'');
  if(!sessions.has(sid)) return res.status(404).json({error:'session_not_found'});
  try{
    const report=mergeViciousCycleHistory(req.body?.report||{}, snapshot(sessions.get(sid).session).viciousCycles);
    const evidence=buildMedicalEvidence(report);
    await logAiPrompt(req, sid, {
      prompt:{system:SYSTEM_PROMPT, user:buildUserPrompt(evidence)},
      analysisSessionId:evidence.analysis_session_id,
      provider:'(not called)',
      model:'(not called)'
    }, {aiIncluded:false, trigger:cleanLogText(req.body?.trigger,64)});
    res.status(204).end();
  }catch(error){
    // An audit trail must never be able to break the thing it is auditing.
    console.warn(`Homeostasis AI prompt-only log failed: ${error?.message||'unknown'}`);
    res.status(204).end();
  }
});

app.post('/api/ai-analysis', medicalAiLimiter, express.json({limit:'2mb'}), async (req,res)=>{
  const sid=String(req.body?.sid||'');
  if(!sessions.has(sid)) return res.status(404).json({error:'session_not_found'});
  if(!isMedicalAiConfigured()) return res.status(503).json({error:'ai_not_configured'});
  const quotaKey=aiQuotaUserKey(req);
  let reservation;
  try{
    reservation=aiQuotaStore.reserve(quotaKey);
    if(!reservation.allowed) return res.status(429).json({error:'ai_daily_limit_reached',quota:reservation.status});
    // Self-amplifying loops are reconciled against the live session rather than trusted from the
    // client payload. The engine is authoritative about what is running NOW; only the browser
    // knows what ran EARLIER, and a loop the learner broke is the one worth reporting most.
    // So the live set decides `activeAtEnd` and backfills anything the client failed to send,
    // and the client's history supplies the peak severity and the first/last sighting.
    const report=mergeViciousCycleHistory(req.body?.report||{}, snapshot(sessions.get(sid).session).viciousCycles);
    const analysis=await callMedicalAnalysis(report);
    // The exact prompt is kept so it can be inspected in the traffic dashboard and replayed
    // through another model. It is deliberately logged separately from the analysis text: the
    // prompt is the reproducible artefact, the answer is not.
    await logAiPrompt(req, sid, analysis);
    const {prompt, ...publicAnalysis}=analysis;
    res.json({ok:true,analysis:publicAnalysis,quota:aiQuotaStore.publicStatus(quotaKey)});
  }catch(error){
    const code=String(error?.message||'ai_failed');
    console.warn(`Homeostasis medical AI analysis failed: ${code}`);
    let quota;
    try{ quota=aiQuotaStore.refund(quotaKey,reservation); }catch(refundError){
      console.warn(`Homeostasis AI quota refund failed: ${refundError?.code||'quota_failed'}`);
    }
    res.status(code==='ai_timeout'?504:502).json({error:code,quota});
  }
});

app.use(express.json({ limit: '20kb' }));

function learningSessionId(req){
  const sid = String(req.body?.sim?.backendSid || '');
  return sessions.has(sid) ? sid : '';
}
const learningEventIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_LEARNING_RATE_LIMIT_MAX', 360),
  standardHeaders: true,
  legacyHeaders: false,
  skip: req=>Boolean(learningSessionId(req))
});
const learningEventSessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: positiveIntEnv('HOMEOSTASIS_LEARNING_RATE_LIMIT_MAX', 360),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req=>`session:${learningSessionId(req)}`,
  skip: req=>!learningSessionId(req)
});

function cleanOldSessions(){
  const now = Date.now();
  for(const [sid, record] of sessions){
    if(now - record.updatedAt > SESSION_TTL_MS) sessions.delete(sid);
  }
}
setInterval(cleanOldSessions, 10 * 60 * 1000).unref();

function cleanOldReports(){
  const now=Date.now();
  for(const [token,report] of temporaryReports){
    if(now-report.createdAt>REPORT_TTL_MS) temporaryReports.delete(token);
  }
  while(temporaryReports.size>REPORT_MAX_ITEMS){
    temporaryReports.delete(temporaryReports.keys().next().value);
  }
}
setInterval(cleanOldReports, 10 * 60 * 1000).unref();

function safeReportFilename(value){
  const fallback=`homeostasis-report-${Date.now()}.html`;
  const cleaned=String(value||'').replace(/[^a-zA-Z0-9._-]/g,'-').replace(/-+/g,'-').slice(0,120);
  return cleaned&&cleaned.toLowerCase().endsWith('.html')?cleaned:fallback;
}

function sendTemporaryReport(req,res,download=false){
  cleanOldReports();
  const report=temporaryReports.get(String(req.params.token||''));
  if(!report) return res.status(404).type('text/plain').send('Report expired or not found.');
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Content-Disposition',`${download?'attachment':'inline'}; filename="${report.filename}"`);
  res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  res.send(report.html);
}

function getSession(req,res){
  const sid = req.params.sid || req.body.sid;
  const record = sessions.get(sid);
  if(!record){ res.status(404).json({error:'session_not_found'}); return null; }
  record.updatedAt = Date.now();
  return record.session;
}

app.get('/api/health', (req,res)=>res.json({ok:true, service:'homeostasis-simulator-api', medicalAiConfigured:isMedicalAiConfigured(), learningLogEnabled:LEARNING_LOG_ENABLED}));

// What the browser is allowed to do, decided by the operator rather than by the page. Kept separate
// from /api/health so the health probe stays an ops concern and this stays a privacy one.
app.get('/api/client-config', (req,res)=>res.json({learningLogEnabled:LEARNING_LOG_ENABLED}));
app.get('/api/meta', (req,res)=>res.json(meta(req.query.lang || 'zh')));

app.post('/api/reports', reportCreateLimiter, express.text({type:'text/html',limit:REPORT_MAX_BYTES}), (req,res)=>{
  const html=typeof req.body==='string'?req.body:'';
  if(!html.startsWith('<!doctype html>')||!html.includes('REPORT_DATA=')||!html.includes('HomeoXNet')){
    return res.status(400).json({error:'invalid_report'});
  }
  cleanOldReports();
  const token=crypto.randomBytes(24).toString('hex');
  const filename=safeReportFilename(req.query?.filename);
  temporaryReports.set(token,{html,filename,createdAt:Date.now()});
  cleanOldReports();
  res.status(201).json({
    filename,
    expiresInSeconds:Math.floor(REPORT_TTL_MS/1000),
    viewUrl:`/api/reports/${token}`,
    downloadUrl:`/api/reports/${token}/download`
  });
});
app.get('/api/reports/:token', (req,res)=>sendTemporaryReport(req,res,false));
app.get('/api/reports/:token/download', (req,res)=>sendTemporaryReport(req,res,true));

// `noThreat` opens the session unscored, which is what the "trace one loop" learning mode asks
// for. It is a property of the session rather than a client-side display choice, so that a
// learner in that mode cannot accumulate damage they were told was not being counted.
app.post('/api/session/start', startSessionLimiter, (req,res)=>{
  const lang = req.body?.lang === 'en' ? 'en' : 'zh';
  const sid = crypto.randomUUID();
  const session = createSession(lang);
  if(req.body?.noThreat) setThreatScoring(session, false);
  sessions.set(sid, {session, updatedAt:Date.now()});
  res.json({sid, snapshot:snapshot(session), meta:meta(lang)});
});

// Learning modes are switchable mid-session, so scoring has to be switchable mid-session too.
app.post('/api/session/:sid/threat', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  const session = getSession(req,res); if(!session) return;
  setThreatScoring(session, req.body?.enabled !== false);
  res.json(snapshot(session));
});


// `speed` is simulated seconds per real second, which the client computes from the selected
// lens and in-lens speed. `lens` only tells the solver how coarse a macro step to aim for;
// `segment` asks for the intra-frame trajectory and event list, which is what makes a
// compressed frame inspectable rather than just a jump to a new endpoint.
app.post('/api/session/:sid/tick', invalidSessionLimiter, sessionTickLimiter, (req,res)=>{
  const session = getSession(req,res); if(!session) return;
  res.json(tick(session, req.body?.dt, req.body?.speed, {
    lens: typeof req.body?.lens === 'string' ? req.body.lens : undefined,
    segment: req.body?.segment !== false,
    autoBrake: req.body?.autoBrake !== false
  }));
});

app.post('/api/session/:sid/explain', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  const session = getSession(req,res); if(!session) return;
  try{
    res.json(explainParameter(session,String(req.body?.key||'')));
  }catch(err){
    res.status(400).json({error:err.message || 'bad_parameter'});
  }
});

// The response carries a `caution` whenever the setting just committed is making the patient
// worse. It rides along with the control commit rather than the tick because that is the moment
// it is about: a novice who drags potassium down because the number reads 6.2 needs to be told
// while their finger is on the slider, not in the end-of-session report.
app.post('/api/session/:sid/control', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  const session = getSession(req,res); if(!session) return;
  try{
    setControl(session, req.body.key, req.body.value);
    const snap = snapshot(session);
    if(req.body?.caution !== false){
      const caution = evaluateIntervention(session, String(req.body.key));
      if(caution) snap.caution = caution;
    }
    res.json(snap);
  }catch(err){
    res.status(400).json({error:err.message || 'bad_control'});
  }
});

app.post('/api/session/:sid/scenario', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  const session = getSession(req,res); if(!session) return;
  applyScenario(session, req.body?.name);
  res.json(snapshot(session));
});

app.post('/api/session/:sid/zero', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  const session = getSession(req,res); if(!session) return;
  zeroControls(session);
  res.json(snapshot(session));
});

app.post('/api/session/:sid/continue-observation', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  const session = getSession(req,res); if(!session) return;
  continueObservation(session);
  res.json(snapshot(session));
});

app.post('/api/session/:sid/reset', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  const sid = req.params.sid;
  const record = sessions.get(sid);
  if(!record){ res.status(404).json({error:'session_not_found'}); return; }
  resetSession(record.session);
  record.updatedAt = Date.now();
  res.json(snapshot(record.session));
});

app.post('/api/session/:sid/logout', invalidSessionLimiter, sessionActionLimiter, (req,res)=>{
  if(!sessions.has(req.params.sid)){ res.status(404).json({error:'session_not_found'}); return; }
  sessions.delete(req.params.sid);
  res.status(204).end();
});

function cleanLogText(value, maxLength=2048){
  if(typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanLogNumber(value, min=-1e9, max=1e9){
  const num = Number(value);
  if(!Number.isFinite(num)) return null;
  return Math.max(min, Math.min(max, num));
}

function cleanJsonValue(value, depth=0){
  if(value == null) return null;
  if(typeof value === 'string') return cleanLogText(value, depth ? 1024 : 2048);
  if(typeof value === 'number') return Number.isFinite(value) ? value : null;
  if(typeof value === 'boolean') return value;
  if(Array.isArray(value)){
    if(depth >= 5) return null;
    return value.slice(0, 80).map(item=>cleanJsonValue(item, depth + 1));
  }
  if(typeof value === 'object'){
    if(depth >= 5) return null;
    const out = {};
    Object.entries(value).slice(0, 80).forEach(([key, val])=>{
      const cleanKey = cleanLogText(key, 80);
      if(!cleanKey) return;
      out[cleanKey] = cleanJsonValue(val, depth + 1);
    });
    return out;
  }
  return null;
}

function clientIp(req){
  return cleanLogText(
    req.headers['cf-connecting-ip'] ||
    req.headers['true-client-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.ip ||
    req.socket?.remoteAddress,
    256
  );
}

async function ensureLearningLogPath(){
  if(learningLogPathReady) return learningLogPathReady;
  learningLogPathReady = (async()=>{
    try{
      await fs.promises.mkdir(path.dirname(LEARNING_LOG_PATH), {recursive:true});
      await fs.promises.appendFile(LEARNING_LOG_PATH, '', 'utf8');
      activeLearningLogPath = LEARNING_LOG_PATH;
      return activeLearningLogPath;
    }catch(err){
      await fs.promises.mkdir(path.dirname(FALLBACK_LEARNING_LOG_PATH), {recursive:true});
      await fs.promises.appendFile(FALLBACK_LEARNING_LOG_PATH, '', 'utf8');
      activeLearningLogPath = FALLBACK_LEARNING_LOG_PATH;
      console.warn(`Cannot write homeostasis learning log to ${LEARNING_LOG_PATH}; using ${FALLBACK_LEARNING_LOG_PATH}.`, err.message);
      return activeLearningLogPath;
    }
  })();
  return learningLogPathReady;
}

async function appendLearningEvent(req){
  const body = req.body || {};
  const event = {
    schemaVersion: 1,
    app: 'homeostasis',
    entryType: '测试版',
    eventType: cleanLogText(body.eventType, 96) || 'learning_event',
    loggerVersion: cleanLogText(body.loggerVersion, 128),
    serverTime: new Date().toISOString(),
    ip: clientIp(req),
    userAgent: cleanLogText(req.get('user-agent'), 2048),
    page: cleanJsonValue(body.page),
    client: cleanJsonValue(body.client),
    sim: cleanJsonValue(body.sim),
    userActionType: cleanLogText(body.userActionType, 512) || 'random',
    action: cleanJsonValue(body.action),
    snapshot: cleanJsonValue(body.snapshot)
  };

  const elapsedMs = cleanLogNumber(body.client?.pageElapsedMs, 0, 1000 * 60 * 60 * 24);
  if(elapsedMs != null && event.client && typeof event.client === 'object'){
    event.client.pageElapsedMs = elapsedMs;
    event.client.pageElapsedSeconds = Math.round((elapsedMs / 1000) * 10) / 10;
  }

  const logPath = await ensureLearningLogPath();
  await fs.promises.appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
}

// The prompt that produced an AI report, written into the learning log as its own event so the
// traffic dashboard can show it. The point is reproducibility: with the exact system and user
// prompt in hand, the same student session can be re-analyzed through a different model without
// re-running the simulator.
async function logAiPrompt(req, sid, analysis, extra={}){
  try{
    const prompt=analysis?.prompt;
    if(!prompt?.user) return;
    const event={
      schemaVersion: 1,
      app: 'homeostasis',
      entryType: '测试版',
      eventType: 'ai_report_prompt',
      serverTime: new Date().toISOString(),
      ip: clientIp(req),
      userAgent: cleanLogText(req.get('user-agent'), 2048),
      sim: {
        backendSid: sid,
        learningMode: cleanLogText(req.body?.learningMode, 32) || null,
        learningModeLabel: cleanLogText(req.body?.learningModeLabel, 96) || null
      },
      client: cleanJsonValue(req.body?.client) || {},
      action: {
        analysisSessionId: cleanLogText(analysis?.analysisSessionId, 128),
        provider: cleanLogText(analysis?.provider, 128),
        model: cleanLogText(analysis?.model, 128),
        systemPromptChars: prompt.system ? prompt.system.length : 0,
        userPromptChars: prompt.user.length,
        // false when the prompt was built purely for the record and no model was called.
        aiIncluded: extra.aiIncluded !== false,
        trigger: extra.trigger || null
      },
      aiPrompt: {
        system: cleanLogText(prompt.system, AI_PROMPT_LOG_MAX_CHARS),
        user: cleanLogText(prompt.user, AI_PROMPT_LOG_MAX_CHARS)
      }
    };
    const logPath = await ensureLearningLogPath();
    await fs.promises.appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
  }catch(error){
    // Never fail the learner's report because the audit trail could not be written.
    console.warn(`Homeostasis AI prompt log failed: ${error?.message||'unknown'}`);
  }
}

app.post('/api/learning-event', learningEventIpLimiter, learningEventSessionLimiter, async (req,res)=>{
  // Opt-in only. Accepted and discarded rather than refused, so a browser that raced the
  // /api/client-config answer does not spray errors into the console over a disabled feature.
  if(!LEARNING_LOG_ENABLED) return res.status(204).end();
  try{
    await appendLearningEvent(req);
    res.status(204).end();
  }catch(err){
    console.error('Failed to write homeostasis learning log:', err);
    res.status(500).json({error:'learning_log_failed'});
  }
});

const frontendPath = process.env.FRONTEND_PATH
  ? path.resolve(process.env.FRONTEND_PATH)
  : path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
app.get('*', (req,res)=>res.sendFile(path.join(frontendPath, 'index.html')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Homeostasis simulator API listening on http://127.0.0.1:${PORT}`);
});
