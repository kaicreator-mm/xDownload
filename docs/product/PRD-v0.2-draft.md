# xDownload PRD v0.2

**Product name:** xDownload  
**Product type:** Intelligent download tool powered by Download Domain Harness  
**Document status:** PRD Draft  
**Supersedes:** `PRD-v0.1-draft.md`  
**Product Freeze:** NO  
**Architecture Freeze:** NO  
**Date:** 2026-10-02

---

# 0. v0.2 Change Summary

v0.2 保留 v0.1 的基础结论：产品首先必须是一个更方便、更可靠、更流畅的下载工具；Harness、AI、Recipe 和共享知识都不能取代基础产品价值。

本版增加一个重要产品方向：

> **xDownload 主动吸收部分 crawler-like 能力，用于降低用户寻找、选择、批量获取和整理资源的操作成本，但这些能力必须受用户 Download/Acquisition Intent 的范围约束。**

v0.2 的主要变化：

1. 将单一 `DownloadIntent` 扩展为 `AcquisitionIntent`；
2. 正式区分 `SingleResourceIntent` 与 `CollectionIntent`；
3. 将 **Bounded Collection Acquisition** 提升为核心产品实验能力；
4. Browser Observer 之外允许受限的 page/link/pagination navigation Tools；
5. Knowledge 增加 Collection / Pagination / Gallery / Listing Patterns；
6. 新增 `ExplorationScope`、`NavigationConstraint`、`ExplorationBudget`；
7. 明确 xDownload 与通用 crawler 的产品边界；
8. UI 从“Resource Picker”扩展到“Scope + Collection Preview + Resource Selection”；
9. CLI 增加明确 collection/scope 语义；
10. Validation 增加 Collection Completeness 与 Collection Membership Validation；
11. Product Experiment 增加专门的 Collection Corpus 和对照指标。

本版仍不冻结具体架构实现。

---

# 1. Product Definition

xDownload 是一个以桌面 UI 为主要交互入口、同时提供 CLI 与浏览器协同能力的智能下载工具。

它的用户价值不是：

> 给我一个 URL，我把这个 URL 的字节保存下来。

而是：

> **告诉我你想保存什么，我帮助你发现、选择、获取、验证并整理你能够访问的网络资源。**

产品核心动词：

```text
Discover
→ Select
→ Acquire
→ Validate
→ Organize
```

对于简单场景，整个流程应退化成普通的一键下载，不增加额外复杂度。

对于页面媒体、附件、合集、分页列表等场景，xDownload 可以使用受控的 discovery/navigation 能力，减少用户手工寻找 URL、逐项点击和整理文件的成本。

---

# 2. Product Principle

产品优先级：

```text
正确获取用户目标
    >
可靠和可恢复
    >
低操作成本
    >
清晰的范围与结果
    >
快速反馈
    >
智能发现 / 有界集合获取
    >
AI 自动探索
    >
Knowledge 复用
    >
跨用户 Recipe 网络
```

不得为了证明 Harness、AI、Crawler-like Tools 或 Recipe 能力而牺牲基础下载体验。

---

# 3. Product Thesis

xDownload 的产品 thesis 是：

> **传统下载器已经很好地解决“已知资源 URL → 文件”问题，但用户真实任务经常从“页面、媒体、附件、合集、分页列表”开始。通过受限资源发现、集合展开和语义选择，可以显著减少用户在“找到真正资源”与“逐个下载整理”上的操作成本。**

因此 xDownload 不只是 Transport Downloader，也不是 General Crawler，而是：

> **Downloader with bounded discovery and collection acquisition.**

内部可进一步理解为：

> **Intent-bounded Targeted Resource Acquisition Harness.**

---

# 4. Product Boundary: Download vs Crawl

xDownload 允许使用 crawler-like 技术，但产品任务必须具有用户定义的停止条件。

## 4.1 xDownload

```text
User Intent
→ finite scope
→ discover only what is necessary
→ acquire selected resources
→ validate
→ organize
→ STOP
```

## 4.2 General Crawler

```text
Seed
→ discover more pages
→ expand frontier
→ crawl
→ extract/index
→ recrawl/monitor
→ continue according to discovery policy
```

核心区别：

> **xDownload 为了拿到用户要的东西而探索；Crawler 为了发现更多东西而继续探索。**

