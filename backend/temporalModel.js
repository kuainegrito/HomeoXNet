'use strict';

// Time is the subject of this module, and it keeps four different meanings apart. The
// 2026-07-24 experiment (TEMPORAL_ARCHITECTURE_EXPERIMENT_2026-07-24.md) failed largely
// because these were allowed to blur into one another:
//
//   physiological time  seconds of simulated body time. 1 day is always 86400 of them.
//   state time constant how fast one lumped state chases its own target. Per state, below.
//   compression         simulated seconds per real second. Chosen by the lens + speed.
//   observation window  how much history a chart shows. Chosen by the lens alone.
//
// Nothing here integrates anything. simEngine.js owns the solver; this file only declares
// what each state's clock is, so the solver, the UI, and the teaching text cannot drift.

const TIME_LAYERS = {
  immediate: {order:0, zh:'即刻',   en:'Immediate', shortZh:'即', shortEn:'I', color:'#b9f6ff', boundsZh:'<1 秒',      boundsEn:'<1 s'},
  seconds:   {order:1, zh:'秒级',   en:'Seconds',   shortZh:'秒', shortEn:'s', color:'#5ee1ff', boundsZh:'1–60 秒',    boundsEn:'1-60 s'},
  minutes:   {order:2, zh:'分钟级', en:'Minutes',   shortZh:'分', shortEn:'m', color:'#60e39b', boundsZh:'1–60 分钟',  boundsEn:'1-60 min'},
  hours:     {order:3, zh:'小时级', en:'Hours',     shortZh:'时', shortEn:'h', color:'#ffd166', boundsZh:'1–24 小时',  boundsEn:'1-24 h'},
  days:      {order:4, zh:'天级',   en:'Days',      shortZh:'日', shortEn:'d', color:'#ff8c69', boundsZh:'1–7 天及以上', boundsEn:'1-7+ days'}
};
const LAYER_ORDER = ['immediate','seconds','minutes','hours','days'];

