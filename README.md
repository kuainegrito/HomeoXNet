<p align="center">
  <img src="frontend/assets/homeoxnet-logo.png" alt="HomeoXNet" width="360" />
</p>

<p align="center">
  <strong>A HOMEOstasis compleX NETwork simulator for medical and physiology education</strong><br>
  一个面向医学与生理学教学的稳态（HOMEOstasis）复杂（compleX）网络（NETwork）模拟器
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node >= 18">
</p>

---

## English

### What it is

HomeoXNet models the human body as a network of **coupled feedback loops** rather than a set of
independent parameters. Cardiovascular, neuro-humoral, renal–fluid, respiratory–acid-base and
metabolic–hematologic subsystems are wired together, so changing one input propagates through the
network the way it does in a patient: an immediate response, a compensatory adjustment, and — if the
compensation is exhausted — decompensation.

Learners work from an **intervention console** (blood pressure, heart rate, blood volume, RAAS,
ventilation, glucose, electrolytes and more) and watch three linked views:

- **Homeostasis network** — nodes move, pulse, change colour and grey out to express physiological state.
- **Vital monitor** — continuous traces of the derived vitals.
- **Clinical assessment** — syndrome detection, staging, and per-parameter clinical meaning.

The authoritative model lives in the backend (`backend/simEngine.js`); the browser handles
interaction, layout and rendering.

### Features

- Coupled multi-system physiology engine with acute, chronic and decompensated regimes
- Disease scenarios (shock, DKA, respiratory failure, acid–base and electrolyte disorders, …)
- Vicious-cycle detection across subsystems
- Session recording and an exportable session report
- Bilingual UI (简体中文 / English), selectable via `?lang=zh` or `?lang=en`
- Desktop-first deep interaction, with a separate mobile observation layout
- Optional AI-assisted case analysis (bring your own OpenAI-compatible endpoint and key)
- Optional classroom analytics, **off by default** — a plain clone records nothing
- Regression suites for scenarios, temporal behaviour, layout and reports

### Quick start

```bash
git clone https://github.com/kuainegrito/HomeoXNet.git
```

```bash
cd HomeoXNet/backend && npm install && npm start
```

Then open <http://127.0.0.1:3002/>. The backend serves the static frontend from `../frontend`, so no
separate web server is needed for local use.