xDownload MUST NOT 默认把一个下载任务自动扩展为：

- 任意链接递归；
- 全站探索；
- 无明确上限的分页遍历；
- 持续监控网站变化；
- 网站内容索引；
- 通用网页数据集构建；
- 与当前 AcquisitionIntent 无关的页面探索。

---

# 5. AcquisitionIntent

v0.2 使用 `AcquisitionIntent` 作为用户目标的顶层领域概念。

```text
AcquisitionIntent
├── SingleResourceIntent
└── CollectionIntent
```

Intent 描述用户想得到什么，不描述底层怎样抓取或下载。

---

# 6. SingleResourceIntent

典型任务：

- 下载这个文件；
- 下载当前播放的视频；
- 下载当前页面中的某个 PDF；
- 下载指定 URL；
- 下载这个 release asset。

示例：

```yaml
type: single

target:
  current_page: true

resource:
  type: video

selection:
  quality: best

output:
  directory: Downloads
```

简单明确的 SingleResourceIntent 必须优先走 deterministic fast path。

---

# 7. CollectionIntent

CollectionIntent 表示用户明确要求获取一个有限资源集合。

典型任务：

- 下载当前页面所有 PDF；
- 下载这个 gallery 的所有原图；
- 下载这个 playlist 的全部视频；
- 下载这个列表前 3 页中的所有 ZIP；
- 下载这个明确课程目录里的视频和讲义；
- 下载用户勾选的 20 个资源。

示例：

```yaml
type: collection

target:
  current_page: true

scope:
  pagination:
    enabled: true
    max_pages: 3
  max_items: 100

resource_filter:
  types:
    - pdf

selection:
  exclude_duplicates: true

organization:
  directory: "{page_title}"
```

CollectionIntent 必须具有可理解、可验证的 scope。

---

# 8. Scope Is Product Contract

CollectionIntent 不能只说“尽量多找”。

必须存在明确范围，例如：

```text
当前页面
当前页面 + 子 frame
当前明确 playlist
当前 gallery
前 N 页
最多 N 项
用户明确选择的链接集合
明确目录下的一层项目
```

UI 应优先使用普通用户语言表达 scope：

```text
下载范围

○ 当前文件
○ 当前页面
● 当前合集（18 项）
○ 前 3 页
```

不得要求普通用户理解 `crawl depth`、`frontier`、XPath 或 crawler scheduler。

---

# 9. ExplorationScope

内部必须存在结构化 `ExplorationScope`。

最低应表达：

```text
root context
allowed navigation types
allowed hosts/origins
allowed paths
max pages
max items
max navigation depth
max elapsed time
recursive navigation allowed?
pagination allowed?
```

默认策略应偏保守。

---

# 10. Intent Cannot Be Expanded by LLM

LLM 可以决定：

> 如何完成用户已经给出的 AcquisitionIntent。

LLM 不得自行扩大：

> 用户到底应该下载什么。

例如用户要求：

> 下载当前视频。

LLM 不得因为发现作者还有 25 个视频而自动将任务升级为：

> 下载作者全部视频。

扩大 scope 必须来自用户显式选择或产品定义的可解释默认行为。

---

# 11. Exploration Budget

除了 AI Budget，还必须存在独立的 Exploration Budget。

最低包括：

- maximum pages；
- maximum items；
- maximum navigation depth；
- maximum elapsed time；
- maximum network requests attributable to exploration；
- maximum cross-origin transitions；
- cancellation propagation。

预算耗尽时必须返回：

- 已发现资源；
- 未完成原因；
- 是否可继续扩大范围。

不得无界继续探索。

---

# 12. Target Jobs

## 12.1 Ordinary Download

> “把这个文件保存下来。”

必须处理 HTTP/HTTPS、路径、重名、retry、恢复、完成后定位文件。

AI 与 collection discovery 不得增加简单任务摩擦。

## 12.2 Current-page Smart Download

> “下载当前页面的视频。”  
> “下载这里的 PDF。”

xDownload 应自动从当前页面上下文识别资源，而不要求用户理解 manifest、network request 或 DevTools。

## 12.3 Page Collection

> “把当前页面的所有附件下载下来。”

系统应：

1. 发现资源；
2. 语义分组；
3. 排除明显图标、广告、tracking asset 等噪音；
4. 展示 Collection Preview；
5. 用户确认/调整选择；
6. 下载；
7. 验证；
8. 整理。

