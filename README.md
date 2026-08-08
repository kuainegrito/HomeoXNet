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

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3002` | HTTP port |
| `FRONTEND_PATH` | `../frontend` | Where to serve static files from |
| `CORS_ORIGIN` | `*` | Allowed origin |
| `HOMEOSTASIS_LEARNING_LOG_PATH` | `/var/log/...` | Learning-event log; falls back to `backend/logs/` |

The server binds to `127.0.0.1`. To expose it publicly, put it behind a reverse proxy you control.

### Optional: AI case analysis

The AI report is off unless you configure a provider. Copy `backend/.env.ai.example`, fill in your own
credentials, and export them before starting the server. Two provider modules are included — a
Tencent TokenHub / OpenAI-compatible client (`medicalAi.js`, default) and a Moonshot Kimi client
(`medicalAiKimi.js`, enable with `HOMEOSTASIS_AI_PROVIDER=kimi`). Any OpenAI-compatible
`/v1/chat/completions` endpoint should work by setting `HOMEOSTASIS_AI_ENDPOINT` and
`HOMEOSTASIS_AI_MODEL`.

Check `GET /api/health` — `medicalAiConfigured` tells you whether the key was picked up.

**Never commit an API key.** `.gitignore` excludes `.env` files; the example file contains
placeholders only.

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
- 场景、时间行为、布局与报告的回归测试

### 快速开始

```bash
git clone https://github.com/kuainegrito/HomeoXNet.git
```

```bash
cd HomeoXNet/backend && npm install && npm start
```

然后访问 <http://127.0.0.1:3002/>。后端会直接托管 `../frontend` 的静态文件，本地运行无需额外的 Web 服务器。

服务器只监听 `127.0.0.1`。若要对外提供访问，请自行放在受控的反向代理之后。

### 可选：AI 病例分析

未配置模型时 AI 报告默认关闭。复制 `backend/.env.ai.example`，填入自己的凭据，并在启动服务前导出这些环境变量。
仓库内置两个 provider：腾讯云 TokenHub / OpenAI 兼容客户端（`medicalAi.js`，默认）和 Moonshot Kimi 客户端
（`medicalAiKimi.js`，用 `HOMEOSTASIS_AI_PROVIDER=kimi` 启用）。任何 OpenAI 兼容的
`/v1/chat/completions` 接口都可以通过 `HOMEOSTASIS_AI_ENDPOINT` 与 `HOMEOSTASIS_AI_MODEL` 接入。

访问 `GET /api/health`，`medicalAiConfigured` 字段可确认密钥是否已生效。

**切勿把 API 密钥提交进仓库。** `.gitignore` 已排除 `.env` 文件，示例文件中只有占位符。

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