Nothing needs configuring for this to work. Every environment variable is optional; with none set,
the simulator runs in full and only the AI report is unavailable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3002` | HTTP port |
| `FRONTEND_PATH` | `../frontend` | Where to serve static files from |
| `CORS_ORIGIN` | `*` | Allowed origin |

The server binds to `127.0.0.1`. To expose it publicly, put it behind a reverse proxy you control.

`backend/.env.example` documents every variable in one place. Copy it somewhere outside the
repository, edit it, and source it before starting:

```bash
cp backend/.env.example /etc/homeoxnet.env
```

```bash
set -a; . /etc/homeoxnet.env; set +a; cd backend && npm start
```

### Privacy: analytics are off by default

A plain clone of this repository **records nothing**. No visitor id, no IP address, no click stream,
no file written — the browser does not even make the request. This is deliberate: whoever runs a copy
has made no promise to their own users, and cannot make one on the author's behalf.

If you are teaching with it and want the learner analytics, set:

```bash
export HOMEOSTASIS_LEARNING_LOG_ENABLED=1
```

Then the server appends one JSONL row per learner action to `HOMEOSTASIS_LEARNING_LOG_PATH`
(default `backend/logs/homeostasis-learning-events.jsonl`), and logs the full AI evidence pack once
per session. **Those rows contain the visitor's IP address and a persistent browser id**, so they are
personal data: turn this on only where you have told your users, and check the rules that apply to
you. The browser asks `GET /api/client-config` once at startup and stays silent unless the answer is
yes; with the flag off, `POST /api/learning-event` and `POST /api/ai-prompt-log` accept and discard.

`GET /api/health` reports the current state as `learningLogEnabled`.

### Optional: AI case analysis

The simulator can send a finished session to a language model and get back a structured case
analysis. It is **disabled until you supply a key** — there is no default credential and no shared
service. Any OpenAI-compatible `/v1/chat/completions` endpoint works.

```bash
export HOMEOSTASIS_AI_API_KEY=sk-your-own-key
```

```bash
export HOMEOSTASIS_AI_ENDPOINT=https://api.openai.com/v1/chat/completions HOMEOSTASIS_AI_MODEL=gpt-4o
```

Verify it was picked up — `medicalAiConfigured` should be `true`:

```bash
curl -s http://127.0.0.1:3002/api/health
```

**Provider modules.** Two clients ship with the repo. Leave `HOMEOSTASIS_AI_PROVIDER` unset for
`medicalAi.js` (OpenAI-compatible; defaults to Tencent TokenHub), or set it to `kimi` for
`medicalAiKimi.js` (Moonshot). The choice only changes request shaping and defaults — the prompt and
the evidence pack are identical.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOMEOSTASIS_AI_API_KEY` | *(none)* | **Required to enable the AI report.** No key, no feature. |
| `HOMEOSTASIS_AI_PROVIDER` | *(unset)* | `kimi` selects `medicalAiKimi.js`; otherwise `medicalAi.js` |
| `HOMEOSTASIS_AI_ENDPOINT` | `https://tokenhub.tencentmaas.com/v1/chat/completions`<br>(`kimi`: `https://api.kimi.com/coding/v1/chat/completions`) | OpenAI-compatible chat-completions URL |
| `HOMEOSTASIS_AI_MODEL` | `deepseek-v4-pro` (`kimi`: `k3`) | Model id |
| `HOMEOSTASIS_AI_THINKING` | `enabled` | `disabled` turns off extended reasoning where supported |
| `HOMEOSTASIS_AI_TIMEOUT_MS` | `110000` (`kimi`: `300000`) | Request timeout. A full report is slow; don't cut this short. |
| `HOMEOSTASIS_AI_MAX_TOKENS` | `9000` | Output budget. Reasoning tokens compete with the report body — below ~7000 the last sections get truncated. |

