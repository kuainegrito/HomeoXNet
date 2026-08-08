'use strict';

const assert = require('node:assert/strict');
const engine = require('./simEngine');

function runScenario(name, seconds = 300, treatment = null, dt = 0.16) {
  const session = engine.createSession('en');
  engine.applyScenario(session, name);
  let minimumHealth = 100;
  let nextTreatment = 0;
  while (session.simTime < seconds && !session.dead) {
    if (treatment && session.simTime >= nextTreatment) {
      Object.entries(treatment).forEach(([key, value]) => engine.setControl(session, key, value));
      nextTreatment += 15;
    }
    const snap = engine.tick(session, dt, 1);
    minimumHealth = Math.min(minimumHealth, snap.health);
    snap.params.forEach(param => {
      assert.ok(Number.isFinite(param.value), `${name}: ${param.key} must remain finite`);
      assert.ok(param.value >= 0, `${name}: ${param.key} must not become negative`);
    });
  }
  return { session, snap: engine.snapshot(session), minimumHealth };
}

// Windows are much wider apart than they used to be, because the mechanisms are. With
// literature time constants an obstructive shock and an evolving acute kidney injury no longer
// decompensate on the same schedule, so a single 300-second observation horizon cannot serve
// both - the horizon is now derived from the window under test.
function expectDeathBetween(name, low, high) {
  const result = runScenario(name, high * 1.4, null, high > 600 ? 0.5 : 0.16);
  assert.equal(result.session.dead, true, `${name}: expected untreated decompensation`);
  assert.ok(result.session.simTime >= low && result.session.simTime <= high,
    `${name}: death at ${result.session.simTime.toFixed(1)} s, expected ${low}-${high} s`);
}

function expectAliveRange(name, minimumLow, minimumHigh, finalLow = 0, seconds = 300) {
  const result = runScenario(name, seconds);
  assert.equal(result.session.dead, false, `${name}: should remain alive through ${seconds} simulated seconds`);
  assert.ok(result.minimumHealth >= minimumLow && result.minimumHealth <= minimumHigh,
    `${name}: minimum health ${result.minimumHealth.toFixed(1)}, expected ${minimumLow}-${minimumHigh}`);
  assert.ok(result.snap.health >= finalLow, `${name}: final health should be at least ${finalLow}`);
}

function runSustainedControl(key, value, seconds = 180) {
  const session = engine.createSession('en');
  let nextTreatment = 0;
  let minimumHealth = 100;
  while (session.simTime < seconds && !session.dead) {
    if (session.simTime >= nextTreatment) {
      engine.setControl(session, key, value);
      nextTreatment += 15;
    }
    const snap = engine.tick(session, 0.16, 1);
    minimumHealth = Math.min(minimumHealth, snap.health);
  }
  return {session, snap:engine.snapshot(session), minimumHealth};
}

// Untreated decompensation windows, grouped by how fast the mechanism actually is. Before the
// temporal rebuild every one of these fell between 70 and 300 seconds, which taught learners
// that all emergencies move at the same speed. They no longer do, and the spread below is the
// clinically meaningful part: an airway or obstructive catastrophe kills in a couple of
// minutes, an endocrine or renal one takes tens of minutes to an hour.

// Under two and a half minutes: obstruction, airway, and failures of oxygen delivery.
expectDeathBetween('opioidOverdose', 63, 121);
expectDeathBetween('pulmonaryEmbolism', 63, 121);
expectDeathBetween('lacticAcidosis', 63, 121);
expectDeathBetween('acutePulmonaryEdema', 70, 134);
expectDeathBetween('cardiacTamponade', 70, 135);
expectDeathBetween('unstableArrhythmia', 81, 156);
expectDeathBetween('severeAnemia', 87, 166);
expectDeathBetween('co2', 90, 172);
expectDeathBetween('asthma', 92, 177);
expectDeathBetween('tensionPneumothorax', 93, 178);
expectDeathBetween('cardiogenicShock', 96, 184);

// Minutes: airway obstruction with a compensating patient, and circulatory or osmotic
// disturbances that need volume or hormone to resolve. Renal HCO3- regeneration now runs on
// its true 3-5 day clock, so it no longer part-rescues a CO2 retainer inside one run.
expectDeathBetween('copdExacerbation', 139, 266);
expectDeathBetween('anaphylaxis', 159, 304);
expectDeathBetween('siadh', 250, 479);
expectDeathBetween('hemorrhage', 259, 496);
expectDeathBetween('hypertensiveCrisis', 263, 504);
expectDeathBetween('dehydration', 329, 630);

