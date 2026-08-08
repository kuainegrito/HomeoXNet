'use strict';

const {localizedSchema, localizedSources} = require('./modelSchema');
const temporal = require('./temporalModel');
const {findViciousCycles} = require('./compensation');

const GROUPS = {
  cv: { zh: '心血管', en: 'Cardiovascular' },
  neuro: { zh: '神经体液', en: 'Neurohumoral' },
  renal: { zh: '肾脏体液', en: 'Renal & Fluid' },
  resp: { zh: '呼吸酸碱', en: 'Resp. & Acid-base' },
  meta: { zh: '代谢血液', en: 'Metab. & Blood' }
};

const DEF_DATA = [
  {key:'map', label:{zh:'平均动脉压', en:'Mean arterial pressure'}, short:{zh:'MAP', en:'MAP'}, group:'cv', unit:{zh:'mmHg', en:'mmHg'}, base:93, scale:35, warn:[65,145], danger:[45,180], tau:1.8, gain:1.0, weight:2.2},
  {key:'hr', label:{zh:'心率', en:'Heart rate'}, short:{zh:'HR', en:'HR'}, group:'cv', unit:{zh:'bpm', en:'bpm'}, base:75, scale:45, warn:[50,140], danger:[30,190], tau:2.5, gain:1.0, weight:1.1},
  {key:'sv', label:{zh:'每搏量', en:'Stroke volume'}, short:{zh:'SV', en:'SV'}, group:'cv', unit:{zh:'mL', en:'mL'}, base:70, scale:35, warn:[45,110], danger:[25,150], tau:3.2, gain:1.0, weight:1.2},
  {key:'co', label:{zh:'心输出量', en:'Cardiac output'}, short:{zh:'心输出量', en:'CO'}, group:'cv', unit:{zh:'L/min', en:'L/min'}, base:5.2, scale:2.6, warn:[3.5,9.0], danger:[2.0,12.0], tau:1.6, gain:.95, weight:1.8},
  {key:'tpr', label:{zh:'外周阻力', en:'TPR'}, short:{zh:'TPR', en:'TPR'}, group:'cv', unit:{zh:'相对阻力（基线=1）', en:'relative resistance (baseline=1)'}, base:1.0, scale:.55, warn:[.65,1.6], danger:[.35,2.2], tau:4.0, gain:.95, weight:1.4},
  {key:'venousReturn', label:{zh:'静脉回流', en:'Venous return'}, short:{zh:'VR', en:'VR'}, group:'cv', unit:{zh:'L/min', en:'L/min'}, base:5.2, scale:2.4, warn:[3.5,9.0], danger:[2.0,12.0], tau:3.8, gain:.9, weight:1.0},
  {key:'contractility', label:{zh:'心肌收缩力', en:'Myocardial contractility'}, short:{zh:'收缩力', en:'Contract.'}, group:'cv', unit:{zh:'收缩力指数（基线=100）', en:'contractility index (baseline=100)'}, base:100, scale:42, warn:[65,150], danger:[35,200], tau:5.0, gain:.9, weight:1.2},
  {key:'rhythmStability', label:{zh:'心律稳定性', en:'Rhythm stability'}, short:{zh:'心律稳', en:'Rhythm'}, group:'cv', unit:{zh:'稳定性指数（基线=100）', en:'stability index (baseline=100)'}, base:100, scale:30, warn:[75,125], danger:[50,160], tau:4.5, gain:.9, weight:1.8},

  {key:'symp', label:{zh:'交感张力', en:'Sympathetic tone'}, short:{zh:'交感', en:'Symp'}, group:'neuro', unit:{zh:'交感活动指数（基线=50）', en:'sympathetic index (baseline=50)'}, base:50, scale:35, warn:[20,85], danger:[0,100], tau:2.0, gain:1.0, weight:.8},
  {key:'vagal', label:{zh:'迷走张力', en:'Vagal tone'}, short:{zh:'迷走', en:'Vagal'}, group:'neuro', unit:{zh:'迷走活动指数（基线=50）', en:'vagal index (baseline=50)'}, base:50, scale:35, warn:[15,85], danger:[0,100], tau:2.2, gain:.95, weight:.6},
  {key:'chemo', label:{zh:'化学感受驱动', en:'Chemoreceptor drive'}, short:{zh:'化感', en:'Chemo'}, group:'neuro', unit:{zh:'化感驱动指数（基线=50）', en:'chemoreceptor index (baseline=50)'}, base:50, scale:35, warn:[15,85], danger:[0,100], tau:2.2, gain:.95, weight:.8},
  {key:'renin', label:{zh:'肾素', en:'Renin'}, short:{zh:'肾素', en:'Renin'}, group:'neuro', unit:{zh:'相对肾素效应（基线=1）', en:'relative renin effect (baseline=1)'}, base:1, scale:1.4, warn:[.2,2.5], danger:[0,4.0], tau:9, gain:.75, weight:.5, slow:true},
  {key:'angII', label:{zh:'血管紧张素II', en:'Angiotensin II'}, short:{zh:'Ang II', en:'Ang II'}, group:'neuro', unit:{zh:'相对 Ang II 效应（基线=1）', en:'relative Ang II effect (baseline=1)'}, base:1, scale:1.4, warn:[.2,2.5], danger:[0,4.0], tau:10, gain:.75, weight:.7, slow:true},
  {key:'aldosterone', label:{zh:'醛固酮', en:'Aldosterone'}, short:{zh:'醛固酮', en:'Aldo'}, group:'neuro', unit:{zh:'相对醛固酮效应（基线=1）', en:'relative aldosterone effect (baseline=1)'}, base:1, scale:1.3, warn:[.2,2.6], danger:[0,4.0], tau:15, gain:.65, weight:.5, slow:true},
  {key:'adh', label:{zh:'抗利尿激素', en:'ADH'}, short:{zh:'ADH', en:'ADH'}, group:'neuro', unit:{zh:'相对 ADH 效应（基线=1）', en:'relative ADH effect (baseline=1)'}, base:1, scale:1.5, warn:[.1,3.0], danger:[0,5.0], tau:8, gain:.7, weight:.6, slow:true},

  {key:'bloodVolume', label:{zh:'血容量', en:'Blood volume'}, short:{zh:'血容量', en:'Volume'}, group:'renal', unit:{zh:'L', en:'L'}, base:5.0, scale:1.4, warn:[4.2,5.9], danger:[3.0,7.0], tau:28, gain:.55, weight:2.0, slow:true},
  {key:'gfr', label:{zh:'肾小球滤过率', en:'GFR'}, short:{zh:'GFR', en:'GFR'}, group:'renal', unit:{zh:'mL/min', en:'mL/min'}, base:125, scale:60, warn:[70,160], danger:[20,220], tau:7, gain:.8, weight:1.2},
  {key:'urine', label:{zh:'尿量', en:'Urine flow'}, short:{zh:'尿量', en:'Urine'}, group:'renal', unit:{zh:'mL/min', en:'mL/min'}, base:1.0, scale:1.25, warn:[.3,2.1], danger:[.05,6.0], tau:12, gain:.65, weight:1.1, slow:true},
  {key:'osm', label:{zh:'血浆渗透压', en:'Plasma osmo.'}, short:{zh:'渗透压', en:'Osm'}, group:'renal', unit:{zh:'mOsm/kg', en:'mOsm/kg'}, base:285, scale:25, warn:[270,305], danger:[240,340], tau:18, gain:.65, weight:1.3, slow:true},
  {key:'sodium', label:{zh:'血钠', en:'Sodium'}, short:{zh:'Na⁺', en:'Na⁺'}, group:'renal', unit:{zh:'mmol/L', en:'mmol/L'}, base:140, scale:15, warn:[132,150], danger:[115,170], tau:20, gain:.55, weight:1.5, slow:true},
  {key:'potassium', label:{zh:'血钾', en:'Potassium'}, short:{zh:'K⁺', en:'K⁺'}, group:'renal', unit:{zh:'mmol/L', en:'mmol/L'}, base:4.2, scale:1.8, warn:[3.2,5.5], danger:[2.0,8.5], tau:14, gain:.7, weight:2.0, slow:true},

  {key:'ventilation', label:{zh:'肺通气量', en:'Ventilation'}, short:{zh:'通气', en:'Vent.'}, group:'resp', unit:{zh:'L/min', en:'L/min'}, base:6.0, scale:5.2, warn:[3.0,15], danger:[1.0,28], tau:3.0, gain:.95, weight:1.2},
  {key:'airway', label:{zh:'气道阻力', en:'Airway R'}, short:{zh:'气道阻力', en:'Airway R'}, group:'resp', unit:{zh:'相对阻力（基线=1）', en:'relative resistance (baseline=1)'}, base:1, scale:.75, warn:[.7,1.8], danger:[.4,3.0], tau:6.5, gain:.75, weight:1.0},
  {key:'paO2', label:{zh:'动脉氧分压', en:'PaO₂'}, short:{zh:'PaO₂', en:'PaO₂'}, group:'resp', unit:{zh:'mmHg', en:'mmHg'}, base:95, scale:35, warn:[60,130], danger:[35,200], tau:4.0, gain:.9, weight:2.2},
  {key:'paCO2', label:{zh:'动脉二氧化碳分压', en:'PaCO₂'}, short:{zh:'PaCO₂', en:'PaCO₂'}, group:'resp', unit:{zh:'mmHg', en:'mmHg'}, base:40, scale:18, warn:[30,55], danger:[15,90], tau:4.0, gain:.9, weight:1.7},
  {key:'pH', label:{zh:'血液 pH', en:'Blood pH'}, short:{zh:'pH', en:'pH'}, group:'resp', unit:{zh:'', en:''}, base:7.40, scale:.25, warn:[7.25,7.55], danger:[6.90,7.80], tau:5.5, gain:.85, weight:2.5},
  {key:'bicarbonate', label:{zh:'碳酸氢盐', en:'Bicarbonate'}, short:{zh:'HCO₃⁻', en:'HCO₃⁻'}, group:'resp', unit:{zh:'mmol/L', en:'mmol/L'}, base:24, scale:8, warn:[18,34], danger:[8,45], tau:22, gain:.55, weight:.8, slow:true},

  {key:'glucose', label:{zh:'血糖', en:'Blood glucose'}, short:{zh:'血糖', en:'Glucose'}, group:'meta', unit:{zh:'mmol/L', en:'mmol/L'}, base:5.0, scale:4.72, warn:[3.3,10.0], danger:[1.4,27.8], tau:10, gain:.75, weight:2.0},
  {key:'insulin', label:{zh:'胰岛素', en:'Insulin'}, short:{zh:'胰岛素', en:'Insulin'}, group:'meta', unit:{zh:'相对胰岛素效应（基线=1）', en:'relative insulin effect (baseline=1)'}, base:1, scale:1.25, warn:[.1,2.8], danger:[0,5], tau:7, gain:.8, weight:.8},
  {key:'glucagon', label:{zh:'胰高血糖素', en:'Glucagon'}, short:{zh:'胰高血糖素', en:'Glucagon'}, group:'meta', unit:{zh:'相对胰高血糖素效应（基线=1）', en:'relative glucagon effect (baseline=1)'}, base:1, scale:1.25, warn:[.1,2.8], danger:[0,5], tau:8, gain:.8, weight:.8},
  {key:'tissueO2', label:{zh:'组织供氧', en:'Tissue O₂ delivery'}, short:{zh:'组织O₂', en:'Tissue O₂'}, group:'meta', unit:{zh:'供氧指数（基线=100）', en:'oxygen-delivery index (baseline=100)'}, base:100, scale:42, warn:[65,150], danger:[30,220], tau:5, gain:.85, weight:2.0},
  {key:'lactate', label:{zh:'乳酸', en:'Lactate'}, short:{zh:'乳酸', en:'Lactate'}, group:'meta', unit:{zh:'mmol/L', en:'mmol/L'}, base:1.0, scale:4.2, warn:[.4,4.0], danger:[.1,20], tau:8, gain:.75, weight:1.8},
  {key:'hct', label:{zh:'血细胞比容', en:'Hematocrit'}, short:{zh:'Hct', en:'Hct'}, group:'meta', unit:{zh:'%', en:'%'}, base:45, scale:12, warn:[32,55], danger:[20,70], tau:40, gain:.45, weight:.8, slow:true},
  {key:'metDemand', label:{zh:'代谢需求', en:'Metab. demand'}, short:{zh:'代谢需求', en:'Demand'}, group:'meta', unit:{zh:'相对代谢需求（基线=1）', en:'relative metabolic demand (baseline=1)'}, base:1, scale:.9, warn:[.5,2.2], danger:[.2,4.0], tau:8, gain:.7, weight:.8}
];

// The tau/gain pair that used to live in DEF_DATA described how fast a state moved in an
// acute classroom run, not how fast the mechanism moves in a patient. temporalModel.js now
// owns that number, so the literature value is the one the solver actually integrates and
// the one the UI actually shows. Nothing downstream may read DEF_DATA.tau.
const defs = DEF_DATA.map(d => ({
  ...d, label:d.label.zh, short:d.short.zh, unit:d.unit.zh,
  tau:temporal.tauFor(d.key, d.tau),
  directTau:temporal.directTauFor(d.key, d.tau),
  layer:temporal.layerOf(d.key)
}));
const defByKey = Object.fromEntries(defs.map(d => [d.key, d]));

// States the network shows as one node but that genuinely run on two clocks. Each is
// integrated in its own right; the visible node is reconstructed from them.
const HIDDEN_KEYS = Object.keys(temporal.HIDDEN_STATES);
const hiddenDef = key => {
  const h = temporal.HIDDEN_STATES[key];
  return {key, tau:h.tau, directTau:h.directTau, layer:h.layer, hidden:true, owner:h.owner};
};
const hiddenDefs = HIDDEN_KEYS.map(hiddenDef);
const hiddenByKey = Object.fromEntries(hiddenDefs.map(d => [d.key, d]));
// Every key the solver integrates: 34 visible plus 5 hidden.
const solverDefs = [...defs, ...hiddenDefs];

const majorKeys = ['map','hr','co','rhythmStability','bloodVolume','gfr','ventilation','paO2','paCO2','pH','glucose','potassium','tissueO2'];
// The hold is in REAL seconds, not simulated ones. At the days lens a single 200 ms frame
// crosses ten simulated minutes, so a simulated-time hold expired before the learner had
// let go of the slider - one of the two reasons the 2026-07-24 build felt unusable.
const CONTROL_HOLD_REAL_SECONDS = 20;
const CONTROL_DECAY_TAU = 42;
const CONTROL_HOLD_SECONDS = CONTROL_HOLD_REAL_SECONDS; // exported name kept for the frontend hint

// Solver constants. See advanceSpan() for how they fit together.
const QSS_RATIO = 8;        // tau below step/QSS_RATIO is treated as already equilibrated
// Convergence settings for the quasi-steady-state solve. These have to be generous rather than
// merely bounded: the fast subsystem contains the chemoreflex loop (chemo -> ventilation ->
// PaCO2 -> pH -> chemo), whose gain went up when the pH sensitivity was corrected to satisfy
// Winter's formula. At 4 sweeps with 0.62 damping that loop did not settle inside a macro step,
// and at coarse lenses - where it is solved algebraically rather than integrated - ventilation
// limit-cycled between 2.8 and 7.0 L/min frame to frame. It cost almost nothing to fix, because
// the early exit below means a converged step still stops after a handful of sweeps; only the
// steps that genuinely need the iterations pay for them.
const QSS_SWEEPS = 24;      // damped Gauss-Seidel sweeps allowed to resolve the fast subsystem
const QSS_RELAX = 0.45;     // damping; a high-gain loop diverges if each sweep takes a full step
const MIN_MACRO_STEP = 0.02;
const MAX_STEPS_PER_CALL = 400;
const HEALTH_STEP_BUDGET = 2.0; // stability points a single macro step may spend
const MAX_HAZARD_DELTA = 0.06;  // how far the aggregate hazard may move inside one step
// Seconds-resolution window opened by a new insult or a new intervention.
const FINE_WINDOW_STEP = 0.2;
const SCENARIO_SETTLE_SECONDS = 45;
const CONTROL_SETTLE_SECONDS = 12;
// A scenario driver on a conserved pool means an ongoing gain or loss, not a new set point.
// One driver unit is this many state units per minute; -2.1 on bloodVolume is then about
// 100 mL/min of ongoing haemorrhage, which is what "unresolved volume loss" should mean.
const FLUX_UNIT_PER_MINUTE = 0.035;
const FLUX_KEYS = new Set(['bloodVolume','potassium','bicarbonate','lactate','glucose','hct','sodium']);
// Where a flux actually lands. Retained potassium accumulates in total-body K+, not in the
// plasma number; an acid load eats the fast buffer pool; lost red cells reduce red-cell mass.
const FLUX_TARGET = {potassium:'kBody', bicarbonate:'hco3Buffer', hct:'rbcMass'};
// The hours-and-slower limbs, used to report how much slow compensation has developed.
// Osmolality left this list when it became a derived value on an immediate clock: it is no
// longer a limb that develops, it is a readout of two limbs that do (sodium, and glucose).
const SLOW_LIMB_KEYS = ['aldosterone','bloodVolume','sodium','hct','aqp2','kBody','rbcMass','hco3Renal'];
// Damage constants. ACUTE_HAZARD_FLOOR is where the warning band stops being merely costly
// and starts being lethal; below it the chronic rate applies, which is calibrated to about
// 2.4 stability points per hour at the top of the warning band.
const ACUTE_HAZARD_FLOOR = 0.30;
const CHRONIC_DAMAGE_PER_SECOND = 0.0022;
const RECOVERY_PER_SECOND = 0.55;
const ACTUAL_FLOORS = {
  map:0, hr:0, sv:0, co:0, tpr:.05, venousReturn:0, contractility:0, rhythmStability:0,
  symp:0, vagal:0, chemo:0, renin:0, angII:0, aldosterone:0, adh:0,
  bloodVolume:0, gfr:0, urine:0, osm:180, sodium:90, potassium:1,
  ventilation:0, airway:.05, paO2:0, paCO2:5, pH:6.5, bicarbonate:0,
  glucose:0, insulin:0, glucagon:0, tissueO2:0, lactate:.2, hct:0, metDemand:0
};
const ACTUAL_CEILINGS = {glucose:36.1};
// How hard alkalemia suppresses the chemoreflex - the compensatory hypoventilation of a
// metabolic alkalosis. The value is a stability ceiling, not a free choice, and the reason is
// worth writing down because the obvious larger number breaks the model.
//
// pH is negatively coupled to PaCO2, so an alkalemia term does not oppose the hypercapnia term
// in t.chemo - it ADDS to it. Rising PaCO2 raises drive through `hypercap` AND raises it again
// by consuming alkalemia, which turns the effective PaCO2->chemo gain from 0.65 into
// 0.65 + 0.78*g. Past g ~= 0.7 the chemoreflex loop's amplification exceeds 1 in the step-size
// band where a state is integrated with alpha ~= 1 but is still too slow to be handed to the
// quasi-steady-state solver, and ventilation limit-cycles at the coarse lenses - the same
// failure the QSS_SWEEPS note above describes. Measured: peak-to-peak ventilation ringing is
// 0.00 at 0.60, 0.06 at 0.70 and 0.87 at 1.20.
//
// At 0.60 the closed loop delivers about 0.3 mmHg of PaCO2 per mmol/L of HCO3-, against the
// 0.5-0.7 usually quoted. That is the conservative end of the clinical range rather than the
// middle of it, and it is the honest place to sit: of the four primary disorders, metabolic
// alkalosis has by far the least reliable respiratory compensation, it is limited by the
// hypoxaemia hypoventilation causes, and a substantial minority of patients show almost none.
// Undercompensating is a defensible reading of that literature. Compensating not at all - which
// is what a one-sided acidosis term did - is not.
const RESP_ALK_GAIN = 0.60;

const edges = [
  ['bloodVolume','venousReturn',1,.9], ['venousReturn','sv',1,.85], ['contractility','sv',1,.8], ['tpr','sv',-1,.55], ['hr','co',1,.8], ['sv','co',1,.9], ['co','map',1,.95], ['tpr','map',1,.95], ['bloodVolume','map',1,.65],
  ['map','symp',-1,.9], ['map','vagal',1,.8], ['symp','hr',1,.8], ['vagal','hr',-1,.75], ['symp','contractility',1,.7], ['symp','tpr',1,.8], ['symp','venousReturn',1,.55], ['potassium','rhythmStability',-1,.8], ['pH','rhythmStability',1,.55], ['rhythmStability','sv',1,.55], ['rhythmStability','co',1,.75],
  ['paCO2','chemo',1,.9], ['pH','chemo',-1,.8], ['paO2','chemo',-1,.55], ['chemo','ventilation',1,.9], ['ventilation','paCO2',-1,.95], ['ventilation','paO2',1,.8], ['airway','ventilation',-1,.65], ['airway','paO2',-1,.75], ['airway','paCO2',1,.55], ['paCO2','pH',-1,.85], ['lactate','bicarbonate',-1,.85], ['bicarbonate','pH',1,.7],
  ['map','gfr',1,.65], ['symp','gfr',-1,.55], ['bloodVolume','gfr',1,.45], ['gfr','urine',1,.75], ['adh','urine',-1,.85], ['aldosterone','urine',-1,.55], ['urine','bloodVolume',-1,.65], ['osm','adh',1,.75], ['bloodVolume','adh',-1,.65], ['map','adh',-1,.55], ['sodium','osm',1,.95], ['glucose','osm',1,.2], ['adh','sodium',-1,.35], ['urine','sodium',1,.4],
  ['map','renin',-1,.85], ['bloodVolume','renin',-1,.75], ['sodium','renin',-1,.55], ['symp','renin',1,.55], ['renin','angII',1,.9], ['angII','tpr',1,.7], ['angII','aldosterone',1,.8], ['angII','adh',1,.35], ['aldosterone','sodium',1,.45], ['aldosterone','potassium',-1,.6], ['potassium','aldosterone',1,.45], ['insulin','potassium',-1,.45], ['symp','potassium',-1,.25],
  ['glucose','insulin',1,.8], ['insulin','glucose',-1,.95], ['glucose','glucagon',-1,.55], ['glucagon','glucose',1,.75], ['symp','glucose',1,.35], ['symp','glucagon',1,.35], ['metDemand','glucose',1,.35],
  ['co','tissueO2',1,.8], ['paO2','tissueO2',1,.85], ['hct','tissueO2',1,.45], ['metDemand','tissueO2',-1,.75], ['tissueO2','lactate',-1,.85], ['metDemand','lactate',1,.7], ['lactate','chemo',1,.45], ['pH','potassium',-1,.45], ['gfr','potassium',-1,.45], ['bloodVolume','hct',-1,.6], ['paO2','hct',-1,.25],
  // Links the equations always had but the network never drew. Oxygen is a vasoconstrictor at
  // both ends of its range and haematocrit is viscosity, so both reach TPR; a volume the heart
  // cannot accommodate reaches the lung. Without these the learner could watch PaO2 change TPR
  // and find no edge to blame.
  ['hct','tpr',1,.4], ['paO2','tpr',1,.3], ['bloodVolume','paO2',-1,.45], ['bloodVolume','airway',1,.3]
].map((e,i)=>({id:i, from:e[0], to:e[1], sign:e[2], weight:e[3]}));

