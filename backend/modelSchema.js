'use strict';

// This file documents the teaching model; it does not contain executable physiology.
// Values in simEngine.js remain the sole source of numerical behaviour.
const SOURCE_LIBRARY = {
  homeostasisModel: {
    title: {zh:'HomeoXNet 教学模型规范 v1.0', en:'HomeoXNet teaching-model specification v1.0'},
    type: 'model-specification',
    url: null,
    note: {zh:'说明模型中的简化、变量语义和方程；不是临床诊疗指南。', en:'Documents the model semantics, simplifications, and equations; it is not a clinical guideline.'}
  },
  insulinAssay: {
    title: {zh:'血清胰岛素测量的标准化现状', en:'The Current Status of Serum Insulin Measurements and the Need for Standardization'},
    type: 'review', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12452087/',
    note: {zh:'不同商业胰岛素检测方法仍有显著差异，不能把本教学模型的相对效应直接解释为某次化验浓度。', en:'Commercial insulin assays remain substantially discordant; this model effect must not be read as a laboratory concentration.'}
  },
  glucagonAssay: {
    title: {zh:'血浆胰高血糖素测量的方法与指南', en:'Methods and Guidelines for Measurement of Glucagon in Plasma'},
    type: 'review', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6862148/',
    note: {zh:'胰高血糖素浓度低且存在交叉反应与前处理问题，适合在本模型中表示为反调节效应而非固定绝对浓度。', en:'Low concentrations, cross-reactivity, and pre-analytic limitations favour a counter-regulatory effect rather than a fixed absolute concentration here.'}
  },
  raasMeasurement: {
    title: {zh:'肾素—醛固酮检测要点', en:'Renin–aldosterone testing: the essentials'},
    type: 'clinical review', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13127190/',
    note: {zh:'肾素和醛固酮受体位、盐摄入、时间、药物和检测方法影响；本模型只表示其相对调节效应。', en:'Posture, sodium intake, timing, medication, and assay method affect renin and aldosterone; this model represents relative regulatory effects only.'}
  },
  avpMeasurement: {
    title: {zh:'内分泌疾病中的 Copeptin 分析', en:'Copeptin analysis in endocrine disorders'},
    type: 'review', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10583572/',
    note: {zh:'AVP 在血浆中不稳定且难测；本模型的 ADH 是集合管保水效应，而不是某次 AVP 化验值。', en:'AVP is unstable and difficult to measure in plasma; ADH here denotes collecting-duct water-conservation effect, not a laboratory AVP value.'}
  },
  physiomeReproducibility: {
    title: {zh:'Physiome 模型可复现性要求', en:'Physiome reproducibility guidance'},
    type: 'modelling standard', url: 'https://journal.physiomeproject.org/instructions-for-authors',
    note: {zh:'支持将方程、参数、假设、来源和模拟协议一起记录。', en:'Supports recording equations, parameters, assumptions, sources, and simulation protocols together.'}
  }
};

const relative = (zh, en) => ({kind:'relative-effect', zh, en});
const absolute = (zh, en) => ({kind:'absolute-measurement', zh, en});
const index = (zh, en) => ({kind:'physiological-index', zh, en});
const item = (id, unit, equation, assumptions, sourceIds=['homeostasisModel']) => [id, {id, unit, equation, assumptions, sourceIds}];