// Tens of minutes: endocrine, osmotic, and electrolyte disorders. These are the ones the
// minutes and hours lenses exist for; watched at 1x they look like nothing is happening.
expectDeathBetween('insulin', 489, 938);
expectDeathBetween('hyperosmolar', 510, 978);
expectDeathBetween('hypokalemia', 539, 1032);
expectDeathBetween('myxedemaComa', 650, 1245);
expectDeathBetween('adrenalCrisis', 959, 1839);
expectDeathBetween('diabetesInsipidus', 1102, 2113);
expectDeathBetween('statusEpilepticus', 1211, 2320);

// Three quarters of an hour and beyond: the slow renal and metabolic limbs.
expectDeathBetween('diabetes', 1870, 3584);
expectDeathBetween('sepsis', 2228, 4270);
expectDeathBetween('renalFailure', 2455, 4705);

// Sub-acute by construction: these settle into a compensated but costly steady state rather
// than decompensating. Recognising a patient who is stable-but-wrong is a different clinical
// skill from managing a countdown, and the model can now represent both.
expectAliveRange('salicylateToxicity', 70, 90, 70, 6 * 3600);
expectAliveRange('oliguria', 70, 90, 70, 6 * 3600);

// Self-limiting disturbances still resolve on their own.
expectAliveRange('respiratoryAlkalosis', 95, 100, 95);
expectAliveRange('salt', 95, 100, 95);
expectAliveRange('exercise', 95, 100, 95);

// The spread above is the whole point of the temporal rebuild, so it is asserted directly:
// before it, every untreated challenge decompensated within a single 70-300 second band.
function untreatedDeathTime(name, horizon){
  const session = engine.createSession('en');
  engine.applyScenario(session, name);
  while (session.simTime < horizon && !session.dead) engine.tick(session, 0.5, 1);
  return session.dead ? session.simTime : Infinity;
}
const fastest = untreatedDeathTime('pulmonaryEmbolism', 600);
const slowest = untreatedDeathTime('renalFailure', 7200);
assert.ok(slowest / fastest > 20,
  `fastest and slowest untreated challenges must differ by more than an order of magnitude, got ${fastest.toFixed(0)} s and ${slowest.toFixed(0)} s`);

const randomResult = runScenario('random', 180);
assert.ok(Number.isFinite(randomResult.minimumHealth), 'random: result must remain finite');

// --- Polyuria is an hours-scale process, and the model must say so ------------------------
// Urine is an outflow from the volume pool, so depletion accumulates at the rate water is
// actually lost. Losing a litre takes hours, which is why a diabetes-insipidus patient
// presents with a rising sodium long before a falling pressure. The pair of assertions below
// pins both ends of that: almost nothing at three minutes, a clear deficit at twelve hours.
function forcedPolyuria(simSeconds, compression, lens){
  const session = engine.createSession('en');
  let nextTreatment = 0;
  while (session.simTime < simSeconds && !session.dead) {
    if (session.realTime >= nextTreatment) { engine.setControl(session, 'urine', 100); nextTreatment = session.realTime + 5; }
    engine.tick(session, 0.19, compression, {lens, autoBrake:false});
  }
  const snap = engine.snapshot(session);
  return {session, snap, values:Object.fromEntries(snap.params.map(p => [p.key, p.value]))};
}

const briefPolyuria = forcedPolyuria(180, 1, 'seconds');
assert.ok(briefPolyuria.values.urine > 2.1, 'forced diuresis must cross the polyuria threshold within minutes');
assert.ok(briefPolyuria.values.bloodVolume > 4.9,
  `three minutes of polyuria must not yet deplete circulating volume, got ${briefPolyuria.values.bloodVolume.toFixed(2)} L`);

const sustainedPolyuria = forcedPolyuria(12 * 3600, 240, 'hours');
const raisedUrineParams = sustainedPolyuria.values;
assert.ok(raisedUrineParams.urine > 2.1, 'sustained high urine flow must stay above the polyuria threshold');
assert.ok(raisedUrineParams.bloodVolume < 4.85,
  `twelve hours of unreplaced polyuria must deplete circulating volume, got ${raisedUrineParams.bloodVolume.toFixed(2)} L`);