const rawPositions = {
  map:[462,180], hr:[335,135], sv:[350,245], co:[455,260], tpr:[590,155], venousReturn:[246,278], contractility:[250,170], rhythmStability:[205,220],
  symp:[462,60], vagal:[610,62], chemo:[720,262], renin:[698,105], angII:[772,140], aldosterone:[808,210], adh:[812,355],
  bloodVolume:[180,370], gfr:[315,390], urine:[455,420], osm:[625,470], sodium:[705,450], potassium:[740,539],
  ventilation:[686,304], airway:[650,395], paO2:[575,330], paCO2:[600,255], pH:[585,510], bicarbonate:[505,505],
  glucose:[150,520], insulin:[70,450], glucagon:[210,455], tissueO2:[360,535], lactate:[465,560], hct:[260,565], metDemand:[86,560]
};
const FLAT_CENTER_Y = 305;
const FLAT_SCALE_Y = 0.78;
const NETWORK_LAYOUT_CENTER_X = 460;
const NETWORK_SPACING_X = 1.035;
const NETWORK_SPACING_Y = 1.05;
const NETWORK_GROUP_Y_OFFSET = {renal:-10, meta:-14};
// Final canvas offsets keep these crowded labels clear after layout flattening.
const NETWORK_NODE_POSITION_OFFSETS = {
  ventilation:[-8,10],
  adh:[8,-15],
  map:[0,-15]
};
const positions = Object.fromEntries(Object.entries(rawPositions).map(([k,[x,y]]) => {
  const group=defByKey[k]?.group;
  const flatY=FLAT_CENTER_Y + (y - FLAT_CENTER_Y) * FLAT_SCALE_Y;
  const [offsetX,offsetY]=NETWORK_NODE_POSITION_OFFSETS[k] || [0,0];
  return [k,[
    Math.round(NETWORK_LAYOUT_CENTER_X + (x - NETWORK_LAYOUT_CENTER_X) * NETWORK_SPACING_X + offsetX),
    Math.round(FLAT_CENTER_Y + (flatY - FLAT_CENTER_Y) * NETWORK_SPACING_Y + (NETWORK_GROUP_Y_OFFSET[group] || 0) + offsetY)
  ]];
}));

const SCENARIO_CATEGORIES = {
  emergency: {zh:'急症与休克', en:'Emergency & Shock'}, cardiovascular: {zh:'心血管', en:'Cardiovascular'},
  endocrine: {zh:'内分泌与代谢', en:'Endocrine & Metabolic'}, respiratory: {zh:'呼吸与酸碱', en:'Respiratory & Acid–Base'},
  renal: {zh:'肾脏、水与电解质', en:'Renal, Fluid & Electrolytes'},
  hematology: {zh:'血液与氧运输', en:'Hematology & Oxygen Transport'}, neurologic: {zh:'神经系统急症', en:'Neurologic Emergencies'},
  exploratory: {zh:'生理与综合探索', en:'Physiology & Exploration'}
};
const SCENARIOS = {
  hemorrhage:{category:'emergency',zh:'急性失血性休克',en:'Acute hemorrhagic shock',initial:{bloodVolume:-1.25,map:-.90,co:-.50,tissueO2:-.40},drivers:{bloodVolume:-2.10},note:{zh:'一次性失血后仍有未控制的容量丢失；辨认低灌注与压力反射。',en:'An initial blood loss is followed by ongoing unresolved volume loss; identify hypoperfusion and the baroreflex.'}},
  // The tissueO2 driver is the microcirculatory shunt, and it was retuned from -0.80 when the
  // oxygen-content shoulder went in. A septic patient hyperventilates to a PaO2 near 115, and
  // the old linear PaO2 term paid roughly ten delivery points for that - a bonus for tachypnoea
  // that no haemoglobin can actually cash. Removing it left the shunt driver describing a
  // sepsis about a third more severe than the one this scenario is calibrated to teach, and
  // decompensation moved from ~45 minutes to ~18. The physiology is the fix; this number is
  // just the dial that says how sick the patient is. At -0.53 the steady tissue-O2 index is
  // back on 98 and decompensation back inside its 37-71 minute window.
  sepsis:{category:'emergency',zh:'脓毒性分布性休克',en:'Septic distributive shock',initial:{map:-.75,tissueO2:-.60,lactate:1.0},drivers:{tpr:-1.50,metDemand:.60,tissueO2:-.53,lactate:.80},note:{zh:'持续血管扩张、代谢需求增加与微循环供氧障碍并存。',en:'Persistent vasodilation, increased demand, and impaired microcirculatory oxygen delivery coexist.'}},
  anaphylaxis:{category:'emergency',zh:'过敏性休克伴支气管痉挛',en:'Anaphylactic shock with bronchospasm',initial:{map:-.70,paO2:-.70},drivers:{tpr:-2.40,airway:2.80,bloodVolume:-1.80},note:{zh:'血管扩张、毛细血管渗漏与支气管痉挛同时出现。',en:'Vasodilation, capillary leak, and bronchospasm occur together.'}},
  pulmonaryEmbolism:{category:'emergency',zh:'大面积肺栓塞伴阻塞性休克',en:'Massive pulmonary embolism with obstructive shock',initial:{co:-.60,map:-.55,paO2:-.85,paCO2:-.25},drivers:{venousReturn:-2.0,co:-.80,paO2:-1.0,tissueO2:-.70,ventilation:.35},note:{zh:'肺循环阻塞降低有效心排量并造成低氧，早期过度通气可使 PaCO₂ 下降。',en:'Pulmonary vascular obstruction reduces effective output and oxygenation; early hyperventilation may lower PaCO₂.'}},
  tensionPneumothorax:{category:'emergency',zh:'张力性气胸伴阻塞性休克',en:'Tension pneumothorax with obstructive shock',initial:{map:-.60,co:-.50,paO2:-.90},drivers:{airway:1.50,ventilation:-1.50,venousReturn:-1.80},note:{zh:'胸腔压力升高同时损害通气与静脉回流，形成低氧和阻塞性休克。',en:'Rising intrathoracic pressure impairs ventilation and venous return, producing hypoxemia and obstructive shock.'}},
  cardiacTamponade:{category:'emergency',zh:'心包填塞伴阻塞性休克',en:'Cardiac tamponade with obstructive shock',initial:{map:-.60,co:-.70},drivers:{venousReturn:-2.60,co:-.70},note:{zh:'心包压力限制心室充盈，使每搏量、心排量和血压逐步下降。',en:'Pericardial pressure restricts ventricular filling, progressively reducing stroke volume, output, and pressure.'}},
  cardiogenicShock:{category:'cardiovascular',zh:'心源性休克',en:'Cardiogenic shock',initial:{map:-.70,co:-.80,tissueO2:-.40},drivers:{contractility:-2.10},note:{zh:'原发性收缩力下降后，观察每搏量、心输出量和血压如何继发改变。',en:'Primary contractile failure drives secondary changes in stroke volume, output, and pressure.'}},
  acutePulmonaryEdema:{category:'cardiovascular',zh:'急性左心衰伴肺水肿',en:'Acute left-heart failure with pulmonary edema',initial:{co:-.45,paO2:-1.0},drivers:{contractility:-1.0,airway:.80,paO2:-1.30,ventilation:-.25},note:{zh:'左心泵功能下降与肺内氧交换障碍并存，形成低氧、交感激活和乳酸升高。',en:'Left-sided pump failure and impaired pulmonary gas exchange coexist, causing hypoxemia, sympathetic activation, and rising lactate.'}},
  hypertensiveCrisis:{category:'cardiovascular',zh:'高血压危象样失衡',en:'Hypertensive-crisis pattern',drivers:{tpr:1.55},note:{zh:'持续小动脉收缩增加后负荷；观察压力反射及心肾负担。',en:'Persistent arteriolar constriction raises afterload; observe reflex and cardio-renal stress.'}},
  unstableArrhythmia:{category:'cardiovascular',zh:'不稳定性快速心律失常',en:'Unstable tachyarrhythmia',drivers:{hr:1.20,rhythmStability:-1.80},note:{zh:'快速不稳定节律是原发扰动，充盈和有效心排量随后改变。',en:'A rapid unstable rhythm is the primary disturbance; filling and effective output change secondarily.'}},
  insulin:{category:'endocrine',zh:'胰岛素过量致低血糖',en:'Insulin-induced hypoglycemia',drivers:{insulin:1.80},note:{zh:'持续胰岛素过量压低血糖，并触发反调节反应。',en:'Persistent insulin excess lowers glucose and triggers counter-regulation.'}},
  diabetes:{category:'endocrine',zh:'糖尿病酮症酸中毒样失衡',en:'Diabetic ketoacidosis pattern',initial:{glucose:2.0,bicarbonate:-.90,pH:-.65,bloodVolume:-.60},drivers:{insulin:-1.80,glucagon:.80,bicarbonate:-1.50,bloodVolume:-.60,glucose:1.40},note:{zh:'胰岛素不足、反调节激素和酮酸样缓冲消耗共同造成高血糖、脱水和酸中毒。',en:'Insulin deficiency, counter-regulation, and ketoacid-like buffer consumption produce hyperglycemia, dehydration, and acidosis.'}},
  // The osm driver here was doing the work that hypernatremia does in a real hyperosmolar
  // state: once osmolality is 2*Na + glucose, an osmolality of 320-plus has to come from the
  // free-water deficit as well as the sugar, so the deficit is now stated where it belongs.
  // Osmotic diuresis of this duration always ends in hypernatremia; that was the missing piece.
  hyperosmolar:{category:'endocrine',zh:'高渗高血糖状态',en:'Hyperosmolar hyperglycemic state',initial:{glucose:5.80,sodium:.55,osm:1.76,bloodVolume:-1.0},drivers:{glucose:3.80,insulin:-1.20,glucagon:.70,sodium:.55,urine:.70,bloodVolume:-.90},note:{zh:'既存的重度高血糖和高渗由胰岛素相对不足与渗透性利尿持续维持。',en:'Established severe hyperglycemia and hyperosmolality persist through relative insulin deficiency and osmotic diuresis.'}},
  adrenalCrisis:{category:'endocrine',zh:'原发性肾上腺危象',en:'Primary adrenal crisis',initial:{map:-.60,bloodVolume:-.50,potassium:.45,glucose:-.35},drivers:{aldosterone:-1.60,bloodVolume:-1.40,sodium:-.70,potassium:.80,glucose:-.60,tpr:-.70},note:{zh:'盐皮质激素和应激激素效应不足导致低容量、低血压、低钠、高钾和低血糖。',en:'Insufficient mineralocorticoid and stress-hormone effects cause volume depletion, hypotension, hyponatremia, hyperkalemia, and hypoglycemia.'}},
  myxedemaComa:{category:'endocrine',zh:'黏液性水肿昏迷样失衡',en:'Myxedema-coma pattern',initial:{hr:-.45,ventilation:-.45,paCO2:.40,sodium:-.40},drivers:{metDemand:-.75,hr:-.80,ventilation:-1.30,sodium:-.50},note:{zh:'代谢活动降低伴心动过缓、低通气、二氧化碳潴留和低钠。',en:'Reduced metabolic activity coexists with bradycardia, hypoventilation, CO₂ retention, and hyponatremia.'}},
  asthma:{category:'respiratory',zh:'急性重症哮喘',en:'Acute severe asthma',initial:{ventilation:-.60,paO2:-1.0,paCO2:.50},drivers:{airway:2.60},note:{zh:'持续重度气道阻塞是原发扰动；观察通气、氧合和二氧化碳变化。',en:'Persistent severe airway obstruction is primary; observe ventilation, oxygenation, and CO₂.'}},
  opioidOverdose:{category:'respiratory',zh:'阿片类药物过量致呼吸抑制',en:'Opioid overdose with respiratory depression',initial:{paCO2:.80,pH:-.50,paO2:-.60},drivers:{ventilation:-2.10,chemo:-1.10},note:{zh:'中枢呼吸驱动受抑后，低通气继发高碳酸血症、低氧和酸血症。',en:'Suppressed central respiratory drive causes hypoventilation, hypercapnia, hypoxemia, and acidemia.'}},
  copdExacerbation:{category:'respiratory',zh:'COPD 急性加重伴二氧化碳潴留',en:'COPD exacerbation with CO₂ retention',initial:{paCO2:.70,bicarbonate:.50,pH:-.20},drivers:{airway:1.90,ventilation:-.80},note:{zh:'气流受限与低通气加重既有二氧化碳潴留，并观察肾脏碳酸氢盐代偿。',en:'Worsening airflow limitation and hypoventilation amplify CO₂ retention while renal bicarbonate compensation evolves.'}},
  co2:{category:'respiratory',zh:'低通气性呼吸性酸中毒',en:'Hypoventilation / respiratory acidosis',initial:{paCO2:.90,pH:-.60,paO2:-.50},drivers:{ventilation:-2.50},note:{zh:'持续肺泡低通气继发二氧化碳潴留和酸血症。',en:'Persistent alveolar hypoventilation causes secondary CO₂ retention and acidemia.'}},
  respiratoryAlkalosis:{category:'respiratory',zh:'过度通气性呼吸性碱中毒',en:'Hyperventilation / respiratory alkalosis',drivers:{ventilation:1.10},duration:90,decayTau:35,note:{zh:'一段时间的原发过度通气使二氧化碳下降并推动 pH 升高。',en:'A period of primary hyperventilation lowers CO₂ and raises pH.'}},
  lacticAcidosis:{category:'respiratory',zh:'乳酸酸中毒（A 型／缺氧性）',en:'Lactic acidosis (type A, hypoxic)',initial:{paO2:-.80,tissueO2:-.70,lactate:.55},drivers:{paO2:-1.55,tissueO2:-1.15},note:{zh:'氧输送不足使无氧糖酵解持续产酸。乳酸滴定 HCO₃⁻ 在数分钟内完成，肺代偿随后压低 PaCO₂，而肾脏排酸和再生 HCO₃⁻ 需 3～5 天，本轮内几乎看不到——因此唯一的出路是恢复氧输送，而不是补碱。',en:'Inadequate oxygen delivery keeps anaerobic glycolysis producing acid. Lactate titrates HCO₃⁻ within minutes and pulmonary compensation then lowers PaCO₂, but renal acid excretion and HCO₃⁻ regeneration need 3-5 days and barely appear within one run, so the way out is restoring oxygen delivery, not giving base.'}},
  // The chemo driver is new and it is the drug's actual pharmacology: salicylate stimulates the
  // medullary respiratory centre directly, which is why the hyperventilation persists in the
  // face of the alkalaemia it produces. Once the chemoreflex learned to answer to alkalemia,
  // a salicylate patient given bicarbonate could protect their pH by hypoventilating like
  // anybody else - PaCO2 held at 29 instead of 21 - and survived a treatment that should be
  // lethal. Modelling the stimulus where it belongs, on the drive rather than only on the
  // minute volume, restores that: this patient cannot blow off the problem, and giving base to
  // an already alkalaemic one still kills them.
  salicylateToxicity:{category:'respiratory',zh:'水杨酸中毒混合性酸碱失衡',en:'Salicylate toxicity with mixed acid–base disturbance',initial:{paCO2:-.50,bicarbonate:-.70},drivers:{ventilation:1.20,chemo:.28,bicarbonate:-1.10,lactate:.80,metDemand:.40},note:{zh:'呼吸中枢兴奋造成呼吸性碱中毒，同时酸生成与碳酸氢盐丢失形成代谢性酸中毒。',en:'Respiratory-center stimulation causes respiratory alkalosis while acid generation and bicarbonate loss produce metabolic acidosis.'}},
  dehydration:{category:'renal',zh:'高渗性脱水',en:'Hyperosmotic dehydration',initial:{bloodVolume:-1.20,sodium:1.10,osm:1.32},drivers:{bloodVolume:-1.40,sodium:.80},note:{zh:'既存的水分丢失造成容量不足与高钠高渗，并继续缓慢失水。',en:'Established water loss causes volume depletion and hypernatremic hyperosmolality with continued slower loss.'}},
  siadh:{category:'renal',zh:'SIADH样低钠血症',en:'SIADH-like hyponatremia',initial:{sodium:-1.20,osm:-1.44},drivers:{adh:1.80,sodium:-1.0},note:{zh:'持续 ADH 作用引起保水、低渗和稀释性低钠。',en:'Persistent ADH activity causes water retention, hypotonicity, and dilutional hyponatremia.'}},
  renalFailure:{category:'renal',zh:'急性肾功能衰竭伴高钾',en:'Acute renal failure with hyperkalemia',initial:{potassium:.60},drivers:{gfr:-1.40,potassium:.35},note:{zh:'原发滤过功能下降使尿量和排钾能力降低，继发容量与电解质变化。',en:'Primary filtration failure reduces urine and potassium clearance, causing secondary volume and electrolyte changes.'}},
  oliguria:{category:'renal',zh:'少尿（低灌注/急性肾损伤模式）',en:'Oliguria (hypoperfusion / AKI pattern)',initial:{urine:-.55,gfr:-.55},drivers:{urine:-1.15,gfr:-1.25,renin:.30,potassium:.22},note:{zh:'尿量显著减少并伴滤过下降；先判断低容量、低灌注或肾损伤，不应把“强行增加尿量”等同于纠正病因。',en:'Urine output and filtration fall together; assess low volume, hypoperfusion, or kidney injury rather than equating forced diuresis with correction of the cause.'}},
  hypokalemia:{category:'renal',zh:'重度低钾血症',en:'Severe hypokalemia',initial:{potassium:-.60},drivers:{potassium:-1.10,aldosterone:.65,urine:.25},note:{zh:'持续排钾使血钾下降并增加心肌电不稳定、无力和有效泵血风险。',en:'Ongoing potassium loss lowers serum K⁺ and increases electrical instability, weakness, and ineffective pumping.'}},
  diabetesInsipidus:{category:'renal',zh:'尿崩症样高钠脱水',en:'Diabetes-insipidus pattern with hypernatremic dehydration',initial:{sodium:.70,osm:.84,bloodVolume:-.50},drivers:{adh:-1.50,urine:1.0,bloodVolume:-1.20,sodium:1.0},note:{zh:'ADH 效应不足导致多尿、自由水丢失、高钠、高渗和低容量。',en:'Insufficient ADH effect causes polyuria, free-water loss, hypernatremia, hyperosmolality, and volume depletion.'}},
  salt:{category:'renal',zh:'急性高盐负荷',en:'Acute high-salt load',initial:{sodium:.52,osm:.62},drivers:{sodium:.15},duration:35,decayTau:25,note:{zh:'一次性盐负荷短暂提高钠和渗透压，随后由饮水激素和肾脏反馈调节。',en:'A one-time salt load transiently raises sodium and osmolality before hormonal and renal feedback respond.'}},
  severeAnemia:{category:'hematology',zh:'重度贫血伴组织供氧不足',en:'Severe anemia with impaired oxygen delivery',initial:{hct:-1.50,tissueO2:-.60},drivers:{hct:-2.0,tissueO2:-1.20},note:{zh:'血细胞比容降低使携氧能力下降，即使 PaO₂ 正常也可出现组织缺氧和乳酸升高。',en:'Reduced hematocrit impairs oxygen carriage, so tissue hypoxia and lactate may develop despite a normal PaO₂.'}},
  statusEpilepticus:{category:'neurologic',zh:'癫痫持续状态样代谢危机',en:'Status-epilepticus metabolic crisis',initial:{lactate:.60,metDemand:.80},drivers:{metDemand:1.60,lactate:1.20,glucose:-.40},note:{zh:'持续抽搐样高代谢需求迅速增加耗氧、耗糖和乳酸生成，并挑战呼吸循环储备。',en:'Sustained seizure-like metabolic demand rapidly increases oxygen and glucose use and lactate production, challenging respiratory and circulatory reserve.'}},
  exercise:{category:'exploratory',zh:'运动与生理应激',en:'Exercise / physiologic stress',drivers:{metDemand:.82},duration:60,decayTau:25,note:{zh:'代谢需求暂时升高；交感、通气和局部血管反应由系统自行匹配。',en:'Metabolic demand rises temporarily; sympathetic, ventilatory, and local vascular responses adapt.'}},
  random:{category:'exploratory',zh:'未知随机扰动',en:'Unknown random disturbance',random:true,note:{zh:'根据监测结果识别最危险的反馈环，不预先给出诊断。',en:'Use the monitoring pattern to identify the most dangerous feedback loop without a supplied diagnosis.'}}
};

