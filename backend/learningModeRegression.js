'use strict';

// Regression for the three learning modes (2026-07-30).
//
// Two things are locked down here, and both are claims the UI makes to a learner that the engine
// has to actually honour:
//
//   1. "Trace one loop" is not scored. The mode promises a novice that they can perturb anything
//      without being punished for it, so the engine must not accumulate damage, must not kill,
//      and must still produce the conditions and vicious-cycle detection the rest of the app reads.
//      Hiding the stability bar in CSS would satisfy the screenshot and betray the promise.
//
//   2. The inline intervention caution fires on the mistakes it exists to catch and stays silent
//      on correct treatment. A caution that fires on everything trains the learner to ignore it,
//      which is worse than not having one.

const assert = require('assert');
const {
  createSession, resetSession, setControl, setThreatScoring, evaluateIntervention,
  tick, applyScenario, snapshot
} = require('./simEngine');

function run(session, {seconds, compression=1, lens='seconds'}){
  const realDt=0.2;
  const steps=Math.max(1, Math.round(seconds/(realDt*compression)));
  for(let i=0;i<steps;i++) tick(session, realDt, compression, {lens, segment:false});
  return snapshot(session);
}
function valueOf(snap, key){ return snap.params.find(p=>p.key===key).value; }

// ---------------------------------------------------------------------------
// 1. An unscored session survives what a scored one dies of
// ---------------------------------------------------------------------------
// Both sessions get the identical insult. The physiology must agree; only the scoring differs.
{
  const scored=createSession('zh');
  applyScenario(scored, 'hemorrhage');
  let scoredSnap=null, died=false;
  for(let i=0;i<600;i++){
    scoredSnap=tick(scored, 0.2, 20, {lens:'minutes', segment:false});
    if(scoredSnap.dead){ died=true; break; }
  }
  assert.ok(died, 'control case: an untreated haemorrhage must still kill a scored patient');

  const unscored=createSession('zh');
  setThreatScoring(unscored, false);
  applyScenario(unscored, 'hemorrhage');
  const unscoredSnap=run(unscored, {seconds:1800, compression:20, lens:'minutes'});
  assert.strictEqual(unscoredSnap.noThreat, true, 'the unscored flag must be published');
  assert.strictEqual(unscoredSnap.dead, false, 'an unscored patient must never die');
  assert.strictEqual(unscoredSnap.health, 100, 'an unscored patient must stay at full stability');
  assert.strictEqual(unscoredSnap.temporal.healthChangeRate, 0,
    'a frozen stability score must report a zero change rate, since the auto-scaling ceiling divides by it');

  // The clinical reading must NOT be switched off with the scoring: the condition list, the
  // offender ranking and the vicious-cycle list are what the caution and the AI report read.
  assert.ok(unscoredSnap.conditions.length > 0, 'conditions must still be assessed when unscored');
  assert.ok(unscoredSnap.offenders.length > 0, 'offenders must still be ranked when unscored');
  assert.ok(Array.isArray(unscoredSnap.viciousCycles), 'vicious cycles must still be evaluated when unscored');

  // ...and the physiology must be the same physiology. Sampled at a matched simulated time.
  const scoredEarly=createSession('zh');
  applyScenario(scoredEarly, 'hemorrhage');
  const a=run(scoredEarly, {seconds:60, compression:1});
  const unscoredEarly=createSession('zh');
  setThreatScoring(unscoredEarly, false);
  applyScenario(unscoredEarly, 'hemorrhage');
  const b=run(unscoredEarly, {seconds:60, compression:1});
  ['map','hr','symp','vagal','tpr','bloodVolume','lactate'].forEach(key=>{
    const delta=Math.abs(valueOf(a,key)-valueOf(b,key));
    const scale=Math.max(1, Math.abs(valueOf(a,key)));
    assert.ok(delta/scale < 0.02,
      `${key} must evolve identically whether or not the session is scored (got ${valueOf(a,key)} vs ${valueOf(b,key)})`);
  });
}