**Cost control.** These are what stand between a public deployment and your API bill:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOMEOSTASIS_AI_DAILY_LIMIT` | `3` | Reports per visitor per day, reset at midnight `Asia/Shanghai` |
| `HOMEOSTASIS_AI_RATE_LIMIT_MAX` | `6` | Requests per IP per 30 minutes |
| `HOMEOSTASIS_AI_QUOTA_PATH` | `backend/logs/homeostasis-ai-quota.json` | Where the daily counter persists. Point it somewhere durable, or quotas reset on every redeploy. |
| `HOMEOSTASIS_AI_QUOTA_SALT` | `homeostasis-ai-quota-v1` | Visitor IPs are stored only as HMACs of this salt. Set a long random value in production; changing it resets everyone's quota. |
| `HOMEOSTASIS_AI_ELIGIBILITY` | `on` | `off` disables the session-quality gate below |
| `HOMEOSTASIS_AI_MIN_ACTIONS` | `3` | Distinct learner actions required. A loaded scenario is one action, however many parameters it moved. |
| `HOMEOSTASIS_AI_MIN_WATCHED_SECONDS` | `90` | Real seconds of observation required, summed across the time lenses |
| `HOMEOSTASIS_AI_MIN_QUIET_GAP_SECONDS` | `20` | Real seconds the learner must leave the system alone at least once |

**The session-quality gate.** A session with nothing in it produces a report with nothing in it,
so `backend/aiEligibility.js` refuses one before the model is called and before the daily quota is
touched — the request costs no tokens and no allowance. The three measures are all in REAL seconds,
never simulated ones: the time lens compresses simulated time by up to ~11500x, so a "three-day"
session can be eight seconds of watching. A missing diagnostic counts as unknown and can never
block, and the thresholds travel to the browser at session start, so the page tells the learner
what their session still needs instead of failing them after a two-minute wait.

The quota is keyed on a salted hash of the IP, not the raw address — the counter file holds no
plaintext addresses even when analytics are off.

**Never commit an API key.** `.gitignore` excludes `.env*`; only `.env.example`, which holds
placeholders, is tracked.

### Rate limits

Defaults are sized for real users and will throttle scripted runs — a headless tick loop trips them
within a minute. `HOMEOSTASIS_START_RATE_LIMIT_MAX`, `HOMEOSTASIS_TICK_RATE_LIMIT_MAX`,
`HOMEOSTASIS_ACTION_RATE_LIMIT_MAX`, `HOMEOSTASIS_INVALID_SESSION_RATE_LIMIT_MAX`,
`HOMEOSTASIS_REPORT_RATE_LIMIT_MAX` and `HOMEOSTASIS_SESSION_RATE_LIMIT_WINDOW_MS` are listed with
their defaults in `backend/.env.example`. Raise them for automated testing; leave them alone in
production.

### Tests

```bash
cd backend && npm test
```

Individual suites: `npm run test:scenarios`, `test:temporal`, `test:learning-modes`,
`test:model-transparency`, `test:layout`, `test:reports`, `test:rate-limits`, `test:medical-ai`.

### Project structure

```text
HomeoXNet/
├─ backend/
│  ├─ server.js            # HTTP API, sessions, reports, rate limiting
│  ├─ simEngine.js         # the physiological model, network metadata, clinical assessment
│  ├─ temporalModel.js     # acute → chronic time-course behaviour
│  ├─ compensation.js      # compensatory / decompensation logic
│  ├─ modelSchema.js       # parameter definitions and transparency metadata
│  ├─ medicalAi*.js        # optional AI report providers
│  ├─ aiQuota.js           # per-user AI report quota
│  ├─ .env.example         # every configuration variable, documented
│  └─ *Regression.js       # regression suites
├─ frontend/
│  ├─ index.html           # entry page
│  ├─ simulator.html       # simulator
│  ├─ app.js               # rendering, interaction, animation, layout, preferences
│  ├─ topology-layout.js   # network layout
│  ├─ session-report.js    # session report generation
│  ├─ style.css / layout-fixes.css
│  └─ assets/
├─ DEVELOPMENT_LOG.md      # detailed development history (Chinese)
├─ LICENSE                 # MIT
└─ README.md
```

### Disclaimer

HomeoXNet is a **teaching and reasoning tool**. It is a simplified model, not a validated clinical
system, and must not be used for diagnosis, treatment decisions, or any other clinical purpose.

### Author

**Yu Kuai (于快)**, Guizhou Medical University — <yukuai@gmc.edu.cn> · <https://www.kuaiyu.site/>

### License

MIT — see [LICENSE](LICENSE).

---

## 中文

### 这是什么

HomeoXNet 把人体建模为一张**相互耦合的反馈回路网络**，而不是一组彼此独立的参数。心血管、神经—体液、
肾脏—体液、呼吸—酸碱、代谢—血液等子系统连成一体，因此改变任一输入都会像在真实病人身上那样沿网络传播：
先是即时反应，接着是代偿调节，代偿耗竭后则出现失代偿。

使用者在**干预控制台**上调节参数（血压、心率、血容量、RAAS、通气、血糖、电解质等），并通过三个联动视图观察结果：

- **复杂稳态网络**——用节点运动、脉冲、颜色、稳定度与灰化表达生理状态。
- **生命监测**——连续显示各项生命体征曲线。
- **临床病情评估**——综合征判断、分期，以及逐参数的临床意义解释。

权威模型运行在后端（`backend/simEngine.js`），前端负责交互、布局与渲染。

### 功能

- 多系统耦合的生理引擎，区分急性、慢性与失代偿状态
- 疾病场景（休克、糖尿病酮症酸中毒、呼吸衰竭、酸碱与电解质紊乱等）
- 跨系统恶性循环识别
- 会话记录与可导出的学习报告
- 中英双语界面，可用 `?lang=zh` / `?lang=en` 切换
- 桌面端强调深度操作，手机端提供独立的快速观察布局
- 可选的 AI 病例分析（需自备 OpenAI 兼容的接口与密钥）
- 可选的学习行为记录，**默认关闭**——直接克隆运行不记录任何数据
- 场景、时间行为、布局与报告的回归测试

### 快速开始

```bash
git clone https://github.com/kuainegrito/HomeoXNet.git
```

```bash
cd HomeoXNet/backend && npm install && npm start
```

然后访问 <http://127.0.0.1:3002/>。后端会直接托管 `../frontend` 的静态文件，本地运行无需额外的 Web 服务器。

无需任何配置即可运行：所有环境变量都是可选的，全部不设时模拟器功能完整，只有 AI 报告不可用。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `3002` | HTTP 端口 |
| `FRONTEND_PATH` | `../frontend` | 静态文件目录 |
| `CORS_ORIGIN` | `*` | 允许的来源 |

服务器只监听 `127.0.0.1`。若要对外提供访问，请自行放在受控的反向代理之后。

`backend/.env.example` 集中说明了全部变量。复制到仓库之外，修改后在启动前 source：

```bash
cp backend/.env.example /etc/homeoxnet.env
```

```bash
set -a; . /etc/homeoxnet.env; set +a; cd backend && npm start
```

### 隐私：学习行为记录默认关闭

直接克隆运行时，本项目**不记录任何数据**：没有访客 ID、没有 IP、没有操作流水，也不会写任何文件——
浏览器根本不会发出记录请求。这是刻意的：部署副本的人并未向自己的用户作出任何承诺，也无权代作者作出承诺。

若用于教学并希望获得学习行为数据，设置：

```bash
export HOMEOSTASIS_LEARNING_LOG_ENABLED=1
```

开启后，后端会把每个学习动作按行追加到 `HOMEOSTASIS_LEARNING_LOG_PATH`
（默认 `backend/logs/homeostasis-learning-events.jsonl`），并在每个会话记录一次完整的 AI 证据包。
**这些记录包含访客 IP 与持久化的浏览器 ID**，属于个人数据：请仅在已告知用户的场合开启，并自行确认适用的法规。
前端在启动时请求一次 `GET /api/client-config`，答案为否时全程静默；关闭状态下
`POST /api/learning-event` 与 `POST /api/ai-prompt-log` 接收后直接丢弃。

`GET /api/health` 的 `learningLogEnabled` 字段反映当前状态。

### 可选：AI 病例分析

模拟器可以把一次完成的会话交给大模型，返回结构化的病例分析。**未提供密钥前该功能关闭**——
仓库内没有任何默认凭据，也没有公共服务。任何 OpenAI 兼容的 `/v1/chat/completions` 接口均可接入。

```bash
export HOMEOSTASIS_AI_API_KEY=sk-your-own-key
```

```bash
export HOMEOSTASIS_AI_ENDPOINT=https://api.openai.com/v1/chat/completions HOMEOSTASIS_AI_MODEL=gpt-4o
```

确认密钥已生效（`medicalAiConfigured` 应为 `true`）：

```bash
curl -s http://127.0.0.1:3002/api/health
```

**Provider 模块。** 仓库内置两个客户端：不设 `HOMEOSTASIS_AI_PROVIDER` 时使用 `medicalAi.js`
（OpenAI 兼容，默认指向腾讯云 TokenHub）；设为 `kimi` 时使用 `medicalAiKimi.js`（Moonshot）。
二者只在请求构造与默认值上不同，提示词与证据包完全一致。

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `HOMEOSTASIS_AI_API_KEY` | *(无)* | **启用 AI 报告的必需项**，不设即不启用 |
| `HOMEOSTASIS_AI_PROVIDER` | *(未设)* | `kimi` 选用 `medicalAiKimi.js`，否则 `medicalAi.js` |
| `HOMEOSTASIS_AI_ENDPOINT` | `https://tokenhub.tencentmaas.com/v1/chat/completions`<br>（`kimi`：`https://api.kimi.com/coding/v1/chat/completions`） | OpenAI 兼容的对话补全地址 |
| `HOMEOSTASIS_AI_MODEL` | `deepseek-v4-pro`（`kimi`：`k3`） | 模型 ID |
| `HOMEOSTASIS_AI_THINKING` | `enabled` | 设为 `disabled` 可关闭思考模式（provider 支持时） |
| `HOMEOSTASIS_AI_TIMEOUT_MS` | `110000`（`kimi`：`300000`） | 请求超时。完整报告耗时较长，不要调得过小 |
| `HOMEOSTASIS_AI_MAX_TOKENS` | `9000` | 输出预算。思考 token 与正文竞争同一预算，低于约 7000 时末尾章节会被截断 |

