'use strict';

// Which sessions are worth a model call
// ---------------------------------------------------------------------------------------
// An AI interpretation costs real tokens, and the sessions least able to produce one are the
// ones most likely to ask: open the page, drag a slider twice, download. This decides whether
// a session carries enough evidence to be analysed at all, before any quota is spent and long
// before the model is called.
//
// Three properties separate a session that can be read from one that cannot, and every one of
// them is measured in REAL seconds, never simulated ones. The time lens compresses simulated
// time by up to ~11500x, so a "three-day" session can be eight seconds of watching, and a
// careful seconds-lens session can be four real minutes inside ninety simulated seconds.
//
//   actions   distinct learner actions. A loaded scenario is one action however many
//             parameters it moved, which is the same count the report shows the learner.
//   watched   real seconds actually spent watching, summed across the lenses. The frame
//             tracker discards gaps longer than two seconds, so a hidden tab and a paused
//             engine both contribute nothing.
//   quiet gap the longest stretch in which the learner left the system alone - including the
//             time before the first action. A session without one never saw a response to
//             anything it did, no matter how many actions it contains.
//
// Two rules keep this from becoming a trap for the learners it is least meant to catch.
// Thresholds are deliberately generous and are all tunable from the environment, so the gate
// can be tightened without editing code. And a field the report does not carry is UNKNOWN,
// never zero: no learner is refused because a diagnostic went missing.

const DEFAULT_THRESHOLDS = {
  minActions: 3,
  minWatchedSeconds: 90,
  minQuietGapSeconds: 20
};

// `null` is UNKNOWN here and must survive as unknown all the way to the decision. Number(null)
// is 0, so the usual one-line coercion would silently turn "we have no idea how long this
// learner watched" into "this learner watched no time at all" - and refuse them for it.
function finite(value, fallback=null){
  if(value==null||value==='') return fallback;
  const number=Number(value);
  return Number.isFinite(number)?number:fallback;
}

function rounded(value, digits=1){
  const number=finite(value);
  if(number==null) return null;
  const scale=10**digits;
  return Math.round(number*scale)/scale;
}

function thresholdEnv(env, name, fallback){
  const number=Number(env?.[name]);
  return Number.isFinite(number)&&number>=0?number:fallback;
}

// HOMEOSTASIS_AI_ELIGIBILITY=off disables the gate entirely; anything else leaves it on.
function isEnabled(env=process.env){
  return String(env?.HOMEOSTASIS_AI_ELIGIBILITY||'').trim().toLowerCase()!=='off';
}

function thresholdsFromEnv(env=process.env){
  return {
    minActions:thresholdEnv(env,'HOMEOSTASIS_AI_MIN_ACTIONS',DEFAULT_THRESHOLDS.minActions),
    minWatchedSeconds:thresholdEnv(env,'HOMEOSTASIS_AI_MIN_WATCHED_SECONDS',DEFAULT_THRESHOLDS.minWatchedSeconds),
    minQuietGapSeconds:thresholdEnv(env,'HOMEOSTASIS_AI_MIN_QUIET_GAP_SECONDS',DEFAULT_THRESHOLDS.minQuietGapSeconds)
  };
}

// Published to the browser at session start so the report card can say what is missing before
// the learner spends a click, and so tightening an environment variable moves both sides of
// the check at once instead of leaving the page telling a stale story.
function publicConfig(env=process.env){
  return {enforced:isEnabled(env), thresholds:thresholdsFromEnv(env)};
}

// One entry per learner action. A multi-parameter action - a loaded scenario, a guided
// perturbation - arrives as one event per parameter sharing a single actionId, and counting
// those separately would let a single click satisfy the whole gate. Events from an older
// client with no actionId each count once, which is what they were.
function actionSpans(report){
  const events=Array.isArray(report?.interventions)?report.interventions:[];
  const spans=new Map();
  events.forEach((event,index)=>{
    const id=event?.actionId?`id:${event.actionId}`:`index:${index}`;
    const start=finite(event?.elapsed);
    const end=finite(event?.endElapsed,start);
    const span=spans.get(id);
    if(!span){ spans.set(id,{start,end}); return; }
    if(start!=null&&(span.start==null||start<span.start)) span.start=start;
    if(end!=null&&(span.end==null||end>span.end)) span.end=end;
  });
  return [...spans.values()];
}