## 12.4 Declared Playlist / Gallery

> “下载这个播放列表的全部视频。”  
> “下载这个相册的所有原图。”

允许对明确集合进行有限展开，但不得跳出集合边界继续站点探索。

## 12.5 Bounded Pagination

> “下载这个列表前 3 页所有 PDF。”

允许识别和跟随分页 Pattern，但必须遵守 `max_pages` / `max_items` 等 scope。

## 12.6 Site Adaptation

已知 Recipe/Pattern 失效时，允许 AI-assisted discovery 与 repair，但仍受当前 Intent、Navigation Constraints 与 budgets 约束。

## 12.7 Automation / Batch

CLI 用户应能可靠创建 single/collection acquisition，并获得稳定 task/collection result。

---

# 13. Product Surfaces

## 13.1 Desktop UI

主要入口。

核心任务：

- 添加 URL；
- 接受浏览器任务；
- 创建 Single Download；
- 创建 Collection Download；
- 选择 acquisition scope；
- 预览 Resource Collection；
- 筛选/全选/取消选择；
- 查看下载队列；
- 暂停/恢复/取消/retry；
- 查看 discovery 状态和边界；
- 查看完成文件与目录；
- 控制浏览器、隐私和模型设置。

## 13.2 Browser Integration

Browser Integration 负责提供当前用户浏览上下文：

- current page；
- DOM/network/player facts；
- frame topology；
- current profile/session capability；
- user-selected links/resources。

默认只观察用户当前上下文。

若 Harness 需要导航，必须由受限 Navigation Tool 根据 AcquisitionIntent 执行，而不是让扩展无限遍历站点。

## 13.3 CLI

CLI 是 first-class automation surface。

概念能力：

```text
add
collect
status
list
cancel
retry
pause
resume
```

具体语法后续冻结。

CLI 必须支持显式 scope，例如：

```text
--current-page
--max-pages N
--max-items N
--type pdf
--json
--non-interactive
```

这里仅定义产品语义，不冻结参数命名。

---

# 14. Shared Domain Model

核心对象调整为：

```text
AcquisitionIntent
ExplorationScope
Resource
ResourceCollection
ResourceGraph
AcquisitionTask
ExecutionContext
AcquisitionPlan
AcquisitionResult
ValidationResult
Failure
Evidence
```

`DownloadTask` 可以继续作为单个传输任务对象，但不再承担整个 Collection workflow 的顶层语义。

---

# 15. Resource Model

URL 不等同于 Resource。

核心类型：

```text
FileResource
MediaResource
DocumentResource
CollectionResource
```

CollectionResource 可以包含：

```text
Collection
├── Resource
├── Resource
└── SubCollection (bounded)
```

Resource 必须保留足够 identity，支持 dedup、resume、安全 retry 和 membership validation。

---

# 16. ResourceGraph

ResourceGraph 表达资源之间的语义关系，而不是 crawler URL frontier。

例如：

```text
Course
├── Chapter 1
│   ├── Video
│   ├── Slides.pdf
│   └── Source.zip
├── Chapter 2
│   ├── Video
│   └── Slides.pdf
└── Chapter 3
    └── Video
```

用户可以表达：

> 下载所有 Video + Slides，不要 Source。

Harness 将选择结果编译成有限 DownloadTasks。

---

# 17. Collection Membership

系统必须能够区分：

- 用户目标集合成员；
- 页面装饰资源；
- 广告/preview；
- unrelated linked content；
- pagination/control links；
- duplicate resource。

无法可靠判断 membership 时，应暴露不确定性，不得静默把站点其他内容纳入合集。

---

# 18. Acquisition Task State

顶层 AcquisitionTask 最低状态：

```text
CREATED
DISCOVERING
AWAITING_SELECTION
READY
ACQUIRING
VALIDATING
ORGANIZING
COMPLETED
PARTIAL
FAILED
CANCELLED
NEEDS_USER_ACTION
```

单资源 transport task 可以有更细的 DOWNLOADING / PAUSED / RETRYING 等内部状态。

Collection 部分成功必须使用 `PARTIAL` 或等价清晰状态，不能把部分成功标记为整体完成。

---

# 19. Cross-surface Consistency

UI、CLI、Browser Integration 若使用同一本地 Runtime，应共享：