// ---------------------------------------------------------------------------
// 2. Unscoring clears a death, and the flag survives restarts
// ---------------------------------------------------------------------------
// A mode switch can arrive with the patient already dead. Leaving health at zero would mean the
// unscored mode still refused every intervention, with nothing on screen explaining why.
{
  const session=createSession('zh');
  applyScenario(session, 'hemorrhage');
  for(let i=0;i<600 && !session.dead;i++) tick(session, 0.2, 20, {lens:'minutes', segment:false});
  assert.strictEqual(session.dead, true, 'setup: the patient should be dead before unscoring');
  setThreatScoring(session, false);
  assert.strictEqual(session.dead, false, 'unscoring must clear a death');
  assert.strictEqual(session.health, 100, 'unscoring must clear the score, not just freeze it');
  assert.strictEqual(session.paused, false, 'unscoring must unpause a session paused by death');

  // The mode describes what the session is for, so it outlives a restart and a case change.
  resetSession(session);
  assert.strictEqual(session.noThreat, true, 'the unscored flag must survive resetSession');
  applyScenario(session, 'sepsis');
  assert.strictEqual(session.noThreat, true, 'the unscored flag must survive applyScenario');

  // Re-scoring resumes from a clean 100 rather than charging for the unscored excursion.
  setThreatScoring(session, true);
  assert.strictEqual(session.noThreat, false, 're-enabling must clear the flag');
  assert.strictEqual(session.health, 100, 're-scoring must resume from full stability');
  const after=run(session, {seconds:120, compression:20, lens:'minutes'});
  assert.ok(after.health < 100, 'once re-scored, an untreated septic patient must start losing stability again');
}

// ---------------------------------------------------------------------------
// 3. The inline caution catches the mistakes and not the treatments
// ---------------------------------------------------------------------------
function cautionFor(scenario, key, value, {seconds=8, compression=1, lens='seconds', pre=[]}={}){
  const session=createSession('zh');
  if(scenario) applyScenario(session, scenario);
  pre.forEach(([k,v,hold])=>{
    setControl(session, k, v);
    run(session, {seconds:hold || 60, compression:20, lens:'minutes'});
  });
  run(session, {seconds, compression, lens});
  setControl(session, key, value);
  return evaluateIntervention(session, key);
}

// Mistakes that must be caught.
const mustWarn=[
  ['hemorrhage', 'urine', 65, 'forcing diuresis in haemorrhagic shock'],
  ['hemorrhage', 'bloodVolume', -65, 'draining more volume in haemorrhagic shock'],
  ['co2', 'ventilation', -65, 'suppressing ventilation in respiratory acidosis'],
  ['co2', 'airway', 65, 'raising airway resistance in respiratory acidosis'],
  ['renalFailure', 'potassium', 65, 'raising potassium in renal failure']
];
mustWarn.forEach(([scenario, key, value, why])=>{
  const caution=cautionFor(scenario, key, value, {seconds:8});
  assert.ok(caution, `the caution must fire for ${why}`);
  assert.ok(caution.text && caution.text.length > 10, `the caution for ${why} must carry readable text`);
  assert.strictEqual(caution.key, key, 'the caution must name the control it is about');
  assert.strictEqual(caution.direction, value > 0 ? 1 : -1, 'the caution must name the direction dragged');
});

// The headline case, and the reason the caution is netted across every active condition rather
// than read off the single dominant one. Give bicarbonate to a salicylate patient until they are
// alkalaemic, and more bicarbonate must be flagged - even though the dominant condition there is
// the respiratory alkalosis, which bicarbonate does not appear among the harmful directions of.
//
// The precondition is asserted rather than assumed: the trap only exists once the patient IS
// alkalaemic, so a version of this test that quietly failed to make them alkalaemic would pass
// for the wrong reason if the caution ever started firing indiscriminately.
{
  const session=createSession('zh');
  applyScenario(session, 'salicylateToxicity');
  setControl(session, 'bicarbonate', 85);
  const loaded=run(session, {seconds:300, compression:20, lens:'minutes'});
  const pH=valueOf(loaded, 'pH');
  assert.ok(pH > 7.50,
    `precondition: bicarbonate loading must render the salicylate patient alkalaemic, got pH ${pH.toFixed(2)}`);
  setControl(session, 'bicarbonate', 85);
  const caution=evaluateIntervention(session, 'bicarbonate');
  assert.ok(caution, `giving more bicarbonate at pH ${pH.toFixed(2)} must be cautioned`);
}

