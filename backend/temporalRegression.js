'use strict';

// Guards for the multi-scale time architecture. The 2026-07-24 experiment was rolled back
// partly because nothing here was checked: it had scenario tests, but no test that a run at
// one time compression produced the same patient as a run at another. That is the property
// the whole feature rests on, so it is the first thing asserted below.

const assert = require('node:assert/strict');
const engine = require('./simEngine');
const temporal = require('./temporalModel');
const {findViciousCycles} = require('./compensation');

const LENSES = {seconds:1, minutes:20, hours:240, days:2880};

// Runs a scenario to an exact simulated time at a given compression, so two runs can be
// compared at the same instant rather than at whatever instant a frame happened to land on.
//
// The final frame is shortened by lowering the COMPRESSION, not the frame duration. tick()
// floors realDt at 0.01 s, so shrinking dt cannot make a frame shorter than 0.01*compression -
// at 2880x that is 28.8 simulated seconds, and a run asked to stop at t=20 would sail past to
// t=28.8 and report a sicker patient. That is a measurement artefact and it briefly looked
// like a solver defect. The lens is passed explicitly, so the solver's step sizing is
// unaffected by the reduced compression on that last frame.
function runTo(name, simSeconds, compression, lens, options = {}) {
  const session = engine.createSession('en');
  if (name) engine.applyScenario(session, name);
  while (session.simTime < simSeconds - 1e-6 && !session.dead) {
    const span = Math.min(simSeconds - session.simTime, 0.19 * compression);
    engine.tick(session, 0.19, span / 0.19, {lens, autoBrake:false, ...options});
  }
  const snap = engine.snapshot(session);
  return {session, snap, values:Object.fromEntries(snap.params.map(p => [p.key, p.value]))};
}

// --- 1. The same patient at every time compression ------------------------------------------
// The physiological state is the claim; the stability score is a derived teaching aid and is
// allowed a looser tolerance, because it integrates nonlinear hazards over the run.
const CROSS_SCALE_CASES = [
  {name:'hemorrhage', at:200}, {name:'sepsis', at:900}, {name:'renalFailure', at:1800},
  {name:'diabetes', at:1200}, {name:'copdExacerbation', at:120}, {name:'hypokalemia', at:600}
];
CROSS_SCALE_CASES.forEach(({name, at}) => {
  const reference = runTo(name, at, LENSES.seconds, 'seconds');
  Object.entries(LENSES).forEach(([lens, compression]) => {
    if (lens === 'seconds') return;
    const run = runTo(name, at, compression, lens);
    engine.meta('en').defs.forEach(definition => {
      const a = reference.values[definition.key], b = run.values[definition.key];
      const tolerance = Math.max(0.04 * Math.abs(definition.scale), 0.02 * Math.abs(a));
      assert.ok(Math.abs(a - b) <= tolerance,
        `${name} at ${at}s: ${definition.key} is ${a.toFixed(3)} at 1x but ${b.toFixed(3)} at ${compression}x`);
    });
    assert.ok(Math.abs(reference.snap.health - run.snap.health) <= 12,
      `${name} at ${at}s: stability is ${reference.snap.health.toFixed(1)} at 1x but ${run.snap.health.toFixed(1)} at ${compression}x`);
  });
});

// A quiet patient must be reproducible across the full compression range too - that is the
// case where the solver is allowed to take its largest steps, so it is where a silently
// unstable integrator would show first.
Object.entries(LENSES).forEach(([lens, compression]) => {
  const idle = runTo(null, 3600, compression, lens);
  idle.snap.params.forEach(param => {
    assert.ok(Number.isFinite(param.value), `idle at ${compression}x: ${param.key} must stay finite`);
    assert.ok(Math.abs(param.state) < 0.05,
      `idle at ${compression}x: ${param.key} drifted to ${param.state.toFixed(3)} with no disturbance`);
  });
  assert.ok(idle.snap.health > 99.9, `idle at ${compression}x: stability must not decay`);
});