// A driver listed here is an ongoing flux into or out of a pool - bleeding, capillary leak,
// osmotic diuresis, ketoacid production, renal potassium retention - and is integrated as a
// rate. Everything else stays a set-point bias, which is the right reading for a driver that
// says "bronchospasm is holding airway resistance high".
//
// The distinction only became necessary once the pools got their real time constants. With
// blood volume on a 6-hour endogenous tau, a driver applied as a bias could not represent
// bleeding at all: it would describe a kidney slowly targeting a lower volume, and the
// patient would take hours to lose the first litre.
const SCENARIO_FLUX = {
  hemorrhage:['bloodVolume'],
  anaphylaxis:['bloodVolume'],
  diabetes:['bloodVolume','bicarbonate'],
  hyperosmolar:['bloodVolume'],
  adrenalCrisis:['bloodVolume','potassium'],
  dehydration:['bloodVolume'],
  diabetesInsipidus:['bloodVolume'],
  renalFailure:['potassium'],
  hypokalemia:['potassium'],
  salicylateToxicity:['bicarbonate'],
  severeAnemia:['hct'],
  lacticAcidosis:['lactate'],
  statusEpilepticus:['lactate']
};

// Single source of truth for the per-disease reference link. It drives both the scenario
// badge in the browser and the reference_library block sent to the medical AI, so the two
// can never drift apart. Chinese cites 人卫智数 (PMPH), English cites MSD Manual Professional.
// PMPH publishes 病因与发病机制 and 代偿机制 openly and paywalls 临床表现/诊断/治疗;
// MSD Professional is open throughout. Prompts must respect that difference.
const PMPH_BASE='https://test.pmphai.com/jeesitede/appdisease/toPcDetail?sessionId=&knowledgeLibPrefix=disease&id=';
const MSD_BASE='https://www.merckmanuals.com/professional/';
const SCENARIO_REFERENCES = {
  hemorrhage:{zh:['失血性休克','22460'],en:['Shock','critical-care-medicine/shock-and-fluid-resuscitation/shock']},
  sepsis:{zh:['脓毒症与感染性休克','27011'],en:['Sepsis and Septic Shock','critical-care-medicine/sepsis-and-septic-shock/sepsis-and-septic-shock']},
  anaphylaxis:{zh:['过敏性休克','10521'],en:['Anaphylaxis','immunology-allergic-disorders/allergic-autoimmune-and-other-hypersensitivity-disorders/anaphylaxis']},
  pulmonaryEmbolism:{zh:['肺栓塞','28681'],en:['Pulmonary Embolism (PE)','pulmonary-disorders/pulmonary-embolism/pulmonary-embolism-pe']},
  tensionPneumothorax:{zh:['气胸','11140'],en:['Tension Pneumothorax','injuries-poisoning/thoracic-trauma/tension-pneumothorax']},
  cardiacTamponade:{zh:['心包积液及心脏压塞','0001AA100000000EQIRR'],en:['Cardiac Tamponade','injuries-poisoning/thoracic-trauma/cardiac-tamponade']},
  cardiogenicShock:{zh:['心源性休克','10519'],en:['Complications of Acute Coronary Syndromes','cardiovascular-disorders/coronary-artery-disease/complications-of-acute-coronary-syndromes']},
  acutePulmonaryEdema:{zh:['急性左心衰竭','0001AA100000000EM549'],en:['Pulmonary Edema','cardiovascular-disorders/heart-failure/pulmonary-edema']},
  hypertensiveCrisis:{zh:['高血压危象','0001AA100000000EQG69'],en:['Hypertensive Emergencies','cardiovascular-disorders/hypertension/hypertensive-emergencies']},
  unstableArrhythmia:{zh:['室性心律失常','0001AA100000000EOP3X'],en:['Ventricular Tachycardia (VT)','cardiovascular-disorders/specific-cardiac-arrhythmias/ventricular-tachycardia-vt']},
  insulin:{zh:['药物所致低血糖症','29984'],en:['Hypoglycemia','endocrine-and-metabolic-disorders/diabetes-mellitus-and-disorders-of-carbohydrate-metabolism/hypoglycemia']},
  diabetes:{zh:['糖尿病酮症酸中毒','29967'],en:['Diabetic Ketoacidosis (DKA)','endocrine-and-metabolic-disorders/diabetes-mellitus-and-disorders-of-carbohydrate-metabolism/diabetic-ketoacidosis-dka']},
  hyperosmolar:{zh:['高渗性高血糖状态','29968'],en:['Acute Complications of Diabetes Mellitus','endocrine-and-metabolic-disorders/diabetes-mellitus-and-disorders-of-carbohydrate-metabolism/acute-complications-of-diabetes-mellitus']},
  adrenalCrisis:{zh:['急性肾上腺皮质功能减退症','0001AA100000000EOJSO'],en:['Primary Adrenal Insufficiency (Addison Disease)','endocrine-and-metabolic-disorders/adrenal-disorders/primary-adrenal-insufficiency-addison-disease']},
  myxedemaComa:{zh:['甲状腺功能减退症','10917'],en:['Hypothyroidism','endocrine-and-metabolic-disorders/thyroid-disorders/hypothyroidism']},
  asthma:{zh:['重症哮喘','0001AA100000000EN8L3'],en:['Asthma','pulmonary-disorders/asthma-and-related-disorders/asthma']},
  opioidOverdose:{zh:['阿片类药物中毒','10716'],en:['Opioid Toxicity and Withdrawal','special-subjects/recreational-drugs-and-intoxicants/opioid-toxicity-and-withdrawal']},
  copdExacerbation:{zh:['慢性阻塞性肺疾病急性加重','0001AA100000000EQYH2'],en:['Chronic Obstructive Pulmonary Disease (COPD)','pulmonary-disorders/chronic-obstructive-pulmonary-disease-and-related-disorders/chronic-obstructive-pulmonary-disease-copd']},
  co2:{zh:['呼吸性酸中毒','10847'],en:['Respiratory Acidosis','nephrology/acid-base-regulation-and-disorders/respiratory-acidosis']},
  respiratoryAlkalosis:{zh:['呼吸性碱中毒','10848'],en:['Respiratory Alkalosis','nephrology/acid-base-regulation-and-disorders/respiratory-alkalosis']},
  lacticAcidosis:{zh:['乳酸性酸中毒','0001AA100000000ELZSA'],en:['Metabolic Acidosis','nephrology/acid-base-regulation-and-disorders/metabolic-acidosis']},
  salicylateToxicity:{zh:['水杨酸盐类中毒','26973'],en:['Aspirin and Other Salicylate Poisoning','injuries-poisoning/poisoning/aspirin-and-other-salicylate-poisoning']},
  dehydration:{zh:['高渗性缺水','22418'],en:['Volume Depletion','endocrine-and-metabolic-disorders/fluid-metabolism/volume-depletion']},
  siadh:{zh:['抗利尿激素分泌不当综合征','10893'],en:['Syndrome of Inappropriate ADH Secretion (SIADH)','endocrine-and-metabolic-disorders/electrolyte-disorders/syndrome-of-inappropriate-adh-secretion-siadh']},
  renalFailure:{zh:['急性肾衰竭','0001AA100000000EKTTG'],en:['Acute Kidney Injury (AKI)','nephrology/acute-kidney-injury/acute-kidney-injury-aki']},
  oliguria:{zh:['急性肾衰竭','0001AA100000000EKTTG'],en:['Oliguria','critical-care-medicine/approach-to-the-critically-ill-patient/oliguria']},
  hypokalemia:{zh:['低钾血症','30159'],en:['Hypokalemia','nephrology/electrolyte-disorders/hypokalemia']},
  diabetesInsipidus:{zh:['中枢性尿崩症','26312'],en:['Arginine Vasopressin Deficiency (Central Diabetes Insipidus)','endocrine-and-metabolic-disorders/pituitary-disorders/arginine-vasopressin-deficiency-central-diabetes-insipidus']},
  salt:{zh:['高钠血症','10835'],en:['Hypernatremia','nephrology/electrolyte-disorders/hypernatremia']},
  severeAnemia:{zh:['贫血','11403'],en:['Evaluation of Anemia','hematology-and-oncology/approach-to-the-patient-with-anemia/evaluation-of-anemia']},
  statusEpilepticus:{zh:['癫痫持续状态','28922'],en:['Seizure Disorders','neurologic-disorders/seizure-disorders/seizure-disorders']}
};
const REFERENCE_SOURCE_NAMES = {zh:'人卫智数疾病知识库', en:'MSD Manual Professional Edition'};
function scenarioReference(name, lang='zh'){
  const l=lang==='en'?'en':'zh';
  const entry=SCENARIO_REFERENCES[name]?.[l];
  if(!entry) return null;
  return {
    title:entry[0],
    url:(l==='en'?MSD_BASE:PMPH_BASE)+entry[1],
    source:REFERENCE_SOURCE_NAMES[l],
    // PMPH gates the applied-clinical sections; MSD does not. The AI prompt keys off this.
    openSections:l==='en'?'all':'mechanism_and_compensation_only'
  };
}

function clip(x,a,b){ return Math.max(a, Math.min(b, x)); }
function smoothstep(edge0, edge1, x){ const t=clip((x-edge0)/(edge1-edge0),0,1); return t*t*(3-2*t); }
function stateForActual(d,value){ return (value - d.base) / d.scale; }
function minStateFor(d){ return Object.prototype.hasOwnProperty.call(ACTUAL_FLOORS, d.key) ? stateForActual(d, ACTUAL_FLOORS[d.key]) : -3.2; }
function maxStateFor(d){ return Object.prototype.hasOwnProperty.call(ACTUAL_CEILINGS, d.key) ? stateForActual(d, ACTUAL_CEILINGS[d.key]) : 3.2; }
// Bounds are fixed properties of a parameter, so they are computed once. They used to be
// derived on every clamp, and clamping happens tens of thousands of times per frame at the
// coarse lenses - it was the hottest line in the solver.
const STATE_BOUNDS = Object.fromEntries(defs.map(d => [d.key, [minStateFor(d), maxStateFor(d)]]));
function clampStateValue(d,value){
  const bounds=STATE_BOUNDS[d.key];
  return bounds ? clip(value, bounds[0], bounds[1]) : clip(value, -3.2, 3.2);
}
function enforceStateBounds(session){ defs.forEach(d=>{ session.state[d.key]=clampStateValue(d, session.state[d.key]); }); }
function actual(session,k){ const d=defByKey[k]; return d.base + d.scale * clampStateValue(d, session.state[k]); }
function fmt(d, v){
  if(d.unit === '') return v.toFixed(2);
  if(Math.abs(d.scale) < 1 || d.key==='tpr' || d.key==='airway' || /relative|相对/.test(d.unit)) return v.toFixed(2);
  if(d.key==='co' || d.key==='bloodVolume' || d.key==='ventilation' || d.key==='urine' || d.key==='lactate' || d.key==='potassium') return v.toFixed(1);
  return Math.round(v).toString();
}
function zoneOf(session,k){
  const d=defByKey[k], v=actual(session,k);
  if(!d.warn || !d.danger) return 'normal';
  if(v < d.danger[0] || v > d.danger[1]) return 'danger';
  if(v < d.warn[0] || v > d.warn[1]) return 'warn';
  return 'normal';
}
function stateBias(session,k){ return clip((session.state[k]/1.6)*100,-100,100); }
function sliderBias(session,k){
  const s=stateBias(session,k), c=session.controls[k];
  const dominance=clip(Math.abs(c)/45,0,0.88);
  return clip(c*dominance + s*(1-dominance), -100, 100);
}
function severityFor(session,d){
  if(!d.warn || !d.danger) return 0;
  const v=actual(session,d.key);
  const [wl,wh]=d.warn, [dl,dh]=d.danger;
  if(v>=wl && v<=wh) return 0;
  if(v<wl) return 0.5 + 1.5*clip((wl-v)/(wl-dl || 1),0,2);
  return 0.5 + 1.5*clip((v-wh)/(dh-wh || 1),0,2);
}


function createSession(lang='zh'){
  const session = {
    lang: lang === 'en' ? 'en' : 'zh',
    state: {}, controls: {}, prevZones: {}, controlTouching: {}, controlHoldUntil: {},
    simTime: 0, realTime: 0, health: 100, stableScore: 0, strain: 0, dead: false, paused: false, observationOnly: false,
    // An unscored session. The physiology, the conditions and the compensation ledger all run
    // exactly as usual; only the damage integration is switched off, so stability stays at 100
    // and the patient cannot die. This exists for the "trace one loop" mode, where a falling
    // health bar would turn following a reflex into a game with a score to protect - and a
    // learner protecting a score stops perturbing the system, which is the only thing that mode
    // asks them to do. Hiding the bar client-side is not enough: the engine would still be
    // accumulating damage, the report would still record a death, and a novice who switched
    // modes would inherit a corpse.
    noThreat: false,
    acuteBurden: 0, chronicBurden: 0,
    peakTracker: {}, events: [],
    logLines: [], activeConditions: [], conditionMemory: {}, domainExposure:{}, scenario:null
  };
  defs.forEach(d => { session.state[d.key]=0; session.controls[d.key]=0; session.prevZones[d.key]='normal'; session.controlTouching[d.key]=false; session.controlHoldUntil[d.key]=0; });
  HIDDEN_KEYS.forEach(k => { session.state[k]=0; });
  addLog(session, session.lang === 'zh' ? '系统初始化：所有参数回到基线。' : 'System initialized: all parameters returned to baseline.');
  return session;
}
function addLog(session,text){
  session.logLines.unshift({t:session.simTime, text});
  session.logLines = session.logLines.slice(0,8);
}
// Whether the session is scored survives a restart, for the same reason the language does: it
// describes what the session is for, not what state the patient is in. Without this, restarting
// inside the unscored mode would silently hand the learner a scored patient.
function resetSession(session){
  const lang = session.lang || 'zh';
  const noThreat = Boolean(session.noThreat);
  Object.assign(session, createSession(lang));
  session.noThreat = noThreat;
  return session;
}
// Turning scoring off has to clear the score as well as stop it, because a mode switch can
// arrive with the patient already dying or already dead. Leaving health where it was would mean
// the unscored mode still refused interventions (`dead` pauses the session) while showing no
// reason for it. Turning scoring back on resumes from a clean 100 rather than from whatever the
// unscored excursion would have cost - the learner was explicitly told nothing was being scored.
function setThreatScoring(session, enabled){
  const scored = Boolean(enabled);
  if(session.noThreat === !scored) return session;
  session.noThreat = !scored;
  const zh = session.lang === 'zh';
  if(!scored){
    session.health=100; session.dead=false; session.observationOnly=false; session.paused=false;
    session.strain=0; session.acuteBurden=0; session.chronicBurden=0; session.stableScore=0;
    session.domainExposure={}; session.healthChangeRate=0; session.damageRate=0;
    session.prevHealth=100; session.prevHealthRate=0; session.prevStrainRate=0;
    addLog(session, zh
      ? '本次会话不计生命稳定度：生理反馈照常运行，但不再累积损伤，也不会死亡。'
      : 'This session is not scored: feedback runs as usual, but damage no longer accumulates and the patient cannot die.');
  }else{
    session.health=100; session.strain=0; session.acuteBurden=0; session.chronicBurden=0;
    session.domainExposure={}; session.prevHealth=100; session.prevHealthRate=0; session.prevStrainRate=0;
    addLog(session, zh
      ? '已恢复生命稳定度计分：从 100 重新开始累积损伤。'
      : 'Stability scoring resumed: damage accumulates again from 100.');
  }
  return session;
}
function zeroControls(session){
  defs.forEach(d=>{ session.controls[d.key]=0; session.controlTouching[d.key]=false; session.controlHoldUntil[d.key]=0; });
  addLog(session, session.lang === 'zh' ? '所有外源性干预归零；观察反馈系统能否恢复。' : 'All external interventions returned to zero; observe whether feedback restores stability.');
}
function continueObservation(session){
  if(session.health > 0 && !session.dead) return session;
  session.health=0;
  session.dead=false;
  session.paused=false;
  session.observationOnly=true;
  addLog(session, session.lang === 'zh'
    ? '稳定度归零后继续观察；参数反馈仍会演化，但不再允许用户干预。'
    : 'Observation continued after Stability reached zero; feedback still evolves, but user interventions remain disabled.');
  return session;
}
function setControl(session,k,v){
  if(!defByKey[k]) throw new Error('unknown parameter');
  session.controls[k] = clip(Number(v) || 0, -100, 100);
  session.controlTouching[k] = false;
  session.controlHoldUntil[k] = session.realTime + CONTROL_HOLD_REAL_SECONDS;
  session.fineUntil = Math.max(session.fineUntil || 0, session.simTime + CONTROL_SETTLE_SECONDS);
}

function scenarioStrength(session){
  const scenario=session.scenario;
  if(!scenario) return 0;
  const elapsed=Math.max(0,session.simTime-(scenario.startedAt||0));
  if(!Number.isFinite(scenario.duration) || elapsed<=scenario.duration) return 1;
  const strength=Math.exp(-(elapsed-scenario.duration)/(scenario.decayTau||30));
  return strength<.002 ? 0 : strength;
}
// Set-point component of a scenario driver: the disturbance is holding this variable away
// from where the body would put it.
function scenarioDrive(session,k){
  const scenario=session.scenario;
  if(!scenario || !scenario.drivers || scenario.fluxKeys?.includes(k)) return 0;
  return (scenario.drivers[k]||0)*scenarioStrength(session);
}
// Flux component: state units per second entering or leaving a pool. Integrated, not chased.
function scenarioFlux(session,k){
  const scenario=session.scenario;
  if(!scenario || !scenario.fluxKeys?.includes(k)) return 0;
  return (scenario.drivers[k]||0)*scenarioStrength(session)*FLUX_UNIT_PER_MINUTE/60;
}