**成本控制。** 以下几项是公网部署与账单之间唯一的屏障：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `HOMEOSTASIS_AI_DAILY_LIMIT` | `3` | 每位访客每日报告数，按 `Asia/Shanghai` 零点重置 |
| `HOMEOSTASIS_AI_RATE_LIMIT_MAX` | `6` | 每 IP 每 30 分钟请求数 |
| `HOMEOSTASIS_AI_QUOTA_PATH` | `backend/logs/homeostasis-ai-quota.json` | 每日计数的持久化位置。请指向稳定路径，否则每次重新部署配额都会清零 |
| `HOMEOSTASIS_AI_QUOTA_SALT` | `homeostasis-ai-quota-v1` | 访客 IP 只以该盐的 HMAC 形式存储。生产环境请设为足够长的随机值；更换会重置所有人的配额 |
| `HOMEOSTASIS_AI_ELIGIBILITY` | `on` | 设为 `off` 关闭下面的会话质量门槛 |
| `HOMEOSTASIS_AI_MIN_ACTIONS` | `3` | 所需的独立操作次数。加载一个疾病场景算一次，无论它改了多少个参数 |
| `HOMEOSTASIS_AI_MIN_WATCHED_SECONDS` | `90` | 所需的真实观察秒数，跨各时间镜头求和 |
| `HOMEOSTASIS_AI_MIN_QUIET_GAP_SECONDS` | `20` | 全程至少要有一段不操作的真实秒数 |

