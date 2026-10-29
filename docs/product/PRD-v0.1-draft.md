# xDownload PRD v0.1

**Product name:** xDownload  
**Product type:** AI-native Download Tool powered by Download Domain Harness  
**Document status:** PRD Draft  
**Product Freeze:** NO  
**Architecture Freeze:** NO  
**Date:** 2026-10-01

---

# 1. Product Definition

xDownload 是一个以桌面 UI 为主要交互入口、同时提供 CLI 的下载工具。

它的首要目标不是展示 AI、Recipe 或 Harness 能力，而是：

> **让用户更方便、更流畅、更可靠地完成下载任务。**

xDownload 内部采用 **Download Domain Harness** 作为核心实现范式：

- 下载引擎、Browser Observer、媒体工具、文件系统等属于 **Tools**；
- 协议、播放器、Provider、Site Pattern、Failure Pattern、Recipe 属于 **Knowledge**；
- Harness 根据 Intent、State、Knowledge、Constraints 与 Validation 决定如何完成下载；
- 当已有确定性方法无法完成任务时，允许 LLM 处理 Knowledge Gap；
- AI 产生的结果只有经过确定性验证后，才能进入可复用 Knowledge；
- Recipe 本地复用和跨用户共享是增强能力，不是基础下载产品成立的前提。

---

# 2. Product Principle

产品优先级：

```text
正确完成下载
    >
可靠和可恢复
    >
低操作成本
    >
快速反馈
    >
AI 自动发现
    >
Knowledge 复用
    >
跨用户 Recipe 网络
```

不得为了证明 Harness、AI 或 Recipe 能力而牺牲基础下载体验。

---

# 3. Target Jobs

## 3.1 普通下载

用户希望：

> “把这个文件保存下来。”

产品需要处理：

- HTTP/HTTPS 文件；
- 浏览器点击下载；
- 粘贴 URL；
- 目标目录；
- 文件重名；
- 网络中断；
- 应用重启；
- retry；
- 可支持条件下的 resume；
- 完成后定位文件。

这是基础产品能力，不依赖 AI。

## 3.2 浏览器资源下载

用户希望：

> “把我当前页面里的这个资源保存下来。”

例如：

- 文件；
- 视频；
- 音频；
- PDF；
- 页面附件。

xDownload 应尽可能自动发现用户当前正在操作的资源，而不是要求用户理解：

- manifest；
- m3u8；
- DASH；
- segment；
- request headers；
- DevTools。

## 3.3 多候选资源选择

例如当前页面同时存在：

- 主视频；
- 广告；
- preview；
- 不同清晰度；
- 不同音轨；
- 多个附件。

系统需要：

1. 识别并分组候选资源；
2. 提供可理解的信息；
3. 自动选择只有在置信度足够时进行；
4. 无法确认目标时必须暴露不确定性；
5. 不得下载错误资源后宣告成功。

## 3.4 已知规则失效

用户希望：

> “昨天还能下载，今天网站改了以后也尽量能继续。”

正常顺序：

```text
Known Recipe
    ↓
Deterministic execution
    ↓
FAIL
    ↓
Re-observe
    ↓
Knowledge Gap
    ↓
AI-assisted discovery
    ↓
Validation
```

AI 是 fallback，而不是所有任务默认路径。

## 3.5 自动化与批处理

CLI 用户希望：

> “可靠地把下载任务放入脚本、批处理和 Agent 工作流。”

CLI 必须具有稳定：

- task id；
- status；
- exit semantics；
- structured output；
- timeout；
- retry；
- cancel；
- non-interactive behavior。

---

# 4. Product Surfaces

## 4.1 Desktop UI

UI 是普通用户的主要入口。

核心任务：

- 创建下载；
- 查看下载；
- 暂停/恢复（支持时）；
- 取消；
- retry；
- 查看失败原因；
- 浏览候选资源；
- 选择保存位置；
- 查看完成文件；
- 管理浏览器连接；
- 查看 AI discovery 状态；
- 控制隐私和模型设置。