- AcquisitionTask ID；
- Resource/Collection selection；
- progress；
- failure；
- cancellation；
- restart recovery；
- output state。

Browser 与 CLI 同时提交重复 collection 时，必须有可解释 duplicate policy。

---

# 20. Basic Download Requirements

基础下载仍是 P0。

必须支持：

- HTTP/HTTPS；
- redirects；
- filename detection；
- destination selection；
- retry；
- cancellation；
- application restart recovery；
- disk-space / destination errors；
- duplicate filename handling；
- proxy 基础能力；
- 可验证条件下 resume；
- 合法 scope 内的 cookie/header propagation。

---

# 21. Browser Observer Tool

Browser Observer 只负责 observation，不隐式等于 crawler。

能力：

```text
observe_page()
observe_network()
observe_player()
observe_frames()
collect_candidate_resources()
```

Raw browser events 必须先经过 deterministic filter，再进入 Harness/LLM。

---

# 22. Navigation Tools

v0.2 允许加入 crawler-like Tools：

```text
inspect_links()
follow_declared_link()
follow_pagination()
scroll_current_page()
open_collection_item()
```

这些 Tool 只能在：

```text
AcquisitionIntent
+
ExplorationScope
+
NavigationConstraint
```

允许时执行。

不提供默认的 unrestricted `crawl(url)`。

---

# 23. Knowledge

Knowledge 扩展为：

```text
Protocol Knowledge
Player Knowledge
Provider Knowledge
Site Knowledge
Failure Knowledge
Collection Knowledge
Pagination Pattern
Gallery Pattern
Listing Pattern
Recipe
```

优先通过组合通用 Pattern 完成任务，而不是所有网站写独立 extractor。

---

# 24. Recipe

Recipe 是经过验证的 reusable domain knowledge。

Recipe 可以描述：

- match；
- observation；
- resource detection；
- collection detection；
- pagination；
- membership rule；
- selection；
- required context；
- validation；
- allowed navigation capability。

Recipe 不保存：

- Cookie value；
- JWT；
- signed URL；
- session-specific secret；
- 用户私人页面内容快照。

v0 Recipe 不允许任意 shell execution 或 unrestricted arbitrary script execution。

---

# 25. Download Domain Harness

核心模型：

```text
AcquisitionIntent
      ↓
State
      ↓
Knowledge
      ↓
Decision
      ↓
Constraints / Scope
      ↓
Tools
      ↓
Validation
      ↓
Evidence
```

Harness 负责：

- workflow；
- discovery strategy；
- tool selection；
- collection membership decision；
- navigation decision；
- scope enforcement；
- failure classification；
- recovery；
- validation；
- AI escalation；
- evidence capture。

---

# 26. Constraints

至少需要以下领域约束：

```text
IntentScopeConstraint
NavigationConstraint
OriginConstraint
ResourceScopeConstraint
ExplorationBudget
AIBudget
CredentialConstraint
StorageConstraint
```

约束必须由 Runtime 执行，不能只写在 prompt 中。

---

# 27. AI Role

LLM 可用于：

- classify observations；
- understand natural-language AcquisitionIntent；
- infer likely resource/collection；
- distinguish original vs thumbnail / main vs preview；
- identify collection structure；
- infer pagination pattern；
- resolve unfamiliar page behavior；
- propose bounded navigation；
- generate candidate AcquisitionPlan；
- generate/repair candidate Recipe。

LLM 不负责：

- 无界决定 scope；
- unrestricted web navigation；
- socket transfer；
- filesystem integrity；
- final success judgment。

---

# 28. Deterministic-first

以下路径不得强制调用 LLM：

```text
Known direct HTTP
Known HLS/DASH
Known page attachment pattern
Known collection Recipe
Known pagination Pattern
```

AI 只处理 Knowledge Gap 或语义不确定场景。

---

# 29. AI + Exploration Failure Degradation

模型不可用时：

- 普通下载继续工作；
- 已知 Recipe/Pattern 继续工作；
- 已知 Collection 展开继续工作；
- 未知复杂场景 bounded failure。

Navigation/exploration 预算耗尽时：

- 停止继续探索；
- 返回已经发现的候选；
- 明确 scope 未完全解析；
- 允许用户扩大范围或结束。

---

# 30. AcquisitionPlan