// This used to assert that BOTH ADH and renin rose. It passed for the wrong reason: the sodium
// term in t.sodium had the wrong sign, so a diuresis lowered the plasma sodium, which removed
// the macula densa's suppression of renin and let it drift up. With the sign corrected the
// compensation splits the way it does in a patient, and the split is the teaching point - so it
// is now asserted in three parts rather than one.
assert.ok(raisedUrineParams.adh > 1.25,
  `sustained polyuria must recruit ADH, got ${raisedUrineParams.adh.toFixed(2)}`);
assert.ok(raisedUrineParams.sodium > 143 && raisedUrineParams.osm > 292,
  `unreplaced water diuresis must concentrate the plasma, got Na+ ${raisedUrineParams.sodium.toFixed(1)} and ${raisedUrineParams.osm.toFixed(0)} mOsm/kg`);
// ...and RAAS stays quiet while it does. The macula densa sees the rising NaCl, and ADH is
// holding the volume deficit to about 0.2 L, so there is little for a volume sensor to answer:
// a water diuresis is an osmotic emergency well before it is a circulatory one.
assert.ok(raisedUrineParams.renin < 1.05,
  `a water diuresis with a rising sodium must not recruit renin, got ${raisedUrineParams.renin.toFixed(2)}`);
assert.ok(sustainedPolyuria.snap.conditions.some(condition => condition.id === 'polyuria'),
  'sustained high urine flow must be identified as polyuria');
// Compensation holds the deficit but cannot erase it, so the cost shows up on the slow damage
// clock rather than the fast one: hours of mild abnormality cost stability without being
// anywhere near immediately lethal. Under the old single-clock damage model this same run
// would have been fatal long before the twelfth hour.
const dayLongPolyuria = forcedPolyuria(24 * 3600, 240, 'hours');
assert.equal(dayLongPolyuria.session.dead, false, 'compensated polyuria must not be acutely fatal');
assert.ok(dayLongPolyuria.snap.health < 92 && dayLongPolyuria.snap.health > 60,
  `a day of compensated polyuria should cost stability slowly, got ${dayLongPolyuria.snap.health.toFixed(1)}`);
assert.ok(dayLongPolyuria.snap.chronicBurden > dayLongPolyuria.snap.acuteBurden,
  'the cost of a day of mild abnormality must be booked as chronic burden, not acute damage');

const loweredUrine = runSustainedControl('urine', -100);
const loweredUrineParams = Object.fromEntries(loweredUrine.snap.params.map(param => [param.key, param.value]));
assert.ok(loweredUrineParams.urine < .3, 'sustained low urine flow must cross the oliguria threshold');
assert.ok(loweredUrine.minimumHealth >= 95,
  'isolated oliguria with preserved perfusion and GFR should not independently cause major Stability loss');
assert.ok(loweredUrine.snap.conditions.some(condition => condition.id === 'oliguria'),
  'sustained low urine flow must be identified as oliguria');

// --- The three acid-base clocks must stay separated ----------------------------------------
// Driven by a direct acid load rather than by the lactic-acidosis scenario, so that this tests
// the model's acid-base structure and not that scenario's lethality tuning. The scenario kills
// through hypoxaemia in about ninety seconds, which is correct for it but leaves no window in
// which to read a settled acid-base picture.
function acidLoad(strength, simSeconds){
  const session = engine.createSession('en');
  let next = 0;
  while (session.simTime < simSeconds && !session.dead) {
    if (session.realTime >= next) { engine.setControl(session, 'lactate', strength); next = session.realTime + 5; }
    engine.tick(session, 0.19, 20, {lens:'minutes', autoBrake:false});
  }
  return {session, params:Object.fromEntries(engine.snapshot(session).params.map(p => [p.key, p.value]))};
}
const acid = acidLoad(100, 1200);
const lacticParams = acid.params;

