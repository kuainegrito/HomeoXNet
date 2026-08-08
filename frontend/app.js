'use strict';

const DEFAULT_API_BASE = location.pathname.startsWith('/homeostasis-test/')
  ? '/homeostasis-test'
  : (location.pathname.startsWith('/homeostasis/') ? '/homeostasis' : '');
const API_BASE = window.API_BASE || DEFAULT_API_BASE;
// Which of the two deployments this is. Derived from the same path check as the API base rather
// than hard-coded, so this file is byte-identical in apps/homeostasis and apps/homeostasis-test
// and a sync between them cannot forget to rewrite it. It reaches the learning log, where the
// two builds must stay distinguishable.
const APP_SLUG = DEFAULT_API_BASE ? DEFAULT_API_BASE.slice(1) : 'homeostasis';
const qs = new URLSearchParams(location.search);
const lang = qs.get('lang') === 'en' ? 'en' : 'zh';
document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
// ---------------------------------------------------------------------------------------
// Time lens
// ---------------------------------------------------------------------------------------
// Four things about time are kept separate here, and the console shows all four at once,
// because the 2026-07-24 build blurred them and became impossible to reason about:
//
//   lens     which time scale is being watched. Sets the chart window and the base rate.
//   speed    a multiplier within the lens, so a learner can dwell or skim without leaving it.
//   the clock the simulated time elapsed, said the way a clinician would say it.
//   the rate "1 real second = X simulated", always on screen. That sentence is the contract:
//            however hard time is compressed, the learner is never misled about by how much.
//
// The lens can move by itself when the physiology changes scale, but it never moves silently
// and it never overrides a choice the learner has just made.

let timeMeta = null;              // meta.time, published by the backend
let lensId = 'seconds';
let speedIndex = 3;
let autoLensEnabled = true;
let lastAutoLensAt = -Infinity;
let timeNoticeUntil = 0;

const AUTO_LENS_MIN_INTERVAL_MS = 3000;
const HIGH_SPEED_COMPRESSION = 60;   // above this the network drops to overview mode
const TIME_NOTICE_MS = 6500;

function lensById(id){ return timeMeta?.lenses?.find(lens => lens.id === id) || timeMeta?.lenses?.[0] || null; }
function activeLens(){ return lensById(lensId); }
function speedMultiplier(){ return timeMeta?.speedSteps?.[speedIndex] ?? 1; }
function currentCompression(){ return (activeLens()?.rate ?? 1) * speedMultiplier(); }
function observationWindow(){ return activeLens()?.window ?? 90; }
function isHighSpeed(){ return currentCompression() >= HIGH_SPEED_COMPRESSION; }
// Kept for the report and the learning log, which describe pace as a plain multiplier.
function selectedSpeed(){ return currentCompression(); }

function formatSimDuration(seconds){
  const value=Math.max(0, Number(seconds) || 0);
  const zh=lang !== 'en';
  if(value < 100) return zh ? `${value.toFixed(value < 10 ? 1 : 0)} 秒` : `${value.toFixed(value < 10 ? 1 : 0)} s`;
  if(value < 5400){ const m=value/60; return zh ? `${m.toFixed(m < 10 ? 1 : 0)} 分钟` : `${m.toFixed(m < 10 ? 1 : 0)} min`; }
  if(value < 172800){ const h=value/3600; return zh ? `${h.toFixed(h < 10 ? 1 : 0)} 小时` : `${h.toFixed(h < 10 ? 1 : 0)} h`; }
  return zh ? `${(value/86400).toFixed(1)} 天` : `${(value/86400).toFixed(1)} d`;
}
function describeCompression(compression){
  const zh=lang !== 'en';
  const c=Math.max(0.01, Number(compression) || 1);
  if(Math.abs(c-1) < 1e-6) return zh ? '1 秒真实 = 1 秒模拟（实时）' : '1 real second = 1 simulated second (real time)';
  if(c < 1) return zh ? `1 秒真实 = ${formatSimDuration(c)}模拟（慢动作）` : `1 real second = ${formatSimDuration(c)} simulated (slow motion)`;
  return zh ? `1 秒真实 = ${formatSimDuration(c)}模拟` : `1 real second = ${formatSimDuration(c)} simulated`;
}

function showTimeNotice(text, tone='info'){
  const box=$('timeNotice');
  if(!box) return;
  box.textContent=text;
  box.dataset.tone=tone;
  box.hidden=false;
  timeNoticeUntil=performance.now()+TIME_NOTICE_MS;
}
function expireTimeNotice(){
  const box=$('timeNotice');
  if(box && !box.hidden && performance.now() > timeNoticeUntil) box.hidden=true;
}

function setLens(id, {auto=false, reason=''}={}){
  if(!lensById(id) || id === lensId) return;
  lensId=id;
  // The replay tape deliberately survives a lens change: reproducing a run means reproducing the
  // scale changes that happened during it, not restarting the recording at each one.
  renderTimeConsole();
  if(auto){
    showTimeNotice(lang === 'zh'
      ? `已自动切到${activeLens()?.title || ''}。${reason}`
      : `Switched automatically to the ${activeLens()?.title || ''}. ${reason}`, 'auto');
  }
  sendLearningEvent('lens_change', {lens:id, auto, compression:currentCompression()});
}
function setAutoLens(enabled, {silent=false}={}){
  if(autoLensEnabled === enabled) return;
  autoLensEnabled=enabled;
  renderTimeConsole();
  if(silent) return;
  showTimeNotice(enabled
    ? (lang === 'zh' ? '已交回自动尺度：系统会跟随当前变化最快的一层。' : 'Automatic scaling resumed: the view will follow whichever layer is moving fastest.')
    : (lang === 'zh' ? '已改为手动尺度，自动切换已停止。' : 'Manual scale selected; automatic switching is off.'), 'info');
}
// Automatic scaling follows the backend's recommendation, which names the fastest layer that
// still has pending work. Hysteresis keeps it from oscillating, and a manual choice always
// wins - the learner is never fighting the control.
function applyAutoLens(snap){
  if(!autoLensEnabled || !snap?.temporal) return;
  const wanted=snap.temporal.recommendedLens;
  if(!wanted || wanted === lensId) return;
  const now=performance.now();
  if(now-lastAutoLensAt < AUTO_LENS_MIN_INTERVAL_MS) return;
  lastAutoLensAt=now;
  setLens(wanted, {auto:true, reason:snap.temporal.reason || ''});
}
// Two things the learner needs to be told about compression, neither of which involves taking
// the control away from them.
//
// Held back: automatic scaling wanted to speed up but the patient is deteriorating too fast to
// watch at that scale. Without a word on screen this looks like the auto switch is broken.
//
// Too fast: the learner has manually chosen a scale at which the stability bar will empty in a
// few seconds. That is their choice to make - but they should make it knowingly, which is what
// went wrong when a decompensating patient was put on the twenty-times lens automatically.
let wasHeldBack = false;
let lastLegibilityWarnAt = -Infinity;
function checkCompressionLegibility(snap){
  const status=snap?.temporal;
  if(!status) return;
  if(autoLensEnabled){
    if(status.heldBack && !wasHeldBack) showTimeNotice(status.reason, 'alert');
    wasHeldBack=Boolean(status.heldBack);
    return;
  }
  wasHeldBack=false;
  const ceiling=status.maxCompression;
  if(!ceiling || currentCompression() <= ceiling) return;
  const now=performance.now();
  if(now-lastLegibilityWarnAt < 9000) return;
  lastLegibilityWarnAt=now;
  const perRealSecond=(status.healthChangeRate || 0)*currentCompression();
  showTimeNotice(lang === 'zh'
    ? `当前尺度下生命稳定度约每真实秒下降 ${perRealSecond.toFixed(0)} 点，过程几乎无法看清。切到更慢的尺度或降低速度。`
    : `At this scale stability falls about ${perRealSecond.toFixed(0)} points per real second, which is too fast to follow. Choose a slower scale or reduce the speed.`, 'alert');
}

const TEXT = {
  zh: {
    title:'HomeoXNet',
    internalEdition:'（贵医内部版，公网版请点击<a href="https://www.kuaiyu.site/homeostasis/simulator.html?lang=zh">此</a>）',
    subtitle:'调节参数，观察多器官稳态反馈：神经反射首先响应，约 20 个模拟秒后体液与内分泌调节逐步参与。持续失衡可能导致失代偿。',
    desktopHelpLink:'详尽说明',
    desktopHelpTitle:'电脑版详尽说明',
    desktopHelpOpenNew:'新窗口打开',
    desktopHelpClose:'关闭电脑版详尽说明',
    desktopHelpFallback:'如果 PDF 没有显示，请点击“新窗口打开”。',
    mobileHelpLink:'手机版使用方法',
    mobileHelpBody:'<h2>手机版使用方法：</h2><h3>一、自由干预</h3><ul><li>点击“稳态复杂网络”中的节点，在节点旁直接调整参数；点击 × 或卡片外区域关闭</li><li>也可使用右下角跳转按钮，在观察区与完整“干预控制台”之间切换</li><li>在“稳态复杂网络”和右栏“生命稳定度”中观察反馈；随时可在下方“回放控制台”暂停或回放整个过程</li></ul><h3>二、疾病模拟</h3><ul><li>先选择疾病大类，再选择具体疾病，载入相应的病理状态</li><li>结合网络、生命稳定度和临床病情评估，分析异常、代偿及失代偿风险</li><li>通过节点控制卡或干预控制台实施干预，观察病情变化</li></ul><p>两种模式可独立使用；载入疾病后也可继续干预。</p>',
    mobileHelpClose:'关闭手机版使用方法',
    creator:'<span class="creator-primary">制作人：<a class="creator-link" href="https://www.kuaiyu.site/" target="_blank" rel="noopener noreferrer">于快</a> 贵州医科大学（yukuai@gmc.edu.cn）</span>',
    selectCategory:'选择疾病大类', selectScenario:'选择具体疾病', selectDisease:'选择疾病', selectDiseaseAria:'选择疾病：先选大类，再选具体疾病', pause:'暂停', resume:'继续', zero:'归零干预', zeroUnavailable:'当前没有可归零的手动干预', restart:'重新开始', switch:'English', switchHref:'simulator.html?lang=en',
    controlTitle:'干预控制台', controlHint:'', networkTitle:'稳态复杂网络', networkHint:'节点颜色代表偏离方向：黄/红偏高，青/蓝偏低；边越亮影响越强', topologyLayout:'失衡机制视图', topologyLayoutAria:'失衡机制视图：根据当前疾病或稳态扰动的影响关系重排网络节点', topologyLayoutToast:'已切换至失衡机制视图；点击“恢复网络视图”可回到默认布局。', resetLayout:'恢复网络视图', resetLayoutAria:'恢复网络视图：将所有节点和系统标签恢复到默认位置，并重新适配视图',
    logTitle:'事件日志', logHint:'最新 8 条', stability:'生命稳定度',
    replayTitle:'回放控制台', replayHiddenTag:'（已隐藏）', replayShow:'显示', replayHide:'隐藏', replayShowAria:'显示回放控制台', replayHideAria:'隐藏回放控制台',
    replaySpeedLabel:'回放速度', replayPlay:'▶ 回放', replayPause:'⏸ 暂停回放', replayToStart:'回到开头', replayToStartAria:'回到本次会话开头', replayLive:'回到实时',
    replayHint:'回放速度只作用于这段录像，不改变右侧「观察时间尺度」的模拟压缩。',
    timeScaleLockedNote:'回放中：时间尺度跟随录像，暂不可更改。',
    replayScrubAria:'回放进度', replayEmpty:'本次还没有任何干预操作，没有可回放的内容。先调整一个参数或载入一个疾病。',
    replayEnter:'已进入回放：模拟暂停，网络、稳定度与说明面板都回到所选时刻。',
    replayExit:'已回到实时。',
    replayReadout:(at,total)=>`${at} / ${total}`,
    gameOverReplay:'回放本次过程',
    controlShow:'显示', controlHide:'隐藏', controlShowAria:'显示干预控制台', controlHideAria:'隐藏干预控制台',
    fast:'即时反射：运行中', fastDesc:'秒级：压力感受器、化学感受器、自主神经', slowWait:'慢性调节：等待', slowFull:'慢性调节：完全参与', slowDesc:'20 秒后：RAAS、ADH、尿量、血容量',
    score:t=>`稳定 ${Math.round(t)} 秒`, scoreDesc:'越久保持正常，得分越高', speed:v=>`速度 ×${v}`, speedDesc:'模拟时间 / 真实时间；调高可加快变化，调低便于观察反馈。',
    detailTitle:'说明', detailText:'点击网络中的任意节点，或干预控制台中的任意参数卡，即可在此查看该参数的说明。',
    clinicTitle:'临床病情评估', clinicHint:'正确策略可改善，错误策略会加速恶化', noCondition:'当前未识别出明显综合征。保持主要指标在正常范围内即可。',
    rules:'',
    lensTitle:'观察时间尺度', autoOn:'自动', autoOff:'手动', slower:'放慢', faster:'加快',
    lensWindowLabel:'窗口',
    legend:['促进','抑制','正常','警戒','危险'], initLog:'正在连接后端仿真引擎。', started:'已连接后端仿真引擎。', zeroToast:'干预已归零，变量会根据反馈环路逐步恢复。', scenarioToast:'挑战已加载。尝试只用少量干预把系统带回稳态。',
    introTitle:'HomeoXNet', introSubtitle:'一个稳态网络模拟器', introBody:'<h3>一、自由干预</h3><ul><li>调节心血管、呼吸、肾脏、代谢和激素相关参数</li><li>观察神经、体液、内分泌及多器官反馈如何维持稳态</li><li>改变单个变量，探索其影响和代偿反应</li></ul><h3>二、疾病模拟</h3><ul><li>先选择疾病大类，再选择具体疾病，载入病理状态</li><li>识别异常指标、代偿方向和失代偿征象</li><li>选择合理干预，尝试用尽量少的措施恢复稳定</li></ul><p>两种模式可独立使用，也可在疾病模拟中继续干预。 <a class="intro-video-link" href="https://www.bilibili.com/video/BV1wpMA6eEn9" target="_blank" rel="noopener noreferrer">观看操作视频</a></p>', start:'开始模拟',
    customFilter:'自定义',
    customTitle:'自定义参数',
    customIntro:'选择希望保留在干预控制台中的参数。',
    customConfirm:'确认',
    customCancel:'取消',
    customSelectAll:'全选',
    customClearAll:'清空',
    customClose:'关闭自定义参数',
    controlWidthResizeLabel:'拖动调整干预控制台宽度\n双击隐藏/展开',
    networkHeightResizeLabel:'拖动调整稳态复杂网络高度\n双击隐藏/展开',
    severity:'严重度', helpful:'有利策略', harmful:'错误策略', relatedIn:'主要输入', relatedOut:'主要影响', knob:'当前干预', normal:'当前处于可代偿范围。', warn:'当前进入警戒区，反馈系统仍可缓冲，但长期维持会增加代偿负担。', danger:'当前越过危险边界，多个反馈环路可能转入失代偿。'
  },
  en: {
    title:'HomeoXNet',
    internalEdition:'(GMU Internal Edition; click <a href="https://www.kuaiyu.site/homeostasis/simulator.html?lang=en">here</a> for the public version)',
    subtitle:'Adjust parameters to observe multi-organ homeostatic feedback. Neural reflexes respond first, followed by humoral and endocrine regulation after about 20 simulated seconds. Persistent imbalance may lead to decompensation.',
    desktopHelpLink:'Detailed guide',
    desktopHelpTitle:'Detailed Desktop Guide',
    desktopHelpOpenNew:'Open in new window',
    desktopHelpClose:'Close detailed desktop guide',
    desktopHelpFallback:'If the PDF does not appear, use “Open in new window”.',
    mobileHelpLink:'Mobile instructions',
    mobileHelpBody:'<h2>Mobile instructions:</h2><h3>1. Free Intervention</h3><ul><li>Tap a node in the “Homeostasis Complex Network” to adjust its parameter nearby; tap × or outside the card to close it</li><li>Alternatively, use the bottom-right jump button to switch between the observation area and the full “Intervention Console”</li><li>Observe feedback in the network and the stability bar; the “Replay console” below can pause or replay the whole run at any time</li></ul><h3>2. Disease Simulation</h3><ul><li>Select a disease category, then a specific disease, to load its pathophysiological state</li><li>Use the network, the stability bar, and the clinical assessment to analyze abnormalities, compensation, and decompensation risk</li><li>Intervene through a node card or the Intervention Console and observe the response</li></ul><p>The two modes can be used independently; interventions also remain available after loading a disease.</p>',
    mobileHelpClose:'Close mobile instructions',
    creator:'<span class="creator-primary">Producer: <a class="creator-link" href="https://www.kuaiyu.site/" target="_blank" rel="noopener noreferrer">Yu Kuai</a>, Guizhou Medical University</span> <span class="creator-email">yukuai@gmc.edu.cn</span>',
    selectCategory:'Select major disorder', selectScenario:'Select specific disorder', selectDisease:'Select a disease', selectDiseaseAria:'Select a disease: choose a category, then a specific disorder', pause:'Pause', resume:'Resume', zero:'Zero interventions', zeroUnavailable:'No manual interventions are available to zero', restart:'Restart', switch:'中文', switchHref:'simulator.html?lang=zh',
    controlTitle:'Intervention Console', controlHint:'', networkTitle:'Homeostasis Complex Network', networkHint:'Node color: yellow/red high, cyan/blue low; brighter edges mean stronger influence', topologyLayout:'Imbalance Mechanism View', topologyLayoutAria:'Imbalance Mechanism View: rearrange network nodes around the current disease or homeostatic disturbance', topologyLayoutToast:'Imbalance Mechanism View is active. Use “Restore Network View” to return to the default layout.', resetLayout:'Restore Network View', resetLayoutAria:'Restore Network View: restore all nodes and system labels to their default positions and refit the view',
    logTitle:'Event Log', logHint:'Latest 8 entries', stability:'Stability',
    replayTitle:'Replay console', replayHiddenTag:'(hidden)', replayShow:'Show', replayHide:'Hide', replayShowAria:'Show the replay console', replayHideAria:'Hide the replay console',
    replaySpeedLabel:'Replay speed', replayPlay:'▶ Replay', replayPause:'⏸ Pause replay', replayToStart:'Back to start', replayToStartAria:'Jump to the start of this session', replayLive:'Back to live',
    replayHint:'Replay speed applies to this recording only; it does not change the time compression set in “Observation time scale”.',
    timeScaleLockedNote:'Replaying: the time scale follows the recording and cannot be changed.',
    replayScrubAria:'Replay position', replayEmpty:'Nothing to replay yet: no intervention has been made. Adjust a parameter or load a disease first.',
    replayEnter:'Replay engaged: the simulation is paused and the network, stability and guide panel all show the selected moment.',
    replayExit:'Back to live.',
    replayReadout:(at,total)=>`${at} / ${total}`,
    gameOverReplay:'Replay this session',
    controlShow:'Show', controlHide:'Hide', controlShowAria:'Show the Intervention Console', controlHideAria:'Hide the Intervention Console',
    fast:'Acute reflexes: active', fastDesc:'Seconds: baroreceptors, chemoreceptors, autonomic output', slowWait:'Chronic regulation: waiting', slowFull:'Chronic regulation: fully active', slowDesc:'After 20 s: RAAS, ADH, urine flow, blood volume',
    score:t=>`Stable ${Math.round(t)} s`, scoreDesc:'Longer normal range means higher score', speed:v=>`Speed ×${v}`, speedDesc:'Simulation time / real time; increase to accelerate changes, decrease to observe feedback more slowly.',
    detailTitle:'Guide', detailText:'Click any node in the network, or any parameter card in the intervention console, to read about that parameter here.',
    clinicTitle:'Clinical Pattern Assessment', clinicHint:'Correct strategies may improve; incorrect ones accelerate deterioration', noCondition:'No clear syndrome detected. Keep major parameters near the normal range.',
    rules:'',
    lensTitle:'Observation time scale', autoOn:'Auto', autoOff:'Manual', slower:'Slower', faster:'Faster',
    lensWindowLabel:'Window',
    legend:['Promote','Inhibit','Normal','Warning','Danger'], initLog:'Connecting to backend simulation engine.', started:'Backend simulation engine connected.', zeroToast:'Interventions are zeroed; feedback loops will attempt restoration.', scenarioToast:'Scenario loaded. Try small interventions to restore stability.',
    introTitle:'HomeoXNet', introSubtitle:'A HOMEOstasis compleX NETwork simulator', introBody:'<h3>1. Free Intervention</h3><ul><li>Adjust cardiovascular, respiratory, renal, metabolic, and hormonal variables</li><li>Observe how neural, humoral, endocrine, and multi-organ feedback maintain homeostasis</li><li>Change one variable at a time to explore its effects and compensatory responses</li></ul><h3>2. Disease Simulation</h3><ul><li>Select a disease category, then a specific disease, to load its pathophysiological state</li><li>Identify abnormal findings, compensatory responses, and signs of decompensation</li><li>Choose appropriate interventions and restore stability with as few measures as possible</li></ul><p>The modes can be used independently, or combined by intervening after a disease is loaded. <a class="intro-video-link" href="https://www.bilibili.com/video/BV1rpMA6YEZr" target="_blank" rel="noopener noreferrer">Watch the tutorial video</a></p>', start:'Start simulation',
    customFilter:'Custom',
    customTitle:'Custom Parameters',
    customIntro:'Choose which parameters remain visible in the Intervention Console.',
    customConfirm:'Confirm',
    customCancel:'Cancel',
    customSelectAll:'Select all',
    customClearAll:'Clear',
    customClose:'Close custom parameters',
    controlWidthResizeLabel:'Drag to resize the Intervention Console\nDouble-click to hide/show',
    networkHeightResizeLabel:'Drag to resize Homeostasis Complex Network height\nDouble-click to hide/show',
    severity:'Severity', helpful:'Helpful', harmful:'Harmful', relatedIn:'Inputs', relatedOut:'Outputs', knob:'Intervention', normal:'Currently within a compensable range.', warn:'Currently in a warning range. Feedback can still buffer it, but sustained stress increases load.', danger:'Currently beyond a danger boundary. Multiple feedback loops may decompensate.'
  }
}[lang];

Object.assign(TEXT, lang === 'zh' ? {
  gameOverTitle: '\u7a33\u6001\u5931\u8861',
  gameOverBody: '\u751f\u547d\u7a33\u5b9a\u5ea6\u5df2\u964d\u81f3 0\uff0c\u7cfb\u7edf\u8fdb\u5165\u5931\u4ee3\u507f\u3002\u4f60\u53ef\u4ee5\u505c\u6b62\u5e76\u4e0b\u8f7d\u672c\u6b21\u4f1a\u8bdd\u62a5\u544a\uff0c\u4e5f\u53ef\u4ee5\u5728\u4e0d\u518d\u5e72\u9884\u7684\u60c5\u51b5\u4e0b\u7ee7\u7eed\u89c2\u5bdf\u53cd\u9988\u6f14\u5316\u3002',
  gameOverRestart: '\u91cd\u65b0\u5f00\u59cb',
  gameOverDownload: '\u4e0b\u8f7d\u62a5\u544a',
  gameOverObserve: '\u7ee7\u7eed\u89c2\u5bdf',
  gameOverNoReason: '\u672a\u80fd\u8bc6\u522b\u5355\u4e00\u4e3b\u56e0\uff1b\u8bf7\u67e5\u770b\u5371\u9669\u6307\u6807\u548c\u53c2\u6570\u8d8b\u52bf\u3002',
  reportStopDownload: '\u505c\u6b62\u5e76\u4e0b\u8f7d\u62a5\u544a',
  reportDownload: '\u4e0b\u8f7d\u62a5\u544a',
  reportNoIntervention: '\u672c\u6b21\u4f1a\u8bdd\u4e2d\u5c1a\u672a\u8c03\u6574\u4efb\u4f55\u53c2\u6570\u6216\u5e94\u7528\u4efb\u4f55\u5e72\u9884\u3002',
  reportGenerating: '\u6b63\u5728\u751f\u6210\u62a5\u544a\u2026',
  reportReady: '\u4ea4\u4e92\u5f0f\u62a5\u544a\u5df2\u751f\u6210\u3002',
  reportError: '\u62a5\u544a\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002',
  aiChoiceTitle: '选择报告类型',
  aiChoiceBody: '普通报告会立即生成；AI 医学解读会分析本次学习行为及相关生理学与病理生理学知识。',
  aiChoiceWith: '报告 + AI 医学解读',
  aiChoiceWithout: '下载普通报告',
  aiChoiceCancel: '取消',
  aiQuotaConfirmTitle: '确认生成 AI 报告',
  aiQuotaPrefix: '因为算力原因，每个',
  aiQuotaUser: '用户',
  aiQuotaSuffix: '每日只能生成 3 份报告。你确定下载吗？',
  aiQuotaLoading: '正在查询今天的剩余次数…',
  aiQuotaRemaining: remaining=>`今天还可生成 ${remaining} 份 AI 报告。`,
  aiQuotaWaitingRemaining: remaining=>`本次生成后，今天还可生成 ${remaining} 份 AI 报告。`,
  aiQuotaExempt: '今天已豁免 AI 报告下载次数限制。',
  aiQuotaUnavailable: '暂时无法读取次数；如果 AI 调用失败，将直接下载普通报告。',
  aiQuotaExhausted: '今天的 3 次 AI 报告额度已用完。',
  aiSuppressReminder: '不再提醒',
  aiQuotaConfirm: '确定',
  aiQuotaDirect: '不，只下载普通报告',
  aiQuotaBack: '返回',
  aiExemptNotice: '你已豁免AI报告下载次数限制',
  aiExemptClose: '关闭',
  aiWaitingTitle: 'AI 正在进行医学解读',
  aiWaitingBody: '请保持页面开启，预计需要 1–2 分钟。若模型超时或调用失败，系统会自动下载不含 AI 解读的原报告。',
  aiReportReady: '包含 AI 医学解读的报告已生成。',
  aiFallbackDownloaded: 'AI 解读未完成，已自动下载原报告。',
  restartReportTitle: '\u4f1a\u8bdd\u62a5\u544a\u5c1a\u672a\u4e0b\u8f7d',
  restartReportBody: '\u5f53\u524d\u4f1a\u8bdd\u6b63\u5728\u8fdb\u884c\uff0c\u4f60\u5c1a\u672a\u4e0b\u8f7d\u62a5\u544a\u3002\u662f\u5426\u5148\u4e0b\u8f7d\u62a5\u544a\u518d\u91cd\u65b0\u5f00\u59cb\uff1f',
  restartDownload: '\u4e0b\u8f7d\u62a5\u544a\u5e76\u91cd\u65b0\u5f00\u59cb',
  restartWithoutDownload: '\u4e0d\u4e0b\u8f7d\uff0c\u76f4\u63a5\u91cd\u65b0\u5f00\u59cb',
  restartClose: '\u5173\u95ed\u5e76\u7ee7\u7eed\u5f53\u524d\u4f1a\u8bdd',
  wechatReportTitle: '\u5fae\u4fe1\u4e2d\u7684\u62a5\u544a\u4fdd\u5b58',
  wechatReportBody: '\u5fae\u4fe1\u5185\u7f6e\u6d4f\u89c8\u5668\u4e0d\u5141\u8bb8\u7f51\u9875\u76f4\u63a5\u4e0b\u8f7d HTML \u6587\u4ef6\u3002\u62a5\u544a\u5df2\u751f\u6210\u4e3a\u4e34\u65f6\u5b89\u5168\u94fe\u63a5\uff0c\u53ef\u5728\u5fae\u4fe1\u4e2d\u76f4\u63a5\u67e5\u770b\u3002\u5982\u9700\u4fdd\u5b58\u6587\u4ef6\uff0c\u8bf7\u70b9\u51fb\u53f3\u4e0a\u89d2 \u2026 \u9009\u62e9\u201c\u5728\u6d4f\u89c8\u5668\u6253\u5f00\u201d\uff0c\u6216\u590d\u5236\u94fe\u63a5\u5230\u7cfb\u7edf\u6d4f\u89c8\u5668\u3002\u94fe\u63a5 1 \u5c0f\u65f6\u540e\u5931\u6548\u3002',
  wechatReportOpen: '\u5728\u5fae\u4fe1\u4e2d\u67e5\u770b\u62a5\u544a',
  wechatReportCopy: '\u590d\u5236\u62a5\u544a\u94fe\u63a5',
  wechatReportCopied: '\u62a5\u544a\u94fe\u63a5\u5df2\u590d\u5236\u3002',
  wechatReportClose: '\u5173\u95ed',
  paramIntroLabel: '参数介绍',
  paramMeaningLabel: '临床意义',
  // Learning modes. Each mode is named by the question it answers, and the question is shown
  // next to the name, because the question is what tells a learner whether this mode is theirs.
  modeLabel: '学习模式',
  modeSwitchAria: '切换学习模式',
  modes: {
    trace: {name:'基础学习：单系统环路'},
    full: {name:'高级学习：复杂网络'}
  },
  modeSwitched: name=>`已切换到「${name}」。`,
  modeTraceNotice: '本模式不计生命稳定度：可以随意扰动，不会失代偿，也不会死亡。',
  modeTraceLensNotice: '本模式固定在秒级镜头——一条反射环路的故事发生在几秒之内。',
  // Guided perturbations (mode A)
  guidedTitle: '选一个扰动',
  guidedHint: '每个扰动只动一条环路',
  guidedQuestionLabel: '要回答的问题',
  guidedApply: '施加',
  guidedReapply: '再来一次',
  guidedActive: '进行中',
  guidedClear: '全部归零',
  guidedClearedToast: '已归零。反馈环路会把各变量带回基线。',
  guidedWatch: '要追的链条',
  lessonSystems: {cv:'心血管', resp:'呼吸与酸碱', renal:'肾脏与体液', meta:'代谢'},
  lessonKinds: {feedback:'反馈环路', disease:'疾病过程'},
  lessonSourceLabel: '教材',
  lessonLensNote: lens=>`本节固定在${lens}——这条环路最慢的一支就在这个尺度上。`,
  lessonInactiveHint: '灰色节点＝尚未变化。看着颜色沿环路一个个亮起来，那就是反馈在传播。',
  lessonNodesHidden: n=>`只显示本环路的 ${n} 个节点，其余已隐藏。`,
  lessons: {
    baroreflexFall: {
      label: '失血时的压力感受器反射',
      question: '先动的是哪个？再动的是哪个？为什么是这个顺序？',
      focus: '血容量↓ → 静脉回流↓ → 每搏量↓ → 心输出量↓ → 平均动脉压↓ → 压力感受器放电↓ → 交感↑、迷走↓ → 心率↑、外周阻力↑ → 血压回升',
      source: 'Guyton & Hall《医学生理学》第 18 章：动脉压的神经调节；《生理学》（人卫）循环系统—压力感受性反射'
    },
    baroreflexRise: {
      label: '升压时的压力感受器反射（同一环路反向）',
      question: '血压升高之后，心率往哪个方向走？是什么让它这样走？',
      focus: '外周阻力↑ → 平均动脉压↑ → 压力感受器放电↑ → 迷走↑、交感↓ → 心率↓、心肌收缩力↓ → 血压回落',
      source: 'Guyton & Hall 第 18 章：压力感受性反射的缓冲功能（双向）'
    },
    hemorrhagicShock: {
      label: '失血性休克：从代偿到失代偿',
      question: '哪些指标先被代偿"藏"起来了？血压是第几个才掉下去的？乳酸为什么会升？',
      focus: '持续失血 → 交感↑、外周阻力↑ 先把血压撑住（代偿期）→ 组织供氧仍不足 → 乳酸↑ → 心肌收缩力↓ → 心输出量进一步↓（失代偿，正反馈）',
      source: 'Guyton & Hall 第 24 章：循环性休克—代偿期、进展期与不可逆期；《病理生理学》（人卫）休克'
    },
    chemoreflex: {
      label: '主动过度通气',
      question: 'PaCO₂ 和 pH 谁先变？变到什么程度化学感受驱动才会反过来压制通气？',
      focus: '通气↑ → PaCO₂↓ → pH↑ → 中枢化学感受器驱动↓ → 通气↓（回到原位）',
      source: 'Guyton & Hall 第 42 章：呼吸调节—中枢化学感受器对 CO₂/H⁺ 的敏感性'
    },
    hypoxicDrive: {
      label: '低氧驱动',
      question: '低氧先让哪一个动起来：通气还是心率？组织供氧最后补回来了吗？',
      focus: 'PaO₂↓ → 外周化学感受器（颈动脉体）驱动↑ → 通气↑、心率↑ → 组织供氧部分恢复；若仍不足则乳酸↑',
      source: 'Guyton & Hall 第 42 章：外周化学感受器；低氧对通气的驱动在 PaO₂ < 60 mmHg 后才明显'
    },
    respiratoryAcidosis: {
      label: '低通气 → 呼吸性酸中毒',
      question: 'PaCO₂ 升高后 pH 掉了多少？HCO₃⁻ 动了吗——它需要多久才动得起来？',
      focus: '通气↓ → PaCO₂↑ → H₂CO₃↑ → pH↓（急性）；细胞内缓冲数分钟内小幅提升 HCO₃⁻，而肾脏排酸再生 HCO₃⁻ 需 3～5 天',
      source: 'Guyton & Hall 第 31 章：酸碱调节—急性与慢性呼吸性酸中毒；《病理生理学》酸碱平衡紊乱'
    },
    raasVolume: {
      label: '血容量下降如何启动 RAAS',
      question: '肾素、血管紧张素 II、醛固酮是同时动的吗？谁最慢？尿量往哪边走？',
      focus: '血容量↓ → 肾灌注↓ → 肾素↑ → 血管紧张素 II↑（缩血管、升压）→ 醛固酮↑ → 保钠保水、尿量↓ → 血容量回升',
      source: 'Guyton & Hall 第 19 章：肾—体液系统与 RAAS 对长期血压的控制；《生理学》肾脏功能'
    },
    adhOsmolality: {
      label: '高钠如何触发 ADH',
      question: '渗透压和血钠谁先变？ADH 升高之后，尿量与血容量各往哪边走？',
      focus: '血钠↑ → 血浆渗透压↑ → 下丘脑渗透压感受器 → ADH↑ → 集合管重吸收水↑ → 尿量↓、渗透压回落',
      source: 'Guyton & Hall 第 28 章：尿液浓缩与稀释、ADH 的渗透压调节；《生理学》水平衡'
    },
    dehydration: {
      label: '脱水 → 高渗性高钠血症',
      question: '为什么血钠先升，而血压很久才掉？这说明容量丢失主要来自哪个间隙？',
      focus: '失水 > 失钠 → 血浆渗透压↑、血钠↑ → ADH↑、口渴 → 尿量↓；细胞外容量继续丢失后血压才开始下降',
      source: 'Guyton & Hall 第 25 章：细胞外液渗透压与容量的调节；《病理生理学》水、电解质代谢紊乱'
    },
    insulinGlucose: {
      label: '血糖升高如何被拉回来',
      question: '胰岛素升高之后血糖多久开始下降？胰高血糖素这时在做什么？',
      focus: '血糖↑ → β 细胞分泌胰岛素↑ → 组织摄取葡萄糖↑、肝糖输出↓ → 血糖↓ → 胰岛素回落（同时胰高血糖素被抑制）',
      source: 'Guyton & Hall 第 79 章：胰岛素、胰高血糖素与血糖的负反馈调节；《生理学》内分泌'
    },
    hypoglycemia: {
      label: '胰岛素过量 → 低血糖',
      question: '血糖掉下去以后，身体的第一反应是什么？为什么会心慌、出汗、心率快？',
      focus: '胰岛素过量 → 血糖↓ → 胰高血糖素↑、交感↑（肾上腺素）→ 心率↑、糖原分解↑ → 试图把血糖拉回；这正是低血糖的交感症状来源',
      source: 'Guyton & Hall 第 79 章：低血糖的反调节激素反应；《病理生理学》糖代谢紊乱'
    }
  },
  // Inline caution while dragging
  cautionLabel: '注意',
  rightPanelResizeLabel: '拖动调整右栏宽度\n双击隐藏/展开',
  gameOverFastNote: '稳定度下降过快，可能是因为使用了手动时间尺度。请在右侧「观察时间尺度」选择「自动」后重试。'
} : {
  gameOverTitle: 'Homeostasis Failure',
  gameOverBody: 'Life stability has reached 0 and the system has decompensated. Stop and download this session report, or continue observing feedback without further intervention.',
  gameOverRestart: 'Restart',
  gameOverDownload: 'Download Report',
  gameOverObserve: 'Continue observing',
  gameOverNoReason: 'No single dominant cause was detected; review the danger indicators and parameter trends.',
  reportStopDownload: 'Stop and Download Report',
  reportDownload: 'Download Report',
  reportNoIntervention: 'You have not adjusted any parameters or applied any interventions during this session.',
  reportGenerating: 'Generating report…',
  reportReady: 'The interactive report is ready.',
  reportError: 'Report generation failed. Please try again.',
  aiChoiceTitle: 'Choose a report type',
  aiChoiceBody: 'The standard report is generated immediately. AI interpretation also analyzes learning behavior, physiology, and pathophysiology.',
  aiChoiceWith: 'Report + AI Interpretation',
  aiChoiceWithout: 'Download Standard Report',
  aiChoiceCancel: 'Cancel',
  aiQuotaConfirmTitle: 'Confirm AI report',
  aiQuotaPrefix: 'Due to limited computing capacity, each ',
  aiQuotaUser: 'user',
  aiQuotaSuffix: ' may generate only 3 AI reports per day. Continue?',
  aiQuotaLoading: 'Checking today’s remaining allowance…',
  aiQuotaRemaining: remaining=>`${remaining} AI report(s) remain today.`,
  aiQuotaWaitingRemaining: remaining=>`${remaining} AI report(s) will remain after this request.`,
  aiQuotaExempt: 'The AI report limit is waived for today.',
  aiQuotaUnavailable: 'The allowance is temporarily unavailable. If AI fails, the standard report will download.',
  aiQuotaExhausted: 'Today’s allowance of 3 AI reports has been used.',
  aiSuppressReminder: 'Do not remind me again',
  aiQuotaConfirm: 'Confirm',
  aiQuotaDirect: 'No, download standard report only',
  aiQuotaBack: 'Back',
  aiExemptNotice: 'Your AI report download limit has been waived',
  aiExemptClose: 'Close',
  aiWaitingTitle: 'AI medical interpretation in progress',
  aiWaitingBody: 'Keep this page open for approximately 1–2 minutes. If the model times out or fails, the original report will download automatically without AI interpretation.',
  aiReportReady: 'The report with AI medical interpretation is ready.',
  aiFallbackDownloaded: 'AI interpretation was unavailable; the original report was downloaded.',
  restartReportTitle: 'Session report not downloaded',
  restartReportBody: 'A session is in progress and you have not downloaded its report. Download the report before restarting?',
  restartDownload: 'Download Report and Restart',
  restartWithoutDownload: 'Restart Without Downloading',
  restartClose: 'Close and continue the current session',
  wechatReportTitle: 'Saving a report in WeChat',
  wechatReportBody: 'The WeChat in-app browser blocks direct HTML file downloads. Your report is available through a temporary secure link that opens inside WeChat. To save the file, use the top-right menu and choose “Open in Browser”, or copy the link into your system browser. The link expires in 1 hour.',
  wechatReportOpen: 'View Report in WeChat',
  wechatReportCopy: 'Copy Report Link',
  wechatReportCopied: 'Report link copied.',
  wechatReportClose: 'Close',
  paramIntroLabel: 'Parameter',
  paramMeaningLabel: 'Clinical meaning',
  modeLabel: 'Learning mode',
  modeSwitchAria: 'Switch learning mode',
  modes: {
    trace: {name:'Basic: one loop, one system'},
    full: {name:'Advanced: the complex network'}
  },
  modeSwitched: name=>`Switched to "${name}".`,
  modeTraceNotice: 'Nothing is scored in this mode: perturb freely, nothing decompensates and nobody dies.',
  modeTraceLensNotice: 'This mode stays on the seconds lens — one reflex loop is a story that happens within a few seconds.',
  guidedTitle: 'Pick a perturbation',
  guidedHint: 'Each one moves a single loop',
  guidedQuestionLabel: 'The question to answer',
  guidedApply: 'Apply',
  guidedReapply: 'Apply again',
  guidedActive: 'Running',
  guidedClear: 'Zero everything',
  guidedClearedToast: 'Zeroed. The feedback loops will carry the variables back to baseline.',
  guidedWatch: 'The chain to follow',
  lessonSystems: {cv:'Cardiovascular', resp:'Respiratory & acid-base', renal:'Renal & fluid', meta:'Metabolic'},
  lessonKinds: {feedback:'Feedback loop', disease:'Disease process'},
  lessonSourceLabel: 'Textbook',
  lessonLensNote: lens=>`This lesson stays on the ${lens} — that is where the slowest limb of this loop lives.`,
  lessonInactiveHint: 'Grey nodes have not moved yet. Watch the colour spread around the loop: that is the feedback propagating.',
  lessonNodesHidden: n=>`Showing only this loop's ${n} nodes; the rest are hidden.`,
  lessons: {
    baroreflexFall: {
      label: 'The baroreflex during blood loss',
      question: 'Which moves first? Which moves next? Why in that order?',
      focus: 'Blood volume↓ → venous return↓ → stroke volume↓ → cardiac output↓ → MAP↓ → baroreceptor firing↓ → sympathetic↑, vagal↓ → heart rate↑, resistance↑ → pressure recovers',
      source: 'Guyton & Hall, Textbook of Medical Physiology, Ch. 18: nervous regulation of arterial pressure'
    },
    baroreflexRise: {
      label: 'The baroreflex during a pressure rise (same loop, reversed)',
      question: 'Once pressure rises, which way does heart rate go — and what makes it go that way?',
      focus: 'Resistance↑ → MAP↑ → baroreceptor firing↑ → vagal↑, sympathetic↓ → heart rate↓, contractility↓ → pressure falls back',
      source: 'Guyton & Hall Ch. 18: the baroreceptor buffer function works in both directions'
    },
    hemorrhagicShock: {
      label: 'Haemorrhagic shock: compensation, then decompensation',
      question: 'Which numbers does compensation hide at first? How late does blood pressure fall? Why does lactate rise?',
      focus: 'Ongoing blood loss → sympathetic↑ and resistance↑ hold pressure up (compensated stage) → tissue oxygen delivery still short → lactate↑ → contractility↓ → cardiac output falls further (decompensation, positive feedback)',
      source: 'Guyton & Hall Ch. 24: circulatory shock — compensated, progressive and irreversible stages'
    },
    chemoreflex: {
      label: 'Voluntary hyperventilation',
      question: 'Does PaCO₂ or pH move first? How far must they go before chemoreceptor drive pushes back?',
      focus: 'Ventilation↑ → PaCO₂↓ → pH↑ → central chemoreceptor drive↓ → ventilation↓ (returns to baseline)',
      source: 'Guyton & Hall Ch. 42: regulation of respiration — central chemoreceptor sensitivity to CO₂/H⁺'
    },
    hypoxicDrive: {
      label: 'Hypoxic drive',
      question: 'What does hypoxia move first, ventilation or heart rate? Does tissue oxygen delivery catch up?',
      focus: 'PaO₂↓ → peripheral (carotid body) chemoreceptor drive↑ → ventilation↑, heart rate↑ → tissue oxygen partly restored; if still short, lactate↑',
      source: 'Guyton & Hall Ch. 42: peripheral chemoreceptors — hypoxic drive becomes significant below a PaO₂ of about 60 mmHg'
    },
    respiratoryAcidosis: {
      label: 'Hypoventilation → respiratory acidosis',
      question: 'How far does pH fall as PaCO₂ rises? Does HCO₃⁻ move — and how long would it need?',
      focus: 'Ventilation↓ → PaCO₂↑ → carbonic acid↑ → pH↓ (acute); non-bicarbonate buffers raise HCO₃⁻ slightly within minutes, while renal acid excretion and HCO₃⁻ regeneration need 3–5 days',
      source: 'Guyton & Hall Ch. 31: acid-base regulation — acute versus chronic respiratory acidosis'
    },
    raasVolume: {
      label: 'How a falling blood volume starts RAAS',
      question: 'Do renin, angiotensin II and aldosterone move together? Which is slowest? Which way does urine flow go?',
      focus: 'Blood volume↓ → renal perfusion↓ → renin↑ → angiotensin II↑ (vasoconstriction, pressure↑) → aldosterone↑ → sodium and water retained, urine↓ → volume recovers',
      source: 'Guyton & Hall Ch. 19: the renal-body fluid system and RAAS in long-term pressure control'
    },
    adhOsmolality: {
      label: 'How a sodium rise triggers ADH',
      question: 'Which moves first, osmolality or sodium? Once ADH rises, which way do urine flow and volume go?',
      focus: 'Sodium↑ → plasma osmolality↑ → hypothalamic osmoreceptors → ADH↑ → collecting-duct water reabsorption↑ → urine↓, osmolality falls back',
      source: 'Guyton & Hall Ch. 28: urine concentration and dilution; osmoreceptor-ADH control'
    },
    dehydration: {
      label: 'Dehydration → hypertonic hypernatraemia',
      question: 'Why does sodium rise long before blood pressure falls? What does that tell you about which compartment is losing fluid?',
      focus: 'Water loss exceeds sodium loss → plasma osmolality↑, sodium↑ → ADH↑ and thirst → urine↓; pressure only falls once extracellular volume has been depleted further',
      source: 'Guyton & Hall Ch. 25: regulation of extracellular fluid osmolarity and volume'
    },
    insulinGlucose: {
      label: 'How a glucose rise is brought back down',
      question: 'How long after insulin rises does glucose start to fall? What is glucagon doing meanwhile?',
      focus: 'Glucose↑ → β-cell insulin secretion↑ → tissue uptake↑, hepatic output↓ → glucose↓ → insulin falls back (with glucagon suppressed throughout)',
      source: 'Guyton & Hall Ch. 79: insulin, glucagon and the negative-feedback control of blood glucose'
    },
    hypoglycemia: {
      label: 'Insulin excess → hypoglycaemia',
      question: 'Once glucose falls, what responds first? Why do palpitations, sweating and tachycardia appear?',
      focus: 'Insulin excess → glucose↓ → glucagon↑ and sympathetic (adrenergic) drive↑ → heart rate↑, glycogenolysis↑, trying to pull glucose back — which is exactly where the adrenergic symptoms of hypoglycaemia come from',
      source: 'Guyton & Hall Ch. 79: counter-regulatory hormone response to hypoglycaemia'
    }
  },
  cautionLabel: 'Careful',
  rightPanelResizeLabel: 'Drag to resize the right column\nDouble-click to hide/show',
  gameOverFastNote: 'Stability fell too fast to follow, most likely because the time scale was set manually. Switch “Observation time scale” back to automatic and try again.'
});

// ---------------------------------------------------------------------------------------
// Learning modes
// ---------------------------------------------------------------------------------------
// The app models time scales, compensation timelines and vicious cycles. That is
// pathophysiology-level reasoning, and handing all of it to someone who has not yet built
// clinical reasoning does not teach them faster - it just gives them more to ignore.
//
// The split is by THE QUESTION THE LEARNER CAN ALREADY ASK, never by who they say they are.
// Asking at the door whether someone is a student or a professional is a status question: it
// gets answered aspirationally, and it predicts nothing anyway, because a second-year and a
// fifth-year both answer "student". A question, by contrast, is self-selecting - you can tell
// whether you are currently able to ask it. For the same reason no mode is ever labelled by
// level: nobody clicks "beginner".
//
//   trace       what is connected to what? which one moves first?   (physiology)
//
// A third mode, "compensation and its limits", existed between 2026-07-30 and 2026-08-01. It was
// removed with the compensation-timeline panel it was built around: once that panel went, the
// mode offered nothing the full console did not, which is precisely why it read as confusing.
// ?mode=compensate now falls back to the full console rather than 404-ing an assigned link.
//   full        the unrestricted console, which is what the app was before modes existed
//
// The mode lives in the URL alongside ?lang= so a teacher can set a specific link as
// coursework, and it is switchable mid-session so nobody has to restart to change question.
const LEARNING_MODES = {
  trace: {
    id:'trace',
    lockLens:'lesson',       // each lesson locks the lens to the scale its slowest limb needs
    autoLens:false,
    noThreat:true,           // see the CRITICAL note in applyLearningMode
    showStability:false,
    showScenarioPicker:false,
    showGuided:true,
    caution:true,
    controls:'guided',       // roughly six sliders, chosen by the active lesson
    slowDefault:true,        // beginners need to see one node move before the next does
    greyUntouched:true
  },
  full: {
    id:'full',
    lockLens:null,
    autoLens:true,
    noThreat:false,
    showStability:true,
    compensationPrimary:false,
    showScenarioPicker:true,
    showGuided:false,
    caution:false,           // the full console is for learners who no longer need the guard rail
    controls:'all',
    greyUntouched:true       // start grey, light up on contact, and stay lit
  }
};
const MODE_ORDER = ['trace','full'];
const DEFAULT_MODE = 'full';
function normalizeMode(value){
  const id=String(value || '').trim().toLowerCase();
  return MODE_ORDER.includes(id) ? id : DEFAULT_MODE;
}
// An explicit ?mode= in the link always wins - that is what makes a link assignable as
// coursework. Only when the link says nothing does the remembered choice apply, so a teacher's
// link never quietly opens in whatever mode the student last used.
const LEARNING_MODE_KEY = 'homeostasis_learning_mode_v1';
function rememberedMode(){
  try{ return window.localStorage?.getItem(LEARNING_MODE_KEY) || ''; }catch(_){ return ''; }
}
function storeMode(id){
  try{ window.localStorage?.setItem(LEARNING_MODE_KEY, id); }catch(_){ }
}
let activeMode = qs.has('mode') ? normalizeMode(qs.get('mode')) : normalizeMode(rememberedMode());
function modeConfig(){ return LEARNING_MODES[activeMode] || LEARNING_MODES.full; }

// The lessons that replace the scenario picker in "trace one loop".
//
// Each lesson is ONE loop in ONE system, and the network is cut down to that loop's own nodes
// while it runs. Thirty-four nodes is the right picture for someone who already knows which
// ones matter and the wrong picture for someone learning what a feedback loop is - the second
// learner cannot tell the loop from the background, so there is no loop on screen at all.
//
// Every lesson carries a QUESTION rather than an instruction. "Lower blood volume by 20%" is a
// task to complete; "which moves first, which moves next, and why in that order" is the thing
// being learned. `steps` spells out the chain the learner should be able to read off the
// network afterwards, and `source` names where it is taught, so the app agrees with the course.
//
// `lens` is per lesson, not global. Locking the whole mode to seconds was right for a reflex
// and wrong for RAAS: a loop whose slowest limb is hours cannot be watched at one second per
// second, and a beginner told to wait would conclude the model was broken. The lens is still
// locked - there are no tabs to fiddle with - it is just locked to the scale the lesson needs.
//
// Magnitudes are calibrated against the engine, so the labels are true: -78 on blood volume
// lands at about 3.9 L, which is the 20% the label claims.
const LESSON_SYSTEMS = ['cv','resp','renal','meta'];
const LESSONS = [
  // --- Cardiovascular -----------------------------------------------------------------
  // The baroreflex arc, taught in both directions. Running the SAME loop the other way is the
  // point of the pair: negative feedback is not "the thing that pushes pressure up", it is the
  // thing that pushes pressure back, whichever side it started on.
  {id:'baroreflexFall', system:'cv', kind:'feedback', lens:'seconds',
   nodes:['bloodVolume','venousReturn','sv','co','map','symp','vagal','hr','tpr'],
   controls:['bloodVolume','map','symp','vagal','hr','tpr'],
   apply:{bloodVolume:-78}},
  {id:'baroreflexRise', system:'cv', kind:'feedback', lens:'seconds',
   nodes:['tpr','map','symp','vagal','hr','co','sv','contractility'],
   controls:['tpr','map','vagal','symp','hr','co'],
   apply:{tpr:55}},
  {id:'hemorrhagicShock', system:'cv', kind:'disease', lens:'minutes', scenario:'hemorrhage',
   nodes:['bloodVolume','venousReturn','co','map','symp','hr','tpr','tissueO2','lactate'],
   controls:['bloodVolume','map','tpr','contractility','hr','tissueO2']},

  // --- Respiratory --------------------------------------------------------------------
  {id:'chemoreflex', system:'resp', kind:'feedback', lens:'seconds',
   nodes:['ventilation','paCO2','pH','chemo','paO2'],
   controls:['ventilation','paCO2','pH','chemo','paO2'],
   apply:{ventilation:55}},
  // Heart rate was listed here until 2026-08-02 and was drawn as a circle with no lines on it:
  // its only edges are hr->co, symp->hr and vagal->hr, and none of those three nodes is in this
  // lesson. Hypoxic tachycardia is real, but the model routes it through the sympathetic limb,
  // so showing HR without symp shows a claim the diagram cannot support - under a caption that
  // reads "呼吸酸碱". Teaching that limb properly belongs to a cardiovascular lesson.
  {id:'hypoxicDrive', system:'resp', kind:'feedback', lens:'seconds',
   nodes:['paO2','chemo','ventilation','tissueO2','lactate'],
   controls:['paO2','chemo','ventilation','tissueO2','lactate'],
   apply:{paO2:-70}},
  {id:'respiratoryAcidosis', system:'resp', kind:'disease', lens:'minutes', scenario:'co2',
   nodes:['ventilation','paCO2','pH','bicarbonate','chemo','paO2'],
   controls:['ventilation','airway','paCO2','pH','bicarbonate','chemo']},

  // --- Renal and fluid ----------------------------------------------------------------
  // Plasma sodium is deliberately NOT in this loop's node set. Aldosterone retains sodium and
  // water together, so the concentration barely moves - measured, it never crosses the activity
  // threshold even after 40 simulated minutes. A node that stays grey for the whole lesson
  // teaches nothing except that the diagram is unreliable.
  {id:'raasVolume', system:'renal', kind:'feedback', lens:'minutes',
   nodes:['bloodVolume','map','renin','angII','aldosterone','urine','gfr'],
   controls:['bloodVolume','map','renin','angII','aldosterone','urine'],
   apply:{bloodVolume:-60}},
  {id:'adhOsmolality', system:'renal', kind:'feedback', lens:'minutes',
   nodes:['sodium','osm','adh','urine','bloodVolume'],
   controls:['sodium','osm','adh','urine','bloodVolume','gfr'],
   apply:{sodium:62}},
  {id:'dehydration', system:'renal', kind:'disease', lens:'hours', scenario:'dehydration',
   nodes:['bloodVolume','sodium','osm','adh','urine','map'],
   controls:['bloodVolume','sodium','osm','adh','urine','map']},

  // --- Metabolic ----------------------------------------------------------------------
  {id:'insulinGlucose', system:'meta', kind:'feedback', lens:'minutes',
   nodes:['glucose','insulin','glucagon'],
   controls:['glucose','insulin','glucagon','metDemand','tissueO2','lactate'],
   apply:{glucose:70}},
  {id:'hypoglycemia', system:'meta', kind:'disease', lens:'minutes', scenario:'insulin',
   nodes:['insulin','glucose','glucagon','symp','hr'],
   controls:['insulin','glucose','glucagon','symp','hr','metDemand']}
];
function lessonById(id){ return LESSONS.find(l => l.id === id) || null; }
// Every node any lesson in a system touches. Picking a system is itself a choice worth showing:
// the console and the network retarget to that system immediately, so a learner can look around
// it before committing to a lesson, instead of staring at the previous system until they do.
//
// A lesson may legitimately reach across systems - blood volume is renal and is the whole point
// of the baroreflex lesson - so the union is by connectivity, not by group. The invariant that
// matters is stated on LESSONS: every node a lesson lists must have an edge to another node in
// the same list, or it is drawn as a line-less circle with no way to tell why it is there.
function systemNodeKeys(system){
  const keys=new Set();
  LESSONS.filter(l => l.system === system).forEach(l => l.nodes.forEach(k => keys.add(k)));
  return keys;
}
function systemControlKeys(system){
  const keys=new Set();
  LESSONS.filter(l => l.system === system).forEach(l => l.controls.forEach(k => keys.add(k)));
  return keys;
}
let activeLesson = null;
let activeLessonSystem = LESSON_SYSTEMS[0];

const PARAM_CLINICAL = {
  zh: {
    map:{intro:'平均动脉压反映器官灌注压力，是血流进入重要器官的核心指标。', meaning:'过低提示休克或低灌注，过高会增加心脑肾负担。'},
    hr:{intro:'心率反映自主神经和代谢需求对心脏节律的调节。', meaning:'过快或过慢都可降低有效心排量并诱发不稳定。'},
    sv:{intro:'每搏量是单次心搏射出的血量，受前负荷、后负荷和收缩力影响。', meaning:'下降提示泵血不足或回心血量不足。'},
    co:{intro:'心输出量是每分钟泵血量，决定全身氧和营养输送。', meaning:'降低会导致组织低灌注、肾灌注下降和乳酸升高。'},
    tpr:{intro:'外周阻力反映小动脉张力，是血压的重要组成。', meaning:'过高加重心脏后负荷，过低可导致低血压。'},
    venousReturn:{intro:'静脉回流代表回到心脏的血量，是前负荷基础。', meaning:'下降常见于失血、脱水或静脉扩张。'},
    contractility:{intro:'心肌收缩力表示心脏把血射出的能力。', meaning:'下降可导致低心排和休克，过高会增加耗氧。'},
    rhythmStability:{intro:'心律稳定性反映心脏电活动能否维持有效泵血。', meaning:'钾异常、酸中毒和缺氧会降低稳定性。'},
    symp:{intro:'交感张力是快速应激反应，可提升心率、收缩力和血管张力。', meaning:'适度可代偿低压，过强会增加耗氧和心脏负荷。'},
    vagal:{intro:'迷走张力减慢心率，是压力反射的重要输出。', meaning:'过强可致心动过缓，过低常伴交感兴奋。'},
    chemo:{intro:'化学感受驱动感知 CO₂、pH 和氧合变化。', meaning:'增强提示通气需求上升或酸碱、氧合失衡。'},
    renin:{intro:'肾素启动 RAAS，常由低压、低容量或交感兴奋刺激。', meaning:'升高提示肾脏正尝试保钠保水和升压。'},
    angII:{intro:'Ang II 收缩血管并促进醛固酮和 ADH 反应。', meaning:'过高会升压和保容量，但也会加重后负荷。'},
    aldosterone:{intro:'醛固酮促进钠水潴留并促进排钾。', meaning:'过高可致容量负荷和低钾，过低易出现高钾。'},
    adh:{intro:'ADH 促进肾脏保水，受渗透压、低容量和低压调节。', meaning:'升高提示保水反应，可减少尿量并升高容量。'},
    bloodVolume:{intro:'血容量是循环系统的容量基础，决定回心血量和灌注。', meaning:'过低提示失血或脱水，过高提示容量负荷。'},
    gfr:{intro:'GFR 表示肾小球滤过能力，依赖肾灌注和肾内阻力。', meaning:'下降提示肾灌注不足或肾功能受压。'},
    urine:{intro:'尿量反映肾脏排水排钠能力和体液调节结果。', meaning:'过少提示保水或肾灌注低，过多可导致容量下降。'},
    osm:{intro:'血浆渗透压反映水和溶质平衡。', meaning:'升高常见于脱水、高钠或高糖，降低提示稀释状态。'},
    sodium:{intro:'血钠是细胞外液主要阳离子，决定渗透压。', meaning:'过高或过低都会影响神经功能和容量状态。'},
    potassium:{intro:'血钾影响心肌电活动、传导和肌肉兴奋性。', meaning:'高钾或低钾均可诱发心律失常。'},
    ventilation:{intro:'肺通气量决定 CO₂ 排出和氧气进入。', meaning:'不足会导致 CO₂ 潴留和酸中毒，过高可降低 CO₂。'},
    airway:{intro:'气道阻力反映气流进入肺泡的阻碍。', meaning:'升高会限制通气、降低氧合并升高 CO₂。'},
    paO2:{intro:'PaO₂ 反映动脉血氧合水平。', meaning:'下降提示低氧血症，可导致组织缺氧和乳酸升高。'},
    paCO2:{intro:'PaCO₂ 反映通气是否足以排出 CO₂。', meaning:'升高提示低通气，降低可见于过度通气。'},
    pH:{intro:'血液 pH 反映酸碱状态，受 CO₂、乳酸和 HCO₃⁻ 影响。', meaning:'酸中毒会抑制心肌并增加钾异常风险。'},
    bicarbonate:{intro:'HCO₃⁻ 是主要代谢性缓冲碱，由肾脏慢性调节。', meaning:'下降提示代谢性酸中毒缓冲消耗。'},
    glucose:{intro:'血糖是中枢和组织的重要能量来源。', meaning:'低血糖威胁脑功能，高血糖会增加渗透压和利尿。'},
    insulin:{intro:'胰岛素促进葡萄糖进入细胞，并推动钾进入细胞。', meaning:'过高可导致低血糖或低钾，过低会导致高血糖。'},
    glucagon:{intro:'胰高血糖素促进肝糖输出，是低糖时的反调节激素。', meaning:'升高提示升糖动员或应激反应。'},
    tissueO2:{intro:'组织供氧整合心排量、血氧和血细胞比容。', meaning:'下降提示缺氧或低灌注，常促进乳酸生成。'},
    lactate:{intro:'乳酸反映无氧代谢和组织氧供不足程度。', meaning:'升高提示低灌注、缺氧或代谢应激。'},
    hct:{intro:'血细胞比容反映携氧红细胞比例和血液浓缩程度。', meaning:'过低降低携氧，过高增加血液黏稠度。'},
    metDemand:{intro:'代谢需求表示组织耗氧和能量需求水平。', meaning:'升高会增加通气、心排和葡萄糖需求。'}
  },
  en: {
    map:{intro:'Mean arterial pressure reflects the perfusion pressure that drives blood into vital organs.', meaning:'Low MAP suggests shock or hypoperfusion; high MAP increases brain, heart, and kidney load.'},
    hr:{intro:'Heart rate reflects autonomic and metabolic control of cardiac rhythm.', meaning:'Too fast or too slow can reduce effective cardiac output and destabilize the system.'},
    sv:{intro:'Stroke volume is the blood ejected with each beat, shaped by preload, afterload, and contractility.', meaning:'A fall suggests impaired pumping or insufficient venous return.'},
    co:{intro:'Cardiac output is blood pumped per minute and determines oxygen and nutrient delivery.', meaning:'Low output causes hypoperfusion, renal stress, and rising lactate.'},
    tpr:{intro:'Total peripheral resistance reflects arteriolar tone and is a core component of blood pressure.', meaning:'High resistance raises afterload; low resistance can cause hypotension.'},
    venousReturn:{intro:'Venous return is the blood returning to the heart and forms the basis of preload.', meaning:'Low return is common with bleeding, dehydration, or venodilation.'},
    contractility:{intro:'Myocardial contractility describes how strongly the heart ejects blood.', meaning:'Low contractility can cause low output and shock; excessive drive raises oxygen demand.'},
    rhythmStability:{intro:'Rhythm stability reflects whether cardiac electrical activity can sustain effective pumping.', meaning:'Potassium shifts, acidosis, and hypoxia reduce stability.'},
    symp:{intro:'Sympathetic tone is a rapid stress response that raises rate, contractility, and vascular tone.', meaning:'Moderate activation compensates hypotension; excess raises oxygen demand and workload.'},
    vagal:{intro:'Vagal tone slows heart rate and is a major output of the baroreflex.', meaning:'Excess vagal tone may cause bradycardia; low tone often accompanies sympathetic activation.'},
    chemo:{intro:'Chemoreceptor drive senses CO₂, pH, and oxygenation changes.', meaning:'High drive indicates increased ventilatory need or acid-base/oxygen imbalance.'},
    renin:{intro:'Renin initiates RAAS and is stimulated by low pressure, low volume, or sympathetic tone.', meaning:'A rise means the kidney is trying to retain salt/water and raise pressure.'},
    angII:{intro:'Angiotensin II constricts vessels and promotes aldosterone and ADH responses.', meaning:'Excess raises pressure and volume but increases afterload.'},
    aldosterone:{intro:'Aldosterone promotes sodium and water retention while increasing potassium excretion.', meaning:'Excess can cause volume load and hypokalemia; deficiency favors hyperkalemia.'},
    adh:{intro:'ADH promotes renal water retention and responds to osmolality, low volume, and low pressure.', meaning:'A rise indicates water conservation, often reducing urine flow.'},
    bloodVolume:{intro:'Blood volume is the circulating capacity foundation for venous return and perfusion.', meaning:'Low volume suggests bleeding or dehydration; high volume suggests overload.'},
    gfr:{intro:'GFR reflects glomerular filtration and depends on renal perfusion and intrarenal tone.', meaning:'A fall suggests low renal perfusion or kidney stress.'},
    urine:{intro:'Urine flow reflects renal water/sodium excretion and the net fluid-regulation result.', meaning:'Low flow suggests water retention or poor perfusion; high flow can deplete volume.'},
    osm:{intro:'Plasma osmolality reflects the balance between water and dissolved solutes.', meaning:'High values suggest dehydration, hypernatremia, or hyperglycemia; low values suggest dilution.'},
    sodium:{intro:'Sodium is the main extracellular cation and a major determinant of osmolality.', meaning:'High or low sodium can affect neurologic function and volume status.'},
    potassium:{intro:'Potassium shapes myocardial electrical activity, conduction, and muscle excitability.', meaning:'Both high and low potassium can trigger arrhythmias.'},
    ventilation:{intro:'Ventilation determines CO₂ removal and oxygen entry into the lungs.', meaning:'Low ventilation causes CO₂ retention and acidosis; excess ventilation lowers CO₂.'},
    airway:{intro:'Airway resistance represents obstruction to airflow into the alveoli.', meaning:'Higher resistance limits ventilation, lowers oxygenation, and raises CO₂.'},
    paO2:{intro:'PaO₂ reflects arterial oxygenation.', meaning:'A fall indicates hypoxemia that can cause tissue hypoxia and lactate generation.'},
    paCO2:{intro:'PaCO₂ reflects whether ventilation is sufficient to eliminate CO₂.', meaning:'High PaCO₂ suggests hypoventilation; low PaCO₂ suggests hyperventilation.'},
    pH:{intro:'Blood pH reflects acid-base status, shaped by CO₂, lactate, and bicarbonate.', meaning:'Acidosis depresses myocardium and increases potassium-related risk.'},
    bicarbonate:{intro:'Bicarbonate is the main metabolic buffer and is chronically regulated by the kidney.', meaning:'A fall suggests buffering consumption in metabolic acidosis.'},
    glucose:{intro:'Glucose is a key energy source for the brain and tissues.', meaning:'Hypoglycemia threatens brain function; hyperglycemia raises osmolality and diuresis.'},
    insulin:{intro:'Insulin moves glucose into cells and shifts potassium intracellularly.', meaning:'Excess can cause hypoglycemia or hypokalemia; deficiency causes hyperglycemia.'},
    glucagon:{intro:'Glucagon promotes hepatic glucose output as a counter-regulatory hormone.', meaning:'A rise indicates glucose mobilization or stress response.'},
    tissueO2:{intro:'Tissue oxygen delivery integrates cardiac output, arterial oxygen, and hematocrit.', meaning:'A fall indicates hypoxia or hypoperfusion and often drives lactate production.'},
    lactate:{intro:'Lactate reflects anaerobic metabolism and insufficient oxygen delivery.', meaning:'Elevation suggests hypoperfusion, hypoxia, or metabolic stress.'},
    hct:{intro:'Hematocrit reflects the red-cell fraction and blood concentration.', meaning:'Low hematocrit reduces oxygen carrying capacity; high hematocrit raises viscosity.'},
    metDemand:{intro:'Metabolic demand represents tissue oxygen and energy requirements.', meaning:'Higher demand increases ventilation, cardiac output, and glucose needs.'}
  }
}[lang];

const TRUSTED_PARAM_LINKS = {
  hr:{label:'Mayo Clinic: Heart rate',url:'https://www.mayoclinic.org/healthy-lifestyle/fitness/expert-answers/heart-rate/faq-20057979'},
  hrTachy:{label:'Mayo Clinic: 心动过速',url:'https://www.mayoclinic.org/zh-hans/diseases-conditions/tachycardia/diagnosis-treatment/drc-20355133'},
  hrBrady:{label:'Mayo Clinic: 心动过缓',url:'https://www.mayoclinic.org/zh-hans/diseases-conditions/bradycardia/symptoms-causes/syc-20355474'},
  bp:{label:'Cleveland Clinic: Hypertension',url:'https://my.clevelandclinic.org/health/diseases/4314-hypertension-high-blood-pressure'},
  bpHigh:{label:'Mayo Clinic: 高血压',url:'https://www.mayoclinic.org/zh-hans/diseases-conditions/high-blood-pressure/symptoms-causes/syc-20373410'},
  bpLow:{label:'Mayo Clinic: 低血压',url:'https://www.mayoclinic.org/zh-hans/diseases-conditions/low-blood-pressure/symptoms-causes/syc-20355465'},
  gfr:{label:'Cleveland Clinic: GFR',url:'https://my.clevelandclinic.org/health/diagnostics/21624-glomerular-filtration-rate-gfr'},
  abg:{label:'MedlinePlus: Arterial blood gas',url:'https://medlineplus.gov/lab-tests/arterial-blood-gas-abg-test/'},
  spo2:{label:'Cleveland Clinic: Pulse oximetry',url:'https://my.clevelandclinic.org/health/diagnostics/17824-pulse-oximetry'},
  metabolicAcidosis:{label:'Cleveland Clinic: Metabolic acidosis',url:'https://my.clevelandclinic.org/health/diseases/24492-metabolic-acidosis'},
  lacticAcidosis:{label:'Cleveland Clinic: Lactic acidosis',url:'https://my.clevelandclinic.org/health/diseases/25066-lactic-acidosis'},
  acidBaseMsd:{label:'MSD Manual: 酸碱平衡',url:'https://www.msdmanuals.cn/professional/endocrine-and-metabolic-disorders/acid-base-regulation-and-disorders/acid-base-regulation'},
  electrolytes:{label:'MedlinePlus: Electrolyte panel',url:'https://medlineplus.gov/lab-tests/electrolyte-panel/'},
  sodium:{label:'MedlinePlus: Sodium blood test',url:'https://medlineplus.gov/lab-tests/sodium-blood-test/'},
  sodiumWaterMsd:{label:'MSD Manual: 水和钠平衡',url:'https://www.msdmanuals.cn/professional/endocrine-and-metabolic-disorders/fluid-metabolism/water-and-sodium-balance'},
  potassium:{label:'MedlinePlus: Potassium blood test',url:'https://medlineplus.gov/lab-tests/potassium-blood-test/'},
  potassiumHighMsd:{label:'MSD Manual: 高钾血症',url:'https://www.msdmanuals.cn/professional/endocrine-and-metabolic-disorders/electrolyte-disorders/hyperkalemia'},
  potassiumLowMsd:{label:'MSD Manual: 低钾血症',url:'https://www.msdmanuals.cn/professional/endocrine-and-metabolic-disorders/electrolyte-disorders/hypokalemia#%E7%97%85%E5%8E%9F%E5%AD%A6_v8375413_zh'},
  aldosterone:{label:'MedlinePlus: Aldosterone test',url:'https://medlineplus.gov/lab-tests/aldosterone-test/'},
  renin:{label:'MedlinePlus: Renin test',url:'https://medlineplus.gov/lab-tests/renin-test/'},
  raasMsd:{label:'MSD Manual: RAAS 调节血压',url:'https://www.msdmanuals.cn/home/multimedia/image/regulating-blood-pressure-the-renin-angiotensin-aldosterone-system'},
  osmolality:{label:'MedlinePlus: Osmolality tests',url:'https://medlineplus.gov/lab-tests/osmolality-tests/'},
  adhMsd:{label:'MSD Manual: 抗利尿激素',url:'https://www.msdmanuals.cn/professional/endocrine-and-metabolic-disorders/electrolyte-disorders/syndrome-of-inappropriate-adh-secretion-siadh'},
  bloodVolumeMsd:{label:'MSD Manual: 出血与血容量',url:'https://www.msdmanuals.cn/professional/hematology-and-oncology/hemostasis/excessive-bleeding#%E8%AF%8A%E6%96%AD_v971974_zh'},
  gfrMsd:{label:'MSD Manual: 慢性肾病',url:'https://www.msdmanuals.cn/professional/genitourinary-disorders/chronic-kidney-disease/chronic-kidney-disease'},
  urinePolyuriaMsd:{label:'MSD Manual: 多尿',url:'https://www.msdmanuals.cn/professional/genitourinary-disorders/symptoms-of-genitourinary-disorders/polyuria#%E7%97%85%E5%9B%A0_v1049455_zh'},
  urineOliguriaMsd:{label:'MSD Manual: 少尿',url:'https://www.msdmanuals.cn/professional/critical-care-medicine/approach-to-the-critically-ill-patient/oliguria'},
  ventilationMechanicsMsd:{label:'MSD Manual: 机械通气与呼吸力学',url:'https://www.msdmanuals.cn/professional/critical-care-medicine/respiratory-failure-and-mechanical-ventilation/overview-of-mechanical-ventilation#%E5%91%BC%E5%90%B8%E5%8A%9B%E5%AD%A6_v926939_zh'},
  hyperventilationMsd:{label:'MSD Manual: 过度通气综合征',url:'https://www.msdmanuals.cn/professional/pulmonary-disorders/symptoms-of-pulmonary-disorders/hyperventilation-syndrome?query=%E6%B0%94%E7%9F%AD'},
  dyspneaMsd:{label:'MSD Manual: 呼吸困难',url:'https://www.msdmanuals.cn/professional/pulmonary-disorders/symptoms-of-pulmonary-disorders/dyspnea?query=%E6%B0%94%E7%9F%AD'},
  glucose:{label:'MedlinePlus: Blood glucose test',url:'https://medlineplus.gov/lab-tests/blood-glucose-test/'},
  diabetes:{label:'MedlinePlus: Diabetes',url:'https://medlineplus.gov/diabetes.html'},
  diabetesMsd:{label:'MSD Manual: 糖尿病概述',url:'https://www.msdmanuals.cn/professional/endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/overview-of-diabetes-mellitus?query=%E7%B3%96%E5%B0%BF%E7%97%85#%E7%B3%96%E5%B0%BF%E7%97%85%E7%9A%84%E7%9A%84%E8%AF%8A%E6%96%AD_v104713560_zh'},
  hypoglycemiaMsd:{label:'MSD Manual: 低血糖',url:'https://www.msdmanuals.cn/professional/endocrine-and-metabolic-disorders/diabetes-mellitus-and-hypoglycemia/hypoglycemia?query=%E8%83%B0%E5%B2%9B%E7%B4%A0'},
  cardiacOutputMsd:{label:'MSD Manual: 心输出量',url:'https://www.msdmanuals.cn/professional/cardiovascular-disorders/heart-failure/overview-of-heart-failure?query=%E5%BF%83%E8%BE%93%E5%87%BA%E9%87%8F#%E7%97%85%E7%90%86%E7%94%9F%E7%90%86_v103602065_zh'},
  preloadAfterload:{label:'MSD Manual: 心力衰竭病理生理',url:'https://www.msdmanuals.cn/professional/cardiovascular-disorders/heart-failure/overview-of-heart-failure#%E7%97%85%E7%90%86%E7%94%9F%E7%90%86_v103602065_zh'},
  contractility:{label:'MSD Manual: 心力衰竭病理生理',url:'https://www.msdmanuals.cn/professional/cardiovascular-disorders/heart-failure/overview-of-heart-failure#%E7%97%85%E7%90%86%E7%94%9F%E7%90%86_v103602065_zh'},
  rhythmStability:{label:'MSD Manual: 心律失常概述',url:'https://www.msdmanuals.cn/professional/cardiovascular-disorders/overview-of-arrhythmias-and-conduction-disorders/overview-of-arrhythmias#%E8%AF%8A%E6%96%AD_v936696_zh'},
  sns:{label:'Cleveland Clinic: Sympathetic nervous system',url:'https://my.clevelandclinic.org/health/body/23262-sympathetic-nervous-system-sns-fight-or-flight'},
  autonomicMsd:{label:'MSD Manual: 自主神经系统',url:'https://www.msdmanuals.cn/professional/neurologic-disorders/autonomic-nervous-system/overview-of-the-autonomic-nervous-system#%E8%A7%A3%E5%89%96_v1032284_zh'},
  abgMsd:{label:'MSD Manual: 动脉血气和脉搏血氧',url:'https://www.msdmanuals.cn/home/lung-and-airway-disorders/diagnosis-of-and-procedures-for-lung-disorders/arterial-blood-gas-abg-analysis-and-pulse-oximetry'},
  hematocritCleveland:{label:'Cleveland Clinic: Hematocrit',url:'https://my.clevelandclinic.org/health/diagnostics/17683-hematocrit'},
  hematocritMayo:{label:'Mayo Clinic: Hematocrit test',url:'https://www.mayoclinic.org/tests-procedures/hematocrit/about/pac-20384728'},
  oxygenDeliveryMsd:{label:'MSD Manual: 机械通气与供氧',url:'https://www.msdmanuals.cn/professional/critical-care-medicine/respiratory-failure-and-mechanical-ventilation/overview-of-mechanical-ventilation?query=%E4%BE%9B%E6%B0%A7'},
  carbonMonoxideMsd:{label:'MSD Manual: 一氧化碳中毒',url:'https://www.msdmanuals.cn/professional/injuries-poisoning/poisoning/carbon-monoxide-poisoning?query=%E4%BE%9B%E6%B0%A7'},
  lactateMsd:{label:'MSD Manual: 丙酮酸代谢障碍',url:'https://www.msdmanuals.cn/professional/pediatrics/inherited-disorders-of-metabolism/pyruvate-metabolism-disorders?query=%E4%B9%B3%E9%85%B8#%E4%B8%99%E9%85%AE%E9%85%B8%E8%84%B1%E6%B0%A2%E9%85%B6%E7%BC%BA%E4%B9%8F_v88762373_zh'},
  anemiaHctMsd:{label:'MSD Manual: 贫血评估',url:'https://www.msdmanuals.cn/professional/hematology-and-oncology/approach-to-the-patient-with-anemia/evaluation-of-anemia?query=%E8%A1%80%E7%BB%86%E8%83%9E%E6%AF%94%E5%AE%B9'},
  polycythemiaMsd:{label:'MSD Manual: 真性红细胞增多症',url:'https://www.msdmanuals.cn/professional/hematology-and-oncology/myeloproliferative-disorders/polycythemia-vera?query=%E8%A1%80%E7%BB%86%E8%83%9E%E6%AF%94%E5%AE%B9'},
  metabolicBenefits:{label:'MSD Manual: 运动概述',url:'https://www.msdmanuals.cn/professional/special-subjects/exercise/overview-of-exercise?query=%E8%BF%90%E5%8A%A8%20%E4%BB%A3%E8%B0%A2#%E9%9C%80%E6%B0%A7%E8%BF%90%E5%8A%A8_v82378785_zh'}
};

// The per-disease reference badge. The link itself comes from the backend
// (simEngine SCENARIO_REFERENCES, already resolved for the active language in meta),
// so zh gets 人卫智数 and en gets MSD Manual Professional without a second copy here.
function updateScenarioReferenceLink(scenarioKey){
  updateScenarioMenuLabel(scenarioKey);
  const link=$('scenarioRefLink');
  if(!link) return;
  const reference=meta?.scenarios?.[scenarioKey]?.reference;
  if(!reference?.url){
    link.hidden=true;
    link.removeAttribute('href');
    return;
  }
  const zh=lang==='zh';
  link.href=reference.url;
  link.textContent=zh ? '人卫资料 ↗' : 'Reference ↗';
  link.title=zh
    ? `${reference.source}：${reference.title}（新窗口打开）`
    : `${reference.source}: ${reference.title} (opens in a new tab)`;
  link.setAttribute('aria-label', zh
    ? `查看疾病参考资料：${reference.title}`
    : `Open the reference article: ${reference.title}`);
  link.hidden=false;
}

const PARAM_DETAIL_OVERRIDES = {
  zh:{
    map:{intro:"平均动脉压代表一个心动周期内推动血液进入脑、心、肾等器官的平均灌注压力，受心输出量、外周阻力和血容量共同影响。",meaning:"过低提示休克或器官低灌注，过高会增加心脑肾负荷；评估时应结合心率、尿量、乳酸和意识状态。",refs:['bp']},
    hr:{intro:"心率反映窦房结节律以及交感、迷走神经和代谢需求对心脏的快速调节，静息成人常见范围约60到100次/分。",meaning:"持续过快可能见于低灌注、缺氧、发热或应激，过慢可能降低心输出量；需结合症状和血压判断风险。",refs:['hr']},
    sv:{intro:"每搏量是单次心搏射出的血量，取决于静脉回流形成的前负荷、外周阻力形成的后负荷和心肌收缩力。",meaning:"下降常提示容量不足、泵功能受抑或后负荷过高；即使心率升高，也可能无法维持足够心输出量。"},
    co:{intro:"心输出量是心率与每搏量的乘积，决定单位时间输送到全身组织的血液、氧气、葡萄糖和激素总量。",meaning:"降低会造成肾灌注下降、乳酸升高和组织缺氧；过高则常提示应激、发热或代谢需求增加。"},
    tpr:{intro:"外周阻力主要反映小动脉收缩程度，是血压的重要决定因素，受交感神经、血管紧张素II和局部代谢因子影响。",meaning:"升高有助于短期维持压力，但会增加心脏后负荷；过低则可导致分布性低血压和灌注不足。",refs:['bp']},
    venousReturn:{intro:"静脉回流表示回到心脏的血流量，受血容量、静脉张力、胸腔压力和肌肉泵影响，是前负荷的基础。",meaning:"减少常见于失血、脱水或静脉扩张，会降低每搏量；增加则可能改善低容量状态但也带来容量负荷。",refs:['preloadAfterload']},
    contractility:{intro:"心肌收缩力描述心肌在同等前负荷下射血的能力，受交感兴奋、缺氧、酸中毒、电解质异常和药物影响。",meaning:"收缩力下降会造成低心输出量和低灌注；过强或长期增强会增加耗氧量，可能诱发心肌负担。",refs:['contractility']},
    rhythmStability:{intro:"心律稳定性反映心脏电活动能否保持有序传导和有效泵血，特别受钾、pH、缺氧和交感兴奋影响。",meaning:"稳定性下降会使每搏量和心输出量突然变差；严重时需优先关注高钾、酸中毒和缺氧等可逆因素。",refs:['potassium','electrolytes']},
    symp:{intro:"交感张力是机体应激和低灌注时的快速代偿，可提高心率、收缩力、静脉回流和血管张力。",meaning:"适度升高可维持血压和灌注；过度升高会增加心肌耗氧、促血管收缩，并可能加重乳酸生成。",refs:['sns']},
    vagal:{intro:"迷走张力通过副交感通路减慢窦房结和房室结活动，是压力反射抑制心率的重要输出。",meaning:"升高可降低心率和心肌耗氧，但过强会导致心动过缓；过低常提示应激或交感优势。",refs:['hr']},
    chemo:{intro:"化学感受器驱动整合二氧化碳、pH和氧合变化，向呼吸中枢发出增加通气的信号。",meaning:"增强通常提示高碳酸血症、酸中毒或低氧；若通气无法响应，酸碱和氧合失衡会继续恶化。",refs:['abg']},
    renin:{intro:"肾素由肾脏释放，常在低血压、低血容量、低钠或交感兴奋时升高，是RAAS级联反应的起点。",meaning:"升高说明肾脏正在尝试保钠保水并升压；持续过强可增加血管收缩和容量负荷。",refs:['renin','aldosterone']},
    angII:{intro:"血管紧张素II是RAAS中的强效血管收缩信号，并促进醛固酮和ADH反应，帮助恢复压力与容量。",meaning:"短期升高可改善低灌注，过高则增加后负荷、钠水潴留和高血压风险，应结合肾灌注判断。",refs:['renin','aldosterone']},
    aldosterone:{intro:"醛固酮由肾上腺分泌，促使肾脏保留钠和水、排出钾，是长期容量和电解质调节的重要激素。",meaning:"升高可提高血容量和血压，但可能导致低钾；不足则易出现低血压、高钾和容量不足。",refs:['aldosterone','electrolytes']},
    adh:{intro:"ADH促进集合管重吸收水分，主要受渗透压升高、血容量下降和低血压刺激，是保水反应核心。",meaning:"升高会减少尿量并稀释血浆；过低或反应不足会造成水分丢失、渗透压升高和容量下降。",refs:['osmolality']},
    bloodVolume:{intro:"血容量是循环系统的容量基础，决定静脉回流、前负荷和器官灌注，也受ADH、醛固酮和尿量调节。",meaning:"不足常见于失血、脱水或利尿过多；过高会造成容量负荷，增加心脏和肾脏压力。",refs:['electrolytes','aldosterone']},
    gfr:{intro:"GFR估计肾小球每分钟滤过血浆的能力，依赖肾血流、灌注压力和肾内血管张力。",meaning:"下降提示肾灌注不足或肾功能受损，可使尿量、电解质和酸排泄恶化；解读需结合血压和容量。",refs:['gfr']},
    urine:{intro:"尿量反映肾脏排水、排钠和灌注状态，是血容量、GFR、ADH、醛固酮共同作用的结果。",meaning:"持续少尿提示保水或肾灌注不足；尿量过多会消耗容量，可能加重低血压和电解质紊乱。",refs:['gfr','electrolytes']},
    osm:{intro:"血浆渗透压反映水分与钠、葡萄糖等溶质的相对平衡，是ADH释放和口渴反应的重要刺激。",meaning:"升高常见于脱水、高钠或高糖，降低提示稀释状态；变化会影响脑细胞水分和神经功能。",refs:['osmolality','sodium']},
    sodium:{intro:"钠是细胞外液主要阳离子，决定血浆渗透压和水分分布，也影响神经肌肉兴奋性。",meaning:"过高常提示水分不足或钠负荷，过低可见稀释或丢钠；快速变化可能引起神经症状。",refs:['sodium','electrolytes']},
    potassium:{intro:"钾主要位于细胞内，决定心肌和骨骼肌细胞膜电位，受肾排泄、胰岛素和酸碱状态影响。血钾会随 pH 反向移动：酸血症时 H⁺ 入细胞、K⁺ 出细胞而升高，碱血症时反向交换而下降，约每 0.1 pH 变化 0.2～0.8 mmol/L。",meaning:"高钾或低钾都可能诱发心律失常和肌无力；解读时要同时看pH、GFR和醛固酮。碱中毒引起的低钾起初只是分布改变，总体钾并未丢失，但碱中毒持续会增加肾排钾而变成真正缺钾——此时只补钾而不纠正 pH，钾会不断被推回细胞内。",refs:['potassium','electrolytes']},
    ventilation:{intro:"肺通气量代表单位时间进入和排出肺泡的气体量，直接影响二氧化碳排出和氧气摄入。",meaning:"不足会导致CO2潴留和呼吸性酸中毒；过度通气会降低CO2，可能引起碱中毒和脑血流下降。",refs:['abg']},
    airway:{intro:"气道阻力反映空气进入肺泡时受到的阻碍，受支气管口径、分泌物、痉挛和气道水肿影响。",meaning:"升高会限制通气，导致低氧和CO2升高；降低阻力通常能改善通气效率和酸碱平衡。",refs:['abg','spo2']},
    paO2:{intro:"PaO2是动脉血氧分压，反映肺把氧气转入血液后的溶解氧水平，是氧合评估核心指标。",meaning:"下降提示低氧血症，可削弱组织供氧并促进乳酸生成；需结合血红蛋白和心输出量理解。",refs:['abg','spo2']},
    paCO2:{intro:"PaCO2反映肺泡通气是否足以排出二氧化碳，是判断呼吸性酸碱紊乱的重要血气指标。",meaning:"升高提示低通气和呼吸性酸中毒，降低常见于过度通气；变化会迅速影响血液pH。",refs:['abg']},
    pH:{intro:"血液pH表示酸碱状态，由二氧化碳、碳酸氢盐、乳酸和肾肺代偿共同决定，正常范围很窄。",meaning:"酸中毒会抑制心肌、改变钾分布并增加心律风险；碱中毒也可引起神经肌肉兴奋，并把 K⁺ 推入细胞而造成低钾。任何 pH 异常都应同时读血钾。",refs:['abg','metabolicAcidosis']},
    bicarbonate:{intro:"碳酸氢盐是主要代谢性缓冲碱，走两个完全不同的时间尺度：强酸对它的滴定在数分钟内完成，而肾脏排酸并重新生成 HCO₃⁻ 需要 3～5 天。",meaning:"降低提示代谢性酸中毒或缓冲消耗，升高提示代谢性碱中毒或慢性呼吸性代偿。因为肾代偿以天计，一次急性发作中真正能指望的是缓冲和肺代偿——补碱只是买时间，不能替代病因治疗。",refs:['electrolytes','metabolicAcidosis']},
    glucose:{intro:"葡萄糖是大脑和多数组织的重要能量底物，受胰岛素、胰高血糖素、应激激素和摄食状态影响。",meaning:"过低会威胁神经功能，过高会增加渗透压和利尿；严重失控可伴酸中毒或脱水。",refs:['glucose','diabetes']},
    insulin:{intro:"胰岛素促进葡萄糖进入细胞，并推动钾向细胞内转移，是降低血糖和调节钾分布的关键激素。",meaning:"过多可导致低血糖或低钾，过少会造成高血糖、渗透性利尿和代谢失衡。",refs:['glucose','diabetes','potassium']},
    glucagon:{intro:"胰高血糖素在低血糖和应激时促进肝糖原分解和糖异生，是胰岛素的反调节激素。",meaning:"升高可帮助恢复低血糖，但在应激或胰岛素不足时会推动高血糖和代谢负担。",refs:['glucose','diabetes']},
    tissueO2:{intro:"组织供氧整合心输出量、PaO2、血红蛋白携氧能力和微循环灌注，决定细胞有氧代谢条件。",meaning:"下降提示缺氧或低灌注，常伴乳酸升高；改善需要同时考虑氧合、循环和血液携氧能力。",refs:['abg','spo2']},
    lactate:{intro:"乳酸反映无氧糖酵解和组织氧供不足程度，也可因应激、肝清除下降或代谢需求升高而增加。氧输送跌破临界值后，无氧代谢会加速，乳酸生成不再与供氧成正比。",meaning:"升高常提示低灌注、缺氧或代谢危机；作为强酸，乳酸会按约 1:1 滴定掉 HCO₃⁻ 并压低 pH，这正是阴离子间隙增宽的含义。趋势比单次数值更能反映复苏和供氧是否改善。",refs:['lacticAcidosis','metabolicAcidosis']},
    hct:{intro:"血细胞比容表示红细胞占血液体积的比例，影响携氧能力、血液黏稠度和微循环阻力。",meaning:"降低会削弱氧运输，升高可见脱水或浓缩并增加黏稠度；需结合血容量和组织供氧判断。",refs:['hematocritCleveland','hematocritMayo']},
    metDemand:{intro:"代谢需求表示组织对氧气、葡萄糖和能量产生的总体需要，受运动、发热、应激和激素水平影响。",meaning:"升高会推动心输出量、通气和糖动员；若供氧不足，则更容易出现乳酸升高和代偿失衡。",refs:['metabolicBenefits']}
  },
  en:{
    map:{intro:"Mean arterial pressure is the average driving pressure for organ perfusion across the cardiac cycle. It emerges from cardiac output, vascular resistance and circulating volume, so a single MAP value should be interpreted with flow, urine output, lactate and mental status rather than as pressure alone.",meaning:"Low MAP suggests inadequate perfusion of the brain, kidney or myocardium, especially when urine output falls or lactate rises. High MAP increases vascular and cardiac workload and may contribute to kidney, brain and heart injury when sustained.",refs:['bp']},
    hr:{intro:"Heart rate reflects sinoatrial node pacing plus autonomic, metabolic and temperature influences. In adults, a resting rate around 60 to 100 beats per minute is commonly cited, but conditioning, medications, sleep, stress and illness can shift the expected range.",meaning:"Persistent tachycardia can be compensation for low volume, hypoxia, fever, pain or acidosis, while bradycardia can reduce cardiac output when stroke volume cannot rise. Symptoms, blood pressure and rhythm stability matter more than the number alone.",refs:['hr']},
    sv:{intro:"Stroke volume is the amount of blood ejected with one beat. It depends on venous return and preload, myocardial contractility, valve function and afterload from arterial resistance. In the model it links volume status, pump strength and vascular tone.",meaning:"A falling stroke volume may signal bleeding, dehydration, poor contractility or excessive afterload. Raising heart rate can temporarily preserve cardiac output, but if filling or contractility is impaired, tissue perfusion and renal flow still decline."},
    co:{intro:"Cardiac output is heart rate multiplied by stroke volume, so it represents total blood flow delivered each minute. It carries oxygen, glucose, hormones and heat to tissues and is one of the main determinants of blood pressure and organ perfusion.",meaning:"Low cardiac output causes renal hypoperfusion, cool or hypoxic tissues and rising lactate. Very high output often reflects fever, stress, exercise or low resistance states; it may be compensatory but also increases cardiac workload and oxygen demand."},
    tpr:{intro:"Total peripheral resistance represents the net tone of small arteries and arterioles. It is shaped by sympathetic drive, angiotensin II, local metabolites, acid-base status and vascular responsiveness, and it strongly influences arterial pressure.",meaning:"Higher resistance can support pressure during shock, but it also raises afterload and may reduce tissue flow. Low resistance can produce distributive hypotension, requiring more cardiac output or volume to maintain perfusion.",refs:['bp']},
    venousReturn:{intro:"Venous return is the flow returning to the heart and is the foundation of preload. It changes with blood volume, venous tone, intrathoracic pressure, body position and skeletal muscle pumping, so it connects fluid status with stroke volume.",meaning:"Reduced venous return is common in hemorrhage, dehydration or venodilation and lowers stroke volume. Increasing it can help low-volume states, but excessive return or impaired pumping may worsen congestion and cardiac filling pressures.",refs:['preloadAfterload']},
    contractility:{intro:"Myocardial contractility describes the intrinsic ability of cardiac muscle to generate force at a given preload. It increases with sympathetic stimulation and inotropes, and falls with hypoxia, acidosis, electrolyte disturbance, ischemia or myocardial depression.",meaning:"Low contractility can produce low-output shock even when volume is adequate. Excessive stimulation may improve short-term pressure but raises myocardial oxygen demand, arrhythmia risk and the burden on an already stressed heart.",refs:['contractility']},
    rhythmStability:{intro:"Rhythm stability summarizes whether cardiac electrical activation remains organized enough to support effective pumping. Potassium imbalance, acidosis, hypoxia and strong sympathetic tone can destabilize conduction and reduce mechanical output.",meaning:"When rhythm stability falls, stroke volume and cardiac output may deteriorate abruptly rather than gradually. Correcting reversible drivers such as potassium abnormalities, low oxygen and severe acid-base disturbance is often more important than simply raising rate.",refs:['potassium','electrolytes']},
    symp:{intro:"Sympathetic tone is a rapid stress response that increases heart rate, contractility, venous tone and arteriolar resistance. It is useful when pressure or oxygen delivery falls, but it also mobilizes glucose and shifts blood toward vital organs.",meaning:"Moderate activation helps preserve perfusion during acute stress. Sustained or excessive activation raises myocardial oxygen demand, constricts some vascular beds, can worsen lactate production and may eventually become maladaptive compensation.",refs:['sns']},
    vagal:{intro:"Vagal tone is the main parasympathetic brake on the heart. Through the sinoatrial and atrioventricular nodes, it slows rate and participates in baroreflex control when blood pressure rises or stress resolves.",meaning:"Higher vagal tone can reduce oxygen demand and counter sympathetic overactivity, but excessive vagal output may cause bradycardia or conduction delay. Low vagal tone often accompanies pain, hypovolemia, anxiety, fever or shock.",refs:['hr']},
    chemo:{intro:"Chemoreceptor drive integrates carbon dioxide, hydrogen ion concentration and oxygenation signals from central and peripheral sensors. It tells the respiratory system when ventilation must rise to remove CO2 or correct acid-base and oxygen stress.",meaning:"A high value usually means hypercapnia, acidosis or hypoxemia is pushing breathing. If ventilation cannot increase because of airway obstruction, fatigue or central depression, CO2 and pH can worsen quickly.",refs:['abg']},
    renin:{intro:"Renin is released by the kidney when perfusion pressure, sodium delivery or effective circulating volume is low, and also during sympathetic activation. It initiates the renin-angiotensin-aldosterone system, linking renal sensing to vascular and hormonal responses.",meaning:"Rising renin means the kidney is trying to restore pressure and volume by promoting angiotensin II and aldosterone. Persistent activation can worsen vasoconstriction, sodium retention and long-term cardiovascular load.",refs:['renin','aldosterone']},
    angII:{intro:"Angiotensin II is a potent RAAS mediator that constricts vessels and supports aldosterone and ADH responses. It helps defend pressure in low-volume or low-perfusion states while directing the kidney to conserve salt and water.",meaning:"Short-term elevation can be protective in shock or dehydration. Excessive or chronic angiotensin II increases afterload, promotes sodium and water retention and can aggravate hypertension or renal stress.",refs:['renin','aldosterone']},
    aldosterone:{intro:"Aldosterone is an adrenal hormone that helps stabilize blood pressure by increasing renal sodium and water retention while promoting potassium excretion. It is often assessed together with renin when evaluating resistant hypertension or potassium abnormalities.",meaning:"Higher aldosterone can expand volume and raise pressure, but it may lower potassium and increase cardiac or renal workload. Low aldosterone can contribute to hypotension, sodium loss, hyperkalemia and weakness.",refs:['aldosterone','electrolytes']},
    adh:{intro:"Antidiuretic hormone promotes water reabsorption in the kidney collecting ducts. It responds strongly to increased plasma osmolality and also rises with low effective volume or low pressure, making it a major water-conservation signal.",meaning:"High ADH reduces urine flow and can dilute sodium when water retention is strong. Inadequate ADH effect causes water loss, higher osmolality, thirst and possible volume depletion.",refs:['osmolality']},
    bloodVolume:{intro:"Blood volume is the circulating fluid reservoir that supports venous return, preload and pressure. It changes with intake, bleeding, capillary shifts, urine output, aldosterone, ADH and kidney filtration, so it moves more slowly than reflex variables.",meaning:"Low volume is typical of hemorrhage, dehydration or excessive diuresis and reduces cardiac filling. High volume can improve pressure initially but may overload the heart, raise venous pressure and stress the kidneys.",refs:['electrolytes','aldosterone']},
    gfr:{intro:"Glomerular filtration rate estimates how much plasma the kidneys filter each minute. It depends on renal blood flow, perfusion pressure and intrarenal vascular tone, and it is a practical marker of kidney filtering capacity.",meaning:"A falling GFR suggests low renal perfusion, kidney injury or strong renal vasoconstriction. It can reduce urine formation, impair potassium and acid excretion and make volume or electrolyte disturbances harder to correct.",refs:['gfr']},
    urine:{intro:"Urine flow is the final output of filtration and tubular water-sodium handling. It reflects GFR, renal perfusion, ADH, aldosterone, sympathetic tone and current volume status, so it is a useful dynamic sign of compensation.",meaning:"Persistent oliguria suggests water conservation or inadequate renal perfusion. Excess urine flow can deplete volume, worsen hypotension and disturb sodium, potassium or osmolality, especially when intake cannot keep up.",details:[{title:"Polyuria",text:"When urine flow remains above about 2.1 mL/min (about 3 L/day) without matched replacement, circulating volume, venous return and cardiac output can progressively fall. Sympathetic tone, RAAS and ADH may initially support pressure, but ongoing water loss can still lower MAP and Stability. Low ADH with hypernatremia or hyperosmolality is more consistent with a diabetes-insipidus pattern."},{title:"Oliguria",text:"Isolated low urine flow can represent appropriate water conservation and therefore does not automatically cause major Stability loss. Low MAP, low blood volume or low GFR alongside oliguria suggests hypoperfusion or kidney-injury risk."}],refs:['gfr','electrolytes']},
    osm:{intro:"Plasma osmolality reflects the concentration of dissolved particles, especially sodium, glucose and urea, relative to water. It drives thirst and ADH release, and it determines how water shifts between blood and cells.",meaning:"High osmolality suggests dehydration, hypernatremia or marked hyperglycemia; low osmolality suggests dilution or sodium deficit. Rapid shifts are clinically important because brain cells are sensitive to water movement.",refs:['osmolality','sodium','glucose']},
    sodium:{intro:"Sodium is the dominant extracellular cation and a major determinant of extracellular fluid volume and plasma osmolality. It supports nerve and muscle function while helping govern water distribution between compartments.",meaning:"Hypernatremia often indicates water deficit or sodium load, while hyponatremia may reflect dilution, losses or hormonal water retention. Rapid or severe changes can cause neurologic symptoms and require cautious correction.",refs:['sodium','electrolytes']},
    potassium:{intro:"Potassium is mostly intracellular and strongly influences membrane potential in cardiac, nerve and skeletal muscle cells. Kidney excretion, aldosterone, insulin and acid-base status all affect serum potassium, which moves opposite to pH: acidemia drives H+ into cells and K+ out, alkalemia reverses the exchange, by roughly 0.2 to 0.8 mmol/L per 0.1 pH unit.",meaning:"Both hyperkalemia and hypokalemia can cause weakness and dangerous rhythm disturbance. Interpretation should include pH, GFR, aldosterone activity and insulin effect because shifts between cells and blood can be rapid. Hypokalemia from alkalosis begins as redistribution with no loss of total-body potassium, but a sustained alkalosis increases renal potassium excretion and turns it into a true deficit, so replacing potassium without correcting the pH just lets it be driven back into cells.",refs:['potassium','electrolytes']},
    ventilation:{intro:"Ventilation is the movement of air into and out of the alveoli each minute. It determines carbon dioxide clearance and contributes to oxygen uptake, making it the fastest controller of respiratory acid-base balance.",meaning:"Low ventilation causes CO2 retention and respiratory acidosis. Excess ventilation lowers CO2 and can produce alkalosis, dizziness or reduced cerebral blood flow, especially if oxygen delivery is otherwise adequate.",refs:['abg']},
    airway:{intro:"Airway resistance describes how hard it is for airflow to reach the alveoli. It rises with bronchospasm, secretions, edema or obstruction and falls when the airways are open and supported.",meaning:"Higher resistance limits ventilation, lowers oxygenation and raises CO2, increasing chemoreceptor drive and acid-base stress. Reducing resistance improves gas exchange efficiency without necessarily increasing respiratory muscle work.",refs:['abg','spo2']},
    paO2:{intro:"PaO2 is the arterial oxygen partial pressure measured on a blood gas. It reflects how effectively the lungs transfer oxygen into blood, but tissue oxygen delivery also depends on hemoglobin and cardiac output.",meaning:"Low PaO2 indicates hypoxemia and can drive tissue hypoxia, sympathetic activation and lactate production. A normal oxygen saturation can still require context when perfusion, anemia or metabolic demand is abnormal.",refs:['abg','spo2']},
    paCO2:{intro:"PaCO2 indicates whether alveolar ventilation is sufficient to remove carbon dioxide. Because CO2 combines with water to influence hydrogen ion concentration, PaCO2 changes rapidly affect blood pH.",meaning:"High PaCO2 points to hypoventilation and respiratory acidosis; low PaCO2 often reflects hyperventilation. The clinical meaning depends on pH and bicarbonate because renal compensation may partially buffer chronic changes.",refs:['abg']},
    pH:{intro:"Blood pH is the integrated result of respiratory CO2 control, metabolic acid production, bicarbonate buffering and kidney compensation. The normal range is narrow, so small numeric changes can represent large physiologic stress.",meaning:"Acidosis depresses contractility, shifts potassium out of cells and can destabilize rhythm, while alkalosis increases neuromuscular irritability, reduces ionized calcium and drives potassium into cells to produce hypokalemia. Always interpret pH with PaCO2, bicarbonate and potassium together.",refs:['abg','metabolicAcidosis']},
    bicarbonate:{intro:"Bicarbonate is the main metabolic buffer in blood and moves on two very different clocks: titration by a strong acid such as lactate is complete within minutes, while renal acid excretion and bicarbonate regeneration take 3 to 5 days.",meaning:"Low bicarbonate supports metabolic acidosis or compensation for respiratory alkalosis. High bicarbonate suggests metabolic alkalosis or compensation for chronic CO2 retention, so PaCO2 and clinical context are essential. Because the renal arm works over days, an acute episode is carried by buffering and ventilation alone, and giving base buys time rather than substituting for treating the cause.",refs:['electrolytes','metabolicAcidosis']},
    glucose:{intro:"Glucose is a major fuel for the brain and many tissues. Its blood level reflects intake, liver production, insulin action, glucagon, stress hormones and renal water balance when hyperglycemia becomes severe.",meaning:"Hypoglycemia threatens brain function and can trigger autonomic symptoms. Hyperglycemia increases osmolality and urine losses; severe insulin deficiency or stress states can progress toward dehydration and metabolic acidosis.",refs:['glucose','diabetes']},
    insulin:{intro:"Insulin promotes cellular glucose uptake, suppresses hepatic glucose output and shifts potassium into cells. It is therefore central to both energy balance and rapid potassium redistribution during metabolic stress.",meaning:"Excess insulin can cause hypoglycemia and hypokalemia, while inadequate insulin permits hyperglycemia, osmotic diuresis and ketone-prone metabolic imbalance. Potassium should be watched when insulin effect changes quickly.",refs:['glucose','diabetes','potassium']},
    glucagon:{intro:"Glucagon is a counter-regulatory hormone that raises blood glucose by stimulating hepatic glycogen breakdown and gluconeogenesis. It becomes more prominent during fasting, hypoglycemia, exercise and sympathetic stress.",meaning:"A rise can protect against low glucose, but in insulin deficiency or severe stress it contributes to hyperglycemia and higher metabolic demand. Its effect should be judged alongside insulin and glucose trends.",refs:['glucose','diabetes']},
    tissueO2:{intro:"Tissue oxygen delivery combines arterial oxygenation, cardiac output, hemoglobin concentration and microvascular flow. It is closer to cellular oxygen availability than PaO2 alone because circulation and blood oxygen carrying capacity also matter.",meaning:"Low tissue oxygen delivery promotes anaerobic metabolism and lactate generation. Improvement may require better oxygenation, higher cardiac output, restored blood volume or adequate red-cell carrying capacity rather than one intervention alone.",refs:['abg','spo2']},
    lactate:{intro:"Lactate rises when glycolysis outpaces aerobic metabolism, commonly during tissue hypoxia, low perfusion, severe stress or impaired clearance. Once oxygen delivery falls below its critical threshold, consumption becomes supply-dependent and lactate production accelerates rather than tracking delivery proportionally.",meaning:"Elevated lactate is a warning sign for shock, hypoxemia or metabolic crisis, but trends matter. As a strong acid it titrates bicarbonate roughly 1:1 and pulls pH down, which is exactly what a widened anion gap represents. Falling lactate often suggests improving perfusion or oxygen delivery, while persistent elevation deserves urgent reassessment.",refs:['lacticAcidosis','metabolicAcidosis']},
    hct:{intro:"Hematocrit is the fraction of blood volume occupied by red blood cells. It influences oxygen-carrying capacity and viscosity, and it changes with bleeding, dehydration, fluid administration and red-cell production.",meaning:"Low hematocrit reduces oxygen transport even when PaO2 is normal. High hematocrit may reflect dehydration or concentration and can increase viscosity, potentially impairing microcirculatory flow when severe.",refs:['hematocritCleveland','hematocritMayo']},
    metDemand:{intro:"Metabolic demand represents the tissue requirement for oxygen, glucose and ATP production. It rises with exercise, fever, shivering, seizures, inflammation and sympathetic activation, and it challenges both respiratory and circulatory reserves.",meaning:"When demand rises, ventilation, cardiac output and glucose mobilization must increase. If supply cannot match demand, tissue oxygen falls, lactate rises and compensatory systems may become unstable.",refs:['metabolicBenefits']}
  }
}[lang];

Object.entries(PARAM_DETAIL_OVERRIDES).forEach(([key, detail])=>{
  PARAM_CLINICAL[key] = {...(PARAM_CLINICAL[key] || {}), ...detail};
});
if(lang==='zh'){
  Object.assign(PARAM_CLINICAL, {
    map:{intro:"平均动脉压是一个心动周期内推动血液进入脑、心、肾等重要器官的平均灌注压力，由心输出量、外周阻力、血容量和血管弹性共同决定，不能只当作单纯血压数值。",meaning:"持续偏低提示休克、失血或有效循环量不足，器官供血可能下降；持续偏高会增加心脏后负荷和脑肾血管压力，需结合心率、尿量、乳酸和意识状态判断。",refs:['bpHigh','bpLow']},
    hr:{intro:"心率反映窦房结起搏、交感与迷走神经平衡、体温、疼痛、缺氧和代谢需求对心脏节律的综合影响，成人静息常见范围约为每分钟60到100次。",meaning:"持续过快可能是低容量、发热、缺氧或酸中毒的代偿，也会缩短舒张充盈；过慢在每搏量不能增加时会降低心输出量，需结合症状、血压和节律稳定性。",refs:['hrTachy','hrBrady']},
    sv:{intro:"每搏量指心脏每次收缩射出的血量，受静脉回流形成的前负荷、外周阻力形成的后负荷、心肌收缩力、瓣膜功能和舒张充盈时间共同影响。",meaning:"下降常提示失血脱水、静脉回流不足、收缩力受抑或后负荷过高；即使心率代偿性升高，若每搏量无法恢复，心输出量和肾脏灌注仍会不足。",refs:['cardiacOutputMsd']},
    co:{intro:"心输出量是心率与每搏量的乘积，代表每分钟输送到全身组织的血流总量，承担氧气、葡萄糖、激素、热量和代谢废物运输，是灌注核心指标。",meaning:"降低会使肾灌注下降、尿量减少、组织缺氧和乳酸升高；明显升高常见于发热、运动、应激或低阻力状态，短期可代偿，长期会增加心肌耗氧。",refs:['cardiacOutputMsd']},
    tpr:{intro:"外周阻力主要反映小动脉和微动脉的整体收缩程度，受交感神经、血管紧张素II、局部代谢产物、酸碱状态和血管反应性调节，是血压形成的重要环节。",meaning:"阻力升高能在低灌注时短期维持压力，但会增加左心后负荷并可能牺牲微循环血流；阻力过低可造成分布性低血压，需要更高心排量或容量才能维持灌注。",refs:['bpHigh','bpLow']},
    venousReturn:{intro:"静脉回流表示单位时间回到右心的血流量，是心脏前负荷的基础，受血容量、静脉张力、胸腔压力、体位、呼吸活动和骨骼肌泵共同影响。",meaning:"减少常见于失血、脱水、静脉扩张或胸腔压力异常，会降低每搏量和心输出量；适度增加可改善低容量状态，但在泵功能差时可能加重淤血。",refs:['preloadAfterload']},
    contractility:{intro:"心肌收缩力描述心肌在相同前负荷下产生力量并射血的内在能力，受交感兴奋、儿茶酚胺、缺氧、酸中毒、电解质紊乱、缺血和药物影响。",meaning:"收缩力下降可在容量并不低时造成低心输出量、低灌注和休克；过度增强虽能短期升压，却会提高耗氧、心律失常风险和受损心肌负担。",refs:['contractility']},
    rhythmStability:{intro:"心律稳定性概括心脏电活动是否能保持有序传导并转化为有效机械泵血，钾异常、酸中毒、缺氧、缺血和交感过强都可能破坏传导。",meaning:"稳定性下降时，心输出量可能突然恶化而不是缓慢下降；处理时应优先寻找可逆因素，如高钾或低钾、低氧、严重酸碱紊乱和药物影响。",refs:['rhythmStability']},
    symp:{intro:"交感张力是机体面对低血压、疼痛、缺氧、低血糖或应激时的快速代偿通路，可提高心率、心肌收缩力、静脉张力和小动脉阻力。",meaning:"适度升高有助于维持脑心肾灌注并动员葡萄糖；持续过强会增加心肌耗氧、促血管收缩、加重乳酸生成，并可能使代偿转为负担。",refs:['autonomicMsd']},
    vagal:{intro:"迷走张力代表副交感对心脏的制动作用，主要影响窦房结和房室结，参与压力反射，在血压升高或应激缓解时帮助降低心率和传导速度。",meaning:"适度升高可减少心肌耗氧并对抗交感过度兴奋；过强会导致心动过缓或传导延迟，过低则常见于疼痛、低容量、发热、焦虑或休克。",refs:['autonomicMsd']},
    chemo:{intro:"化学感受器驱动整合二氧化碳、氢离子浓度和氧合信号，来自中枢与外周感受器，决定呼吸中枢是否需要增加通气以排出CO2或改善缺氧。",meaning:"升高通常提示高碳酸血症、酸中毒或低氧正在推动呼吸；若气道阻力、呼吸肌疲劳或中枢抑制使通气无法增加，pH和氧合会继续恶化。",refs:['abgMsd']},
    renin:{intro:"肾素由肾脏感知灌注压力、钠递送和有效循环容量后释放，也受交感神经刺激，是肾素-血管紧张素-醛固酮系统级联反应的起点。",meaning:"升高说明肾脏试图通过血管紧张素II和醛固酮恢复压力与容量；若长期过强，会促进血管收缩、钠水潴留和心肾负担增加。",refs:['raasMsd']},
    angII:{intro:"血管紧张素II是RAAS中的强效介质，可收缩血管、支持醛固酮和ADH分泌，并促使肾脏保留盐水，在低容量或低灌注时保护压力。",meaning:"短期升高可帮助脱水或休克状态维持灌注；过高或持续存在会增加后负荷、钠水潴留和高血压风险，并可能加重肾脏压力。",refs:['raasMsd']},
    aldosterone:{intro:"醛固酮由肾上腺分泌，促进肾小管重吸收钠和水，同时增加钾排泄，是慢性容量、血压和血钾调节中非常关键的激素信号。",meaning:"升高可扩充血容量并支持血压，但可能导致低钾和心肾负担；不足则可能出现钠丢失、低血压、高钾、乏力和循环不稳定。",refs:['raasMsd']},
    adh:{intro:"抗利尿激素促进集合管重吸收水分，对血浆渗透压升高最敏感，也会在有效循环容量下降或低血压时增强，是快速保水的重要内分泌信号。",meaning:"升高会减少尿量并保留水分，严重时可能稀释血钠；作用不足会导致水分丢失、渗透压升高、口渴和容量不足，影响回心血量。",refs:['adhMsd']},
    bloodVolume:{intro:"血容量是循环系统可用液体储备，支撑静脉回流、前负荷、动脉压力和器官灌注，受摄入、出血、毛细血管渗漏、尿量、ADH和醛固酮影响。",meaning:"低血容量常见于失血、脱水或利尿过多，会降低心脏充盈和肾灌注；容量过高可短期升压，却可能造成静脉压升高、肺淤血和肾脏压力。",refs:['bloodVolumeMsd']},
    gfr:{intro:"肾小球滤过率估计肾脏每分钟滤过血浆的能力，取决于肾血流、灌注压力、入球与出球小动脉张力，是肾脏清除和排水能力的核心指标。",meaning:"下降提示肾灌注不足、肾损伤或强烈肾血管收缩，可能减少尿量并削弱钾、酸和水分排泄，使容量和电解质紊乱更难纠正。",refs:['gfrMsd']},
    urine:{intro:"尿量是肾小球滤过和肾小管水钠处理后的最终输出，动态反映肾灌注、GFR、ADH、醛固酮、交感张力和当前容量状态。",meaning:"持续少尿提示保水反应或肾灌注不足，是循环不足的重要线索；尿量过多会消耗容量，并可能造成钠、钾和渗透压紊乱。",details:[{title:"多尿（Polyuria）",text:"尿量持续高于约 2.1 mL/min（约 3 L/日）时，若没有等量补水，会逐步降低血容量、静脉回流与心排量；交感、RAAS 和 ADH 会尝试维持血压，但持续丢水仍会使血压下降并消耗稳定度。钠和渗透压的方向取决于病因；低 ADH 合并高钠/高渗时更符合尿崩症样模式。"},{title:"少尿（Oliguria）",text:"孤立的低尿量可代表生理性保水，因此不会自动扣除大量稳定度；若同时出现低 MAP、低血容量或低 GFR，则提示低灌注/肾损伤风险。"}],refs:['urinePolyuriaMsd','urineOliguriaMsd']},
    osm:{intro:"血浆渗透压反映血液中钠、葡萄糖、尿素等溶质相对于水分的浓度，是驱动口渴、ADH释放以及水在血液和细胞间移动的关键信号。",meaning:"升高常见于脱水、高钠或明显高血糖，降低提示稀释或钠缺乏；快速变化会影响脑细胞水分，可能引发神经系统症状。",refs:['sodiumWaterMsd']},
    sodium:{intro:"钠是细胞外液最主要阳离子，决定细胞外液容量和血浆渗透压，参与神经传导、肌肉兴奋和水分在细胞内外的分布。",meaning:"高钠多提示水分不足或钠负荷，低钠可来自稀释、丢钠或激素性保水；过快或过重的变化会造成头痛、意识改变或抽搐。",refs:['sodiumWaterMsd']},
    potassium:{intro:"钾主要位于细胞内，是维持心肌、神经和骨骼肌膜电位的关键离子，血钾受肾排泄、醛固酮、胰岛素和酸碱状态共同控制。",meaning:"高钾和低钾都可能导致肌无力、传导异常和危险心律失常；解读时应同时观察pH、GFR、醛固酮活性和胰岛素效应。",refs:['potassiumHighMsd','potassiumLowMsd']},
    ventilation:{intro:"肺通气量表示单位时间进入和排出肺泡的空气量，直接决定二氧化碳清除，并参与氧气摄入，是呼吸性酸碱调节中反应最快的环节。",meaning:"通气不足会导致CO2潴留和呼吸性酸中毒，增加化学感受器驱动；过度通气会降低CO2，可能造成碱中毒、头晕和脑血流减少。",refs:['ventilationMechanicsMsd','hyperventilationMsd']},
    airway:{intro:"气道阻力描述空气到达肺泡过程中遇到的阻碍，受支气管痉挛、分泌物、黏膜水肿、气道塌陷或外部压迫影响。",meaning:"阻力升高会限制通气，使氧合下降、CO2升高并增加呼吸做功；降低阻力能提高气体交换效率，但仍需结合呼吸肌力量判断。",refs:['dyspneaMsd']},
    paO2:{intro:"PaO2是动脉血氧分压，通常由血气分析获得，反映肺泡氧气进入血液后的溶解氧水平，但组织供氧还取决于血红蛋白和心输出量。",meaning:"下降提示低氧血症，可引起交感兴奋、组织缺氧和乳酸生成；即使血氧饱和度尚可，也要结合灌注、贫血和代谢需求判断。",refs:['abgMsd']},
    paCO2:{intro:"PaCO2反映肺泡通气是否足以排出二氧化碳，由于CO2能迅速影响氢离子浓度，它是判断呼吸性酸碱紊乱和通气失败的重要指标。",meaning:"升高提示低通气和呼吸性酸中毒，降低常见于过度通气；临床意义需与pH和碳酸氢盐一起看，因为慢性变化会有肾脏代偿。",refs:['abgMsd','acidBaseMsd']},
    pH:{intro:"血液pH综合反映呼吸性CO2控制、代谢性酸产生、碳酸氢盐缓冲和肾脏代偿，正常范围很窄，细小数值变化也可能代表明显生理压力。",meaning:"酸中毒会抑制心肌收缩、改变钾分布并增加心律风险；碱中毒可增强神经肌肉兴奋和降低离子钙，必须结合PaCO2和HCO3判断。",refs:['acidBaseMsd','abgMsd']},
    bicarbonate:{intro:"碳酸氢盐是血液最重要的代谢性缓冲碱，常在电解质或血气检查中评估，由肾脏慢性再生和保留，也会被乳酸等酸负荷消耗。",meaning:"降低支持代谢性酸中毒或呼吸性碱中毒代偿，升高提示代谢性碱中毒或慢性CO2潴留代偿；需结合PaCO2和病因分析。",refs:['acidBaseMsd','abgMsd']},
    glucose:{intro:"葡萄糖是大脑和多数组织的重要燃料，血糖水平由摄食、肝糖输出、胰岛素作用、胰高血糖素、应激激素以及严重高糖时的肾脏水分丢失共同决定。",meaning:"低血糖会威胁脑功能并触发出汗、心悸等自主神经反应；高血糖会增加渗透压和尿量，严重胰岛素不足时可进展为脱水和酸中毒。",refs:['diabetesMsd','hypoglycemiaMsd']},
    insulin:{intro:"胰岛素促进葡萄糖进入细胞、抑制肝糖输出，并推动钾向细胞内转移，因此同时连接能量利用、血糖控制和急性血钾再分布。",meaning:"过多可造成低血糖和低钾，过少会导致高血糖、渗透性利尿和酮症倾向；胰岛素效应快速改变时，应同时关注血钾趋势。",refs:['diabetesMsd','hypoglycemiaMsd']},
    glucagon:{intro:"胰高血糖素是胰岛素的反调节激素，在禁食、低血糖、运动和交感应激时促进肝糖原分解与糖异生，使血糖回升。",meaning:"升高可保护机体免于低血糖，但在胰岛素不足或严重应激中会推动高血糖和代谢需求增加；需和胰岛素、血糖趋势合并判断。",refs:['diabetesMsd','hypoglycemiaMsd']},
    tissueO2:{intro:"组织供氧整合动脉氧合、心输出量、血红蛋白浓度和微循环血流，比单看PaO2更接近细胞实际可获得的氧气条件。",meaning:"下降会推动无氧代谢和乳酸生成；改善时可能需要同时提高氧合、恢复血容量、增加心输出量或改善红细胞携氧能力，而非只调一个指标。",refs:['oxygenDeliveryMsd','carbonMonoxideMsd']},
    lactate:{intro:"乳酸在糖酵解超过有氧代谢能力时升高，常见于组织缺氧、低灌注、严重应激、肝清除下降或代谢需求过高，并常与代谢性酸中毒相关。",meaning:"升高是休克、低氧或代谢危机的警示，但趋势比单次数值更有价值；下降通常提示灌注或供氧改善，持续升高需要重新评估原因。",refs:['lactateMsd','acidBaseMsd']},
    hct:{intro:"血细胞比容表示红细胞占全血体积的比例，影响携氧能力、血液黏稠度和微循环阻力，会随出血、脱水、补液和红细胞生成改变。",meaning:"降低会削弱氧运输，即使PaO2正常也可能供氧不足；升高常见于脱水或血液浓缩，严重时会增加黏稠度并影响微循环。",refs:['anemiaHctMsd','polycythemiaMsd']},
    metDemand:{intro:"代谢需求表示组织对氧气、葡萄糖和ATP生成的总体需要，会随运动、发热、寒战、抽搐、炎症、疼痛和交感兴奋而升高。",meaning:"需求升高时，通气、心输出量和葡萄糖动员都必须增加；若供给跟不上，组织供氧下降、乳酸上升，代偿系统更容易失稳。",refs:['metabolicBenefits']}
  });
}
if(lang==='en'){
  [
    'hr','sv','co','tpr','venousReturn','contractility','rhythmStability','symp','vagal','chemo','renin','angII','aldosterone','adh',
    'bloodVolume','gfr','urine','osm','sodium','potassium','ventilation','airway','paO2','paCO2','pH','bicarbonate','glucose',
    'insulin','glucagon','tissueO2','lactate','hct','metDemand'
  ].forEach(key=>{
    if(PARAM_CLINICAL[key]) PARAM_CLINICAL[key].meaning += ' In the simulator, the trend and its linked variables are usually more informative than one isolated reading, because compensation may hide early clinical deterioration.';
  });
}

let sid = null;
let meta = null;
let latest = null;
let selectedKey = null;
let modelTransparencyOpen = false;
let parameterExplanations = Object.create(null);
const parameterExplanationRequests = new Set();
let paused = false;
let gameOverShown = false;
let terminalObserveMode = false;
let reportStopped = false;
let reportGenerating = false;
let reportDownloadedForCurrentSession = false;
let aiReportChoiceResolver = null;
let currentAiQuota = null;
let aiExemptionNoticeTimer = null;
let pendingRestartAction = null;
let restartPromptPreviousPaused = false;
let restartPromptRestoreGameOver = false;
let currentWeChatReportUrl = '';
let lastTick = performance.now();
let lastFetch = 0;
const dragging = {};
const controlTimers = {};
const controlRequestChains = {};
let activeControlFilter = 'all';
let customControlKeys = null;
const TICK_INTERVAL_MS = 190;
const REPORT_SAMPLE_INTERVAL_MS = Number.isFinite(Number(window.HOMEOSTASIS_REPORT_SAMPLE_INTERVAL_MS))
  ? Math.max(250,Number(window.HOMEOSTASIS_REPORT_SAMPLE_INTERVAL_MS))
  : 750;
const sessionRecorder = new window.HomeostasisSessionReporting.SessionRecorder({
  sampleIntervalMs:REPORT_SAMPLE_INTERVAL_MS,
  maxSamples:6000
});
const NETWORK_RENDER_INTERVAL_MS = 280;
const NETWORK_OVERVIEW_INTERVAL_MS = 520;
let lastNetworkRenderAt = -Infinity;
const NETWORK_SCALE_MIN = 0.14;
const NETWORK_SCALE_MAX = 2.8;
const NETWORK_WHEEL_ZOOM_RATE = 0.0018;
const NETWORK_HEIGHT_MIN = 260;
const NETWORK_HEIGHT_MAX_RATIO = 0.82;
const NETWORK_VIEWBOX_WIDTH = 920;
const NETWORK_VIEWBOX_HEIGHT = 580;
// A node counts as having moved once it is this far off baseline, in the same 0-100 units the
// heat colour uses. Four points is above the numerical fuzz of a settling solver and below any
// change a learner would call visible, so nothing flickers grey and nothing that has genuinely
// moved stays grey.
const NETWORK_ACTIVE_BIAS = 4;
const NETWORK_INACTIVE_NODE = '#5b6b7d';
const NETWORK_INACTIVE_EDGE = '#41505f';
function isNodeActive(param){
  if(!param) return false;
  // Either the feedback has reached it, or the learner is pushing it themselves.
  return Math.abs(Number(param.stateBias) || 0) >= NETWORK_ACTIVE_BIAS
    || Math.abs(Number(param.control) || 0) >= 6;
}
// Colour latches on. Once a node has moved it stays lit for the rest of the session, even after
// it settles back to normal.
//
// Without the latch the picture answers "what is off baseline right now", and a node that was
// pushed, propagated a signal onward and then got corrected quietly turns grey again - erasing
// the very thing the learner was meant to have watched happen. A restored parameter is not an
// untouched one, and a successful correction should not look identical to never having acted.
// Latched, the network reads as "everything this disturbance has reached so far", which is the
// question worth asking. Cleared only when a new session starts or the session is restarted.
const activatedNodes = new Set();
// The tape needs its own latch. The live one answers "what has this disturbance reached by now",
// which at the end of a run is most of the network - so replaying with it would light every node
// from the first frame and erase the one thing the replay exists to show: the order they lit up
// in. This set is rebuilt to whatever the playhead has passed, and the live latch is untouched.
const replayActivatedNodes = new Set();
function nodeHasBeenActive(param){
  if(!param) return false;
  if(replayActive) return replayActivatedNodes.has(param.key);
  if(activatedNodes.has(param.key)) return true;
  if(!isNodeActive(param)) return false;
  activatedNodes.add(param.key);
  return true;
}
const NETWORK_MAJOR_NODE_RADIUS = 22;
const NETWORK_MINOR_NODE_RADIUS = 17.6;
const NETWORK_NODE_LABEL_SIZE = 13.2;
const NETWORK_NODE_VALUE_SIZE = 12.1;
const NETWORK_MOBILE_NODE_FONT_SCALE = 1.2;
const NETWORK_DRAG_THRESHOLD_PX = 5;
const NETWORK_LAYOUT_EPSILON = 0.05;
const NETWORK_LABEL_ANIMATION_MS = 260;
const NETWORK_RESET_ANIMATION_MS = 520;
const NETWORK_TOPOLOGY_ANIMATION_MS = 680;
const NETWORK_NODE_BOUND_PADDING = 2;
const NETWORK_LABEL_BOUND_X = 80;
const NETWORK_LABEL_BOUND_Y = 24;
const NETWORK_CENTER_PADDING = 58;
const NETWORK_FIT_MARGIN = 18;
const NETWORK_MOBILE_FIT_MARGIN = 30;
const NETWORK_MOBILE_LEGEND_RESERVE = 48;
const NETWORK_MOBILE_SCALE_SAFETY = 1.75;
const NETWORK_DESKTOP_SCALE_SAFETY = 1.15;
const NETWORK_VIEWBOX_PAD_X = 76;
const NETWORK_VIEWBOX_PAD_TOP = 54;
const NETWORK_VIEWBOX_PAD_BOTTOM = 92;
const CONTROL_PANEL_DEFAULT_WIDTH_DESKTOP = 324;
const CONTROL_PANEL_DEFAULT_WIDTH_COMPACT = 297;
const CONTROL_PANEL_MIN_WIDTH = 240;
const CONTROL_PANEL_CENTER_MIN_WIDTH = 320;
const CONTROL_PANEL_RIGHT_WIDTH = 360;
const CONTROL_PANEL_HANDLE_WIDTH = 10;
const CONTROL_PANEL_GAP_WIDTH = 12;
const CONTROL_PANEL_WIDE_MULTIPLIER = 1.5;
const CONTROL_PANEL_EXTRA_WIDE_MULTIPLIER = 2.3;
// Adaptive console columns. The console width is chosen from the screen width so
// each card keeps a fixed comfortable size (labels stay legible, English
// included); the network then takes the remaining center area.
// Right column width, dragged from the handle between the centre and right panels. It mirrors
// the console handle on the other side: drag to resize, double-click to hide or restore, and a
// drag that ends below the minimum collapses the column rather than leaving an unusable sliver.
const RIGHT_PANEL_DEFAULT_WIDTH = 360;
const RIGHT_PANEL_MIN_WIDTH = 264;
const RIGHT_PANEL_CENTER_MIN_WIDTH = 320;
let rightPanelWidth = null;         // last usable manual width, remembered across launches
let rightPanelDrawerWidth = null;   // what is on screen right now, including 0 when collapsed
let rightPanelUserResized = false;
let rightPanelHidden = false;
const CONTROL_PANEL_MAX_COLUMNS = 4;
const CONTROL_COLUMN_TARGET_WIDTH = 340; // comfortable per-column width
const CONTROL_PANEL_CARD_GAP = 6;        // matches the .controls grid gap
// A column count is used only when the whole budget is at least this multiple of
// that console width, i.e. the network center stays at least as wide as the
// console — so the diagram remains the dominant central panel.
const CONTROL_PANEL_NETWORK_DOMINANCE = 2.0;
const MOBILE_BREAKPOINT_PX = 860;
const SYSTEM_COLORS = {
  cv: '#FFC0CB',
  neuro: '#ab20fd',
  resp: '#00e9ff',
  renal: '#ebb441',
  meta: '#e20000'
};
const SYSTEM_INK_COLORS = {
  cv: '#06101d',
  neuro: '#ffffff',
  resp: '#06101d',
  renal: '#06101d',
  meta: '#ffffff'
};
const NETWORK_LABEL_GROUP_ORDER = ['cv','neuro','renal','resp','meta'];
const NETWORK_MOBILE_LABEL_LAYOUT = {
  zh: {renal:[365,350],resp:[630,235],meta:[260,440]},
  en: {renal:[340,350],resp:[630,235],meta:[257,450]}
};
const NETWORK_START_INTRO_DURATION_MS = 4000;
const NETWORK_RESTART_INTRO_DURATION_MS = 3000;
const NETWORK_DISEASE_INTRO_DURATION_MS = 1500;
const NETWORK_NODE_PULSE_DURATION_MS = 460;
const NETWORK_NODE_PULSE_EXTRA_RADIUS = 9;
const NETWORK_INTRO_CLUSTER_MIN_RADIUS = 8;
const NETWORK_INTRO_CLUSTER_MAX_RADIUS = 46;
const NETWORK_RESTART_MIN_OFFSET = 8;
const NETWORK_RESTART_MAX_OFFSET = 24;
const NETWORK_INTRO_MIN_WOBBLE = 2.5;
const NETWORK_INTRO_MAX_WOBBLE = 8;
// Start-intro "yin-yang" cluster: nodes begin evenly scattered across a taijitu
// silhouette, then settle into the real layout. The dividing S-curve and the two
// eye "holes" are left empty so the shape reads clearly.
const NETWORK_INTRO_YINYANG_RADIUS_FROM_HALF_W = 0.86;
const NETWORK_INTRO_YINYANG_RADIUS_FROM_HALF_H = 0.98;
const NETWORK_INTRO_YINYANG_RADIUS_MIN = 120;
const NETWORK_INTRO_YINYANG_RIM = 0.05;   // keep node centers this far inside the rim (× R)
const NETWORK_INTRO_YINYANG_LANE = 0.12;  // empty gap on each side of the middle S-curve (× R)
const NETWORK_INTRO_YINYANG_EYE = 0.20;   // radius of the two empty eye holes (× R)
const NETWORK_INTRO_YINYANG_FADE_MS = 2000; // black/white taijitu backdrop fades out within this time
let networkScale = 1;
let networkPinch = null;
let networkUserNavigated = false;
let networkProgrammaticScroll = false;
let networkCenterRaf = 0;
let networkFitRaf = 0;
let networkFitBurstTimers = [];
let networkPanelResizeObserver = null;
let networkViewBox = {minX:0, minY:-12, width:NETWORK_VIEWBOX_WIDTH, height:NETWORK_VIEWBOX_HEIGHT};
let networkLayoutTransitionViewBox = null;
let networkHeightUserResized = false;
let networkHeightAutoRaf = 0;
let controlPanelWidth = null;
let controlPanelDrawerWidth = null;
let controlPanelUserResized = false;
let controlPanelAdaptiveDefault = true;
let controlPanelHidden = false;
let controlPanelSnapTimer = 0;
// The replay console starts open. The gauges it replaced defaulted to collapsed because they
// were a passive readout nobody had asked for; this strip carries the pause button, so hiding it
// by default would hide the control most likely to be reached for.
let replayConsoleHidden = false;
let savedNetworkPanelHeight = null;
let networkIntro = null;
let networkIntroRaf = 0;
let networkIntroStartRequested = false;
let networkNodePulse = null;
let networkNodePulseRaf = 0;
let mobileNodeControlKey = null;
let mobileNodeControlAnchorRect = null;
let mobileNodeControlPositionRaf = 0;
let networkDefaultPositions = null;
let networkNodePositions = null;
let networkLabelPositions = {};
let networkPointerDrag = null;
let networkLabelAnimations = new Map();
let networkLabelAnimationRaf = 0;
let networkResetAnimationRaf = 0;
let networkTopologyAnimationRaf = 0;
let networkTopologyLayoutActive = false;
let networkAppliedTopologySignature = '';
let networkSuppressClickUntil = 0;

function $(id){ return document.getElementById(id); }
function clip(x,a,b){ return Math.max(a, Math.min(b, x)); }
const LAYOUT_PREFERENCES_KEY = 'homeostasis_layout_preferences_v2';
const LEGACY_LAYOUT_PREFERENCES_KEY = 'homeostasis_layout_preferences_v1';
function loadLayoutPreferences(){
  try{
    const current=window.localStorage?.getItem(LAYOUT_PREFERENCES_KEY);
    const legacy=!current ? window.localStorage?.getItem(LEGACY_LAYOUT_PREFERENCES_KEY) : null;
    const value=JSON.parse(current || legacy || 'null');
    if(!value || typeof value!=='object') return;
    // v1 could mark a double-click as a manual resize. Preserve its visibility
    // and network preferences, but let the console width return to auto-fit.
    if(!legacy){
      if(Number.isFinite(value.controlPanelWidth)) controlPanelWidth=value.controlPanelWidth;
      if(typeof value.controlPanelUserResized==='boolean') controlPanelUserResized=value.controlPanelUserResized;
    }
    if(typeof value.controlPanelHidden==='boolean') controlPanelHidden=value.controlPanelHidden;
    if(Number.isFinite(value.rightPanelWidth)) rightPanelWidth=value.rightPanelWidth;
    if(typeof value.rightPanelUserResized==='boolean') rightPanelUserResized=value.rightPanelUserResized;
    if(typeof value.rightPanelHidden==='boolean') rightPanelHidden=value.rightPanelHidden;
    if(typeof value.replayConsoleHidden==='boolean') replayConsoleHidden=value.replayConsoleHidden;
    if(Number.isFinite(value.networkPanelHeight)) savedNetworkPanelHeight=value.networkPanelHeight;
    if(typeof value.networkHeightUserResized==='boolean') networkHeightUserResized=value.networkHeightUserResized;
    controlPanelAdaptiveDefault=!controlPanelUserResized;
  }catch(_){ }
}
function saveLayoutPreferences(){
  try{
    const center=document.querySelector('.center-panel');
    const networkHeight=parseFloat(center?.style.getPropertyValue('--network-panel-height'));
    window.localStorage?.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify({
      controlPanelWidth: Number.isFinite(controlPanelWidth) ? Math.round(controlPanelWidth) : null,
      controlPanelUserResized,
      controlPanelHidden,
      rightPanelWidth: Number.isFinite(rightPanelWidth) ? Math.round(rightPanelWidth) : null,
      rightPanelUserResized,
      rightPanelHidden,
      replayConsoleHidden,
      networkPanelHeight: Number.isFinite(networkHeight) ? Math.round(networkHeight) : savedNetworkPanelHeight,
      networkHeightUserResized
    }));
  }catch(_){ }
}
function smoothstep01(x){ const t=clip(x,0,1); return t*t*(3-2*t); }
function mixColor(a,b,t){ const ca=a.match(/\w\w/g).map(x=>parseInt(x,16)); const cb=b.match(/\w\w/g).map(x=>parseInt(x,16)); const cc=ca.map((v,i)=>Math.round(v+(cb[i]-v)*t)); return '#'+cc.map(v=>v.toString(16).padStart(2,'0')).join(''); }
function heatColorFromBias(bias){
  const stops=[[-100,'#2f7cff'],[-60,'#18d6ff'],[0,'#00e676'],[45,'#ffe500'],[78,'#ff8a00'],[100,'#ff1744']];
  const x=clip(bias,-100,100);
  for(let i=0;i<stops.length-1;i++){ const [x1,c1]=stops[i], [x2,c2]=stops[i+1]; if(x>=x1 && x<=x2) return mixColor(c1,c2,(x-x1)/(x2-x1 || 1)); }
  return x<0?stops[0][1]:stops[stops.length-1][1];
}
function emphasizeBias(bias){ const x=clip(bias,-100,100); const a=Math.abs(x); if(a<2) return 0; return Math.sign(x) * clip(Math.pow(a/100,.58)*100,0,100); }
function hexToRgbParts(hex){ const h=String(hex || '#000000').replace('#',''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16) || 0); }
function hexToRgbString(hex){ return hexToRgbParts(hex).join(' '); }
function hexToRgba(hex, alpha=1){ const [r,g,b]=hexToRgbParts(hex); return `rgba(${r},${g},${b},${alpha})`; }
function systemColor(group){ return SYSTEM_COLORS[group] || '#18d6ff'; }
function systemInk(group){ return SYSTEM_INK_COLORS[group] || '#ffffff'; }
function applySystemColor(el, group){
  if(!el || !group) return;
  const color=systemColor(group);
  el.dataset.systemGroup=group;
  el.style.setProperty('--system-color', color);
  el.style.setProperty('--system-rgb', hexToRgbString(color));
  el.style.setProperty('--system-ink', systemInk(group));
}
function sliderTrackBackground(bias){
  const x=clip(bias,-100,100), pct=(x+100)/2, color=heatColorFromBias(x), strong=hexToRgba(color,.98), soft=hexToRgba(color,.78), dark='rgba(7,16,28,.88)';
  const base='linear-gradient(90deg, rgba(47,124,255,.34) 0%, rgba(24,214,255,.24) 22%, rgba(0,230,118,.24) 50%, rgba(255,229,0,.20) 72%, rgba(255,138,0,.22) 88%, rgba(255,23,68,.30) 100%)';
  if(Math.abs(x)<3) return `linear-gradient(90deg, ${dark} 0%, ${dark} 47%, rgba(0,230,118,.95) 48%, rgba(0,230,118,1) 52%, ${dark} 53%, ${dark} 100%), ${base}`;
  if(x>0) return `linear-gradient(90deg, ${dark} 0%, ${dark} 49%, ${strong} 50%, ${strong} ${pct}%, ${soft} ${Math.min(100,pct+9)}%, rgba(255,23,68,.26) 100%), ${base}`;
  return `linear-gradient(90deg, rgba(47,124,255,.26) 0%, ${soft} ${Math.max(0,pct-9)}%, ${strong} ${pct}%, ${strong} 50%, ${dark} 51%, ${dark} 100%), ${base}`;
}
function zoneBorder(z){ return z==='danger'?'rgba(255,23,68,.75)':z==='warn'?'rgba(255,229,0,.62)':'rgba(255,255,255,.09)'; }
const LEARNING_LOGGER_VERSION = 'homeostasis-learning-v1-20260710';
const LEARNING_ENDPOINT = `${API_BASE}/api/learning-event`;
const LEARNING_HEARTBEAT_MS = 15000;
const LEARNING_CONTROL_LOG_MIN_MS = 1500;
const IDLE_LOGOUT_MS = 5 * 60 * 1000;
const learningPageStartedAtIso = new Date().toISOString();
const learningPageStartedAtPerf = performance.now();
const learningPageId = makeLearningId('homeostasis-page');
// Analytics are opt-in (backend: HOMEOSTASIS_LEARNING_LOG_ENABLED). Until the server says they are
// on, this stays null and nothing is sent. `false` means the answer arrived and was no; `true` means
// yes. The ids below are deliberately NOT created at module scope: reading them is what writes them
// to localStorage/sessionStorage, so a disabled instance must never ask for one.
let learningEnabled = null;
function learningIds(){
  if(learningIds.cached) return learningIds.cached;
  learningIds.cached = {
    visitorId: learningStoredId(learningStorage('local'), 'kuaiyu_visit_visitor_id', 'visitor'),
    visitSessionId: learningStoredId(learningStorage('session'), 'kuaiyu_visit_session_id', 'visit'),
    learningSessionId: learningStoredId(learningStorage('session'), 'homeostasis_learning_session_id', 'learn')
  };
  return learningIds.cached;
}
// Asked once, before anything can be logged. A failure here is treated as "off": a clone that cannot
// reach its own backend must not start hoarding ids on the guess that logging might be wanted.
async function loadTelemetryConfig(){
  try{
    const res = await fetch(`${API_BASE}/api/client-config`, {headers:{'Accept':'application/json'}});
    learningEnabled = res.ok ? Boolean((await res.json()).learningLogEnabled) : false;
  }catch(err){
    learningEnabled = false;
  }
}
let learningSimStartedAtPerf = null;
let learningHeartbeatTimer = 0;
let learningFailureLogged = false;
let learningImbalanceActive = false;
let learningLastSpeedEventAt = 0;
let learningUserActionType = 'random';
let idleLogoutTimer = 0;
let idleLogoutInProgress = false;
const learningLastControlEvent = {};

function learningStorage(kind){
  try{ return kind === 'local' ? window.localStorage : window.sessionStorage; }catch(err){ return null; }
}
function makeLearningId(prefix){
  const randomPart = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${randomPart}`;
}
function learningStoredId(storage, key, prefix){
  try{
    let value = storage?.getItem(key);
    if(!value){
      value = makeLearningId(prefix);
      storage?.setItem(key, value);
    }
    return value || makeLearningId(prefix);
  }catch(err){
    return makeLearningId(prefix);
  }
}
function learningRound(value, digits=2){
  const num = Number(value);
  if(!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}
function learningElapsedMs(){ return Math.max(0, Math.round(performance.now() - learningPageStartedAtPerf)); }
function learningSimElapsedMs(){ return learningSimStartedAtPerf == null ? null : Math.max(0, Math.round(performance.now() - learningSimStartedAtPerf)); }
function learningTimezone(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }catch(err){ return null; }
}
function learningParamSummary(param){
  if(!param) return null;
  return {
    key: param.key || null,
    label: param.label || null,
    short: param.short || null,
    unit: param.unit || null,
    valueText: param.valueText || null,
    zone: param.zone || null,
    control: learningRound(param.control, 1),
    stateBias: learningRound(param.stateBias, 1),
    displayBias: learningRound(param.displayBias, 1)
  };
}
function learningSnapshotSummary(snap=latest){
  if(!snap) return null;
  const majorKeys = Array.isArray(meta?.majorKeys) ? new Set(meta.majorKeys) : null;
  const params = (snap.params || [])
    .filter(param=>!majorKeys || majorKeys.has(param.key))
    .slice(0, 16)
    .map(learningParamSummary);
  const conditions = (snap.conditions || []).slice(0, 5).map(condition=>({
    name: condition.name || null,
    stage: condition.stage || null,
    severity: learningRound(condition.severity, 2),
    help: learningRound(condition.help, 2),
    harm: learningRound(condition.harm, 2),
    why: condition.why || null
  }));
  return {
    simTime: learningRound(snap.simTime, 1),
    health: learningRound(snap.health, 1),
    stableScore: learningRound(snap.stableScore, 1),
    chronic: learningRound(snap.chronic, 3),
    dead: Boolean(snap.dead),
    paused: Boolean(paused),
    terminalObserveMode: Boolean(terminalObserveMode),
    selectedKey: selectedKey || null,
    offenders: (snap.offenders || []).slice(0, 10),
    conditions,
    majorParams: params
  };
}
function learningViewport(){
  return {
    width: window.innerWidth || null,
    height: window.innerHeight || null,
    devicePixelRatio: learningRound(window.devicePixelRatio || 1, 2)
  };
}
function learningScreen(){
  return {
    width: window.screen?.width || null,
    height: window.screen?.height || null
  };
}
function learningDiseaseActionType(majorLabel, specificLabel){
  const major = String(majorLabel || '').trim();
  const specific = String(specificLabel || '').trim();
  return major && specific ? `(${major}/${specific})` : 'random';
}
// The identity block that decides which learning session a logged row belongs to. The traffic
// dashboard groups by `client.learningSessionId`, so anything sent WITHOUT this - the AI prompt
// records used to be sent without it - lands in a phantom session keyed by ip+day and never
// appears in the detail view of the session that produced it.
function learningClientBlock(){
  const ids = learningIds();
  return {
    visitorId: ids.visitorId,
    sessionId: ids.visitSessionId,
    learningSessionId: ids.learningSessionId,
    pageId: learningPageId,
    language: navigator.language || null,
    appLanguage: lang,
    timezone: learningTimezone(),
    pageStartedAt: learningPageStartedAtIso,
    pageElapsedMs: learningElapsedMs(),
    viewport: learningViewport(),
    screen: learningScreen()
  };
}
function learningBasePayload(eventType, action={}, snap=latest){
  return {
    loggerVersion: LEARNING_LOGGER_VERSION,
    eventType,
    page: {
      app: APP_SLUG,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      title: document.title || null,
      startedAt: learningPageStartedAtIso,
      visibilityState: document.visibilityState || null
    },
    client: learningClientBlock(),
    sim: {
      backendSid: sid,
      // Which mode produced this row. Without it a dashboard row cannot be read: the same
      // action means different things in a single-loop lesson and in the full console.
      learningMode: activeMode,
      learningModeLabel: TEXT.modes?.[activeMode]?.name || activeMode,
      simSessionElapsedMs: learningSimElapsedMs(),
      simTime: snap ? learningRound(snap.simTime, 1) : null
    },
    userActionType: learningUserActionType,
    action,
    snapshot: learningSnapshotSummary(snap)
  };
}
function sendLearningEvent(eventType, action={}, options={}){
  if(learningEnabled !== true) return;
  try{
    const body = JSON.stringify(learningBasePayload(eventType, action, options.snapshot || latest));
    if(options.final && navigator.sendBeacon){
      try{
        if(navigator.sendBeacon(LEARNING_ENDPOINT, new Blob([body], {type:'application/json'}))) return;
      }catch(err){}
    }
    fetch(LEARNING_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body,
      keepalive: Boolean(options.final)
    }).catch(()=>{});
  }catch(err){}
}
function resetIdleLogoutTimer(){
  if(!sid || idleLogoutInProgress) return;
  if(idleLogoutTimer) window.clearTimeout(idleLogoutTimer);
  idleLogoutTimer=window.setTimeout(handleIdleLogout, IDLE_LOGOUT_MS);
}
async function handleIdleLogout(){
  if(!sid || idleLogoutInProgress) return;
  idleLogoutInProgress=true;
  const endingSid=sid;
  // Awaited before the session is dropped: the endpoint needs a live sid to reconcile the
  // vicious-cycle history against, and after logout there is no session to build a prompt from.
  await logAiPromptForSession('idle_logout');
  sendLearningEvent('idle_logout',{idleMs:IDLE_LOGOUT_MS,backendSid:endingSid},{snapshot:latest,final:true});
  sid=null;
  if(idleLogoutTimer) window.clearTimeout(idleLogoutTimer);
  idleLogoutTimer=0;
  try{ await api(`/api/session/${endingSid}/logout`,{}); }catch(err){}
  window.location.replace(`${API_BASE}/`);
}
function scheduleLearningHeartbeat(){
  if(learningHeartbeatTimer) return;
  learningHeartbeatTimer = window.setInterval(()=>{
    if(document.visibilityState === 'hidden') return;
    sendLearningEvent('learning_heartbeat', {pageElapsedMs: learningElapsedMs()});
  }, LEARNING_HEARTBEAT_MS);
}
function learningControlAction(k, v, source){
  const def = defByKey(k);
  const current = paramByKey(k);
  return {
    key: k,
    label: current?.label || def?.label || k,
    short: current?.short || def?.short || null,
    value: learningRound(v, 1),
    source: source || 'commit',
    simTime: latest ? learningRound(latest.simTime, 1) : null
  };
}
function shouldLogLearningControl(k, v, source){
  const now = performance.now();
  const value = Math.round(Number(v) || 0);
  const previous = learningLastControlEvent[k];
  if(source === 'drag'){
    if(previous && now - previous.t < LEARNING_CONTROL_LOG_MIN_MS) return false;
  }else if(previous && previous.source !== 'drag' && now - previous.t < 450 && previous.value === value){
    return false;
  }
  learningLastControlEvent[k] = {t: now, value, source};
  return true;
}
function learningImbalanceState(snap){
  const params = snap?.params || [];
  const dangerKeys = params.filter(param=>param.zone === 'danger').map(param=>param.key);
  const warnKeys = params.filter(param=>param.zone === 'warn').map(param=>param.key);
  const severeConditions = (snap?.conditions || [])
    .filter(condition=>Number(condition.severity) >= 0.7)
    .slice(0, 5)
    .map(condition=>({name: condition.name || null, stage: condition.stage || null, severity: learningRound(condition.severity, 2)}));
  const health = learningRound(snap?.health, 1);
  return {
    active: Boolean(snap?.dead || Number(snap?.health) <= 70 || dangerKeys.length > 0 || severeConditions.length > 0),
    health,
    dangerCount: dangerKeys.length,
    dangerKeys: dangerKeys.slice(0, 10),
    warnCount: warnKeys.length,
    warnKeys: warnKeys.slice(0, 10),
    severeConditions
  };
}
function trackHomeostasisBalance(snap){
  if(!snap) return;
  const state = learningImbalanceState(snap);
  if(state.active && !learningImbalanceActive){
    learningImbalanceActive = true;
    sendLearningEvent('homeostasis_imbalance', {
      ...state,
      timeToImbalanceMs: learningElapsedMs(),
      simTime: learningRound(snap.simTime, 1)
    }, {snapshot:snap});
  }else if(!state.active && learningImbalanceActive && !snap.dead){
    learningImbalanceActive = false;
    sendLearningEvent('homeostasis_recovered', {
      ...state,
      timeToRecoveryMs: learningElapsedMs(),
      simTime: learningRound(snap.simTime, 1)
    }, {snapshot:snap});
  }
}
function logSpeedChange(source){
  const now = performance.now();
  if(now - learningLastSpeedEventAt < 1000) return;
  learningLastSpeedEventAt = now;
  sendLearningEvent('speed_change', {value: selectedSpeed(), source: source || 'input'});
}
async function api(path, body){
  const res = await fetch(API_BASE + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body||{})});
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}
function toast(text){
  const el=$('toast');
  el.textContent=text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>el.classList.remove('show'),2500);
  const status=$('appStatus');
  if(status){
    status.textContent='';
    clearTimeout(toast._statusTimer);
    toast._statusTimer=setTimeout(()=>{ status.textContent=text; },30);
  }
}
function simulationStatus(snapshot=latest){
  if(reportStopped) return 'stopped';
  if(terminalObserveMode || snapshot?.observationOnly || snapshot?.dead || Number(snapshot?.health)<=0) return 'stability-zero';
  if(paused) return 'paused';
  if(Number(snapshot?.health)<50) return 'unstable';
  return 'running';
}
function updateReportButton(){
  const button=$('reportBtn');
  if(!button) return;
  const downloadOnly=terminalObserveMode || reportStopped;
  button.textContent=downloadOnly?TEXT.reportDownload:TEXT.reportStopDownload;
  button.classList.toggle('is-ready',sessionRecorder.active);
  button.classList.toggle('is-generating',reportGenerating);
  button.dataset.recording=String(sessionRecorder.active);
  button.setAttribute('aria-busy',String(reportGenerating));
}
function updateZeroInterventionsButton(snapshot=latest){
  const button=$('resetControls');
  if(!button) return;
  const manipulationLocked=terminalObserveMode||reportStopped||replayActive;
  const hasManualInterventions=(snapshot?.params||[]).some(parameter=>Math.abs(Number(parameter.control)||0)>.001);
  button.disabled=manipulationLocked||!hasManualInterventions;
  button.title=hasManualInterventions?TEXT.zero:TEXT.zeroUnavailable;
  button.setAttribute('aria-label',button.title);
  button.dataset.hasInterventions=String(hasManualInterventions);
}
function applyInteractionLocks(){
  // Replay locks the same controls a stopped session does. Everything on screen during a replay
  // is a recording, so a slider that still moved would be writing into a live engine the learner
  // is not currently looking at.
  const manipulationLocked=terminalObserveMode || reportStopped || replayActive;
  document.body.classList.toggle('terminal-observe-mode',terminalObserveMode);
  document.body.classList.toggle('report-stopped',reportStopped);
  document.body.classList.toggle('replay-active',replayActive);
  document.querySelectorAll('.param-slider').forEach(input=>{ input.disabled=manipulationLocked; });
  ['scenarioCategory','scenario','scenarioMenuBtn','resetControls','speed'].forEach(id=>{
    const element=$(id);
    if(element) element.disabled=manipulationLocked;
  });
  if(!manipulationLocked && $('scenario')){
    $('scenario').disabled=!$('scenarioCategory')?.value;
  }
  if(manipulationLocked) openScenarioMenu(false);
  updateZeroInterventionsButton();
  const pauseButton=$('pauseBtn');
  if(pauseButton) pauseButton.disabled=replayActive || terminalObserveMode || Boolean(latest?.dead);
  updateReportButton();
  updateReplayConsole();
}
function setReportStopped(on){
  reportStopped=Boolean(on);
  if(reportStopped){
    paused=true;
    const pauseButton=$('pauseBtn');
    if(pauseButton) pauseButton.textContent=TEXT.resume;
  }
  applyInteractionLocks();
}
function cancelScheduledControls(){
  Object.keys(controlTimers).forEach(key=>{
    clearTimeout(controlTimers[key]);
    delete controlTimers[key];
  });
}
async function waitForControlRequests(){
  await Promise.all(Object.values(controlRequestChains).map(promise=>Promise.resolve(promise).catch(()=>null)));
}
function setAiReportModalView(view){
  const modal=$('aiReportModal');
  if(!modal) return;
  modal.setAttribute('aria-busy',String(view==='waiting'));
  $('aiReportSelectView')?.toggleAttribute('hidden',view!=='select');
  $('aiReportConfirmView')?.toggleAttribute('hidden',view!=='confirm');
  $('aiReportWaitingView')?.toggleAttribute('hidden',view!=='waiting');
  modal.classList.add('show');
}
function hideAiReportModal(){
  $('aiReportModal')?.classList.remove('show');
}
function chooseAiInterpretation(){
  if(aiReportChoiceResolver) return Promise.resolve('cancel');
  currentAiQuota=null;
  setAiReportModalView('select');
  return new Promise(resolve=>{ aiReportChoiceResolver=resolve; });
}
function settleAiReportChoice(choice){
  const resolve=aiReportChoiceResolver;
  aiReportChoiceResolver=null;
  if(choice==='ai') setAiReportModalView('waiting');
  else hideAiReportModal();
  resolve?.(choice);
}
function aiQuotaText(quota,{waiting=false}={}){
  if(!quota) return TEXT.aiQuotaUnavailable;
  if(quota.exempt) return TEXT.aiQuotaExempt;
  if(quota.remaining<=0) return TEXT.aiQuotaExhausted;
  const remaining=waiting?Math.max(0,quota.remaining-1):quota.remaining;
  return waiting?TEXT.aiQuotaWaitingRemaining(remaining):TEXT.aiQuotaRemaining(remaining);
}
function renderAiQuota(quota){
  currentAiQuota=quota||null;
  if($('aiQuotaRemaining')) $('aiQuotaRemaining').textContent=aiQuotaText(currentAiQuota);
  if($('aiWaitingRemaining')) $('aiWaitingRemaining').textContent=aiQuotaText(currentAiQuota,{waiting:true});
  const confirm=$('aiQuotaConfirm');
  if(confirm){
    const exhausted=Boolean(currentAiQuota&&!currentAiQuota.exempt&&currentAiQuota.remaining<=0);
    confirm.disabled=exhausted;
    confirm.setAttribute('aria-disabled',String(exhausted));
  }
}
async function fetchAiQuota(){
  const response=await fetch(`${API_BASE}/api/ai-quota`,{headers:{'Accept':'application/json'}});
  if(!response.ok) throw new Error(`Quota status failed (${response.status}).`);
  const payload=await response.json();
  return payload.quota;
}
async function beginAiReportChoice(){
  setAiReportModalView('confirm');
  renderAiQuota(null);
  try{
    const quota=await fetchAiQuota();
    renderAiQuota(quota);
    if($('aiSuppressReminder')) $('aiSuppressReminder').checked=Boolean(quota.suppressReminder);
    if(quota.suppressReminder&&(quota.exempt||quota.remaining>0)) settleAiReportChoice('ai');
  }catch(error){
    console.warn('Could not read AI report allowance.',error);
  }
}
async function confirmAiReportChoice(){
  if(currentAiQuota&&!currentAiQuota.exempt&&currentAiQuota.remaining<=0) return;
  const suppressReminder=Boolean($('aiSuppressReminder')?.checked);
  if(suppressReminder){
    try{
      const response=await fetch(`${API_BASE}/api/ai-quota/preferences`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({suppressReminder:true})
      });
      if(response.ok) renderAiQuota((await response.json()).quota);
    }catch(error){ console.warn('Could not save AI reminder preference.',error); }
  }
  settleAiReportChoice('ai');
}
function showAiExemptionNotice(){
  const notice=$('aiQuotaExemptNotice');
  if(!notice) return;
  clearTimeout(aiExemptionNoticeTimer);
  notice.classList.add('show');
  aiExemptionNoticeTimer=window.setTimeout(()=>notice.classList.remove('show'),3000);
}
async function registerAiQuotaHiddenClick(){
  try{
    const response=await fetch(`${API_BASE}/api/ai-quota/hidden-click`,{method:'POST'});
    if(!response.ok) return;
    const payload=await response.json();
    renderAiQuota(payload.quota);
    if(payload.granted) showAiExemptionNotice();
  }catch(error){ console.warn('Could not register AI quota exemption gesture.',error); }
}
function compactReportForAi(report){
  const allSamples=Array.isArray(report?.samples)?report.samples:[];
  const maxSamples=28;
  const indexes=new Set();
  if(allSamples.length){
    indexes.add(0);
    indexes.add(allSamples.length-1);
    for(let step=1;step<maxSamples-1;step++) indexes.add(Math.round(step*(allSamples.length-1)/(maxSamples-1)));
  }
  return {
    language:report?.language,
    definitions:report?.definitions,
    scenariosUsed:report?.scenariosUsed,
    interventions:(report?.interventions||[]).slice(0,200),
    parameterStatistics:report?.parameterStatistics,
    samples:[...indexes].sort((a,b)=>a-b).map(index=>allSamples[index]),
    // The whole session's loops, not only the ones still running. The server cross-checks these
    // against the live engine rather than trusting them, but it cannot reconstruct the history.
    viciousCycles:sessionCycleHistory(),
    timeScale:{...sessionTimeScale, lensSeconds:{...sessionTimeScale.lensSeconds}},
    metadata:{
      normalizedSimulationDurationSeconds:report?.metadata?.normalizedSimulationDurationSeconds,
      totalInterventions:report?.metadata?.totalInterventions,
      minimumStabilityScore:report?.metadata?.minimumStabilityScore,
      finalStabilityScore:report?.metadata?.finalStabilityScore,
      stabilityReachedZero:report?.metadata?.stabilityReachedZero
    }
  };
}
// The AI prompt is written to the learning log for EVERY session, not only the ones that spent an
// AI report. Most sessions never ask for one, and those are precisely the sessions a teacher would
// want to re-run through a model afterwards - without this they left no analysable trace at all.
// The server builds and stores the prompt itself; nothing comes back, no model is called, and the
// daily AI quota is untouched. Once per session run, on whichever end comes first.
let aiPromptLoggedForSession=false;
async function logAiPromptForSession(trigger){
  if(learningEnabled !== true) return;
  if(aiPromptLoggedForSession || !sid || !sessionRecorder.active) return;
  aiPromptLoggedForSession=true;
  try{
    const report=sessionRecorder.buildSnapshot(latest,simulationStatus());
    await fetch(`${API_BASE}/api/ai-prompt-log`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sid, trigger, client:learningClientBlock(), learningMode:activeMode, learningModeLabel:TEXT.modes?.[activeMode]?.name || activeMode, report:compactReportForAi(report)}),
      // keepalive caps the body at 64 KB and an evidence pack is bigger, so the request is
      // dropped without an error. Only the page-hide path has no alternative; every other
      // trigger fires while the page is alive and can send a normal request.
      keepalive:trigger==='page_end'
    });
  }catch(_error){
    // Best effort by design: an audit trail must never interrupt the learner.
  }
}
async function requestMedicalAiInterpretation(report){
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),125_000);
  try{
    const response=await fetch(`${API_BASE}/api/ai-analysis`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sid, client:learningClientBlock(), learningMode:activeMode, learningModeLabel:TEXT.modes?.[activeMode]?.name || activeMode, report:compactReportForAi(report)}),
      signal:controller.signal
    });
    if(!response.ok) throw new Error(`AI analysis failed (${response.status}).`);
    const payload=await response.json();
    if(payload?.analysis?.status!=='complete'||!payload.analysis.text) throw new Error('AI analysis response was incomplete.');
    return payload;
  }finally{
    clearTimeout(timeout);
  }
}
function isWeChatBrowser(){
  return /MicroMessenger/i.test(navigator.userAgent||'');
}
function showWeChatReportModal(url){
  currentWeChatReportUrl=url;
  const openLink=$('wechatReportOpen');
  const urlField=$('wechatReportUrl');
  if(openLink) openLink.href=url;
  if(urlField) urlField.value=url;
  $('wechatReportModal')?.classList.add('show');
}
function hideWeChatReportModal(){
  $('wechatReportModal')?.classList.remove('show');
}
async function createWeChatReportLink(data){
  const prepared=window.HomeostasisSessionReporting.prepareInteractiveReport(data);
  const response=await fetch(`${API_BASE}/api/reports?filename=${encodeURIComponent(prepared.filename)}`,{
    method:'POST',
    headers:{'Content-Type':'text/html; charset=utf-8'},
    body:prepared.html
  });
  if(!response.ok) throw new Error(`Could not host report (${response.status}).`);
  const payload=await response.json();
  const viewUrl=new URL(`${API_BASE}${payload.viewUrl}`,location.origin).href;
  showWeChatReportModal(viewUrl);
  return {filename:payload.filename||prepared.filename,openedFallback:true,weChatHosted:true,viewUrl};
}
async function copyWeChatReportLink(){
  if(!currentWeChatReportUrl) return;
  try{
    await navigator.clipboard.writeText(currentWeChatReportUrl);
  }catch(_error){
    const field=$('wechatReportUrl');
    field?.focus();
    field?.select();
    document.execCommand('copy');
  }
  toast(TEXT.wechatReportCopied);
}
async function generateSessionReport({stop=false}={}){
  if(!sessionRecorder.active){
    toast(TEXT.reportNoIntervention);
    return false;
  }
  if(reportGenerating) return false;
  const aiChoice=await chooseAiInterpretation();
  if(aiChoice==='cancel') return false;
  const aiRequested=aiChoice==='ai';
  reportGenerating=true;
  updateReportButton();
  if(stop){
    hideGameOverModal();
    setReportStopped(true);
  }
  cancelScheduledControls();
  try{
    toast(TEXT.reportGenerating);
    await waitForControlRequests();
    const immutableSnapshot=sessionRecorder.buildSnapshot(latest,simulationStatus());
    let aiIncluded=false;
    let aiFallback=false;
    if(aiRequested){
      try{
        const aiPayload=await requestMedicalAiInterpretation(immutableSnapshot);
        immutableSnapshot.aiAnalysis=aiPayload.analysis;
        if(aiPayload.quota) renderAiQuota(aiPayload.quota);
        aiIncluded=true;
      }catch(error){
        aiFallback=true;
        console.warn('Medical AI interpretation unavailable; downloading the original report.',error);
      }finally{
        hideAiReportModal();
      }
    }
    if(!aiIncluded) await logAiPromptForSession('report_download');
    const result=isWeChatBrowser()
      ? await createWeChatReportLink(immutableSnapshot)
      : window.HomeostasisSessionReporting.downloadInteractiveReport(immutableSnapshot);
    reportDownloadedForCurrentSession=true;
    sendLearningEvent('report_download', {
      filename:result.filename,
      stopped:stop,
      interventionCount:immutableSnapshot.metadata.totalInterventions,
      sampleCount:immutableSnapshot.samples.length,
      aiRequested,
      aiIncluded,
      aiFallback,
      simTime:latest?learningRound(latest.simTime,1):null
    }, {snapshot:latest});
    toast(aiFallback?TEXT.aiFallbackDownloaded:(aiIncluded?TEXT.aiReportReady:TEXT.reportReady));
    return true;
  }catch(error){
    console.error(error);
    hideAiReportModal();
    toast(TEXT.reportError);
    return false;
  }finally{
    reportGenerating=false;
    updateReportButton();
  }
}
function handlePrimaryReportClick(){
  const shouldStop=!terminalObserveMode&&!reportStopped;
  return generateSessionReport({stop:shouldStop});
}
function gameOverReasonLines(snap){
  const lines = [];
  (snap.conditions || []).slice(0,3).forEach(c=>{
    const severity = typeof c.severity === 'number' ? ` (${TEXT.severity} ${c.severity.toFixed(2)})` : '';
    lines.push(`${c.name}${severity}: ${c.why}`);
  });
  if(lines.length) return lines;
  (snap.offenders || []).slice(0,4).forEach(k=>{
    const p = (snap.params || []).find(x=>x.key===k) || paramByKey(k);
    if(p) lines.push(`${p.label}: ${p.valueText}${p.unit || ''}`);
  });
  return lines.length ? lines : [TEXT.gameOverNoReason];
}
// A run that ends within ten real seconds of starting was almost certainly not watched - it was
// compressed past the point of being legible. The one setting that does that is the manual time
// scale, because automatic scaling holds itself back precisely when the patient is deteriorating
// too fast to follow. Saying so in the failure card turns a run that looks like "I died instantly
// and I don't know why" into a run with a cause and a next step.
const FAST_DEATH_REAL_SECONDS = 10;
function isFastManualLensDeath(){
  if(autoLensEnabled) return false;
  const elapsedMs=learningSimElapsedMs();
  return elapsedMs != null && elapsedMs <= FAST_DEATH_REAL_SECONDS*1000;
}
function showGameOverModal(snap){
  if(terminalObserveMode) return;
  closeMobileNodeControl();
  const modal=$('gameOverModal'), reasons=$('gameOverReasons');
  if(!modal || !reasons) return;
  const reasonLines=gameOverReasonLines(snap);
  reasons.innerHTML='';
  reasonLines.forEach(line=>{
    const item=document.createElement('div');
    item.className='gameover-reason';
    item.textContent=line;
    reasons.appendChild(item);
  });
  const fastNote=$('gameOverFastNote');
  const fastDeath=isFastManualLensDeath();
  if(fastDeath) sessionTimeScale.fastFailureUnderManualScale=true;
  if(fastNote){
    fastNote.textContent=fastDeath ? TEXT.gameOverFastNote : '';
    fastNote.hidden=!fastDeath;
  }
  if(!learningFailureLogged){
    learningFailureLogged=true;
    sendLearningEvent('homeostasis_failure', {
      reasonLines,
      timeToFailureMs: learningElapsedMs(),
      fastManualLensDeath: fastDeath,
      lens: lensId,
      autoLens: autoLensEnabled,
      simTime: learningRound(snap?.simTime, 1)
    }, {snapshot:snap});
  }
  modal.classList.add('show');
  paused=true;
  const pauseBtn=$('pauseBtn');
  if(pauseBtn) pauseBtn.textContent=TEXT.resume;
  gameOverShown=true;
}
function hideGameOverModal(){
  const modal=$('gameOverModal');
  if(modal) modal.classList.remove('show');
  gameOverShown=false;
}
function setTerminalObserveMode(on){
  terminalObserveMode=Boolean(on);
  applyInteractionLocks();
}
async function continueGameOverObservation(){
  if(!sid) return;
  exitReplay({silent:true, skipRender:true});
  try{
    latest=await api(`/api/session/${sid}/continue-observation`,{});
    paused=false;
    reportStopped=false;
    setTerminalObserveMode(true);
    const modal=$('gameOverModal');
    if(modal) modal.classList.remove('show');
    gameOverShown=true;
    renderSnapshot(latest);
    sessionRecorder.capture(latest,simulationStatus(),true);
    sendLearningEvent('continue_observation', {simTime: latest ? learningRound(latest.simTime, 1) : null});
  }catch(error){
    console.error(error);
    toast(lang==='zh'?'无法继续观察，请重试。':'Could not continue observation. Please try again.');
  }
}

const INTRO_BODY = {
  zh: '<p class="intro-premise">本模拟器以多器官稳态反馈为核心：神经反射首先响应；约 20 个模拟秒后，体液与内分泌调节逐步参与。无论是自由调节参数还是载入疾病状态，持续失衡都可能突破代偿并导致失代偿。</p><h3>一、自由干预</h3><ul><li>调节心血管、呼吸、肾脏、代谢和激素相关参数</li><li>观察神经、体液、内分泌及多器官反馈如何维持稳态</li><li>改变单个变量，探索其影响和代偿反应</li></ul><h3>二、疾病模拟</h3><ul><li>先选择疾病大类，再选择具体疾病，载入病理状态</li><li>识别异常指标、代偿方向和失代偿征象</li><li>选择合理干预，尝试用尽量少的措施恢复稳定</li></ul><p>两种模式可独立使用，也可在疾病模拟中继续干预。</p><p class="intro-video-row"><a class="intro-video-link" href="https://www.bilibili.com/video/BV1wpMA6eEn9" target="_blank" rel="noopener noreferrer">观看操作视频</a></p>',
  en: '<p class="intro-premise">This simulator is built around multi-organ homeostatic feedback: neural reflexes respond first, while humoral and endocrine regulation progressively joins after about 20 simulated seconds. Whether you adjust parameters freely or load a disease state, sustained imbalance may exceed compensation and lead to decompensation.</p><h3>1. Free Intervention</h3><ul><li>Adjust cardiovascular, respiratory, renal, metabolic, and hormonal parameters</li><li>Observe how neural, humoral, endocrine, and multi-organ feedback maintain homeostasis</li><li>Change one variable at a time to explore its effects and compensatory responses</li></ul><h3>2. Disease Simulation</h3><ul><li>Select a disease category, then a specific condition, to load its pathological state</li><li>Identify abnormal findings, compensatory responses, and signs of decompensation</li><li>Choose appropriate interventions and restore stability with as few measures as possible</li></ul><p>The two modes can be used independently or combined by intervening after a disease is loaded.</p><p class="intro-video-row"><a class="intro-video-link" href="https://www.bilibili.com/video/BV1rpMA6YEZr" target="_blank" rel="noopener noreferrer">Watch the tutorial video</a></p><p class="intro-video-row"><a class="intro-video-link" href="https://www.bilibili.com/video/BV18oMu6eErR/" target="_blank" rel="noopener noreferrer">Mire el tutorial en español</a></p>'
};

function applyStaticText(){
  // The public build has no such notice, so the element is absent there. Guarded rather than
  // duplicated: the same app.js serves both deployments.
  if($('internalEditionNotice')) $('internalEditionNotice').innerHTML=TEXT.internalEdition;
  $('creatorText').innerHTML=`${TEXT.creator} <span class="creator-help-links"><a href="#" id="desktopGuideLink" class="inline-help-link">${TEXT.desktopHelpLink}</a><a href="#" id="mobileHelpLink" class="inline-help-link">${TEXT.mobileHelpLink}</a></span>`;
  if($('scenarioMenuBtn')) $('scenarioMenuBtn').setAttribute('aria-label', TEXT.selectDiseaseAria);
  updateScenarioMenuLabel($('scenario')?.value || '');
  $('pauseBtn').textContent=TEXT.pause; $('resetControls').textContent=TEXT.zero; $('restart').textContent=TEXT.restart;
  $('langSwitch').textContent=TEXT.switch; $('langSwitch').href=TEXT.switchHref;
  $('controlTitle').textContent=TEXT.controlTitle; $('networkTitle').textContent=TEXT.networkTitle; $('networkHint').textContent=TEXT.networkHint;
  // An empty hint still occupies a flex slot and pushes the title bar around, so it is hidden
  // rather than merely blanked.
  if($('controlHint')){ $('controlHint').textContent=TEXT.controlHint; $('controlHint').hidden=!TEXT.controlHint; }
  if($('topologyNetworkLayout')){ $('topologyNetworkLayout').textContent=TEXT.topologyLayout; $('topologyNetworkLayout').setAttribute('aria-label',TEXT.topologyLayoutAria); $('topologyNetworkLayout').title=TEXT.topologyLayoutAria; }
  if($('resetNetworkLayout')){ $('resetNetworkLayout').textContent=TEXT.resetLayout; $('resetNetworkLayout').setAttribute('aria-label',TEXT.resetLayoutAria); $('resetNetworkLayout').title=TEXT.resetLayoutAria; }
  if($('replayTitle')) $('replayTitle').textContent=TEXT.replayTitle; if($('logTitle')) $('logTitle').textContent=TEXT.logTitle; if($('logHint')) $('logHint').textContent=TEXT.logHint; $('stabilityLabel').textContent=TEXT.stability; if($('mobileStabilityLabel')) $('mobileStabilityLabel').textContent=TEXT.stability;
  if($('replayHiddenTag')) $('replayHiddenTag').textContent=TEXT.replayHiddenTag;
  if($('replaySpeedLabel')) $('replaySpeedLabel').textContent=TEXT.replaySpeedLabel;
  if($('replayHint')) $('replayHint').textContent=TEXT.replayHint;
  if($('replayScrub')) $('replayScrub').setAttribute('aria-label', TEXT.replayScrubAria);
  buildReplaySpeedButtons();
  updateReplayConsole();
  if($('fastPhase')) $('fastPhase').textContent=TEXT.fast; if($('fastDesc')) $('fastDesc').textContent=TEXT.fastDesc; if($('slowDesc')) $('slowDesc').textContent=TEXT.slowDesc; if($('scoreDesc')) $('scoreDesc').textContent=TEXT.scoreDesc; if($('speedDesc')) $('speedDesc').textContent=TEXT.speedDesc;
  $('detailTitle').textContent=TEXT.detailTitle; $('detailText').textContent=TEXT.detailText; $('clinicTitle').textContent=TEXT.clinicTitle; $('clinicHint').textContent=TEXT.clinicHint; if($('rulesBox')){ $('rulesBox').innerHTML=TEXT.rules; $('rulesBox').hidden=!TEXT.rules; }
  if($('introSubtitle')) $('introSubtitle').textContent=TEXT.introSubtitle; $('introBody').innerHTML=INTRO_BODY[lang]; $('introBody').className='intro-guide'; $('introCreator').innerHTML=TEXT.creator; $('startBtn').textContent=TEXT.start;
  if($('desktopGuideTitle')) $('desktopGuideTitle').textContent=TEXT.desktopHelpTitle; if($('desktopGuideOpenNew')) $('desktopGuideOpenNew').textContent=TEXT.desktopHelpOpenNew; if($('desktopGuideFallback')) $('desktopGuideFallback').textContent=TEXT.desktopHelpFallback; if($('desktopGuideFrame')) $('desktopGuideFrame').setAttribute('title', TEXT.desktopHelpTitle); if($('desktopGuideClose')) $('desktopGuideClose').setAttribute('aria-label', TEXT.desktopHelpClose);
  if($('customParamsTitle')) $('customParamsTitle').textContent=TEXT.customTitle; if($('customParamsIntro')) $('customParamsIntro').textContent=TEXT.customIntro; if($('customConfirm')) $('customConfirm').textContent=TEXT.customConfirm; if($('customCancel')) $('customCancel').textContent=TEXT.customCancel; if($('customSelectAll')) $('customSelectAll').textContent=TEXT.customSelectAll; if($('customClearAll')) $('customClearAll').textContent=TEXT.customClearAll; if($('customParamsClose')) $('customParamsClose').setAttribute('aria-label', TEXT.customClose);
  if($('controlPanelResizeHandle')){ $('controlPanelResizeHandle').setAttribute('aria-label', TEXT.controlWidthResizeLabel); $('controlPanelResizeHandle').setAttribute('title', TEXT.controlWidthResizeLabel); }
  if($('networkResizeHandle')){ $('networkResizeHandle').setAttribute('aria-label', TEXT.networkHeightResizeLabel); $('networkResizeHandle').setAttribute('title', TEXT.networkHeightResizeLabel); }
  if($('rightPanelResizeHandle')){ $('rightPanelResizeHandle').setAttribute('aria-label', TEXT.rightPanelResizeLabel); $('rightPanelResizeHandle').setAttribute('title', TEXT.rightPanelResizeLabel); }
  if($('mobileHelpBody')) $('mobileHelpBody').innerHTML=TEXT.mobileHelpBody; if($('mobileHelpClose')) $('mobileHelpClose').setAttribute('aria-label', TEXT.mobileHelpClose);
  $('gameOverTitle').textContent=TEXT.gameOverTitle;
  $('gameOverBody').innerHTML=TEXT.gameOverBody;
  if($('gameOverDownload')) $('gameOverDownload').textContent=TEXT.gameOverDownload;
  if($('gameOverReplay')) $('gameOverReplay').textContent=TEXT.gameOverReplay;
  if($('gameOverObserve')) $('gameOverObserve').textContent=TEXT.gameOverObserve;
  if($('gameOverRestart')) $('gameOverRestart').textContent=TEXT.gameOverRestart;
  if($('restartReportTitle')) $('restartReportTitle').textContent=TEXT.restartReportTitle;
  if($('restartReportBody')) $('restartReportBody').textContent=TEXT.restartReportBody;
  if($('restartDownload')) $('restartDownload').textContent=TEXT.restartDownload;
  if($('restartWithoutDownload')) $('restartWithoutDownload').textContent=TEXT.restartWithoutDownload;
  if($('restartReportClose')){
    $('restartReportClose').setAttribute('aria-label',TEXT.restartClose);
    $('restartReportClose').setAttribute('title',TEXT.restartClose);
  }
  if($('wechatReportTitle')) $('wechatReportTitle').textContent=TEXT.wechatReportTitle;
  if($('wechatReportBody')) $('wechatReportBody').textContent=TEXT.wechatReportBody;
  if($('wechatReportOpen')) $('wechatReportOpen').textContent=TEXT.wechatReportOpen;
  if($('wechatReportCopy')) $('wechatReportCopy').textContent=TEXT.wechatReportCopy;
  if($('wechatReportClose')) $('wechatReportClose').textContent=TEXT.wechatReportClose;
  if($('aiReportChoiceTitle')) $('aiReportChoiceTitle').textContent=TEXT.aiChoiceTitle;
  if($('aiReportChoiceBody')) $('aiReportChoiceBody').textContent=TEXT.aiChoiceBody;
  if($('aiReportWithAi')) $('aiReportWithAi').textContent=TEXT.aiChoiceWith;
  if($('aiReportWithoutAi')) $('aiReportWithoutAi').textContent=TEXT.aiChoiceWithout;
  if($('aiReportCancel')) $('aiReportCancel').textContent=TEXT.aiChoiceCancel;
  if($('aiQuotaConfirmTitle')) $('aiQuotaConfirmTitle').textContent=TEXT.aiQuotaConfirmTitle;
  const quotaBody=$('aiQuotaConfirmBody'),quotaLink=$('aiQuotaHiddenLink');
  if(quotaBody&&quotaLink){
    quotaLink.textContent=TEXT.aiQuotaUser;
    quotaBody.replaceChildren(document.createTextNode(TEXT.aiQuotaPrefix),quotaLink,document.createTextNode(TEXT.aiQuotaSuffix));
  }
  if($('aiQuotaRemaining')) $('aiQuotaRemaining').textContent=TEXT.aiQuotaLoading;
  if($('aiSuppressReminderLabel')) $('aiSuppressReminderLabel').textContent=TEXT.aiSuppressReminder;
  if($('aiQuotaConfirm')) $('aiQuotaConfirm').textContent=TEXT.aiQuotaConfirm;
  if($('aiQuotaDirect')) $('aiQuotaDirect').textContent=TEXT.aiQuotaDirect;
  if($('aiQuotaBack')) $('aiQuotaBack').textContent=TEXT.aiQuotaBack;
  if($('aiQuotaExemptText')) $('aiQuotaExemptText').textContent=TEXT.aiExemptNotice;
  if($('aiQuotaExemptClose')) $('aiQuotaExemptClose').setAttribute('aria-label',TEXT.aiExemptClose);
  if($('aiReportWaitingTitle')) $('aiReportWaitingTitle').textContent=TEXT.aiWaitingTitle;
  if($('aiReportWaitingBody')) $('aiReportWaitingBody').textContent=TEXT.aiWaitingBody;
  updateReportButton();
  renderLegend();
  if($('lensTitle')) $('lensTitle').textContent=TEXT.lensTitle;
  if($('speedDown')) $('speedDown').setAttribute('aria-label', TEXT.slower);
  if($('speedUp')) $('speedUp').setAttribute('aria-label', TEXT.faster);
  if($('eventlog')) $('eventlog').innerHTML = `<p>${TEXT.initLog}</p>`;
  if($('modeMenu')) $('modeMenu').setAttribute('aria-label', TEXT.modeSwitchAria);
  renderModeSwitch();
  renderGuidedPanel();
}
// The legend carries the edge colours and nothing else. It used to end with a row of five
// clickable time layers that dimmed every node not on the chosen clock; that control is gone.
// A parameter's time layer is still available where it is actually useful - on the parameter
// itself, in the model-transparency block of its card - rather than as a second, competing
// colour scheme laid over a network whose colours already mean deviation.
function renderLegend(){
  $('legend').innerHTML=`<span><i class="sw" style="background:var(--promote)"></i>${TEXT.legend[0]}</span><span><i class="sw" style="background:var(--inhibit)"></i>${TEXT.legend[1]}</span><span><i class="sw" style="background:var(--good)"></i>${TEXT.legend[2]}</span><span><i class="sw" style="background:var(--warn)"></i>${TEXT.legend[3]}</span><span><i class="sw" style="background:var(--bad)"></i>${TEXT.legend[4]}</span>`;
}
function buildScenarioSelect(){
  const category=$('scenarioCategory'), scenario=$('scenario');
  category.innerHTML=`<option value="">${TEXT.selectCategory}</option>`;
  Object.entries(meta.scenarioCategories || {}).forEach(([key,label])=>{ const opt=document.createElement('option'); opt.value=key; opt.textContent=label; category.appendChild(opt); });
  const populate=()=>{
    const selected=category.value;
    scenario.innerHTML=`<option value="">${TEXT.selectScenario}</option>`;
    Object.entries(meta.scenarios).filter(([,item])=>item.category===selected).forEach(([key,item])=>{ const opt=document.createElement('option'); opt.value=key; opt.textContent=item.label; scenario.appendChild(opt); });
    scenario.disabled=!selected;
    updateScenarioReferenceLink(scenario.value);
  };
  category.addEventListener('change',populate);
  populate();
  buildScenarioMenu();
}

// ---------------------------------------------------------------------------------------
// Disease menu: one entry, two levels
// ---------------------------------------------------------------------------------------
// Two dependent <select> elements made choosing a case a two-step transaction - pick a
// category, wait for the second control to become enabled, pick again - and the first step is
// not a decision anyone actually wants to make. A single "select a disease" entry with the
// categories as a hover-out submenu turns it back into one choice with the structure visible.
//
// The selects are still there, hidden. They remain the state and the event bus: choosing an
// item sets them and dispatches their change events, so the restart-report prompt, the session
// recorder and the learning events all fire exactly as before. Reimplementing that chain in the
// menu would have been a second copy of the most consequential handler in the file.
let scenarioMenuOpenCategory = null;
function scenarioMenuIsTouch(){
  return window.matchMedia?.('(pointer: coarse)')?.matches || isMobileLayout();
}
function buildScenarioMenu(){
  const menu=$('scenarioMenu');
  if(!menu || !meta) return;
  const byCategory={};
  Object.entries(meta.scenarios || {}).forEach(([key,item])=>{
    (byCategory[item.category] || (byCategory[item.category]=[])).push([key,item]);
  });
  menu.innerHTML=Object.entries(meta.scenarioCategories || {}).map(([catKey,catLabel])=>{
    const items=byCategory[catKey] || [];
    if(!items.length) return '';
    return `<div class="scenario-cat" data-cat="${catKey}">
      <button type="button" class="scenario-cat-btn" role="menuitem" aria-haspopup="true" aria-expanded="false">
        <span>${catLabel}</span><i class="scenario-arrow" aria-hidden="true">›</i>
      </button>
      <div class="scenario-sub" role="menu" aria-label="${catLabel}">
        ${items.map(([key,item])=>`<button type="button" class="scenario-item" role="menuitem" data-key="${key}">${item.label}</button>`).join('')}
      </div>
    </div>`;
  }).join('');
  menu.querySelectorAll('.scenario-cat').forEach(cat=>{
    const button=cat.querySelector('.scenario-cat-btn');
    // Pointer: hover opens on a fine pointer, tap toggles on a coarse one. Same handler, so a
    // hybrid device (touch laptop) behaves sensibly whichever input is actually used.
    cat.addEventListener('mouseenter', ()=>{ if(!scenarioMenuIsTouch()) openScenarioCategory(cat); });
    button.addEventListener('click', event=>{
      event.stopPropagation();
      openScenarioCategory(scenarioMenuOpenCategory===cat ? null : cat);
    });
    button.addEventListener('focus', ()=>{ if(!scenarioMenuIsTouch()) openScenarioCategory(cat); });
  });
  menu.querySelectorAll('.scenario-item').forEach(item=>{
    item.addEventListener('click', event=>{
      event.stopPropagation();
      chooseScenario(item.dataset.key);
    });
  });
}
// Opens one category at a time, and on a fine pointer decides which side the submenu unfolds to
// so it cannot run off the edge of the window.
function openScenarioCategory(cat){
  const menu=$('scenarioMenu');
  if(!menu) return;
  scenarioMenuOpenCategory=cat || null;
  menu.querySelectorAll('.scenario-cat').forEach(node=>{
    const open=node===cat;
    node.classList.toggle('open', open);
    node.querySelector('.scenario-cat-btn')?.setAttribute('aria-expanded', String(open));
  });
  if(!cat || scenarioMenuIsTouch()) return;
  const sub=cat.querySelector('.scenario-sub');
  if(!sub) return;
  sub.classList.remove('flip-left');
  const rect=sub.getBoundingClientRect();
  if(rect.right > window.innerWidth - 8) sub.classList.add('flip-left');
}
// The submenu is supposed to unfold to the RIGHT. The picker sits near the right edge of the
// header, so left as-is there is never room and it would flip to the left every single time -
// technically within the viewport, and never the behaviour asked for. So the dropdown itself is
// shifted left by however much the submenu needs, which buys the room instead of surrendering it.
const SCENARIO_SUB_WIDTH = 250;
const SCENARIO_MENU_EDGE = 8;
const SCENARIO_MENU_GAP = 5;
function positionScenarioMenu(){
  const menu=$('scenarioMenu');
  if(!menu || menu.hidden) return;
  menu.style.left='';
  if(scenarioMenuIsTouch()) return;
  const rect=menu.getBoundingClientRect();
  const overflow=(rect.right + SCENARIO_MENU_GAP + SCENARIO_SUB_WIDTH + SCENARIO_MENU_EDGE) - window.innerWidth;
  if(overflow <= 0) return;
  // Never push the dropdown itself off the left edge; if it cannot be moved far enough, the
  // per-category flip below is still there as the fallback.
  const shift=Math.min(overflow, Math.max(0, rect.left - SCENARIO_MENU_EDGE));
  if(shift > 0) menu.style.left=`${-shift}px`;
}
function openScenarioMenu(open){
  const menu=$('scenarioMenu'), button=$('scenarioMenuBtn');
  if(!menu || !button) return;
  const show=Boolean(open) && !button.disabled;
  menu.hidden=!show;
  button.setAttribute('aria-expanded', String(show));
  button.classList.toggle('open', show);
  if(show) positionScenarioMenu(); else openScenarioCategory(null);
}
function toggleScenarioMenu(){ openScenarioMenu($('scenarioMenu')?.hidden); }
// The one place the menu touches application state. Setting the category first and dispatching
// its change event is what repopulates the hidden scenario select, which the apply handler then
// reads and writes - including after it restarts the session.
function chooseScenario(key){
  const category=$('scenarioCategory'), scenario=$('scenario');
  const item=meta?.scenarios?.[key];
  if(!category || !scenario || !item) return;
  openScenarioMenu(false);
  category.value=item.category;
  category.dispatchEvent(new Event('change'));
  scenario.value=key;
  scenario.dispatchEvent(new Event('change'));
}
// The button shows what is loaded, so the header states the current case instead of a standing
// invitation to pick one.
function updateScenarioMenuLabel(key){
  const label=$('scenarioMenuLabel');
  if(!label) return;
  const name=key && meta?.scenarios?.[key]?.label;
  label.textContent=name || TEXT.selectDisease;
  $('scenarioMenuBtn')?.classList.toggle('has-scenario', Boolean(name));
}
function buildFilters(){
  const f=$('filters'); f.innerHTML='';
  const all=document.createElement('button'); all.className='filter active'; all.dataset.group='all'; all.textContent=lang==='zh'?'全部':'All'; f.appendChild(all);
  Object.entries(meta.groups).forEach(([k,v])=>{ const b=document.createElement('button'); b.className='filter'; b.dataset.group=k; b.textContent=v; applySystemColor(b,k); f.appendChild(b); });
  const custom=document.createElement('button'); custom.className='filter'; custom.dataset.group='custom'; custom.textContent=TEXT.customFilter; f.appendChild(custom);
  f.addEventListener('click', e=>{
    const b=e.target.closest('button'); if(!b) return;
    const g=b.dataset.group;
    if(g==='custom'){ openCustomParamsModal(); return; }
    applyControlFilter(g);
  });
}
function applyControlFilter(group){
  activeControlFilter=group || 'all';
  document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active', x.dataset.group===activeControlFilter));
  document.querySelectorAll('#controls .control-card').forEach(c=>{
    const hidden = activeControlFilter==='all' ? false : activeControlFilter==='custom' ? !(customControlKeys && customControlKeys.has(c.dataset.key)) : c.dataset.group!==activeControlFilter;
    c.classList.toggle('hidden', hidden);
  });
}
function customDefaults(){
  const keys = customControlKeys || new Set(meta.defs.map(d=>d.key));
  return new Set(keys);
}
function setCustomCheckboxes(checked){
  document.querySelectorAll('#customParamGroups input[type="checkbox"]').forEach(input=>{ input.checked=checked; });
}
function buildCustomParamsModal(){
  const box=$('customParamGroups'); if(!box || !meta) return;
  const selected=customDefaults();
  box.innerHTML='';
  Object.entries(meta.groups).forEach(([groupKey, groupLabel])=>{
    const group=document.createElement('section');
    group.className='custom-param-group';
    const heading=document.createElement('h3');
    heading.textContent=groupLabel;
    group.appendChild(heading);
    const list=document.createElement('div');
    list.className='custom-param-list';
    meta.defs.filter(d=>d.group===groupKey).forEach(d=>{
      const item=document.createElement('label');
      item.className='custom-param-item';
      item.innerHTML=`<input type="checkbox" value="${d.key}" ${selected.has(d.key)?'checked':''} /><span><b>${d.label}</b><small>${d.short}${d.unit?` · ${d.unit}`:''}</small></span>`;
      list.appendChild(item);
    });
    group.appendChild(list);
    box.appendChild(group);
  });
}
function openCustomParamsModal(){
  buildCustomParamsModal();
  $('customParamsModal')?.classList.add('show');
}
function closeCustomParamsModal(){
  $('customParamsModal')?.classList.remove('show');
}
function confirmCustomParams(){
  const selected=Array.from(document.querySelectorAll('#customParamGroups input[type="checkbox"]:checked')).map(input=>input.value);
  customControlKeys=new Set(selected);
  applyControlFilter('custom');
  closeCustomParamsModal();
}
// The card says the parameter's full name; the network node says its short one. In Chinese those
// two are often a Chinese phrase and a Latin abbreviation - 平均动脉压 on the card, MAP on the node -
// and nothing on screen connected them. The card now carries the abbreviation in parentheses, so a
// learner who has just clicked MAP in the diagram can find the same parameter in the console.
// Only genuinely foreign short forms qualify: a short name already written in Chinese would just
// repeat the label, which is why 心输出量 gets no suffix.
function controlCardLabel(d){
  const short=String(d.short||'').trim();
  // `血液 pH` already contains its own short form; repeating it would read as a typo.
  if(!short || short===d.label || d.label.includes(short)) return d.label;
  const foreign=/[A-Za-z]/.test(short) && !/[㐀-鿿]/.test(short);
  if(!foreign) return d.label;
  return lang==='zh' ? `${d.label}（${short}）` : d.label;
}
function createControlCard(d, extraClass=''){
  const card=document.createElement('div');
  card.className=`control-card${extraClass?` ${extraClass}`:''}`;
  card.dataset.key=d.key;
  card.dataset.group=d.group;
  applySystemColor(card, d.group);
  card.innerHTML=`<div class="dial"><div class="needle"></div></div><div class="control-meta"><div class="control-head"><span class="label">${controlCardLabel(d)}</span><span class="tag">${meta.groups[d.group]}</span><i class="state-dot"></i></div><div class="readline"><span class="value">${formatValue(d,d.base)}</span><span class="unit">${d.unit}</span></div><input class="param-slider" type="range" min="-100" max="100" value="0" step="1" /></div><div class="input-val">0</div>`;
  const input=card.querySelector('input');
  const begin=()=>{
    if(terminalObserveMode||reportStopped) return;
    if(!dragging[d.key]){
      sendLearningEvent('parameter_drag_start',learningControlAction(d.key,Number(input.value),'drag_start'));
      sessionRecorder.beginDrag(d.key,latest,Number(input.value));
    }
    dragging[d.key]=true;
  };
  const release=()=>{
    if(terminalObserveMode||reportStopped){
      dragging[d.key]=false;
      sessionRecorder.cancelDrag(d.key);
      return;
    }
    if(!dragging[d.key]) return;
    dragging[d.key]=false;
    clearTimeout(controlTimers[d.key]);
    delete controlTimers[d.key];
    sendControl(d.key,Number(input.value),'release');
  };
  input.addEventListener('pointerdown', begin);
  input.addEventListener('mousedown', begin);
  input.addEventListener('touchstart', begin, {passive:true});
  input.addEventListener('input',()=>{
    if(terminalObserveMode||reportStopped) return;
    if(!dragging[d.key]) begin();
    sessionRecorder.markDragChanged(d.key,simulationStatus());
    updateReportButton();
    updateSingleControlVisual(card,Number(input.value),Number(input.value),'normal');
    scheduleControl(d.key,Number(input.value));
  });
  ['pointerup','change','blur','mouseup','touchend','touchcancel'].forEach(ev=>input.addEventListener(ev,release));
  card.addEventListener('dblclick',()=>{ if(terminalObserveMode||reportStopped) return; input.value=0; sendControl(d.key,0,'double_click_zero'); });
  card.addEventListener('click',()=>selectParam(d.key));
  return card;
}
function buildControls(){
  const box=$('controls'); box.innerHTML='';
  meta.defs.forEach(d=>box.appendChild(createControlCard(d)));
  applyControlFilter(activeControlFilter);
}
function mobileNodeControlAnchor(key){
  return document.querySelector(`.network-wrap .node[data-key="${key}"]`)?.getBoundingClientRect() || mobileNodeControlAnchorRect;
}
function positionMobileNodeControl(){
  const popover=$('mobileNodeControlPopover');
  if(!popover || popover.hidden || !mobileNodeControlKey) return;
  const anchor=mobileNodeControlAnchor(mobileNodeControlKey);
  if(!anchor) return;
  const vv=window.visualViewport;
  const viewLeft=vv?.offsetLeft || 0;
  const viewTop=vv?.offsetTop || 0;
  const viewWidth=vv?.width || window.innerWidth;
  const viewHeight=vv?.height || window.innerHeight;
  const margin=12, gap=12;
  const popRect=popover.getBoundingClientRect();
  const popWidth=popRect.width, popHeight=popRect.height;
  const viewRight=viewLeft+viewWidth, viewBottom=viewTop+viewHeight;
  const anchorCenter=(anchor.left+anchor.right)/2;
  const anchorMiddle=(anchor.top+anchor.bottom)/2;
  let left, top, placement;
  if(isMobileLayout()){
    const roomBelow=viewBottom-margin-anchor.bottom;
    const roomAbove=anchor.top-viewTop-margin;
    const placeBelow=roomBelow>=popHeight+gap || roomBelow>=roomAbove;
    top=clip(placeBelow ? anchor.bottom+gap : anchor.top-gap-popHeight,viewTop+margin,Math.max(viewTop+margin,viewBottom-margin-popHeight));
    left=clip(anchorCenter-popWidth/2,viewLeft+margin,Math.max(viewLeft+margin,viewRight-margin-popWidth));
    placement=placeBelow?'below':'above';
  }else{
    const roomRight=viewRight-margin-anchor.right;
    const roomLeft=anchor.left-viewLeft-margin;
    const placeRight=roomRight>=popWidth+gap || roomRight>=roomLeft;
    left=clip(placeRight ? anchor.right+gap : anchor.left-gap-popWidth,viewLeft+margin,Math.max(viewLeft+margin,viewRight-margin-popWidth));
    top=clip(anchorMiddle-popHeight/2,viewTop+margin,Math.max(viewTop+margin,viewBottom-margin-popHeight));
    placement=placeRight?'right':'left';
  }
  popover.style.left=`${Math.round(left)}px`;
  popover.style.top=`${Math.round(top)}px`;
  popover.style.setProperty('--mobile-control-arrow-left',`${Math.round(clip(anchorCenter-left,18,popWidth-18))}px`);
  popover.style.setProperty('--node-control-arrow-top',`${Math.round(clip(anchorMiddle-top,18,popHeight-18))}px`);
  popover.dataset.placement=placement;
  popover.style.visibility='visible';
}
function scheduleMobileNodeControlPosition(){
  cancelAnimationFrame(mobileNodeControlPositionRaf);
  mobileNodeControlPositionRaf=requestAnimationFrame(positionMobileNodeControl);
}
function closeMobileNodeControl(){
  const popover=$('mobileNodeControlPopover');
  const slot=$('mobileNodeControlSlot');
  if(mobileNodeControlKey){
    const closingKey=mobileNodeControlKey;
    const input=slot?.querySelector('.param-slider');
    const shouldCommit=Boolean(dragging[closingKey]&&input&&!terminalObserveMode&&!reportStopped);
    dragging[closingKey]=false;
    clearTimeout(controlTimers[closingKey]);
    delete controlTimers[closingKey];
    if(shouldCommit) sendControl(closingKey,Number(input.value),'release');
    else sessionRecorder.cancelDrag(closingKey);
  }
  mobileNodeControlKey=null;
  mobileNodeControlAnchorRect=null;
  cancelAnimationFrame(mobileNodeControlPositionRaf);
  if(slot) slot.replaceChildren();
  if(popover){
    popover.hidden=true;
    popover.style.visibility='hidden';
    popover.removeAttribute('data-placement');
  }
}
function openMobileNodeControl(key, anchorRect){
  if(!meta || !latest) return;
  const d=defByKey(key), p=paramByKey(key);
  const popover=$('mobileNodeControlPopover'), slot=$('mobileNodeControlSlot');
  if(!d || !p || !popover || !slot) return;
  closeMobileNodeControl();
  mobileNodeControlKey=key;
  mobileNodeControlAnchorRect=anchorRect || mobileNodeControlAnchor(key);
  const card=createControlCard(d,'mobile-node-control-card');
  slot.replaceChildren(card);
  renderControlCard(card,p);
  card.querySelector('.param-slider').disabled=terminalObserveMode||reportStopped;
  popover.setAttribute('aria-label',d.label);
  $('mobileNodeControlClose')?.setAttribute('aria-label',lang==='zh'?'关闭参数控制':'Close parameter control');
  popover.hidden=false;
  popover.style.visibility='hidden';
  scheduleMobileNodeControlPosition();
}
function formatValue(d,v){
  if(d.unit==='') return Number(v).toFixed(2);
  if(Math.abs(d.scale)<1 || d.unit==='relative' || d.unit==='相对值' || d.key==='tpr' || d.key==='airway') return Number(v).toFixed(2);
  if(['co','bloodVolume','ventilation','urine','lactate','potassium'].includes(d.key)) return Number(v).toFixed(1);
  return Math.round(v).toString();
}
function scheduleControl(k,v){
  clearTimeout(controlTimers[k]);
  controlTimers[k]=setTimeout(()=>{
    delete controlTimers[k];
    sendControl(k,v,'drag');
  },90);
}
async function sendControl(k,v,source='commit'){
  if(!sid || terminalObserveMode || reportStopped) return;
  const prior=controlRequestChains[k]||Promise.resolve();
  const request=Promise.resolve(prior).catch(()=>null).then(async()=>{
    if(!sid) return;
    const beforeSnapshot=latest;
    const before=learningParamSummary(paramByKey(k));
    const controlBefore=Number(paramByKey(k)?.control);
    // `caution` is only requested in the modes that show it, so the full console does not pay
    // for a judgement it will not display. A guided perturbation is never cautioned: the app
    // just asked for that exact drag, and warning the learner for following the assignment
    // would contradict the promise that this mode is safe to perturb. The caution exists for
    // the learner's OWN drags - reading MAP 84 and hauling the pressure slider up, which is
    // treating the number rather than the cause.
    const wantCaution=cautionEnabled() && source!=='guided_perturbation';
    // Marked before the call, not after the recorder: a drag reports through finishDrag on
    // release, which is seconds after the moment the learner actually started moving things.
    markReplayFirstAction();
    latest=await api(`/api/session/${sid}/control`,{key:k,value:v,caution:wantCaution});
    renderSnapshot(latest);
    if(latest.caution) noteControlCaution(latest.caution); else if(wantCaution) clearControlCaution(k);
    if(source==='release'){
      sessionRecorder.finishDrag(k,latest,v,simulationStatus());
    }else if(source!=='drag'){
      sessionRecorder.recordParameterAction({
        key:k,
        beforeSnapshot,
        afterSnapshot:latest,
        source:source==='double_click_zero'?'button':'other',
        phase:'ended',
        interventionType:source,
        controlBefore,
        controlAfter:Number(v),
        status:simulationStatus()
      });
    }
    updateReportButton();
    if(shouldLogLearningControl(k,v,source)){
      sendLearningEvent('parameter_change',{
        ...learningControlAction(k,v,source),
        before,
        after:learningParamSummary(paramByKey(k))
      },{snapshot:latest});
    }
  }).catch(error=>{
    console.error(error);
    if(source==='release') sessionRecorder.cancelDrag(k);
  });
  controlRequestChains[k]=request;
  return request;
}
function showRestartReportPrompt(action=performRestartSession){
  pendingRestartAction=action;
  restartPromptPreviousPaused=paused;
  restartPromptRestoreGameOver=Boolean($('gameOverModal')?.classList.contains('show'));
  paused=true;
  const pauseButton=$('pauseBtn');
  if(pauseButton) pauseButton.textContent=TEXT.resume;
  hideGameOverModal();
  $('restartReportModal')?.classList.add('show');
}
function hideRestartReportPrompt({restoreSession=false}={}){
  $('restartReportModal')?.classList.remove('show');
  if(restoreSession){
    paused=restartPromptPreviousPaused;
    const pauseButton=$('pauseBtn');
    if(pauseButton) pauseButton.textContent=paused?TEXT.resume:TEXT.pause;
    if(restartPromptRestoreGameOver){
      $('gameOverModal')?.classList.add('show');
      gameOverShown=true;
    }
  }
  pendingRestartAction=null;
  restartPromptRestoreGameOver=false;
}
async function restartSession(){
  if(sessionRecorder.active&&!reportDownloadedForCurrentSession){
    showRestartReportPrompt(performRestartSession);
    return;
  }
  return performRestartSession();
}
async function performRestartSession(){
  if(!sid) return;
  await logAiPromptForSession('restart');
  exitReplay({silent:true, skipRender:true});
  hideRestartReportPrompt();
  closeMobileNodeControl();
  cancelScheduledControls();
  clearNetworkTopologyLayoutImmediately();
  setTerminalObserveMode(false);
  reportStopped=false;
  latest=await api(`/api/session/${sid}/reset`, {});
  selectedKey=null;
  modelTransparencyOpen=false;
  paused=false;
  learningSimStartedAtPerf=performance.now();
  learningFailureLogged=false;
  learningImbalanceActive=false;
  lastTick=performance.now();
  lastFetch=0;
  sessionRecorder.reset(meta);
  reportDownloadedForCurrentSession=false;
  resetReplayRecording();
  activeLesson=null;
  controlCautions.clear();
  activatedNodes.clear();
  renderGuidedPanel();
  $('scenario').value='';
  if($('scenarioCategory')) $('scenarioCategory').value='';
  if($('scenario')) $('scenario').disabled=true;
  updateScenarioReferenceLink('');
  learningUserActionType='random';
  if($('scenarioMenuBtn')) $('scenarioMenuBtn').setAttribute('aria-label', TEXT.selectDiseaseAria);
  updateScenarioMenuLabel($('scenario')?.value || '');
  $('pauseBtn').textContent=TEXT.pause;
  applyInteractionLocks();
  hideGameOverModal();
  renderSnapshot(latest);
  networkIntro=createNetworkRestartIntro();
  renderNetwork(latest, true);
  startNetworkIntroAnimation();
  networkUserNavigated=false;
  scheduleNetworkFitBurst(true);
  sendLearningEvent('restart_session', {backendSid:sid, simTime: latest ? learningRound(latest.simTime, 1) : null}, {snapshot:latest});
}
function paramByKey(k){ return latest?.params?.find(p=>p.key===k); }
function defByKey(k){ return meta?.defs?.find(d=>d.key===k); }
function updateSingleControlVisual(card, displayBias, stateBias, zone){
  const visualDisplay=emphasizeBias(displayBias), visualState=emphasizeBias(stateBias);
  const displayColor=heatColorFromBias(visualDisplay), stateColor=heatColorFromBias(visualState);
  const input=card.querySelector('input'), needle=card.querySelector('.needle'), dot=card.querySelector('.state-dot');
  card.querySelector('.input-val').textContent=(displayBias>0?'+':'')+Math.round(displayBias);
  card.querySelector('.input-val').style.color=displayColor;
  needle.style.transform=`translateX(-50%) rotate(${displayBias*1.35}deg)`; needle.style.background=displayColor; needle.style.color=displayColor;
  dot.style.background=stateColor; dot.style.color=stateColor; dot.style.boxShadow=`0 0 10px ${stateColor}`;
  input.style.setProperty('--thumb-color', displayColor); input.style.background=sliderTrackBackground(visualDisplay); input.style.boxShadow=`inset 0 0 0 1px rgba(255,255,255,.05), 0 0 0 1px rgba(0,0,0,.16), 0 0 12px ${hexToRgba(displayColor,.26)}`;
  card.style.borderColor=zoneBorder(zone);
  card.style.boxShadow=`inset 0 0 0 1px ${displayColor}44, 0 0 10px ${hexToRgba(displayColor,.12)}`;
}
function renderControls(snap){
  snap.params.forEach(p=>{
    document.querySelectorAll(`.control-card[data-key="${p.key}"]`).forEach(card=>renderControlCard(card,p));
  });
}
function renderControlCard(card,p){
  if(!card || !p) return;
  card.querySelector('.value').textContent=p.valueText;
  if(!dragging[p.key]) card.querySelector('input').value=Math.round(p.displayBias);
  updateSingleControlVisual(card,p.displayBias,p.stateBias,p.zone);
}

// ---------------------------------------------------------------------------------------
// Replay console
// ---------------------------------------------------------------------------------------
// The panel under the network used to be twelve sparkline gauges. They answered "what did this
// one number do recently", which is the question the network already answers better and in
// context - and the panel was collapsed by most people most of the time.
//
// What it could not answer is the question a learner actually asks after a run: WHEN did that
// happen, and in what order. So the space is now a tape deck for the session itself. Every frame
// the engine returns is kept, and the transport walks back through them: the network re-lights in
// the order the signal actually travelled, the stability bar falls again at the pace it fell, and
// the guide/assessment panel says what it said at that moment.
//
// TWO SPEEDS, AND THEY DO NOT COLLIDE.
//
//   Time scale + speed (right column) belong to the ENGINE. They set how much simulated time one
//   real second buys, and they only mean anything while the engine is running.
//   Replay speed belongs to the TAPE. Frames carry the moment they were recorded, so playback at
//   ×1 reproduces the run at the pace it was watched, whatever compression was in force at the
//   time - including compression that CHANGED mid-run.
//
// The two never fight because they never apply at once: entering replay pauses the engine, and
// leaving it hands the live snapshot back untouched. Replay never writes to the engine and never
// touches lensId or speedIndex.
const REPLAY_MAX_FRAMES = 1200;
// Dead air is trimmed to one second. Frames are only produced while the engine is running, so a
// pause, a switch to another tab or a minute spent reading the assessment panel would otherwise
// be recorded at full length and played back at full length - scrubbing into a stretch where
// nothing happens for three minutes, at ×1, is not a replay of anything.
const REPLAY_MAX_FRAME_GAP_MS = 1000;
// The tape starts AT the first thing the learner did. Everything before it is a steady baseline
// nobody needs to sit through, and it is usually the longest stretch of the run - the console is
// being read, the case is being thought about, nothing is moving.
//
// And with no action recorded there is nothing to replay at all: a run in which nobody touched
// anything is a flat line, and offering to play it back would be offering to play back nothing.
// The transport says so rather than rolling an empty tape.
const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const REPLAY_DEFAULT_SPEED_INDEX = 2;
const REPLAY_SCRUB_STEPS = 1000;
let replayFrames = [];
let replayFirstActionWall = null;   // tape position of the first recorded intervention
let replayActive = false;
let replayPlaying = false;
let replaySpeedIndex = REPLAY_DEFAULT_SPEED_INDEX;
let replayClock = 0;            // ms along the recorded wall-clock timeline
let replayRaf = 0;
let replayLastFrameAt = 0;
let replayLiveSnapshot = null;  // the live snapshot parked while the tape drives `latest`
let replayScrubbing = false;
let replayActivationIndex = -1; // how far the replay-local colour latch has been filled in
let replayTapeClock = 0;        // position on the tape, which is real time with dead air trimmed
let replayLastRecordAt = 0;
// The lens the transport is currently displaying. Null while live, so the console falls back to
// the engine's own lensId; set from the frame during replay. It NEVER writes to lensId - doing so
// would hand the engine a different scale the moment the learner returned to live.
let replayDisplayLens = null;
let replayDisplayCompression = null;

// ---------------------------------------------------------------------------------------
// Session diagnostics carried into the AI report
// ---------------------------------------------------------------------------------------
// Two things the report needs that no single snapshot can answer.
//
// VICIOUS CYCLES over the whole run, not just at the end. The server attaches the loops that are
// live at the instant the report is requested, which silently loses the most teachable case of
// all: a loop that formed and was then BROKEN. That is a result the learner achieved, and under
// the old shape it looked identical to a loop that never existed. So each loop is remembered by
// id with the worst severity it reached and whether it was still running at the end.
//
// TIME SCALE, which is how the learner watched rather than what they did. It is judged separately
// in the report, because a conclusion drawn at a compression where nothing was legible is a
// scale problem before it is a reasoning problem.
const sessionCycleLog = new Map();
const sessionTimeScale = {
  lensSeconds:{},                    // real seconds spent watching through each lens
  peakCompression:0,
  manualLensSwitches:0,
  autoEverOn:true,
  heldBackEvents:0,
  illegibleSeconds:0,
  fastFailureUnderManualScale:false
};
let sessionDiagnosticsAt = 0;
let sessionHeldBackWas = false;
function resetSessionDiagnostics(){
  sessionCycleLog.clear();
  sessionTimeScale.lensSeconds={};
  sessionTimeScale.peakCompression=0;
  sessionTimeScale.manualLensSwitches=0;
  sessionTimeScale.autoEverOn=autoLensEnabled;
  sessionTimeScale.heldBackEvents=0;
  sessionTimeScale.illegibleSeconds=0;
  sessionTimeScale.fastFailureUnderManualScale=false;
  sessionDiagnosticsAt=performance.now();
  sessionHeldBackWas=false;
}
function trackSessionDiagnostics(snap){
  if(!snap) return;
  const now=performance.now();
  // Only real time actually spent watching counts. A frame that arrives after a long gap means
  // the tab was hidden or the engine was paused, and nobody was watching anything.
  const deltaSeconds=clip((now-sessionDiagnosticsAt)/1000, 0, 2);
  sessionDiagnosticsAt=now;
  const compression=currentCompression();
  sessionTimeScale.lensSeconds[lensId]=(sessionTimeScale.lensSeconds[lensId]||0)+deltaSeconds;
  sessionTimeScale.peakCompression=Math.max(sessionTimeScale.peakCompression, compression);
  if(autoLensEnabled) sessionTimeScale.autoEverOn=true;
  const ceiling=snap.temporal?.maxCompression;
  if(Number.isFinite(ceiling) && compression > ceiling) sessionTimeScale.illegibleSeconds+=deltaSeconds;
  const heldBack=Boolean(snap.temporal?.heldBack);
  if(heldBack && !sessionHeldBackWas) sessionTimeScale.heldBackEvents+=1;
  sessionHeldBackWas=heldBack;
  (snap.viciousCycles||[]).forEach(cycle=>{
    if(!cycle?.id) return;
    const seen=sessionCycleLog.get(cycle.id);
    const severity=Number(cycle.severity)||0;
    if(seen){
      seen.peakSeverity=Math.max(seen.peakSeverity, severity);
      seen.lastSeen=snap.simTime;
    }else{
      sessionCycleLog.set(cycle.id, {
        id:cycle.id, name:cycle.name, path:cycle.path||[], steps:cycle.steps||'',
        breakPoint:cycle.breakPoint||'', peakSeverity:severity,
        firstSeen:snap.simTime, lastSeen:snap.simTime
      });
    }
  });
}
function sessionCycleHistory(snap=latest){
  const live=new Set((snap?.viciousCycles||[]).map(cycle=>cycle.id));
  return [...sessionCycleLog.values()]
    .map(cycle=>({...cycle, activeAtEnd:live.has(cycle.id)}))
    .sort((a,b)=>b.peakSeverity-a.peakSeverity)
    .slice(0,6);
}

function replaySpeed(){ return REPLAY_SPEEDS[replaySpeedIndex] ?? 1; }
// Where the tape begins: the first recorded intervention. The frames before it are kept -
// compaction and the restart check both walk the whole array - they are simply never played, so
// every position the transport reports is measured from here rather than from the first frame
// ever recorded.
function replayStartIndex(){
  if(replayFirstActionWall == null || replayFrames.length < 2) return 0;
  let index=0;
  while(index < replayFrames.length-1 && replayFrames[index].wall < replayFirstActionWall) index++;
  return index;
}
// No intervention means no tape. This is a real refusal, not an empty one: the transport is
// disabled and pressing it says why.
function replayHasTape(){
  return replayFirstActionWall != null && replayFrames.length - replayStartIndex() >= 2;
}
function replayDuration(){
  if(!replayHasTape()) return 0;
  return replayFrames[replayFrames.length-1].wall - replayFrames[replayStartIndex()].wall;
}
// Called the first time the learner does anything the session report counts as an intervention.
function markReplayFirstAction(){
  if(replayFirstActionWall != null || replayActive) return;
  replayFirstActionWall=replayTapeClock;
}
// Halving the tape by merging adjacent frames: the later of each pair survives with the earlier
// one's timestamp, so a long session keeps its full span at declining resolution rather than
// losing its beginning. Dropping the oldest frames instead would throw away the part of the run
// a learner most often wants to go back to - how it started.
function compactReplayFrames(){
  const merged=[];
  for(let i=0; i<replayFrames.length; i+=2){
    const a=replayFrames[i], b=replayFrames[i+1] || replayFrames[i];
    merged.push({wall:a.wall, snap:b.snap});
  }
  replayFrames=merged;
}
function resetReplayRecording(){
  exitReplay({silent:true, skipRender:true});
  resetSessionDiagnostics();
  aiPromptLoggedForSession=false;
  replayFrames=[];
  replayClock=0;
  replayTapeClock=0;
  replayLastRecordAt=0;
  replayFirstActionWall=null;
  updateReplayConsole();
}
function recordReplayFrame(snap){
  if(!snap || replayActive) return;
  const now=performance.now();
  const last=replayFrames[replayFrames.length-1];
  // A restart rewinds simulated time; the tape restarts with it.
  if(last && Number(snap.simTime) < Number(last.snap.simTime) - 0.001){
    replayFrames=[];
    replayTapeClock=0;
    replayFirstActionWall=null;
  }
  replayTapeClock += replayFrames.length
    ? clip(now-replayLastRecordAt, 0, REPLAY_MAX_FRAME_GAP_MS)
    : 0;
  replayLastRecordAt=now;
  // The lens is recorded with the frame, not looked up at playback time: the whole point is to
  // show the scale that was in force at THAT moment, including one that changed mid-run.
  replayFrames.push({wall:replayTapeClock, snap, lens:lensId, compression:currentCompression()});
  if(replayFrames.length > REPLAY_MAX_FRAMES) compactReplayFrames();
}
function replayFrameIndexAt(clockMs){
  if(!replayFrames.length) return 0;
  const start=replayStartIndex();
  const target=replayFrames[start].wall + clockMs;
  let low=start, high=replayFrames.length-1;
  while(low < high){
    const mid=(low+high+1)>>1;
    if(replayFrames[mid].wall <= target) low=mid; else high=mid-1;
  }
  return low;
}
function addReplayActivation(snap){
  (snap?.params || []).forEach(p=>{ if(isNodeActive(p)) replayActivatedNodes.add(p.key); });
}
// Scrubbing backwards has to un-light nodes, so a jump to an earlier point rebuilds the latch from
// the start; moving forward only tops it up.
function syncReplayActivation(index){
  const floor=replayStartIndex()-1;
  if(index < replayActivationIndex || replayActivationIndex < floor){
    replayActivatedNodes.clear();
    replayActivationIndex=floor;
  }
  for(let i=replayActivationIndex+1; i<=index && i<replayFrames.length; i++) addReplayActivation(replayFrames[i].snap);
  replayActivationIndex=Math.min(index, replayFrames.length-1);
}
// Everything a snapshot drives on screen, with none of the bookkeeping renderSnapshot does.
// A replayed frame must not be re-recorded, must not be handed to the session report, and must
// not re-trigger the game-over modal for a death that already happened.
function renderHistoryFrame(snap){
  if(!snap) return;
  latest=snap;
  renderControls(snap);
  renderNetwork(snap, true);
  renderConditions(snap);
  renderStatus(snap);
  if(selectedKey) selectParam(selectedKey, false, false);
}
function showReplayFrameAt(index){
  const frame=replayFrames[clip(index, replayStartIndex(), replayFrames.length-1)];
  if(!frame) return;
  syncReplayActivation(index);
  // The time-scale console follows the tape: the tab that lights up is the scale this moment was
  // actually watched at, so a run that switched from seconds to hours replays that switch too.
  replayDisplayLens=frame.lens || lensId;
  replayDisplayCompression=Number.isFinite(frame.compression) ? frame.compression : null;
  renderHistoryFrame(frame.snap);
}
function enterReplay({silent=false}={}){
  if(replayActive) return true;
  if(!replayHasTape()){ if(!silent) toast(TEXT.replayEmpty); return false; }
  replayActive=true;
  replayLiveSnapshot=latest;
  replayClock=0;
  replayActivatedNodes.clear();
  replayActivationIndex=replayStartIndex()-1;
  closeMobileNodeControl();
  applyInteractionLocks();
  showReplayFrameAt(replayStartIndex());
  if(!silent) toast(TEXT.replayEnter);
  sendLearningEvent('replay_enter', {frames:replayFrames.length, durationMs:Math.round(replayDuration())});
  return true;
}
function exitReplay({silent=false, skipRender=false}={}){
  if(!replayActive) return;
  stopReplayPlayback();
  replayActive=false;
  // The console goes back to reporting the engine's own scale the instant the tape stops.
  replayDisplayLens=null;
  replayDisplayCompression=null;
  const live=replayLiveSnapshot;
  replayLiveSnapshot=null;
  if(live && !skipRender) renderHistoryFrame(live);
  else if(live) latest=live;
  applyInteractionLocks();
  renderTimeConsole();
  lastTick=performance.now();
  lastFetch=0;
  // Replaying from the failure card dismisses it. Coming back off the tape has to put it back,
  // or the run ends with "continue observing" and "download report" gone and nothing said about
  // why - the engine is stopped at zero stability, so no tick would ever re-raise it.
  if(!skipRender && !terminalObserveMode && live && !live.noThreat && (live.dead || live.health <= 0)) showGameOverModal(live);
  if(!silent) toast(TEXT.replayExit);
  if(!silent) sendLearningEvent('replay_exit', {simTime: latest ? learningRound(latest.simTime, 1) : null});
}
function stopReplayPlayback(){
  replayPlaying=false;
  cancelAnimationFrame(replayRaf);
  replayRaf=0;
  updateReplayConsole();
}
function startReplayPlayback(){
  if(!enterReplay()) return;
  if(replayPlaying) return;
  // Restarting from the very end would show a single frozen frame, so the tape rewinds first.
  if(replayClock >= replayDuration() - 1) replayClock=0;
  replayPlaying=true;
  replayLastFrameAt=performance.now();
  cancelAnimationFrame(replayRaf);
  replayRaf=requestAnimationFrame(stepReplay);
  updateReplayConsole();
}
function stepReplay(now){
  if(!replayPlaying || !replayActive) return;
  const elapsed=now-replayLastFrameAt;
  replayLastFrameAt=now;
  replayClock=Math.min(replayDuration(), replayClock + elapsed*replaySpeed());
  showReplayFrameAt(replayFrameIndexAt(replayClock));
  updateReplayConsole();
  if(replayClock >= replayDuration()){ stopReplayPlayback(); return; }
  replayRaf=requestAnimationFrame(stepReplay);
}
function seekReplay(clockMs, {fromScrub=false}={}){
  if(!enterReplay({silent:fromScrub})) return;
  replayClock=clip(clockMs, 0, replayDuration());
  replayLastFrameAt=performance.now();
  showReplayFrameAt(replayFrameIndexAt(replayClock));
  updateReplayConsole();
}
function setReplaySpeedIndex(index){
  const next=clip(Math.round(index), 0, REPLAY_SPEEDS.length-1);
  if(next === replaySpeedIndex) return;
  replaySpeedIndex=next;
  updateReplayConsole();
  sendLearningEvent('replay_speed_change', {speed:replaySpeed()});
}
function buildReplaySpeedButtons(){
  const box=$('replaySpeed');
  if(!box || box.dataset.ready === '1') return;
  box.innerHTML=REPLAY_SPEEDS.map((value,index)=>
    `<button type="button" class="replay-speed-btn" data-index="${index}">×${value}</button>`).join('');
  box.querySelectorAll('.replay-speed-btn').forEach(button=>
    button.addEventListener('click', ()=>setReplaySpeedIndex(Number(button.dataset.index))));
  box.dataset.ready='1';
}
function updateReplayConsole(){
  const duration=replayDuration();
  const hasTape=replayHasTape();
  const playButton=$('replayPlay');
  if(playButton){
    playButton.textContent=replayPlaying ? TEXT.replayPause : TEXT.replayPlay;
    // Deliberately NOT disabled when there is no tape. A greyed-out button leaves the learner
    // guessing why; a live one that answers "you have not intervened yet" teaches the rule.
    playButton.disabled=false;
    playButton.classList.toggle('active', replayPlaying);
    playButton.classList.toggle('empty', !hasTape);
    playButton.title=hasTape ? '' : TEXT.replayEmpty;
  }
  const startButton=$('replayToStart');
  if(startButton){
    startButton.disabled=false;
    startButton.classList.toggle('empty', !hasTape);
    startButton.setAttribute('aria-label', TEXT.replayToStartAria);
    startButton.title=hasTape ? TEXT.replayToStart : TEXT.replayEmpty;
  }
  const liveButton=$('replayLive');
  if(liveButton){
    liveButton.textContent=TEXT.replayLive;
    liveButton.disabled=!replayActive;
  }
  const scrub=$('replayScrub');
  if(scrub && !replayScrubbing){
    scrub.disabled=!hasTape;
    scrub.max=String(REPLAY_SCRUB_STEPS);
    const position=replayActive ? (duration>0 ? replayClock/duration : 0) : 1;
    scrub.value=String(Math.round(position*REPLAY_SCRUB_STEPS));
  }
  const readout=$('replayReadout');
  if(readout){
    const at=replayActive ? replayFrames[replayFrameIndexAt(replayClock)]?.snap?.simTime : latest?.simTime;
    const total=replayFrames[replayFrames.length-1]?.snap?.simTime;
    readout.textContent=TEXT.replayReadout(formatSimDuration(at || 0), formatSimDuration(total || 0));
  }
  document.querySelectorAll('.replay-speed-btn').forEach(button=>{
    const active=Number(button.dataset.index) === replaySpeedIndex;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function isMobileNetworkView(){
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrow = window.matchMedia?.('(max-width: 860px)')?.matches;
  const vv = window.visualViewport;
  const vw = vv?.width || window.innerWidth || document.documentElement.clientWidth || 0;
  return Boolean(narrow || (coarse && vw < 980));
}
function scheduleNetworkFitBurst(force=false){
  networkFitBurstTimers.forEach(clearTimeout);
  networkFitBurstTimers=[];
  const mobile=isMobileNetworkView();
  const delays=mobile ? [0,120,360,820,1400] : [0,160,420];
  delays.forEach(delay=>{
    const id=setTimeout(()=>{
      if(force) networkUserNavigated=false;
      scheduleNetworkFit(force);
    }, delay);
    networkFitBurstTimers.push(id);
  });
}
function estimateNetworkLabelWidth(text, isGroup=false){
  if(!text) return 0;
  const zh = /[\u3400-\u9fff]/.test(text);
  const perChar = isGroup ? (zh ? 18 : 10) : (zh ? 13 : 7.5);
  return Math.max(isGroup ? 44 : 28, String(text).length * perChar);
}
// ---------------------------------------------------------------------------------------
// Aspect adaptation: making the diagram the shape of the space it is in
// ---------------------------------------------------------------------------------------
// The layout the backend publishes is a fixed 920x580 picture, about 1.59 wide to tall. The panel
// it is drawn into is almost never that shape: hide the intervention console and the right column
// and the centre becomes very wide, and a phone makes it very tall. Fitting a fixed-aspect
// picture into a differently-shaped box wastes the whole difference as empty gutter - and worse,
// the scale is pinned by whichever axis ran out first, so the nodes stay small while a third of
// the panel sits empty beside them.
//
// So the node COORDINATES are remapped to the shape of the panel, about the centre of the design
// space, area-preserving: squeeze one axis by sqrt(r) and stretch the other by 1/sqrt(r). Same
// nodes, same edges, same total footprint - a different rectangle. Because the footprint now
// matches the panel, the uniform fit scale rises, and with it every glyph on screen: node radius,
// label text, value text and edge width all grow together, since they are all carried by the one
// CSS scale on the stage. On a phone this is worth roughly a quarter to a third more size.
//
// This is a VIEW transform, not a layout edit. `networkNodePositions` stays in design space, so
// dragging, the reset-layout button, the topology view and the saved layout all keep working on
// the same numbers they always did; pointer deltas are simply divided back out (see
// moveNetworkPointerInteraction). The exponent is damped and the ratio clamped, because a
// perfectly matched aspect on an extremely wide panel would flatten the diagram into a line.
const NETWORK_SPREAD_DAMPING = 0.78;
const NETWORK_SPREAD_RATIO_MIN = 0.42;
const NETWORK_SPREAD_RATIO_MAX = 2.4;
const NETWORK_SPREAD_DEADZONE = 0.06;
const NETWORK_SPREAD_EPSILON = 0.015;
let networkSpreadX = 1;
let networkSpreadY = 1;
function networkSpreadPoint(x, y){
  if(networkSpreadX === 1 && networkSpreadY === 1) return [x, y];
  const cx=NETWORK_VIEWBOX_WIDTH/2, cy=NETWORK_VIEWBOX_HEIGHT/2;
  return [cx + (x-cx)*networkSpreadX, cy + (y-cy)*networkSpreadY];
}
function networkSpreadPositions(positions){
  if(networkSpreadX === 1 && networkSpreadY === 1) return positions;
  return Object.fromEntries(Object.entries(positions || {}).map(([key,[x,y]])=>[key, networkSpreadPoint(x,y)]));
}
// The space the diagram actually has, which is the panel minus the same margins the fit uses and,
// on a phone, minus the legend pill that floats over the bottom of it.
function networkAvailableArea(){
  const canvas=document.querySelector('.network-canvas');
  if(!canvas) return null;
  const rect=canvas.getBoundingClientRect();
  if(rect.width<80 || rect.height<80) return null;
  const mobile=isMobileNetworkView();
  const margin=mobile ? NETWORK_MOBILE_FIT_MARGIN : NETWORK_FIT_MARGIN;
  const legend=$('legend');
  const legendH=legend ? Math.max(NETWORK_MOBILE_LEGEND_RESERVE, legend.getBoundingClientRect().height || 0) : NETWORK_MOBILE_LEGEND_RESERVE;
  return {
    width: Math.max(80, rect.width-margin*2),
    height: Math.max(80, rect.height-margin*2-(mobile ? legendH+18 : 0))
  };
}
function updateNetworkAspectSpread(){
  const area=networkAvailableArea();
  if(!area || !meta?.positions) return false;
  const previousX=networkSpreadX, previousY=networkSpreadY;
  networkSpreadX=1; networkSpreadY=1;               // measure the design-space shape undistorted
  const base=networkContentBounds();
  const contentAspect=base.width/Math.max(1, base.height);
  const panelAspect=area.width/Math.max(1, area.height);
  const raw=panelAspect/Math.max(0.01, contentAspect);
  if(Math.abs(raw-1) <= NETWORK_SPREAD_DEADZONE){
    networkSpreadX=1; networkSpreadY=1;
  }else{
    const ratio=clip(raw, NETWORK_SPREAD_RATIO_MIN, NETWORK_SPREAD_RATIO_MAX);
    const exponent=0.5*NETWORK_SPREAD_DAMPING;
    networkSpreadX=Math.pow(ratio, exponent);
    networkSpreadY=Math.pow(ratio, -exponent);
  }
  const changed=Math.abs(networkSpreadX-previousX) > NETWORK_SPREAD_EPSILON
    || Math.abs(networkSpreadY-previousY) > NETWORK_SPREAD_EPSILON;
  if(!changed){ networkSpreadX=previousX; networkSpreadY=previousY; }
  return changed;
}
function networkContentBounds(contentPositions=networkNodePositions || meta?.positions, includeSystemLabels=!networkTopologyLayoutActive){
  if(!meta || !meta.positions) return {minX:0,minY:-12,maxX:NETWORK_VIEWBOX_WIDTH,maxY:NETWORK_VIEWBOX_HEIGHT,width:NETWORK_VIEWBOX_WIDTH,height:NETWORK_VIEWBOX_HEIGHT,cx:NETWORK_VIEWBOX_WIDTH/2,cy:NETWORK_VIEWBOX_HEIGHT/2};
  const pts=Object.entries(contentPositions);
  if(!pts.length) return {minX:0,minY:-12,maxX:NETWORK_VIEWBOX_WIDTH,maxY:NETWORK_VIEWBOX_HEIGHT,width:NETWORK_VIEWBOX_WIDTH,height:NETWORK_VIEWBOX_HEIGHT,cx:NETWORK_VIEWBOX_WIDTH/2,cy:NETWORK_VIEWBOX_HEIGHT/2};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  pts.forEach(([key,position])=>{
    // Node glyphs are added AFTER the spread, because a circle stays a circle however the
    // coordinate grid it sits on is stretched.
    const [x,y]=networkSpreadPoint(position[0], position[1]);
    const major=meta.majorKeys?.includes(key);
    const r=(major?NETWORK_MAJOR_NODE_RADIUS:NETWORK_MINOR_NODE_RADIUS)+5;
    const valueW=70;
    minX=Math.min(minX,x-r,valueW?x-valueW/2:minX);
    maxX=Math.max(maxX,x+r,valueW?x+valueW/2:maxX);
    minY=Math.min(minY,y-r-6);
    maxY=Math.max(maxY,y+r+24);
  });
  if(includeSystemLabels){
    (meta.networkLabels||[]).forEach((label,index)=>{
      const group=NETWORK_LABEL_GROUP_ORDER[index];
      const current=networkCurrentLabelPosition(group);
      const [x,y]=networkSpreadPoint(current.x, current.y);
      const w=estimateNetworkLabelWidth(current.text||label[0],true);
      minX=Math.min(minX,x-8);
      maxX=Math.max(maxX,x+w+8);
      minY=Math.min(minY,y-24);
      maxY=Math.max(maxY,y+10);
    });
  }
  // The outer clamp is a design-space limit, so it has to travel through the same transform as
  // the content it is bounding - otherwise a stretched layout gets cropped by the box it grew out of.
  const [clampMinX,clampMinY]=networkSpreadPoint(-40,-60);
  const [clampMaxX,clampMaxY]=networkSpreadPoint(NETWORK_VIEWBOX_WIDTH+80, NETWORK_VIEWBOX_HEIGHT+90);
  minX=Math.max(minX-NETWORK_VIEWBOX_PAD_X,clampMinX);
  maxX=Math.min(maxX+NETWORK_VIEWBOX_PAD_X,clampMaxX);
  minY=Math.max(minY-NETWORK_VIEWBOX_PAD_TOP,clampMinY);
  maxY=Math.min(maxY+NETWORK_VIEWBOX_PAD_BOTTOM,clampMaxY);
  const width=Math.max(240,maxX-minX), height=Math.max(180,maxY-minY);
  return {minX,minY,maxX,maxY,width,height,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
}
function combineNetworkBounds(...bounds){
  const valid=bounds.filter(Boolean);
  if(!valid.length) return networkContentBounds();
  const minX=Math.min(...valid.map(bounds=>bounds.minX));
  const minY=Math.min(...valid.map(bounds=>bounds.minY));
  const maxX=Math.max(...valid.map(bounds=>bounds.maxX));
  const maxY=Math.max(...valid.map(bounds=>bounds.maxY));
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
}
function setNetworkLayoutTransitionViewBox(fromPositions,toPositions){
  // Keep the SVG geometry stable during the node interpolation. Recalculating
  // an auto-fit viewBox each frame changes both the rendered scale and scroll
  // origin, which makes a layout transition appear to stutter.
  networkLayoutTransitionViewBox=combineNetworkBounds(
    networkContentBounds(fromPositions,false),
    networkContentBounds(toPositions,false)
  );
  networkViewBox=null;
  applyNetworkViewBox();
}
function clearNetworkLayoutTransitionViewBox(){
  networkLayoutTransitionViewBox=null;
}
function applyNetworkViewBox(){
  const svg=$('network');
  if(!svg) return networkViewBox;
  if(networkPointerDrag?.dragged) return networkViewBox;
  const b=networkLayoutTransitionViewBox || networkContentBounds();
  if(networkLayoutTransitionViewBox && networkViewBox===networkLayoutTransitionViewBox) return networkViewBox;
  networkViewBox=b;
  svg.setAttribute('viewBox', `${b.minX.toFixed(1)} ${b.minY.toFixed(1)} ${b.width.toFixed(1)} ${b.height.toFixed(1)}`);
  document.documentElement.style.setProperty('--network-base-width', `${b.width.toFixed(1)}px`);
  document.documentElement.style.setProperty('--network-base-height', `${b.height.toFixed(1)}px`);
  const canvas=document.querySelector('.network-canvas');
  if(canvas){
    canvas.style.setProperty('--network-base-width', `${b.width.toFixed(1)}px`);
    canvas.style.setProperty('--network-base-height', `${b.height.toFixed(1)}px`);
  }
  return b;
}
function currentNetworkStageSize(){
  const b=networkViewBox || applyNetworkViewBox();
  return {width:(b.width||NETWORK_VIEWBOX_WIDTH)*networkScale, height:(b.height||NETWORK_VIEWBOX_HEIGHT)*networkScale};
}
function updateNetworkStagePlacement(){
  const canvas=document.querySelector('.network-canvas');
  if(!canvas) return {padLeft:0,padTop:0,width:0,height:0};
  const size=currentNetworkStageSize();
  const padLeft=Math.max(0,(canvas.clientWidth-size.width)/2);
  const padTop=Math.max(0,(canvas.clientHeight-size.height)/2);
  canvas.style.setProperty('--network-pad-left', `${padLeft.toFixed(1)}px`);
  canvas.style.setProperty('--network-pad-top', `${padTop.toFixed(1)}px`);
  return {padLeft,padTop,width:size.width,height:size.height};
}
function fitNetworkToPanel(force=false){
  if(!force && networkUserNavigated) return;
  const canvas=document.querySelector('.network-canvas');
  if(!canvas || !meta) return;
  const rect=canvas.getBoundingClientRect();
  if(rect.width<80 || rect.height<80) return;
  // The panel has just been measured, so this is the moment to re-shape the diagram to it. The
  // spread depends only on the canvas size, never on the scale it produces, so there is no loop.
  if(updateNetworkAspectSpread() && latest) renderNetwork(latest, true);
  const b=applyNetworkViewBox();
  const mobile=isMobileNetworkView();
  const vv=window.visualViewport;
  const visualW=vv?.width || window.innerWidth || rect.width;
  const visualH=vv?.height || window.innerHeight || rect.height;
  const margin=mobile ? NETWORK_MOBILE_FIT_MARGIN : NETWORK_FIT_MARGIN;
  const legend=$('legend');
  const legendH=legend ? Math.max(NETWORK_MOBILE_LEGEND_RESERVE, legend.getBoundingClientRect().height || 0) : NETWORK_MOBILE_LEGEND_RESERVE;
  const mobileBottomReserve=mobile ? legendH + 18 : 0;
  const visibleW=mobile ? Math.min(rect.width, Math.max(120, visualW - 16)) : rect.width;
  const visibleH=mobile ? Math.min(rect.height, Math.max(120, visualH - 160)) : rect.height;
  const availW=Math.max(80,visibleW-margin*2);
  const availH=Math.max(80,visibleH-margin*2-mobileBottomReserve);
  const safety=mobile ? NETWORK_MOBILE_SCALE_SAFETY : NETWORK_DESKTOP_SCALE_SAFETY;
  const fitScale=Math.min(availW/b.width, availH/b.height) * safety;
  networkScale=clip(fitScale, NETWORK_SCALE_MIN, NETWORK_SCALE_MAX);
  document.documentElement.style.setProperty('--network-scale', networkScale.toFixed(3));
  canvas.style.setProperty('--network-scale', networkScale.toFixed(3));
  canvas.dataset.autoFitMode = mobile ? 'mobile' : 'desktop';
  requestAnimationFrame(()=>{
    const placement=updateNetworkStagePlacement();
    const maxLeft=Math.max(0, canvas.scrollWidth-canvas.clientWidth);
    const maxTop=Math.max(0, canvas.scrollHeight-canvas.clientHeight);
    networkProgrammaticScroll=true;
    canvas.scrollLeft=clip(placement.padLeft + placement.width/2 - canvas.clientWidth/2,0,maxLeft);
    canvas.scrollTop=clip(placement.padTop + placement.height/2 - canvas.clientHeight/2,0,maxTop);
    setTimeout(()=>{ networkProgrammaticScroll=false; },60);
  });
}
function centerNetworkView(force=false){
  if(!force && networkUserNavigated) return;
  const canvas=document.querySelector('.network-canvas'), stage=document.querySelector('.network-stage');
  if(!canvas || !stage || !meta) return;
  const rect=canvas.getBoundingClientRect();
  if(rect.width<30 || rect.height<30) return;
  applyNetworkViewBox();
  requestAnimationFrame(()=>{
    const placement=updateNetworkStagePlacement();
    const maxLeft=Math.max(0, canvas.scrollWidth-canvas.clientWidth);
    const maxTop=Math.max(0, canvas.scrollHeight-canvas.clientHeight);
    networkProgrammaticScroll=true;
    canvas.scrollLeft=clip(placement.padLeft + placement.width/2 - canvas.clientWidth/2,0,maxLeft);
    canvas.scrollTop=clip(placement.padTop + placement.height/2 - canvas.clientHeight/2,0,maxTop);
    setTimeout(()=>{ networkProgrammaticScroll=false; },0);
  });
}
function scheduleNetworkCenter(force=false){
  cancelAnimationFrame(networkCenterRaf);
  networkCenterRaf=requestAnimationFrame(()=>{
    networkCenterRaf=requestAnimationFrame(()=>centerNetworkView(force));
  });
}
function scheduleNetworkFit(force=false){
  cancelAnimationFrame(networkFitRaf);
  networkFitRaf=requestAnimationFrame(()=>{
    networkFitRaf=requestAnimationFrame(()=>fitNetworkToPanel(force));
  });
}

function setNetworkScale(nextScale, anchorClientX, anchorClientY){
  const canvas=document.querySelector('.network-canvas'), stage=document.querySelector('.network-stage');
  if(!canvas || !stage) return;
  networkUserNavigated = true;
  applyNetworkViewBox();
  const placementBefore=updateNetworkStagePlacement();
  const oldScale=networkScale;
  const newScale=clip(nextScale, NETWORK_SCALE_MIN, NETWORK_SCALE_MAX);
  if(Math.abs(newScale-oldScale)<0.001) return;
  const rect=canvas.getBoundingClientRect();
  const localX=anchorClientX == null ? canvas.clientWidth/2 : anchorClientX-rect.left;
  const localY=anchorClientY == null ? canvas.clientHeight/2 : anchorClientY-rect.top;
  const oldW=placementBefore.width || stage.offsetWidth || canvas.scrollWidth || 1;
  const oldH=placementBefore.height || stage.offsetHeight || canvas.scrollHeight || 1;
  const ratioX=(canvas.scrollLeft+localX-placementBefore.padLeft)/oldW;
  const ratioY=(canvas.scrollTop+localY-placementBefore.padTop)/oldH;
  networkScale=newScale;
  document.documentElement.style.setProperty('--network-scale', networkScale.toFixed(3));
  canvas.style.setProperty('--network-scale', networkScale.toFixed(3));
  requestAnimationFrame(()=>{
    const placementAfter=updateNetworkStagePlacement();
    const maxLeft=Math.max(0, canvas.scrollWidth-canvas.clientWidth);
    const maxTop=Math.max(0, canvas.scrollHeight-canvas.clientHeight);
    canvas.scrollLeft=clip(ratioX*placementAfter.width+placementAfter.padLeft-localX,0,maxLeft);
    canvas.scrollTop=clip(ratioY*placementAfter.height+placementAfter.padTop-localY,0,maxTop);
  });
}
function pointInElement(clientX, clientY, el){
  if(!el) return false;
  const r=el.getBoundingClientRect();
  return clientX>=r.left && clientX<=r.right && clientY>=r.top && clientY<=r.bottom;
}
function twoTouchMetrics(touches){
  const a=touches[0], b=touches[1];
  const dx=b.clientX-a.clientX, dy=b.clientY-a.clientY;
  return {distance:Math.hypot(dx,dy), x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2};
}
function wireNetworkZoom(){
  const canvas=document.querySelector('.network-canvas');
  if(!canvas || canvas.dataset.zoomReady) return;
  canvas.dataset.zoomReady='1';
  if(window.ResizeObserver && !networkPanelResizeObserver){
    networkPanelResizeObserver=new ResizeObserver(()=>{
      // The diagram's shape follows the panel's shape, so ANY change to the box re-evaluates it -
      // including one that must not also re-fit, because the learner has zoomed their own view.
      if(updateNetworkAspectSpread()){
        applyNetworkViewBox();
        if(latest) renderNetwork(latest, true);
      }
      if(!document.body.classList.contains('resizing-control-panel') &&
         !document.body.classList.contains('control-panel-snapping')) return;
      networkUserNavigated=false;
      scheduleNetworkFit(true);
    });
    networkPanelResizeObserver.observe(canvas);
  }
  document.documentElement.style.setProperty('--network-scale', networkScale.toFixed(3));
  canvas.style.setProperty('--network-scale', networkScale.toFixed(3));
  canvas.addEventListener('scroll', ()=>{
    if(!networkProgrammaticScroll) networkUserNavigated=true;
    if(mobileNodeControlKey) scheduleMobileNodeControlPosition();
  }, {passive:true});
  canvas.addEventListener('wheel', e=>{
    if(!(e.ctrlKey || e.shiftKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const delta=Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if(!delta) return;
    networkUserNavigated=true;
    const factor=Math.exp(-delta * NETWORK_WHEEL_ZOOM_RATE);
    setNetworkScale(networkScale * factor, e.clientX, e.clientY);
  }, {passive:false});
  canvas.addEventListener('dblclick', e=>{
    networkUserNavigated=false;
    fitNetworkToPanel(true);
  });
  canvas.addEventListener('touchstart', e=>{
    if(e.touches.length!==2) return;
    const touches=Array.from(e.touches);
    if(!touches.every(t=>pointInElement(t.clientX,t.clientY,canvas))) return;
    const m=twoTouchMetrics(touches);
    networkUserNavigated=true;
    networkPinch={startDistance:m.distance, startScale:networkScale, x:m.x, y:m.y};
  }, {passive:false});
  canvas.addEventListener('touchmove', e=>{
    if(!networkPinch || e.touches.length!==2) return;
    const touches=Array.from(e.touches);
    if(!touches.every(t=>pointInElement(t.clientX,t.clientY,canvas))) return;
    e.preventDefault();
    e.stopPropagation();
    const m=twoTouchMetrics(touches);
    if(networkPinch.startDistance>0) setNetworkScale(networkPinch.startScale * (m.distance/networkPinch.startDistance), m.x, m.y);
  }, {passive:false});
  ['touchend','touchcancel'].forEach(type=>canvas.addEventListener(type, e=>{
    if(e.touches.length<2) networkPinch=null;
  }, {passive:true}));
}
function wireNetworkHeightResize(){
  const center=document.querySelector('.center-panel');
  const handle=$('networkResizeHandle');
  if(!center || !handle || handle.dataset.resizeReady) return;
  handle.dataset.resizeReady='1';
  let drag=null;
  const applyHeight=(px)=>{
    const rect=center.getBoundingClientRect();
    const max=Math.max(NETWORK_HEIGHT_MIN, rect.height*NETWORK_HEIGHT_MAX_RATIO);
    const h=clip(px, NETWORK_HEIGHT_MIN, max);
    center.style.setProperty('--network-panel-height', `${Math.round(h)}px`);
    savedNetworkPanelHeight=h;
  };
  handle.addEventListener('pointerdown', e=>{
    const net=document.querySelector('.network-wrap');
    if(!net) return;
    drag={startY:e.clientY, startHeight:net.getBoundingClientRect().height};
    handle.setPointerCapture?.(e.pointerId);
    document.body.classList.add('resizing-network');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e=>{
    if(!drag) return;
    networkHeightUserResized=true;
    applyHeight(drag.startHeight + e.clientY - drag.startY);
    networkUserNavigated=false;
    scheduleNetworkFitBurst(true);
    e.preventDefault();
  });
  const endDrag=e=>{
    if(!drag) return;
    drag=null;
    document.body.classList.remove('resizing-network');
    networkUserNavigated=false;
    scheduleNetworkFitBurst(true);
    try{ handle.releasePointerCapture?.(e.pointerId); }catch(_){}
    saveLayoutPreferences();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  // The divider is also a quick show/hide shortcut for the replay console.
  handle.addEventListener('dblclick', e=>{
    if(!isReplayConsoleCollapsible()) return;
    e.preventDefault();
    replayConsoleHidden=!replayConsoleHidden;
    applyReplayConsoleVisibility();
    saveLayoutPreferences();
    sendLearningEvent('replay_console_visibility_toggle', {panel:'replay', hidden:replayConsoleHidden, source:'network_resize_handle'});
  });
  const refit=()=>{
    if(!isAutomaticNetworkHeightEnabled()){
      center.style.removeProperty('--network-panel-height');
      networkUserNavigated=false;
      scheduleNetworkFitBurst(true);
      return;
    }
    if(networkHeightUserResized){
      const net=document.querySelector('.network-wrap');
      if(net) applyHeight(net.getBoundingClientRect().height);
    }else{
      applyAutomaticNetworkPanelHeight(true);
    }
    if(document.querySelector('.network-wrap')){
      networkUserNavigated=false;
      scheduleNetworkFitBurst(true);
    }
  };
  window.addEventListener('resize', refit, {passive:true});
  window.addEventListener('orientationchange', ()=>setTimeout(refit,240), {passive:true});
  window.visualViewport?.addEventListener('resize', refit, {passive:true});
}

function isAutomaticNetworkHeightEnabled(){
  return window.matchMedia('(min-width: 861px)').matches;
}
function isReplayConsoleCollapsible(){
  return window.matchMedia('(min-width: 861px)').matches;
}
// Show/hide the replay console (desktop only). When collapsed only the title bar remains and the
// network takes over the freed height.
function applyReplayConsoleVisibility(){
  const center=document.querySelector('.center-panel');
  const toggle=$('replayToggle');
  const tag=$('replayHiddenTag');
  const collapsible=isReplayConsoleCollapsible();
  const collapsed=collapsible && replayConsoleHidden;
  center?.classList.toggle('replay-collapsed', collapsed);
  if(tag) tag.hidden=!collapsed;
  if(toggle){
    toggle.hidden=!collapsible;
    toggle.textContent=collapsed ? TEXT.replayShow : TEXT.replayHide;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? TEXT.replayShowAria : TEXT.replayHideAria);
  }
  scheduleAutomaticNetworkPanelHeight(true);
  networkUserNavigated=false;
  scheduleNetworkFitBurst(true);
}
// The replay console is a fixed-height strip, so the grid sizes it from its own content and the
// network row simply takes what is left. The only explicit height that survives is one the
// learner dragged for themselves.
function applyAutomaticNetworkPanelHeight(){
  const center=document.querySelector('.center-panel');
  if(!center || networkHeightUserResized) return;
  center.style.removeProperty('--network-panel-height');
}
function scheduleAutomaticNetworkPanelHeight(force=false){
  if(networkHeightUserResized) return;
  cancelAnimationFrame(networkHeightAutoRaf);
  networkHeightAutoRaf=requestAnimationFrame(()=>{
    networkHeightAutoRaf=requestAnimationFrame(()=>applyAutomaticNetworkPanelHeight(force));
  });
}

function isControlPanelResizeEnabled(){
  return window.matchMedia('(min-width: 861px)').matches;
}
function controlPanelDefaultWidth(){
  return window.matchMedia('(max-width: 1280px)').matches ? CONTROL_PANEL_DEFAULT_WIDTH_COMPACT : CONTROL_PANEL_DEFAULT_WIDTH_DESKTOP;
}
// Horizontal budget shared by the console and the center column, plus the layout
// constants that depend on the current breakpoint.
function controlPanelReserves(){
  const app=document.querySelector('.app');
  const defaultWidth=controlPanelDefaultWidth();
  if(!app) return {app:null, defaultWidth, totalInner:0};
  const isWide=window.matchMedia('(min-width: 1281px)').matches;
  const columns=isWide ? 4 : 3; // grid tracks: console | handle | center [| right]
  const rightReserve=isWide ? CONTROL_PANEL_RIGHT_WIDTH : 0;
  const gapReserve=(columns-1)*CONTROL_PANEL_GAP_WIDTH;
  const cs=getComputedStyle(app);
  const padX=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
  const totalInner=app.clientWidth - padX - rightReserve - CONTROL_PANEL_HANDLE_WIDTH - gapReserve;
  return {app, defaultWidth, totalInner};
}
// Padding + inter-card gap of the .controls grid, used to size and count columns.
function controlCardMetrics(){
  const controls=document.querySelector('.controls');
  let padX=16, gap=CONTROL_PANEL_CARD_GAP;
  if(controls){
    const cs=getComputedStyle(controls);
    const p=(parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
    if(p>0) padX=p;
    const g=parseFloat(cs.columnGap || cs.gap);
    if(!isNaN(g)) gap=g;
  }
  return {padX, gap};
}
// Console width that shows exactly `columns` cards at the comfortable target width.
function controlConsoleWidthForColumns(columns){
  const {padX, gap}=controlCardMetrics();
  return columns*CONTROL_COLUMN_TARGET_WIDTH + (columns-1)*gap + padX;
}
function controlPanelMaxWidth(){
  const r=controlPanelReserves();
  if(!r.app) return r.defaultWidth * 2.35;
  // A manual drag may widen the console until the network hits its minimum width.
  return Math.max(r.defaultWidth, r.totalInner - CONTROL_PANEL_CENTER_MIN_WIDTH);
}
// Column count from the width budget alone (independent of the network height /
// monitor state, so the layout is predictable). Use more columns only when the
// network can still stay at least CONTROL_PANEL_NETWORK_DOMINANCE× the console.
function targetControlColumns(totalInner){
  let columns=1;
  for(let n=CONTROL_PANEL_MAX_COLUMNS; n>=2; n--){
    if(totalInner >= controlConsoleWidthForColumns(n) * CONTROL_PANEL_NETWORK_DOMINANCE){ columns=n; break; }
  }
  // A physical 4K display may expose only ~1536 CSS px at 250% scaling. The
  // original visual default on these screens is two columns, provided the
  // network can still retain its hard minimum width.
  const screenCssWidth=Math.max(Number(window.screen?.width)||0, Number(window.screen?.availWidth)||0);
  const physicalScreenWidth=screenCssWidth * Math.max(1, Number(window.devicePixelRatio)||1);
  const twoColumnWidth=controlConsoleWidthForColumns(2);
  if(columns===1 && physicalScreenWidth>=3000 && totalInner>=twoColumnWidth+CONTROL_PANEL_CENTER_MIN_WIDTH){
    columns=2;
  }
  return columns;
}
// Two wide columns by default; up to four on wide screens, one on small ones.
// Cards keep a fixed comfortable width and the network takes the rest — removing
// the empty left/right gutters without ever squeezing the labels.
function computeOptimalControlPanelWidth(){
  const r=controlPanelReserves();
  if(!r.app || r.totalInner<=0) return r.defaultWidth;
  const width=controlConsoleWidthForColumns(targetControlColumns(r.totalInner));
  const hardMax=Math.max(CONTROL_PANEL_MIN_WIDTH, r.totalInner - CONTROL_PANEL_CENTER_MIN_WIDTH);
  return clip(width, CONTROL_PANEL_MIN_WIDTH, hardMax);
}
// How many card columns (1-4) a given console width shows.
function controlColumnCount(consoleWidth){
  // A guided lesson shows about six sliders. Spreading six cards over three columns leaves a
  // short, wide block of mostly empty console, so the beginner mode stays single-column however
  // wide the panel is dragged.
  if(modeConfig().controls === 'guided') return 1;
  const {padX, gap}=controlCardMetrics();
  const inner=consoleWidth - padX;
  const cols=Math.floor((inner+gap)/(CONTROL_COLUMN_TARGET_WIDTH+gap));
  return clip(cols, 1, CONTROL_PANEL_MAX_COLUMNS);
}
function scheduleOptimalControlPanelWidth(){
  if(controlPanelHidden || !controlPanelAdaptiveDefault || !isControlPanelResizeEnabled()) return;
  [60, 280].forEach(delay=>setTimeout(()=>{
    if(!controlPanelHidden && controlPanelAdaptiveDefault) applyControlPanelWidth();
  }, delay));
}
function markControlPanelSnapping(){
  document.body.classList.add('control-panel-snapping');
  clearTimeout(controlPanelSnapTimer);
  controlPanelSnapTimer=setTimeout(()=>{
    document.body.classList.remove('control-panel-snapping');
    networkUserNavigated=false;
    scheduleNetworkFitBurst(true);
  },260);
}
function applyControlPanelWidth(width, {remember=true}={}){
  const app=document.querySelector('.app');
  const left=document.querySelector('.left-panel');
  const handle=$('controlPanelResizeHandle');
  const toggle=$('controlToggle');
  const root=document.documentElement;
  if(!left) return;
  if(!isControlPanelResizeEnabled()){
    controlPanelDrawerWidth=null;
    root.style.removeProperty('--control-panel-drawer-width');
    root.style.removeProperty('--control-panel-width');
    root.style.removeProperty('--controls-template');
    app?.classList.remove('control-panel-collapsed','control-panel-partial');
    left.classList.remove('control-wide','control-extra-wide','control-quad');
    left.removeAttribute('aria-hidden');
    handle?.classList.remove('active');
    if(toggle) toggle.hidden=true;
    return;
  }
  const defaultWidth=controlPanelDefaultWidth();
  let requested=width;
  if(requested==null){
    requested=controlPanelAdaptiveDefault
      ? computeOptimalControlPanelWidth()
      : (controlPanelWidth ?? defaultWidth);
  }
  const drawerWidth=clip(Number(requested)||0, 0, controlPanelMaxWidth());
  const collapsed=drawerWidth<0.5;
  const partial=drawerWidth>0 && drawerWidth<CONTROL_PANEL_MIN_WIDTH;
  const layoutWidth=Math.max(CONTROL_PANEL_MIN_WIDTH, drawerWidth);
  controlPanelDrawerWidth=drawerWidth;
  controlPanelHidden=collapsed;
  if(remember && drawerWidth>=CONTROL_PANEL_MIN_WIDTH) controlPanelWidth=drawerWidth;
  const columns=controlColumnCount(layoutWidth);
  root.style.setProperty('--control-panel-drawer-width', `${drawerWidth.toFixed(1)}px`);
  root.style.setProperty('--control-panel-width', `${Math.round(layoutWidth)}px`);
  root.style.setProperty('--controls-template', columns>1 ? `repeat(${columns},minmax(0,1fr))` : '1fr');
  app?.classList.toggle('control-panel-collapsed', collapsed);
  app?.classList.toggle('control-panel-partial', partial);
  left.setAttribute('aria-hidden', String(collapsed));
  left.classList.toggle('control-wide', columns>=2);
  left.classList.toggle('control-extra-wide', columns===3);
  left.classList.toggle('control-quad', columns>=4);
  if(toggle){
    toggle.hidden=false;
    toggle.textContent=collapsed ? TEXT.controlShow : TEXT.controlHide;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? TEXT.controlShowAria : TEXT.controlHideAria);
  }
  handle?.classList.toggle('active', controlPanelUserResized || collapsed || partial);
  // The two side columns share one row of space, so widening the console can push the right
  // column past what now fits. Re-clamp it here rather than letting the page overflow: the
  // centre cannot absorb it, because its own minimum width stops it giving way.
  if(isRightPanelResizeEnabled() && Number.isFinite(rightPanelDrawerWidth) && rightPanelDrawerWidth>0){
    const ceiling=rightPanelMaxWidth();
    if(rightPanelDrawerWidth>ceiling) applyRightPanelWidth(ceiling, {remember:false});
  }
  networkUserNavigated=false;
  scheduleNetworkFit(true);
}
function applyControlPanelVisibility(){
  if(!isControlPanelResizeEnabled()){
    applyControlPanelWidth();
    return;
  }
  if(controlPanelHidden){
    applyControlPanelWidth(0, {remember:false});
    return;
  }
  if(!controlPanelAdaptiveDefault && Number.isFinite(controlPanelDrawerWidth)){
    applyControlPanelWidth(controlPanelDrawerWidth, {remember:false});
    return;
  }
  applyControlPanelWidth();
}
// The right column resizes on the same rules as the console on the left, so the two handles
// behave identically rather than each having its own personality.
function isRightPanelResizeEnabled(){
  return window.matchMedia('(min-width: 1281px)').matches;
}
// Everything the right column is not allowed to eat: the console (which is itself resizable and
// can be far wider than its default), both handles, all four gaps, and the network's minimum
// width. Under-counting any of these overflows the page horizontally rather than shrinking the
// centre, because the centre's own minimum stops it giving way.
function rightPanelMaxWidth(){
  const app=document.querySelector('.app');
  if(!app) return RIGHT_PANEL_DEFAULT_WIDTH*2;
  const styles=getComputedStyle(app);
  const inner=app.clientWidth
    - parseFloat(styles.paddingLeft || 0) - parseFloat(styles.paddingRight || 0);
  const left=document.querySelector('.left-panel')?.getBoundingClientRect().width || 0;
  const gaps=(parseFloat(styles.columnGap) || 12) * 4;
  const handles=CONTROL_PANEL_HANDLE_WIDTH * 2;
  return Math.max(RIGHT_PANEL_MIN_WIDTH,
    inner - left - gaps - handles - RIGHT_PANEL_CENTER_MIN_WIDTH);
}
function applyRightPanelWidth(width, {remember=true}={}){
  const app=document.querySelector('.app');
  const right=document.querySelector('.right-panel');
  const handle=$('rightPanelResizeHandle');
  const root=document.documentElement;
  if(!right) return;
  if(!isRightPanelResizeEnabled()){
    // Below the three-column breakpoint the right column is a full-width row, so a width drag
    // has nothing to mean. Clear everything rather than leaving a stale variable behind.
    rightPanelDrawerWidth=null;
    root.style.removeProperty('--right-panel-drawer-width');
    app?.classList.remove('right-panel-collapsed');
    right.removeAttribute('aria-hidden');
    handle?.classList.remove('active');
    return;
  }
  let requested=width;
  if(requested==null) requested=rightPanelHidden ? 0 : (rightPanelWidth ?? RIGHT_PANEL_DEFAULT_WIDTH);
  const drawerWidth=clip(Number(requested)||0, 0, rightPanelMaxWidth());
  const collapsed=drawerWidth<0.5;
  rightPanelDrawerWidth=drawerWidth;
  rightPanelHidden=collapsed;
  if(remember && drawerWidth>=RIGHT_PANEL_MIN_WIDTH) rightPanelWidth=drawerWidth;
  root.style.setProperty('--right-panel-drawer-width', `${drawerWidth.toFixed(1)}px`);
  app?.classList.toggle('right-panel-collapsed', collapsed);
  right.setAttribute('aria-hidden', String(collapsed));
  handle?.classList.toggle('active', rightPanelUserResized || collapsed);
  networkUserNavigated=false;
  scheduleNetworkFit(true);
}
function wireRightPanelWidthResize(){
  const handle=$('rightPanelResizeHandle');
  const right=document.querySelector('.right-panel');
  if(!handle || !right || handle.dataset.resizeReady) return;
  handle.dataset.resizeReady='1';
  let drag=null;
  handle.addEventListener('pointerdown', e=>{
    if(!isRightPanelResizeEnabled()) return;
    drag={startX:e.clientX,
      startWidth:rightPanelDrawerWidth ?? (rightPanelHidden ? 0 : right.getBoundingClientRect().width),
      moved:false};
    handle.setPointerCapture?.(e.pointerId);
    document.body.classList.add('resizing-right-panel');
    e.preventDefault();
  });
  handle.addEventListener('dblclick', e=>{
    if(!isRightPanelResizeEnabled()) return;
    e.preventDefault();
    const showAgain=(rightPanelDrawerWidth ?? 0)<RIGHT_PANEL_MIN_WIDTH;
    applyRightPanelWidth(showAgain ? (rightPanelWidth ?? RIGHT_PANEL_DEFAULT_WIDTH) : 0, {remember:false});
    saveLayoutPreferences();
    sendLearningEvent('right_panel_visibility_toggle', {panel:'right', hidden:rightPanelHidden, source:'resize_handle'});
  });
  handle.addEventListener('pointermove', e=>{
    if(!drag) return;
    // The handle sits to the LEFT of the column it sizes, so dragging right shrinks it.
    const requested=drag.startWidth - (e.clientX - drag.startX);
    if(Math.abs(e.clientX-drag.startX)>1) drag.moved=true;
    const next=clip(requested, 0, rightPanelMaxWidth());
    if(next>=RIGHT_PANEL_MIN_WIDTH) rightPanelUserResized=true;
    applyRightPanelWidth(next, {remember:false});
    e.preventDefault();
  });
  const endDrag=e=>{
    if(!drag) return;
    const moved=drag.moved;
    drag=null;
    document.body.classList.remove('resizing-right-panel');
    try{ handle.releasePointerCapture?.(e.pointerId); }catch(_){}
    if(!moved) return;
    // Auto-hide: a drag that ends narrower than the minimum snaps shut instead of leaving a
    // column too narrow to read, and the last usable width is kept for the next reopen.
    if((rightPanelDrawerWidth ?? 0)<RIGHT_PANEL_MIN_WIDTH){
      applyRightPanelWidth(0, {remember:false});
    }else{
      rightPanelHidden=false;
      rightPanelUserResized=true;
      applyRightPanelWidth(rightPanelDrawerWidth, {remember:true});
      scheduleNetworkFitBurst(true);
    }
    saveLayoutPreferences();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  const refit=()=>applyRightPanelWidth(rightPanelHidden ? 0 : (rightPanelDrawerWidth ?? rightPanelWidth), {remember:false});
  window.addEventListener('resize', refit, {passive:true});
  window.addEventListener('orientationchange', ()=>setTimeout(refit,240), {passive:true});
  refit();
}
function wireControlPanelWidthResize(){
  const handle=$('controlPanelResizeHandle');
  const left=document.querySelector('.left-panel');
  if(!handle || !left || handle.dataset.resizeReady) return;
  handle.dataset.resizeReady='1';
  let drag=null;
  const refit=()=>{
    if(!isControlPanelResizeEnabled()){
      applyControlPanelWidth();
    }else if(controlPanelHidden){
      applyControlPanelWidth(0, {remember:false});
    }else if(!controlPanelAdaptiveDefault){
      applyControlPanelWidth(controlPanelDrawerWidth ?? controlPanelWidth, {remember:false});
    }else{
      applyControlPanelWidth();
    }
  };
  handle.addEventListener('pointerdown', e=>{
    if(!isControlPanelResizeEnabled()) return;
    drag={startX:e.clientX, startWidth:controlPanelDrawerWidth ?? (controlPanelHidden ? 0 : left.getBoundingClientRect().width), moved:false};
    handle.setPointerCapture?.(e.pointerId);
    document.body.classList.add('resizing-control-panel');
    e.preventDefault();
  });
  // Double-click always switches between hidden and the original adaptive
  // default layout. The remembered manual width remains for the next launch.
  handle.addEventListener('dblclick', e=>{
    if(!isControlPanelResizeEnabled()) return;
    e.preventDefault();
    markControlPanelSnapping();
    const showDefault=(controlPanelDrawerWidth ?? 0)<CONTROL_PANEL_MIN_WIDTH;
    controlPanelAdaptiveDefault=true;
    applyControlPanelWidth(showDefault ? computeOptimalControlPanelWidth() : 0, {remember:false});
    saveLayoutPreferences();
    sendLearningEvent('control_panel_visibility_toggle', {panel:'control', hidden:controlPanelHidden, source:'resize_handle'});
  });
  handle.addEventListener('pointermove', e=>{
    if(!drag) return;
    const requested=drag.startWidth + e.clientX - drag.startX;
    if(Math.abs(e.clientX-drag.startX)>1) drag.moved=true;
    const next=clip(requested, 0, controlPanelMaxWidth());
    if(next>=CONTROL_PANEL_MIN_WIDTH){
      controlPanelUserResized=true;
      controlPanelAdaptiveDefault=false;
    }
    // Commit only on pointer release, so collapsing preserves the last usable
    // manual width in cache for the next launch.
    applyControlPanelWidth(next, {remember:false});
    e.preventDefault();
  });
  const endDrag=e=>{
    if(!drag) return;
    const moved=drag.moved;
    drag=null;
    document.body.classList.remove('resizing-control-panel');
    try{ handle.releasePointerCapture?.(e.pointerId); }catch(_){}
    if(!moved) return;
    if((controlPanelDrawerWidth ?? 0)<CONTROL_PANEL_MIN_WIDTH){
      markControlPanelSnapping();
      applyControlPanelWidth(0, {remember:false});
    }else{
      controlPanelHidden=false;
      controlPanelUserResized=true;
      applyControlPanelWidth(controlPanelDrawerWidth, {remember:true});
      scheduleNetworkFitBurst(true);
    }
    saveLayoutPreferences();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', refit, {passive:true});
  window.addEventListener('orientationchange', ()=>setTimeout(refit,240), {passive:true});
  window.visualViewport?.addEventListener('resize', refit, {passive:true});
  refit();
}

function updateNetworkStabilityAlert(health){
  const panel=document.querySelector('.network-wrap');
  if(!panel) return;
  const h=clip(Number(health) || 0, 0, 100);
  panel.classList.toggle('network-alert-warn', h < 70 && h >= 50);
  panel.classList.toggle('network-alert-danger', h < 50);
  if(h >= 70){
    panel.style.removeProperty('--network-alert-rgb');
    panel.style.removeProperty('--network-alert-border-alpha');
    panel.style.removeProperty('--network-alert-speed');
    panel.style.removeProperty('--network-alert-alpha');
    panel.style.removeProperty('--network-alert-spread');
    return;
  }
  if(h >= 50){
    const severity=(70-h)/20;
    panel.style.setProperty('--network-alert-rgb', '255 229 0');
    panel.style.setProperty('--network-alert-border-alpha', `${(.75 + severity*.18).toFixed(2)}`);
    panel.style.setProperty('--network-alert-speed', `${(1.45 - severity*.35).toFixed(2)}s`);
    panel.style.setProperty('--network-alert-alpha', `${(.30 + severity*.18).toFixed(2)}`);
    panel.style.setProperty('--network-alert-spread', `${Math.round(16 + severity*10)}px`);
    return;
  }
  const severity=(50-h)/50;
  const green=Math.round(94 - severity*68);
  const blue=Math.round(70 - severity*56);
  panel.style.setProperty('--network-alert-rgb', `255 ${green} ${blue}`);
  panel.style.setProperty('--network-alert-border-alpha', `${(.86 + severity*.14).toFixed(2)}`);
  panel.style.setProperty('--network-alert-speed', `${(1.05 - severity*.70).toFixed(2)}s`);
  panel.style.setProperty('--network-alert-alpha', `${(.52 + severity*.34).toFixed(2)}`);
  panel.style.setProperty('--network-alert-spread', `${Math.round(24 + severity*28)}px`);
}

function networkPositionCenter(){
  const pts=Object.values(meta?.positions || {});
  if(!pts.length) return {x:NETWORK_VIEWBOX_WIDTH/2,y:NETWORK_VIEWBOX_HEIGHT/2};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  pts.forEach(([x,y])=>{
    minX=Math.min(minX,x); maxX=Math.max(maxX,x);
    minY=Math.min(minY,y); maxY=Math.max(maxY,y);
  });
  return {x:(minX+maxX)/2,y:(minY+maxY)/2};
}
// Geometry of the start-intro taijitu, derived from the final layout's bounds so
// it stays centered and roughly fits the network panel.
function yinYangGeometry(){
  const pts=Object.values(meta?.positions || {});
  if(!pts.length) return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  pts.forEach(([x,y])=>{
    minX=Math.min(minX,x); maxX=Math.max(maxX,x);
    minY=Math.min(minY,y); maxY=Math.max(maxY,y);
  });
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  const halfW=(maxX-minX)/2, halfH=(maxY-minY)/2;
  const R=Math.max(NETWORK_INTRO_YINYANG_RADIUS_MIN, Math.min(
    halfW*NETWORK_INTRO_YINYANG_RADIUS_FROM_HALF_W,
    halfH*NETWORK_INTRO_YINYANG_RADIUS_FROM_HALF_H
  ));
  return {
    cx, cy, R,
    rim:R*NETWORK_INTRO_YINYANG_RIM,
    lane:R*NETWORK_INTRO_YINYANG_LANE,
    eye:R*NETWORK_INTRO_YINYANG_EYE
  };
}
// Horizontal position of the dividing S-curve at height v (relative to center):
// the upper half follows the right side of the top circle, the lower half the
// left side of the bottom circle — the classic taijitu boundary.
function yinYangDivideX(v, R){
  if(v<=0){
    return Math.sqrt(Math.max(0,(R/2)*(R/2)-(v+R/2)*(v+R/2)));
  }
  return -Math.sqrt(Math.max(0,(R/2)*(R/2)-(v-R/2)*(v-R/2)));
}
// Is (x,y) a legal spot for a start node: inside the disc, clear of the central
// S-curve lane, and clear of both eye holes.
function yinYangValidPoint(x, y, geom){
  const {cx, cy, R, rim, lane, eye}=geom;
  if(Math.hypot(x-cx, y-cy) > R-rim) return false;
  if(Math.abs((x-cx)-yinYangDivideX(y-cy, R)) < lane) return false;
  if(Math.hypot(x-cx, y-(cy-R/2)) < eye) return false;
  if(Math.hypot(x-cx, y-(cy+R/2)) < eye) return false;
  return true;
}
// Even, organic scatter of `count` points across the whole taijitu (both lobes),
// using Mitchell best-candidate sampling so nodes spread out instead of clumping.
// The empty middle lane keeps the two lobes distinct and the eye holes stay open.
function yinYangEvenPoints(count, geom){
  const {cx, cy, R, rim}=geom;
  const usable=R-rim;
  const randPoint=()=>{
    for(let i=0;i<200;i++){
      const a=Math.random()*Math.PI*2;
      const rr=Math.sqrt(Math.random())*usable;
      const x=cx+Math.cos(a)*rr, y=cy+Math.sin(a)*rr;
      if(yinYangValidPoint(x, y, geom)) return {x,y};
    }
    return {x:cx, y:cy};
  };
  const chosen=[];
  for(let n=0;n<count;n++){
    if(!chosen.length){ chosen.push(randPoint()); continue; }
    let best=null, bestD=-1;
    for(let c=0;c<30;c++){
      const p=randPoint();
      let d=Infinity;
      for(const q of chosen){ const dd=(p.x-q.x)**2+(p.y-q.y)**2; if(dd<d) d=dd; }
      if(d>bestD){ bestD=d; best=p; }
    }
    chosen.push(best);
  }
  return chosen;
}
// Opacity of the black/white taijitu backdrop: full at intro start, faded to 0
// within NETWORK_INTRO_YINYANG_FADE_MS, then gone (nodes keep settling after).
function yinYangBackdropOpacity(now=performance.now()){
  if(!networkIntro || networkIntro.mode!=='start') return 0;
  const t=clip((now-networkIntro.start)/NETWORK_INTRO_YINYANG_FADE_MS,0,1);
  if(t>=1) return 0;
  return 1-smoothstep01(t);
}
// Draws the classic taijitu (right outer semicircle closed by the central S-curve)
// as the bottom-most layer under the nodes. The S-curve and eye dots line up with
// the empty lane and eye holes the nodes were scattered around.
function renderYinYangBackdrop(svg, geom, opacity){
  const {cx, cy, R}=geom;
  const eyeR=R*0.14;
  const light='#f4f6f8', dark='#12161c';
  const g=svgEl('g',{class:'yinyang-intro','pointer-events':'none',opacity:opacity.toFixed(3)});
  // White (yang) base disc, thin rim so it reads on both light and dark themes.
  g.appendChild(svgEl('circle',{cx,cy,r:R.toFixed(1),fill:light,stroke:'rgba(120,132,146,.55)','stroke-width':'1.5'}));
  // Black (yin) lobe: right half of the outer circle, closed by the S-curve.
  const d=[
    `M ${cx} ${(cy-R).toFixed(1)}`,
    `A ${R.toFixed(1)} ${R.toFixed(1)} 0 0 1 ${cx} ${(cy+R).toFixed(1)}`,
    `A ${(R/2).toFixed(1)} ${(R/2).toFixed(1)} 0 0 1 ${cx} ${cy}`,
    `A ${(R/2).toFixed(1)} ${(R/2).toFixed(1)} 0 0 0 ${cx} ${(cy-R).toFixed(1)}`,
    'Z'
  ].join(' ');
  g.appendChild(svgEl('path',{d,fill:dark}));
  // Eyes: opposite-colour dots at each lobe's belly (the empty node holes).
  g.appendChild(svgEl('circle',{cx,cy:(cy-R/2).toFixed(1),r:eyeR.toFixed(1),fill:dark}));   // in the white top lobe
  g.appendChild(svgEl('circle',{cx,cy:(cy+R/2).toFixed(1),r:eyeR.toFixed(1),fill:light}));  // in the black bottom lobe
  svg.appendChild(g);
}
function createNetworkStartIntro(){
  const offsets={};
  if(!meta?.positions) return null;
  const geom=yinYangGeometry();
  if(!geom){
    // Fall back to the old center burst if bounds are unavailable.
    const center=networkPositionCenter();
    Object.entries(meta.positions).forEach(([key,[x,y]], index)=>{
      const angle=Math.random()*Math.PI*2;
      const radius=NETWORK_INTRO_CLUSTER_MIN_RADIUS + Math.random()*(NETWORK_INTRO_CLUSTER_MAX_RADIUS-NETWORK_INTRO_CLUSTER_MIN_RADIUS);
      offsets[key]={dx:center.x+Math.cos(angle)*radius-x, dy:center.y+Math.sin(angle)*radius-y, tx:Math.cos(angle+Math.PI/2), ty:Math.sin(angle+Math.PI/2), phase:Math.random()*Math.PI*2, phase2:Math.random()*Math.PI*2, speed:1.2+Math.random()*1.6+(index%3)*0.16, speed2:.55+Math.random()*.9, wobble:NETWORK_INTRO_MIN_WOBBLE, wobble2:NETWORK_INTRO_MIN_WOBBLE*.42};
    });
    return {mode:'start', duration:NETWORK_START_INTRO_DURATION_MS, start:performance.now(), offsets};
  }
  const keys=Object.keys(meta.positions);
  const starts=yinYangEvenPoints(keys.length, geom);
  // Pair each node with a start point by angle around the center, so the nodes
  // fan out to their final spots without tangling their flight paths.
  const angleOf=(x,y)=>Math.atan2(y-geom.cy, x-geom.cx);
  const keyOrder=keys.slice().sort((a,b)=>angleOf(meta.positions[a][0],meta.positions[a][1])-angleOf(meta.positions[b][0],meta.positions[b][1]));
  const startOrder=starts.slice().sort((p,q)=>angleOf(p.x,p.y)-angleOf(q.x,q.y));
  keyOrder.forEach((key, index)=>{
    const [x,y]=meta.positions[key];
    const start=startOrder[index] || {x:geom.cx, y:geom.cy};
    // Wobble runs perpendicular to the node's flight path from start to layout.
    const mvx=x-start.x, mvy=y-start.y;
    const len=Math.hypot(mvx,mvy)||1;
    const wobble=NETWORK_INTRO_MIN_WOBBLE + Math.random()*(NETWORK_INTRO_MAX_WOBBLE-NETWORK_INTRO_MIN_WOBBLE);
    offsets[key]={
      dx:start.x-x,
      dy:start.y-y,
      tx:-mvy/len,
      ty:mvx/len,
      phase:Math.random()*Math.PI*2,
      phase2:Math.random()*Math.PI*2,
      speed:1.2 + Math.random()*1.6 + (index%3)*0.16,
      speed2:.55 + Math.random()*.9,
      wobble,
      wobble2:wobble*.42
    };
  });
  return {mode:'start', duration:NETWORK_START_INTRO_DURATION_MS, start:performance.now(), offsets, geom};
}
function createNetworkRestartIntro(){
  const offsets={};
  if(!meta?.positions) return null;
  Object.keys(meta.positions).forEach((key, index)=>{
    const angle=Math.random()*Math.PI*2;
    const amp=NETWORK_RESTART_MIN_OFFSET + Math.random()*(NETWORK_RESTART_MAX_OFFSET-NETWORK_RESTART_MIN_OFFSET);
    const wobble=NETWORK_INTRO_MIN_WOBBLE + Math.random()*(NETWORK_INTRO_MAX_WOBBLE-NETWORK_INTRO_MIN_WOBBLE);
    const tangent=angle + Math.PI/2;
    offsets[key]={
      dx:Math.cos(angle)*amp,
      dy:Math.sin(angle)*amp,
      tx:Math.cos(tangent),
      ty:Math.sin(tangent),
      phase:Math.random()*Math.PI*2,
      phase2:Math.random()*Math.PI*2,
      speed:1.1 + Math.random()*1.8 + (index%4)*.13,
      speed2:.7 + Math.random()*1.1,
      wobble,
      wobble2:wobble*.45
    };
  });
  return {mode:'restart', duration:NETWORK_RESTART_INTRO_DURATION_MS, start:performance.now(), offsets};
}
function createNetworkDiseaseIntro(){
  const intro=createNetworkRestartIntro();
  if(!intro) return null;
  intro.mode='disease';
  intro.duration=NETWORK_DISEASE_INTRO_DURATION_MS;
  return intro;
}
function networkIntroOffset(key, now=performance.now()){
  if(!networkIntro) return [0,0];
  const cfg=networkIntro.offsets[key];
  if(!cfg) return [0,0];
  const duration=networkIntro.duration || NETWORK_START_INTRO_DURATION_MS;
  const t=clip((now-networkIntro.start)/duration,0,1);
  const eased=smoothstep01(t);
  const wobbleA=Math.sin(cfg.phase + eased*cfg.speed*Math.PI*2)*cfg.wobble;
  const wobbleB=Math.sin(cfg.phase2 + eased*cfg.speed2*Math.PI*2)*cfg.wobble2;
  if(networkIntro.mode==='disease'){
    // A disease arrives as an asymmetric jolt followed by an irregular tremor.
    // Keep it deliberately uncomfortable, but scale everything from the same
    // restrained offsets used by restart so nodes never travel far.
    const envelope=Math.pow(Math.sin(Math.PI*t),.58);
    const recoil=.82 + Math.sin(cfg.phase2+t*Math.PI*5.5)*.18*(1-t);
    const tremor=(
      Math.sin(cfg.phase+t*Math.PI*14.6) +
      Math.sin(cfg.phase2-t*Math.PI*27.4)*.42
    )*cfg.wobble*.62;
    if(envelope<=0) return [0,0];
    return [
      (cfg.dx*recoil + cfg.tx*tremor + cfg.ty*wobbleB*.32)*envelope,
      (cfg.dy*recoil + cfg.ty*tremor - cfg.tx*wobbleB*.32)*envelope
    ];
  }
  if(networkIntro.mode==='restart'){
    const envelope=Math.sin(Math.PI*eased);
    if(envelope<=0) return [0,0];
    return [
      (cfg.dx + cfg.tx*wobbleA + cfg.ty*wobbleB)*envelope,
      (cfg.dy + cfg.ty*wobbleA - cfg.tx*wobbleB)*envelope
    ];
  }
  const settle=1-eased;
  if(settle<=0) return [0,0];
  const wobbleEnvelope=Math.sin(Math.PI*eased);
  return [
    cfg.dx*settle + (cfg.tx*wobbleA + cfg.ty*wobbleB)*wobbleEnvelope,
    cfg.dy*settle + (cfg.ty*wobbleA - cfg.tx*wobbleB)*wobbleEnvelope
  ];
}
function cloneNetworkPositions(source){
  return Object.fromEntries(Object.entries(source || {}).map(([key,[x,y]])=>[key,[x,y]]));
}
function ensureNetworkLayoutState(){
  if(!meta?.positions) return;
  const keys=Object.keys(meta.positions);
  const compatible=networkDefaultPositions && keys.length===Object.keys(networkDefaultPositions).length && keys.every(key=>networkDefaultPositions[key]);
  if(!compatible){
    networkDefaultPositions=cloneNetworkPositions(meta.positions);
    networkNodePositions=cloneNetworkPositions(meta.positions);
    networkLabelPositions={};
  }else if(!networkNodePositions){
    networkNodePositions=cloneNetworkPositions(networkDefaultPositions);
  }
}
function networkDefaultLabelPosition(label,index){
  const [text,x,y]=label;
  const group=NETWORK_LABEL_GROUP_ORDER[index];
  const mobileLayout=isMobileNetworkView()?NETWORK_MOBILE_LABEL_LAYOUT[lang]?.[group]:null;
  return {text,x:mobileLayout?.[0] ?? x,y:mobileLayout?.[1] ?? y,group};
}
function networkCurrentLabelPosition(group){
  const index=NETWORK_LABEL_GROUP_ORDER.indexOf(group);
  const label=meta?.networkLabels?.[index];
  if(!label) return {text:'',x:0,y:0,group};
  const fallback=networkDefaultLabelPosition(label,index);
  const custom=networkLabelPositions[group];
  return custom ? {...fallback,x:custom[0],y:custom[1]} : fallback;
}
function networkSystemKeys(group){
  return (meta?.defs || []).filter(def=>def.group===group && networkNodePositions?.[def.key]).map(def=>def.key);
}
function networkSystemCentroid(group){
  const keys=networkSystemKeys(group);
  if(!keys.length) return null;
  const sum=keys.reduce((acc,key)=>{
    acc.x+=networkNodePositions[key][0];
    acc.y+=networkNodePositions[key][1];
    return acc;
  },{x:0,y:0});
  return [sum.x/keys.length,sum.y/keys.length];
}
function currentNetworkTopologyDescriptor(snap=latest){
  const layoutApi=window.HomeostasisTopologyLayout;
  if(!layoutApi?.disturbanceDescriptor || !snap || !meta) return null;
  return layoutApi.disturbanceDescriptor(snap,meta);
}
function networkLayoutIsModified(){
  ensureNetworkLayoutState();
  if(!networkDefaultPositions || !networkNodePositions) return false;
  const nodeChanged=Object.keys(networkDefaultPositions).some(key=>{
    const current=networkNodePositions[key], original=networkDefaultPositions[key];
    return !current || Math.hypot(current[0]-original[0],current[1]-original[1])>NETWORK_LAYOUT_EPSILON;
  });
  if(nodeChanged) return true;
  return Object.entries(networkLabelPositions).some(([group,[x,y]])=>{
    const index=NETWORK_LABEL_GROUP_ORDER.indexOf(group);
    const original=networkDefaultLabelPosition(meta.networkLabels[index],index);
    return Math.hypot(x-original.x,y-original.y)>NETWORK_LAYOUT_EPSILON;
  });
}
function updateNetworkResetButton(){
  const resetButton=$('resetNetworkLayout');
  if(resetButton) resetButton.hidden=!(networkTopologyLayoutActive || networkLayoutIsModified());
  const topologyButton=$('topologyNetworkLayout');
  if(topologyButton){
    const descriptor=currentNetworkTopologyDescriptor();
    const alreadyApplied=networkTopologyLayoutActive && descriptor?.signature===networkAppliedTopologySignature && !networkTopologyAnimationRaf;
    topologyButton.hidden=!descriptor || alreadyApplied || Boolean(networkResetAnimationRaf);
    topologyButton.disabled=Boolean(networkTopologyAnimationRaf || networkResetAnimationRaf);
  }
}
function stopNetworkLabelAnimation(group){
  networkLabelAnimations.delete(group);
  if(!networkLabelAnimations.size){
    cancelAnimationFrame(networkLabelAnimationRaf);
    networkLabelAnimationRaf=0;
  }
}
function runNetworkLabelAnimations(){
  cancelAnimationFrame(networkLabelAnimationRaf);
  const tick=now=>{
    networkLabelAnimations.forEach((animation,group)=>{
      const t=clip((now-animation.start)/animation.duration,0,1);
      const eased=smoothstep01(t);
      networkLabelPositions[group]=[
        animation.from[0]+(animation.to[0]-animation.from[0])*eased,
        animation.from[1]+(animation.to[1]-animation.from[1])*eased
      ];
      if(t>=1){
        networkLabelPositions[group]=[animation.to[0],animation.to[1]];
        networkLabelAnimations.delete(group);
      }
    });
    updateNetworkResetButton();
    if(latest) renderNetwork(latest,true);
    if(networkLabelAnimations.size) networkLabelAnimationRaf=requestAnimationFrame(tick);
    else networkLabelAnimationRaf=0;
  };
  networkLabelAnimationRaf=requestAnimationFrame(tick);
}
function animateNetworkLabelToCentroid(group){
  const target=networkSystemCentroid(group);
  if(!target) return;
  const current=networkCurrentLabelPosition(group);
  networkLabelAnimations.set(group,{from:[current.x,current.y],to:target,start:performance.now(),duration:NETWORK_LABEL_ANIMATION_MS});
  runNetworkLabelAnimations();
}
function cancelNetworkResetAnimation(){
  const wasRunning=Boolean(networkResetAnimationRaf);
  cancelAnimationFrame(networkResetAnimationRaf);
  networkResetAnimationRaf=0;
  clearNetworkLayoutTransitionViewBox();
  if(wasRunning){
    const resetButton=$('resetNetworkLayout');
    if(resetButton){
      resetButton.disabled=false;
      resetButton.removeAttribute('aria-busy');
    }
    $('network')?.removeAttribute('aria-busy');
  }
}
function cancelNetworkTopologyAnimation(){
  cancelAnimationFrame(networkTopologyAnimationRaf);
  networkTopologyAnimationRaf=0;
  clearNetworkLayoutTransitionViewBox();
  $('topologyNetworkLayout')?.removeAttribute('aria-busy');
  $('network')?.removeAttribute('aria-busy');
}
function clearNetworkTopologyLayoutImmediately(){
  if(!networkTopologyLayoutActive && !networkTopologyAnimationRaf) return;
  cancelNetworkResetAnimation();
  cancelNetworkTopologyAnimation();
  cancelAnimationFrame(networkLabelAnimationRaf);
  networkLabelAnimationRaf=0;
  networkLabelAnimations.clear();
  networkIntro=null;
  cancelAnimationFrame(networkIntroRaf);
  ensureNetworkLayoutState();
  networkNodePositions=cloneNetworkPositions(networkDefaultPositions);
  networkLabelPositions={};
  networkTopologyLayoutActive=false;
  networkAppliedTopologySignature='';
  updateNetworkResetButton();
  if(latest) renderNetwork(latest,true);
}
function applyNetworkTopologyLayout(){
  const descriptor=currentNetworkTopologyDescriptor();
  const layoutApi=window.HomeostasisTopologyLayout;
  if(!descriptor || !layoutApi?.computeTopologyLayout || !meta?.positions) return;
  ensureNetworkLayoutState();
  const result=layoutApi.computeTopologyLayout({
    nodes:(meta.defs||[]).map(def=>({
      key:def.key,
      radius:networkNodeRadius(def.key),
      position:networkDefaultPositions?.[def.key] || meta.positions[def.key]
    })),
    edges:meta.edges||[],
    seedKeys:descriptor.seedKeys,
    width:NETWORK_VIEWBOX_WIDTH,
    height:NETWORK_VIEWBOX_HEIGHT
  });
  if(!result?.positions || Object.keys(result.positions).length!==Object.keys(networkDefaultPositions||{}).length) return;

  cancelNetworkResetAnimation();
  cancelNetworkTopologyAnimation();
  cancelAnimationFrame(networkLabelAnimationRaf);
  networkLabelAnimationRaf=0;
  networkLabelAnimations.clear();
  networkIntro=null;
  cancelAnimationFrame(networkIntroRaf);
  closeMobileNodeControl();

  const topologyButton=$('topologyNetworkLayout');
  const transferFocus=document.activeElement===topologyButton;
  const from=cloneNetworkPositions(networkNodePositions);
  const target=cloneNetworkPositions(result.positions);
  setNetworkLayoutTransitionViewBox(from,target);
  const started=performance.now();
  const duration=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?0:NETWORK_TOPOLOGY_ANIMATION_MS;
  networkTopologyLayoutActive=true;
  networkAppliedTopologySignature='';
  topologyButton?.setAttribute('aria-busy','true');
  $('network')?.setAttribute('aria-busy','true');
  const tick=now=>{
    const t=duration?clip((now-started)/duration,0,1):1;
    const eased=smoothstep01(t);
    Object.keys(target).forEach(key=>{
      const start=from[key] || networkDefaultPositions[key];
      const end=target[key];
      networkNodePositions[key]=[
        start[0]+(end[0]-start[0])*eased,
        start[1]+(end[1]-start[1])*eased
      ];
    });
    if(t>=1){
      networkNodePositions=cloneNetworkPositions(target);
      networkAppliedTopologySignature=descriptor.signature;
      networkTopologyAnimationRaf=0;
      clearNetworkLayoutTransitionViewBox();
      topologyButton?.removeAttribute('aria-busy');
      $('network')?.removeAttribute('aria-busy');
      updateNetworkResetButton();
      if(latest) renderNetwork(latest,true);
      const resetButton=$('resetNetworkLayout');
      if(transferFocus && resetButton && !resetButton.hidden) resetButton.focus({preventScroll:true});
      networkUserNavigated=false;
      scheduleNetworkFitBurst(true);
      toast(TEXT.topologyLayoutToast);
      return;
    }
    updateNetworkResetButton();
    if(latest) renderNetwork(latest,true);
    networkTopologyAnimationRaf=requestAnimationFrame(tick);
  };
  networkTopologyAnimationRaf=requestAnimationFrame(tick);
  updateNetworkResetButton();
  if(latest) renderNetwork(latest,true);
}
function resetNetworkLayout(){
  ensureNetworkLayoutState();
  if(!networkTopologyLayoutActive && !networkLayoutIsModified()) return;
  const resetButton=$('resetNetworkLayout');
  const restoreTopologyFocus=document.activeElement===resetButton;
  cancelNetworkResetAnimation();
  cancelNetworkTopologyAnimation();
  cancelAnimationFrame(networkLabelAnimationRaf);
  networkLabelAnimationRaf=0;
  networkLabelAnimations.clear();
  networkIntro=null;
  cancelAnimationFrame(networkIntroRaf);
  if(resetButton){
    resetButton.disabled=true;
    resetButton.setAttribute('aria-busy','true');
  }
  $('network')?.setAttribute('aria-busy','true');
  const nodeFrom=cloneNetworkPositions(networkNodePositions);
  const labelFrom={};
  const labelTo={};
  NETWORK_LABEL_GROUP_ORDER.forEach((group,index)=>{
    const current=networkCurrentLabelPosition(group);
    const original=networkDefaultLabelPosition(meta.networkLabels[index],index);
    labelFrom[group]=[current.x,current.y];
    labelTo[group]=[original.x,original.y];
  });
  setNetworkLayoutTransitionViewBox(nodeFrom,networkDefaultPositions);
  const started=performance.now();
  const duration=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?0:NETWORK_RESET_ANIMATION_MS;
  const tick=now=>{
    const t=duration?clip((now-started)/duration,0,1):1;
    const eased=smoothstep01(t);
    Object.keys(networkDefaultPositions).forEach(key=>{
      const from=nodeFrom[key] || networkDefaultPositions[key], to=networkDefaultPositions[key];
      networkNodePositions[key]=[from[0]+(to[0]-from[0])*eased,from[1]+(to[1]-from[1])*eased];
    });
    Object.keys(labelTo).forEach(group=>{
      const from=labelFrom[group],to=labelTo[group];
      networkLabelPositions[group]=[from[0]+(to[0]-from[0])*eased,from[1]+(to[1]-from[1])*eased];
    });
    if(t>=1){
      networkNodePositions=cloneNetworkPositions(networkDefaultPositions);
      networkLabelPositions={};
      networkTopologyLayoutActive=false;
      networkAppliedTopologySignature='';
      networkResetAnimationRaf=0;
      clearNetworkLayoutTransitionViewBox();
      if(resetButton){
        resetButton.disabled=false;
        resetButton.removeAttribute('aria-busy');
      }
      $('network')?.removeAttribute('aria-busy');
      updateNetworkResetButton();
      if(latest) renderNetwork(latest,true);
      // A topology layout may have changed both the fitted scale and scroll
      // origin. Resetting positions alone leaves that old viewport in place,
      // which can put default nodes outside the visible canvas.
      networkUserNavigated=false;
      scheduleNetworkFitBurst(true);
      const topologyButton=$('topologyNetworkLayout');
      if(restoreTopologyFocus){
        const focusTarget=topologyButton && !topologyButton.hidden ? topologyButton : $('networkTitle');
        focusTarget?.focus({preventScroll:true});
      }
      return;
    }
    updateNetworkResetButton();
    if(latest) renderNetwork(latest,true);
    networkResetAnimationRaf=requestAnimationFrame(tick);
  };
  networkResetAnimationRaf=requestAnimationFrame(tick);
  updateNetworkResetButton();
}
function networkRenderPositions(now=performance.now()){
  ensureNetworkLayoutState();
  const base=networkNodePositions || meta?.positions || {};
  if(!networkIntro) return base;
  const duration=networkIntro.duration || NETWORK_START_INTRO_DURATION_MS;
  const t=clip((now-networkIntro.start)/duration,0,1);
  if(t>=1) return base;
  return Object.fromEntries(Object.entries(base).map(([key,[x,y]])=>{
    const [dx,dy]=networkIntroOffset(key, now);
    return [key,[x+dx,y+dy]];
  }));
}
function networkLabelPosition(label, index, positions){
  const fallback=networkDefaultLabelPosition(label,index);
  const {text,group}=fallback;
  const custom=networkLabelPositions[group];
  const labelX=custom?.[0] ?? fallback.x;
  const labelY=custom?.[1] ?? fallback.y;
  if(!group || !meta?.defs || !positions) return {text,x:labelX,y:labelY,group};
  const base=networkNodePositions || meta.positions;
  const keys=meta.defs.filter(d=>d.group===group && positions[d.key] && base[d.key]).map(d=>d.key);
  if(!keys.length || !networkIntro) return {text,x:labelX,y:labelY,group};
  const offset=keys.reduce((acc,key)=>{
    acc.x += positions[key][0] - base[key][0];
    acc.y += positions[key][1] - base[key][1];
    return acc;
  }, {x:0,y:0});
  return {text,x:labelX+offset.x/keys.length,y:labelY+offset.y/keys.length,group};
}
function startNetworkIntroAnimation(){
  cancelAnimationFrame(networkIntroRaf);
  if(!networkIntro || !latest) return;
  const duration=networkIntro.duration || NETWORK_START_INTRO_DURATION_MS;
  const tick=()=>{
    if(!networkIntro || !latest) return;
    renderNetwork(latest, true);
    if(performance.now()-networkIntro.start < duration){
      networkIntroRaf=requestAnimationFrame(tick);
    }else{
      networkIntro=null;
      renderNetwork(latest, true);
    }
  };
  networkIntroRaf=requestAnimationFrame(tick);
}
function requestNetworkIntroAnimation(){
  networkIntroStartRequested=true;
  if(!latest || !meta) return;
  networkIntro=createNetworkStartIntro();
  if(!networkIntro) return;
  networkIntroStartRequested=false;
  renderNetwork(latest, true);
  startNetworkIntroAnimation();
}


function networkNodePulseExtra(key, group, now=performance.now()){
  if(!networkNodePulse || (networkNodePulse.key!==key && networkNodePulse.group!==group)) return 0;
  const t=clip((now-networkNodePulse.start)/NETWORK_NODE_PULSE_DURATION_MS,0,1);
  return Math.sin(Math.PI*t) * NETWORK_NODE_PULSE_EXTRA_RADIUS;
}
function startNetworkNodePulseAnimation(){
  cancelAnimationFrame(networkNodePulseRaf);
  if(!networkNodePulse || !latest) return;
  const tick=()=>{
    if(!networkNodePulse || !latest) return;
    renderNetwork(latest, true);
    if(performance.now()-networkNodePulse.start < NETWORK_NODE_PULSE_DURATION_MS){
      networkNodePulseRaf=requestAnimationFrame(tick);
    }else{
      networkNodePulse=null;
      renderNetwork(latest, true);
    }
  };
  networkNodePulseRaf=requestAnimationFrame(tick);
}
function triggerNetworkNodePulse(key){
  networkNodePulse={key,start:performance.now()};
  if(latest) renderNetwork(latest, true);
  startNetworkNodePulseAnimation();
}
function triggerNetworkSystemPulse(group){
  networkNodePulse={group,start:performance.now()};
  if(latest) renderNetwork(latest, true);
  startNetworkNodePulseAnimation();
}

function clientToNetworkPoint(clientX,clientY){
  const svg=$('network');
  const matrix=svg?.getScreenCTM?.();
  if(!svg || !matrix) return null;
  const point=svg.createSVGPoint();
  point.x=clientX;
  point.y=clientY;
  const local=point.matrixTransform(matrix.inverse());
  return {x:local.x,y:local.y};
}
function networkNodeRadius(key){
  return meta?.majorKeys?.includes(key)?NETWORK_MAJOR_NODE_RADIUS:NETWORK_MINOR_NODE_RADIUS;
}
function clampNetworkNodePosition(key,x,y){
  const radius=networkNodeRadius(key);
  return [
    clip(x,radius+NETWORK_NODE_BOUND_PADDING,NETWORK_VIEWBOX_WIDTH-radius-NETWORK_NODE_BOUND_PADDING),
    clip(y,radius+NETWORK_NODE_BOUND_PADDING,NETWORK_VIEWBOX_HEIGHT-radius-22)
  ];
}
function clampNetworkGroupDelta(drag,dx,dy){
  let minDx=-Infinity,maxDx=Infinity,minDy=-Infinity,maxDy=Infinity;
  Object.entries(drag.startPositions).forEach(([key,[x,y]])=>{
    const radius=networkNodeRadius(key);
    minDx=Math.max(minDx,radius+NETWORK_NODE_BOUND_PADDING-x);
    maxDx=Math.min(maxDx,NETWORK_VIEWBOX_WIDTH-radius-NETWORK_NODE_BOUND_PADDING-x);
    minDy=Math.max(minDy,radius+NETWORK_NODE_BOUND_PADDING-y);
    maxDy=Math.min(maxDy,NETWORK_VIEWBOX_HEIGHT-radius-22-y);
  });
  const [labelX,labelY]=drag.startLabel;
  minDx=Math.max(minDx,NETWORK_LABEL_BOUND_X-labelX);
  maxDx=Math.min(maxDx,NETWORK_VIEWBOX_WIDTH-NETWORK_LABEL_BOUND_X-labelX);
  minDy=Math.max(minDy,NETWORK_LABEL_BOUND_Y-labelY);
  maxDy=Math.min(maxDy,NETWORK_VIEWBOX_HEIGHT-NETWORK_LABEL_BOUND_Y-labelY);
  return [clip(dx,minDx,maxDx),clip(dy,minDy,maxDy)];
}
function beginNetworkPointerInteraction(e){
  // Mobile keeps the original tap-to-open behavior; layout dragging is desktop-only for now.
  if(isMobileNetworkView()) return;
  if(e.pointerType==='mouse' && e.button!==0) return;
  const target=e.target?.closest?.('.node,.group-label');
  if(!target) return;
  ensureNetworkLayoutState();
  const point=clientToNetworkPoint(e.clientX,e.clientY);
  if(!point) return;
  const node=target.closest('.node');
  const type=node?'node':'group';
  const key=node?.dataset.key || null;
  const group=node ? meta?.defs?.find(def=>def.key===key)?.group : target.dataset.group;
  if(!group || (type==='node' && !networkNodePositions[key])) return;
  const startPositions=type==='node'
    ? {[key]:[...networkNodePositions[key]]}
    : Object.fromEntries(networkSystemKeys(group).map(nodeKey=>[nodeKey,[...networkNodePositions[nodeKey]]]));
  const label=networkCurrentLabelPosition(group);
  networkPointerDrag={
    pointerId:e.pointerId,type,key,group,dragged:false,
    startClientX:e.clientX,startClientY:e.clientY,startPoint:point,
    startPositions,startLabel:[label.x,label.y]
  };
  try{$('network').setPointerCapture(e.pointerId);}catch(_error){}
  e.preventDefault();
  e.stopPropagation();
}
function moveNetworkPointerInteraction(e){
  const drag=networkPointerDrag;
  if(!drag || drag.pointerId!==e.pointerId) return;
  const point=clientToNetworkPoint(e.clientX,e.clientY);
  if(!point) return;
  if(!drag.dragged){
    const distance=Math.hypot(e.clientX-drag.startClientX,e.clientY-drag.startClientY);
    if(distance<NETWORK_DRAG_THRESHOLD_PX) return;
    drag.dragged=true;
    cancelNetworkResetAnimation();
    cancelNetworkTopologyAnimation();
    networkIntro=null;
    cancelAnimationFrame(networkIntroRaf);
    stopNetworkLabelAnimation(drag.group);
    drag.startPositions=drag.type==='node'
      ? {[drag.key]:[...networkNodePositions[drag.key]]}
      : Object.fromEntries(networkSystemKeys(drag.group).map(key=>[key,[...networkNodePositions[key]]]));
    const currentLabel=networkCurrentLabelPosition(drag.group);
    drag.startLabel=[currentLabel.x,currentLabel.y];
    closeMobileNodeControl();
    document.body.classList.add('network-layout-dragging');
  }
  // The pointer moves in the stretched view; the stored layout is in design space. Dividing the
  // delta back out is what keeps a dragged node under the cursor whatever shape the panel is.
  let dx=(point.x-drag.startPoint.x)/networkSpreadX, dy=(point.y-drag.startPoint.y)/networkSpreadY;
  if(drag.type==='node'){
    const [startX,startY]=drag.startPositions[drag.key];
    networkNodePositions[drag.key]=clampNetworkNodePosition(drag.key,startX+dx,startY+dy);
  }else{
    [dx,dy]=clampNetworkGroupDelta(drag,dx,dy);
    Object.entries(drag.startPositions).forEach(([key,[startX,startY]])=>{
      networkNodePositions[key]=[startX+dx,startY+dy];
    });
    networkLabelPositions[drag.group]=[drag.startLabel[0]+dx,drag.startLabel[1]+dy];
  }
  updateNetworkResetButton();
  if(latest) renderNetwork(latest,true);
  e.preventDefault();
  e.stopPropagation();
}
function endNetworkPointerInteraction(e,cancelled=false){
  const drag=networkPointerDrag;
  if(!drag || drag.pointerId!==e.pointerId) return;
  networkPointerDrag=null;
  networkSuppressClickUntil=performance.now()+80;
  document.body.classList.remove('network-layout-dragging');
  try{$('network').releasePointerCapture(e.pointerId);}catch(_error){}
  if(drag.dragged){
    if(drag.type==='node' && !networkTopologyLayoutActive) animateNetworkLabelToCentroid(drag.group);
    updateNetworkResetButton();
    if(latest) renderNetwork(latest,true);
  }else if(!cancelled){
    if(drag.type==='node'){
      const rendered=$('network')?.querySelector(`.node[data-key="${drag.key}"]`);
      const anchorRect=rendered?.getBoundingClientRect();
      selectParam(drag.key);
      if(anchorRect) openMobileNodeControl(drag.key,anchorRect);
    }else{
      triggerNetworkSystemPulse(drag.group);
    }
  }
  e.preventDefault();
  e.stopPropagation();
}
function wireNetworkLayoutInteractions(){
  const svg=$('network');
  if(!svg || svg.dataset.layoutReady) return;
  svg.dataset.layoutReady='1';
  svg.addEventListener('pointerdown',beginNetworkPointerInteraction);
  svg.addEventListener('pointermove',moveNetworkPointerInteraction);
  svg.addEventListener('pointerup',e=>endNetworkPointerInteraction(e,false));
  svg.addEventListener('pointercancel',e=>endNetworkPointerInteraction(e,true));
  svg.addEventListener('lostpointercapture',e=>{
    if(networkPointerDrag?.pointerId===e.pointerId) endNetworkPointerInteraction(e,true);
  });
  document.addEventListener('click',e=>{
    if(performance.now()>=networkSuppressClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
  },true);
  $('topologyNetworkLayout')?.addEventListener('click',applyNetworkTopologyLayout);
  $('resetNetworkLayout')?.addEventListener('click',resetNetworkLayout);
}

function svgEl(name, attrs){ const n=document.createElementNS('http://www.w3.org/2000/svg', name); Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v)); return n; }
function renderNetwork(snap, force=false){
  updateNetworkResetButton();
  const now=performance.now();
  // Above the high-speed threshold the network becomes an overview: it redraws a few times a
  // second instead of every frame, and CSS turns off the pulses and edge animation. Letting it
  // keep repainting at full rate while hours slid past was the single loudest complaint about
  // the rolled-back build - the picture churned faster than anyone could read it.
  const renderInterval=isHighSpeed() ? NETWORK_OVERVIEW_INTERVAL_MS : NETWORK_RENDER_INTERVAL_MS;
  if(!force && now-lastNetworkRenderAt < renderInterval) return;
  lastNetworkRenderAt=now;
  const svg=$('network');
  // Design-space positions first (they are what the intro animation, the label centroids and the
  // drag bookkeeping all speak), then the aspect transform on the way to the screen.
  const layoutPositions=networkRenderPositions(now);
  const positions=networkSpreadPositions(layoutPositions);
  applyNetworkViewBox();
  while(svg.firstChild) svg.removeChild(svg.firstChild);
  if(networkIntro?.mode==='start' && networkIntro.geom){
    const backdropOpacity=yinYangBackdropOpacity(now);
    // Only the centre follows the aspect transform; the taijitu keeps its own circular radius,
    // because a squashed one would read as a rendering fault rather than as a design.
    if(backdropOpacity>0){
      const [gx,gy]=networkSpreadPoint(networkIntro.geom.cx, networkIntro.geom.cy);
      renderYinYangBackdrop(svg, {...networkIntro.geom, cx:gx, cy:gy}, backdropOpacity);
    }
  }
  // System captions belong to the full picture. With one loop on screen they label mostly empty
  // space, so a lesson drops them.
  if(!networkTopologyLayoutActive && !visibleNodeKeys()){
    meta.networkLabels.forEach((label,index)=>{
      const pos=networkLabelPosition(label,index,layoutPositions);
      const [labelX,labelY]=networkSpreadPoint(pos.x,pos.y);
      const draggingGroup=networkPointerDrag?.dragged && networkPointerDrag.type==='group' && networkPointerDrag.group===pos.group;
      const t=svgEl('text',{x:labelX,y:labelY,class:`group-label${draggingGroup?' dragging':''}`,'data-group':pos.group,style:`fill:${systemColor(pos.group)};`});
      applySystemColor(t,pos.group);
      t.textContent=pos.text;
      if(isMobileNetworkView()) t.addEventListener('click',()=>triggerNetworkSystemPulse(pos.group));
      svg.appendChild(t);
    });
  }
  const gEdges=svgEl('g',{});
  svg.appendChild(gEdges);
  const pmap=Object.fromEntries(snap.params.map(p=>[p.key,p]));
  const shown=visibleNodeKeys();
  const greyInactive=Boolean(modeConfig().greyUntouched);
  meta.edges.forEach(e=>{
    // An edge survives only if both of its ends are on screen; a line running off to a hidden
    // node is worse than no line, because it implies a node the learner cannot find.
    if(shown && (!shown.has(e.from) || !shown.has(e.to))) return;
    const p1=positions[e.from], p2=positions[e.to];
    if(!p1||!p2) return;
    const from=pmap[e.from], to=pmap[e.to];
    const line=svgEl('line',{x1:p1[0],y1:p1[1],x2:p2[0],y2:p2[1],class:'edge'});
    // A live edge is one whose SOURCE has already moved: that is the direction the signal is
    // travelling, and watching those light up in order is the whole lesson.
    const live=!greyInactive || nodeHasBeenActive(from);
    const act=live
      ? Math.min(1,.30+Math.abs(from?.state||0)*.30+Math.abs(to?.state||0)*.10)
      : (shown ? .09 : Math.min(1,.15+Math.abs(from?.state||0)*.26+Math.abs(to?.state||0)*.08));
    line.setAttribute('stroke', live || !shown ? (e.sign>0?'var(--promote)':'var(--inhibit)') : NETWORK_INACTIVE_EDGE);
    line.setAttribute('stroke-width',(0.8+e.weight*2.1+Math.abs(from?.state||0)*.7).toFixed(2));
    line.setAttribute('opacity',act.toFixed(2));
    gEdges.appendChild(line);
  });
  const gNodes=svgEl('g',{});
  svg.appendChild(gNodes);
  snap.params.forEach(p=>{
    if(shown && !shown.has(p.key)) return;
    const pos=positions[p.key];
    if(!pos) return;
    const major=meta.majorKeys.includes(p.key), r=major?NETWORK_MAJOR_NODE_RADIUS:NETWORK_MINOR_NODE_RADIUS;
    const nodeFontScale=isMobileNetworkView()?NETWORK_MOBILE_NODE_FONT_SCALE:1;
    const draggingNode=networkPointerDrag?.dragged && networkPointerDrag.type==='node' && networkPointerDrag.key===p.key;
    // Grey means "has not moved yet". Colour arriving at a node is the feedback reaching it, so
    // a learner can watch the signal travel around the loop instead of being told that it does.
    const active=!greyInactive || nodeHasBeenActive(p);
    const g=svgEl('g',{class:`node${draggingNode?' dragging':''}${active?'':' node-inactive'}`,transform:`translate(${pos[0]},${pos[1]})`,'data-key':p.key});
    const nodeColor=active ? heatColorFromBias(emphasizeBias(p.stateBias)) : NETWORK_INACTIVE_NODE;
    const glow=svgEl('circle',{r:r+5,fill:hexToRgba(nodeColor,active?.22:.10),stroke:'none',opacity:.96});
    const selected=p.key===selectedKey;
    const pulseExtra=networkNodePulseExtra(p.key, p.group, now);
    const ring=pulseExtra>.12 ? svgEl('circle',{r:(r+pulseExtra).toFixed(2),fill:'none',stroke:'#fff','stroke-width':(2.2+pulseExtra*.05).toFixed(2),opacity:(.72-pulseExtra*.045).toFixed(2),'vector-effect':'non-scaling-stroke'}) : null;
    const c=svgEl('circle',{r,fill:nodeColor,stroke:selected?'#fff':hexToRgba(nodeColor,active?.80:.45),'stroke-width':selected?3.1:1.9,opacity:active?.98:.62});
    const val=svgEl('text',{y:4.4*nodeFontScale,style:`font-size:${NETWORK_NODE_LABEL_SIZE*nodeFontScale}px`});
    val.textContent=p.short;
    const tag=svgEl('text',{y:r+16.5*nodeFontScale,style:`font-size:${NETWORK_NODE_VALUE_SIZE*nodeFontScale}px;fill:#d9edff`});
    tag.textContent=p.valueText;
    g.appendChild(glow);
    if(ring) g.appendChild(ring);
    g.appendChild(c);
    g.appendChild(val);
    g.appendChild(tag);
    if(isMobileNetworkView()) g.addEventListener('click',()=>{
      const anchorRect=g.getBoundingClientRect();
      selectParam(p.key);
      openMobileNodeControl(p.key,anchorRect);
    });
    gNodes.appendChild(g);
  });
  updateNetworkResetButton();
  if(mobileNodeControlKey) scheduleMobileNodeControlPosition();
  if(!svg.dataset.firstAutoFitDone){
    svg.dataset.firstAutoFitDone='1';
    networkUserNavigated=false;
    scheduleNetworkFitBurst(true);
  }
}
function renderLog(snap){ const box=$('eventlog'); if(!box) return; box.innerHTML = snap.logLines.map(l=>`<p><b>${l.t.toFixed(1)}s</b> ${l.text}</p>`).join('') || `<p>${TEXT.initLog}</p>`; }
function togglePause(){
  // Pause is a live-engine control, so reaching for it is a request to come back off the tape.
  if(replayActive){ exitReplay(); return; }
  if(terminalObserveMode) return;
  if(reportStopped){
    if(latest?.dead) return;
    reportStopped=false;
    paused=false;
    if($('scenarioMenuBtn')) $('scenarioMenuBtn').setAttribute('aria-label', TEXT.selectDiseaseAria);
  updateScenarioMenuLabel($('scenario')?.value || '');
  $('pauseBtn').textContent=TEXT.pause;
    applyInteractionLocks();
    lastTick=performance.now();
    sessionRecorder.capture(latest,simulationStatus(),true);
    sendLearningEvent('resume_after_report',{simTime:latest?learningRound(latest.simTime,1):null});
    return;
  }
  paused=!paused;
  $('pauseBtn').textContent=paused?TEXT.resume:TEXT.pause;
  sessionRecorder.capture(latest,simulationStatus(),true);
  sendLearningEvent(paused ? 'pause' : 'resume', {simTime: latest ? learningRound(latest.simTime, 1) : null});
}
function isMobileLayout(){ return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches; }
function updateMobileJumpButton(){
  const btn=$('mobileJumpBtn');
  if(!btn) return;
  if(!isMobileLayout()){
    btn.classList.add('hidden');
    return;
  }
  const controls=$('controls');
  const center=document.querySelector('.center-panel');
  if(!controls || !center){
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  const leftRect=document.querySelector('.left-panel')?.getBoundingClientRect();
  const viewportH=window.innerHeight || document.documentElement.clientHeight || 1;
  const controlsVisible=leftRect ? Math.min(leftRect.bottom, viewportH) - Math.max(leftRect.top, 0) : 0;
  const onControls=controlsVisible > Math.min(viewportH*.42, Math.max(120, (leftRect?.height || 0)*.35));
  btn.dataset.target=onControls ? 'top' : 'controls';
  btn.querySelector('.mobile-jump-icon').textContent=onControls ? '↑' : '↓';
  btn.setAttribute('aria-label', onControls
    ? (lang==='zh' ? '返回页面顶部' : 'Back to page top')
    : (lang==='zh' ? '跳转到干预控制台' : 'Jump to Intervention Console'));
}
function jumpMobileSection(){
  const btn=$('mobileJumpBtn');
  if(!btn || !isMobileLayout()) return;
  if(btn.dataset.target==='top'){
    window.scrollTo({top:0,behavior:'smooth'});
    return;
  }
  document.querySelector('.left-panel')?.scrollIntoView({behavior:'smooth', block:'start'});
}
function paramReferenceLinks(info){
  const refs=(info?.refs || []).map(k=>TRUSTED_PARAM_LINKS[k]).filter(Boolean);
  if(!refs.length) return '';
  const label=lang==='zh' ? '参考链接' : 'Useful links';
  const links=refs.map(ref=>`<a href="${ref.url}" target="_blank" rel="noopener noreferrer">${ref.label}</a>`).join('');
  return `<div class="param-info-links"><b>${label}</b>${links}</div>`;
}
function modelDefinition(key){ return meta?.defs?.find(definition=>definition.key===key)?.model || null; }
function modelParameterName(key){ return paramByKey(key)?.short || meta?.defs?.find(definition=>definition.key===key)?.short || key; }
// The per-node time card. This is where the 34 permanent network badges from the rolled-back
// build went: it appears for the one parameter the learner has selected, and it says more than
// a single character ever could - which clock the node runs on, how much faster a treatment
// reaches it, which mechanisms it cannot separate, and which of them exist as their own
// hidden state.
function temporalProfileHtml(explanation){
  const profile=explanation?.temporal;
  if(!profile) return '';
  const zh=lang==='zh';
  const sep=zh?'：':': ';
  const labels=zh
    ? {title:'时间尺度', layer:'主时间层', tau:'内源时间常数', direct:'直接干预时间常数', now:'当前有效', phases:'机制与时间窗', hidden:'内部独立状态', sources:'时间常数依据', driven:'当前由干预主导'}
    : {title:'Time scale', layer:'Primary layer', tau:'Endogenous time constant', direct:'Intervention time constant', now:'Currently effective', phases:'Mechanisms and their windows', hidden:'Separately modelled limbs', sources:'Basis for these time constants', driven:'currently intervention-driven'};
  const phases=profile.phases.map(phase =>
    `<li><b>${phase.windowText}</b><span>${phase.mechanism}${phase.separateState ? ` <em>(${phase.separateState})</em>` : ''}</span></li>`).join('');
  const hidden=(profile.hiddenStates||[]).map(state =>
    `<li><b>${state.label}</b><span>τ ${state.tauText} · ${state.value>=0?'+':''}${Number(state.value).toFixed(2)}</span></li>`).join('');
  const sources=(profile.sources||[]).map(source =>
    `<li><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.note}</a></li>`).join('');
  const driven=profile.externallyDriven>0.05
    ? `<span class="temporal-driven">${Math.round(profile.externallyDriven*100)}% ${labels.driven}</span>` : '';
  return `<details class="temporal-profile"><summary><i class="temporal-dot" style="background:${profile.layerColor}"></i>${labels.title}${sep}${profile.layerLabel} · τ ${profile.tauText}</summary>
    <div class="temporal-body">
      <p><b>${labels.tau}</b>${sep}${profile.tauText} ｜ <b>${labels.direct}</b>${sep}${profile.directTauText}</p>
      <p><b>${labels.now}</b>${sep}${profile.effectiveTauText} ${driven}</p>
      <div class="temporal-section"><b>${labels.phases}</b><ul>${phases}</ul></div>
      ${hidden ? `<div class="temporal-section"><b>${labels.hidden}</b><ul>${hidden}</ul></div>` : ''}
      <div class="temporal-section temporal-sources"><b>${labels.sources}</b><ul>${sources}</ul></div>
    </div></details>`;
}
function modelTransparencyHtml(p){
  const model=modelDefinition(p.key);
  if(!model) return '';
  const explanation=parameterExplanations[p.key];
  const zh=lang==='zh';
  const labels=zh
    ? {title:'模型透明度',kind:'变量语义',equation:'教学方程',inputs:'模型输入',outputs:'模型输出',assumptions:'主要假设',sources:'来源与证据',drive:'当前下一步驱动',none:'当前没有明显的非基线驱动。',method:'贡献采用逐项回到基线的反事实计算；反馈和非线性使各项不能相加。',manual:'手动干预',scenario:'场景驱动'}
    : {title:'Model transparency',kind:'Variable semantics',equation:'Teaching equation',inputs:'Model inputs',outputs:'Model outputs',assumptions:'Key assumptions',sources:'Sources & evidence',drive:'Current next-step drivers',none:'No material non-baseline driver at this moment.',method:'Each contribution is a one-at-a-time return-to-baseline counterfactual; feedback and nonlinearity mean terms are not additive.',manual:'Manual control',scenario:'Scenario driver'};
  const kind={
    'absolute-measurement':zh?'绝对生理测量量':'absolute physiological measurement',
    'relative-effect':zh?'相对生理效应':'relative physiological effect',
    'physiological-index':zh?'教学性生理指数':'teaching physiological index'
  }[model.unitKind] || model.unitKind;
  const list=keys=>keys?.length ? keys.map(modelParameterName).join(zh?'、':', ') : '-';
  const assumptions=(model.assumptions||[]).map(text=>`<li>${text}</li>`).join('') || `<li>-</li>`;
  const sourceHtml=(model.sourceIds||[]).map(id=>{
    const source=meta?.modelSources?.[id];
    if(!source) return '';
    const title=source.url ? `<a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title}</a>` : source.title;
    return `<li>${title}${source.note?`<small>${source.note}</small>`:''}</li>`;
  }).join('') || `<li>-</li>`;
  const terms=(explanation?.contributions||[]).map(term=>{
    const label=term.kind==='manual-control' ? labels.manual
      : term.kind==='scenario-driver' ? labels.scenario
      : term.kind==='scenario-flux' ? (zh?'持续丢失/获得':'ongoing loss or gain')
      : modelParameterName(term.sourceKey);
    const direction=term.value>=0?'↑':'↓';
    const suffix=term.perMinute ? (zh?' / 分钟':' /min') : '';
    return `<li><b>${direction} ${label}</b><span>${term.value>=0?'+':''}${Number(term.value).toFixed(2)}${suffix}</span></li>`;
  }).join('') || `<li>${explanation ? labels.none : (zh?'正在计算当前贡献…':'Calculating current contributions…')}</li>`;
  const delta=Number(explanation?.targetDelta)||0;
  const tendency=Math.abs(delta)<.002 ? '→' : delta>0 ? '↑' : '↓';
  return `${temporalProfileHtml(explanation)}<details class="model-transparency"${modelTransparencyOpen?' open':''}><summary>${labels.title}</summary><div class="model-transparency-body"><p><b>${labels.kind}</b>：${kind}<br><small>${model.unitRationale}</small></p><p><b>${labels.equation}</b>：${model.equation?.description||'-'}</p><p><b>${labels.inputs}</b>：${list(model.inputKeys)}</p><p><b>${labels.outputs}</b>：${list(model.outputKeys)}</p><div class="model-contribution"><b>${labels.drive}</b><span class="model-drive-direction">${tendency}</span><ul>${terms}</ul><small>${labels.method}</small></div><div class="model-transparency-section"><b>${labels.assumptions}</b><ul>${assumptions}</ul></div><div class="model-transparency-section model-source-list"><b>${labels.sources}</b><ul>${sourceHtml}</ul></div></div></details>`;
}
function refreshParameterExplanation(key){
  if(!sid || !latest || parameterExplanationRequests.has(key)) return;
  const cached=parameterExplanations[key];
  if(cached && Math.abs(Number(cached.simTime)-Number(latest.simTime))<1.25) return;
  parameterExplanationRequests.add(key);
  api(`/api/session/${sid}/explain`,{key}).then(explanation=>{
    parameterExplanations[key]=explanation;
    if(selectedKey===key) renderParamInfo();
  }).catch(error=>console.warn('Parameter explanation failed',error)).finally(()=>parameterExplanationRequests.delete(key));
}
function selectedParamInfoHtml(){
  if(!selectedKey) return '';
  const p=paramByKey(selectedKey), info=PARAM_CLINICAL[selectedKey];
  if(!p || !info) return '';
  const unit=p.unit ? ` ${p.unit}` : '';
  const sep=lang==='zh' ? '：' : ': ';
  const stop=lang==='zh' ? '。' : '. ';
  const currentLabel=lang==='zh' ? '当前读数' : 'Current';
  const statusLabel=lang==='zh' ? '状态' : 'Status';
  const zoneLabel=p.zone==='danger' ? TEXT.legend[4] : p.zone==='warn' ? TEXT.legend[3] : TEXT.legend[2];
  const statusText=terminalObserveMode ? '-' : zoneLabel;
  const statusClass=terminalObserveMode ? 'param-status-muted' : `param-status-${p.zone}`;
  const detailBlocks=(info.details||[]).map(detail=>`<p><b>${detail.title}</b>${sep}${detail.text}</p>`).join('');
  return `<div class="param-info-card"><div class="param-info-head"><b>${p.label}</b><span>${currentLabel}${sep}${p.valueText}${unit}</span></div><p class="param-status-line"><b>${statusLabel}</b>${sep}<span class="param-status ${statusClass}">${statusText}</span>${stop}</p><p><b>${TEXT.paramIntroLabel}</b>${sep}${info.intro}</p><p><b>${TEXT.paramMeaningLabel}</b>${sep}${info.meaning}</p>${detailBlocks}${paramReferenceLinks(info)}${modelTransparencyHtml(p)}</div>`;
}
function renderParamInfo(){
  const box=$('rulesBox');
  if(!box) return;
  box.innerHTML=selectedKey ? selectedParamInfoHtml() : TEXT.rules;
  const transparency=box.querySelector('.model-transparency');
  transparency?.addEventListener('toggle',()=>{ modelTransparencyOpen=transparency.open; });
}
function renderConditions(snap){
  const box=$('diagnosisList');
  const conditionHtml=!snap.conditions.length
    ? `<div class="diag-item"><div class="diag-meta">${TEXT.noCondition}</div></div>`
    : snap.conditions.slice(0,4).map(c=>`<div class="diag-item"><div class="diag-top"><span class="diag-name">${c.name}</span><span class="diag-stage">${c.stage}</span></div><div class="diag-meta">${TEXT.severity} ${c.severity.toFixed(2)} ｜ ${TEXT.helpful} ${c.help.toFixed(2)} ｜ ${TEXT.harmful} ${c.harm.toFixed(2)}</div><div class="diag-hint">${c.why}</div><div class="diag-hint diag-help">${c.good}</div><div class="diag-hint diag-harm">${c.bad}</div></div>`).join('');
  box.innerHTML=conditionHtml;
}
function clearParamSelection(forceNetwork=true){
  closeMobileNodeControl();
  selectedKey=null;
  modelTransparencyOpen=false;
  $('detailTitle').textContent=TEXT.detailTitle;
  $('detailText').textContent=TEXT.detailText;
  renderParamInfo();
  if(latest){
    renderConditions(latest);
    renderNetwork(latest, forceNetwork);
  }
}
function renderTimeConsole(){
  if(!timeMeta) return;
  const tabs=$('lensTabs');
  if(tabs){
    if(tabs.dataset.ready !== '1'){
      tabs.innerHTML=timeMeta.lenses.map(lens =>
        // The caption is the compression, not the observation window. A window printed bare
        // under a tab called "Sec" was read as a rate - reasonably, since a tab strip captioned
        // with durations invites exactly that question. The window has not gone anywhere: it is
        // on the focus line below, where it is labelled "Window" and cannot be mistaken for
        // anything else. The tooltip carries all three facts for anyone who wants them.
        `<button type="button" class="lens-tab" data-lens="${lens.id}" title="${lens.title} · ${TEXT.lensWindowLabel}${lang === 'zh' ? '：' : ': '}${lens.windowText} · ${lens.rateText} · ${lens.focus}"><span class="lens-name">${lens.label}</span><span class="lens-window">${lens.rateShort}</span></button>`).join('');
      tabs.querySelectorAll('.lens-tab').forEach(button => button.addEventListener('click', () => {
        setAutoLens(false, {silent:true});
        sessionTimeScale.manualLensSwitches+=1;
        setLens(button.dataset.lens);
        renderTimeConsole();
      }));
      tabs.dataset.ready='1';
    }
    // While the tape rolls the console reports the RECORDED scale, not the engine's. The two are
    // different things and conflating them would tell the learner they are watching seconds while
    // replaying an hour.
    const shownLens=replayActive && replayDisplayLens ? replayDisplayLens : lensId;
    tabs.querySelectorAll('.lens-tab').forEach(button => {
      const active=button.dataset.lens === shownLens;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      // Locked during replay: the scale belongs to the recording, so changing it would be
      // editing history rather than choosing a view.
      button.disabled=replayActive;
    });
    tabs.classList.toggle('replay-locked', replayActive);
  }
  const shownCompression=replayActive && replayDisplayCompression != null
    ? replayDisplayCompression
    : currentCompression();
  const toggle=$('autoLensToggle');
  if(toggle){
    toggle.classList.toggle('on', autoLensEnabled);
    toggle.setAttribute('aria-pressed', String(autoLensEnabled));
    toggle.textContent=autoLensEnabled ? TEXT.autoOn : TEXT.autoOff;
    toggle.disabled=replayActive;
  }
  const slider=$('speed');
  if(slider){
    slider.max=String((timeMeta.speedSteps?.length || 6) - 1);
    slider.value=String(speedIndex);
    slider.setAttribute('aria-valuetext', `${speedMultiplier()}×`);
  }
  if($('speedDown')) $('speedDown').disabled=replayActive;
  if($('speedUp')) $('speedUp').disabled=replayActive;
  if($('speedText')) $('speedText').textContent=`×${speedMultiplier()}`;
  if($('compressionText')) $('compressionText').textContent=describeCompression(shownCompression);
  const focus=$('lensFocus');
  if(focus){
    const lens=lensById(replayActive && replayDisplayLens ? replayDisplayLens : lensId);
    focus.textContent=lens ? `${TEXT.lensWindowLabel}${lang === 'zh' ? '：' : ': '}${lens.windowText} · ${lens.focus}` : '';
  }
  document.body.classList.toggle('high-speed', isHighSpeed());
  document.body.classList.toggle('time-scale-locked', replayActive);
  $('timeConsole')?.setAttribute('data-locked-note', replayActive ? TEXT.timeScaleLockedNote : '');
}
function adjustSpeed(delta){
  const steps=timeMeta?.speedSteps?.length || 6;
  const next=Math.max(0, Math.min(steps-1, speedIndex+delta));
  if(next === speedIndex) return;
  speedIndex=next;
  setAutoLens(autoLensEnabled, {silent:true});
  renderTimeConsole();
  logSpeedChange('button');
}

// ---------------------------------------------------------------------------------------
// Mode plumbing
// ---------------------------------------------------------------------------------------
// The mode is encoded in the URL so a link can be set as coursework, and switching writes the
// URL back with replaceState rather than reloading - a mid-session switch must not throw away
// the session, because the whole point of switching is to look at the same patient a new way.
function modeHref(id){
  const params=new URLSearchParams(location.search);
  params.set('lang', lang);
  if(id === DEFAULT_MODE) params.delete('mode'); else params.set('mode', id);
  const query=params.toString();
  return `simulator.html${query ? `?${query}` : ''}`;
}
function applyModeToUrl(){
  const params=new URLSearchParams(location.search);
  if(activeMode === DEFAULT_MODE) params.delete('mode'); else params.set('mode', activeMode);
  const query=params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}
// The mode picker is one entry with two items, not two tabs standing side by side.
//
// Each mode used to carry its explanatory question in the header, permanently, next to the other
// mode's question. Two glosses on screen at all times is a lot of prose to spend on a binary
// choice, and it pushed the rest of the header around. The option names now carry the whole
// distinction - one system's loop, or the whole network - so the gloss has nothing left to add.
function openModeMenu(open){
  const menu=$('modeMenu'), button=$('modeMenuBtn');
  if(!menu || !button) return;
  const show=Boolean(open) && !button.disabled;
  menu.hidden=!show;
  button.setAttribute('aria-expanded', String(show));
  button.classList.toggle('open', show);
}
function renderModeSwitch(){
  const menu=$('modeMenu');
  if(!menu) return;
  if(menu.dataset.ready !== '1'){
    menu.innerHTML=MODE_ORDER.map(id =>
      `<button type="button" class="mode-item" role="menuitem" data-mode="${id}">${TEXT.modes[id].name}</button>`).join('');
    menu.querySelectorAll('.mode-item').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      openModeMenu(false);
      setLearningMode(button.dataset.mode);
    }));
    menu.dataset.ready='1';
  }
  menu.querySelectorAll('.mode-item').forEach(button => {
    const active=button.dataset.mode === activeMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  if($('modeLabel')) $('modeLabel').textContent=TEXT.modeLabel;
  if($('modeMenuLabel')) $('modeMenuLabel').textContent=TEXT.modes[activeMode].name;
  if($('modeMenuBtn')) $('modeMenuBtn').setAttribute('aria-label', `${TEXT.modeLabel}: ${TEXT.modes[activeMode].name}`);
}
// The learner's own custom slider selection, parked while a guided mode is imposing its own.
let savedUserControlKeys = null;
let savedUserControlFilter = null;
function applyGuidedControlKeys(){
  const lesson=lessonById(activeLesson);
  customControlKeys=lesson ? new Set(lesson.controls) : systemControlKeys(activeLessonSystem);
  applyControlFilter('custom');
}
// Switching system clears the running lesson: its perturbation belongs to the system being left,
// and leaving it applied would have the learner watching one system through another's console.
async function selectLessonSystem(system){
  if(system === activeLessonSystem) return;
  activeLessonSystem=system;
  activeLesson=null;
  applyGuidedControlKeys();
  renderGuidedPanel();
  if(sid && !terminalObserveMode && !reportStopped){
    await performRestartSession();
  }
  if(latest){ renderSnapshot(latest); renderNetwork(latest, true); }
  networkUserNavigated=false;
  scheduleNetworkFitBurst(true);
  sendLearningEvent('lesson_system_change', {system});
}
// The nodes the network is allowed to draw. Null means "all of them", which is every mode but
// the guided one. A lesson names its own loop, and the picture is cut to it: showing all
// thirty-four while teaching one loop does not give the beginner more information, it gives
// them the same loop hidden inside a haystack.
function visibleNodeKeys(){
  if(!modeConfig().showGuided) return null;
  const lesson=lessonById(activeLesson);
  if(lesson) return new Set(lesson.nodes);
  // No lesson chosen yet: show the selected system rather than all thirty-four nodes.
  return systemNodeKeys(activeLessonSystem);
}
async function setLearningMode(id, {initial=false}={}){
  const next=normalizeMode(id);
  if(!initial && next === activeMode) return;
  activeMode=next;
  storeMode(activeMode);
  applyModeToUrl();
  await applyLearningMode({initial});
  if(!initial){
    toast(TEXT.modeSwitched(TEXT.modes[activeMode].name));
    sendLearningEvent('learning_mode_change', {mode:activeMode});
  }
}
async function applyLearningMode({initial=false}={}){
  const config=modeConfig();
  storeMode(activeMode);
  MODE_ORDER.forEach(id => document.body.classList.toggle(`mode-${id}`, id === activeMode));
  // Sliders. Entering a guided mode parks whatever the learner had chosen for themselves so
  // that leaving it does not silently discard their selection.
  if(config.controls === 'guided'){
    if(savedUserControlKeys === null){
      savedUserControlKeys=customControlKeys ? new Set(customControlKeys) : false;
      savedUserControlFilter=activeControlFilter;
    }
    applyGuidedControlKeys();
  }else if(savedUserControlKeys !== null){
    customControlKeys=savedUserControlKeys === false ? null : savedUserControlKeys;
    applyControlFilter(savedUserControlFilter === 'custom' && !customControlKeys ? 'all' : savedUserControlFilter);
    savedUserControlKeys=null;
    savedUserControlFilter=null;
  }
  // The lens. A locked lens also switches automatic scaling off, because an auto toggle that
  // cannot move anything reads as broken. In the guided mode the lock follows the active
  // lesson: a reflex is a seconds story and RAAS is not, and a beginner asked to watch
  // aldosterone at one second per second would rightly conclude the model was broken.
  const wantedLens=config.lockLens==='lesson'
    ? (lessonById(activeLesson)?.lens || 'seconds')
    : config.lockLens;
  if(wantedLens){
    setAutoLens(false, {silent:true});
    if(lensId !== wantedLens) setLens(wantedLens);
  }else if(initial){
    setAutoLens(config.autoLens, {silent:true});
  }
  // CRITICAL for "trace one loop": the engine, not the stylesheet, decides that this session is
  // not scored. Hiding the stability bar while damage kept accumulating would still kill the
  // patient, still write a death into the report, and still hand the next mode a corpse. A
  // novice tracing a reflex must not be under threat at all - a falling health bar turns
  // exploration into a game, and a game teaches protecting the score instead of perturbing the
  // system, which is the only thing this mode asks them to do.
  if(sid && latest && Boolean(latest.noThreat) !== Boolean(config.noThreat)){
    try{
      latest=await api(`/api/session/${sid}/threat`, {enabled:!config.noThreat});
    }catch(e){ console.error(e); }
  }
  if(config.controls !== 'guided') activeLesson=null;
  renderModeSwitch();
  renderGuidedPanel();
  applyInteractionLocks();
  if(latest){ renderSnapshot(latest); renderNetwork(latest, true); }
  if(activeMode === 'trace' && !initial) showTimeNotice(TEXT.modeTraceNotice, 'info');
}

// ---------------------------------------------------------------------------------------
// Guided perturbations (mode A)
// ---------------------------------------------------------------------------------------
function renderGuidedPanel(){
  const list=$('guidedList');
  if(!list) return;
  if($('guidedTitle')) $('guidedTitle').textContent=TEXT.guidedTitle;
  if($('guidedHint')) $('guidedHint').textContent=TEXT.guidedHint;
  if($('guidedClear')) $('guidedClear').textContent=TEXT.guidedClear;
  const tabs=$('lessonSystemTabs');
  if(!modeConfig().showGuided){ list.innerHTML=''; if(tabs) tabs.innerHTML=''; return; }
  // One system at a time. The system tabs are the first cut; the lesson is the second.
  if(tabs){
    tabs.innerHTML=LESSON_SYSTEMS.map(id =>
      `<button type="button" class="lesson-system-tab${id===activeLessonSystem?' active':''}" data-system="${id}"
        style="--sys:${systemColor(id)}" aria-pressed="${id===activeLessonSystem}">${TEXT.lessonSystems[id]}</button>`).join('');
    tabs.querySelectorAll('.lesson-system-tab').forEach(button =>
      button.addEventListener('click', () => selectLessonSystem(button.dataset.system)));
  }
  const lessons=LESSONS.filter(l => l.system === activeLessonSystem);
  const lensTitle=id => timeMeta?.lenses?.find(l => l.id === id)?.title || id;
  list.innerHTML=lessons.map(lesson => {
    const copy=TEXT.lessons[lesson.id];
    const active=lesson.id === activeLesson;
    return `<div class="guided-item lesson-${lesson.kind}${active?' active':''}" data-lesson="${lesson.id}">
      <div class="guided-top">
        <span class="guided-label">${copy.label}</span>
        <span class="lesson-kind lesson-kind-${lesson.kind}">${TEXT.lessonKinds[lesson.kind]}</span>
      </div>
      <div class="guided-question"><b>${TEXT.guidedQuestionLabel}</b>${lang==='zh'?'：':': '}${copy.question}</div>
      ${active?`<div class="guided-focus"><b>${TEXT.guidedWatch}</b>${lang==='zh'?'：':': '}${copy.focus}</div>
        <div class="lesson-source"><b>${TEXT.lessonSourceLabel}</b>${lang==='zh'?'：':': '}${copy.source}</div>
        <div class="lesson-lens">${TEXT.lessonLensNote(lensTitle(lesson.lens))}</div>
        <div class="lesson-lens lesson-grey-hint">${TEXT.lessonInactiveHint}</div>`:''}
      <button type="button" class="guided-apply" data-apply="${lesson.id}">${active?TEXT.guidedReapply:TEXT.guidedApply}</button>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-apply]').forEach(button =>
    button.addEventListener('click', () => startLesson(button.dataset.apply)));
}
// Starting a lesson cuts the whole app down to that one loop: the network to its nodes, the
// console to its controls, the clock to the scale its slowest limb lives on. Then it applies the
// perturbation - or loads the case, for a disease lesson - through the ordinary paths, so what
// the learner watches is the same machinery they would drive by hand.
async function startLesson(id){
  const lesson=lessonById(id);
  if(!lesson || !sid || terminalObserveMode || reportStopped) return;
  activeLesson=id;
  activeLessonSystem=lesson.system;
  applyGuidedControlKeys();
  if(lesson.lens && lensId !== lesson.lens) setLens(lesson.lens);
  // Every lesson starts from a clean baseline, otherwise the previous lesson's leftovers are
  // still moving and the whole point - seeing which node moves FIRST - is lost.
  await performRestartSession();
  activeLesson=id;
  activeLessonSystem=lesson.system;
  applyGuidedControlKeys();
  if(lesson.scenario){
    latest=await api(`/api/session/${sid}/scenario`, {name:lesson.scenario});
  }else{
    for(const [key, value] of Object.entries(lesson.apply || {})){
      await sendControl(key, value, 'guided_perturbation');
    }
  }
  renderGuidedPanel();
  renderSnapshot(latest);
  renderNetwork(latest, true);
  networkUserNavigated=false;
  scheduleNetworkFitBurst(true);
  const copy=TEXT.lessons[id];
  toast(`${copy.label}｜${copy.question}`);
  sendLearningEvent('lesson_start', {lesson:id, system:lesson.system, kind:lesson.kind, lens:lesson.lens});
}

// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------
// Inline caution while a control is being dragged (modes A and B)
// ---------------------------------------------------------------------------------------
// 34 sliders invite treating the number: read K+ 6.2, drag potassium down, and you have done
// something that looks like treatment. The engine scores that, but only in the end-of-session
// report - by which time the lesson has been learned the wrong way round. The backend returns a
// caution with the control commit itself, so the line appears while the finger is still on the
// slider. It expires on its own so a stale warning never sits under a slider that has since
// been corrected.
const CAUTION_VISIBLE_MS = 11000;
const controlCautions = new Map();
function cautionEnabled(){ return Boolean(modeConfig().caution); }
function renderControlCaution(key){
  const entry=controlCautions.get(key);
  document.querySelectorAll(`.control-card[data-key="${key}"]`).forEach(card => {
    let line=card.querySelector('.control-caution');
    if(!entry){ line?.remove(); card.classList.remove('has-caution'); return; }
    if(!line){
      line=document.createElement('div');
      line.className='control-caution';
      card.appendChild(line);
    }
    line.innerHTML=`<b>${TEXT.cautionLabel}</b>${lang==='zh'?'：':': '}${entry.text}`;
    card.classList.add('has-caution');
  });
}
function noteControlCaution(caution){
  if(!caution || !cautionEnabled()) return;
  controlCautions.set(caution.key, {text:caution.text, until:performance.now()+CAUTION_VISIBLE_MS});
  renderControlCaution(caution.key);
  sendLearningEvent('intervention_caution', {
    key:caution.key, direction:caution.direction,
    condition:caution.conditionName, net:caution.net, hazardDelta:caution.hazardDelta
  });
}
function clearControlCaution(key){
  if(!controlCautions.has(key)) return;
  controlCautions.delete(key);
  renderControlCaution(key);
}
function expireControlCautions(){
  if(!controlCautions.size) return;
  const now=performance.now();
  [...controlCautions.entries()].forEach(([key, entry]) => {
    // A slider dragged back to rest has answered the caution; drop it immediately rather than
    // leaving a warning under a control that is no longer doing anything.
    const control=Math.abs(Number(paramByKey(key)?.control) || 0);
    if(now > entry.until || control < 6) clearControlCaution(key);
  });
}

function renderStatus(snap){
  const health=Math.max(0,Math.min(100,snap.health));
  const roundedHealth=Math.round(health);
  // The clock reads in the units the current scale calls for, so a three-day run does not
  // display as "259200.0 s".
  $('timeText').textContent=formatSimDuration(snap.simTime);
  if($('simClock')) $('simClock').textContent=formatSimDuration(snap.simTime);
  $('healthNum').textContent=roundedHealth; $('healthFill').style.width=health+'%';
  if($('mobileHealthNum')) $('mobileHealthNum').textContent=roundedHealth;
  if($('mobileHealthFill')) $('mobileHealthFill').style.width=health+'%';
  const mobileHealthbar=document.querySelector('.mobile-healthbar');
  if(mobileHealthbar) mobileHealthbar.setAttribute('aria-valuenow',String(roundedHealth));
  updateNetworkStabilityAlert(snap.health);
  if($('fastPhase')) $('fastPhase').textContent=TEXT.fast;
  if($('slowPhase')) $('slowPhase').textContent=snap.chronic<.05?TEXT.slowWait:(snap.chronic<.95?(lang==='zh'?`慢性调节：${Math.round(snap.chronic*100)}%`:`Chronic regulation: ${Math.round(snap.chronic*100)}%`):TEXT.slowFull);
  if($('scoreText')) $('scoreText').textContent=TEXT.score(snap.stableScore);
  renderTimeConsole();
  expireTimeNotice();
  $('dangerPills').innerHTML=(snap.offenders||[]).map(k=>{ const p=paramByKey(k); return `<span class="pill">${p?.short||k}</span>`; }).join('');
}
function selectParam(k, forceNetwork=true, pulse=true){
  if(selectedKey!==k) modelTransparencyOpen=false;
  selectedKey=k; const p=paramByKey(k); if(!p || !meta) return;
  if(pulse) triggerNetworkNodePulse(k);
  const sep=lang==='zh' ? '：' : ': ';
  const stop=lang==='zh' ? '。' : '. ';
  const listSep=lang==='zh' ? '，' : ', ';
  const incoming=meta.edges.filter(e=>e.to===k).slice(0,8).map(e=>`${paramByKey(e.from)?.short||e.from} ${e.sign>0?'↑':'↓'}`).join(listSep) || '-';
  const outgoing=meta.edges.filter(e=>e.from===k).slice(0,8).map(e=>`${e.sign>0?'↑':'↓'} ${paramByKey(e.to)?.short||e.to}`).join(listSep) || '-';
  const interpretation = p.zone==='normal' ? '' : (p.zone==='warn' ? TEXT.warn : TEXT.danger);
  $('detailTitle').textContent=`${p.label}${sep}${p.valueText} ${p.unit}`;
  const lead = interpretation ? `${interpretation} ` : '';
  $('detailText').textContent=`${lead}${TEXT.relatedIn}${sep}${incoming}${stop}${TEXT.relatedOut}${sep}${outgoing}${stop}${TEXT.knob}${sep}${p.control>0?'+':''}${Math.round(p.control)}${stop}`;
  renderParamInfo();
  refreshParameterExplanation(k);
  if(latest) renderConditions(latest);
  if(latest) renderNetwork(latest, forceNetwork);
}
function isParamSelectionTarget(target){
  return !!target.closest('.control-card,.node,.mobile-node-control-popover');
}
function isNonClearingInteractiveTarget(target){
  return !!target.closest('button,a,input,select,textarea,label,.filter,.model-transparency,.modal-card,.modal-layer,.mobile-node-control-popover,.network-resize-handle,.control-panel-resize-handle,.guide-frame');
}
function renderSnapshot(snap){
  const config=modeConfig();
  latest=snap; renderControls(snap); renderNetwork(snap); renderConditions(snap);
  renderStatus(snap);
  applyAutoLens(snap);
  checkCompressionLegibility(snap);
  expireControlCautions();
  if(selectedKey) selectParam(selectedKey, false, false);
  updateZeroInterventionsButton(snap);
  sessionRecorder.capture(snap,simulationStatus());
  trackSessionDiagnostics(snap);
  recordReplayFrame(snap);
  updateReplayConsole();
  updateReportButton();
  if(terminalObserveMode) return;
  trackHomeostasisBalance(snap);
  // An unscored session has no failure state to announce. The engine already guarantees this by
  // never letting health fall, so the guard is belt-and-braces rather than the mechanism.
  if(!snap.noThreat && (snap.dead || snap.health <= 0)) showGameOverModal(snap); else hideGameOverModal();
}
async function startSession(){
  // The mode decides at the door whether this session is scored at all, so the engine never
  // spends a single frame accumulating damage that the chosen mode has promised not to count.
  const data = await api('/api/session/start', {lang, noThreat:modeConfig().noThreat});
  sid=data.sid; meta=data.meta; latest=data.snapshot; modelTransparencyOpen=false; parameterExplanations=Object.create(null); parameterExplanationRequests.clear();
  // The lens ladder is published by the engine, so the compression the learner is shown can
  // never disagree with the compression the solver actually used.
  timeMeta=meta.time;
  // Half speed in the guided mode. The whole point of a lesson is watching which node moves
  // first, and at 1x the baroreflex cascade is over in about fifteen seconds.
  speedIndex=modeConfig().slowDefault
    ? Math.max(0, (timeMeta?.defaultSpeedIndex ?? 3) - 1)
    : (timeMeta?.defaultSpeedIndex ?? 3);
  lensId=timeMeta?.lenses?.[0]?.id || 'seconds';
  renderLegend();
  renderTimeConsole();
  idleLogoutInProgress=false;
  sessionRecorder.reset(meta);
  reportDownloadedForCurrentSession=false;
  learningSimStartedAtPerf=performance.now();
  learningFailureLogged=false;
  learningImbalanceActive=false;
  setTerminalObserveMode(false);
  resetReplayRecording();
  activeLesson=null;
  controlCautions.clear();
  activatedNodes.clear();
  buildScenarioSelect(); buildFilters(); buildControls(); renderSnapshot(latest);
  await applyLearningMode({initial:true});
  if(networkIntroStartRequested) requestNetworkIntroAnimation();
  networkUserNavigated=false;
  scheduleNetworkFitBurst(true);
  sendLearningEvent('session_start', {backendSid:sid, lang}, {snapshot:latest});
  scheduleLearningHeartbeat();
  resetIdleLogoutTimer();
  toast(TEXT.started);
}
async function tickLoop(now){
  // Replay drives `latest` itself while it runs, so the live engine must not be advanced
  // underneath it - that is the whole reason the two speeds can never collide.
  if(sid && !paused && !replayActive && now-lastFetch>TICK_INTERVAL_MS){
    const dt=(now-lastTick)/1000; lastTick=now; lastFetch=now;
    try{
      const frame=await api(`/api/session/${sid}/tick`, {
        dt, speed:currentCompression(), lens:lensId, segment:true, autoBrake:true
      });
      // The response is a frame, not a point: the endpoint snapshot plus everything that
      // happened on the way there. The segment is what reports danger crossings and solver
      // throttling, both of which have to reach the learner as words on screen.
      const snap=frame.snapshot || frame;
      if(frame.segment) handleFrameEvents(frame.segment);
      renderSnapshot(snap);
    }catch(e){ console.error(e); }
  }
  expireTimeNotice();
  if(!replayActive && sessionRecorder.active && latest) sessionRecorder.capture(latest,simulationStatus());
  requestAnimationFrame(tickLoop);
}
function handleFrameEvents(segment){
  // A danger crossing during a fast-forward stops the frame in the engine. Here it also drops
  // the learner back to a scale where the event is legible, and says why. Without this, the
  // one moment worth watching is the one most likely to be skipped over.
  if(segment.braked && isHighSpeed()){
    const critical=(segment.events || []).filter(event => event.critical).pop();
    if(autoLensEnabled) setLens('seconds', {auto:true, reason:critical?.text || ''});
    else showTimeNotice(lang === 'zh'
      ? `快速推进已暂停在关键事件：${critical?.text || ''}`
      : `Fast-forward paused at a critical event: ${critical?.text || ''}`, 'alert');
  }
  if(segment.throttle !== undefined && segment.throttle < 0.8 && isHighSpeed()){
    showTimeNotice(lang === 'zh'
      ? '变化过快，时间压缩已自动降低以保证轨迹准确。'
      : 'Changes are too fast to compress safely; time compression was reduced to keep the trajectory accurate.', 'info');
  }
}
function wireReplayTransport(){
  buildReplaySpeedButtons();
  $('replayPlay')?.addEventListener('click', ()=>{
    if(replayPlaying) stopReplayPlayback(); else startReplayPlayback();
  });
  $('replayToStart')?.addEventListener('click', ()=>seekReplay(0));
  $('replayLive')?.addEventListener('click', ()=>exitReplay());
  const scrub=$('replayScrub');
  if(scrub){
    // Grabbing the scrubber is itself a request to leave the live run, so it engages replay the
    // same way the play button does. Playback stops while the handle is held: a tape that keeps
    // rolling under the finger fights whoever is holding it.
    scrub.addEventListener('pointerdown', ()=>{ replayScrubbing=true; stopReplayPlayback(); });
    ['pointerup','pointercancel'].forEach(type=>scrub.addEventListener(type, ()=>{ replayScrubbing=false; }));
    scrub.addEventListener('input', ()=>{
      const fraction=Number(scrub.value)/REPLAY_SCRUB_STEPS;
      seekReplay(fraction*replayDuration(), {fromScrub:true});
    });
    scrub.addEventListener('change', ()=>{ replayScrubbing=false; updateReplayConsole(); });
  }
  updateReplayConsole();
}
function wireEvents(){
  ['pointerdown','keydown','touchstart','wheel','input','change'].forEach(type=>{
    document.addEventListener(type,resetIdleLogoutTimer,{passive:true});
  });
  wireNetworkZoom();
  wireNetworkLayoutInteractions();
  wireNetworkHeightResize();
  wireControlPanelWidthResize();
  wireRightPanelWidthResize();
  $('replayToggle')?.addEventListener('click', ()=>{
    replayConsoleHidden=!replayConsoleHidden;
    applyReplayConsoleVisibility();
    saveLayoutPreferences();
    sendLearningEvent('replay_console_visibility_toggle', {panel:'replay', hidden:replayConsoleHidden, source:'title_button'});
  });
  wireReplayTransport();
  $('controlToggle')?.addEventListener('click', ()=>{
    controlPanelHidden=!controlPanelHidden;
    markControlPanelSnapping();
    applyControlPanelVisibility();
    saveLayoutPreferences();
    sendLearningEvent('control_panel_visibility_toggle', {panel:'control', hidden:controlPanelHidden, source:'title_button'});
  });
  // Re-evaluate the collapse when crossing the desktop/mobile breakpoint.
  window.addEventListener('resize', ()=>{
    applyReplayConsoleVisibility();
    applyControlPanelVisibility();
  }, {passive:true});
  window.addEventListener('visibilitychange', ()=>{
    const hidden=document.visibilityState==='hidden';
    sendLearningEvent(hidden ? 'page_hidden' : 'page_visible', {visibilityState:document.visibilityState}, {final:hidden});
  });
  window.addEventListener('pagehide', ()=>{
    // Best effort only. A keepalive body is capped at 64 KB and an evidence pack is usually
    // larger, so this catches the small sessions; the report-download, restart and idle-logout
    // paths are the ones that reliably capture the rest.
    logAiPromptForSession('page_end');
    sendLearningEvent('page_end', {reason:'pagehide', visibilityState:document.visibilityState}, {final:true});
  });
  window.addEventListener('homeostasis:recording-change',updateReportButton);
  $('reportBtn')?.addEventListener('click',handlePrimaryReportClick);
  $('pauseBtn').addEventListener('click',togglePause);
  $('resetControls').addEventListener('click',async()=>{
    if(!sid||terminalObserveMode||reportStopped) return;
    const beforeSnapshot=latest;
    const affectedKeys=(beforeSnapshot?.params||[]).filter(parameter=>Math.abs(Number(parameter.control)||0)>.001).map(parameter=>parameter.key);
    latest=await api(`/api/session/${sid}/zero`,{});
    renderSnapshot(latest);
    if(affectedKeys.length){
      markReplayFirstAction();
      sessionRecorder.recordMultiParameterAction({
        keys:affectedKeys,
        beforeSnapshot,
        afterSnapshot:latest,
        source:'button',
        interventionType:'zero interventions',
        status:simulationStatus()
      });
      updateReportButton();
    }
    sendLearningEvent('zero_interventions',{simTime:latest?learningRound(latest.simTime,1):null},{snapshot:latest});
    toast(TEXT.zeroToast);
  });
  $('restart').addEventListener('click', restartSession);
  $('scenario').addEventListener('change',async event=>{
    if(terminalObserveMode||reportStopped){ event.target.value=''; return; }
    if(!sid||!event.target.value) return;
    const scenarioName=event.target.value;
    const scenarioMeta=meta?.scenarios?.[scenarioName]||{};
    const scenarioLabel=scenarioMeta.label||scenarioName;
    const scenarioCategoryId=$('scenarioCategory')?.value||scenarioMeta.category||'';
    const scenarioCategoryLabel=meta?.scenarioCategories?.[scenarioCategoryId]||scenarioCategoryId;
    event.target.value='';
    const applySpecificScenario=async({restartFirst=false}={})=>{
      if(restartFirst){
        await performRestartSession();
        const category=$('scenarioCategory');
        category.value=scenarioCategoryId;
        category.dispatchEvent(new Event('change'));
      }
      $('scenario').value=scenarioName;
      updateScenarioReferenceLink(scenarioName);
      const beforeSnapshot=latest;
      latest=await api(`/api/session/${sid}/scenario`,{name:scenarioName});
      learningUserActionType=learningDiseaseActionType(scenarioCategoryLabel,scenarioLabel);
      markReplayFirstAction();
      sessionRecorder.recordMultiParameterAction({
        keys:scenarioMeta.affectedKeys?.length?scenarioMeta.affectedKeys:(latest.params||[]).map(parameter=>parameter.key),
        beforeSnapshot,
        afterSnapshot:latest,
        source:'preset_event',
        interventionType:scenarioLabel,
        scenarioSelection:{
          majorId:scenarioCategoryId,
          majorLabel:scenarioCategoryLabel,
          minorId:scenarioName,
          minorLabel:scenarioLabel
        },
        status:simulationStatus()
      });
      networkIntro=createNetworkDiseaseIntro();
      renderSnapshot(latest);
      startNetworkIntroAnimation();
      updateReportButton();
      sendLearningEvent('scenario_apply',{name:scenarioName,label:scenarioLabel,category:scenarioCategoryId,simTime:latest?learningRound(latest.simTime,1):null},{snapshot:latest});
      toast(TEXT.scenarioToast);
    };
    if(sessionRecorder.active){
      const restartAndApply=()=>applySpecificScenario({restartFirst:true});
      if(!reportDownloadedForCurrentSession){
        showRestartReportPrompt(restartAndApply);
        return;
      }
      await restartAndApply();
      return;
    }
    await applySpecificScenario();
  });
  $('speed').addEventListener('input',()=>{
    if(terminalObserveMode) return;
    speedIndex=Math.round(Number($('speed').value) || 0);
    renderTimeConsole();
    if(latest) renderStatus(latest);
  });
  $('speed').addEventListener('change',()=>{ if(terminalObserveMode) return; logSpeedChange('change'); });
  $('speedDown')?.addEventListener('click',()=>{ if(!terminalObserveMode) adjustSpeed(-1); });
  $('speedUp')?.addEventListener('click',()=>{ if(!terminalObserveMode) adjustSpeed(1); });
  $('autoLensToggle')?.addEventListener('click',()=>{
    if(terminalObserveMode) return;
    setAutoLens(!autoLensEnabled);
    sendLearningEvent('auto_lens_toggle', {enabled:autoLensEnabled, lens:lensId});
  });
  $('guidedClear')?.addEventListener('click',async()=>{
    if(!sid||terminalObserveMode||reportStopped) return;
    latest=await api(`/api/session/${sid}/zero`,{});
    activeLesson=null;
    controlCautions.clear();
    renderGuidedPanel();
    renderSnapshot(latest);
    toast(TEXT.guidedClearedToast);
    sendLearningEvent('guided_zero',{simTime:latest?learningRound(latest.simTime,1):null},{snapshot:latest});
  });
  $('scenarioMenuBtn')?.addEventListener('click', event=>{
    event.stopPropagation();
    if(terminalObserveMode || reportStopped) return;
    toggleScenarioMenu();
  });
  document.addEventListener('click', event=>{
    if(!$('scenarioMenu') || $('scenarioMenu').hidden) return;
    if(event.target.closest('.scenario-picker')) return;
    openScenarioMenu(false);
  });
  $('modeMenuBtn')?.addEventListener('click', event=>{
    event.stopPropagation();
    openModeMenu($('modeMenu')?.hidden);
  });
  document.addEventListener('click', event=>{
    if(!$('modeMenu') || $('modeMenu').hidden) return;
    if(event.target.closest('.mode-switch-wrap')) return;
    openModeMenu(false);
  });
  $('mobileJumpBtn')?.addEventListener('click',jumpMobileSection);
  window.addEventListener('scroll',()=>{
    requestAnimationFrame(updateMobileJumpButton);
    if(mobileNodeControlKey) scheduleMobileNodeControlPosition();
  }, {passive:true});
  window.addEventListener('resize',()=>{
    requestAnimationFrame(updateMobileJumpButton);
    if(mobileNodeControlKey) scheduleMobileNodeControlPosition();
  }, {passive:true});
  window.visualViewport?.addEventListener('scroll',()=>{ if(mobileNodeControlKey) scheduleMobileNodeControlPosition(); }, {passive:true});
  window.visualViewport?.addEventListener('resize',()=>{ if(mobileNodeControlKey) scheduleMobileNodeControlPosition(); }, {passive:true});
  $('mobileNodeControlClose')?.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); closeMobileNodeControl(); });
  document.addEventListener('pointerdown',e=>{
    const popover=$('mobileNodeControlPopover');
    if(!popover || popover.hidden || popover.contains(e.target) || e.target.closest?.('.node')) return;
    closeMobileNodeControl();
  },true);
  $('startBtn').addEventListener('click',()=>{
    sendLearningEvent('intro_start_click', {lang});
    requestNetworkIntroAnimation();
    $('introModal').classList.remove('show');
    networkUserNavigated=false;
    scheduleNetworkFitBurst(true);
  });
  const desktopGuideLink=$('desktopGuideLink'), desktopGuideModal=$('desktopGuideModal'), desktopGuideClose=$('desktopGuideClose');
  const loadDesktopGuide=()=>{
    const guidePath='assets/homeostasis-guide.pdf';
    const guideFrame=$('desktopGuideFrame'), guideOpenNew=$('desktopGuideOpenNew');
    if(guideFrame && !guideFrame.getAttribute('src')) guideFrame.src=`${guidePath}#toolbar=1&navpanes=0&view=FitH`;
    if(guideOpenNew) guideOpenNew.href=guidePath;
  };
  const closeDesktopGuide=()=>desktopGuideModal?.classList.remove('show');
  desktopGuideLink?.addEventListener('click',e=>{ e.preventDefault(); loadDesktopGuide(); desktopGuideModal?.classList.add('show'); });
  desktopGuideClose?.addEventListener('click',closeDesktopGuide);
  desktopGuideModal?.addEventListener('click',e=>{ if(e.target===desktopGuideModal) closeDesktopGuide(); });
  const mobileHelpLink=$('mobileHelpLink'), mobileHelpModal=$('mobileHelpModal'), mobileHelpClose=$('mobileHelpClose');
  const closeMobileHelp=()=>mobileHelpModal?.classList.remove('show');
  mobileHelpLink?.addEventListener('click',e=>{ e.preventDefault(); mobileHelpModal?.classList.add('show'); });
  mobileHelpClose?.addEventListener('click',closeMobileHelp);
  mobileHelpModal?.addEventListener('click',e=>{ if(e.target===mobileHelpModal) closeMobileHelp(); });
  document.addEventListener('click',e=>{
    if(!selectedKey) return;
    const target=e.target;
    if(isParamSelectionTarget(target) || isNonClearingInteractiveTarget(target)) return;
    clearParamSelection();
  });
  $('customParamsClose')?.addEventListener('click',closeCustomParamsModal);
  $('customCancel')?.addEventListener('click',closeCustomParamsModal);
  $('customConfirm')?.addEventListener('click',confirmCustomParams);
  $('customSelectAll')?.addEventListener('click',()=>setCustomCheckboxes(true));
  $('customClearAll')?.addEventListener('click',()=>setCustomCheckboxes(false));
  $('customParamsModal')?.addEventListener('click',e=>{ if(e.target===$('customParamsModal')) closeCustomParamsModal(); });
  document.addEventListener('keydown',e=>{
    if((e.code==='Space' || e.key===' ') && window.matchMedia('(min-width: 861px)').matches){
      const target=e.target;
      const isTyping=target && (target.closest?.('input,textarea,select,button,a,[contenteditable="true"]'));
      const modalOpen=!!document.querySelector('.modal-layer.show');
      if(!e.repeat && !isTyping && !modalOpen && !terminalObserveMode){
        e.preventDefault();
        togglePause();
      }
      return;
    }
    if(e.key!=='Escape') return;
    openScenarioMenu(false);
    openModeMenu(false);
    closeDesktopGuide();
    closeMobileHelp();
    closeCustomParamsModal();
    closeMobileNodeControl();
  });
  $('gameOverDownload')?.addEventListener('click',()=>generateSessionReport({stop:true}));
  // Replaying from the failure card leaves the card behind but keeps the session: the engine is
  // already stopped at zero stability, so there is nothing for the tape to collide with, and
  // "continue observing" and "restart" are both still reachable from the console afterwards.
  $('gameOverReplay')?.addEventListener('click', ()=>{
    hideGameOverModal();
    startReplayPlayback();
  });
  $('gameOverObserve')?.addEventListener('click', continueGameOverObservation);
  $('gameOverRestart')?.addEventListener('click',restartSession);
  $('restartDownload')?.addEventListener('click',async()=>{
    const action=pendingRestartAction||performRestartSession;
    const downloaded=await generateSessionReport({stop:false});
    if(downloaded){
      hideRestartReportPrompt();
      await action();
    }
  });
  $('restartWithoutDownload')?.addEventListener('click',async()=>{
    const action=pendingRestartAction||performRestartSession;
    hideRestartReportPrompt();
    await action();
  });
  $('restartReportClose')?.addEventListener('click',()=>hideRestartReportPrompt({restoreSession:true}));
  $('wechatReportCopy')?.addEventListener('click',copyWeChatReportLink);
  $('wechatReportClose')?.addEventListener('click',hideWeChatReportModal);
  $('aiReportWithAi')?.addEventListener('click',beginAiReportChoice);
  $('aiReportWithoutAi')?.addEventListener('click',()=>settleAiReportChoice('direct'));
  $('aiReportCancel')?.addEventListener('click',()=>settleAiReportChoice('cancel'));
  $('aiQuotaConfirm')?.addEventListener('click',confirmAiReportChoice);
  $('aiQuotaDirect')?.addEventListener('click',()=>settleAiReportChoice('direct'));
  $('aiQuotaBack')?.addEventListener('click',()=>setAiReportModalView('select'));
  $('aiQuotaHiddenLink')?.addEventListener('click',registerAiQuotaHiddenClick);
  $('aiQuotaExemptClose')?.addEventListener('click',()=>{
    clearTimeout(aiExemptionNoticeTimer);
    $('aiQuotaExemptNotice')?.classList.remove('show');
  });
}
async function init(){
  // First, before wireEvents() can arm anything that logs.
  await loadTelemetryConfig();
  loadLayoutPreferences();
  if(Number.isFinite(savedNetworkPanelHeight)){
    document.querySelector('.center-panel')?.style.setProperty('--network-panel-height', `${Math.round(savedNetworkPanelHeight)}px`);
  }
  applyStaticText(); wireEvents(); applyReplayConsoleVisibility(); applyControlPanelVisibility();
  try{ await startSession(); }catch(e){ console.error(e); const msg=lang==='zh'?'无法连接后端。请先启动 backend/server.js。':'Cannot connect to backend. Please start backend/server.js first.'; if($('detailText')) $('detailText').textContent=msg; toast(msg); }
  updateMobileJumpButton();
  requestAnimationFrame(tickLoop);
}
init();