## 4.2 Browser Integration

Browser Integration 负责：

- 接管普通下载；
- 观察当前页面资源；
- 把候选 Resource 发送给本地 xDownload；
- 提供当前 page/profile/session context；
- 在需要时触发资源发现。

Browser Integration 不负责：

- 任意执行网页指令；
- 向 Registry 上传 credential；
- 把所有网络请求无过滤发送给模型。

## 4.3 CLI

CLI 是 first-class automation surface，不是 UI 的调试工具。

必须支持概念能力：

```text
add
status
list
cancel
retry
pause
resume
```

其中 pause/resume 仅对支持的协议和资源提供。

具体命令语法在接口设计阶段冻结。

## 4.4 Future Surfaces

非 v0 必需：

- REST/API；
- MCP；
- Agent tool；
- SDK；
- remote worker。

这些不得影响 v0 UI/CLI 基础质量。

---

# 5. Shared Download Model

所有入口原则上共享统一下载领域模型。

核心对象：

```text
DownloadIntent
Resource
DownloadTask
ExecutionContext
DownloadPlan
DownloadResult
ValidationResult
Failure
Evidence
```

---

# 6. DownloadIntent

DownloadIntent 表达用户想完成什么，而不是具体怎样执行。

示例：

```yaml
target: current_page

resource:
  type: video

selection:
  quality: best

output:
  directory: Downloads
```

复杂 Intent 可包含：

- resource type；
- preferred quality；
- filename preference；
- output location；
- batch selection；
- post-processing preference。

---

# 7. Resource Model

URL 不等同于 Resource。

首批 Resource：

```text
FileResource
MediaResource
DocumentResource
CollectionResource
```

MediaResource 首批支持：

```text
Direct HTTP media
HLS
DASH
```

Composite/Collection 允许表示：

```text
Page
├── Video
├── PDF
└── Attachment
```

但 v0 不承诺所有嵌套网页和复杂课程结构均能完整解析。

---

# 8. Download Task

每个下载必须拥有稳定 Task ID。

最低状态：

```text
CREATED
RESOLVING
READY
DOWNLOADING
PAUSED
VALIDATING
COMPLETED
FAILED
CANCELLED
NEEDS_USER_ACTION
```

AI discovery 可扩展内部状态，但不得破坏产品级状态语义。

---

# 9. Cross-surface Consistency

若 UI、CLI 和浏览器使用同一本地 Runtime：

- CLI 创建的任务应可在 UI 查看；
- UI 对共享任务进行取消后，CLI 查询应看到一致状态；
- Browser 创建任务后返回相同 Task ID；
- 应用重启后 Task ID 与状态应保持可追踪。

重复资源提交必须有明确策略：

```text
ALLOW
MERGE
ASK
REJECT
```

v0 默认行为在 UX 研究后冻结。

不得静默覆盖已有文件。

---

# 10. Basic Download Requirements

## P0

必须支持：

- HTTP/HTTPS；
- redirect；
- Content-Disposition；
- filename detection；
- destination selection；
- retry；
- cancellation；
- partial failure handling；
- application restart recovery；
- disk-space errors；
- target-not-writable；
- duplicate filename handling；
- proxy 基础支持；
- cookie/header propagation，仅限允许范围。

---

# 11. Resume Requirements

断点续传不是无条件承诺。

只有当资源满足可验证的 resume 条件时才恢复。

至少需要考虑：

- Range support；
- ETag；
- Last-Modified；
- Content-Length；
- signed URL change；
- resource identity。

如果资源已经变化：

> 不允许把旧资源的数据片段与新资源静默拼接。

应：

```text
resume safely
```

或者：

```text
restart
```

或者：

```text
ask user
```

---

# 12. Browser Observer

Browser Observer 是 Harness Tool。

职责：