**会话质量门槛。** 空会话只能生成空报告，因此 `backend/aiEligibility.js` 会在调用模型之前、
也在扣减每日配额之前直接拒绝——这样的请求既不花 token，也不消耗次数。三项指标一律以**真实秒**
计量，而非模拟秒：时间镜头最高可把模拟时间压缩约 11500 倍，一次"三天"的会话可能只看了八秒。
缺失的诊断字段一律按"未知"处理、永远不会拦人；阈值随会话下发到浏览器，页面会直接告诉学习者
还差什么，而不是让人等两分钟才被拒绝。

配额以 IP 的加盐哈希为键，而非原始地址——即使在关闭学习记录的情况下，计数文件里也不含明文 IP。

**切勿把 API 密钥提交进仓库。** `.gitignore` 已排除 `.env*`，只有含占位符的 `.env.example` 入库。

### 速率限制

默认值按真实用户设定，会限制脚本化运行——无头 tick 循环一分钟内即会触发。
`HOMEOSTASIS_START_RATE_LIMIT_MAX`、`HOMEOSTASIS_TICK_RATE_LIMIT_MAX`、
`HOMEOSTASIS_ACTION_RATE_LIMIT_MAX`、`HOMEOSTASIS_INVALID_SESSION_RATE_LIMIT_MAX`、
`HOMEOSTASIS_REPORT_RATE_LIMIT_MAX` 与 `HOMEOSTASIS_SESSION_RATE_LIMIT_WINDOW_MS`
的默认值见 `backend/.env.example`。自动化测试时可调高，生产环境请保持默认。

### 测试

```bash
cd backend && npm test
```

### 免责声明

HomeoXNet 是**教学与病理生理思维训练工具**，采用简化模型，未经临床验证，不得用于诊断、治疗决策或任何其他临床用途。

### 作者

**于快**，贵州医科大学 —— <yukuai@gmc.edu.cn> · <https://www.kuaiyu.site/>

### 许可证

MIT，详见 [LICENSE](LICENSE)。