// Blood buffering (seconds-minutes): a strong acid titrates bicarbonate close to 1:1, which is
// what makes the anion gap widen by the same amount the bicarbonate falls.
const lactateRise = lacticParams.lactate - 1.0;
const bicarbonateFall = 24 - lacticParams.bicarbonate;
assert.ok(lactateRise > 4, `acid load: expected a clear lactate rise, got ${lactateRise.toFixed(1)} mmol/L`);
assert.ok(Math.abs(bicarbonateFall / lactateRise - 1) < 0.25,
  `acid load: bicarbonate should be titrated ~1:1 by lactate, got ${bicarbonateFall.toFixed(1)} per ${lactateRise.toFixed(1)} mmol/L`);
assert.ok(lacticParams.pH < 7.38, `acid load: expected acidemia, got pH ${lacticParams.pH.toFixed(2)}`);

// Pulmonary compensation (minutes): PaCO2 should settle on Winter's formula from the acid load
// alone, with no hypoxic drive helping, and must remain incomplete - respiratory compensation
// never returns pH to normal.
[40, 70, 100].forEach(strength => {
  const run = acidLoad(strength, 1200).params;
  const predicted = 1.5 * run.bicarbonate + 8;
  assert.ok(Math.abs(run.paCO2 - predicted) <= 4,
    `acid load ${strength}: PaCO2 ${run.paCO2.toFixed(1)} should approximate Winter's ${predicted.toFixed(1)} mmHg`);
  assert.ok(run.pH < 7.40, `acid load ${strength}: respiratory compensation must not fully correct pH`);
});

// Renal compensation (3-5 days): twenty simulated minutes is nothing on that clock, so the
// slow pool must be effectively motionless. This is the widest time separation in the model
// and the reason a lactic acidosis cannot be waited out.
assert.ok(Math.abs(acid.session.state.hco3Renal) < 0.02,
  `acid load: renal bicarbonate pool should barely move in 20 minutes, got ${acid.session.state.hco3Renal.toFixed(4)}`);
// ...and over days it must genuinely regenerate bicarbonate. A sustained respiratory acidosis
// is the cleanest demonstration, because the acute and chronic expectations are different
// published numbers - about 1 mmol/L of HCO3- per 10 mmHg of PaCO2 within minutes from
// non-bicarbonate buffers, about 3.5 after 3-5 days of renal work. A model that cannot
// separate those cannot tell an acute exacerbation from a chronic retainer, which is the
// single most common bedside use of a blood gas.
function hypoventilate(strength, simSeconds, compression, lens){
  const session = engine.createSession('en');
  let next = 0;
  while (session.simTime < simSeconds && !session.dead) {
    if (session.realTime >= next) { engine.setControl(session, 'ventilation', strength); next = session.realTime + 5; }
    engine.tick(session, 0.19, compression, {lens, autoBrake:false});
  }
  return {session, params:Object.fromEntries(engine.snapshot(session).params.map(p => [p.key, p.value]))};
}
const acuteRetention = hypoventilate(-50, 1200, 20, 'minutes');
const chronicRetention = hypoventilate(-50, 5 * 86400, 2880, 'days');
assert.ok(Math.abs(acuteRetention.session.state.hco3Renal) < 0.02,
  'twenty minutes of CO2 retention must not move the renal bicarbonate pool');
assert.ok(chronicRetention.session.state.hco3Renal > 0.15,
  `five days of CO2 retention must regenerate bicarbonate, got ${chronicRetention.session.state.hco3Renal.toFixed(3)}`);
assert.ok(chronicRetention.params.bicarbonate - acuteRetention.params.bicarbonate > 1.5,
  `a chronic retainer must carry a clearly higher HCO3- than an acute one: ${acuteRetention.params.bicarbonate.toFixed(1)} vs ${chronicRetention.params.bicarbonate.toFixed(1)} mmol/L`);
assert.ok(chronicRetention.params.pH > acuteRetention.params.pH,
  'renal compensation over days must bring pH back toward normal');

// Therefore base alone cannot fix it, but restoring oxygen delivery can.
const bicarbOnly = runScenario('lacticAcidosis', 300, {bicarbonate: 100});
assert.equal(bicarbOnly.session.dead, true,
  'lactic acidosis: giving bicarbonate without correcting hypoxia must not rescue the patient');