// --- 2. Mechanisms move on their declared clocks ---------------------------------------------
// Each check names a limb, the lens it belongs to, and asserts it is inert one decade faster
// and clearly engaged at its own scale. This is what the lens selector is promising a learner.
function heldControl(key, value, simSeconds, compression, lens) {
  const session = engine.createSession('en');
  let next = 0;
  while (session.simTime < simSeconds && !session.dead) {
    if (session.realTime >= next) { engine.setControl(session, key, value); next = session.realTime + 5; }
    engine.tick(session, 0.19, compression, {lens, autoBrake:false});
  }
  return {session, snap:engine.snapshot(session),
    values:Object.fromEntries(engine.snapshot(session).params.map(p => [p.key, p.value]))};
}

// Seconds: the baroreflex has already answered a pressure drop before a minute is out.
const acuteDrop = heldControl('bloodVolume', -60, 20, 1, 'seconds');
assert.ok(acuteDrop.values.symp > 52, `the baroreflex must respond within twenty seconds, got ${acuteDrop.values.symp.toFixed(0)}`);
assert.ok(acuteDrop.values.aldosterone < 1.02 && Math.abs(acuteDrop.session.state.aqp2) < 0.005,
  'the hour and day limbs must be untouched twenty seconds in - that separation is the point');

// Minutes: renin and Ang II. Present at ten minutes, essentially absent at thirty seconds.
const earlyRenin = heldControl('bloodVolume', -70, 30, 1, 'seconds');
const laterRenin = heldControl('bloodVolume', -70, 900, 20, 'minutes');
assert.ok(earlyRenin.values.renin < 1.35, `renin must still be climbing at 30 s, got ${earlyRenin.values.renin.toFixed(2)}`);
assert.ok(laterRenin.values.renin > earlyRenin.values.renin + 0.2,
  'renin must be substantially higher after fifteen minutes than after thirty seconds');

// Hours: aldosterone. It has an effect at fifteen minutes but its main action arrives later.
const earlyAldo = heldControl('bloodVolume', -70, 900, 20, 'minutes');
const laterAldo = heldControl('bloodVolume', -70, 6 * 3600, 240, 'hours');
assert.ok(laterAldo.values.aldosterone > earlyAldo.values.aldosterone + 0.15,
  `aldosterone must keep developing past the first hour: ${earlyAldo.values.aldosterone.toFixed(2)} then ${laterAldo.values.aldosterone.toFixed(2)}`);

// Days: the AQP2 abundance limb of the ADH axis trails the hormone by hours.
assert.ok(Math.abs(earlyAldo.session.state.aqp2) < Math.abs(earlyAldo.session.state.adh) * 0.5,
  'AQP2 abundance must lag well behind the ADH signal at fifteen minutes');
assert.ok(Math.abs(laterAldo.session.state.aqp2) > Math.abs(earlyAldo.session.state.aqp2) * 2,
  'AQP2 abundance must have caught up substantially by six hours');

// --- 3. Interventions run on the intervention clock, not the endogenous one -------------------
// The kidney needs six hours to restore circulating volume. An infusion must not.
const infused = heldControl('bloodVolume', 100, 90, 1, 'seconds');
assert.ok(infused.values.bloodVolume > 5.6,
  `a full-strength infusion must raise volume within ninety seconds, got ${infused.values.bloodVolume.toFixed(2)} L`);
assert.ok(engine.effectiveTau(infused.session, 'bloodVolume') < 30,
  'a full-strength infusion must integrate on the infusion time constant');
// ...and a half-strength one must still be fast, which the old linear tau blend got wrong.
const halfInfused = engine.createSession('en');
engine.setControl(halfInfused, 'sodium', 60);
assert.ok(engine.effectiveTau(halfInfused, 'sodium') < 900,
  'a partial intervention must not inherit most of a twelve-hour endogenous clock');

