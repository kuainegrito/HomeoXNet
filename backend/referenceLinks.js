'use strict';

// Parameter-level reference links, resolved per report language.
//
// 2026-09-06 rebuild. Two things forced it.
//
// First, a link audit found dead links in production. MSD moved electrolytes, acid-base and
// fluid metabolism out of `endocrine-and-metabolic-disorders/` into `nephrology/`, which
// 404s every old path on msdmanuals.cn; and two Cleveland Clinic slugs (21624 GFR, 17824
// pulse oximetry) no longer resolve. Both were being printed as section 13 of AI reports.
//
// Second, a Chinese report was citing almost nothing in Chinese. Only 21 of the keys below
// are reachable from PARAM_REFERENCE_KEYS, and before this rebuild nine of those 21 resolved
// to MedlinePlus - English-only - so a Chinese learner got an English reading list.
//
// The rule now:
//   zh  人卫临床助手 (PMPH, test.pmphai.com) wherever it has an entry. PMPH publishes
//       概述 / 病因与发病机制 openly and paywalls 诊断要点 / 治疗要点, so these entries
//       support mechanism and compensation only - never diagnostic criteria or treatment.
//   en  MSD Manual Professional for mechanism, Cleveland Clinic and Mayo Clinic for
//       parameter-level concepts, Osmosis for the physiology a learner is actually being
//       asked about. MedlinePlus is no longer used.
//
// Every URL below was checked on 2026-09-06: PMPH and Cleveland by direct request, MSD
// paths through the msdmanuals.cn mirror (identical path tree), Mayo and Osmosis in a real
// browser because all three return 403 to automated fetchers.
//
// NOTE: frontend/app.js still carries its own TRUSTED_PARAM_LINKS for the parameter cards.
// That copy and this one must be kept in step until the frontend is migrated to read these
// from meta(); see the 2026-07-23 entry in README.md.

const MSD_ZH = 'https://www.msdmanuals.cn/';
const MSD_EN = 'https://www.merckmanuals.com/';
const PMPH = 'https://test.pmphai.com/jeesitede/';
const OSMOSIS = 'https://www.osmosis.org/';

const link = (label, url) => ({ label, url });
// Same MSD article, two editions: the path is identical, only the host differs.
const msd = (zhLabel, enLabel, path) => ({
  zh: link(`MSD Manual 中文版：${zhLabel}`, MSD_ZH + path),
  en: link(`MSD Manual Professional: ${enLabel}`, MSD_EN + path)
});
// English-only publishers: the same entry serves both report languages.
const shared = (label, url) => ({ zh: link(label, url), en: link(label, url) });

// One PMPH entry. `lib` is the knowledge library it lives in - disease 疾病, symptom 症状体征,
// jy 检验, jc 检查, lccz 临床操作 - and each library has its own detail route.
const pmph = (lib, id) => `${PMPH}app${lib}/toPcDetail?sessionId=&knowledgeLibPrefix=${lib}&id=${id}`;
// zh from PMPH, en from wherever it is best covered.
const cn = (zhLabel, lib, id, enEntry) => ({
  zh: link(`人卫临床助手：${zhLabel}`, pmph(lib, id)),
  en: enEntry
});

const mayo = (label, path) => link(`Mayo Clinic: ${label}`, `https://www.mayoclinic.org/${path}`);
const cleveland = (label, path) => link(`Cleveland Clinic: ${label}`, `https://my.clevelandclinic.org/health/${path}`);
const osmosis = (label, path) => link(`Osmosis: ${label}`, OSMOSIS + path);
const merck = (label, path) => link(`MSD Manual Professional: ${label}`, `${MSD_EN}professional/${path}`);