AcquisitionPlan 是一次任务的当前执行计划。

```text
AcquisitionIntent
+
Current State
+
Knowledge
+
ExplorationScope
+
ExecutionContext
→ AcquisitionPlan
```

它可以包含：

- observation steps；
- bounded navigation steps；
- resource selection；
- DownloadTasks；
- validation；
- organization plan。

Plan 是 session/task-scoped，不作为跨用户共享主体。

---

# 31. Validation

Validation 仍然是 P0。

## 31.1 Transfer Validation

验证字节、segment、checksum、resource identity。

## 31.2 Format Validation

验证 MIME/container/archive/document readability。

## 31.3 Media Validation

验证 track、duration、codec、audio/video completeness。

## 31.4 Target Validation

确认结果就是用户要求的资源，而不是广告、preview、登录页等。

## 31.5 Collection Membership Validation

确认每个下载项属于用户所选 collection/scope。

## 31.6 Collection Completeness Validation

当系统声称：

> “已下载全部 18 项”

必须有可解释依据证明：

- 期望 count/identity 已知；或
- collection traversal 达到明确终止条件。

如果不能确认完整性，只能表述：

> “已找到并下载 18 项；无法确认是否为全部。”

不得伪装成 complete collection。

---

# 32. Evidence

每次 acquisition 至少保留：

```text
Intent
Scope
Navigation actions
Candidate resources
Selected resources
Used Knowledge
Used Tools
Major Decisions
Budget usage
Failure category
ValidationResult
Collection completeness state
```

敏感数据必须 redacted。

---

# 33. Knowledge Evolution

未知集合/页面处理成功后：

```text
Knowledge Gap
→ Observe / bounded navigate
→ Hypothesis
→ Execute
→ Validate
→ Candidate Pattern / Recipe
```

只有通过 deterministic validation 的候选才能进入 Knowledge。

共享仍不是基础产品成立条件。

---

# 34. Security and Data Boundary

Browser content、网页脚本、共享 Recipe 都是不可信输入。

默认禁止：

```text
exec.shell
read.arbitrary_file
export.cookie
read.password
contact.unrelated_arbitrary_host
unbounded_navigation
execute_unrestricted_javascript
```

Credential 默认 local-only，通过引用或 scoped broker 传给需要的 Tool。

LLM 默认只知道 authentication context 是否可用，不读取 secret value。

---

# 35. UI — First Run

首次使用目标：

```text
Install
→ choose download folder
→ optional browser integration
→ ready
```

不要求先配置 AI 才能进行正常下载。

---

# 36. UI — Acquisition Entry

入口：

- Paste URL；
- browser click；
- current page；
- selected links；
- drag/drop supported input；
- optional clipboard detection。

产品根据上下文判断：

```text
Single resource
or
Potential collection
```

但不得未经用户确认把 single task 扩展成大 collection。

---

# 37. UI — Scope Picker

当页面存在集合机会时，可以提供：

```text
下载范围

● 当前文件
○ 当前页面（8 项）
○ 当前合集（18 项）
○ 前 3 页（预计 42 项）
```

默认选项必须根据任务风险和确定性保守选择。

扩大 scope 是显式用户动作。

---

# 38. UI — Collection Preview

Collection 下载前应尽可能展示：

```text
找到 26 项

视频  12
PDF    9
ZIP    3
其他   2

[全选]
[仅视频]
[仅文档]
[高级筛选]
```

每个资源至少尽可能显示：

- human-readable name；
- type；
- size（已知时）；
- quality/duration（媒体时）；
- source/group；
- uncertain indicator。

---

# 39. UI — Semantic Selection

用户可以表达：

- 只要 PDF；
- 不要缩略图；
- 只要高清原图；
- 视频选择最佳质量；
- 不要 preview；
- 视频 + 讲义，不要 source code。

自然语言可以辅助形成 SelectionPolicy，但最终 scope/selection 应可查看和修改。

---

# 40. UI — Organization

Collection acquisition 应支持自动文件组织。

例如：

```text
Course Name/
├── 01 Introduction/
│   ├── Video.mp4
│   └── Slides.pdf
└── 02 Installation/
    ├── Video.mp4
    └── Slides.pdf
```

组织规则来自可验证的页面/collection metadata，不应让模型任意虚构标题。

文件命名冲突必须安全处理。

---