// --- 4. The solver refuses to step over a crisis ----------------------------------------------
// A patient decompensating fast must be resolved finely even when the days lens is selected,
// and the client must be told the compression it asked for was not delivered.
const crisis = engine.createSession('en');
engine.applyScenario(crisis, 'pulmonaryEmbolism');
let throttled = false, sawSteps = 0;
while (crisis.simTime < 60 && !crisis.dead) {
  const frame = engine.tick(crisis, 0.19, 2880, {lens:'days', autoBrake:false, segment:true});
  sawSteps += frame.segment.steps;
  if (frame.segment.steps > 1) throttled = true;
}
assert.ok(throttled && sawSteps > 20,
  'a fast decompensation must force the solver into many small steps even at the days lens');

// Critical events must stop the frame rather than being discovered in the endpoint.
const braking = engine.createSession('en');
engine.applyScenario(braking, 'hemorrhage');
let braked = false;
for (let frame = 0; frame < 400 && !braking.dead && !braked; frame++) {
  const result = engine.tick(braking, 0.19, 2880, {lens:'days', autoBrake:true, segment:true});
  if (result.segment.braked) braked = true;
}
assert.ok(braked, 'a danger-boundary crossing must interrupt a compressed frame');

// --- 5. The trajectory and event stream ------------------------------------------------------
const traced = engine.createSession('en');
engine.applyScenario(traced, 'renalFailure');
let events = [], sampleCount = 0, richestFrame = 0;
for (let frame = 0; frame < 200 && !traced.dead; frame++) {
  const result = engine.tick(traced, 0.19, 240, {lens:'hours', autoBrake:false, segment:true});
  richestFrame = Math.max(richestFrame, result.segment.times.length);
  events = events.concat(result.segment.events);
  sampleCount += result.segment.times.length;
  result.segment.times.forEach((t, index) => {
    assert.ok(t >= result.segment.from - 1e-6 && t <= result.segment.to + 1e-6,
      'every trajectory sample must fall inside the frame it describes');
    // The envelope is omitted for parameters that stayed flat inside every bin, so only the
    // keys that carry one are checked - and where one is present it must bracket the value.
    Object.keys(result.segment.values).forEach(key => {
      const low=result.segment.lo[key], high=result.segment.hi[key];
      if(!low || !high) return;
      assert.ok(low[index] <= result.segment.values[key][index] + 1e-6 &&
                high[index] >= result.segment.values[key][index] - 1e-6,
        `${key}: the min/max envelope must contain the representative value`);
    });
  });
}
assert.ok(sampleCount > 120, 'a compressed run must return a trajectory, not just endpoints');
assert.ok(richestFrame > 3,
  'a frame that crosses forty-five simulated seconds must describe what happened inside it, not just where it ended');
assert.ok(events.some(e => e.type === 'zone' && e.zone === 'danger'),
  'crossing a danger boundary must emit a timestamped event');
assert.ok(events.every(e => Number.isFinite(e.t) && typeof e.text === 'string' && e.text.length),
  'every event must carry a simulated timestamp and a readable description');

// --- 6. The auto-scaling recommendation ------------------------------------------------------
// It must name the fastest scale that still has work pending, so an acute event pulls a
// learner back from the days lens rather than sliding past underneath it.
const acute = engine.createSession('en');
engine.applyScenario(acute, 'pulmonaryEmbolism');
engine.tick(acute, 0.19, 1, {lens:'seconds'});
assert.equal(engine.snapshot(acute).temporal.recommendedLens, 'seconds',
  'an unfolding obstructive shock must recommend the seconds lens');

const settled = runTo(null, 600, 1, 'seconds');
assert.equal(settled.snap.temporal.recommendedLens, null,
  'a patient at equilibrium must not insist on any particular lens');
assert.ok(settled.snap.temporal.reason.length, 'the recommendation must always carry a reason');

