'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./simEngine');

const meta=engine.meta('en');
assert.equal(meta.modelSchemaVersion,'1.0.0');
assert.equal(meta.defs.length,34);
assert.ok(meta.modelSources.homeostasisModel,'shared model source must be exported');

meta.defs.forEach(definition=>{
  const model=definition.model;
  assert.ok(model,`${definition.key}: model schema must be present`);
  assert.ok(model.unitKind,`${definition.key}: unit kind must be declared`);
  assert.ok(model.unitRationale,`${definition.key}: unit rationale must be declared`);
  assert.ok(model.equation?.description,`${definition.key}: equation description must be declared`);
  assert.ok(Array.isArray(model.assumptions) && model.assumptions.length,`${definition.key}: assumptions must be declared`);
  assert.ok(Array.isArray(model.inputKeys),`${definition.key}: input relationship must be declared`);
  assert.ok(Array.isArray(model.outputKeys),`${definition.key}: output relationship must be declared`);
  assert.ok(model.sourceIds.length,`${definition.key}: at least one source must be declared`);
  model.sourceIds.forEach(id=>assert.ok(meta.modelSources[id],`${definition.key}: missing source ${id}`));
});

const byKey=Object.fromEntries(meta.defs.map(definition=>[definition.key,definition]));
assert.equal(byKey.insulin.model.unitKind,'relative-effect','insulin is a modelled effect, not a serum insulin assay');
assert.equal(byKey.glucagon.model.unitKind,'relative-effect','glucagon is a modelled effect, not a plasma assay');
assert.equal(byKey.renin.model.unitKind,'relative-effect','renin must not silently claim PRA or direct-renin units');
assert.equal(byKey.adh.model.unitKind,'relative-effect','ADH must not silently claim a plasma AVP unit');
assert.equal(byKey.tissueO2.model.unitKind,'physiological-index','tissue oxygen delivery is an integrated index');
assert.ok(meta.modelSources.insulinAssay.url.startsWith('https://'));
assert.ok(meta.modelSources.glucagonAssay.url.startsWith('https://'));

const session=engine.createSession('en');
engine.applyScenario(session,'hemorrhage');
engine.setControl(session,'map',35);
meta.defs.forEach(definition=>{
  const explanation=engine.explainParameter(session,definition.key);
  assert.ok(Number.isFinite(explanation.targetState),`${definition.key}: target state must be finite`);
  assert.ok(Number.isFinite(explanation.targetDelta),`${definition.key}: target delta must be finite`);
  assert.equal(explanation.contributionMethod,'one-at-a-time-baseline-ablation');
  assert.ok(Array.isArray(explanation.contributions),`${definition.key}: contribution list must be present`);
  explanation.contributions.forEach(term=>{
    assert.ok(Number.isFinite(term.value),`${definition.key}: contribution must be finite`);
    assert.ok(['state','manual-control','scenario-driver','scenario-flux'].includes(term.kind),`${definition.key}: contribution type must be known`);
  });
});
assert.ok(engine.explainParameter(session,'map').contributions.some(term=>term.kind==='manual-control'),
  'manual MAP control must appear in the current contribution ledger');
// Ongoing haemorrhage is a flux out of a pool, not a lower set point, so it must be reported
// as a rate. If it ever reappears as a set-point driver the model has quietly gone back to
// saying the kidney is targeting a lower volume, which is a different disease.
const volumeTerms=engine.explainParameter(session,'bloodVolume').contributions;
const bleeding=volumeTerms.find(term=>term.kind==='scenario-flux');
assert.ok(bleeding,'ongoing haemorrhage must appear in the blood-volume ledger as a flux');
assert.ok(bleeding.perMinute && bleeding.value<0,'the haemorrhage flux must be a negative per-minute rate');
assert.ok(!volumeTerms.some(term=>term.kind==='scenario-driver'),
  'a flux driver must not also be applied as a set-point bias');

// Every parameter must carry a time profile, and it must be the same number the solver uses.
meta.defs.forEach(definition=>{
  const profile=definition.temporal;
  assert.ok(profile,`${definition.key}: temporal profile must be present`);
  assert.ok(profile.layer && profile.tau>0,`${definition.key}: time layer and tau must be declared`);
  assert.ok(profile.directTau>0,`${definition.key}: direct-intervention tau must be declared`);
  assert.ok(profile.phases.length,`${definition.key}: at least one mechanism phase must be described`);
  assert.ok(profile.sources.length && profile.sources.every(s=>s.url.startsWith('https://')),
    `${definition.key}: time constants must cite a source`);
  const idle=engine.createSession('en');
  assert.ok(Math.abs(engine.effectiveTau(idle,definition.key)-profile.tau)<1e-9,
    `${definition.key}: an untouched parameter must integrate at its endogenous tau`);
});
// ...and a parameter the learner is actively driving must move on the intervention clock.
const driven=engine.createSession('en');
engine.setControl(driven,'bloodVolume',100);
assert.ok(engine.effectiveTau(driven,'bloodVolume') < 60,
  'a full-strength infusion must not wait for the six-hour endogenous volume clock');

assert.ok(meta.time.lenses.length===4 && meta.time.lenses.every(lens=>lens.window>0 && lens.rate>0),
  'the four observation lenses must be published with their windows and compression rates');

const frontendSource=fs.readFileSync(path.join(__dirname,'../frontend/app.js'),'utf8');
assert.match(frontendSource,/class="model-transparency"\$\{modelTransparencyOpen\?' open':''\}/,
  'model transparency details must preserve its open state across snapshot renders');
assert.match(frontendSource,/addEventListener\('toggle',\(\)=>\{ modelTransparencyOpen=transparency\.open; \}\)/,
  'model transparency details must persist user toggle changes');
assert.match(frontendSource,/\.filter,\.model-transparency,\.modal-card/,
  'clicking model transparency must not clear the selected parameter');

console.log('model transparency regression passed');