# 41. UI — Progress

Collection 顶层应显示：

```text
18 items
12 complete
3 downloading
2 queued
1 failed
```

并允许：

- retry failed；
- cancel remaining；
- inspect individual item；
- open output folder。

---

# 42. CLI Contract

CLI 必须区分：

```text
accepted
scope_resolved
selection_required
acquiring
completed
partial
needs_user_action
failed
cancelled
timeout
```

machine-readable output 不得混入非结构化进度日志。

Collection result 必须提供逐项状态。

---

# 43. Non-interactive Collection

非交互 CLI 如果出现：

```text
scope ambiguous
selection required
auth required
budget exhausted
```

必须有界返回。

可以通过明确参数预先给定 policy，而不是弹出 UI 无限等待。

---

# 44. Initial Support Matrix v0.2

## v0 Core / P0

```text
HTTP/HTTPS file download
Browser direct download interception
Direct video/audio
HLS VOD
DASH VOD
Current-page resource discovery
Current-page attachment collection
Collection preview + selection
Safe batch acquisition
Collection-level progress / partial result
```

## v0 Product Experiment Core

以下必须进入 Product Experiment，以验证 crawler-like capability 是否真正提高产品价值：

```text
Explicit playlist collection
Explicit gallery collection
Bounded pagination collection
Semantic filter / selection
Automatic collection organization
```

这些能力是否全部成为首个 Release P0，由实验结果和独立 PRD Review 决定。

## Conditional

```text
authenticated collection
multiple media tracks/subtitles
separate audio/video mux
course-like nested collection
cross-origin declared collection
```

## Deferred

```text
unbounded website crawl
continuous monitoring / recrawl
full website mirroring
search-engine style indexing
open-ended data scraping
BitTorrent / Magnet / eMule
cloud-drive proprietary protocols
live stream recording
```

---

# 45. Explicit Non-goals

xDownload v0.2 不以以下为产品目标：

- 通用 crawler；
- 全站镜像；
- 无边界递归；
- 持续监控站点；
- arbitrary scraping/data extraction platform；
- DRM circumvention；
- bypass paywall；
- credential theft；
- authentication cracking；
- unauthorized access；
- arbitrary browser automation；
- arbitrary Recipe code execution。

---

# 46. Failure Taxonomy Additions

除 v0.1 failure 外，增加：

```text
SCOPE_AMBIGUOUS
SCOPE_LIMIT_REACHED
NAVIGATION_BLOCKED
COLLECTION_INCOMPLETE
COLLECTION_MEMBERSHIP_UNCERTAIN
SELECTION_REQUIRED
PARTIAL_COMPLETION
```

这些状态必须可被 UI 和 CLI 区分。

---

# 47. Product Metrics

正式阈值在 Product Experiment 后冻结。

## Correctness

```text
Correct Completion Rate
False Success Rate
Wrong Resource Rate
Wrong Collection Membership Rate
```

## Convenience

```text
steps to first acquisition
manual URL-copy count
manual per-item click count
manual file organization steps
manual intervention rate
```

## Collection Value

```text
collection setup actions
items acquired per user action
collection completion rate
partial failure recovery cost
selection correction rate
```

## Fluidity

```text
time to first feedback
time to first candidate
time to transfer start
P50 / P95
```

## Recovery

```text
restart recovery
retry recovery
partial collection recovery
```

## Internal Efficiency

```text
model calls per acquisition
exploration pages per successful collection
Recipe/Pattern reuse rate
cost per successful acquisition
```

内部效率指标不能替代用户价值指标。

---

# 48. Product Gates

## G0 — Product Value

xDownload 是否比基线流程更方便、可靠地完成实际下载任务？

包括 single 与 collection。

G0 FAIL → 重新评估整体产品。

## G1 — Collection Increment

受控 discovery/collection acquisition 是否显著减少用户逐项寻找、点击和整理资源的成本？

G1 FAIL → 保留传统/智能 single downloader，缩减 crawler-like capability。

## G2 — AI Increment

LLM 是否在 deterministic discovery/collection 失效时提供有效增量？

G2 FAIL → 降低或移除 AI，不否定下载产品。

## G3 — Local Knowledge Compounding

一次成功 discovery/collection resolution 是否能降低以后同类任务成本？

G3 FAIL → 可以保留 AI Agent 模式，不宣称 self-evolving Harness。