function computeTargetVector(session){
  const z=session.state;
  const hypoxia=clip(-z.paO2,0,3), hypercap=clip(z.paCO2,0,3), acidosis=clip(-z.pH,0,3);
  // Alkalemia is not the absence of acidemia, and every limb that answers to acid answers to
  // base in the other direction. Written one-sided, the chemoreflex simply had no reply to a
  // rising pH: PaCO2 sat at exactly 40 for every bicarbonate from 24 to 45, and a metabolic
  // alkalosis went uncompensated forever. See t.chemo.
  const alkalemia=clip(z.pH,0,3);
  const shock=clip(-(z.map+.55),0,3);
  const volumeDeficit=clip(-z.bloodVolume,0,3);
  const polyuricDrive=clip(z.urine-stateForActual(defByKey.urine,2.1),0,3);
  const hyperK=clip(z.potassium-.65,0,3), hypoK=clip(-z.potassium-.65,0,3);
  // Supranormal arterial oxygen. Kept separate from `hypoxia` because the two sides of the
  // oxyhaemoglobin dissociation curve are not mirror images: see t.tissueO2.
  const hyperoxia=clip(z.paO2,0,3);
  // Above a haematocrit of roughly 55% viscosity climbs steeply - relative viscosity roughly
  // doubles between Hct 45 and Hct 65 - and the resistance it adds costs more flow than the
  // extra carrying capacity buys in content. That crossover is the optimal-haematocrit result:
  // oxygen transport peaks near Hct 45-50 and is flat to falling above it, which is why
  // polycythaemia is venesected rather than admired. Below 55% the term is zero, so anaemia
  // and every anaemia scenario are untouched.
  const hyperviscosity=clip(z.hct-.85,0,3);
  // Volume the heart cannot accommodate backs up into the lung. Past roughly a 15% expansion
  // the pulmonary capillary pressure exceeds what lymphatic clearance carries off, filtered
  // fluid stays in the interstitium, the A-a gradient widens and the airways narrow. This is
  // the reason a large positive fluid balance shows up as falling oxygenation rather than as
  // nothing at all.
  const congestion=clip(z.bloodVolume-.55,0,3);
  const t={}; solverDefs.forEach(d=>t[d.key]=0);

  // The decompensation spiral. This used to be integrated separately as a fixed nudge per
  // simulated second, which made it a pure function of how long the solver had been running:
  // at a large step it applied a hundred seconds of nudge at once and blew the state up.
  // As target offsets it is scale-free, and the runaway now comes from the loop it closes
  // (weaker contraction -> lower pressure -> deeper shock -> weaker contraction) rather than
  // from an unbounded ramp, which is also the mechanism a learner should be able to trace.
  const viciousShock=clip(-(z.map+.75),0,3), viciousHypoxia=clip(-(z.paO2+.65),0,3);
  const viciousAcid=clip(-(z.pH+.75),0,3), viciousHyperK=clip(z.potassium-1.05,0,3);
  const vicious=viciousShock + .5*viciousHypoxia + .5*viciousAcid + .35*viciousHyperK;
  const kCrisis=viciousHyperK + clip(-z.potassium-1.05,0,3);

  // Pulmonary compensation is the fast responder to a metabolic acid load. Together with the
  // CO2 term in t.paCO2 below, these gains settle PaCO2 on Winter's 1.5*HCO3 + 8 for a lactic
  // acidosis. Lactate keeps only a small direct peripheral-chemoreceptor term, because most of
  // its ventilatory drive should arrive as pH.
  // The pH gain here sets how completely a metabolic acidosis gets compensated, and it was too
  // low. The old value satisfied Winter's formula in the lactic-acidosis scenario only because
  // that scenario also has profound hypoxia driving ventilation through a separate term; give
  // the model a pure metabolic acid load with normal oxygenation and PaCO2 did not move at all.
  // Raised so the closed loop lands on Winter's from the acid load alone. See the note on
  // t.paCO2 for the other half of the balance.
  // The alkalemia limb is the compensatory hypoventilation of a metabolic alkalosis. Without it
  // PaCO2 sat at exactly 40.0 for every bicarbonate from 24 to 45 - the disorder was modelled as
  // having no respiratory answer at all. It is deliberately weaker than the acidosis limb (see
  // RESP_ALK_GAIN for how much weaker and why), and it needs no ceiling of its own because two
  // are already in this equation: hypoventilation raises PaCO2, which comes back through
  // `hypercap`, and lowers PaO2, which comes back through `hypoxia`. That pair is why
  // compensation here stays incomplete, and why PaCO2 in a metabolic alkalosis does not run
  // away however high HCO3- goes.
  // The hyperoxia limb is the Dejours effect - about a tenth of resting ventilatory drive is
  // carotid-body traffic that breathing oxygen switches off, which is a real reason a hyperoxic
  // patient drifts hypercapnic and the main reason hyperoxia is not free in retainers.
  t.chemo = 0.65*hypercap + 1.10*acidosis - RESP_ALK_GAIN*alkalemia + 0.42*hypoxia - 0.11*hyperoxia + 0.10*z.lactate;
  t.symp = 0.54*z.chemo + 0.45*hypoxia + 0.28*z.metDemand + 0.12*z.glucagon + 0.30*vicious
    + (-0.78*z.map + 0.42*shock);
  t.vagal = -0.30*z.chemo - 0.18*z.metDemand + (0.70*z.map - 0.20*shock);
  t.rhythmStability = -0.72*hyperK - 0.62*hypoK - 0.28*acidosis - 0.24*hypoxia - 0.16*clip(z.symp-1.2,0,3) - 0.55*kCrisis;
  t.hr = 0.78*z.symp - 0.70*z.vagal + 0.22*z.chemo + 0.22*z.metDemand - 0.40*hyperK - 0.12*hypoK;
  t.contractility = 0.58*z.symp + 0.24*z.angII - 0.46*acidosis - 0.35*hypoxia - 0.44*shock - 0.38*hyperK - 0.16*hypoK + 0.20*clip(z.rhythmStability, -3, 0) - 0.42*vicious;
  t.venousReturn = 0.88*z.bloodVolume + 0.35*z.symp - 0.18*z.tpr - 0.10*volumeDeficit*volumeDeficit;
  t.sv = 0.62*z.venousReturn + 0.55*z.contractility + 0.25*clip(z.rhythmStability, -3, 0) - 0.36*z.tpr - 0.20*clip(z.hr,0,3) - 0.22*hypoxia - 0.22*acidosis;
  t.co = 0.64*z.hr + 0.78*z.sv + 0.40*clip(z.rhythmStability, -3, 0) - 0.20*clip(z.hr-1.25,0,3) - 0.34*clip(-z.contractility,0,3) - 0.28*kCrisis;
  const localDil = 0.25*hypoxia + 0.18*hypercap + 0.20*clip(z.lactate,0,3);
  // Oxygen is a vasoconstrictor at both ends of its range, so the PaO2 term is one continuous
  // relation rather than two: hypoxia dilates through localDil above, hyperoxia constricts here.
  // Normobaric hyperoxia raises systemic vascular resistance by roughly a fifth and drops
  // cardiac output about a tenth, with a reflex bradycardia that this model gets for free
  // through the baroreflex once the pressure moves. The haematocrit term is viscosity, and
  // viscosity is not linear in haematocrit once the red cells start crowding each other.
  t.tpr = 0.66*z.symp + 0.48*z.angII + 0.25*z.adh + 0.12*z.hct + 0.52*hyperviscosity + 0.14*hyperoxia - localDil;
  t.map = 0.72*z.co + 0.86*z.tpr + 0.36*z.bloodVolume - 0.18*shock - 0.12*volumeDeficit*volumeDeficit;

  t.ventilation = 0.92*z.chemo - 0.58*z.airway + 0.28*z.metDemand + 0.12*z.symp;
  // Peribronchial oedema narrows the airways in a congested lung - the wheeze of "cardiac
  // asthma", which is why a wheezing patient is not automatically an asthmatic one.
  t.airway = -0.18*z.symp + 0.10*acidosis + 0.22*congestion;
  // The lactate term is a CO2 source, not an acid-base shortcut: titrating HCO3- with H+
  // liberates CO2, and the rapid shallow pattern raises dead space. But at 0.25 it cancelled
  // the entire ventilatory response to a metabolic acid load - a patient generating CO2 from
  // buffering blows it off, and it does not hold PaCO2 at 40. Together with the chemoreflex pH
  // gain above and the ventilation coefficient here, the closed loop now settles PaCO2 on
  // Winter's 1.5*HCO3 + 8 across the range, with compensation staying incomplete as it must.
  t.paCO2 = 0.42*z.metDemand + 0.12*z.lactate - 0.95*z.ventilation + 0.32*z.airway + 0.12*clip(-z.co,0,3);
  t.paO2 = 0.78*z.ventilation - 0.68*z.airway - 0.28*z.metDemand + 0.20*z.co - 0.12*clip(z.paCO2,0,3) - 0.52*congestion;
  // Bicarbonate is not one variable on one clock, so it is not integrated as one. The fast
  // pool is chemical: strong acid titrates it within minutes, and an infused dose lands here.
  // The renal pool is NH4+ excretion and HCO3- regeneration, which takes 3-5 days - the single
  // widest time separation in the whole model, and the reason a lactic acidosis cannot be
  // fixed by waiting. The visible HCO3- node is their sum, reconstructed after every step.
  // The PaCO2 term is the acute limb of the 1-versus-3.5 rule: non-bicarbonate buffers release
  // HCO3- as CO2 rises, giving about 1 mmol/L per 10 mmHg within minutes and with no kidney
  // involved. It was missing entirely, which made an acute respiratory acidosis look identical
  // to a chronic one on the bicarbonate - and that difference is the whole diagnostic value.
  t.hco3Buffer = -HCO3_PER_LACTATE * clip(z.lactate, 0, 3) + 0.22*z.paCO2;
  // ...and this is the chronic limb, 3.5 mmol/L per 10 mmHg, reached over 3-5 days. The gain
  // is set so the two limbs actually bracket the published pair rather than nearly coinciding.
  // The potassium term closes the hypokalemia<->alkalosis loop: K+ depletion drives H+ into
  // tubular cells, raising H+ secretion and HCO3- reabsorption, which is why a hypokalemic
  // metabolic alkalosis sustains itself until the K+ deficit is replaced.
  // The alkalemia limb is bicarbonaturia: a filtered HCO3- load that the tubule stops
  // reclaiming simply leaves in the urine, which is why a normal kidney disposes of infused
  // base within a day. Its absence was more than an omission. Compensatory hypercapnia feeds
  // the PaCO2 term above, so without an excretion limb a metabolic alkalosis raised the renal
  // pool, which raised the pH, which deepened the hypoventilation - a positive feedback that
  // showed up as a bicarbonate drifting away from the dose that caused it. It is also the
  // teaching point: a metabolic alkalosis is self-limiting UNLESS something maintains it, and
  // the two things that do are the next two terms - mineralocorticoid excess and potassium
  // depletion. That is why Conn syndrome and diuretic alkalosis persist and a bicarbonate
  // infusion does not.
  t.hco3Renal = 0.95*z.paCO2 - 0.34*z.pH - 0.55*alkalemia + 0.18*z.aldosterone - 0.16*z.potassium;
  // Henderson-Hasselbalch, linearized around baseline: pH = 6.1 + log10(HCO3 / (0.03*PaCO2)),
  // so dz_pH = 0.579*z_HCO3 - 0.781*z_PaCO2 for these base/scale pairs. Lactate has no direct
  // term because a strong acid moves pH only by consuming HCO3 (that is what the anion gap is),
  // and ventilation acts only through PaCO2.
  t.pH = -0.78*z.paCO2 + 0.60*z.bicarbonate;

  t.gfr = 0.58*z.map + 0.22*z.bloodVolume - 0.32*z.symp - 0.23*clip(z.angII,0,3) - 0.28*shock - 0.40*vicious;
  t.renin = -0.72*z.map - 0.52*z.bloodVolume - 0.36*z.sodium + 0.45*z.symp - 0.25*z.angII;
  t.angII = 0.90*z.renin;
  t.aldosterone = 0.72*z.angII + 0.38*z.potassium;
  // ADH also runs on two clocks. z.adh is the plasma AVP signal plus AQP2 membrane
  // trafficking, both minutes. z.aqp2 is channel abundance, which is transcriptional and
  // takes hours to days - it is why concentrating ability lags behind the hormone, in both
  // directions, and why a diabetes-insipidus kidney does not answer desmopressin instantly.
  t.adh = 0.54*z.osm - 0.45*z.bloodVolume - 0.38*z.map + 0.26*z.angII + 0.15*hypercap;
  t.aqp2 = z.adh;
  const adhEffect = 0.65*z.adh + 0.35*z.aqp2;
  t.urine = 0.78*z.gfr - 0.68*adhEffect - 0.55*z.aldosterone - 0.24*z.symp + 0.22*z.map;
  // Urine is not a term here. It is an outflow, and it is integrated as one in fluxVector.
  // What is left is the endogenous set point: how much volume the kidney and the fluid
  // compartments are currently trying to hold, on a six-hour clock.
  t.bloodVolume = 0.18*adhEffect + 0.20*z.aldosterone + 0.10*z.sodium;
  // The urine term used to be NEGATIVE, i.e. a diuresis washed sodium out and lowered the
  // plasma concentration. That is the wrong reading for this model and the honest osmolality
  // above made it visible: twelve hours of forced polyuria drove sodium DOWN to 135, which
  // pulled osmolality down with it and switched OFF the ADH response the disorder is supposed
  // to recruit. Urine is hypotonic to plasma, so losing a lot of it concentrates what is left -
  // which is why the classic presentation of diabetes insipidus is a RISING sodium long before
  // a falling pressure, exactly as the polyuria assertions in scenarioRegression.js state.
  // The sign now runs both ways from baseline, and the other direction is just as clinically
  // familiar: oliguria retains free water and dilutes, which is where SIADH and the oliguric
  // patient's hyponatraemia come from.
  // One lumped urine node cannot separate a water diuresis from an osmotic or thiazide one, so
  // this is the average case, not every case; the model transparency note says so.
  t.sodium = 0.26*z.aldosterone - 0.24*adhEffect + 0.28*z.urine + 0.12*clip(-z.bloodVolume,0,3);
  // Osmolality is not an independent variable, and writing it as one is what let the model
  // report a pair that cannot both be true. Calculated osmolality is 2*[Na+] + glucose + urea,
  // and two of those three are nodes here. The coefficients are arithmetic, not fitting:
  // one sodium state unit is 15 mmol/L, doubled is 30 mOsm, and one osmolality state unit is
  // 25 mOsm, so sodium enters at 30/25 = 1.20; one glucose state unit is 4.72 mmol/L, so
  // glucose enters at 4.72/25 = 0.19. Urea has no node and sits in the baseline offset.
  //
  // What was here instead was 0.68 on sodium - barely half of what the arithmetic gives - plus
  // separate direct terms for ADH, volume deficit and polyuria. Those terms are the same water
  // that had already moved the sodium, counted a second time, and the two errors did not cancel:
  // a forced hyponatremia settled at Na+ 120 with an osmolality of 282 (2 x 120 is 240 before
  // urea), and SIADH reported Na+ 122 with 264. Water now reaches osmolality the way it does in
  // a patient - by moving the sodium - so the two numbers can no longer disagree.
  //
  // This also gives a scenario driver on osm an honest meaning it did not have before: solute
  // that is NOT sodium or glucose, i.e. an osmolal gap. The drivers that were only restating a
  // sodium change have been removed from SCENARIOS accordingly.
  t.osm = 1.20*z.sodium + 0.19*z.glucose;
  // Potassium answers to pH on two separate mechanisms, in both directions, and they are
  // decades apart in time - so they are now two states rather than two terms in one.
  // 1. Transcellular H+/K+ exchange, minutes: in acidemia H+ moves into cells and K+ moves out,
  //    in alkalemia the exchange runs the other way. Roughly 0.3-0.4 mmol/L of K+ per 0.1 pH
  //    unit. An alkalotic patient drifts hypokalemic on distribution alone, without having lost
  //    a single milliequivalent of total-body K+, which is why plasma K+ here is kBody plus a
  //    shift rather than a pool in its own right.
  const pHShift = -0.45*z.pH;
  // 2. Real renal loss, hours to days: alkalosis raises distal K+ secretion, so a sustained
  //    alkalosis converts the shift above into an actual total-body deficit. Acidemia has no
  //    matching term, which is why alkalosis is the more reliable cause of hypokalemia. Only
  //    this limb touches kBody, so the learner can watch redistribution become depletion.
  //    `alkalemia` is declared at the top of this function; the chemoreflex uses it too.
  t.kBody = -0.50*z.aldosterone - 0.25*z.gfr - 0.30*alkalemia - 0.08*polyuricDrive;
  t.potassium = z.kBody + pHShift - 0.14*z.insulin - 0.06*z.symp;
  // Hematocrit is a ratio, so it has a fast limb and a slow one for free: plasma volume moves
  // it within hours, red-cell mass only over days (reticulocytes need 3-4 days after EPO).
  t.rbcMass = 0.18*hypoxia;
  t.hct = z.rbcMass - 0.58*z.bloodVolume;

  t.insulin = 0.82*z.glucose - 0.18*z.symp;
  t.glucagon = -0.58*z.glucose + 0.34*z.symp + 0.25*z.metDemand;
  t.glucose = 0.66*z.glucagon + 0.28*z.symp + 0.22*z.metDemand - 0.88*z.insulin;
  // What reaches tissue is oxygen CONTENT, and content follows the dissociation curve, not the
  // tension. Below baseline the curve is steep and PaO2 tracks content closely, which is what
  // the linear term does and what every hypoxia scenario in this file is calibrated against.
  // Above baseline haemoglobin is already about 97% saturated, so extra PaO2 buys only
  // dissolved oxygen: arterial content rises roughly 3% between PaO2 95 and PaO2 200. Written
  // linearly on both sides, the model paid a 30% delivery bonus for a PaO2 of 145 - it made
  // supplemental oxygen look like a free inotrope for a patient who was already saturated,
  // which is the single most common misreading this simulator could teach. The shoulder in the
  // curve is where the term flattens, and the flattening is the lesson.
  const oxySupply = Math.min(z.paO2, 0) + 0.14*(1 - Math.exp(-hyperoxia/0.6));
  t.tissueO2 = 0.56*z.co + 0.52*oxySupply + 0.24*z.hct - 0.52*hyperviscosity - 0.38*z.metDemand - 0.12*z.tpr;
  // Below the critical oxygen delivery threshold (tissue O2 around 65%), consumption becomes
  // supply-dependent and anaerobic glycolysis accelerates, so lactate production is not linear
  // in delivery. This kink is what separates hypoxic (type A) lactic acidosis from a mild
  // stress lactate, and it is why the disorder can run away once delivery keeps falling.
  const anaerobic = clip(-(z.tissueO2 + 0.85), 0, 3);
  t.lactate = -0.68*z.tissueO2 + 0.60*anaerobic + 0.46*z.metDemand + 0.20*z.symp + 0.15*shock + 0.85*vicious;
  t.tissueO2 -= 0.45*vicious;
  t.metDemand = 0.02*z.symp;

  // External inputs. A scenario driver on a conserved pool was already removed from the bias
  // path by scenarioDrive and is integrated as a flux instead; what is left here is a genuine
  // set-point disturbance plus the learner's own slider. An infused HCO3- dose goes to the
  // fast buffer pool, because that is the compartment a syringe actually reaches.
  defs.forEach(d=>{
    const controlGain = d.key==='urine' ? 2.35 : d.key==='bicarbonate' ? HCO3_CONTROL_GAIN : 1.45;
    const external = scenarioDrive(session,d.key) + (session.controls[d.key]/100) * controlGain;
    if(!external) return;
    if(d.key==='bicarbonate') t.hco3Buffer += external;
    else t[d.key] += external;
  });
  defs.forEach(d=>{ t[d.key] = clampStateValue(d, t[d.key]); });
  hiddenDefs.forEach(d=>{ t[d.key] = clip(t[d.key], -3.2, 3.2); });

  // How far the slow limbs have actually travelled toward what they are currently being asked
  // to do. This replaces the old smoothstep(20,40,simTime) gate, which pretended compensation
  // arrived on a wall clock: a disturbance starting at minute 5 inherited a fully open renal
  // pathway just because the session had been running. Now lateness is a consequence of tau.
  let pending=0, achieved=0;
  SLOW_LIMB_KEYS.forEach(key=>{
    const want=Math.abs(t[key]);
    if(want<.05) return;
    pending+=want;
    achieved+=Math.min(want, Math.abs(z[key]));
  });
  const chronic = pending>0 ? clip(achieved/pending, 0, 1) : 0;
  return {t, chronic};
}

// Contributions are counterfactual, one-at-a-time ablations of the *same* target equations
// used by the simulator. They answer: "if this current input were returned to its baseline,
// how would this parameter's next target change?" They are intentionally non-additive: feedback,
// clipping and nonlinear terms mean that summing individual counterfactuals would be misleading.
// Bicarbonate has no target of its own any more - it is the sum of two pools on very
// different clocks - so an ablation has to compare the composite.
function targetOf(vector, key){
  return key==='bicarbonate' ? (vector.t.hco3Buffer + vector.t.hco3Renal) : vector.t[key];
}
function modelContributions(session, baseResult, requestedKeys=null){
  const base=baseResult || computeTargetVector(session);
  const result={};
  const requested=new Set(requestedKeys || defs.map(definition=>definition.key));
  defs.filter(target=>requested.has(target.key)).forEach(target=>{
    const terms=[];
    // Hidden states are included as sources so that "total-body K+" and "AQP2 abundance"
    // can appear by name in the breakdown; a slow limb that is holding a fast number where
    // it is should be visible as such, not folded into the node it belongs to.
    solverDefs.forEach(source=>{
      const current=session.state[source.key];
      if(!Number.isFinite(current) || Math.abs(current)<.002) return;
      const altered={...session, state:{...session.state,[source.key]:0}};
      const impact=targetOf(base,target.key) - targetOf(computeTargetVector(altered),target.key);
      if(Math.abs(impact)>=.002) terms.push({kind:'state',sourceKey:source.key,value:impact,hidden:Boolean(source.hidden)});
    });
    const control=Number(session.controls[target.key]) || 0;
    if(Math.abs(control)>.05){
      const altered={...session, controls:{...session.controls,[target.key]:0}};
      const impact=targetOf(base,target.key) - targetOf(computeTargetVector(altered),target.key);
      if(Math.abs(impact)>=.002) terms.push({kind:'manual-control',sourceKey:target.key,value:impact});
    }
    const scenarioValue=scenarioDrive(session,target.key);
    if(Math.abs(scenarioValue)>.002){
      const alteredScenario={...session.scenario,drivers:{...(session.scenario?.drivers||{}),[target.key]:0}};
      const altered={...session,scenario:alteredScenario};
      const impact=targetOf(base,target.key) - targetOf(computeTargetVector(altered),target.key);
      if(Math.abs(impact)>=.002) terms.push({kind:'scenario-driver',sourceKey:target.key,value:impact});
    }
    // A flux does not appear in any target, so an ablation cannot find it. It is reported as
    // what it is: a rate, converted to units per minute so the number means something.
    const flux=scenarioFlux(session,target.key);
    if(Math.abs(flux)>1e-9){
      terms.push({kind:'scenario-flux',sourceKey:target.key,value:flux*60,perMinute:true,
        pool:FLUX_TARGET[target.key]||target.key});
    }
    result[target.key]={
      method:'one-at-a-time-baseline-ablation',
      targetState:targetOf(base,target.key),
      targetDelta:targetOf(base,target.key)-session.state[target.key],
      terms:terms.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,7)
    };
  });
  return result;
}

function explainParameter(session,key,lang){
  if(!defByKey[key]) throw new Error('unknown parameter');
  const vector=computeTargetVector(session);
  const contribution=modelContributions(session,vector,[key])[key];
  const l=lang || session.lang || 'zh';
  // The per-node time card. In the failed experiment this information was drawn as a badge on
  // every one of the 34 nodes at once; here it is only ever shown for the node in hand.
  const profile=temporal.localizedProfile(key,l);
  const effective=effectiveTau(session,key);
  return {
    key,
    simTime:session.simTime,
    targetState:contribution.targetState,
    targetDelta:contribution.targetDelta,
    contributionMethod:contribution.method,
    contributions:contribution.terms,
    temporal:profile ? {
      ...profile,
      effectiveTau:effective,
      effectiveTauText:temporal.formatDuration(effective,l),
      // How much of this parameter's current speed is the body's own doing versus the
      // learner holding the slider. It is the honest answer to "why did that move so fast".
      externallyDriven:clip(Math.abs(session.controls[key]||0)/100,0,1),
      hiddenStates:HIDDEN_KEYS.filter(h=>temporal.HIDDEN_STATES[h].owner===key).map(h=>({
        key:h,
        label:temporal.HIDDEN_STATES[h][l==='en'?'en':'zh'],
        value:session.state[h],
        tauText:temporal.formatDuration(temporal.HIDDEN_STATES[h].tau,l)
      }))
    } : null
  };
}

// Acid-base moves on three clocks, and the whole point of the lactic-acidosis scenario is
// that they are decades apart:
//   blood buffering    seconds-minutes  strong acid titrates HCO3- almost 1:1
//   pulmonary comp.    minutes          chemoreceptor -> ventilation -> PaCO2 (already in the network)
//   renal comp.        3-5 days         NH4+ excretion and HCO3- regeneration
// The two HCO3- pools are now ordinary integrated states (hco3Buffer, hco3Renal in
// temporalModel.HIDDEN_STATES) so the solver handles them with everything else; only the
// reconstruction of the visible node stays here.
const HCO3_CONTROL_GAIN = 0.85; // infused HCO3- is partly re-exhaled as CO2, so it under-delivers
// One lactate state unit (4.2 mmol/L) consumes ~0.52 bicarbonate state units (4.2 mmol/L): 1:1.
const HCO3_PER_LACTATE = 0.52;