// --- pH and potassium: two mechanisms, two clocks, both directions --------------------------
// Plasma K+ is now kBody plus a shift, so the model can distinguish redistribution from
// depletion. Clinically that is the difference between "correct the pH and the potassium
// follows" and "this patient has genuinely lost potassium and must be replaced", and the only
// thing that separates them is how long the alkalosis has been running.
function acidBaseK(seconds, control, compression = 20, lens = 'minutes'){
  const s = engine.createSession('en');
  let next = 0;
  while (s.simTime < seconds && !s.dead){
    if (s.realTime >= next){ Object.entries(control).forEach(([k, v]) => engine.setControl(s, k, v)); next = s.realTime + 5; }
    engine.tick(s, 0.19, compression, {lens, autoBrake:false});
  }
  const snap = engine.snapshot(s);
  return {session:s, snap, params:Object.fromEntries(snap.params.map(x => [x.key, x.value])), conditions:snap.conditions};
}

// The forced-ventilation drive is 100 rather than the 70 these checks used to carry, and the
// reason is a model correction rather than a moved goalpost: the chemoreflex now answers to
// alkalemia, so the hyperventilation it produces is opposed by the alkalosis it causes. Reaching
// the same pH therefore takes more drive than it did when nothing pushed back. The thing under
// test is unchanged and is checked directly below - K+ still shifts 0.31 mmol/L per 0.1 pH unit,
// exactly as before, and the tempo assertions below still bracket the same clock.

// The shift takes 5-30 minutes, so at two minutes it must be visibly incomplete. Under the old
// 14-second potassium constant it was already finished here, which taught the wrong tempo.
const earlyAlkalosis = acidBaseK(120, {ventilation: 100}, 1, 'seconds');
assert.ok(earlyAlkalosis.params.pH > 7.45,
  `hyperventilation: expected alkalemia within two minutes, got pH ${earlyAlkalosis.params.pH.toFixed(2)}`);
assert.ok(earlyAlkalosis.params.potassium > 3.85,
  `the transcellular shift must still be incomplete at two minutes, got K+ ${earlyAlkalosis.params.potassium.toFixed(2)} mmol/L`);

// By fifteen minutes it has run, and it is redistribution only: total-body potassium is intact.
const hyperventilated = acidBaseK(900, {ventilation: 100});
assert.ok(hyperventilated.params.potassium < 3.8,
  `respiratory alkalosis must cause hypokalemia within 15 min, got K+ ${hyperventilated.params.potassium.toFixed(2)} mmol/L`);
assert.ok(Math.abs(hyperventilated.session.state.kBody) < 0.02,
  'at fifteen minutes the hypokalemia must be redistribution, with total-body potassium unchanged');

// Days of the same alkalosis convert the shift into a real deficit through renal K+ loss.
const chronicAlkalosis = acidBaseK(2 * 86400, {ventilation: 100}, 2880, 'days');
assert.ok(chronicAlkalosis.session.state.kBody < -0.04,
  `a sustained alkalosis must become a genuine total-body deficit, got ${chronicAlkalosis.session.state.kBody.toFixed(3)}`);

const baseLoaded = acidBaseK(900, {bicarbonate: 90});
assert.ok(baseLoaded.params.bicarbonate > 28 && baseLoaded.params.pH > 7.45,
  'bicarbonate load must produce a metabolic alkalosis');
assert.ok(baseLoaded.params.potassium < 4.0,
  `metabolic alkalosis must lower K+, got ${baseLoaded.params.potassium.toFixed(2)} mmol/L`);

// The shift is roughly 0.2-0.8 mmol/L of K+ per 0.1 pH unit in either direction.
const perTenth = (4.2 - baseLoaded.params.potassium) / ((baseLoaded.params.pH - 7.40) / 0.1);
assert.ok(perTenth > 0.2 && perTenth < 0.8,
  `K+ shift should be 0.2-0.8 mmol/L per 0.1 pH, got ${perTenth.toFixed(2)}`);

// ...and the acidemic direction must still hold: acidosis drives K+ out of cells.
const acidemic = acidBaseK(900, {ventilation: -70});
assert.ok(acidemic.params.pH < 7.35, `hypoventilation: expected acidemia, got pH ${acidemic.params.pH.toFixed(2)}`);
assert.ok(acidemic.params.potassium > 4.2,
  `respiratory acidosis must raise K+, got ${acidemic.params.potassium.toFixed(2)} mmol/L`);

// Sustained alkalosis should be named as the cause, not just reported as a low number.
assert.ok(hyperventilated.conditions.some(c => c.id === 'hypoK'),
  'sustained alkalosis must raise a hypokalemia condition');