// The recommendation must never send a learner to a scale the patient is dying too fast to be
// watched at. Acute pulmonary oedema is the case that exposed this: thirty seconds in, the
// fast loops have settled and lactate holds the largest pending gap, so the activity rule
// alone recommended the minutes lens - at which the stability bar emptied in under six real
// seconds. Pending activity says which mechanism is interesting; it says nothing about
// legibility, and both are required.
const decompensating = engine.createSession('en');
engine.applyScenario(decompensating, 'acutePulmonaryEdema');
let sawHeldBack = false, worstProjectedLoss = 0;
while (decompensating.simTime < 90 && !decompensating.dead) {
  engine.tick(decompensating, 0.19, 1, {lens:'seconds'});
  const status = engine.snapshot(decompensating).temporal;
  if (status.recommendedLens) {
    const rate = temporal.lensById(status.recommendedLens).rate;
    worstProjectedLoss = Math.max(worstProjectedLoss, status.healthChangeRate * rate);
    assert.ok(status.maxCompression === null || rate <= status.maxCompression,
      `at t=${decompensating.simTime.toFixed(0)}s the recommended lens (${rate}x) exceeds its own legibility ceiling`);
  }
  if (status.heldBack) sawHeldBack = true;
}
assert.ok(worstProjectedLoss <= 4,
  `an automatically chosen lens must never project more than a few stability points per real second, got ${worstProjectedLoss.toFixed(1)}`);
assert.ok(sawHeldBack, 'a patient decompensating in ninety seconds must hold the view back from a faster scale');

// ...and the ceiling must lift again once the patient is no longer deteriorating, or the slow
// lenses would become unreachable for exactly the disorders that need them.
const slowBurn = runTo('renalFailure', 900, 240, 'hours');
assert.ok(slowBurn.snap.temporal.maxCompression === null || slowBurn.snap.temporal.maxCompression >= 20,
  'a slowly evolving disorder must still be allowed to compress time');
assert.ok(!slowBurn.snap.temporal.heldBack,
  'a stable patient must not be held back from the faster scales');

// The recommendation must be readable in both languages, because it is shown to the learner.
['zh','en'].forEach(language => {
  const session = engine.createSession(language);
  engine.applyScenario(session, 'renalFailure');
  engine.tick(session, 0.19, 240, {lens:'hours'});
  const status = engine.snapshot(session).temporal;
  assert.ok(status.reason && status.reason.length > 8, `${language}: the reason must be a sentence`);
  if (status.recommendedLens) assert.ok(status.driverLabel, `${language}: the reason must name what is moving`);
});

// --- 7. Compensation physiology, read off the numbers themselves -----------------------------
// The compensation-ledger panel was removed on 2026-08-01, so these now assert the physiology
// directly rather than the panel that used to summarise it. That is the stronger test: the
// panel could have agreed with a wrong model.
//
// Winter's formula: in a metabolic acidosis the expected PaCO2 is 1.5*HCO3- + 8 (+/-2).
const acidotic = heldControl('lactate', 100, 1200, 20, 'minutes');
const acidValue = key => acidotic.snap.params.find(p => p.key === key).value;
const winters = 1.5 * acidValue('bicarbonate') + 8;
assert.ok(Math.abs(acidValue('paCO2') - winters) <= 4,
  `respiratory compensation must land on Winter's formula: PaCO2 ${acidValue('paCO2').toFixed(1)} vs expected ${winters.toFixed(1)}`);
assert.ok(acidValue('pH') < 7.40, 'respiratory compensation must not fully correct the pH');

// The renal limb runs on days, so twenty minutes of CO2 retention must barely move HCO3-, and
// five days must move it a great deal more. That contrast is the whole teaching point.
const retained = heldControl('ventilation', -50, 1200, 20, 'minutes');
const chronicRetained = heldControl('ventilation', -50, 5 * 86400, 2880, 'days');
const hco3 = run => run.snap.params.find(p => p.key === 'bicarbonate').value;
assert.ok(hco3(chronicRetained) > hco3(retained) + 2,
  `five days of CO2 retention must regenerate more HCO3- than twenty minutes: ${hco3(retained).toFixed(1)} -> ${hco3(chronicRetained).toFixed(1)} mmol/L`);