const REFERENCE_LINKS = {
  // ---- the 21 keys PARAM_REFERENCE_KEYS can actually reach -------------------------------
  hr: cn('心律失常', 'disease', '10986', mayo('Heart rate', 'healthy-lifestyle/fitness/expert-answers/heart-rate/faq-20057979')),
  bp: cn('高血压病', 'disease', '0001AA100000000ELHKB', cleveland('Hypertension (high blood pressure)', 'diseases/4314-hypertension-high-blood-pressure')),
  preloadAfterload: cn('心力衰竭（前负荷与后负荷）', 'disease', '25941', merck('Heart Failure: Pathophysiology', 'cardiovascular-disorders/heart-failure/overview-of-heart-failure')),
  contractility: cn('急性左心衰竭（收缩力下降）', 'disease', '0001AA100000000EM549', merck('Overview of Heart Failure', 'cardiovascular-disorders/heart-failure/overview-of-heart-failure')),
  potassium: cn('高钾血症', 'disease', '10837', osmosis('Potassium homeostasis', 'learn/Potassium_homeostasis')),
  electrolytes: cn('水钠代谢紊乱与容量障碍', 'disease', '10832', cleveland('Electrolytes', 'diagnostics/21790-electrolytes')),
  sns: cn('血浆儿茶酚胺测定（交感-肾上腺髓质活性）', 'jy', '0001AA100000000L5VVE', cleveland('Sympathetic nervous system', 'body/23262-sympathetic-nervous-system-sns-fight-or-flight')),
  abg: cn('动脉血气分析', 'jc', '0001AA1000000009312V', osmosis('Acid-base physiology', 'notes/Acid-Base_Physiology')),
  renin: cn('血浆肾素活性测定', 'jy', '1565619455428395009', cleveland('Renin-angiotensin-aldosterone system (RAAS)', 'articles/24175-renin-angiotensin-aldosterone-system-raas')),
  aldosterone: cn('醛固酮测定', 'jy', '0001AA100000000L5VR5', cleveland('Aldosterone', 'articles/24158-aldosterone')),
  osmolality: cn('血浆、尿液渗透压测定', 'jy', '0001AA100000000SIX8K', osmosis('Osmoregulation', 'learn/Osmoregulation')),
  sodium: cn('低钠血症', 'disease', '10834', osmosis('Sodium homeostasis', 'learn/Sodium_homeostasis')),
  gfr: cn('慢性肾脏病（肾小球滤过率）', 'disease', '11301', cleveland('Estimated glomerular filtration rate (eGFR)', 'diagnostics/21593-estimated-glomerular-filtration-rate-egfr')),
  spo2: cn('血氧饱和度测定', 'jy', '0001AA100000000OKBSO', cleveland('Pulse oximetry', 'diagnostics/pulse-oximetry')),
  metabolicAcidosis: cn('代谢性酸中毒', 'disease', '10845', cleveland('Metabolic acidosis', 'diseases/24492-metabolic-acidosis')),
  glucose: cn('血糖测定', 'jy', '1573146820949835778', cleveland('Blood glucose test', 'diagnostics/12363-blood-glucose-test')),
  diabetes: cn('糖尿病', 'disease', '10850', merck('Overview of Diabetes Mellitus', 'endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/overview-of-diabetes-mellitus')),
  lacticAcidosis: cn('乳酸性酸中毒', 'disease', '0001AA100000000ELZSA', cleveland('Lactic acidosis', 'diseases/25066-lactic-acidosis')),
  hematocritCleveland: cn('血细胞比容测定', 'jy', '0001AA100000000L5Y2K', cleveland('Hematocrit', 'diagnostics/17683-hematocrit')),
  hematocritMayo: cn('贫血', 'disease', '11403', mayo('Hematocrit test', 'tests-procedures/hematocrit/about/pac-20384728')),
  // PMPH has no standalone exercise-physiology entry; MSD covers it in both editions.
  metabolicBenefits: msd('运动概述', 'Overview of Exercise', 'professional/special-subjects/exercise/overview-of-exercise'),

  // ---- additional keys: parameter cards, and available for future PARAM_REFERENCE_KEYS ----
  hrTachy: cn('窦性心动过速', 'disease', '0001AA100000000ELZT7', mayo('Tachycardia', 'diseases-conditions/tachycardia/diagnosis-treatment/drc-20355133')),
  hrBrady: cn('窦性心动过缓', 'disease', '0001AA100000000ENLQS', mayo('Bradycardia', 'diseases-conditions/bradycardia/symptoms-causes/syc-20355474')),
  bpHigh: cn('高血压危象', 'disease', '0001AA100000000EQG69', mayo('High blood pressure', 'diseases-conditions/high-blood-pressure/symptoms-causes/syc-20373410')),
  bpLow: cn('休克（低血压与组织低灌注）', 'disease', '10517', mayo('Low blood pressure', 'diseases-conditions/low-blood-pressure/symptoms-causes/syc-20355465')),
  shock: cn('休克', 'disease', '10517', osmosis('Shock: Pathology review', 'learn/Shock:_Pathology_review')),
  bpRegulation: cn('高血压病', 'disease', '0001AA100000000ELHKB', osmosis('Blood pressure regulation', 'notes/Blood_Pressure_Regulation')),
  cardiacOutputMsd: cn('心力衰竭', 'disease', '25941', merck('Overview of Heart Failure', 'cardiovascular-disorders/heart-failure/overview-of-heart-failure')),
  rhythmStability: cn('心律失常', 'disease', '10986', merck('Overview of Arrhythmias', 'cardiovascular-disorders/overview-of-arrhythmias-and-conduction-disorders/overview-of-arrhythmias')),
  autonomicMsd: cn('血浆儿茶酚胺测定', 'jy', '0001AA100000000L5VVE', merck('Overview of the Autonomic Nervous System', 'neurologic-disorders/autonomic-nervous-system/overview-of-the-autonomic-nervous-system')),

  // Acid-base. Every MSD path here is the post-reorganization `nephrology/` one.
  acidBaseMsd: cn('酸碱平衡紊乱', 'disease', '10844', merck('Acid-Base Regulation', 'nephrology/acid-base-regulation-and-disorders/acid-base-regulation')),
  mixedAcidBaseMsd: cn('混合性酸碱平衡失调', 'disease', '10849', osmosis('Acid-base disturbances: Pathology review', 'learn/Acid-base_disturbances:_Pathology_review')),
  metabolicAlkalosisMsd: cn('代谢性碱中毒', 'disease', '10846', merck('Metabolic Alkalosis', 'nephrology/acid-base-regulation-and-disorders/metabolic-alkalosis')),
  respiratoryAcidosisMsd: cn('呼吸性酸中毒', 'disease', '10847', merck('Respiratory Acidosis', 'nephrology/acid-base-regulation-and-disorders/respiratory-acidosis')),
  respiratoryAlkalosisMsd: cn('呼吸性碱中毒', 'disease', '10848', merck('Respiratory Alkalosis', 'nephrology/acid-base-regulation-and-disorders/respiratory-alkalosis')),
  kidneyAcidBase: cn('酸碱平衡紊乱', 'disease', '10844', osmosis('The role of the kidney in acid-base balance', 'learn/The_role_of_the_kidney_in_acid-base_balance')),

  // Fluid, electrolytes, endocrine.
  sodiumWaterMsd: cn('水钠代谢紊乱-容量障碍：低容量', 'disease', '10832', merck('Water and Sodium Balance', 'nephrology/fluid-metabolism/water-and-sodium-balance')),
  potassiumHighMsd: cn('高钾血症', 'disease', '10837', merck('Hyperkalemia', 'nephrology/electrolyte-disorders/hyperkalemia')),
  potassiumLowMsd: cn('低钾血症', 'disease', '22420', merck('Hypokalemia', 'nephrology/electrolyte-disorders/hypokalemia')),
  hypernatremiaMsd: cn('高钠血症', 'disease', '10835', merck('Hypernatremia', 'nephrology/electrolyte-disorders/hypernatremia')),
  electrolyteDisturbances: cn('低钠血症', 'disease', '10834', osmosis('Electrolyte disturbances: Pathology review', 'learn/Electrolyte_disturbances:_Pathology_review')),
  raasMsd: cn('原发性醛固酮增多症', 'disease', '10899', osmosis('Renin-angiotensin-aldosterone system', 'learn/Renin-angiotensin-aldosterone_system')),
  adhMsd: cn('抗利尿激素分泌不当综合征', 'disease', '10893', merck('Syndrome of Inappropriate ADH Secretion (SIADH)', 'nephrology/electrolyte-disorders/syndrome-of-inappropriate-adh-secretion-siadh')),
  diabetesInsipidusMsd: cn('中枢性尿崩症', 'disease', '26312', cleveland('Central diabetes insipidus', 'diseases/23515-central-diabetes-insipidus-cdi')),
  bloodVolumeMsd: cn('失血性休克', 'disease', '22460', merck('Shock', 'critical-care-medicine/shock-and-fluid-resuscitation/shock')),
  volumeDepletionMsd: cn('高渗性缺水', 'disease', '22418', merck('Volume Depletion', 'nephrology/fluid-metabolism/volume-depletion')),

  // Renal.
  gfrMsd: cn('慢性肾脏病', 'disease', '11301', merck('Chronic Kidney Disease', 'nephrology/chronic-kidney-disease/chronic-kidney-disease')),
  akiMsd: cn('急性肾损伤', 'disease', '11297', merck('Acute Kidney Injury (AKI)', 'nephrology/acute-kidney-injury/acute-kidney-injury-aki')),
  glomerularFiltration: cn('慢性肾脏病', 'disease', '11301', osmosis('Glomerular filtration', 'learn/Glomerular_filtration')),
  urineOliguriaMsd: cn('少尿与无尿', 'symptom', 'a5cca1dee1cf7ef7fedbd8723f45f6aa', merck('Oliguria', 'critical-care-medicine/approach-to-the-critically-ill-patient/oliguria')),
  urinePolyuriaMsd: cn('少尿、无尿与多尿', 'symptom', '5d819167c8580f5ef7720fa9bc71192c', cleveland('Central diabetes insipidus', 'diseases/23515-central-diabetes-insipidus-cdi')),
  urineVolume: cn('尿量测定', 'jy', '0001AA100000000L5VSK', merck('Oliguria', 'critical-care-medicine/approach-to-the-critically-ill-patient/oliguria')),

  // Respiratory and oxygen transport.
  ventilationMechanicsMsd: cn('机械通气术', 'lccz', '1670681359921709057', merck('Overview of Mechanical Ventilation', 'critical-care-medicine/respiratory-failure-and-mechanical-ventilation/overview-of-mechanical-ventilation')),
  oxygenDeliveryMsd: cn('高流量给氧', 'lccz', '1889856919040950274', osmosis('Oxygen binding capacity and oxygen content', 'learn/Oxygen_binding_capacity_and_oxygen_content')),
  oxyhemoglobinCurve: cn('血氧饱和度测定', 'jy', '0001AA100000000OKBSO', osmosis('Oxygen-hemoglobin dissociation curve', 'learn/Oxygen-hemoglobin_dissociation_curve')),
  respiratoryFailureMsd: cn('呼吸衰竭', 'disease', '11167', merck('Overview of Respiratory Failure', 'critical-care-medicine/respiratory-failure-and-mechanical-ventilation/overview-of-respiratory-failure')),
  hyperventilationMsd: cn('过度通气综合征', 'disease', '0001AA100000000ES74V', merck('Hyperventilation Syndrome', 'pulmonary-disorders/symptoms-of-pulmonary-disorders/hyperventilation-syndrome')),
  dyspneaMsd: cn('呼吸困难', 'symptom', '390646654afa8daec85de4bfcd5ce57a', merck('Dyspnea', 'pulmonary-disorders/symptoms-of-pulmonary-disorders/dyspnea')),
  abgMsd: cn('动脉血气分析', 'jc', '0001AA1000000009312V', merck('Acid-Base Regulation', 'nephrology/acid-base-regulation-and-disorders/acid-base-regulation')),

  // Metabolic and hematologic.
  diabetesMsd: cn('糖尿病', 'disease', '10850', merck('Overview of Diabetes Mellitus', 'endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/overview-of-diabetes-mellitus')),
  dkaMsd: cn('糖尿病酮症酸中毒', 'disease', '29967', merck('Acute Complications of Diabetes Mellitus', 'endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/acute-complications-of-diabetes-mellitus')),
  hypoglycemiaMsd: cn('低血糖症', 'disease', '10855', cleveland('Hypoglycemia (low blood sugar)', 'diseases/11647-hypoglycemia-low-blood-sugar')),
  insulinTest: cn('胰岛素测定', 'jy', '0001AA100000000L5VDK', cleveland('Insulin', 'body/22601-insulin')),
  glucagonTest: cn('血浆胰高血糖素测定', 'jy', '0001AA100000000L5XP8', cleveland('Glucagon', 'body/22283-glucagon')),
  lactateMsd: cn('血浆乳酸测定', 'jy', '0001AA100000000L5WO8', cleveland('Lactic acidosis', 'diseases/25066-lactic-acidosis')),
  anemiaHctMsd: cn('贫血', 'disease', '11403', merck('Evaluation of Anemia', 'hematology-and-oncology/approach-to-the-patient-with-anemia/evaluation-of-anemia')),
  polycythemiaMsd: cn('真性红细胞增多症', 'disease', '11474', merck('Polycythemia Vera', 'hematology-and-oncology/myeloproliferative-disorders/polycythemia-vera')),
  carbonMonoxideMsd: cn('一氧化碳中毒', 'disease', '10732', merck('Carbon Monoxide Poisoning', 'injuries-poisoning/poisoning/carbon-monoxide-poisoning'))
};

