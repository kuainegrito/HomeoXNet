'use strict';

// Parameter-level reference links, resolved per report language.
//
// Chinese uses MSD Manual 中文版 (msdmanuals.cn) and Mayo's zh-hans pages where they exist;
// English uses the same articles on merckmanuals.com and Mayo's default-locale pages.
// Cleveland Clinic and MedlinePlus publish in English only and are shared by both.
//
// Every English URL below was verified to return HTTP 200 on 2026-07-23 (MSD via curl,
// Mayo via a real browser because Mayo returns 403 to automated fetchers).
//
// NOTE: frontend/app.js still carries its own TRUSTED_PARAM_LINKS for the parameter cards.
// That copy and this one must be kept in step until the frontend is migrated to read these
// from meta(); see the 2026-07-23 entry in README.md.

const MSD_ZH = 'https://www.msdmanuals.cn/';
const MSD_EN = 'https://www.merckmanuals.com/';

const link = (label, url) => ({ label, url });
// Same MSD article, two editions: the path is identical, only the host differs.
const msd = (zhLabel, enLabel, path) => ({
  zh: link(`MSD Manual 中文版：${zhLabel}`, MSD_ZH + path),
  en: link(`MSD Manual Professional: ${enLabel}`, MSD_EN + path)
});
// English-only publishers: the same entry serves both report languages.
const shared = (label, url) => ({ zh: link(label, url), en: link(label, url) });