// The fast subsystem is solved algebraically at coarse lenses, so it has to actually converge
// there. A high-gain chemoreflex loop that is merely bounded rather than settled shows up as
// ventilation limit-cycling frame to frame, which at the days lens made a chronic CO2 retainer
// read as a different patient on every sample.
function ventilationSwing(compression, lens, simSeconds){
  const session = engine.createSession('en');
  let next = 0, sampleAt = simSeconds / 2, samples = [];
  while (session.simTime < simSeconds && !session.dead) {
    if (session.realTime >= next) { engine.setControl(session, 'ventilation', -50); next = session.realTime + 5; }
    engine.tick(session, 0.19, compression, {lens, autoBrake:false});
    if (session.simTime >= sampleAt) {
      sampleAt += simSeconds / 20;
      samples.push(engine.snapshot(session).params.find(p => p.key === 'ventilation').value);
    }
  }
  return {swing:Math.max(...samples) - Math.min(...samples), samples};
}
const steadySwing = ventilationSwing(2880, 'days', 5 * 86400);
assert.ok(steadySwing.swing < 0.6,
  `under a steady stimulus the quasi-steady-state solve must settle, not oscillate; ventilation swung ${steadySwing.swing.toFixed(2)} L/min`);

// Vicious cycles must surface only when every link is actually carrying, and must name a way out.
const spiralling = runTo('sepsis', 900, 20, 'minutes');
const cycles = spiralling.snap.viciousCycles;
assert.ok(Array.isArray(cycles), 'vicious cycles must be reported as a list');
cycles.forEach(cycle => {
  assert.ok(cycle.severity > 0 && cycle.path.length >= 3, `${cycle.id}: a cycle must name the loop it runs on`);
  assert.ok(cycle.breakPoint && cycle.breakPoint.length > 20, `${cycle.id}: a cycle must say where to break it`);
});
assert.ok(typeof findViciousCycles === 'function', 'the cycle detector must be independently importable');
const healthy = runTo(null, 300, 1, 'seconds');
assert.equal(healthy.snap.viciousCycles.length, 0, 'a stable patient must raise no vicious cycles');

// --- 8. Published time metadata --------------------------------------------------------------
['zh','en'].forEach(language => {
  const published = engine.meta(language).time;
  assert.equal(published.lenses.length, 4, `${language}: four lenses must be published`);
  published.lenses.forEach(lens => {
    assert.ok(lens.label && lens.title && lens.focus, `${language}: lens ${lens.id} must be fully labelled`);
    assert.ok(lens.windowText && lens.rateText, `${language}: lens ${lens.id} must state its window and compression in words`);
    // The promise the control makes: one full observation window takes about REPLAY_SECONDS
    // of real time to watch, whichever lens you are on.
    const replay = lens.window / lens.rate;
    assert.ok(Math.abs(replay - temporal.REPLAY_SECONDS) <= temporal.REPLAY_SECONDS * 0.35,
      `lens ${lens.id} replays its window in ${replay.toFixed(0)} s, expected about ${temporal.REPLAY_SECONDS} s`);
  });
  Object.entries(published.hiddenStates).forEach(([key, hidden]) => {
    assert.ok(hidden.owner && hidden.label && hidden.tauText, `${language}: hidden state ${key} must be described`);
  });
});
// A time constant nobody can check is not a time constant.
Object.values(temporal.PROFILES).forEach(profile => {
  assert.ok(profile.sources.length, 'every parameter must cite a source for its time constant');
  profile.sources.forEach(id => assert.ok(temporal.TIME_SOURCES[id], `unknown time source ${id}`));
});

console.log('Temporal regression passed: cross-scale reproduction, mechanism clocks, event stream, auto-scaling, compensation physiology, vicious cycles, and published metadata.');