```text
observe_page()
observe_network()
observe_player()
observe_frames()
collect_candidate_resources()
```

输出结构化 Observation。

不得默认把完整浏览器原始数据交给 LLM。

推荐过程：

```text
Raw browser events
        ↓
Deterministic filter
        ↓
Candidate extraction
        ↓
Relevant observation
        ↓
Harness / LLM
```

---

# 13. Knowledge

Download Knowledge 包含：

```text
Protocol Knowledge
Player Knowledge
Provider Knowledge
Site Knowledge
Failure Knowledge
Recipe
```

例如：

```text
Protocol
├── HTTP Range
├── HLS
└── DASH

Player
├── Video.js
├── Shaka
├── hls.js
└── JWPlayer
```

Knowledge 不应全部退化为：

> 一网站一个脚本。

优先组合已有 Patterns。

---

# 14. Recipe

Recipe 是经过验证的 reusable knowledge。

不是：

- 用户 session；
- Cookie；
- JWT；
- signed URL；
- 下载任务实例。

Recipe 应优先使用声明式形式。

允许表达：

- match；
- observation；
- resource detection；
- resource mapping；
- required context；
- selection；
- validation。

v0 Recipe 不允许任意 shell execution。

---

# 15. Private Execution Context

以下数据属于用户本地 ExecutionContext：

```text
Cookie
Session
JWT
signed URL
CSRF
account-specific value
private page data
```

不得进入公共 Recipe。

Recipe 只能声明：

```text
cookie_required = true
```

而不是存储 Cookie 本身。

---

# 16. Download Domain Harness

核心模型：

```text
Intent
  ↓
State
  ↓
Knowledge
  ↓
Decision
  ↓
Tools
  ↓
Validation
  ↓
Evidence
```

Harness 负责：

- workflow；
- tool selection；
- knowledge lookup；
- failure classification；
- recovery；
- validation orchestration；
- AI escalation；
- evidence capture。

---

# 17. Tools

v0 Tools 至少包含：

```text
Browser Observer
HTTP Downloader
HLS Downloader
DASH Downloader
Media Processor
Media Validator
FileSystem
```

Tool contract 必须与具体实现解耦。

例如 HLS Tool 未来可以：

```text
native
→ ffmpeg
→ another implementation
```

而不改变上层 Domain Workflow。

---

# 18. AI Role

LLM 的职责不是传输数据。

LLM 可以：

- classify observations；
- identify likely resource；
- infer player/provider pattern；
- resolve unfamiliar page behavior；
- generate candidate DownloadPlan；
- generate candidate Recipe；
- compare old/new observations；
- propose repair。

LLM 不应直接承担：

- socket transfer；
- filesystem integrity；
- checksum；
- download completion judgment。

---

# 19. AI Entry Conditions

已知 deterministic path 必须优先。

例如：

```text
Known direct HTTP
→ no LLM

Known HLS Recipe
→ no LLM

Known player pattern
→ no full discovery
```

只有以下场景进入 AI：

```text
UNKNOWN_RESOURCE
UNKNOWN_PLAYER
RECIPE_MISMATCH
SITE_CHANGED
UNCLASSIFIED_FAILURE
```

---

# 20. AI Budget

AI exploration 必须有界。

每次任务需存在：

- maximum elapsed time；
- maximum model calls；
- maximum probe count；
- network budget；
- optional monetary budget；
- cancellation propagation。

预算耗尽后必须结束为明确状态。

不得：

```text
Analyzing forever...
```

---

# 21. AI Failure Degradation

模型：

- offline；
- timeout；
- quota exceeded；
- unavailable；

不能影响普通 deterministic download。

应满足：

```text
AI unavailable
        ↓
Known downloads continue working
        ↓
Unknown scenario returns bounded failure
```

---

# 22. DownloadPlan

DownloadPlan 是一次任务执行计划，不是共享知识主体。

典型关系：