const REFERENCE_LINKS = {
  hr: shared('Mayo Clinic: Heart rate', 'https://www.mayoclinic.org/healthy-lifestyle/fitness/expert-answers/heart-rate/faq-20057979'),
  hrTachy: {
    zh: link('Mayo Clinic: 心动过速', 'https://www.mayoclinic.org/zh-hans/diseases-conditions/tachycardia/diagnosis-treatment/drc-20355133'),
    en: link('Mayo Clinic: Tachycardia', 'https://www.mayoclinic.org/diseases-conditions/tachycardia/diagnosis-treatment/drc-20355133')
  },
  hrBrady: {
    zh: link('Mayo Clinic: 心动过缓', 'https://www.mayoclinic.org/zh-hans/diseases-conditions/bradycardia/symptoms-causes/syc-20355474'),
    en: link('Mayo Clinic: Bradycardia', 'https://www.mayoclinic.org/diseases-conditions/bradycardia/symptoms-causes/syc-20355474')
  },
  bp: shared('Cleveland Clinic: Hypertension', 'https://my.clevelandclinic.org/health/diseases/4314-hypertension-high-blood-pressure'),
  bpHigh: {
    zh: link('Mayo Clinic: 高血压', 'https://www.mayoclinic.org/zh-hans/diseases-conditions/high-blood-pressure/symptoms-causes/syc-20373410'),
    en: link('Mayo Clinic: High blood pressure', 'https://www.mayoclinic.org/diseases-conditions/high-blood-pressure/symptoms-causes/syc-20373410')
  },
  bpLow: {
    zh: link('Mayo Clinic: 低血压', 'https://www.mayoclinic.org/zh-hans/diseases-conditions/low-blood-pressure/symptoms-causes/syc-20355465'),
    en: link('Mayo Clinic: Low blood pressure', 'https://www.mayoclinic.org/diseases-conditions/low-blood-pressure/symptoms-causes/syc-20355465')
  },
  gfr: shared('Cleveland Clinic: GFR', 'https://my.clevelandclinic.org/health/diagnostics/21624-glomerular-filtration-rate-gfr'),
  abg: shared('MedlinePlus: Arterial blood gas', 'https://medlineplus.gov/lab-tests/arterial-blood-gas-abg-test/'),
  spo2: shared('Cleveland Clinic: Pulse oximetry', 'https://my.clevelandclinic.org/health/diagnostics/17824-pulse-oximetry'),
  metabolicAcidosis: shared('Cleveland Clinic: Metabolic acidosis', 'https://my.clevelandclinic.org/health/diseases/24492-metabolic-acidosis'),
  lacticAcidosis: shared('Cleveland Clinic: Lactic acidosis', 'https://my.clevelandclinic.org/health/diseases/25066-lactic-acidosis'),
  electrolytes: shared('MedlinePlus: Electrolyte panel', 'https://medlineplus.gov/lab-tests/electrolyte-panel/'),
  sodium: shared('MedlinePlus: Sodium blood test', 'https://medlineplus.gov/lab-tests/sodium-blood-test/'),
  potassium: shared('MedlinePlus: Potassium blood test', 'https://medlineplus.gov/lab-tests/potassium-blood-test/'),
  aldosterone: shared('MedlinePlus: Aldosterone test', 'https://medlineplus.gov/lab-tests/aldosterone-test/'),
  renin: shared('MedlinePlus: Renin test', 'https://medlineplus.gov/lab-tests/renin-test/'),
  osmolality: shared('MedlinePlus: Osmolality tests', 'https://medlineplus.gov/lab-tests/osmolality-tests/'),
  glucose: shared('MedlinePlus: Blood glucose test', 'https://medlineplus.gov/lab-tests/blood-glucose-test/'),
  diabetes: shared('MedlinePlus: Diabetes', 'https://medlineplus.gov/diabetes.html'),
  hematocritCleveland: shared('Cleveland Clinic: Hematocrit', 'https://my.clevelandclinic.org/health/diagnostics/17683-hematocrit'),
  hematocritMayo: shared('Mayo Clinic: Hematocrit test', 'https://www.mayoclinic.org/tests-procedures/hematocrit/about/pac-20384728'),
  sns: shared('Cleveland Clinic: Sympathetic nervous system', 'https://my.clevelandclinic.org/health/body/23262-sympathetic-nervous-system-sns-fight-or-flight'),

  acidBaseMsd: msd('酸碱平衡', 'Acid-Base Regulation', 'professional/endocrine-and-metabolic-disorders/acid-base-regulation-and-disorders/acid-base-regulation'),
  sodiumWaterMsd: msd('水和钠平衡', 'Water and Sodium Balance', 'professional/endocrine-and-metabolic-disorders/fluid-metabolism/water-and-sodium-balance'),
  potassiumHighMsd: msd('高钾血症', 'Hyperkalemia', 'professional/endocrine-and-metabolic-disorders/electrolyte-disorders/hyperkalemia'),
  potassiumLowMsd: msd('低钾血症', 'Hypokalemia', 'professional/endocrine-and-metabolic-disorders/electrolyte-disorders/hypokalemia'),
  raasMsd: msd('RAAS 调节血压', 'The Renin-Angiotensin-Aldosterone System', 'home/multimedia/image/regulating-blood-pressure-the-renin-angiotensin-aldosterone-system'),
  adhMsd: msd('抗利尿激素与 SIADH', 'Syndrome of Inappropriate ADH Secretion (SIADH)', 'professional/endocrine-and-metabolic-disorders/electrolyte-disorders/syndrome-of-inappropriate-adh-secretion-siadh'),
  bloodVolumeMsd: msd('出血与血容量', 'Excessive Bleeding', 'professional/hematology-and-oncology/hemostasis/excessive-bleeding'),
  gfrMsd: msd('慢性肾病', 'Chronic Kidney Disease', 'professional/genitourinary-disorders/chronic-kidney-disease/chronic-kidney-disease'),
  urinePolyuriaMsd: msd('多尿', 'Polyuria', 'professional/genitourinary-disorders/symptoms-of-genitourinary-disorders/polyuria'),
  urineOliguriaMsd: msd('少尿', 'Oliguria', 'professional/critical-care-medicine/approach-to-the-critically-ill-patient/oliguria'),
  ventilationMechanicsMsd: msd('机械通气与呼吸力学', 'Overview of Mechanical Ventilation', 'professional/critical-care-medicine/respiratory-failure-and-mechanical-ventilation/overview-of-mechanical-ventilation'),
  hyperventilationMsd: msd('过度通气综合征', 'Hyperventilation Syndrome', 'professional/pulmonary-disorders/symptoms-of-pulmonary-disorders/hyperventilation-syndrome'),
  dyspneaMsd: msd('呼吸困难', 'Dyspnea', 'professional/pulmonary-disorders/symptoms-of-pulmonary-disorders/dyspnea'),
  diabetesMsd: msd('糖尿病概述', 'Overview of Diabetes Mellitus', 'professional/endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/overview-of-diabetes-mellitus'),
  hypoglycemiaMsd: msd('低血糖', 'Hypoglycemia', 'professional/endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/hypoglycemia'),
  cardiacOutputMsd: msd('心输出量与心力衰竭', 'Overview of Heart Failure', 'professional/cardiovascular-disorders/heart-failure/overview-of-heart-failure'),
  preloadAfterload: msd('心力衰竭病理生理', 'Heart Failure: Pathophysiology', 'professional/cardiovascular-disorders/heart-failure/overview-of-heart-failure'),
  contractility: msd('心肌收缩力与心力衰竭', 'Heart Failure: Pathophysiology', 'professional/cardiovascular-disorders/heart-failure/overview-of-heart-failure'),
  rhythmStability: msd('心律失常概述', 'Overview of Arrhythmias', 'professional/cardiovascular-disorders/overview-of-arrhythmias-and-conduction-disorders/overview-of-arrhythmias'),
  autonomicMsd: msd('自主神经系统', 'Overview of the Autonomic Nervous System', 'professional/neurologic-disorders/autonomic-nervous-system/overview-of-the-autonomic-nervous-system'),
  abgMsd: msd('动脉血气与脉搏血氧', 'Arterial Blood Gas (ABG) Analysis and Pulse Oximetry', 'home/lung-and-airway-disorders/diagnosis-of-and-procedures-for-lung-disorders/arterial-blood-gas-abg-analysis-and-pulse-oximetry'),
  oxygenDeliveryMsd: msd('机械通气与供氧', 'Overview of Mechanical Ventilation', 'professional/critical-care-medicine/respiratory-failure-and-mechanical-ventilation/overview-of-mechanical-ventilation'),
  carbonMonoxideMsd: msd('一氧化碳中毒', 'Carbon Monoxide Poisoning', 'professional/injuries-poisoning/poisoning/carbon-monoxide-poisoning'),
  lactateMsd: msd('丙酮酸代谢障碍', 'Pyruvate Metabolism Disorders', 'professional/pediatrics/inherited-disorders-of-metabolism/pyruvate-metabolism-disorders'),
  anemiaHctMsd: msd('贫血评估', 'Evaluation of Anemia', 'professional/hematology-and-oncology/approach-to-the-patient-with-anemia/evaluation-of-anemia'),
  polycythemiaMsd: msd('真性红细胞增多症', 'Polycythemia Vera', 'professional/hematology-and-oncology/myeloproliferative-disorders/polycythemia-vera'),
  metabolicBenefits: msd('运动概述', 'Overview of Exercise', 'professional/special-subjects/exercise/overview-of-exercise')
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