// Formulae use the normalized internal state variables from simEngine.js. They are deliberately
// presented as educational approximations, rather than claims of a patient-specific clinical equation.
const MODEL_SCHEMA = Object.fromEntries([
  item('map', absolute('mmHg；模型读数为平均动脉压。', 'mmHg; model reading is mean arterial pressure.'),
    {zh:'目标 MAP = 心输出量 + 外周阻力 + 血容量 − 休克/低容量惩罚。', en:'Target MAP = cardiac output + peripheral resistance + blood volume − shock/volume-deficit penalties.'},
    {zh:['集总循环模型；MAP 不等同于某一器官的灌注压。'], en:['Lumped circulation; MAP is not the perfusion pressure of any one organ.']}),
  item('hr', absolute('bpm；心率。', 'bpm; heart rate.'),
    {zh:'目标 HR 由交感、迷走、化学感受器、代谢需求和钾异常共同决定。', en:'Target HR combines sympathetic, vagal, chemoreceptor, metabolic-demand, and potassium effects.'},
    {zh:['不模拟具体心电图或单个节律机制。'], en:['Does not simulate an ECG or individual rhythm mechanisms.']}),
  item('sv', absolute('mL；每搏量。', 'mL; stroke volume.'),
    {zh:'目标 SV 由静脉回流、收缩力、心律稳定性、阻力、心率、缺氧和酸中毒决定。', en:'Target SV combines venous return, contractility, rhythm stability, resistance, heart rate, hypoxia, and acidosis.'},
    {zh:['不包含完整压力—容积环。'], en:['Does not include a full pressure-volume loop.']}),
  item('co', absolute('L/min；心输出量。', 'L/min; cardiac output.'),
    {zh:'目标 CO 由心率、每搏量和心律稳定性促进，过快心率和低收缩力会限制有效输出。', en:'Target CO is supported by heart rate, stroke volume, and rhythm stability; excessive rate and poor contractility limit effective output.'},
    {zh:['CO 是集总泵血量，不分左右心输出。'], en:['CO is a lumped pump-flow variable and does not distinguish right from left output.']}),
  item('tpr', relative('相对外周阻力（基线=1）。', 'Relative peripheral resistance (baseline=1).'),
    {zh:'目标 TPR 由交感、Ang II、ADH、血细胞比容促进，局部缺氧/高 CO₂/乳酸导致舒张；高氧引起血管收缩，Hct 超过约 55% 后黏度呈超线性上升。', en:'Target TPR rises with sympathetic tone, Ang II, ADH, and haematocrit; hypoxia, hypercapnia, and lactate add local dilation; hyperoxia constricts, and above a haematocrit of about 55% viscosity rises faster than linearly.'},
    {zh:['表示全身净血管张力，不对应单一血管床。'], en:['Represents net systemic vascular tone, not a single vascular bed.']}),
  item('venousReturn', absolute('L/min；静脉回流。', 'L/min; venous return.'),
    {zh:'目标静脉回流由血容量和交感静脉张力促进，外周阻力与低容量惩罚降低回流。', en:'Target venous return rises with blood volume and sympathetic venous tone; resistance and volume deficit reduce it.'},
    {zh:['不单独模拟体位、胸腔压力和肌肉泵。'], en:['Does not separately simulate posture, intrathoracic pressure, or the muscle pump.']}),
  item('contractility', index('收缩力指数（基线=100），不是直接测得的百分比。', 'Contractility index (baseline=100), not a directly measured percentage.'),
    {zh:'目标收缩力受交感和 Ang II 支持，受酸中毒、缺氧、休克与钾异常抑制。', en:'Target contractility is supported by sympathetic tone and Ang II, and inhibited by acidosis, hypoxia, shock, and potassium disturbance.'},
    {zh:['表示同等前负荷下的相对泵功能。'], en:['Represents relative pump function at comparable preload.']}),
  item('rhythmStability', index('心律稳定性指数（基线=100）。', 'Rhythm-stability index (baseline=100).'),
    {zh:'钾异常、酸中毒、缺氧和强交感兴奋降低心律稳定性。', en:'Potassium disturbance, acidosis, hypoxia, and marked sympathetic activation lower rhythm stability.'},
    {zh:['风险代理变量；不取代 ECG、心律诊断或电生理模型。'], en:['A risk proxy; it does not replace ECG, rhythm diagnosis, or an electrophysiology model.']}),
  item('symp', index('交感活动指数（基线=50）。', 'Sympathetic-activity index (baseline=50).'),
    {zh:'目标交感活动由低 MAP、化学感受器驱动、缺氧、代谢需求、休克和胰高血糖素影响。', en:'Target sympathetic activity responds to low MAP, chemoreceptor drive, hypoxia, metabolic demand, shock, and glucagon.'},
    {zh:['表示净自主神经输出，不是去甲肾上腺素浓度。'], en:['Represents net autonomic output, not a norepinephrine concentration.']}),
  item('vagal', index('迷走活动指数（基线=50）。', 'Vagal-activity index (baseline=50).'),
    {zh:'目标迷走活动随 MAP 升高而增加，随化学感受器驱动、代谢需求和休克而降低。', en:'Target vagal activity rises with MAP and falls with chemoreceptor drive, metabolic demand, and shock.'},
    {zh:['表示心脏副交感净输出。'], en:['Represents net cardiac parasympathetic output.']}),
  item('chemo', index('化学感受器驱动指数（基线=50）。', 'Chemoreceptor-drive index (baseline=50).'),
    {zh:'目标化学感受器驱动由高 CO₂、酸中毒、低氧和乳酸升高；碱血症抑制之（代谢性碱中毒的代偿性低通气），高氧亦轻度抑制之（Dejours 效应）。', en:'Target chemoreceptor drive rises with hypercapnia, acidosis, hypoxia, and lactate; alkalemia suppresses it (the compensatory hypoventilation of a metabolic alkalosis) and hyperoxia suppresses it mildly (the Dejours effect).'},
    {zh:['不区分中枢与外周化学感受器。','碱血症侧的代偿有意偏保守（约 0.3 mmHg PaCO₂ / mmol·L⁻¹ HCO₃⁻）：代谢性碱中毒是四种原发失衡中呼吸代偿最不可靠的一种。'], en:['Does not distinguish central from peripheral chemoreceptors.','Compensation on the alkalemic side is deliberately conservative (about 0.3 mmHg of PaCO2 per mmol/L of HCO3-): of the four primary disorders, metabolic alkalosis has the least reliable respiratory compensation.']}),
  item('renin', relative('相对肾素调节效应（基线=1），不是 PRA 或直接肾素浓度。', 'Relative renin regulatory effect (baseline=1), not PRA or direct renin concentration.'),
    {zh:'慢性肾性调节开启后，低 MAP、低血容量、低钠和交感兴奋提高肾素；Ang II 负反馈抑制它。', en:'After slow renal regulation engages, low MAP, low volume, low sodium, and sympathetic tone raise renin; Ang II provides negative feedback.'},
    {zh:['不把 PRA、直接肾素浓度和不同体位/盐摄入条件混为一个绝对化验值。'], en:['Does not collapse PRA, direct renin concentration, posture, and sodium-intake conditions into one absolute laboratory value.']}, ['homeostasisModel','raasMeasurement']),
  item('angII', relative('相对 Ang II 效应（基线=1），不是血浆 Ang II 浓度。', 'Relative Ang II effect (baseline=1), not plasma Ang II concentration.'),
    {zh:'慢性 Ang II 目标由肾素驱动。', en:'Slow Ang II target is driven by renin.'},
    {zh:['表示 RAAS 的血管/肾脏效应，不模拟 ACE、受体亚型或局部组织 RAAS。'], en:['Represents RAAS vascular/renal effect and omits ACE, receptor subtypes, and tissue RAAS.']}, ['homeostasisModel','raasMeasurement']),
  item('aldosterone', relative('相对醛固酮效应（基线=1），不是血浆醛固酮浓度。', 'Relative aldosterone effect (baseline=1), not plasma aldosterone concentration.'),
    {zh:'慢性醛固酮目标由 Ang II 和血钾升高共同驱动。', en:'Slow aldosterone target is driven by Ang II and higher potassium.'},
    {zh:['表示远端钠保留/排钾效应，不对应单次抽血结果。'], en:['Represents distal sodium-retention/potassium-secretion effect, not a single blood draw.']}, ['homeostasisModel','raasMeasurement']),
  item('adh', relative('相对 ADH/AVP 保水效应（基线=1），不是血浆 AVP 浓度。', 'Relative ADH/AVP water-conservation effect (baseline=1), not plasma AVP concentration.'),
    {zh:'慢性 ADH 效应由渗透压升高、低血容量、低 MAP、Ang II 和高 CO₂驱动。', en:'Slow ADH effect is driven by higher osmolality, low volume, low MAP, Ang II, and hypercapnia.'},
    {zh:['表示集合管保水效应；不把难以稳定测量的 AVP 当作绝对化验值。'], en:['Represents collecting-duct water conservation; it does not treat difficult-to-measure AVP as an absolute laboratory value.']}, ['homeostasisModel','avpMeasurement']),
  item('bloodVolume', absolute('L；循环血容量。', 'L; circulating blood volume.'),
    {zh:'慢性血容量目标由 ADH、醛固酮、尿量、钠和持续多尿共同决定。', en:'Slow blood-volume target combines ADH, aldosterone, urine flow, sodium, and sustained polyuric loss.'},
    {zh:['为集总循环容量；不区分血浆、红细胞、间质和细胞内液。'], en:['A lumped circulating volume; it does not separate plasma, red cells, interstitium, and intracellular fluid.']}),
  item('gfr', absolute('mL/min；肾小球滤过率。', 'mL/min; glomerular filtration rate.'),
    {zh:'目标 GFR 受 MAP 和血容量支持，受交感、Ang II 和休克抑制。', en:'Target GFR is supported by MAP and blood volume, and inhibited by sympathetic tone, Ang II, and shock.'},
    {zh:['不表示肌酐 eGFR；不含肾单位结构或药物效应。'], en:['Not creatinine eGFR; omits nephron structure and drug effects.']}),
  item('urine', absolute('mL/min；尿流率。', 'mL/min; urine-flow rate.'),
    {zh:'慢性尿流目标由 GFR 和 MAP 增加，受 ADH、醛固酮和交感抑制。', en:'Slow urine-flow target rises with GFR and MAP, and is inhibited by ADH, aldosterone, and sympathetic tone.'},
    {zh:['表示总尿流，不分水、钠、钾和渗透性利尿成分。'], en:['Represents total urine flow without separating water, sodium, potassium, or osmotic diuresis.']}),
  item('osm', absolute('mOsm/kg；血浆渗透压。', 'mOsm/kg; plasma osmolality.'),
    {zh:'渗透压是推导值而非独立变量：计算渗透压 = 2×Na⁺ + 葡萄糖，因此系数是算术而非拟合（钠 1.20、葡萄糖 0.19）。水的得失通过改变血钠来改变渗透压，不再另设直接项。', en:'Osmolality is derived, not independent: calculated osmolality = 2*Na+ + glucose, so the coefficients are arithmetic rather than fitted (sodium 1.20, glucose 0.19). Water gain or loss reaches osmolality by moving the sodium, not through separate direct terms.'},
    {zh:['以教学集总关系近似，不计算全部有效渗透质；尿素并入基线偏移。','与 pH 同属即时推导的化验值：其"慢"来自输入（血钠为 12 小时平衡时钟），而非自身。','场景中对渗透压的直接驱动表示"非钠非糖的渗透质"，即渗透压间隙。'], en:['Educational lumped approximation; it does not calculate every effective osmole, and urea sits in the baseline offset.','Like pH, it is an immediately derived laboratory value: its slowness belongs to its inputs (sodium carries a 12-hour balance clock), not to itself.','A scenario driver on osmolality means solute that is neither sodium nor glucose - an osmolal gap.']}),
  item('sodium', absolute('mmol/L；血清钠浓度。', 'mmol/L; serum sodium concentration.'),
    {zh:'慢性血钠目标由醛固酮、ADH、尿量和容量状态共同决定。尿是低渗于血浆的：多尿清除自由水而浓缩血浆（血钠升高），少尿潴留自由水而稀释血浆（血钠降低）。', en:'Slow sodium target combines aldosterone, ADH, urine flow, and volume state. Urine is hypotonic to plasma, so a diuresis clears free water and concentrates the plasma (sodium rises), while oliguria retains free water and dilutes it (sodium falls).'},
    {zh:['浓度变化同时受水变化影响；不等同于全身总钠。','单一尿量节点无法区分水利尿、渗透性利尿与噻嗪类利尿：此处取平均情形（低渗尿），而非全部情形。'], en:['Concentration also depends on water balance; it is not total body sodium.','One lumped urine node cannot separate a water diuresis from an osmotic or thiazide one: this is the average case (hypotonic urine), not every case.']}),
  item('potassium', absolute('mmol/L；血清钾浓度。', 'mmol/L; serum potassium concentration.'),
    {zh:'血钾目标由快速 H⁺/K⁺ 跨细胞转移及较慢的醛固酮、GFR、胰岛素、交感和多尿效应共同决定。', en:'Target potassium combines rapid transcellular H+/K+ shift with slower aldosterone, GFR, insulin, sympathetic, and polyuric effects.'},
    {zh:['不单独追踪总身体钾；酸碱相关变化可先是分布改变。'], en:['Does not separately track total-body potassium; acid-base changes may initially be redistribution.']}),
  item('ventilation', absolute('L/min；分钟通气量。', 'L/min; minute ventilation.'),
    {zh:'目标通气由化学感受器驱动、代谢需求和交感促进，受气道阻力抑制。', en:'Target ventilation is driven by chemoreceptors, metabolic demand, and sympathetic tone, and inhibited by airway resistance.'},
    {zh:['不分潮气量、频率、死腔和肺泡通气。'], en:['Does not separate tidal volume, frequency, dead space, or alveolar ventilation.']}),
  item('airway', relative('相对气道阻力（基线=1）。', 'Relative airway resistance (baseline=1).'),
    {zh:'目标气道阻力受交感轻度降低，酸中毒和肺淤血（支气管周围水肿，即“心源性哮喘”）轻度升高。', en:'Target airway resistance is modestly lowered by sympathetic tone and raised by acidosis and by pulmonary congestion - the peribronchial oedema of "cardiac asthma".'},
    {zh:['不含支气管树、痰液、动态肺过度充气或机械通气。'], en:['Omits airway-tree geometry, secretions, dynamic hyperinflation, and mechanical ventilation.']}),
  item('paO2', absolute('mmHg；动脉氧分压。', 'mmHg; arterial oxygen partial pressure.'),
    {zh:'目标 PaO₂ 由通气和心输出量改善，受气道阻力、代谢需求、高 CO₂ 和容量过负荷所致肺淤血抑制。', en:'Target PaO2 improves with ventilation and cardiac output, and falls with airway resistance, metabolic demand, hypercapnia, and the pulmonary congestion of volume overload.'},
    {zh:['不模拟 V/Q 分布、肺泡—动脉梯度或吸入氧浓度。'], en:['Does not model V/Q distribution, A-a gradient, or inspired oxygen concentration.']}),
  item('paCO2', absolute('mmHg；动脉二氧化碳分压。', 'mmHg; arterial carbon-dioxide partial pressure.'),
    {zh:'目标 PaCO₂ 随代谢需求、乳酸、气道阻力和低输出升高，随通气下降。', en:'Target PaCO2 rises with metabolic demand, lactate, airway resistance, and low output, and falls with ventilation.'},
    {zh:['乳酸项用于教学性地表示缓冲产生 CO₂与无效通气增加。'], en:['The lactate term educationally represents buffer-derived CO2 and increased ineffective ventilation.']}),
  item('pH', absolute('无量纲；血液 pH。', 'Unitless; blood pH.'),
    {zh:'pH 使用 Henderson–Hasselbalch 关系在基线附近的线性化：受 PaCO₂ 负向、HCO₃⁻ 正向影响。', en:'pH uses a baseline-linearized Henderson-Hasselbalch relation: PaCO2 acts negatively and HCO3- positively.'},
    {zh:['只在教学状态范围内有效；不替代完整血气计算。'], en:['Valid only over the teaching-state range; not a full blood-gas calculation.']}),
  item('bicarbonate', absolute('mmol/L；血浆 HCO₃⁻。', 'mmol/L; plasma HCO3-.'),
    {zh:'HCO₃⁻ 由快速强酸缓冲池和慢性肾性再生池相加；乳酸近似 1:1 消耗缓冲碱。', en:'HCO3- is the sum of a fast strong-acid buffer pool and a slow renal-regeneration pool; lactate approximately consumes buffer 1:1.'},
    {zh:['肺代偿通过 PaCO₂间接体现；肾代偿在一次短模拟中刻意很慢。','肾性池含碳酸氢盐排泄支路：碱血症时肾脏排出滤过的 HCO₃⁻，因此代谢性碱中毒会自行消退——除非有维持因素（醛固酮过多、低钾）把它撑住。'], en:['Pulmonary compensation is expressed indirectly through PaCO2; renal compensation is intentionally very slow within a short run.','The renal pool includes a bicarbonaturia limb: in alkalemia the kidney stops reclaiming filtered HCO3-, so a metabolic alkalosis resolves on its own unless a maintenance factor - mineralocorticoid excess or potassium depletion - holds it up.']}),
  item('glucose', absolute('mmol/L；血糖。', 'mmol/L; blood glucose.'),
    {zh:'目标血糖由胰高血糖素、交感和代谢需求升高，受胰岛素效应降低。', en:'Target glucose rises with glucagon, sympathetic tone, and metabolic demand, and falls with insulin effect.'},
    {zh:['不模拟进食、肝糖原、肠道吸收或胰岛素药代动力学。'], en:['Does not model meals, hepatic glycogen, gut absorption, or insulin pharmacokinetics.']}),
  item('insulin', relative('相对胰岛素效应（基线=1），不是血清胰岛素 μIU/mL。', 'Relative insulin effect (baseline=1), not serum insulin in μIU/mL.'),
    {zh:'目标胰岛素效应由血糖促进、由交感抑制。', en:'Target insulin effect rises with glucose and is inhibited by sympathetic tone.'},
    {zh:['模型表示净降糖/促钾入细胞效应；未校准分泌、清除、敏感性和检测平台，故保留相对效应单位。'], en:['The model represents net glucose-lowering/potassium-shifting effect; secretion, clearance, sensitivity, and assay platform are not calibrated, so the relative-effect unit is retained.']}, ['homeostasisModel','insulinAssay']),
  item('glucagon', relative('相对胰高血糖素效应（基线=1），不是血浆 pg/mL。', 'Relative glucagon effect (baseline=1), not plasma pg/mL.'),
    {zh:'目标胰高血糖素效应由低血糖、交感和代谢需求升高。', en:'Target glucagon effect rises with lower glucose, sympathetic tone, and metabolic demand.'},
    {zh:['模型表示反调节代谢效应；未校准肽类检测和肝脏反应，故保留相对效应单位。'], en:['The model represents counter-regulatory metabolic effect; peptide assay and hepatic response are not calibrated, so the relative-effect unit is retained.']}, ['homeostasisModel','glucagonAssay']),
  item('tissueO2', index('组织氧输送指数（基线=100），不是 SaO₂ 或混合静脉氧饱和度。', 'Tissue oxygen-delivery index (baseline=100), not SaO2 or mixed venous saturation.'),
    {zh:'目标组织供氧由心输出量、PaO₂和血细胞比容改善，受代谢需求和高阻力限制。PaO₂ 的贡献遵循氧解离曲线而非直线：基线以下曲线陡峭，基线以上血红蛋白已近饱和，PaO₂ 从 95 升到 200 mmHg 仅使动脉氧含量增加约 3%。Hct 超过约 55% 后黏度的代价超过携氧量的收益，供氧转为下降（最适血细胞比容）。', en:'Target tissue oxygen delivery improves with cardiac output, PaO2, and haematocrit, and is limited by metabolic demand and high resistance. The PaO2 contribution follows the dissociation curve rather than a straight line: steep below baseline, and essentially flat above it, because haemoglobin is already about 97% saturated and PaO2 95 to 200 mmHg adds only about 3% to arterial content. Above a haematocrit of about 55% the viscosity cost exceeds the carrying-capacity gain and delivery falls again - the optimal-haematocrit result.'},
    {zh:['集总供氧代理变量；不计算 DO₂、VO₂或微循环异质性。'], en:['A lumped oxygen-delivery proxy; does not calculate DO2, VO2, or microcirculatory heterogeneity.']}),
  item('lactate', absolute('mmol/L；血乳酸。', 'mmol/L; blood lactate.'),
    {zh:'目标乳酸在组织供氧不足、临界供氧以下的无氧代谢、代谢需求、交感与休克时升高。', en:'Target lactate rises with low tissue oxygen delivery, supply-dependent anaerobic metabolism below a threshold, metabolic demand, sympathetic tone, and shock.'},
    {zh:['不单独模拟肝脏/肾脏乳酸清除或 D-乳酸。'], en:['Does not separately model hepatic/renal lactate clearance or D-lactate.']}),
  item('hct', absolute('%；血细胞比容。', '%; haematocrit.'),
    {zh:'慢性 Hct 目标受血容量稀释和低氧驱动的代偿性升高影响。', en:'Slow haematocrit target reflects blood-volume dilution and a hypoxia-driven compensatory rise.'},
    {zh:['不模拟红细胞寿命、出血性红细胞丢失或输血动力学。'], en:['Does not model red-cell lifespan, haemorrhagic red-cell loss, or transfusion kinetics.']}),
  item('metDemand', relative('相对代谢需求（基线=1）。', 'Relative metabolic demand (baseline=1).'),
    {zh:'基础模型中代谢需求仅随交感轻度上升；场景和干预可施加额外负荷。', en:'In the base model, metabolic demand rises modestly with sympathetic tone; scenarios and interventions can apply additional load.'},
    {zh:['不是 VO₂ 或热量测量；用于整合运动、感染、抽搐等教学负荷。'], en:['Not a VO2 or calorimetry measurement; integrates teaching loads such as exercise, infection, and seizure.']})
]);

function localizedSchema(key, lang='zh', inputKeys=[], outputKeys=[]){
  const raw=MODEL_SCHEMA[key];
  if(!raw) return null;
  const l=lang==='en'?'en':'zh';
  return {
    id:raw.id,
    unitKind:raw.unit.kind,
    unitRationale:raw.unit[l],
    equation:{description:raw.equation[l], representation:'normalized-teaching-model'},
    assumptions:raw.assumptions[l],
    inputKeys:[...inputKeys],
    outputKeys:[...outputKeys],
    sourceIds:[...raw.sourceIds]
  };
}

function localizedSources(lang='zh'){
  const l=lang==='en'?'en':'zh';
  return Object.fromEntries(Object.entries(SOURCE_LIBRARY).map(([id,source])=>[id,{
    id, title:source.title[l], type:source.type, url:source.url, note:source.note[l]
  }]));
}

module.exports={MODEL_SCHEMA, SOURCE_LIBRARY, localizedSchema, localizedSources};