// Correct treatment must stay silent, or the line becomes noise and gets ignored.
const mustStaySilent=[
  ['hemorrhage', 'bloodVolume', 65, 'repleting volume in haemorrhagic shock'],
  ['co2', 'ventilation', 65, 'raising ventilation in respiratory acidosis'],
  ['renalFailure', 'potassium', -65, 'lowering potassium in renal failure'],
  ['renalFailure', 'gfr', 65, 'restoring filtration in renal failure'],
  [null, 'bloodVolume', -30, 'a modest perturbation in a healthy patient'],
  [null, 'ventilation', 40, 'raising ventilation in a healthy patient']
];
mustStaySilent.forEach(([scenario, key, value, why])=>{
  const caution=cautionFor(scenario, key, value, {seconds:8});
  assert.strictEqual(caution, null, `the caution must stay silent for ${why}` +
    (caution ? ` (got: ${caution.text})` : ''));
});

// A slider at rest is not an intervention and has nothing to caution about.
{
  const session=createSession('zh');
  applyScenario(session, 'hemorrhage');
  run(session, {seconds:8});
  setControl(session, 'urine', 4);
  assert.strictEqual(evaluateIntervention(session, 'urine'), null,
    'a slider barely off zero must not raise a caution');
}

// Probing must not leave a mark on the session it probed.
{
  const session=createSession('zh');
  applyScenario(session, 'hemorrhage');
  run(session, {seconds:8});
  setControl(session, 'urine', 65);
  const before={...session.controls};
  const healthBefore=session.health, timeBefore=session.simTime;
  evaluateIntervention(session, 'urine');
  assert.deepStrictEqual({...session.controls}, before, 'probing must restore every control it touched');
  assert.strictEqual(session.health, healthBefore, 'probing must not advance the damage model');
  assert.strictEqual(session.simTime, timeBefore, 'probing must not advance simulated time');
}

// ---------------------------------------------------------------------------
// 4. Vicious cycles survive for the AI report
// ---------------------------------------------------------------------------
// The on-screen cycle list was removed on 2026-08-01, but the detector stays because the AI
// report is expected to name any loop that is currently amplifying itself. If the detector
// silently stopped producing cycles, nothing on screen would reveal it.
{
  // Scanned across the run rather than sampled at one instant: a cycle is only reported while
  // every link in it is actually carrying, so it legitimately appears and then resolves. The
  // claim under test is that the detector still fires at all, not that it fires at 80 seconds.
  const session=createSession('zh');
  applyScenario(session, 'cardiogenicShock');
  let seen=null;
  for(let i=0;i<600 && !seen;i++){
    tick(session, 0.2, 1, {lens:'seconds', segment:false});
    const cycles=snapshot(session).viciousCycles;
    if(cycles.length) seen=cycles[0];
  }
  assert.ok(seen, 'cardiogenic shock must raise a self-amplifying loop for the AI report to name');
  assert.ok(seen.name && seen.path.length >= 3, `${seen.id}: a cycle must name the loop it runs on`);
  assert.ok(seen.breakPoint && seen.breakPoint.length > 10, `${seen.id}: a cycle must say where to break it`);

  const healthy=run(createSession('zh'), {seconds:60, compression:1});
  assert.strictEqual(healthy.viciousCycles.length, 0, 'a stable patient must raise no vicious cycles');
}

console.log('Learning mode regression passed: unscored sessions cannot die, physiology is scale-identical, ' +
  'the intervention caution catches mistakes and stays silent on treatment, and vicious cycles survive for the AI report.');