```text
Intent
+
Current State
+
Knowledge
+
ExecutionContext
       ↓
DownloadPlan
```

DownloadPlan 生命周期默认绑定单任务。

不得直接跨用户共享包含 credential/context 的 Plan。

---

# 23. Validation

Validation 是 P0。

文件存在不能自动等于下载成功。

至少拆分：

## Transfer Validation

- expected bytes；
- range completeness；
- checksum when available；
- segment completeness。

## Format Validation

- MIME；
- container parseability；
- archive validity；
- document readability。

## Media Validation

- expected tracks；
- duration；
- codec；
- audio/video presence；
- manifest consistency。

## Target Validation

确认：

> 下载的 Resource 是用户要求的 Resource。

例如需要避免：

```text
main video → ad
full media → preview
document → login HTML
video+audio → video-only
```

---

# 24. Evidence

每次任务至少保留：

```text
Intent
selected Resource
used Knowledge
used Tools
major Decisions
failure category
ValidationResult
```

敏感数据必须 redacted。

Evidence 用于：

- debug；
- reproducibility；
- AI repair；
- Recipe validation；
- support。

---

# 25. Knowledge Evolution

如果已有 Knowledge 失败：

```text
Recipe FAIL
    ↓
Observation
    ↓
AI reasoning
    ↓
Candidate fix
    ↓
Execution
    ↓
Validation
    ↓
Candidate Knowledge
```

只有 Validation 成功才能形成 Candidate Knowledge。

---

# 26. Knowledge Promotion

建议级别：

```text
L0 Local Candidate
L1 Local Verified
L2 Shared Candidate
L3 Community Verified
L4 Trusted/Built-in
```

跨用户共享不是 v0 基础版本的 PASS 条件。

即使 Shared Recipe 方案失败：

> Local Harness 仍可以成立。

---

# 27. Recipe Registry

Registry 属于增强能力。

可能支持：

```text
publish
download
verify
version
rollback
deprecate
revoke
```

v0 可以仅保留：

```text
local recipe store
```

公共 Registry 可以后置。

---

# 28. Security Model

核心原则：

> Browser content 和 shared Recipe 都是不可信输入。

不得让网页内容自然语言直接获得额外系统能力。

Recipe capability 必须显式限制。

例如：

```text
observe.network
inspect.dom
inherit.referer
inherit.cookie.same-site
download.same-origin
```

默认禁止：

```text
exec.shell
read.arbitrary_file
export.cookie
read.password
contact.arbitrary_host
execute.arbitrary_javascript
```

---

# 29. Credential Boundary

推荐数据流：

```text
Browser
   ↓
Local Credential Broker
   ↓
Download Tool
```

LLM 默认不读取 credential value。

例如模型看到：

```text
AUTH_CONTEXT_AVAILABLE=true
```

而不是：

```text
Cookie: SESSION=...
```

---

# 30. Model Data Boundary

需要显式定义：

```text
Browser
→ local runtime
→ optional model
→ evidence store
→ optional registry
```

每层字段必须定义：

- purpose；
- sensitivity；
- persistence；
- redaction；
- deletion；
- sharing eligibility。

---

# 31. User Experience — First Run

首次启动必须避免要求用户理解 Harness。

目标流程：

```text
Install xDownload
      ↓
Choose download folder
      ↓
Optional browser integration
      ↓
Ready
```

模型账号/API key 不应成为普通文件下载的强制前置条件。

---

# 32. UI — Add Download

入口：

- Paste URL；
- browser click；
- current-page resource；
- drag/drop supported input；
- optional clipboard detection。

单一明确资源：

> 优先直接开始，不增加多余选择。

多个候选：

> 显示 Resource Picker。

---

# 33. UI — Resource Picker

示例：

```text
当前页面发现

Video
✓ Main Video   1080p  26:41
  Main Video    720p  26:41
  Preview       720p   1:00

Documents
  Manual.pdf
  Specification.pdf
```