// Mirrors the refs: arrays in frontend/app.js PARAM_DETAIL_OVERRIDES.
const PARAM_REFERENCE_KEYS = {
  map: ['bp'],
  hr: ['hr'],
  tpr: ['bp'],
  venousReturn: ['preloadAfterload'],
  contractility: ['contractility'],
  rhythmStability: ['potassium', 'electrolytes'],
  symp: ['sns'],
  vagal: ['hr'],
  chemo: ['abg'],
  renin: ['renin', 'aldosterone'],
  angII: ['renin', 'aldosterone'],
  aldosterone: ['aldosterone', 'electrolytes'],
  adh: ['osmolality'],
  bloodVolume: ['electrolytes', 'aldosterone'],
  gfr: ['gfr'],
  urine: ['gfr', 'electrolytes'],
  osm: ['osmolality', 'sodium'],
  sodium: ['sodium', 'electrolytes'],
  potassium: ['potassium', 'electrolytes'],
  ventilation: ['abg'],
  airway: ['abg', 'spo2'],
  paO2: ['abg', 'spo2'],
  paCO2: ['abg'],
  pH: ['abg', 'metabolicAcidosis'],
  bicarbonate: ['electrolytes', 'metabolicAcidosis'],
  glucose: ['glucose', 'diabetes'],
  insulin: ['glucose', 'diabetes', 'potassium'],
  glucagon: ['glucose', 'diabetes'],
  tissueO2: ['abg', 'spo2'],
  lactate: ['lacticAcidosis', 'metabolicAcidosis'],
  hct: ['hematocritCleveland', 'hematocritMayo'],
  metDemand: ['metabolicBenefits']
};

const CHINESE_SOURCE_PATTERN = /msdmanuals\.cn|\/zh-hans\/|pmphai\.com/;

// A Chinese report lists Chinese-language sources first, then the English-only ones.
// An English report never sees a Chinese-language source in the first place.
function isChineseLanguageSource(url){
  return CHINESE_SOURCE_PATTERN.test(String(url || ''));
}

function parameterReferences(parameterKey, lang = 'zh'){
  const l = lang === 'en' ? 'en' : 'zh';
  return (PARAM_REFERENCE_KEYS[parameterKey] || [])
    .map(refKey => REFERENCE_LINKS[refKey]?.[l])
    .filter(Boolean)
    .map(entry => ({ title: entry.label, url: entry.url }));
}

module.exports = {
  REFERENCE_LINKS,
  PARAM_REFERENCE_KEYS,
  parameterReferences,
  isChineseLanguageSource
};