// ...and it must be redistribution rather than depletion, because that is what decides whether
// to replace potassium or to fix the pH. Total body potassium is the hidden pool that tells
// them apart: at fifteen minutes it should be virtually untouched while plasma K+ has fallen.
assert.ok(Math.abs(hyperventilated.session.state.kBody) < 0.05,
  `at fifteen minutes a hypokalemia must be redistribution, not depletion: kBody ${hyperventilated.session.state.kBody.toFixed(3)}`);

const renalScenarios = engine.meta('en').scenarios;
assert.ok(renalScenarios.diabetesInsipidus && renalScenarios.oliguria,
  'renal scenarios must include both diabetes insipidus and oliguria');

const rescueCases = {
  hemorrhage: {bloodVolume:100, venousReturn:70},
  anaphylaxis: {tpr:100, airway:-100, bloodVolume:100, ventilation:80},
  pulmonaryEmbolism: {venousReturn:100, co:100, paO2:100, tissueO2:80},
  tensionPneumothorax: {airway:-100, ventilation:100, venousReturn:100},
  cardiacTamponade: {venousReturn:100, co:100},
  cardiogenicShock: {contractility:100, co:50},
  acutePulmonaryEdema: {contractility:100, airway:-80, paO2:100, ventilation:60},
  asthma: {airway:-100, ventilation:90},
  opioidOverdose: {ventilation:100, chemo:100},
  copdExacerbation: {airway:-100, ventilation:80},
  co2: {ventilation:100},
  // No bicarbonate here. This patient is already alkalaemic from the respiratory drive, and
  // adding base is harmful - see the assertion below, which pins that as a teaching point.
  salicylateToxicity: {lactate:-80, bloodVolume:60, glucose:40},
  diabetes: {insulin:100, bicarbonate:90, bloodVolume:70},
  adrenalCrisis: {aldosterone:100, bloodVolume:100, sodium:60, potassium:-50, glucose:60, tpr:60},
  myxedemaComa: {hr:60, ventilation:100, sodium:50, metDemand:60},
  renalFailure: {gfr:100, potassium:-25},
  hypokalemia: {potassium:100, aldosterone:-70, urine:-50},
  diabetesInsipidus: {adh:100, urine:-100, bloodVolume:100, sodium:-80, osm:-60},
  lacticAcidosis: {paO2:100, ventilation:60, co:50},
  severeAnemia: {hct:100, tissueO2:100},
  statusEpilepticus: {metDemand:-100, lactate:-100, glucose:60},
  sepsis: {bloodVolume:100, tpr:70, tissueO2:80, lactate:-60},
  insulin: {glucose:100, insulin:-100, glucagon:60},
  hyperosmolar: {insulin:70, bloodVolume:100, glucose:-70, osm:-50},
  dehydration: {bloodVolume:100, sodium:-60, osm:-50},
  siadh: {adh:-100, sodium:70, urine:60},
  hypertensiveCrisis: {tpr:-100, urine:50},
  unstableArrhythmia: {rhythmStability:100, hr:-60},
  oliguria: {map:60, bloodVolume:80, gfr:100}
};
// Held for thirty simulated minutes, which is longer than the slowest untreated challenge in
// the acute group takes to decompensate. Under the old model a 300-second window was enough
// to test everything; now it would not even reach the point where half of these become
// dangerous.
Object.entries(rescueCases).forEach(([name, treatment]) => {
  const result = runScenario(name, 1800, treatment, 0.5);
  assert.equal(result.session.dead, false, `${name}: proportionate repeated support should prevent death`);
});

// Treating the number instead of the patient must still be punished. Salicylate toxicity is
// the sharpest case: the patient is alkalaemic from the respiratory drive, so the reflex to
// give bicarbonate for the metabolic acidosis pushes pH past 7.6 and kills them.
const overAlkalinised = runScenario('salicylateToxicity', 1800,
  {bicarbonate:100, lactate:-80, bloodVolume:60}, 0.5);
assert.equal(overAlkalinised.session.dead, true,
  'giving base to an already alkalaemic salicylate patient must be harmful, not merely unhelpful');

console.log(`Scenario regression passed: ${Object.keys(engine.meta('en').scenarios).length} untreated challenges and ${Object.keys(rescueCases).length} rescue strategies.`);