// Literature anchors. Every non-obvious time constant below cites one of these by id, so a
// reviewer can check the number without leaving the file.
const TIME_SOURCES = {
  baroreflex:   {zh:'压力感受器反射为逐搏、秒到秒的调节',                 en:'Baroreceptor reflex operates beat-to-beat, second-to-second',        url:'https://www.ncbi.nlm.nih.gov/books/NBK538172/'},
  localFlow:    {zh:'局部血流自身调节为秒级，结构性适应为天至周',           en:'Local blood-flow autoregulation is seconds; structural adaptation is days to weeks', url:'https://www.ncbi.nlm.nih.gov/books/NBK54473/'},
  ventControl:  {zh:'通气控制与外周化学感受器的较快反应',                 en:'Ventilatory control and the faster peripheral chemoreceptor response', url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC8894312/'},
  hvr:          {zh:'低氧通气反应的 0–5 min 早期相与 5–20 min 后续相',    en:'Hypoxic ventilatory response has a 0-5 min early phase and a 5-20 min later phase', url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC2277066/'},
  acidBase:     {zh:'化学缓冲、呼吸代偿与肾代偿的时间差异',               en:'Time separation of chemical buffering, respiratory compensation, and renal compensation', url:'https://www.ncbi.nlm.nih.gov/books/NBK507807/'},
  myogenic:     {zh:'肾脏肌源性调节约 1 s 启动、5–10 s 完成',            en:'Renal myogenic response starts in about 1 s and completes in 5-10 s', url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC4551215/'},
  natriuresis:  {zh:'钠负荷后的排钠适应需要数天',                        en:'Natriuretic adaptation to a sodium load takes days',                 url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC8128950/'},
  aqp2:         {zh:'AQP2 转位为分钟级，AQP2 丰度变化为小时至天',          en:'AQP2 trafficking is minutes; AQP2 abundance changes over hours to days', url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC3775849/'},
  raas:         {zh:'Ang II 数分钟起效；醛固酮最早 30–60 min，主要为小时级', en:'Ang II acts within minutes; aldosterone begins at 30-60 min with mainly hourly effects', url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC3545060/'},
  insulinPhase: {zh:'胰岛素第一相约 1 min 出现、3–5 min 达峰、约 10 min 衰减', en:'First-phase insulin appears in about 1 min, peaks at 3-5 min, and decays by about 10 min', url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC1204764/'},
  glucagon:     {zh:'胰高血糖素半衰期约 4–7 min',                        en:'Glucagon half-life is about 4-7 min',                                url:'https://www.ncbi.nlm.nih.gov/books/NBK279127/'},
  potassium:    {zh:'钾的快速跨细胞缓冲与长期肾平衡',                     en:'Rapid transcellular potassium buffering versus long-term renal balance', url:'https://www.ncbi.nlm.nih.gov/books/NBK307/'},
  lactate:      {zh:'乳酸清除半衰期为数分钟，低灌注时明显减慢',            en:'Lactate clearance half-life is minutes and slows markedly with hypoperfusion', url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC137458/'},
  erythro:      {zh:'EPO 升高后通常需 3–4 天才出现网织红细胞增加',         en:'Reticulocytosis usually needs 3-4 days after EPO rises',              url:'https://www.ncbi.nlm.nih.gov/books/NBK542172/'}
};

const MINUTE = 60, HOUR = 3600, DAY = 86400;

// phases[] is the honest part of the model: it names mechanisms this lumped state cannot
// separate. Where a split was worth building, it exists as a hidden state below and the
// phase entry says so with `stateKey`.
function phase(scaleLo, scaleHi, zh, en, stateKey){
  return {windowSeconds:[scaleLo, scaleHi], zh, en, ...(stateKey ? {stateKey} : {})};
}

const PROFILES = {
  map: {layer:'seconds', tau:2, directTau:8, sources:['baroreflex'], phases:[
    phase(1, 10, '逐搏至数秒的压力反射调节', 'Beat-to-beat to seconds-scale baroreflex control')]},
  hr: {layer:'seconds', tau:3, directTau:6, sources:['baroreflex'], phases:[
    phase(1, 10, '迷走撤除近乎瞬时，交感加速需数秒', 'Vagal withdrawal is near-instant; sympathetic acceleration takes seconds')]},
  sv: {layer:'seconds', tau:4, directTau:10, sources:['baroreflex'], phases:[
    phase(2, 20, '前负荷与收缩状态改变后数次心搏内建立', 'Established within a few beats of a preload or inotropic change')]},
  co: {layer:'seconds', tau:2, directTau:8, sources:['baroreflex'], phases:[
    phase(1, 10, 'HR 与 SV 的乘积，随两者同步变化', 'The product of HR and SV, moving with both')]},
  tpr: {layer:'seconds', tau:5, directTau:12, sources:['localFlow'], phases:[
    phase(2, 30, '神经与体液性血管张力改变', 'Neural and humoral vascular tone'),
    phase(3*DAY, 30*DAY, '阻力血管结构重塑（本模型不涵盖）', 'Structural remodeling of resistance vessels (outside this model)')]},
  venousReturn: {layer:'seconds', tau:5, directTau:10, sources:['baroreflex'], phases:[
    phase(2, 30, '容量与静脉张力改变后的充盈调整', 'Filling adjusts after a volume or venous-tone change')]},
  contractility: {layer:'seconds', tau:6, directTau:20, sources:['baroreflex'], phases:[
    phase(5, 30, '儿茶酚胺性变力效应', 'Catecholamine inotropic effect')]},
  rhythmStability: {layer:'seconds', tau:5, directTau:15, sources:['potassium'], phases:[
    phase(5, 5*MINUTE, '电解质与酸碱改变后的心肌电稳定性', 'Myocardial electrical stability after electrolyte or acid-base change')]},
  symp: {layer:'seconds', tau:2, directTau:6, sources:['baroreflex'], phases:[
    phase(1, 5, '压力感受器与化学感受器传入整合', 'Integration of baroreceptor and chemoreceptor afferents')]},
  vagal: {layer:'seconds', tau:2, directTau:6, sources:['baroreflex'], phases:[
    phase(0.5, 5, '迷走传出为搏动间调节，最快的一条通路', 'Vagal efferent traffic is beat-to-beat, the fastest limb here')]},
  chemo: {layer:'seconds', tau:5, directTau:12, sources:['ventControl','hvr'], phases:[
    phase(1, 30, '颈动脉体外周化学感受器', 'Carotid-body peripheral chemoreceptors'),
    phase(5*MINUTE, 20*MINUTE, '中枢化学感受与低氧通气反应后续相', 'Central chemoreception and the later phase of the hypoxic ventilatory response')]},

  renin: {layer:'minutes', tau:2*MINUTE, directTau:MINUTE, sources:['raas'], phases:[
    phase(2*MINUTE, 20*MINUTE, '球旁细胞释放与血浆肾素活性上升', 'Juxtaglomerular release and rising plasma renin activity')]},
  angII: {layer:'minutes', tau:3*MINUTE, directTau:MINUTE, sources:['raas'], phases:[
    phase(3*MINUTE, 30*MINUTE, '循环 Ang II 生成与血管作用', 'Circulating Ang II generation and vascular action')]},
  aldosterone: {layer:'hours', tau:HOUR, directTau:10*MINUTE, sources:['raas'], phases:[
    phase(30*MINUTE, 60*MINUTE, '最早可测的肾小管效应', 'Earliest measurable tubular effect'),
    phase(HOUR, 12*HOUR, '基因组性钠钾转运调节（主要效应）', 'Genomic regulation of Na/K transport, the dominant effect')]},
  adh: {layer:'minutes', tau:5*MINUTE, directTau:MINUTE, sources:['aqp2'], phases:[
    phase(MINUTE, 30*MINUTE, '血浆 AVP 与 AQP2 膜转位', 'Plasma AVP and AQP2 membrane trafficking'),
    phase(3*HOUR, 3*DAY, 'AQP2 丰度的转录调节', 'Transcriptional regulation of AQP2 abundance', 'aqp2')]},

  bloodVolume: {layer:'hours', tau:6*HOUR, directTau:15, sources:['natriuresis'], phases:[
    phase(0, 60, '外源输液或失血为即刻改变', 'Exogenous infusion or haemorrhage changes it immediately'),
    phase(6*HOUR, 24*HOUR, '肾脏与体液转移的内源性恢复', 'Endogenous restoration by kidney and fluid shifts'),
    phase(DAY, 5*DAY, '完全的容量—钠平衡', 'Full volume-sodium equilibration')]},
  gfr: {layer:'seconds', tau:8, directTau:30, sources:['myogenic'], phases:[
    phase(1, 10, '肌源性自身调节', 'Myogenic autoregulation'),
    phase(10, 60, '管球反馈', 'Tubuloglomerular feedback')]},
  urine: {layer:'minutes', tau:15*MINUTE, directTau:30, sources:['aqp2'], phases:[
    phase(10*MINUTE, 60*MINUTE, '滤过、水通道与钠转运共同决定的尿流', 'Urine flow set jointly by filtration, water channels, and sodium transport')]},
  // Osmolality is a derived laboratory value, and it belongs on the same clock as the other
  // one in this model: pH, which is computed from HCO3- and PaCO2 and therefore declared
  // immediate. Plasma osmolality is 2*[Na+] + glucose measured on the same plasma as the
  // sodium, so it cannot lag the sodium - on an hourly tau a patient whose Na+ had fallen to
  // 126 was still being shown an osmolality of 284, which is not a slow variable, it is a
  // wrong one. The slowness that was being modelled here is real but belongs to the inputs:
  // sodium carries a twelve-hour balance clock and keeps it.
  osm: {layer:'immediate', tau:8, directTau:3*MINUTE, sources:['aqp2'], phases:[
    phase(0.1, 60, '由血钠与血糖即时决定（计算渗透压 = 2×Na⁺ + 葡萄糖）', 'Set essentially instantaneously by sodium and glucose (calculated osmolality = 2*Na+ + glucose)'),
    phase(HOUR, 12*HOUR, 'ADH—尿流对渗透压的纠正，经血钠与水平衡实现', 'ADH-urine correction of osmolality, which acts through sodium and water balance')]},
  sodium: {layer:'hours', tau:12*HOUR, directTau:5*MINUTE, sources:['natriuresis'], phases:[
    phase(6*HOUR, 24*HOUR, '水量改变引起的浓度变化', 'Concentration change driven by water content'),
    phase(2*DAY, 5*DAY, '排钠与摄入重新匹配', 'Sodium excretion rematching intake')]},
  potassium: {layer:'minutes', tau:3*MINUTE, directTau:MINUTE, sources:['potassium'], phases:[
    phase(5*MINUTE, 30*MINUTE, '跨细胞 H⁺/K⁺ 交换（只改变分布）', 'Transcellular H+/K+ exchange, which only moves distribution'),
    phase(4*HOUR, 3*DAY, '总体钾的肾性得失', 'Renal gain or loss of total-body potassium', 'kBody')]},

  ventilation: {layer:'seconds', tau:10, directTau:20, sources:['ventControl','hvr'], phases:[
    phase(5, 30, '化学感受驱动的快速通气改变', 'Rapid chemoreflex-driven change'),
    phase(MINUTE, 20*MINUTE, '完整的低氧/高碳酸通气反应', 'Complete hypoxic and hypercapnic ventilatory response')]},
  airway: {layer:'seconds', tau:5, directTau:15, sources:['ventControl'], phases:[
    phase(5, 5*MINUTE, '气道平滑肌张力与分泌物负荷', 'Airway smooth-muscle tone and secretion load')]},
  paO2: {layer:'seconds', tau:8, directTau:20, sources:['ventControl'], phases:[
    phase(5, 30, '肺泡氧分压随通气与灌注改变', 'Alveolar oxygen follows ventilation and perfusion')]},
  paCO2: {layer:'seconds', tau:8, directTau:20, sources:['ventControl'], phases:[
    phase(5, 60, 'CO₂ 储库大于 O₂，平衡略慢', 'The CO2 store is larger than the O2 store, so it equilibrates slightly slower')]},
  pH: {layer:'immediate', tau:5, directTau:30, sources:['acidBase'], phases:[
    phase(0.1, 5, '由 HCO₃⁻ 与 PaCO₂ 通过 Henderson–Hasselbalch 瞬时决定', 'Set essentially instantaneously from HCO3- and PaCO2 by Henderson-Hasselbalch')]},
  bicarbonate: {layer:'days', tau:3*DAY, directTau:5*MINUTE, sources:['acidBase'], phases:[
    phase(1, 5*MINUTE, '强酸滴定与快速化学缓冲', 'Titration by strong acid and rapid chemical buffering', 'hco3Buffer'),
    phase(3*DAY, 5*DAY, '肾脏排酸与 HCO₃⁻ 再生', 'Renal acid excretion and HCO3- regeneration', 'hco3Renal')]},

  glucose: {layer:'minutes', tau:10*MINUTE, directTau:MINUTE, sources:['insulinPhase'], phases:[
    phase(5*MINUTE, 30*MINUTE, '肝糖输出与外周摄取的净平衡', 'Net balance of hepatic output and peripheral uptake')]},
  insulin: {layer:'minutes', tau:MINUTE, directTau:45, sources:['insulinPhase'], phases:[
    phase(MINUTE, 10*MINUTE, '第一相：储存颗粒释放，3–5 min 达峰', 'First phase: stored granule release peaking at 3-5 min'),
    phase(10*MINUTE, 3*HOUR, '第二相：新合成胰岛素的持续分泌', 'Second phase: sustained secretion of newly synthesised insulin')]},
  glucagon: {layer:'minutes', tau:3*MINUTE, directTau:MINUTE, sources:['glucagon'], phases:[
    phase(3*MINUTE, 20*MINUTE, '半衰期 4–7 min 决定的升糖作用', 'Glycogenolytic action set by a 4-7 min half-life')]},
  tissueO2: {layer:'seconds', tau:5, directTau:15, sources:['localFlow'], phases:[
    phase(5, MINUTE, '氧输送 = 心排量 × 携氧量，随两者立即改变', 'Delivery is output times carrying capacity and follows both at once')]},
  lactate: {layer:'minutes', tau:10*MINUTE, directTau:5*MINUTE, sources:['lactate'], phases:[
    phase(MINUTE, 5*MINUTE, '无氧糖酵解产生（可以很快）', 'Production by anaerobic glycolysis, which can be fast'),
    phase(10*MINUTE, HOUR, '肝肾清除（低灌注时显著减慢）', 'Hepatic and renal clearance, markedly slowed by hypoperfusion')]},
  hct: {layer:'hours', tau:6*HOUR, directTau:MINUTE, sources:['erythro'], phases:[
    phase(30*MINUTE, 6*HOUR, '血浆容量改变造成的稀释或浓缩', 'Dilution or concentration from a plasma-volume change'),
    phase(3*DAY, 7*DAY, '红细胞生成，EPO 后 3–4 天才见网织红细胞', 'Erythropoiesis; reticulocytes appear only 3-4 days after EPO', 'rbcMass')]},
  metDemand: {layer:'seconds', tau:30, directTau:MINUTE, sources:['localFlow'], phases:[
    phase(10, 60, '活动或体温改变引起的耗氧需求', 'Oxygen demand from activity or temperature')]}
};

// Hidden states exist because one lumped node genuinely runs on two clocks. Each is owned by
// a visible key, and the visible value is reconstructed from them in simEngine.
const HIDDEN_STATES = {
  aqp2:       {owner:'adh',         layer:'days',    tau:12*HOUR,  directTau:2*HOUR,  zh:'AQP2 水通道丰度',   en:'AQP2 water-channel abundance'},
  kBody:      {owner:'potassium',   layer:'days',    tau:18*HOUR,  directTau:2*HOUR,  zh:'总体钾平衡',        en:'Total-body potassium balance'},
  rbcMass:    {owner:'hct',         layer:'days',    tau:4*DAY,    directTau:MINUTE,  zh:'红细胞总量',        en:'Red-cell mass'},
  hco3Buffer: {owner:'bicarbonate', layer:'seconds', tau:5,        directTau:5*MINUTE,zh:'快速缓冲池 HCO₃⁻',  en:'Fast buffer HCO3- pool'},
  hco3Renal:  {owner:'bicarbonate', layer:'days',    tau:3*DAY,    directTau:6*HOUR,  zh:'肾性 HCO₃⁻ 池',     en:'Renal HCO3- pool'}
};

// One lens = one way of looking at the same physiological time. Each replays its whole
// observation window in about REPLAY_SECONDS of real time at in-lens speed 1, which is the
// single sentence that explains the whole control to a learner:
// "no matter which lens you pick, one full window takes about a minute and a half to watch."
const REPLAY_SECONDS = 90;
const LENSES = [
  {id:'seconds', layer:'seconds', window:90,    rate:1,    stepHint:0.2,
   zh:'秒',  en:'Sec',  titleZh:'秒级镜头', titleEn:'Seconds lens',
   focusZh:'压力反射、化学感受、通气与心输出', focusEn:'Baroreflex, chemoreflex, ventilation, cardiac output'},
  {id:'minutes', layer:'minutes', window:30*MINUTE, rate:20,  stepHint:2,
   zh:'分',  en:'Min',  titleZh:'分钟级镜头', titleEn:'Minutes lens',
   focusZh:'肾素—Ang II、ADH 转位、钾跨细胞移动、乳酸与胰岛素', focusEn:'Renin-Ang II, AQP2 trafficking, potassium shift, lactate, insulin'},
  {id:'hours', layer:'hours', window:6*HOUR, rate:240, stepHint:30,
   zh:'时',  en:'Hr',   titleZh:'小时级镜头', titleEn:'Hours lens',
   focusZh:'醛固酮、血容量恢复、渗透压纠正、血液稀释', focusEn:'Aldosterone, volume restoration, osmolality correction, haemodilution'},
  {id:'days', layer:'days', window:3*DAY, rate:2880, stepHint:600,
   zh:'日',  en:'Day',  titleZh:'天级镜头', titleEn:'Days lens',
   focusZh:'肾脏排酸与 HCO₃⁻ 再生、排钠适应、总体钾、红细胞生成', focusEn:'Renal acid excretion and HCO3- regeneration, natriuretic adaptation, total-body K+, erythropoiesis'}
];
const LENS_BY_ID = Object.fromEntries(LENSES.map(l => [l.id, l]));
const SPEED_STEPS = [0.1, 0.25, 0.5, 1, 2, 4];
const DEFAULT_SPEED_INDEX = 3;

function lensById(id){ return LENS_BY_ID[id] || LENS_BY_ID.seconds; }
function compressionFor(lensId, speedMultiplier){
  return lensById(lensId).rate * clampSpeed(speedMultiplier);
}
function clampSpeed(value){
  const v = Number(value);
  if(!Number.isFinite(v)) return 1;
  return Math.max(SPEED_STEPS[0], Math.min(SPEED_STEPS[SPEED_STEPS.length-1], v));
}

// A duration rendered the way a clinician would say it, not as a raw second count. Used for
// the clock readout, chart axes, and every event timestamp.
function formatDuration(seconds, lang='zh'){
  const zh = lang !== 'en';
  const s = Math.max(0, Number(seconds) || 0);
  if(s < 100) return zh ? `${s.toFixed(s < 10 ? 1 : 0)} 秒` : `${s.toFixed(s < 10 ? 1 : 0)} s`;
  if(s < 90*MINUTE){ const m = s/MINUTE; return zh ? `${m.toFixed(m < 10 ? 1 : 0)} 分钟` : `${m.toFixed(m < 10 ? 1 : 0)} min`; }
  if(s < 48*HOUR){ const h = s/HOUR; return zh ? `${h.toFixed(h < 10 ? 1 : 0)} 小时` : `${h.toFixed(h < 10 ? 1 : 0)} h`; }
  const d = s/DAY; return zh ? `${d.toFixed(1)} 天` : `${d.toFixed(1)} d`;
}
// "1 real second = 4 simulated minutes". This string is the contract with the learner: as
// long as it is on screen and correct, no amount of time compression is dishonest.
function describeCompression(compression, lang='zh'){
  const zh = lang !== 'en';
  const c = Math.max(0.01, Number(compression) || 1);
  if(Math.abs(c - 1) < 1e-6) return zh ? '1 秒真实 = 1 秒模拟（实时）' : '1 real second = 1 simulated second (real time)';
  if(c < 1) return zh ? `1 秒真实 = ${formatDuration(c, 'zh')}模拟（慢动作）` : `1 real second = ${formatDuration(c, 'en')} simulated (slow motion)`;
  return zh ? `1 秒真实 = ${formatDuration(c, 'zh')}模拟` : `1 real second = ${formatDuration(c, 'en')} simulated`;
}

// The same contract as describeCompression, compressed to fit under a tab label. It exists
// because the tabs used to be captioned with the lens's observation WINDOW - a bare "90 s",
// "30 min", "6 h", "3 d" under a tab named "Sec", "Min", "Hr", "Day" - and a bare duration in
// that position reads as a rate. Learners asked whether "90 s" meant per second; it did not,
// it meant "one full sweep of this view covers 90 seconds of body time". The window is still
// shown, spelled out and labelled, on the focus line under the control, where there is room to
// call it a window. What belongs on the tab is what choosing the tab does, and what it does is
// set the compression - which this states in a form with no second reading.
// Not formatDuration with a prefix, for two reasons the tab strip cares about and a clock does
// not. It has about 53px: "1 秒 → 48 分钟" needs 105 and wrapped to two lines inside a 58px tab.
// And formatDuration keeps a decimal below ten so a running clock never rounds 4.2 to 4, which
// is right for a clock and pure noise for a lens rate that is exactly 4. So: no spaces, the
// one-character Chinese units, and no decimal unless the number actually has one.
function shortCompression(rate, lang='zh'){
  const zh = lang !== 'en';
  const r = Math.max(0.01, Number(rate) || 1);
  if(Math.abs(r - 1) < 1e-6) return zh ? '1:1 实时' : '1:1 real';
  const [value, unit] =
    r < 100        ? [r,      zh ? '秒' : 's'] :
    r < 90*MINUTE  ? [r/MINUTE, zh ? '分' : 'min'] :
    r < 48*HOUR    ? [r/HOUR,   zh ? '时' : 'h'] :
                     [r/DAY,    zh ? '天' : 'd'];
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return zh ? `1秒→${amount}${unit}` : `1s→${amount}${unit}`;
}

function profileFor(key){ return PROFILES[key] || null; }
function layerOf(key){ return PROFILES[key]?.layer || 'seconds'; }
function tauFor(key, fallback){ return PROFILES[key]?.tau ?? fallback ?? 5; }
function directTauFor(key, fallback){ return PROFILES[key]?.directTau ?? fallback ?? tauFor(key); }

// The lens a state belongs to is not always the lens it is interesting at. A state is
// "in play" at a lens when its time constant is neither so fast that it has already
// equilibrated nor so slow that it has not started moving. That band is what the UI
// highlights, and it is the same criterion the solver uses to decide QSS vs integrate.
function activityBandFor(lensId){
  const lens = lensById(lensId);
  return [lens.window/600, lens.window*1.5];
}
function isInPlayAt(key, lensId){
  const [lo, hi] = activityBandFor(lensId);
  const tau = tauFor(key);
  return tau >= lo && tau <= hi;
}

function localizedLayers(lang='zh'){
  const l = lang === 'en' ? 'en' : 'zh';
  return Object.fromEntries(LAYER_ORDER.map(id => {
    const layer = TIME_LAYERS[id];
    return [id, {
      id, order:layer.order, color:layer.color,
      label:layer[l], short:l === 'zh' ? layer.shortZh : layer.shortEn,
      bounds:l === 'zh' ? layer.boundsZh : layer.boundsEn
    }];
  }));
}
function localizedLenses(lang='zh'){
  const l = lang === 'en' ? 'en' : 'zh';
  return LENSES.map(lens => ({
    id:lens.id, layer:lens.layer, window:lens.window, rate:lens.rate,
    label:l === 'zh' ? lens.zh : lens.en,
    title:l === 'zh' ? lens.titleZh : lens.titleEn,
    focus:l === 'zh' ? lens.focusZh : lens.focusEn,
    windowText:formatDuration(lens.window, l),
    rateText:describeCompression(lens.rate, l),
    rateShort:shortCompression(lens.rate, l)
  }));
}
// The per-node time card. This is where the 34 time badges from the failed experiment went:
// on demand, in the parameter panel, instead of permanently on top of the network.
function localizedProfile(key, lang='zh'){
  const p = PROFILES[key];
  if(!p) return null;
  const l = lang === 'en' ? 'en' : 'zh';
  const layer = TIME_LAYERS[p.layer];
  return {
    key,
    layer:p.layer,
    layerLabel:layer[l],
    layerShort:l === 'zh' ? layer.shortZh : layer.shortEn,
    layerColor:layer.color,
    tau:p.tau,
    tauText:formatDuration(p.tau, l),
    directTau:p.directTau,
    directTauText:formatDuration(p.directTau, l),
    phases:p.phases.map(ph => ({
      window:[ph.windowSeconds[0], ph.windowSeconds[1]],
      windowText:`${formatDuration(ph.windowSeconds[0], l)} – ${formatDuration(ph.windowSeconds[1], l)}`,
      mechanism:ph[l],
      separateState:ph.stateKey ? (HIDDEN_STATES[ph.stateKey]?.[l] || ph.stateKey) : null
    })),
    sources:(p.sources || []).map(id => ({id, note:TIME_SOURCES[id]?.[l] || '', url:TIME_SOURCES[id]?.url || ''}))
  };
}

module.exports = {
  TIME_LAYERS, LAYER_ORDER, TIME_SOURCES, PROFILES, HIDDEN_STATES,
  LENSES, LENS_BY_ID, SPEED_STEPS, DEFAULT_SPEED_INDEX, REPLAY_SECONDS,
  MINUTE, HOUR, DAY,
  lensById, compressionFor, clampSpeed, formatDuration, describeCompression, shortCompression,
  profileFor, layerOf, tauFor, directTauFor, activityBandFor, isInPlayAt,
  localizedLayers, localizedLenses, localizedProfile
};