// The visible bicarbonate node is the sum of its pools, clamped, with any clamping charged
// to the fast pool so the slow renal store is never silently rewritten.
function reconcileBicarbonate(session){
  const d=defByKey.bicarbonate;
  const total=session.state.hco3Renal + session.state.hco3Buffer;
  const bounded=clampStateValue(d,total);
  if(bounded!==total) session.state.hco3Buffer += bounded - total;
  session.state.bicarbonate=bounded;
}
// Seeds the two pools from a scenario's starting bicarbonate: a deficit is buffer already spent
// by acid, a surplus is renal retention that took days to build before the session opened.
function seedBicarbonatePools(session){
  const z0=session.state.bicarbonate;
  session.state.hco3Renal = z0 > 0 ? z0 : 0;
  session.state.hco3Buffer = z0 > 0 ? 0 : z0;
}
// Seeds the hidden slow pools so a scenario that starts mid-illness starts consistently. A
// patient handed to you with K+ 6.0 has been retaining potassium for days; starting kBody at
// zero would make the plasma number collapse back to normal in the first few minutes for no
// reason the learner could see.
function seedHiddenStates(session){
  const z=session.state;
  z.kBody = z.potassium;
  z.aqp2 = z.adh;
  z.rbcMass = z.hct + 0.58*z.bloodVolume;
  seedBicarbonatePools(session);
}

