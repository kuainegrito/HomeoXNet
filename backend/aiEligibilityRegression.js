'use strict';

// The gate has to refuse the sessions that waste tokens and let through everything a learner
// could reasonably call work. The cases below are the second half of that promise: each one is
// a session shape that looks thin by one measure and is not.

const assert = require('node:assert/strict');
const {evaluateAiEligibility, sessionMetrics, thresholdsFromEnv, isEnabled} = require('./aiEligibility');

const parameterEvent=(actionId,elapsed,extra={})=>({
  actionId,elapsed,endElapsed:elapsed,parameterId:'map',valueBefore:70,valueAfter:80,...extra
});
const session=({interventions=[],endSeconds=null,lensSeconds=null}={})=>({
  interventions,
  samples:endSeconds==null?[]:[{elapsed:0},{elapsed:endSeconds}],
  timeScale:lensSeconds==null?undefined:{lensSeconds}
});

// --- Refused ------------------------------------------------------------------------------

// Open the page, drag one slider, download. The case the gate exists for.
const oneDrag=evaluateAiEligibility(session({
  interventions:[parameterEvent('slider-1',0)],
  endSeconds:6,
  lensSeconds:{seconds:6}
}));
assert.equal(oneDrag.eligible,false);
assert.deepEqual(oneDrag.reasons,['too_few_actions','too_little_observation','no_observation_after_actions']);

// Enough actions, but all of them inside eleven seconds of frantic dragging.
const sliderSpam=evaluateAiEligibility(session({
  interventions:[parameterEvent('slider-1',0),parameterEvent('slider-2',4),parameterEvent('slider-3',8),parameterEvent('slider-4',11)],
  endSeconds:12,
  lensSeconds:{seconds:14}
}));
assert.equal(sliderSpam.eligible,false);
assert.deepEqual(sliderSpam.reasons,['too_little_observation','no_observation_after_actions']);

// A loaded scenario moves six parameters on one click. It is one action, not six.
const scenarioOnly=evaluateAiEligibility(session({
  interventions:Array.from({length:6},()=>parameterEvent('button-1',2)),
  endSeconds:300,
  lensSeconds:{seconds:120,minutes:190}
}));
assert.equal(scenarioOnly.eligible,false);
assert.deepEqual(scenarioOnly.reasons,['too_few_actions']);
assert.equal(scenarioOnly.metrics.actions,1);

// --- Allowed ------------------------------------------------------------------------------

// Three deliberate adjustments with time to watch between them: the ordinary good session.
assert.equal(evaluateAiEligibility(session({
  interventions:[parameterEvent('slider-1',0),parameterEvent('slider-2',70),parameterEvent('slider-3',160)],
  endSeconds:240,
  lensSeconds:{seconds:250}
})).eligible,true);

// Every action on one parameter. Isolating a single variable is good experimental design and
// must never be read as a thin session.
assert.equal(evaluateAiEligibility(session({
  interventions:[parameterEvent('slider-1',0),parameterEvent('slider-2',45),parameterEvent('slider-3',95)],
  endSeconds:150,
  lensSeconds:{seconds:160}
})).eligible,true);

// Five minutes studying the baseline, then a planned set of changes applied back to back. The
// quiet stretch is the one before the first action, and it only exists as the difference
// between the lens tally and the recorder's clock.
const plannedIntervention=evaluateAiEligibility(session({
  interventions:[parameterEvent('slider-1',0),parameterEvent('slider-2',3),parameterEvent('slider-3',6)],
  endSeconds:8,
  lensSeconds:{seconds:308}
}));
assert.equal(plannedIntervention.eligible,true);
assert.equal(plannedIntervention.metrics.longestQuietGapSeconds,300);

// A days-lens session covering three simulated days in four real minutes. Simulated duration
// is enormous and irrelevant; only the real seconds count.
assert.equal(evaluateAiEligibility({
  interventions:[parameterEvent('slider-1',0,{normalizedElapsed:0}),parameterEvent('slider-2',80,{normalizedElapsed:86400}),parameterEvent('slider-3',170,{normalizedElapsed:172800})],
  samples:[{elapsed:0,normalizedElapsed:0},{elapsed:250,normalizedElapsed:259200}],
  timeScale:{lensSeconds:{days:250}}
}).eligible,true);

// --- Never punish a learner for a missing diagnostic ---------------------------------------

// No timing at all: only the action count can be judged, and three actions pass.
const noTiming=evaluateAiEligibility({interventions:[{actionId:'a-1'},{actionId:'a-2'},{actionId:'a-3'}]});
assert.equal(noTiming.eligible,true);
assert.equal(noTiming.metrics.watchedSeconds,null);
assert.equal(noTiming.metrics.longestQuietGapSeconds,null);

// An empty or malformed body is refused rather than crashing the route.
assert.equal(evaluateAiEligibility({}).eligible,false);
assert.equal(evaluateAiEligibility(null).eligible,false);
assert.equal(sessionMetrics(null).actions,0);

// --- Configuration -------------------------------------------------------------------------

assert.deepEqual(thresholdsFromEnv({}),{minActions:3,minWatchedSeconds:90,minQuietGapSeconds:20});
assert.equal(thresholdsFromEnv({HOMEOSTASIS_AI_MIN_ACTIONS:'6'}).minActions,6);
assert.equal(thresholdsFromEnv({HOMEOSTASIS_AI_MIN_ACTIONS:'not a number'}).minActions,3);
assert.equal(isEnabled({}),true);
assert.equal(isEnabled({HOMEOSTASIS_AI_ELIGIBILITY:'off'}),false);

// A tightened threshold refuses a session that passed under the default.
assert.equal(evaluateAiEligibility(session({
  interventions:[parameterEvent('slider-1',0),parameterEvent('slider-2',70),parameterEvent('slider-3',160)],
  endSeconds:240,
  lensSeconds:{seconds:250}
}),{thresholds:{minActions:6}}).eligible,false);

// Switching the gate off lets the thinnest session through while still reporting what it saw.
const disabled=evaluateAiEligibility(session({interventions:[parameterEvent('slider-1',0)],endSeconds:6}),{enforced:false});
assert.equal(disabled.eligible,true);
assert.equal(disabled.enforced,false);
assert.deepEqual(disabled.reasons,['too_few_actions','too_little_observation','no_observation_after_actions']);

console.log('Homeostasis AI eligibility regression passed.');