## G4 — Shared Knowledge

Recipe/Pattern 能否跨用户安全可靠复用？

G4 FAIL → 保留 Local Knowledge，不建立或缩减公共 Registry。

---

# 49. Experiment Corpus

至少分为：

## Natural Corpus

真实普通用户下载任务，用于 G0。

## Collection Corpus

真实 collection jobs，包括：

- current-page attachments；
- gallery；
- playlist；
- bounded pagination。

用于 G1。

## Hard Corpus

现有 deterministic 方法困难/失败任务，用于 G2。

## Holdout Corpus

未参与 Pattern/Recipe 生成的页面、session、profile、machine、user，用于 G3/G4 generalization。

不得混用一个 corpus 证明所有结论。

---

# 50. Collection Experiment Baselines

Collection 场景对照不应只比较 downloader。

需要同时比较：

```text
manual browser workflow
browser native multi-download where applicable
representative desktop downloader
representative browser media downloader
representative downloader with sniff/deep-search
manual DevTools / copy-link workflow where realistic
```

核心衡量：

- 用户需要做多少次选择/点击；
- 是否需要寻找真实 URL；
- 能否正确识别集合；
- 是否漏项/错项；
- 下载后的整理成本。

---

# 51. Critical Journeys

## CJ-01 Ordinary Download

```text
Paste/click URL
→ download
→ validate
→ open
```

## CJ-02 Current-page Media

```text
Open page
→ detect main media
→ select/default
→ acquire
→ validate
```

## CJ-03 Current-page Attachments

```text
Open page
→ choose “当前页面附件”
→ preview collection
→ select
→ acquire
→ organize
→ validate collection
```

## CJ-04 Gallery

```text
Open gallery
→ detect explicit collection
→ show scope/count
→ choose originals
→ acquire all selected
→ organize
```

## CJ-05 Bounded Pagination

```text
Open listing
→ choose first 3 pages
→ discover under max_pages/max_items
→ preview
→ acquire
→ stop exactly at scope boundary
```

## CJ-06 Collection Partial Failure

```text
20 items
→ 17 success / 3 fail
→ PARTIAL
→ retry failed only
→ final result
```

## CJ-07 Knowledge Gap

```text
known methods fail
→ bounded AI-assisted discovery
→ validation
→ result or explicit bounded failure
```

## CJ-08 Model Offline

```text
model unavailable
→ ordinary + known collection still work
→ unknown case bounded failure
```

## CJ-09 Scope Safety

```text
user requests current page
→ page links to thousands of related pages
→ xDownload does NOT expand beyond selected scope
```

---

# 52. Organization as Product Value

xDownload 的价值不止是找到并传输资源。

对 CollectionIntent，组织能力属于核心体验：

```text
Discover
→ Select
→ Acquire
→ Validate
→ Organize
```

系统应尽可能利用可信 metadata 生成：

- human-readable filename；
- collection directory；
- chapter/item ordering；
- resource grouping。

如果 metadata 不可信或冲突，应保守处理并允许用户修改。

---

# 53. xDownload / General Crawler Boundary Test

任何新增功能都必须回答：

1. 是否由明确 AcquisitionIntent 触发？
2. 是否存在有限 Resource/Collection 目标？
3. 是否存在显式 stopping condition？
4. Navigation 是否只是完成 Intent 所必需？
5. 用户是否能理解当前 scope？
6. 达到 scope 后是否确定停止？

如果主要答案为否，该能力更属于 crawler domain，而不是 xDownload 核心。

未来若需要通用网页发现、持续采集、递归 crawling，可通过专门 crawler 服务协作，而不是继续扩大 xDownload Harness 边界。

---

# 54. v0 Release Thesis

v0.2 建议验证四个用户价值：

### A. Strong Basic Downloader

普通下载必须日常可用。

### B. Smart Current-page Acquisition

用户不需要手动寻找真实资源 URL。

### C. Bounded Collection Acquisition

对明确页面/playlist/gallery/有限分页，用户可以用少量操作批量发现、选择、下载并整理资源。

### D. Bounded AI Fallback

未知复杂页面可使用 AI，但有 scope、budget、validation 和 deterministic fallback。

---

# 55. Monorepo Product Boundary

项目继续按单一 monorepo 规划。

逻辑边界更新为：