// Effective time constant. An endogenous mechanism and a syringe are not the same clock: the
// kidney needs hours to restore circulating volume, an infusion needs a minute. Interpolating
// between the two by how hard the learner is pushing keeps slow physiology from wrongly
// delaying fast treatment - the single most useful thing the 2026-07-24 experiment found.
function effectiveTau(session, key){
  const d=defByKey[key] || hiddenByKey[key];
  if(!d) return 5;
  const fraction=clip(Math.abs(session.controls?.[key] || 0)/100, 0, 1);
  if(fraction<=0) return d.tau;
  // Two pathways acting on the same pool add their RATES, not their time constants. Blending
  // the taus linearly - which is what the 2026-07-24 experiment did - meant a treatment at 70%
  // strength on a twelve-hour variable still ran at nearly four hours, because 30% of a very
  // slow clock swamps 70% of a fast one. The harmonic form makes a treatment act on the
  // treatment's own timescale, which is the whole point of having a separate one.
  return 1/((1-fraction)/d.tau + fraction/d.directTau);
}
// The decompensation spiral used to be integrated here as a fixed nudge per simulated second.
// It now lives in computeTargetVector as a set of target offsets, which is both scale-free
// and traceable: the learner can ablate it in the contribution breakdown like any other input.
function posCtl(session,k, th=10){ return clip((session.controls[k]-th)/70, 0, 1.4); }
function negCtl(session,k, th=10){ return clip(((-session.controls[k])-th)/70, 0, 1.4); }
function assessConditions(session){
  const A=k=>actual(session,k);
  const conds=[];
  const zh = session.lang !== 'en';
  const add=(id,nameZh,nameEn,severity,help,harm,whyZh,whyEn,goodZh,goodEn,badZh,badEn)=>{
    if(severity<=0.35) return;
    const delta = help - harm;
    let stage = zh ? '持续失衡' : 'Persistent imbalance';
    if(delta>0.28) stage = zh ? '改善中' : 'Improving';
    if(delta<-0.28) stage = zh ? '恶化中' : 'Worsening';
    conds.push({id, name: zh ? nameZh : nameEn, severity:clip(severity,0,4), help:clip(help,0,3), harm:clip(harm,0,3), why:zh?whyZh:whyEn, good:zh?goodZh:goodEn, bad:zh?badZh:badEn, stage});
  };
  const shock = clip((65-A('map'))/18,0,2) + 0.8*clip((4.6-A('bloodVolume'))/1.1,0,2) + 0.7*clip((4.0-A('co'))/1.4,0,2);
  add('shock','低血压/低灌注（休克倾向）','Hypotension / hypoperfusion', shock,
    0.95*posCtl(session,'bloodVolume') + 0.55*posCtl(session,'venousReturn') + 0.55*posCtl(session,'contractility') + 0.40*posCtl(session,'tpr') + 0.28*posCtl(session,'adh') + 0.22*posCtl(session,'angII'),
    0.95*negCtl(session,'bloodVolume') + 0.75*posCtl(session,'urine') + 0.50*negCtl(session,'tpr') + 0.45*negCtl(session,'contractility') + 0.30*negCtl(session,'symp'),
    '平均动脉压、心排量或血容量不足，组织灌注下降。', 'MAP, cardiac output, or blood volume is insufficient, reducing tissue perfusion.',
    '有利：↑血容量/回心血量、↑收缩力、适度↑外周阻力。', 'Helpful: increase volume/venous return, contractility, and moderate vascular tone.',
    '错误：继续利尿、继续丢血容量、过度降阻力/降收缩力。', 'Harmful: excessive diuresis, further volume loss, or suppressing resistance/contractility.');

  const respAcid = (A('paCO2') > 45 && A('pH') < 7.40)
    ? clip((A('paCO2')-46)/12,0,2) + clip((7.35-A('pH'))/0.10,0,2) + 0.6*clip((5.2-A('ventilation'))/2.2,0,2)
    : 0;
  add('respAcid','呼吸性酸中毒/低通气','Respiratory acidosis / hypoventilation', respAcid,
    0.95*posCtl(session,'ventilation') + 0.85*negCtl(session,'airway') + 0.22*posCtl(session,'bicarbonate'),
    0.95*negCtl(session,'ventilation') + 0.90*posCtl(session,'airway') + 0.25*negCtl(session,'bicarbonate'),
    'PaCO₂ 升高并使 pH 下降，提示肺泡通气不足。', 'PaCO₂ rises and pH falls, indicating inadequate alveolar ventilation.',
    '有利：↑通气、↓气道阻力，必要时适度↑HCO₃⁻。', 'Helpful: increase ventilation, reduce airway resistance, and cautiously support bicarbonate if needed.',
    '错误：继续降低通气、增加气道阻力，会加快 CO₂ 潴留。', 'Harmful: further suppressing ventilation or increasing airway resistance accelerates CO₂ retention.');

  const respAlk = (A('paCO2') < 35 && A('pH') > 7.42)
    ? clip((36-A('paCO2'))/8,0,2) + clip((A('pH')-7.45)/0.08,0,2) + 0.45*clip((A('ventilation')-10)/5,0,2)
    : 0;
  add('respAlk','呼吸性碱中毒/过度通气','Respiratory alkalosis / hyperventilation', respAlk,
    0.95*negCtl(session,'ventilation') + 0.55*negCtl(session,'chemo') + 0.35*negCtl(session,'metDemand') + 0.25*posCtl(session,'paCO2'),
    0.95*posCtl(session,'ventilation') + 0.58*posCtl(session,'chemo') + 0.35*negCtl(session,'paCO2') + 0.25*posCtl(session,'pH'),
    'PaCO₂ 下降并推动 pH 升高，常见于通气过强、应激或化学感受驱动过高；碱血症还会把 K⁺ 推入细胞，应同时观察血钾。', 'PaCO₂ falls and pH rises, usually from excessive ventilation, stress, or strong chemoreceptor drive; alkalemia also drives K⁺ into cells, so watch potassium alongside it.',
    '有利：在氧合允许时↓过度通气，降低过强化学感受/代谢驱动。', 'Helpful: reduce excessive ventilation when oxygenation allows, and lower excessive chemoreceptor or metabolic drive.',
    '错误：继续↑通气或压低 PaCO₂，会加重碱中毒。', 'Harmful: further increasing ventilation or lowering PaCO₂ worsens alkalosis.');

  const metAcid = (A('bicarbonate') < 22 && A('paCO2') < 48 && A('lactate') < 4.0)
    ? clip((22-A('bicarbonate'))/4,0,2) + 0.65*clip((7.35-A('pH'))/0.10,0,2) + 0.30*clip((70-A('gfr'))/25,0,2) + 0.25*clip((A('lactate')-2.0)/1.8,0,1.5)
    : 0;
  add('metAcid','代谢性酸中毒/碳酸氢盐不足','Metabolic acidosis / bicarbonate deficit', metAcid,
    0.70*posCtl(session,'bicarbonate') + 0.48*posCtl(session,'gfr') + 0.38*posCtl(session,'ventilation') + 0.35*posCtl(session,'co') + 0.25*negCtl(session,'lactate'),
    0.85*negCtl(session,'bicarbonate') + 0.55*negCtl(session,'gfr') + 0.42*negCtl(session,'ventilation') + 0.38*posCtl(session,'lactate') + 0.30*negCtl(session,'co'),
    'HCO₃⁻ 降低提示代谢性缓冲被消耗，常见于酸生成增加、碱丢失或肾排酸不足。', 'Low HCO₃⁻ suggests consumed metabolic buffer from acid generation, base loss, or impaired renal acid excretion.',
    '有利：补充/恢复 HCO₃⁻，改善肾滤过、灌注与代偿性通气，并降低乳酸负荷。', 'Helpful: restore bicarbonate, improve filtration, perfusion, compensatory ventilation, and reduce lactate load.',
    '错误：继续降低 HCO₃⁻、压低通气或加重乳酸/低灌注。', 'Harmful: further lowering bicarbonate, suppressing ventilation, or worsening lactate and hypoperfusion.');

  const metAlk = (A('bicarbonate') > 30 && A('paCO2') > 35 && A('pH') > 7.43)
    ? clip((A('bicarbonate')-30)/5,0,2) + 0.65*clip((A('pH')-7.45)/0.08,0,2) + 0.25*clip((40-A('paCO2'))/8,0,1.5) + 0.25*clip((3.6-A('potassium'))/0.6,0,1.5)
    : 0;
  add('metAlk','代谢性碱中毒/碳酸氢盐过多','Metabolic alkalosis / bicarbonate excess', metAlk,
    0.85*negCtl(session,'bicarbonate') + 0.45*posCtl(session,'gfr') + 0.36*posCtl(session,'urine') + 0.34*negCtl(session,'aldosterone') + 0.30*posCtl(session,'potassium'),
    0.90*posCtl(session,'bicarbonate') + 0.45*posCtl(session,'aldosterone') + 0.42*posCtl(session,'ventilation') + 0.35*negCtl(session,'potassium') + 0.30*negCtl(session,'gfr'),
    'HCO₃⁻ 过高并伴 pH 升高，提示碱潴留或酸丢失；PaCO₂ 不低可与呼吸性碱中毒区分。低钾与碱中毒互为因果：碱血症使 K⁺ 入细胞并增加肾排钾，而缺钾又促进 H⁺ 排泌和 HCO₃⁻ 重吸收，不补钾则碱中毒难以纠正。', 'High HCO₃⁻ with high pH suggests base retention or acid loss; non-low PaCO₂ separates it from respiratory alkalosis. Hypokalemia and alkalosis sustain each other: alkalemia shifts K⁺ into cells and increases renal K⁺ loss, while K⁺ depletion promotes H⁺ secretion and HCO₃⁻ reabsorption, so the alkalosis resists correction until potassium is replaced.',
    '有利：↓HCO₃⁻ 负荷，支持肾排碱，纠正低钾并降低醛固酮驱动。', 'Helpful: reduce bicarbonate load, support renal base excretion, correct hypokalemia, and lower aldosterone drive.',
    '错误：继续↑HCO₃⁻、过度通气或加重低钾，会维持碱中毒。', 'Harmful: further raising bicarbonate, hyperventilating, or worsening hypokalemia maintains alkalosis.');

  const hypox = clip((60-A('paO2'))/15,0,2) + 0.7*clip((85-A('tissueO2'))/22,0,2);
  add('hypox','低氧血症/组织缺氧','Hypoxemia / tissue hypoxia', hypox,
    0.85*posCtl(session,'ventilation') + 0.75*negCtl(session,'airway') + 0.45*posCtl(session,'co') + 0.25*posCtl(session,'bloodVolume'),
    0.90*negCtl(session,'ventilation') + 0.90*posCtl(session,'airway') + 0.45*negCtl(session,'co'),
    'PaO₂ 或组织供氧不足，缺氧可进一步引起乳酸堆积。', 'PaO₂ or tissue oxygen delivery is insufficient; hypoxia may increase lactate.',
    '有利：↑通气、↓气道阻力、↑心排量以改善氧输送。', 'Helpful: increase ventilation, reduce airway resistance, and improve cardiac output.',
    '错误：压低通气或进一步降低心排量，会使缺氧恶化。', 'Harmful: suppressing ventilation or cardiac output worsens hypoxia.');

  const tachy = A('hr') > 100
    ? 0.42 + clip((A('hr')-100)/28,0,2) + 0.25*clip((A('symp')-70)/16,0,2) + 0.20*clip((A('chemo')-70)/18,0,2) + 0.20*clip((A('metDemand')-1.4)/0.5,0,2) + 0.22*clip((4.2-A('co'))/1.0,0,1.5)
    : 0;
  add('tachy','心率过快','Tachycardia', tachy,
    0.45*negCtl(session,'hr') + 0.50*negCtl(session,'symp') + 0.35*posCtl(session,'vagal') + 0.32*negCtl(session,'metDemand') + 0.30*posCtl(session,'paO2') + 0.28*posCtl(session,'bloodVolume'),
    0.95*posCtl(session,'hr') + 0.70*posCtl(session,'symp') + 0.55*negCtl(session,'vagal') + 0.45*posCtl(session,'metDemand') + 0.28*negCtl(session,'paO2'),
    'HR 超过 100 bpm；可能是低灌注、缺氧、酸碱失衡、应激或代谢需求升高的代偿。', 'HR exceeds 100 bpm and may compensate for hypoperfusion, hypoxia, acid-base imbalance, stress, or high metabolic demand.',
    '有利：先纠正低氧/低容量/高需求，再适度降低过强交感或直接心率驱动。', 'Helpful: correct hypoxia, low volume, or high demand first, then reduce excessive sympathetic or direct rate drive.',
    '错误：继续↑HR/交感/代谢需求，或在低灌注时只压心率。', 'Harmful: further raising HR, sympathetic tone, or demand, or suppressing compensatory rate during hypoperfusion.');

  const brady = A('hr') < 60
    ? 0.42 + clip((60-A('hr'))/18,0,2) + 0.25*clip((A('vagal')-65)/16,0,2) + 0.25*clip((A('potassium')-5.5)/1.0,0,2) + 0.22*clip((4.2-A('co'))/1.0,0,1.5)
    : 0;
  add('brady','心率过缓','Bradycardia', brady,
    0.95*posCtl(session,'hr') + 0.55*posCtl(session,'symp') + 0.50*negCtl(session,'vagal') + 0.42*negCtl(session,'potassium') + 0.35*posCtl(session,'ventilation') + 0.30*posCtl(session,'contractility'),
    0.95*negCtl(session,'hr') + 0.65*posCtl(session,'vagal') + 0.55*posCtl(session,'potassium') + 0.45*negCtl(session,'symp') + 0.35*negCtl(session,'contractility'),
    'HR 低于 60 bpm；若合并低心排、迷走过强、高钾、缺氧或酸中毒，泵血风险上升。', 'HR is below 60 bpm; low output, excessive vagal tone, hyperkalemia, hypoxia, or acidosis increases pumping risk.',
    '有利：↑HR/交感、↓迷走，纠正高钾、缺氧和酸碱异常，并支持收缩力。', 'Helpful: raise HR or sympathetic drive, reduce vagal tone, correct hyperkalemia, hypoxia, acid-base stress, and support contractility.',
    '错误：继续↓HR、↑迷走或升高 K⁺，会降低心排并增加心律风险。', 'Harmful: further lowering HR, increasing vagal tone, or raising K⁺ reduces output and increases rhythm risk.');

  const hyperK = clip((A('potassium')-5.5)/1.0,0,2) + 0.45*clip((7.35-A('pH'))/0.12,0,2) + 0.35*clip((90-A('gfr'))/35,0,2);
  add('hyperK','高钾血症风险','Hyperkalemia risk', hyperK,
    0.70*posCtl(session,'aldosterone') + 0.58*posCtl(session,'gfr') + 0.48*posCtl(session,'urine') + 0.42*posCtl(session,'ventilation') + 0.30*posCtl(session,'insulin') + 0.25*posCtl(session,'bicarbonate'),
    0.95*posCtl(session,'potassium') + 0.55*negCtl(session,'aldosterone') + 0.50*negCtl(session,'gfr') + 0.45*negCtl(session,'ventilation') + 0.35*negCtl(session,'insulin'),
    '血钾升高可抑制心肌兴奋、传导和收缩，酸中毒与肾排钾下降会雪上加霜。', 'High K⁺ impairs myocardial excitability, conduction, and contraction; acidosis and poor renal excretion worsen it.',
    '有利：↑醛固酮/尿量/GFR 促排钾，↑通气/纠酸，↑胰岛素促 K⁺ 入细胞。', 'Helpful: increase aldosterone/urine/GFR for K⁺ excretion, correct acidosis, and insulin-driven cellular uptake.',
    '错误：继续升高 K⁺、压低 GFR/醛固酮/胰岛素，或加重酸中毒。', 'Harmful: further raising K⁺, suppressing GFR/aldosterone/insulin, or worsening acidosis.');

  const alkalemic = clip((A('pH')-7.45)/0.10,0,2);
  // The alkalemia term is gated on potassium having actually drifted down, so an alkalotic
  // patient holding a normal K+ is not flagged, while the classic pairing surfaces early -
  // before K+ reaches the frank-hypokalemia threshold on its own.
  const kDrift = clip((4.0-A('potassium'))/0.5,0,1);
  // The alkalosis coefficient was 0.55, which cleared the 0.35 display threshold by 0.01 at the
  // deepest alkalosis a single slider can produce. A flag that fires by one part in thirty-five
  // is not really firing, and it stopped firing at all once the chemoreflex started answering to
  // alkalemia and the achievable pH fell by 0.008. At 0.75 the pairing this term exists to
  // surface - an alkalemic patient whose K+ has started to drift, before either number is
  // frankly abnormal - is named while it is still worth naming, which is what the note above
  // says it is for.
  const hypoK = clip((3.3-A('potassium'))/0.55,0,2) + 0.75*alkalemic*kDrift + 0.25*clip((A('aldosterone')-1.5)/0.5,0,2) + 0.25*clip((A('urine')-2.0)/1.2,0,2);
  const alkalosisDriven = A('pH') > 7.45 && A('potassium') < 3.8;
  add('hypoK',
    alkalosisDriven?'碱中毒相关低钾血症':'低钾血症风险',
    alkalosisDriven?'Alkalosis-related hypokalemia':'Hypokalemia risk',
    hypoK,
    0.95*posCtl(session,'potassium') + 0.50*negCtl(session,'aldosterone') + 0.42*negCtl(session,'urine') + 0.30*negCtl(session,'insulin') + 0.45*negCtl(session,'ventilation')*alkalemic + 0.40*negCtl(session,'bicarbonate')*alkalemic,
    0.95*negCtl(session,'potassium') + 0.62*posCtl(session,'aldosterone') + 0.48*posCtl(session,'urine') + 0.36*posCtl(session,'insulin') + 0.50*posCtl(session,'ventilation')*alkalemic + 0.45*posCtl(session,'bicarbonate')*alkalemic,
    alkalosisDriven
      ? '碱血症时 H⁺ 从细胞内移出、K⁺ 移入细胞，血钾因此下降——起初只是分布改变，总体钾并未丢失；但碱中毒持续时肾脏远端排钾增加，会把这种转移变成真正的缺钾。'
      : '血钾过低会增加心肌电不稳定性，也可通过肌无力和心律失常降低有效泵血。',
    alkalosisDriven
      ? 'In alkalemia H⁺ leaves cells and K⁺ moves in, so serum K⁺ falls. At first this is redistribution only, with no loss of total-body potassium, but a sustained alkalosis also increases distal renal K⁺ secretion and converts the shift into a genuine deficit.'
      : 'Low K⁺ increases electrical instability and can reduce effective pumping through weakness or arrhythmia.',
    alkalosisDriven
      ? '有利：先纠正碱中毒本身（↓过度通气或↓HCO₃⁻ 负荷），钾会随 pH 回落而自行回升；同时补钾以覆盖已经丢失的部分。'
      : '有利：↑K⁺，减少过强醛固酮/利尿/胰岛素驱动。',
    alkalosisDriven
      ? 'Helpful: correct the alkalosis itself first - reduce excessive ventilation or bicarbonate load - and potassium rises again as pH falls; replace K⁺ alongside to cover what has genuinely been lost.'
      : 'Helpful: restore K⁺ and reduce excessive aldosterone, diuresis, or insulin-driven K⁺ shift.',
    alkalosisDriven
      ? '错误：只盯着补钾却继续过度通气或继续补碱——pH 不回来，钾会不断被推回细胞内；也不要继续促排钾。'
      : '错误：继续降 K⁺、增强排钾或促 K⁺ 入细胞，会加重心律风险。',
    alkalosisDriven
      ? 'Harmful: chasing the potassium number while still hyperventilating or still giving base - until pH comes down, K⁺ keeps being driven back into cells - or further increasing renal K⁺ loss.'
      : 'Harmful: further lowering K⁺ or increasing renal/cellular K⁺ removal worsens rhythm risk.');

  const hypoNa = A('sodium') < 135
    ? 0.42 + clip((135-A('sodium'))/7,0,2) + 0.45*clip((275-A('osm'))/10,0,2) + 0.25*clip((A('adh')-1.6)/0.8,0,1.5) + 0.20*clip((A('bloodVolume')-5.4)/0.7,0,1.5)
    : 0;
  add('hyponatremia','低钠血症/稀释性水过多','Hyponatremia / dilutional water excess', hypoNa,
    0.95*posCtl(session,'sodium') + 0.60*negCtl(session,'adh') + 0.48*posCtl(session,'urine') + 0.35*negCtl(session,'bloodVolume') + 0.28*posCtl(session,'osm'),
    0.95*negCtl(session,'sodium') + 0.70*posCtl(session,'adh') + 0.55*negCtl(session,'urine') + 0.45*posCtl(session,'bloodVolume') + 0.28*negCtl(session,'osm'),
    '血钠低于 135 mmol/L，常表示水相对钠过多；低渗时水进入细胞，脑细胞肿胀风险上升。', 'Sodium below 135 mmol/L often reflects excess water relative to sodium; hypotonicity drives water into cells and can swell brain cells.',
    '有利：谨慎↑Na⁺，减少 ADH/水潴留，增加自由水排出并纠正低渗。', 'Helpful: cautiously raise Na⁺, reduce ADH and water retention, increase free-water excretion, and correct hypotonicity.',
    '错误：继续↓Na⁺、↑ADH 或保水，会加重细胞水肿风险。', 'Harmful: further lowering Na⁺, raising ADH, or retaining water worsens cellular swelling risk.');

  const hypoG = clip((3.9-A('glucose'))/1.0,0,2) + 0.35*clip((92-A('tissueO2'))/25,0,2);
  add('hypogly','低血糖风险','Hypoglycemia risk', hypoG,
    0.95*posCtl(session,'glucose') + 0.80*negCtl(session,'insulin') + 0.55*posCtl(session,'glucagon'),
    0.95*posCtl(session,'insulin') + 0.75*negCtl(session,'glucose') + 0.40*posCtl(session,'metDemand'),
    '血糖过低会威胁中枢能量供应。', 'Low glucose threatens central nervous system energy supply.',
    '有利：↑血糖、↓胰岛素、↑胰高血糖素。', 'Helpful: raise glucose, reduce insulin effect, and increase glucagon.',
    '错误：在低血糖时继续升高胰岛素或继续降糖。', 'Harmful: increasing insulin or further lowering glucose during hypoglycemia.');

  const hyperG = clip((A('glucose')-10.0)/4.4,0,2) + 0.55*clip((A('osm')-305)/12,0,2);
  add('hypergly','高血糖/高渗状态','Hyperglycemia / hyperosmolar state', hyperG,
    0.95*posCtl(session,'insulin') + 0.65*negCtl(session,'glucagon') + 0.45*negCtl(session,'glucose'),
    0.90*negCtl(session,'insulin') + 0.72*posCtl(session,'glucose') + 0.65*posCtl(session,'glucagon'),
    '高血糖合并高渗会加重渗透负担与利尿。', 'Hyperglycemia with hyperosmolality increases osmotic stress and diuresis.',
    '有利：↑胰岛素、↓胰高血糖素，逐步拉回血糖。', 'Helpful: increase insulin effect, reduce glucagon, and gradually reduce glucose.',
    '错误：继续推高血糖或抑制胰岛素，会加重高渗。', 'Harmful: raising glucose or suppressing insulin worsens hyperosmolality.');

  const htn = clip((A('map')-110)/18,0,2) + 0.55*clip((A('bloodVolume')-5.5)/0.8,0,2) + 0.45*clip((A('tpr')-1.35)/0.25,0,2);
  add('htn','高血压/容量负荷过多','Hypertension / volume overload', htn,
    0.80*negCtl(session,'tpr') + 0.70*posCtl(session,'urine') + 0.65*negCtl(session,'bloodVolume') + 0.42*negCtl(session,'angII') + 0.36*negCtl(session,'aldosterone'),
    0.85*posCtl(session,'tpr') + 0.85*posCtl(session,'bloodVolume') + 0.58*posCtl(session,'angII') + 0.45*posCtl(session,'sodium'),
    '血压过高往往伴阻力或容量过高，长期会增加心肾负担。', 'High pressure often reflects excessive resistance or volume and burdens heart and kidney.',
    '有利：↓外周阻力、适度利尿、↓容量和 RAAS 活性。', 'Helpful: reduce peripheral resistance, gently increase urine, lower volume and RAAS activity.',
    '错误：继续升高阻力、血容量或 Na⁺/Ang II。', 'Harmful: further increasing resistance, volume, Na⁺, or Ang II.');

  const lowGfr = A('gfr') < 60
    ? 0.48 + clip((60-A('gfr'))/20,0,2) + 0.35*clip((65-A('map'))/18,0,2) + 0.28*clip((4.5-A('bloodVolume'))/0.8,0,2) + 0.24*clip((A('angII')-1.8)/0.8,0,1.5)
    : 0;
  add('lowGfr','肾小球滤过率降低','Low glomerular filtration rate', lowGfr,
    0.85*posCtl(session,'gfr') + 0.55*posCtl(session,'map') + 0.45*posCtl(session,'bloodVolume') + 0.36*negCtl(session,'symp') + 0.32*negCtl(session,'angII'),
    0.85*negCtl(session,'gfr') + 0.62*negCtl(session,'map') + 0.52*negCtl(session,'bloodVolume') + 0.45*posCtl(session,'symp') + 0.38*posCtl(session,'angII'),
    'GFR 低于 60 mL/min 提示滤过废物和多余液体能力下降；持续存在可对应慢性肾病风险。', 'GFR below 60 mL/min indicates reduced filtration of waste and excess fluid; persistence would suggest CKD risk.',
    '有利：改善肾灌注与有效循环量，避免过强交感/Ang II 收缩肾血管。', 'Helpful: improve renal perfusion and effective circulating volume, and avoid excessive sympathetic or Ang II renal vasoconstriction.',
    '错误：继续降低 MAP/血容量/GFR，或强化交感和 Ang II，会压低滤过。', 'Harmful: further lowering MAP, volume, or GFR, or intensifying sympathetic and Ang II tone suppresses filtration.');

  const diabetesInsipidusPattern=A('urine')>2.1 && A('adh')<.75 && (A('sodium')>145 || A('osm')>300);
  const polyuria = A('urine') > 2.1
    ? 0.42 + clip((A('urine')-2.1)/1.8,0,2) + 0.45*clip((4.5-A('bloodVolume'))/0.8,0,2) + 0.30*clip((A('osm')-300)/18,0,1.5)
    : 0;
  add('polyuria',
    diabetesInsipidusPattern?'尿崩症样多尿/高钠脱水':'多尿/容量丢失',
    diabetesInsipidusPattern?'Diabetes-insipidus pattern / hypernatremic water loss':'Polyuria / volume depletion',
    polyuria,
    0.90*negCtl(session,'urine') + 0.60*posCtl(session,'bloodVolume') + 0.48*posCtl(session,'adh') + 0.30*posCtl(session,'gfr'),
    0.95*posCtl(session,'urine') + 0.70*negCtl(session,'bloodVolume') + 0.48*negCtl(session,'adh') + 0.30*negCtl(session,'gfr'),
    diabetesInsipidusPattern
      ? '尿量超过多尿阈值，同时 ADH 偏低并出现高钠/高渗，符合尿崩症样自由水丢失模式。'
      : '尿量超过约 2.1 mL/min（约 3 L/日）；若补水不能匹配，血容量、回心血量和血压会逐步下降。',
    diabetesInsipidusPattern
      ? 'Urine flow exceeds the polyuria threshold while ADH is low and sodium/osmolality is high, matching a diabetes-insipidus free-water-loss pattern.'
      : 'Urine flow exceeds about 2.1 mL/min (about 3 L/day); without matched intake, circulating volume, venous return, and pressure progressively fall.',
    '有利：降低过强尿流驱动、补充有效循环量；若为尿崩症样模式，应恢复 ADH 水通道效应并监测钠/渗透压。',
    'Helpful: reduce excessive urine flow and restore effective volume; for a diabetes-insipidus pattern, restore ADH water-channel effect and monitor sodium/osmolality.',
    '错误：继续强迫利尿、继续降低血容量，或在自由水丢失时抑制 ADH，会加重脱水和低灌注。',
    'Harmful: continued forced diuresis, further volume loss, or suppressing ADH during free-water loss worsens dehydration and hypoperfusion.');

  const oliguria = A('urine') < .5
    ? 0.42 + clip((.5-A('urine'))/.28,0,2) + 0.45*clip((75-A('gfr'))/30,0,2) + 0.35*clip((70-A('map'))/20,0,2)
    : 0;
  add('oliguria','少尿/肾灌注不足风险','Oliguria / impaired renal perfusion risk', oliguria,
    0.58*posCtl(session,'map') + 0.55*posCtl(session,'bloodVolume') + 0.52*posCtl(session,'gfr') + 0.32*negCtl(session,'symp') + 0.22*negCtl(session,'adh'),
    0.72*negCtl(session,'gfr') + 0.62*negCtl(session,'map') + 0.55*negCtl(session,'bloodVolume') + 0.38*posCtl(session,'symp') + 0.32*posCtl(session,'adh'),
    '尿量显著减少可见于生理性保水，也可提示低容量、低肾灌注或急性肾损伤；需结合 MAP、血容量和 GFR 判断。',
    'Markedly reduced urine output may be appropriate water conservation or may signal low volume, impaired renal perfusion, or acute kidney injury; interpret it with MAP, volume, and GFR.',
    '有利：优先纠正低容量/低灌注并恢复滤过；不要把单纯“推高尿量”当作病因治疗。',
    'Helpful: correct low volume or perfusion and restore filtration first; do not treat a higher urine number alone as correction of the cause.',
    '错误：继续降低 MAP、血容量或 GFR，或在低灌注时强化交感/保水驱动，会加重肾脏风险。',
    'Harmful: further lowering MAP, volume, or GFR, or intensifying vasoconstrictive/water-retaining drive during hypoperfusion worsens renal risk.');

  const lac = (A('lactate') > 2.5 || A('tissueO2') < 85)
    ? clip((A('lactate')-2.5)/2.0,0,2) + 0.8*clip((7.34-A('pH'))/0.10,0,2) + 0.5*clip((85-A('tissueO2'))/20,0,2)
    : 0;
  add('lactic','乳酸酸中毒/组织缺氧','Lactic acidosis / tissue hypoxia', lac,
    0.60*posCtl(session,'co') + 0.55*posCtl(session,'bloodVolume') + 0.50*posCtl(session,'paO2') + 0.45*posCtl(session,'ventilation') + 0.35*negCtl(session,'airway') + 0.30*posCtl(session,'hct'),
    0.62*negCtl(session,'co') + 0.55*negCtl(session,'bloodVolume') + 0.60*negCtl(session,'ventilation') + 0.50*negCtl(session,'paO2') + 0.35*posCtl(session,'metDemand'),
    '氧输送跟不上需求，无氧糖酵解产生的乳酸按约 1:1 滴定掉 HCO₃⁻，pH 随之下降。缓冲在数分钟内耗尽，肺代偿在其后压低 PaCO₂，而肾脏排酸需 3～5 天，本轮内基本指望不上。',
    'Oxygen delivery has fallen behind demand, so lactate from anaerobic glycolysis titrates HCO₃⁻ roughly 1:1 and pH follows it down. Buffer is spent within minutes and pulmonary compensation then lowers PaCO₂, but renal acid excretion takes 3-5 days and is effectively unavailable within this run.',
    '有利：恢复氧输送本身——↑PaO₂/通气、↓气道阻力、↑心排量与血容量、↑携氧能力；通气代偿是买时间的手段。',
    'Helpful: restore oxygen delivery itself - raise PaO₂ and ventilation, lower airway resistance, support cardiac output, volume and carrying capacity; ventilatory compensation only buys time.',
    '错误：继续压低氧输送或通气；也不要把补 HCO₃⁻ 当作治疗——不解决缺氧，乳酸会继续把补进去的缓冲吃掉。',
    'Harmful: further reducing oxygen delivery or ventilation. Giving HCO₃⁻ is not the treatment either: while hypoxia persists, ongoing lactate consumes whatever base is added.');

  conds.sort((a,b)=>b.severity-a.severity);
  return conds;
}
// Which way each slider would push this patient, and which problem would pay for it.
//
// This exists because 34 sliders invite treating the number: a learner who reads K+ 6.2 and
// drags potassium down has done something that looks like treatment and is not. The engine
// already grades that - every condition carries `help` and `harm` scores built from the
// intervention directions that matter for it - but it only grades it after the fact, in the
// session report. A novice needs to be told while their finger is still on the slider.
//
// It is computed by probing rather than by publishing a table, and that is deliberate: probing
// calls the very function that scores the session, so the caution can never drift out of step
// with the grade. A hand-written table of harmful directions would be a second source of truth
// and would eventually contradict the first.
//
// The probe is structural, not incremental: each key is tested from zero against a full push in
// both directions, so the answer is "which way is wrong for this patient" and not "would one
// more millimetre of an already-saturated slider still register".
//
// Harm is netted across EVERY active condition, weighted by severity, rather than read off the
// single dominant one. The dominant-condition rule is what a first implementation does and it
// misses the most important case in the model: give bicarbonate to an alkalaemic salicylate
// patient and it kills them, but the dominant condition there is the respiratory alkalosis,
// which bicarbonate does not touch. The metabolic alkalosis that the bicarbonate feeds is only
// the second-ranked problem. Netting also stops the line from crying wolf - an intervention
// that helps one problem more than it costs another does not fire.
const PROBE_NET_HARM = 0.15;
const PROBE_HAZARD_DELTA = 0.02;
// Below this the slider is at rest and there is nothing to caution about.
const CAUTION_MIN_CONTROL = 8;
const HAZARD_DOMAIN_LABELS = {
  circulation:{zh:'循环灌注', en:'circulatory perfusion'}, respiration:{zh:'氧合与通气', en:'oxygenation and ventilation'},
  acidBase:{zh:'酸碱平衡', en:'acid-base balance'}, rhythm:{zh:'心律与血钾', en:'rhythm and potassium'},
  metabolic:{zh:'低血糖', en:'hypoglycaemia'}, osmoticLoad:{zh:'渗透负荷', en:'osmotic load'},
  neuroOsm:{zh:'血钠与脑渗透', en:'sodium and cerebral osmolality'}, pressure:{zh:'血压过高', en:'excessive pressure'},
  renal:{zh:'肾滤过与尿量', en:'filtration and urine output'}, waterLoss:{zh:'失水', en:'water loss'}
};
// Where the current control vector is driving the patient, expressed as the hazard the damage
// model would be integrating once the state arrives there. `computeTargetVector` already knows
// what the controls are aiming at, so this asks the same question the solver asks and does not
// need to integrate anything.
function hazardAtTarget(session){
  const {t}=computeTargetVector(session);
  const state={...session.state, ...t};
  // Bicarbonate is not integrated directly; it is reconciled from its buffer and renal pools,
  // exactly as advanceStep does. Reading t.bicarbonate instead would probe a value the solver
  // never uses.
  if(Number.isFinite(t.hco3Buffer) && Number.isFinite(t.hco3Renal)){
    state.bicarbonate=clampStateValue(defByKey.bicarbonate, t.hco3Buffer + t.hco3Renal);
  }
  const domains=computeDomainRisks({state});
  const {combined, ranked}=aggregateHazard(domains);
  return {combined, domains, worst:ranked[0]};
}
// Is the intervention currently set on `key` making this patient worse?
//
// Asked about the value the learner has actually dragged to, not about a hypothetical full push.
// That matters: at HCO3 27 a full -80 probe overshoots into bicarbonate deficiency and reports
// "lowering is harmful", which would caution a learner who was doing the right thing gently.
// The question worth answering is only ever about the drag in progress.
//
// Two readings, because they catch different mistakes.
//
//   conditions  the clinical-strategy reading: severity-weighted net of every active condition's
//               own help and harm terms. This names the syndrome and supplies a sentence the
//               learner can act on.
//   hazard      where the setting actually drives the patient, scored with the very number the
//               damage model integrates. This one cannot be argued with, and it is the only one
//               that catches giving bicarbonate to an alkalaemic salicylate patient: no active
//               condition lists bicarbonate among its harmful directions there, yet the pH it
//               drives toward is lethal, which is why the regression can kill that patient.
function evaluateIntervention(session, key){
  const d=defByKey[key];
  if(!d) return null;
  const saved=session.controls[key];
  if(Math.abs(saved) < CAUTION_MIN_CONTROL) return null;
  const measure=()=>({conds:assessConditions(session), hazard:hazardAtTarget(session)});
  session.controls[key]=0;
  const base=measure();
  session.controls[key]=saved;
  const now=measure();
  const byId=new Map(base.conds.map(c=>[c.id, c]));
  let net=0, worst=null, worstCost=0;
  now.conds.forEach(c=>{
    const before=byId.get(c.id);
    // A condition the intervention has newly created counts fully against it.
    const cost=before
      ? c.severity*((c.harm-before.harm)-(c.help-before.help))
      : c.severity*(c.harm-c.help);
    net+=cost;
    if(cost>worstCost){ worstCost=cost; worst=c; }
  });
  const hazardDelta=now.hazard.combined-base.hazard.combined;
  if(net<=PROBE_NET_HARM && hazardDelta<=PROBE_HAZARD_DELTA) return null;
  const zh=session.lang !== 'en';
  const raising=saved>0;
  const label=DEF_DATA.find(x=>x.key===key).label[zh?'zh':'en'];
  const verb=zh ? (raising?'升高':'降低') : (raising?'Raising':'Lowering');
  // Two wordings, because the two signals are about different things. A condition is a syndrome
  // you can make worse, and it carries its own authored guidance. A hazard domain is not a
  // syndrome - "worsening circulatory perfusion" reads backwards, since what worsens is the
  // impairment, not the perfusion - so that case says which boundary is being approached instead.
  let name, text;
  if(net>PROBE_NET_HARM && worst){
    name=worst.name;
    text=zh
      ? `${verb}「${label}」正在加重「${name}」。${worst.bad}`
      : `${verb} ${label} is worsening ${name}. ${worst.bad}`;
  }else{
    const domain=HAZARD_DOMAIN_LABELS[now.hazard.worst.key];
    name=domain ? (zh?domain.zh:domain.en) : now.hazard.worst.key;
    // Phrased without a possessive: several domain labels are plural ("oxygenation and
    // ventilation"), which "its danger boundary" gets wrong.
    text=zh
      ? `${verb}「${label}」正在把${name}推向危险，而不是拉回来。`
      : `${verb} ${label} is driving ${name} toward danger rather than back.`;
  }
  return {
    key, direction:raising?1:-1, conditionName:name,
    net:round4(net), hazardDelta:round4(hazardDelta), text
  };
}
function announceConditionTrends(session){
  session.activeConditions.slice(0,4).forEach(c=>{
    const prev = session.conditionMemory[c.id] || '';
    const trend = c.help-c.harm>0.35 ? 'improve' : c.harm-c.help>0.35 ? 'worsen' : 'hold';
    if(prev!==trend && session.simTime>1.5){
      if(trend==='improve') addLog(session, session.lang==='zh' ? `针对“${c.name}”的策略开始见效。` : `The strategy for "${c.name}" is starting to help.`);
      if(trend==='worsen') addLog(session, session.lang==='zh' ? `错误策略正在加重“${c.name}”。` : `An incorrect strategy is worsening "${c.name}".`);
      session.conditionMemory[c.id]=trend;
    }
  });
}
function lowHazard(value,warn,danger){
  if(value>=warn) return 0;
  const ratio=(warn-value)/(warn-danger || 1);
  return ratio<1 ? smoothstep(0,1,ratio) : clip(ratio,1,2.5);
}
function highHazard(value,warn,danger){
  if(value<=warn) return 0;
  const ratio=(value-warn)/(danger-warn || 1);
  return ratio<1 ? smoothstep(0,1,ratio) : clip(ratio,1,2.5);
}
function computeDomainRisks(session){
  const A=k=>actual(session,k);
  // Volume is a reserve, not a cause of death. What kills is what a low volume does to
  // pressure, output and delivery, and those are already scored here. Once blood volume got
  // its real six-hour time constant it stopped quietly refilling itself, so scoring the
  // volume number as directly lethal meant every scenario that hands the learner a
  // volume-depleted patient decompensated within two minutes no matter what the pressure was.
  // It now contributes at reduced weight and over a wider range, which also makes the
  // teaching point sharper: recognise the deficit before the pressure falls.
  const circulation=Math.max(
    lowHazard(A('map'),65,45), lowHazard(A('co'),3.5,2.0),
    lowHazard(A('tissueO2'),70,35), highHazard(A('lactate'),4,10),
    .55*lowHazard(A('bloodVolume'),4.0,2.6)
  );
  const respiration=Math.max(
    lowHazard(A('paO2'),60,35), highHazard(A('paCO2'),55,80),
    lowHazard(A('paCO2'),25,10), lowHazard(A('ventilation'),3,1)
  );
  const acidBase=Math.max(
    lowHazard(A('pH'),7.25,6.95), highHazard(A('pH'),7.55,7.75),
    lowHazard(A('bicarbonate'),18,8)
  );
  const rhythmContext=(A('rhythmStability')<80 || A('co')<3.5) ? 1 : .25;
  const rhythm=Math.max(
    lowHazard(A('rhythmStability'),75,45), highHazard(A('potassium'),5.5,8),
    lowHazard(A('potassium'),3.2,2), highHazard(A('hr'),150,200)*rhythmContext,
    lowHazard(A('hr'),45,25)
  );
  // Hypoglycaemia and hyperglycaemia are not the same kind of danger and must not share a
  // hazard. Neuroglycopenia kills in minutes; a glucose of 32 mmol/L kills over days, through
  // osmotic diuresis and volume loss. Scoring them together made the hyperosmolar scenario
  // decompensate in two minutes, which is a statement about the damage model rather than
  // about the patient.
  const metabolic=lowHazard(A('glucose'),3.3,1.4);
  const osmoticLoad=Math.max(highHazard(A('glucose'),13.9,33.3), highHazard(A('osm'),305,340));
  const hypotonicContext=clip((132-A('sodium'))/12,0,1);
  const neuroOsm=Math.max(
    lowHazard(A('sodium'),130,115), highHazard(A('sodium'),155,175),
    lowHazard(A('osm'),270,240)*hypotonicContext
  );
  const pressure=highHazard(A('map'),145,190);
  const gfrRisk=lowHazard(A('gfr'),60,15);
  const oliguriaRisk=lowHazard(A('urine'),.3,.05)*(A('gfr')<60?1:.12);
  const depletionContext=Math.max(
    lowHazard(A('bloodVolume'),4.5,3.2), lowHazard(A('map'),70,50),
    highHazard(A('sodium'),150,170), highHazard(A('osm'),305,340)
  );
  const polyuriaRisk=highHazard(A('urine'),2.1,6.0)*(.38+.62*depletionContext);
  const renal=Math.max(gfrRisk,oliguriaRisk);
  const waterLoss=polyuriaRisk;
  return {circulation,respiration,acidBase,rhythm,metabolic,osmoticLoad,neuroOsm,pressure,renal,waterLoss};
}
// The one scalar the damage model integrates: the worst hazard domain plus a discount on the
// second worst, so a patient failing in two systems at once is worse off than one failing in
// a single system. Extracted from updateHealth so that the intervention caution can ask what
// a proposed drag would do to the same number the patient is actually dying of, instead of
// re-deriving it and eventually disagreeing.
const HAZARD_WEIGHTS = {circulation:1.25,respiration:1.20,acidBase:1.15,rhythm:1.30,metabolic:1.0,
  osmoticLoad:.42,neuroOsm:1.05,pressure:.45,renal:.25,waterLoss:.50};