// Real seconds spent watching. The per-lens tally is the honest measure because it excludes
// time the tab was hidden; the recorder's own clock is the fallback, and it starts at the
// first action, so it can only ever understate. Neither present means unknown.
function watchedSeconds(report, sinceFirstAction){
  let total=0;
  let known=false;
  const lensSeconds=report?.timeScale?.lensSeconds;
  if(lensSeconds&&typeof lensSeconds==='object'){
    Object.values(lensSeconds).forEach(value=>{
      const seconds=finite(value);
      if(seconds!=null&&seconds>0){ total+=seconds; known=true; }
    });
  }
  if(sinceFirstAction!=null&&sinceFirstAction>0){ total=Math.max(total,sinceFirstAction); known=true; }
  return known?total:null;
}

// The longest interval in which nothing was touched. The stretch before the first action only
// exists as the difference between two clocks - the lens tally runs from the start of the run,
// the recorder's clock from the first action - so a learner who studied the baseline for five
// minutes and then applied a planned set of changes is credited for that watching.
function longestQuietGapSeconds(spans, sessionEndSeconds, watched){
  const timed=spans.filter(span=>span.start!=null).sort((a,b)=>a.start-b.start);
  if(!timed.length) return null;
  const gaps=[];
  if(watched!=null&&sessionEndSeconds!=null) gaps.push(Math.max(0,watched-sessionEndSeconds));
  for(let index=1;index<timed.length;index++){
    const previousEnd=timed[index-1].end??timed[index-1].start;
    gaps.push(Math.max(0,timed[index].start-previousEnd));
  }
  if(sessionEndSeconds!=null){
    const lastEnd=timed[timed.length-1].end??timed[timed.length-1].start;
    gaps.push(Math.max(0,sessionEndSeconds-lastEnd));
  }
  return gaps.length?Math.max(...gaps):null;
}

function sessionMetrics(report){
  const spans=actionSpans(report);
  const samples=Array.isArray(report?.samples)?report.samples:[];
  // Real seconds from the first action to the end of the recording. `elapsed` is wall clock;
  // `normalizedElapsed` is simulated time and must never be substituted for it here.
  const sessionEndSeconds=finite(samples[samples.length-1]?.elapsed);
  const watched=watchedSeconds(report,sessionEndSeconds);
  return {
    actions:spans.length,
    watchedSeconds:rounded(watched),
    longestQuietGapSeconds:rounded(longestQuietGapSeconds(spans,sessionEndSeconds,watched))
  };
}

// `reasons` is ordered by how easily the learner can act on it, because the first one is what
// the interface tells them to do next.
function evaluateAiEligibility(report, options={}){
  const thresholds={...DEFAULT_THRESHOLDS,...(options.thresholds||{})};
  const enforced=options.enforced!==false;
  const metrics=sessionMetrics(report);
  const reasons=[];
  if(metrics.actions<thresholds.minActions) reasons.push('too_few_actions');
  if(metrics.watchedSeconds!=null&&metrics.watchedSeconds<thresholds.minWatchedSeconds) reasons.push('too_little_observation');
  if(metrics.longestQuietGapSeconds!=null&&metrics.longestQuietGapSeconds<thresholds.minQuietGapSeconds) reasons.push('no_observation_after_actions');
  return {eligible:!enforced||!reasons.length, enforced, reasons, metrics, thresholds};
}

module.exports={
  DEFAULT_THRESHOLDS,
  evaluateAiEligibility,
  isEnabled,
  publicConfig,
  sessionMetrics,
  thresholdsFromEnv
};