应隐藏：

- segment URL；
- cryptic MIME；
- manifest internals；

除非进入 Advanced View。

---

# 34. UI — Download List

最低信息：

```text
Name
Status
Progress
Speed
Remaining
Size
Destination
```

操作：

```text
Pause
Resume
Cancel
Retry
Open File
Open Folder
Details
```

---

# 35. UI — AI State

AI discovery 不应该占据主产品 UI。

正常：

```text
正在识别页面资源…
```

必要时可展开：

```text
Known rule failed
Trying alternate discovery
```

失败：

```text
没有可靠识别到目标资源
```

不得显示：

> AI thinks it probably worked

作为成功状态。

---

# 36. CLI Contract

CLI 必须能明确区分：

```text
task accepted
download started
completed
needs user action
failed
cancelled
timeout
```

必须存在 machine-readable output，例如：

```text
--json
```

正式字段在 Interface Contract 冻结。

---

# 37. CLI Process Semantics

CLI 至少支持两类模式：

## Submit mode

```text
submit
→ return task id
→ process may exit
```

## Wait mode

```text
submit
→ wait
→ return final status
```

不能模糊：

> 命令退出 0 到底代表“任务提交成功”还是“文件下载完成”。

---

# 38. CLI Non-interactive Mode

非交互模式遇到：

```text
AUTH_REQUIRED
RESOURCE_SELECTION_REQUIRED
USER_CONFIRMATION_REQUIRED
```

必须有界退出。

不得无限等待 Desktop UI。

---

# 39. Batch

批量任务允许：

```text
10 tasks
7 complete
2 fail
1 needs auth
```

整体结果不得掩盖逐项失败。

用户可以只 retry failed items。

---

# 40. Browser Profile

如果用户有多个 browser profile：

必须明确：

- 当前资源属于哪个 profile；
- 使用哪个 ExecutionContext；
- credential 不得跨 profile 错误复用。

授权撤销后：

> 原 credential 不得继续被后台任务复用。

---

# 41. Initial Support Matrix

## v0 P0

```text
HTTP/HTTPS files
Browser direct downloads
Direct video/audio
HLS VOD
DASH VOD
Basic document/attachment discovery
```

## Conditional

```text
authenticated resources
multiple quality streams
separate audio/video mux
batch attachments
```

## Deferred

```text
live stream recording
BitTorrent
Magnet
eMule
cloud-drive proprietary protocol
full website mirroring
complex course archiving
```

---

# 42. Explicit Non-goals

xDownload v0 不以以下能力为产品目标：

- DRM circumvention；
- bypass paywall；
- credential theft；
- authentication cracking；
- extracting protected encryption keys；
- unauthorized access；
- arbitrary website automation；
- arbitrary Recipe code execution。

---

# 43. Reliability

产品必须处理：

```text
app crash
system restart
network loss
disk full
destination unavailable
expired signed URL
auth expiry
server retryable failure
model timeout
browser extension unavailable
```

每类 failure 必须：

1. 分类；
2. 有界结束或恢复；
3. 提供用户可以理解的状态；
4. 保留必要 Evidence。

---

# 44. Failure Taxonomy

至少包括：

```text
NETWORK_FAILURE
RESOURCE_NOT_FOUND
RESOURCE_CHANGED
AUTH_REQUIRED
AUTH_EXPIRED
RATE_LIMITED
RECIPE_MISMATCH
SITE_CHANGED
PROTOCOL_UNSUPPORTED
DRM_PROTECTED
DISK_FULL
DESTINATION_DENIED
VALIDATION_FAILED
MODEL_UNAVAILABLE
MODEL_BUDGET_EXHAUSTED
USER_CANCELLED
```

---

# 45. Performance Metrics

正式阈值待 Product Experiment 建立 baseline 后冻结。

必须测量：

## Correctness

```text
Correct Completion Rate
False Success Rate
Wrong Resource Rate
```