function aggregateHazard(domains){
  const ranked=Object.entries(domains)
    .map(([key,value])=>({key,value,score:value*HAZARD_WEIGHTS[key]}))
    .sort((a,b)=>b.score-a.score);
  return {combined:ranked[0].score + .30*(ranked[1]?.score||0), ranked};
}
// The clinical condition list is a reading of the current state for the learner, not part of
// the integration, so it runs once per frame instead of once per macro step. At the days lens
// a frame can contain a hundred steps, and rebuilding eighteen condition objects inside each
// of them was the single largest cost in the solver.
function refreshConditions(session){
  session.activeConditions=assessConditions(session);
  announceConditionTrends(session);
  return session.activeConditions;
}
function updateHealth(session,dt){
  const offenders=[];
  defs.forEach(d=>{
    const sev=severityFor(session,d); if(sev>0) offenders.push([d.key,sev*(d.weight||1)]);
    const z=zoneOf(session,d.key); if(z!==session.prevZones[d.key]){
      const raw=DEF_DATA.find(x=>x.key===d.key);
      const value=actual(session,d.key);
      // A boundary crossing is both a log line and a timestamped event. The event is what
      // survives a fast-forward: the log shows the eight most recent lines, the event carries
      // the simulated time it happened at and, when it is a danger crossing, stops the frame.
      if(z==='warn'){
        addLog(session, session.lang==='zh' ? `${d.label}进入警戒区：${fmt(d,value)} ${d.unit}` : `${raw.label.en} entered warning range: ${fmt(d,value)} ${raw.unit.en}`);
        emitEvent(session,{type:'zone',key:d.key,zone:'warn',value,
          zh:`${d.label}进入警戒区 ${fmt(d,value)} ${d.unit}`, en:`${raw.label.en} entered the warning range at ${fmt(d,value)} ${raw.unit.en}`});
      }
      if(z==='danger'){
        addLog(session, session.lang==='zh' ? `${d.label}越过危险边界：${fmt(d,value)} ${d.unit}` : `${raw.label.en} crossed a danger boundary: ${fmt(d,value)} ${raw.unit.en}`);
        emitEvent(session,{type:'zone',key:d.key,zone:'danger',value,critical:true,
          zh:`${d.label}越过危险边界 ${fmt(d,value)} ${d.unit}`, en:`${raw.label.en} crossed a danger boundary at ${fmt(d,value)} ${raw.unit.en}`});
      }
      if(z==='normal' && session.prevZones[d.key]!=='normal'){
        addLog(session, session.lang==='zh' ? `${d.label}回到可代偿范围。` : `${raw.label.en} returned to compensable range.`);
        emitEvent(session,{type:'zone',key:d.key,zone:'normal',value,
          zh:`${d.label}回到可代偿范围 ${fmt(d,value)} ${d.unit}`, en:`${raw.label.en} returned to the compensable range at ${fmt(d,value)} ${raw.unit.en}`});
      }
      session.prevZones[d.key]=z;
    }
  });

  const domains=computeDomainRisks(session);
  const {combined, ranked}=aggregateHazard(domains);
  // Exposure and strain are trapezoid-integrated for the same reason health is: they feed the
  // damage rate nonlinearly, and on the endpoint rule they were the entire remaining source of
  // disagreement between a fine run and a coarse one. With this, the state vector and the
  // stability score both reproduce across every lens.
  const prevDomains=session.prevDomains || domains;
  Object.entries(domains).forEach(([key,value])=>{
    const prior=session.domainExposure[key]||0;
    const mean=.5*(value+(prevDomains[key]||0));
    session.domainExposure[key]=mean>.04 ? clip(prior+mean*dt,0,180) : Math.max(0,prior-.80*dt);
  });
  session.prevDomains=domains;
  const primaryExposure=session.domainExposure[ranked[0].key]||0;
  const exposureFactor=1-Math.exp(-primaryExposure/18);

  // An unscored session stops here. Everything above this line still runs - zone crossings,
  // events, the offender ranking, the domain hazards the condition list and the intervention
  // caution both read - so the physiology and the clinical reading are unchanged. Only the
  // integration below, which is the part that can kill, is skipped. The stability rate is
  // reported as zero rather than left stale, because the auto-scaling ceiling divides by it.
  if(session.noThreat){
    session.health=100;
    session.strain=0;
    session.healthChangeRate=0;
    session.damageRate=0;
    session.prevHealthRate=0;
    session.prevStrainRate=0;
    session.combinedHazard=combined;
    session.domainRisks=domains;
    session.offenders=offenders.sort((a,b)=>b[1]-a[1]).slice(0,6).map(o=>o[0]);
    return;
  }

  // Damage now has two clocks of its own, because the old single accumulator only made sense
  // for a run that lasted a few minutes. Scored per simulated second and then asked to cross
  // six hours, it killed anyone who sat slightly outside the warning band all afternoon.
  //
  //   acute    what actually kills quickly: being at or past a danger boundary. Unchanged in
  //            pace, so a haemorrhage still decompensates in minutes.
  //   chronic  the cost of living in the warning band. About 2 stability points per hour at
  //            the top of that band, which is a burden over a day and nothing over a minute.
  const acute=Math.max(0, combined-ACUTE_HAZARD_FLOOR);
  const chronicLoad=Math.min(combined, ACUTE_HAZARD_FLOOR);
  let acuteRate=0, chronicRate=0, recoveryRate=0;
  const strainRate=combined<.06 ? -.025 : Math.max(0,combined-.12)*.018;
  const prevStrainRate=Number.isFinite(session.prevStrainRate) ? session.prevStrainRate : strainRate;
  session.strain=clip(session.strain + .5*(strainRate+prevStrainRate)*dt, 0, 10);
  session.prevStrainRate=strainRate;
  if(combined<.06){
    recoveryRate=RECOVERY_PER_SECOND*(1+0.15*(1-session.strain/10));
    session.chronicBurden=Math.max(0,session.chronicBurden-RECOVERY_PER_SECOND*.5*dt);
    session.stableScore+=dt;
  }else{
    // Strain amplifies damage; it does not create it. As a standalone additive term it was
    // the dominant killer of any patient who sat mildly abnormal for a long time - a salicylate
    // toxicity at pH 7.53 died of accumulated strain alone in eighteen minutes while every
    // hazard in the model read near zero. That only stayed hidden while runs were short.
    acuteRate=acute*(.22+.78*exposureFactor);
    if(combined>2) acuteRate+=.40*(combined-2);
    chronicRate=chronicLoad*CHRONIC_DAMAGE_PER_SECOND;
    const fragility=1+.08*session.strain;
    acuteRate*=fragility;
    chronicRate*=fragility;
    session.acuteBurden+=acuteRate*dt;
    session.chronicBurden=clip(session.chronicBurden+chronicRate*dt,0,100);
  }
  // Health is integrated on the trapezoid rule, not on the step endpoint. On the endpoint
  // rule a 30-second macro step charged the whole step at the worst state inside it, so a
  // scenario that decompensates over two minutes died in one at the hours lens - the damage
  // model, not the physiology, was what disagreed across time scales.
  const rate=recoveryRate-acuteRate-chronicRate;
  const previous=Number.isFinite(session.prevHealthRate) ? session.prevHealthRate : rate;
  const before=session.health;
  session.health=clip(session.health + .5*(rate+previous)*dt, -5, 100);
  session.prevHealthRate=rate;
  // How fast the stability score is ACTUALLY moving, after clamping - a patient sitting at 100
  // has a positive recovery rate but is not changing. This is what decides how hard time may
  // be compressed before the bar stops being readable, so it has to be the observed change and
  // not the modelled rate.
  if(dt>0) session.healthChangeRate=Math.abs(session.health-before)/dt;
  session.damageRate=acuteRate+chronicRate;
  session.combinedHazard=combined;
  session.domainRisks=domains;
  session.offenders=offenders.sort((a,b)=>b[1]-a[1]).slice(0,6).map(o=>o[0]);
}
// The slider is a UI object and lives in real time. Tying its hold and decay to simulated
// time is what made the controls feel broken at speed in the 2026-07-24 build: at 1 h/s a
// single 200 ms frame crossed the whole 20-second hold, so a knob released by the learner had
// already started decaying by the next frame they saw.
function decayControls(session, realDt){
  defs.forEach(d=>{
    if(session.controlTouching[d.key]) return;
    if(session.realTime < (session.controlHoldUntil[d.key] || 0)) return;
    const decay = 1 - Math.exp(-realDt / CONTROL_DECAY_TAU);
    session.controls[d.key] += (0 - session.controls[d.key]) * clip(decay, 0, .035);
    if(Math.abs(session.controls[d.key]) < 0.08) session.controls[d.key] = 0;
  });
}

// Excess urine flow, in state units of blood volume per second. One urine state unit is
// 1.25 mL/min above baseline; roughly 30% of an unreplaced water deficit shows up as a
// contracted vascular compartment, and one blood-volume state unit is 1.4 L. Intake is
// assumed to match baseline urine output, so a urine flow below baseline retains volume.
//
// This is the difference between a model that can teach diabetes insipidus and one that
// cannot. As a set-point term - which is how it used to be written - polyuria on a six-hour
// volume clock simply could not deplete anybody: the kidney was described as aiming at a
// lower volume rather than as losing water. As a flux it depletes at 1.25 mL/min per unit,
// which is slow, unglamorous, and correct: volume depletion in DI is a late finding, and the
// early one is the rising sodium.
const URINE_VOLUME_FLUX = 1.25 * 0.30 / 1000 / 1.4 / 60;
function fluxVector(session){
  const flux={};
  FLUX_KEYS.forEach(k=>{
    const rate=scenarioFlux(session,k);
    if(!rate) return;
    const pool=FLUX_TARGET[k] || k;
    flux[pool]=(flux[pool]||0)+rate;
  });
  flux.bloodVolume=(flux.bloodVolume||0) - URINE_VOLUME_FLUX*session.state.urine;
  return flux;
}

// States far faster than the current step are not integrated - over a six-hour step the
// baroreflex has equilibrated hundreds of times over, and asking a solver to walk through
// that is both slow and pointless. They are solved algebraically instead, by damped
// Gauss-Seidel sweeps, which is the standard quasi-steady-state reduction and happens to be
// exactly the physiological statement the lens is making: at this scale, these loops are
// already settled and what you are watching is the slow limb.
function relaxFastSubsystem(session, h){
  const threshold=h/QSS_RATIO;
  const fast=solverDefs.filter(d=>d.key!=='bicarbonate' && effectiveTau(session,d.key)<threshold);
  if(!fast.length) return fast;
  for(let sweep=0; sweep<QSS_SWEEPS; sweep++){
    const t=computeTargetVector(session).t;
    let maxDelta=0;
    fast.forEach(d=>{
      const target=d.hidden ? clip(t[d.key],-3.2,3.2) : clampStateValue(d,t[d.key]);
      const delta=target-session.state[d.key];
      session.state[d.key]+=delta*QSS_RELAX;
      if(Math.abs(delta)>maxDelta) maxDelta=Math.abs(delta);
    });
    reconcileBicarbonate(session);
    if(maxDelta<1e-5) break;
  }
  return fast;
}

// Events exist because a fast-forward that only reports its endpoint is a lie by omission.
// Crossing into danger and coming back out again inside one 200 ms frame used to leave no
// trace at all; now it leaves a timestamped record, and a critical one stops the frame.
const EVENT_OUTBOX_MAX = 40;
const EVENT_LOG_MAX = 240;
const HEALTH_MARKS = [75, 50, 25];
function emitEvent(session, event){
  const entry={t:session.simTime, ...event};
  entry.text = session.lang==='en' ? (event.en || event.zh || '') : (event.zh || event.en || '');
  delete entry.zh; delete entry.en;
  session.events=session.events || [];
  session.events.push(entry);
  if(session.events.length>EVENT_OUTBOX_MAX) session.events.shift();
  session.eventLog=session.eventLog || [];
  session.eventLog.push(entry);
  if(session.eventLog.length>EVENT_LOG_MAX) session.eventLog.shift();
  if(event.critical) session.brakeRequested=true;
  return entry;
}
function drainEvents(session){
  const out=session.events || [];
  session.events=[];
  return out;
}
function detectHealthEvents(session){
  const previous=Number.isFinite(session.prevHealth) ? session.prevHealth : session.health;
  HEALTH_MARKS.forEach(mark=>{
    if(previous>mark && session.health<=mark){
      emitEvent(session,{type:'health',value:mark,critical:mark<=25,
        zh:`生命稳定度跌破 ${mark}`, en:`Stability fell below ${mark}`});
    }
  });
  session.prevHealth=session.health;
}
// A local extremum in a monitored variable. Worth recording because at a coarse lens the peak
// may fall between two samples the learner ever sees, and "lactate touched 8.1 at 02:14" is a
// clinically meaningful thing to be told even when the curve has already come back down.
const PEAK_MIN_EXCURSION = 0.35;
function detectPeaks(session){
  session.peakTracker=session.peakTracker || {};
  majorKeys.forEach(key=>{
    const value=session.state[key];
    const tracker=session.peakTracker[key];
    if(!tracker){ session.peakTracker[key]={dir:0, extreme:value, extremeAt:session.simTime, last:value}; return; }
    const dir=value>tracker.last+1e-6 ? 1 : value<tracker.last-1e-6 ? -1 : tracker.dir;
    if(tracker.dir!==0 && dir!==0 && dir!==tracker.dir){
      const excursion=Math.abs(tracker.extreme-value);
      if(excursion>=PEAK_MIN_EXCURSION){
        const d=defByKey[key];
        const peakValue=d.base+d.scale*tracker.extreme;
        const raw=DEF_DATA.find(x=>x.key===key);
        emitEvent(session,{type:tracker.dir>0?'peak':'trough',key,value:peakValue,
          t:tracker.extremeAt,
          zh:`${d.label}${tracker.dir>0?'达到峰值':'降至谷值'} ${fmt(d,peakValue)} ${d.unit}`,
          en:`${raw.label.en} ${tracker.dir>0?'peaked at':'bottomed at'} ${fmt(d,peakValue)} ${raw.unit.en}`});
      }
      tracker.extreme=value; tracker.extremeAt=session.simTime;
    }
    if(dir>0 && value>tracker.extreme){ tracker.extreme=value; tracker.extremeAt=session.simTime; }
    if(dir<0 && value<tracker.extreme){ tracker.extreme=value; tracker.extremeAt=session.simTime; }
    tracker.dir=dir; tracker.last=value;
  });
}

const SEGMENT_MAX_SAMPLES = 24;
const SEGMENT_ENVELOPE_EPSILON = 0.008;
function sampleState(session){
  const v={};
  defs.forEach(d=>{ v[d.key]=session.state[d.key]; });
  return {t:session.simTime, health:session.health, v};
}
function round4(x){ return Math.round(x*1e4)/1e4; }
function emptySegment(session){
  return {from:session.simTime, to:session.simTime, steps:0, braked:false,
    times:[], values:{}, lo:{}, hi:{}, health:[], events:drainEvents(session), compression:0};
}
// The trajectory the learner's charts actually draw. Bins carry a min/max envelope as well as
// an endpoint, so a transient that lives inside one bin still shows up as a spike rather than
// being averaged into nothing - the "no extremum preservation" complaint in section 7 of the
// experiment archive.
function buildSegment(session, result, compression){
  const samples=result.samples || [];
  const events=drainEvents(session);
  if(samples.length<2){
    return {from:round4(samples[0]?.t ?? session.simTime), to:round4(session.simTime), steps:result.steps,
      braked:result.braked, times:[], values:{}, lo:{}, hi:{}, health:[], events, compression};
  }
  const binCount=Math.min(SEGMENT_MAX_SAMPLES, samples.length);
  const times=[], health=[], values={}, lo={}, hi={};
  defs.forEach(d=>{ values[d.key]=[]; lo[d.key]=[]; hi[d.key]=[]; });
  for(let bin=0; bin<binCount; bin++){
    const start=Math.floor(bin*samples.length/binCount);
    const end=Math.max(start+1, Math.floor((bin+1)*samples.length/binCount));
    const last=samples[end-1];
    times.push(round4(last.t));
    health.push(round4(last.health));
    defs.forEach(d=>{
      let minimum=Infinity, maximum=-Infinity;
      for(let i=start;i<end;i++){
        const value=samples[i].v[d.key];
        if(value<minimum) minimum=value;
        if(value>maximum) maximum=value;
      }
      values[d.key].push(round4(last.v[d.key]));
      lo[d.key].push(round4(minimum));
      hi[d.key].push(round4(maximum));
    });
  }
  // The envelope is only worth sending for parameters that actually swung inside a bin. Most
  // frames have a handful of movers and thirty flat lines, and shipping three arrays for each
  // of them tripled the payload for no visible difference on the chart.
  defs.forEach(d=>{
    const moved=lo[d.key].some((low, index) => hi[d.key][index]-low > SEGMENT_ENVELOPE_EPSILON);
    if(!moved){ delete lo[d.key]; delete hi[d.key]; }
  });
  return {from:round4(samples[0].t), to:round4(session.simTime), steps:result.steps, braked:result.braked,
    times, values, lo, hi, health, events, compression};
}

// One macro step. The update is the exact solution of dx/dt = (target - x)/tau for a constant
// target, so it can never overshoot no matter how large h is - that alone removes the class of
// blow-ups the old `clip(dt/tau, 0, 0.35)` guard existed to contain. What large h does cost is
// target drift within the step, which the predictor-corrector below halves out.
function advanceStep(session,h){
  session.simTime += h;
  const flux=fluxVector(session);
  const v0=session.pendingVector || computeTargetVector(session);
  session.pendingVector=null;
  const t0=v0.t;

  const predicted={...session.state};
  solverDefs.forEach(d=>{
    if(d.key==='bicarbonate') return;
    const alpha=1-Math.exp(-h/effectiveTau(session,d.key));
    predicted[d.key]=session.state[d.key]+(t0[d.key]-session.state[d.key])*alpha+(flux[d.key]||0)*h;
  });
  predicted.bicarbonate=clampStateValue(defByKey.bicarbonate, predicted.hco3Buffer+predicted.hco3Renal);
  const t1=computeTargetVector({...session, state:predicted}).t;

  solverDefs.forEach(d=>{
    if(d.key==='bicarbonate') return;
    const alpha=1-Math.exp(-h/effectiveTau(session,d.key));
    const target=.5*(t0[d.key]+t1[d.key]);
    const next=session.state[d.key]+(target-session.state[d.key])*alpha+(flux[d.key]||0)*h;
    session.state[d.key]=d.hidden ? clip(next,-3.2,3.2) : clampStateValue(d,next);
  });
  reconcileBicarbonate(session);
  enforceStateBounds(session);
  relaxFastSubsystem(session,h);

  updateHealth(session,h);
  detectHealthEvents(session);
  detectPeaks(session);
  if(session.observationOnly){
    session.health=0;
  }else if(session.health <= 0){
    session.health=0;
    session.dead=true;
    session.paused=true;
    emitEvent(session,{type:'death',critical:true,
      zh:'生命稳定度归零', en:'Stability reached zero'});
  }
  session.chronic=v0.chronic;
  session.lastTargetVector={t:{...t0},chronic:v0.chronic};
}

// How big a step to take. It comes from the lens, top-down, rather than from the state
// vector, bottom-up: the learner has said which scale they want to watch, and the QSS split
// then absorbs everything faster than that. Deriving it bottom-up does not work - every
// candidate step admits more states into the integrated set, which drags the step back down
// to the fastest tau in the model and defeats the whole point.
function stepHintFor(compression, lensId){
  const lens=lensId && temporal.LENS_BY_ID[lensId];
  if(lens) return lens.stepHint;
  return clip(compression*0.2, MIN_MACRO_STEP, 600);
}