```text
xdownload/
├── apps/
│   ├── desktop/
│   └── browser-extension/
├── cli/
├── packages/
│   ├── domain-contract/
│   ├── harness-core/
│   ├── domain-state/
│   ├── acquisition-intent/
│   ├── resource-model/
│   ├── collection-model/
│   ├── knowledge/
│   ├── recipe/
│   ├── decision/
│   ├── constraints/
│   ├── validation/
│   └── evidence/
├── tools/
│   ├── browser-observer/
│   ├── bounded-navigation/
│   ├── http/
│   ├── hls/
│   ├── dash/
│   ├── media/
│   └── filesystem/
└── knowledge/
    ├── protocols/
    ├── players/
    ├── providers/
    ├── collections/
    ├── pagination/
    ├── sites/
    └── failures/
```

这只是产品边界假设，不是 L2 Architecture Freeze。

---

# 56. Open Product Decisions

进入 Product Freeze 前至少需要解决：

1. Desktop 首发平台；
2. CLI 与 Desktop Runtime/daemon 关系；
3. standalone CLI 是否 P0；
4. Chromium browser integration 范围；
5. Current-page collection 是否默认展示或显式触发；
6. playlist/gallery 如何判定为“明确 collection”；
7. bounded pagination 默认 max_pages/max_items；
8. Collection Preview 是否所有批量场景强制出现；
9. nested collection v0 支持深度；
10. authenticated collection 是否进入首发；
11. media subtitles/multi-track 支持层级；
12. local/cloud/user-provided model 策略；
13. 公共 Recipe Registry 时机；
14. telemetry 默认策略；
15. collection organization 的自动命名覆盖范围。

不得由实现自行默认为最终产品决策。

---

# 57. PRD Acceptance Before Product Freeze

Product Freeze 前至少冻结：

- G0/G1 Product Experiment 设计；
- Single vs Collection 产品语义；
- AcquisitionIntent / ExplorationScope 产品合同；
- v0 support matrix；
- UI Critical Journeys；
- CLI behavior contract；
- Task/Collection state semantics；
- Collection Preview 与 scope UX；
- Exploration Budget；
- Navigation Constraints；
- Validation success/failure；
- Collection completeness semantics；
- AI budget/stop/fallback；
- credential/data boundary；
- Natural / Collection / Hard / Holdout corpus；
- explicit non-goals。

---

# 58. Final Product Position

xDownload 对用户不是：

> 一个爬虫平台。

也不是：

> 一个只能输入 URL 的传统下载器。

也不是：

> 一个展示 LLM 嗅探能力的实验。

用户看到的是：

> **一个帮助用户发现、选择、批量获取、验证并整理自己能够访问的网络资源的智能下载工具。**

Crawler-like capabilities 是 Harness 的受限 Tools；Collection / Pagination 等是 Domain Knowledge；Scope 是 Constraint；用户真正表达的是 AcquisitionIntent。

这使 xDownload 有机会从传统：

```text
URL → Download
```

升级为：

```text
“我要这些东西”
→ 找到
→ 选对
→ 全部获取
→ 验证
→ 整理好
```

同时通过明确 stopping condition 保持与 General Crawler 的边界。

---

# PRD Terminal

```text
Product: xDownload
Primary value: Convenient, reliable, intelligent resource acquisition
User mental model: Download tool, not crawler
Primary UI: Desktop application
Automation surface: CLI
Browser integration: Core
Single-resource download: P0
Current-page smart discovery: P0
Bounded Collection Acquisition: Core Product Experiment
General-purpose crawling: NON-GOAL
AcquisitionIntent: SingleResourceIntent | CollectionIntent
ExplorationScope: Required for bounded collection/navigation
Harness: Core internal product architecture thesis
Crawler-like capabilities: Bounded Harness Tools only
LLM: Knowledge-gap and semantic-resolution fallback
Recipe: Validated reusable knowledge
Shared Recipe Registry: Optional enhancement, non-blocking
Validation: P0
Collection membership/completeness validation: P0 for supported collection claims
Security / credential boundary: P0
AI dependence for ordinary download: NOT ALLOWED
Unbounded navigation: NOT ALLOWED
Product Freeze: NOT YET
Architecture Freeze: NOT YET
Next stage: Product Experiment + Fresh Independent PRD Review, then Product Freeze if gates are satisfied
```