## Convenience

UI：

```text
steps to start
first-use success time
manual intervention rate
```

CLI：

```text
configuration steps
non-interactive success
manual intervention
```

## Fluidity

```text
time to first feedback
time to data transfer start
P50 / P95
```

## Recovery

```text
recoverable failure recovery rate
recovery operations
restart recovery rate
```

## Cost

```text
model calls per task
AI cost per successful task
failed inference cost
```

---

# 46. Product Gates

## G0 — Product Value

验证：

> xDownload 是否真的帮助用户更方便、更可靠完成下载？

G0 是产品级 Gate。

如果 FAIL：

> 整体产品需要重新评估。

## G1 — AI Increment

验证：

> AI 是否解决 deterministic path 无法解决的有价值任务？

如果 FAIL：

> 保留下载产品，移除或弱化 AI。

## G2 — Local Knowledge Compounding

验证：

> 一次 AI discovery 是否能降低同类后续任务成本？

如果 FAIL：

> 产品可以成为 AI Download Agent，但不能宣称 self-evolving Harness。

## G3 — Shared Knowledge

验证：

> Recipe 能否在用户间安全可靠复用？

如果 FAIL：

> 保留 Local Knowledge，不建立或缩减公共 Registry。

---

# 47. Experiment Corpus

不得只用一个任务集证明所有结论。

至少分成：

## Natural Corpus

真实普通下载任务。

验证：

```text
overall product usefulness
```

## Hard Corpus

现有工具难以处理或需要大量人工干预的任务。

验证：

```text
AI incremental value
```

## Holdout Corpus

未用于 Recipe 生成或开发调试的：

- pages；
- sessions；
- profiles；
- machines；
- users；

验证：

```text
generalization
```

---

# 48. Experiment Controls

实验需记录：

```text
tool version
configuration
browser version
OS
network conditions
human operator
time budget
manual steps
failure details
```

不得：

- 对 xDownload 充分手工调优；
- 对竞品仅使用最差默认配置；
- 用生成 Recipe 的原页面证明泛化。

---

# 49. Representative Baselines

Product Experiment 至少比较：

```text
Browser native download
IDM or equivalent desktop downloader
yt-dlp
JDownloader / equivalent
modern AI/sniffer downloader
```

每种工具只比较其实际适合的 workflow。

---

# 50. Product Success

基础产品成功不要求：

```text
Recipe 跨用户分享成功
```

也不要求：

```text
AI 参与大部分任务
```

真正基础 PASS 是：

> 用户能更方便、可靠、透明地完成目标下载任务。

---

# 51. Harness Success

Harness 的内部成功定义：

```text
more deterministic execution
more reusable validated knowledge
fewer repeated discoveries
lower repair cost
stable evidence
bounded reasoning
```

这些属于产品效率与长期能力指标。

不能替代 Product Success。

---

# 52. v0 Release Scope

v0 建议聚焦三个用户价值：

### A. Strong Basic Downloader

普通 HTTP 文件下载必须日常可用。

### B. Strong Browser Resource Discovery

当前页面的普通媒体/附件能够低操作成本发现和下载。

### C. Bounded AI Fallback

已有方法失败时 AI 可以介入，但：

- 有预算；
- 有停止条件；
- 有 Validation；
- 不影响正常下载。

---

# 53. v0 Knowledge Scope

第一阶段允许：

```text
Built-in protocol knowledge
Built-in player knowledge
Local Recipes
Local Recipe repair
```

公共跨用户 Recipe Registry：

**P1/P2 candidate，非 v0 P0。**

---

# 54. Monorepo Product Boundary

项目按单一 monorepo 管理。

逻辑模块预计包括：