// Local-change step control. The lens says how coarse the learner wants to be; this says how
// coarse the physiology will currently tolerate. It predicts how far the largest-moving state
// would travel in the proposed step - which the exponential form makes a closed-form question,
// with no trial step to roll back - and shrinks the step until nothing moves more than
// MAX_STATE_DELTA at once.
//
// This is what lets the days lens exist safely. Across a quiet stretch every gap is small, the
// step stays at the lens hint, and three days pass in ninety seconds. The moment something
// acute starts, the gaps open, the step collapses to seconds, and the fast-forward resolves
// the crisis properly instead of stepping over it. The learner is told when that happens.
const MAX_STATE_DELTA = 0.30;
function chooseStep(session, remaining, stepHint){
  // Handed to advanceStep so the same target vector is not computed twice per step.
  const vector=computeTargetVector(session);
  session.pendingVector=vector;
  const t0=vector.t;
  const flux=fluxVector(session);
  let h=Math.min(remaining, stepHint);
  for(let attempt=0; attempt<8; attempt++){
    let maxDelta=0;
    for(const d of solverDefs){
      if(d.key==='bicarbonate') continue;
      const tau=effectiveTau(session, d.key);
      const delta=Math.abs((t0[d.key]-session.state[d.key])*(1-Math.exp(-h/tau)) + (flux[d.key]||0)*h);
      if(delta>maxDelta) maxDelta=delta;
    }
    if(maxDelta<=MAX_STATE_DELTA || h<=MIN_MACRO_STEP) break;
    h=Math.max(MIN_MACRO_STEP, h*Math.max(0.3, MAX_STATE_DELTA/maxDelta));
  }
  // However coarse the lens, a patient actively losing stability is resolved finely enough
  // that the trajectory stays the trajectory: no more than HEALTH_STEP_BUDGET points per step.
  const damageRate=session.damageRate || 0;
  if(damageRate>1e-3) h=Math.min(h, Math.max(MIN_MACRO_STEP, HEALTH_STEP_BUDGET/damageRate));
  // The seconds after a new insult or a new intervention are always resolved at seconds
  // resolution, whatever lens is selected. Two reasons. Physiologically it is the one stretch
  // where the fast loops are the story. Numerically it matters more than it looks: cumulative
  // damage carries memory, so a transient traversed coarsely once biases the stability score
  // for the rest of the session, which was why a coarse run and a fine run of the same septic
  // patient agreed on every physiological variable and still disagreed on the score.
  if(session.simTime < (session.fineUntil || 0)) h=Math.min(h, FINE_WINDOW_STEP);
  return Math.min(h, remaining);
}

// chooseStep can only look at the rate the patient was deteriorating at when the step began,
// and deterioration accelerates. So a step is also checked after the fact and rejected if it
// turned out to spend more than the budget, which is the only way to bound the one quantity a
// learner watches continuously. Rejection is rare, so the rollback cost is not on the hot path.
function checkpoint(session){
  return {
    simTime:session.simTime, health:session.health, strain:session.strain, stableScore:session.stableScore,
    chronicBurden:session.chronicBurden, acuteBurden:session.acuteBurden,
    prevHealth:session.prevHealth, prevHealthRate:session.prevHealthRate, damageRate:session.damageRate,
    prevStrainRate:session.prevStrainRate, prevDomains:session.prevDomains && {...session.prevDomains},
    combinedHazard:session.combinedHazard,
    dead:session.dead, paused:session.paused, chronic:session.chronic,
    brakeRequested:session.brakeRequested,
    state:{...session.state},
    domainExposure:{...session.domainExposure},
    prevZones:{...session.prevZones},
    conditionMemory:{...session.conditionMemory},
    peakTracker:Object.fromEntries(Object.entries(session.peakTracker||{}).map(([k,v])=>[k,{...v}])),
    logLines:[...(session.logLines||[])],
    eventCount:(session.events||[]).length,
    eventLogCount:(session.eventLog||[]).length
  };
}
function restoreCheckpoint(session, cp){
  Object.assign(session, {
    simTime:cp.simTime, health:cp.health, strain:cp.strain, stableScore:cp.stableScore,
    chronicBurden:cp.chronicBurden, acuteBurden:cp.acuteBurden,
    prevHealth:cp.prevHealth, prevHealthRate:cp.prevHealthRate, damageRate:cp.damageRate,
    prevStrainRate:cp.prevStrainRate, prevDomains:cp.prevDomains && {...cp.prevDomains},
    combinedHazard:cp.combinedHazard,
    dead:cp.dead, paused:cp.paused, chronic:cp.chronic, brakeRequested:cp.brakeRequested,
    state:{...cp.state}, domainExposure:{...cp.domainExposure}, prevZones:{...cp.prevZones},
    conditionMemory:{...cp.conditionMemory},
    peakTracker:Object.fromEntries(Object.entries(cp.peakTracker).map(([k,v])=>[k,{...v}])),
    logLines:[...cp.logLines]
  });
  if(session.events) session.events.length=Math.min(session.events.length, cp.eventCount);
  if(session.eventLog) session.eventLog.length=Math.min(session.eventLog.length, cp.eventLogCount);
}

// Advance `span` simulated seconds, sampling as we go. Returns what actually happened, which
// may be less than asked for: a critical event stops the fast-forward where it occurred so
// the learner can see it, instead of discovering it as a fait accompli in the endpoint.
function advanceSpan(session, span, options={}){
  const stepHint=Math.max(MIN_MACRO_STEP, Number(options.stepHint) || 0.2);
  const samples=[];
  const startedAt=session.simTime;
  let remaining=span, steps=0, braked=false;
  session.brakeRequested=false;
  if(options.sample) samples.push(sampleState(session));
  while(remaining>1e-9 && !session.dead && steps<MAX_STEPS_PER_CALL){
    let step=chooseStep(session, remaining, stepHint);
    let accepted=false;
    for(let retry=0; retry<5 && !accepted; retry++){
      const cp=checkpoint(session);
      advanceStep(session, step);
      const spent=cp.health-session.health;
      // The damage integral is a state too, and it needs its own error control. Cumulative
      // exposure and strain both feed the damage rate nonlinearly and both have kinks in them,
      // so a step that crosses a hazard threshold in one leap integrates them badly - which is
      // how a quiet stretch of a slowly evolving hypokalemia could be crossed in two 250-second
      // steps and come out with an eighth of the strain a fine run produced.
      const hazardMoved=Math.abs((session.combinedHazard||0)-(cp.combinedHazard||0));
      if((spent<=HEALTH_STEP_BUDGET && hazardMoved<=MAX_HAZARD_DELTA) || step<=MIN_MACRO_STEP*1.0001){ accepted=true; break; }
      restoreCheckpoint(session, cp);
      const healthShrink=spent>HEALTH_STEP_BUDGET ? HEALTH_STEP_BUDGET/spent : 1;
      const hazardShrink=hazardMoved>MAX_HAZARD_DELTA ? MAX_HAZARD_DELTA/hazardMoved : 1;
      step=Math.max(MIN_MACRO_STEP, step*Math.max(0.25, Math.min(healthShrink, hazardShrink)));
    }
    if(!accepted) advanceStep(session, step);
    remaining-=step;
    steps++;
    if(options.sample) samples.push(sampleState(session));
    if(options.autoBrake && session.brakeRequested){ braked=true; break; }
  }
  const consumed=session.simTime-startedAt;
  return {
    consumed, requested:span, steps, braked, samples,
    // Below 1 the solver refused to compress as hard as asked because the physiology was
    // moving too fast to step over. The UI surfaces this rather than silently running slow.
    throttle:span>0 ? clip(consumed/span, 0, 1) : 1
  };
}

function tick(session, dt=0.16, speed=1, options={}){
  const realDt=clip(Number(dt)||.16,.01,.5);
  session.realTime=(session.realTime||0)+realDt;
  decayControls(session, realDt);
  if(session.paused || session.dead){
    if(!session.activeConditions) refreshConditions(session);
    const idle=snapshot(session);
    return options.segment ? {snapshot:idle, segment:emptySegment(session)} : idle;
  }
  // The ceiling is the days lens at its fastest in-lens speed. Nothing above it is offered,
  // because nothing above it has been shown to stay interpretable.
  const compression=clip(Number(speed)||1, 0.02, 12000);
  const result=advanceSpan(session, realDt*compression, {
    stepHint:stepHintFor(compression, options.lens),
    autoBrake:options.autoBrake !== false,
    sample:Boolean(options.segment)
  });
  refreshConditions(session);
  const snap=snapshot(session);
  if(!options.segment) return snap;
  return {snapshot:snap, segment:buildSegment(session, result, compression)};
}
function applyScenario(session,name){
  const scenario=SCENARIOS[name];
  if(!scenario) return;
  const lang=session.lang;
  // Blocked compensations survive a scenario change. Setting up "no baroreflex" and then
  // applying a haemorrhage is the whole workflow the switches exist for, and resetSession
  // would otherwise quietly restore the limb between the two clicks.
  resetSession(session);
  session.lang=lang;
  const zh=session.lang==='zh';
  const drivers={...(scenario.drivers||{})};
  if(scenario.random){
    const pool=['bloodVolume','ventilation','airway','glucose','tpr','sodium','potassium','insulin','metDemand'];
    const selected=[...pool].sort(()=>Math.random()-.5).slice(0,4);
    selected.forEach(k=>{
      const sign=Math.random()<.5?-1:1;
      drivers[k]=sign*Math.round((.80+Math.random()*.80)*20)/20;
    });
  }
  session.scenario={
    name,
    drivers,
    fluxKeys:(SCENARIO_FLUX[name]||[]).filter(key=>Object.prototype.hasOwnProperty.call(drivers,key)),
    affectedKeys:[...new Set([...Object.keys(scenario.initial||{}),...Object.keys(drivers)])],
    startedAt:session.simTime,
    duration:scenario.random?80:scenario.duration,
    decayTau:scenario.decayTau||35
  };
  Object.entries(scenario.initial||{}).forEach(([key,value])=>{
    if(defByKey[key]) session.state[key]=clampStateValue(defByKey[key],value);
  });
  enforceStateBounds(session);
  // A scenario hands the learner a patient who is already ill, so the slow pools have to start
  // where days of illness would have left them. Starting them at baseline instead made the
  // fast numbers snap back toward normal in the opening minute for no visible reason.
  seedHiddenStates(session);
  // Prime the damage rate and the zone map from the starting state. Without this the first
  // macro step has no idea how sick the patient already is, and at a coarse lens it would take
  // a full lens-sized step through an ongoing crisis before finding out.
  session.fineUntil = session.simTime + SCENARIO_SETTLE_SECONDS;
  updateHealth(session, 0);
  refreshConditions(session);
  const l=zh?'zh':'en';
  addLog(session, `${zh?'挑战':'Scenario'}：${scenario[l]}。${scenario.note[l]}`);
}
// A state that has not yet reached its target still has something to do; how long that will
// take is its tau. So the size of the gap says how much is pending, and the layer it belongs
// to says on what clock it will resolve. That is all the auto-scaling recommendation needs.
const ACTIVE_GAP = 0.12;
// Stability points per REAL second that a learner can still follow. Above this the bar is not
// falling, it is teleporting. Three points per second empties a full bar in about half a
// minute, which is watchable. The first auto-scaling implementation shipped without this
// ceiling and would put a patient dying in ninety simulated seconds onto a twenty-times lens.
const LEGIBLE_HEALTH_RATE = 3;
const LENS_FOR_LAYER = {immediate:'seconds', seconds:'seconds', minutes:'minutes', hours:'hours', days:'days'};
function pendingGaps(session){
  const vector=session.lastTargetVector || computeTargetVector(session);
  const t=vector.t;
  const gaps={};
  solverDefs.forEach(d=>{
    const target=d.key==='bicarbonate' ? (t.hco3Buffer+t.hco3Renal) : t[d.key];
    gaps[d.key]=Math.abs((Number.isFinite(target)?target:0) - session.state[d.key]);
  });
  return gaps;
}
function temporalStatus(session, lang='zh'){
  const l=lang==='en'?'en':'zh';
  const gaps=pendingGaps(session);
  const layers={};
  temporal.LAYER_ORDER.forEach(layer=>{ layers[layer]={activity:0, key:null}; });
  solverDefs.forEach(d=>{
    const layer=d.layer || 'seconds';
    if(gaps[d.key] > layers[layer].activity){ layers[layer]={activity:gaps[d.key], key:d.key}; }
  });
  // Immediate and seconds share a lens; nothing useful distinguishes them to a watcher.
  const lensActivity={
    seconds:Math.max(layers.immediate.activity, layers.seconds.activity),
    minutes:layers.minutes.activity, hours:layers.hours.activity, days:layers.days.activity
  };
  const lensDriver={
    seconds:layers.immediate.activity>layers.seconds.activity ? layers.immediate.key : layers.seconds.key,
    minutes:layers.minutes.key, hours:layers.hours.key, days:layers.days.key
  };
  // Recommend the FASTEST scale that still has real work pending. A learner watching an hour
  // slide past should be pulled back to seconds the moment something acute starts, and only
  // released to the slow scales once the fast loops have finished arguing.
  let recommended=null, driver=null;
  for(const id of ['seconds','minutes','hours','days']){
    if(lensActivity[id] >= ACTIVE_GAP){ recommended=id; driver=lensDriver[id]; break; }
  }
  // ...and then cap it by how fast the patient is actually changing. Pending activity says
  // which mechanism is interesting; it says nothing about whether a human can follow it.
  //
  // Those two questions came apart badly in acute pulmonary oedema. Thirty seconds in, the
  // fast loops have settled and lactate - a minutes-layer state - holds the largest pending
  // gap, so the activity rule recommended the minutes lens. But at that moment the patient is
  // losing 0.9 stability points per simulated second, which at 20x compression is 17 points
  // per real second: the whole bar gone in under six seconds, with nothing legible in between.
  // A scale is only usable if the thing the learner is watching moves slowly enough to read.
  const healthRate=session.healthChangeRate || 0;
  const maxCompression=healthRate>1e-4 ? LEGIBLE_HEALTH_RATE/healthRate : Infinity;
  const ladder=['seconds','minutes','hours','days'];
  let heldBack=false;
  while(recommended && temporal.lensById(recommended).rate > maxCompression){
    const index=ladder.indexOf(recommended);
    if(index<=0) break;                       // already at the slowest compression on offer
    recommended=ladder[index-1];
    heldBack=true;
  }
  const driverLabel=driver ? (defByKey[driver] ? DEF_DATA.find(x=>x.key===driver).label[l]
    : (temporal.HIDDEN_STATES[driver]?.[l] || driver)) : '';
  const lens=recommended ? temporal.lensById(recommended) : null;
  const lensLabel=lens ? (l==='zh'?lens.titleZh:lens.titleEn) : '';
  const perRealSecond=healthRate*(recommended ? temporal.lensById(recommended).rate : 1);
  let reason;
  if(heldBack){
    reason = l==='zh'
      ? `病情变化过快（约每模拟秒 ${healthRate.toFixed(1)} 点稳定度），已保持在${lensLabel}，否则来不及看清。`
      : `Stability is falling too fast to compress (about ${healthRate.toFixed(1)} points per simulated second), so the view is being held at the ${lensLabel.replace(' lens','').toLowerCase()} scale.`;
  }else if(recommended){
    reason = l==='zh'
      ? `${driverLabel}正在${lensLabel.replace('镜头','')}上变化，已切到该尺度。`
      : `${driverLabel} is changing on the ${lensLabel.replace(' lens','').toLowerCase()} scale, so the view moved there.`;
  }else{
    reason = l==='zh'
      ? '各时间尺度都接近平衡，可自由选择观察尺度。'
      : 'Every time scale is close to equilibrium, so any lens is a reasonable choice.';
  }
  return {
    activity:lensActivity,
    driver, driverLabel,
    recommendedLens:recommended,
    heldBack,
    // Stability points per simulated second, and the compression ceiling that follows from it.
    // Published so a manual choice can be warned about rather than silently overridden - the
    // learner stays in control of the scale, but is told what it will look like.
    healthChangeRate:round4(healthRate),
    maxCompression:Number.isFinite(maxCompression) ? Math.round(maxCompression) : null,
    projectedLossPerSecond:round4(perRealSecond),
    reason
  };
}

// compensation.js reads the model the way a clinician reads a patient, so it is handed
// accessors rather than the session: `a` for the value in clinical units, `z` for the
// dimensionless state (which is the only way to reach a hidden pool such as total-body K+).
function clinicalContext(session, lang){
  return {
    lang,
    a:key => actual(session, key),
    z:key => session.state[key] || 0
  };
}
function detectViciousCycles(session, lang){ return findViciousCycles(clinicalContext(session, lang)); }

function snapshot(session){
  const lang=session.lang==='en'?'en':'zh';
  if(!session.activeConditions) refreshConditions(session);
  const gaps=pendingGaps(session);
  const params=DEF_DATA.map(raw=>{
    const d=defByKey[raw.key];
    const v=actual(session,raw.key);
    return {
      key:raw.key, group:raw.group, label:raw.label[lang], short:raw.short[lang], unit:raw.unit[lang],
      value:v, valueText:fmt(d,v), state:session.state[raw.key], stateBias:stateBias(session,raw.key), displayBias:sliderBias(session,raw.key),
      control:session.controls[raw.key], zone:zoneOf(session,raw.key), holdRemaining:Math.max(0,(session.controlHoldUntil[raw.key]||0)-session.realTime),
      // Time-layer fields. `pending` is how far this parameter still has to travel and `layer`
      // is the clock it will travel on; together they drive the layer highlight in the network
      // and the "what is moving right now" readout, without putting a badge on every node.
      layer:d.layer, tau:effectiveTau(session,raw.key), pending:round4(gaps[raw.key]||0)
    };
  });
  return {
    lang, simTime:session.simTime, realTime:session.realTime||0, health:Math.max(0,session.health),
    stableScore:session.stableScore, paused:session.paused, dead:session.dead,
    // Published so the client never has to infer from its own mode which sessions are scored.
    // The engine decides whether damage is being accumulated; the UI only reflects it.
    noThreat:Boolean(session.noThreat),
    observationOnly:Boolean(session.observationOnly), chronic:session.chronic || 0,
    chronicBurden:session.chronicBurden || 0, acuteBurden:session.acuteBurden || 0,
    params, majorKeys, logLines:session.logLines, conditions:session.activeConditions, offenders:session.offenders || [],
    domainRisks:session.domainRisks || {},
    temporal:temporalStatus(session, lang),
    hiddenStates:Object.fromEntries(HIDDEN_KEYS.map(k=>[k, round4(session.state[k]||0)])),
    viciousCycles:detectViciousCycles(session, lang),
    scenarioName:session.scenario?.name || '',
    scenarioFluxKeys:session.scenario?.fluxKeys || [],
    scenarioAffectedKeys:session.scenario?.affectedKeys || []
  };
}
function meta(lang='zh'){
  const l=lang==='en'?'en':'zh';
  const linkedKeys=(key,direction)=>edges.filter(edge=>edge[direction]===key).map(edge=>edge[direction==='to'?'from':'to']);
  return {
    lang:l, modelSchemaVersion:'1.0.0', modelSources:localizedSources(l),
    groups:Object.fromEntries(Object.entries(GROUPS).map(([k,v])=>[k,v[l]])),
    defs:DEF_DATA.map(d=>({
      key:d.key,label:d.label[l],short:d.short[l],group:d.group,unit:d.unit[l],base:d.base,scale:d.scale,warn:d.warn,danger:d.danger,
      model:localizedSchema(d.key,l,linkedKeys(d.key,'to'),linkedKeys(d.key,'from')),
      temporal:temporal.localizedProfile(d.key,l)
    })),
    // Everything the client needs to render and reason about time. The lens ladder is data,
    // not hard-coded in the frontend, so the compression a learner sees can never disagree
    // with the compression the solver used.
    time:{
      layers:temporal.localizedLayers(l),
      layerOrder:temporal.LAYER_ORDER,
      lenses:temporal.localizedLenses(l),
      speedSteps:temporal.SPEED_STEPS,
      defaultSpeedIndex:temporal.DEFAULT_SPEED_INDEX,
      replaySeconds:temporal.REPLAY_SECONDS,
      hiddenStates:Object.fromEntries(HIDDEN_KEYS.map(k=>[k,{
        owner:temporal.HIDDEN_STATES[k].owner,
        label:temporal.HIDDEN_STATES[k][l],
        layer:temporal.HIDDEN_STATES[k].layer,
        tauText:temporal.formatDuration(temporal.HIDDEN_STATES[k].tau,l)
      }])),
      sources:Object.fromEntries(Object.entries(temporal.TIME_SOURCES).map(([k,v])=>[k,{note:v[l],url:v.url}]))
    },
    edges, positions, majorKeys,
    scenarioCategories:Object.fromEntries(Object.entries(SCENARIO_CATEGORIES).map(([k,v])=>[k,v[l]])),
    scenarios:Object.fromEntries(Object.entries(SCENARIOS).map(([k,v])=>[k,{
      label:v[l],
      category:v.category,
      affectedKeys:[...new Set([...Object.keys(v.initial||{}),...Object.keys(v.drivers||{})])],
      reference:scenarioReference(k,l)
    }])),
    networkLabels:l==='zh'
      ? [['心血管系统',390,70],['神经-体液调节',670,94],['肾脏与体液',410,352],['呼吸与酸碱',654,228],['代谢与血液',282,433]]
      : [['Cardiovascular',390,70],['Neurohumoral',670,94],['Renal & Fluid',380,352],['Resp. & pH',610,235],['Metab. & Blood',255,440]]
  };
}
module.exports = {
  createSession, resetSession, zeroControls, continueObservation, setControl,
  setThreatScoring, evaluateIntervention,
  tick, advanceSpan, applyScenario, snapshot, meta, explainParameter,
  scenarioReference, SCENARIO_REFERENCES, CONTROL_HOLD_SECONDS,
  // Exposed for the temporal regression, which needs to drive the solver directly to compare
  // a coarse run against a fine one.
  temporal, effectiveTau, computeTargetVector, temporalStatus, HIDDEN_KEYS
};