```text
xdownload/
├── apps/
│   ├── desktop/
│   └── browser-extension/
│
├── cli/
│
├── packages/
│   ├── domain-contract/
│   ├── harness-core/
│   ├── domain-state/
│   ├── resource-model/
│   ├── knowledge/
│   ├── recipe/
│   ├── decision/
│   ├── validation/
│   └── evidence/
│
├── tools/
│   ├── browser-observer/
│   ├── http/
│   ├── hls/
│   ├── dash/
│   ├── media/
│   └── filesystem/
│
└── knowledge/
    ├── protocols/
    ├── players/
    ├── providers/
    ├── sites/
    └── failures/
```

此目录只表达产品边界和领域拆分意图。

**不是 L2 Architecture Freeze。**

---

# 55. Open Product Decisions

进入 Product Freeze 前仍需解决：

1. Desktop 首发平台是否仅 Windows；
2. CLI 是否和 Desktop daemon 共用 Runtime；
3. 是否要求完全无 UI 的 standalone CLI；
4. Browser Extension 首发支持 Chromium 的具体范围；
5. HLS/DASH v0 对多音轨、字幕、加密 segment 的支持层级；
6. authenticated resources 是否进入 v0 P0；
7. local model / cloud model / user-provided model 的优先方案；
8. 公共 Recipe Registry 是否推迟到 v0 后；
9. 模型费用由产品方还是用户承担；
10. 默认 telemetry 是否完全关闭。

这些属于待验证/待冻结问题，不得由实现自行决定。

---

# 56. PRD Acceptance Before Product Freeze

本 PRD 进入 Product Freeze 前至少需要：

- G0 Product Value 测试设计冻结；
- Initial Support Matrix 冻结；
- UI Critical Journeys 定义；
- CLI behavior contract 定义；
- Download Task 状态语义冻结；
- Validation success/failure 定义；
- AI budget / stop / fallback 契约冻结；
- credential/data boundary 冻结；
- failure taxonomy 核心集合冻结；
- Natural / Hard / Holdout corpus 设计冻结；
- first-version non-goals 冻结。

---

# 57. Product Critical Journeys

至少包括：

### CJ-01 Ordinary Download

```text
Paste URL
→ choose/default target
→ download
→ validate
→ open file
```

### CJ-02 Browser Download

```text
Click/download on page
→ xDownload receives
→ download
→ complete
```

### CJ-03 Media Discovery

```text
Open page
→ detect candidates
→ select main resource
→ download
→ validate
```

### CJ-04 Recovery

```text
Downloading
→ network/application interruption
→ restart
→ safe resume or restart
→ complete
```

### CJ-05 CLI Automation

```text
CLI submit
→ task id
→ query/wait
→ deterministic final state
```

### CJ-06 Knowledge Gap

```text
Known methods fail
→ AI discovery
→ bounded probe
→ validation
→ download or explicit failure
```

### CJ-07 Model Offline

```text
model unavailable
→ ordinary download still works
→ unknown case fails boundedly
```

---

# 58. Final Product Position

xDownload 对用户不是：

> 一个 Recipe 平台。

也不是：

> 一个展示 LLM 嗅探能力的实验。

用户看到的是：

> **一个更容易把自己能够访问的网络资源可靠保存到本地的下载工具。**

Download Domain Harness 是使这一产品能够：

- 适应更多未知场景；
- 积累领域知识；
- 降低重复 AI 推理；
- 在站点变化后更容易恢复；
- 最终形成可复用 Download Knowledge；

的内部核心能力。

---

# PRD Terminal

```text
Product: xDownload
Primary value: Convenient, reliable downloading
Primary UI: Desktop application
Automation surface: CLI
Browser integration: Core
Harness: Core internal product architecture thesis
LLM: Knowledge-gap fallback
Recipe: Validated reusable knowledge
Shared Recipe Registry: Optional enhancement, non-blocking
Validation: P0
Security / credential boundary: P0
Basic downloader quality: P0
AI dependence for ordinary download: NOT ALLOWED
Product Freeze: NOT YET
Next stage: Product experiment + PRD independent review, then Product Freeze
```
