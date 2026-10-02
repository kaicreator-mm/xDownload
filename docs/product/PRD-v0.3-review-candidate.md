# xDownload PRD v0.3 — Review Candidate

**Product:** xDownload  
**Document status:** PRD Review Candidate  
**Product Freeze:** NO  
**Architecture Freeze:** NO  
**Supersedes:** `PRD-v0.2-draft.md` as the current product contract candidate  
**Review baseline:** `2026-10-02-v0.2-fresh-independent-adversarial-review.md`  
**Date:** 2026-10-02

---

# 1. Product Definition

xDownload 是一个以桌面 UI 为主要交互入口、同时提供 CLI 与浏览器集成的智能下载工具。

产品目标不是“全自动 AI 下载”，也不是“通用爬虫”，而是：

> **让用户更方便、更可靠、更低操作成本地发现、选择、获取、验证并整理自己明确想要且有权访问的网络资源。**

xDownload 内部采用 **Download Domain Harness**：

- 下载引擎、Browser Observer、媒体工具、文件系统、受限导航能力属于 **Tools**；
- 协议、播放器、Collection Pattern、Pagination Pattern、Gallery Pattern、Listing Pattern、Failure Pattern、Recipe 属于 **Knowledge**；
- Harness 根据 AcquisitionIntent、AcquisitionContract、State、Knowledge、Constraints、Evidence 和 Validation 决定执行路径；
- 已知模板与确定性方法优先；
- 用户确认是正常的一等产品路径；
- LLM 只处理知识缺口、模板适配与少量语义歧义；
- AI 产生的候选结果必须经过独立于发现推断的证据验证，才能成为可复用 Knowledge。

---

# 2. Product Principles

## 2.1 Product value first

优先级：

```text
正确获取目标
>
可靠和可恢复
>
低认知/操作成本
>
快速反馈
>
自动化程度
>
AI 使用
>
Knowledge 复用
>
跨用户 Recipe 网络
```

不得为了证明 Harness、AI、Crawler-like 能力或 Recipe 网络而牺牲基础下载体验。

## 2.2 Minimum Necessary Intelligence

xDownload SHOULD 使用能够正确完成当前任务的最低复杂度机制。

默认优先级：

```text
Deterministic direct path
→ Known Template / Recipe
→ Template + user confirmation
→ LLM-assisted template adaptation
→ Bounded exploratory reasoning
→ Explicit UNKNOWN / UNSUPPORTED
```

LLM 不是默认执行器。

## 2.3 Minimum Necessary Interaction

xDownload SHOULD 只在用户输入能够实质解决以下问题时请求用户参与：

- 目标歧义；
- Collection membership 歧义；
- Scope 歧义；
- 授权/登录；
- 结果正确性无法可靠自动确认。

原则：

```text
Automation is preferred.
User confirmation is allowed.
Silent guessing is not.
```

## 2.4 Template-first Acquisition

下载领域默认被视为**有限模式空间 + 参数变化 + 少量未知情况**，而不是通用 Web Agent 问题。

首批模式包括：

```text
Direct File
Current-page Attachment
Direct Media
HLS VOD
DASH VOD
Gallery
Playlist
Listing + Pagination
Embedded Player
Authenticated Resource
Signed URL
Separated Audio/Video
```

---

# 3. Product Surfaces

- **Desktop UI**：普通用户主入口。
- **Browser Integration**：接管下载、观察当前页面、提供当前 page/profile/session context。
- **CLI**：first-class automation surface，支持脚本、批处理和 Agent 工作流。
- **Future**：REST/API、MCP、SDK、remote worker；不进入当前 Product Freeze 条件。

UI、CLI、Browser Integration 原则上共享同一 Acquisition runtime 与任务语义。

---

# 4. AcquisitionIntent

顶层用户意图统一为：

```text
AcquisitionIntent
├── SingleResourceIntent
└── CollectionIntent
```

## 4.1 SingleResourceIntent

用户要求获取一个明确资源，例如：

- 一个文件；
- 当前播放的视频；
- 一个 PDF；
- 一个明确媒体资源。

## 4.2 CollectionIntent

用户要求获取一组具有**明确成员关系**的资源，例如：

- 当前页面的全部附件；
- 一个明确 gallery 的全部图片；
- 一个明确 playlist 的视频；
- 一个明确 listing 的前 3 页；
- 用户显式选择的 20 个链接。

CollectionIntent 不等同于“有限爬取”。

---

# 5. Acquisition Admission Contract

CollectionIntent 只有在以下条件**全部成立**时才能进入 bounded collection acquisition：

1. **Target collection identifiable**：目标 Collection 可被明确标识；
2. **Membership relation observable or user-declared**：成员关系可观察，或由用户显式声明；
3. **Traversal limited to collection/member/continuation edges**：导航只沿 Collection 成员、成员详情页或明确 continuation edge 进行；
4. **Scope understandable to user**：用户能够理解将获取什么范围；
5. **Hard stopping condition exists**：存在硬停止条件；
6. **No arbitrary discovery frontier**：不得创建任意 URL frontier。

以上为逐项必要条件，不得以“多数满足”替代。

## 5.1 Explicitly out of scope

即使用户显式请求，下列请求仍不属于 xDownload Collection 模式：

- “遍历该域名前 1000 页并下载所有 PDF”；
- 任意同域链接递归；
- 全站镜像；
- 持续站点监控；
- 通用网页索引；
- 通用 scraping / crawling。

原因不是规模太大，而是缺少明确 Collection membership relation。

---

# 6. AcquisitionContract

每个非简单直链任务必须形成一份可理解的 AcquisitionContract：

```text
AcquisitionContract
├── Intent
├── AcquisitionTarget
├── CollectionIdentity (optional)
├── Scope
├── SelectionPolicy
├── ExplorationPermission
├── LifecycleBudget
├── SelectionSnapshot
├── StopPolicy
└── ResultSemantics
```

UI 和 CLI 必须表达同一份语义合同。

---

# 7. Scope、Selection 与 Budget 必须分离

三者含义不同：

## Scope

用户要求的目标范围，例如：

```text
当前页面
当前 gallery
当前 playlist
listing pages 1..3
用户选择的 5 项
```

## Selection

用户或系统从已确认成员中选择哪些资源进入获取目标。

## LifecycleBudget

执行安全上限，例如：

- max elapsed time；
- max navigation steps；
- max model calls；
- max probe count；
- max requests；
- optional monetary budget。

Budget 不是目标范围，也不能把 Scope 静默缩小。

如果用户 Scope 与 Budget 冲突，系统必须明确返回 PARTIAL / NEEDS_USER_ACTION，而不是把截断结果包装成完整成功。

---

# 8. Collection Sets

Collection 任务至少区分以下集合：

```text
C = CandidateSet
    系统发现到的候选

M = ConfirmedMemberSet
    有足够证据支持其属于目标 Collection 的成员

S = SelectedTargetSet
    用户最终要求获取的成员

A = AcquiredValidatedSet
    已正确获取并通过目标/格式/传输验证的成员
```

数量相等不能替代 identity/membership 对应关系。

例如：

```text
C = 30
M = 18
S = 5
A = 5
```

可以声明“用户选择的 5 项全部完成”，但不能声明原 Collection 已完整获取。

---

# 9. SelectionSnapshot

Preview/Selection 之后必须冻结用户选择语义。

SelectionSnapshot 至少包含产品级身份：

```text
root identity
collection identity
selected member identities
source/profile context
selection timestamp/version marker
```

要求：

- 执行、resume、retry 必须绑定原 SelectionSnapshot；
- `retry failed` 只能重试原 snapshot 中失败的成员；
- 重新枚举、新增成员、扩大 Scope 必须是新的显式动作；
- Collection 增删、重排、profile 切换导致身份无法重确认时，不得静默漂移。

---

# 10. Automation Modes

用户参与是正式能力，不是失败降级。

```text
AUTO
ASSISTED
MANUAL_SELECTION
```

## AUTO

系统有足够独立证据自动确认目标、成员和 Scope。

## ASSISTED

系统已完成主要机械工作，但存在少量关键歧义，需要用户做低成本确认。

例如：

- 原图 vs 缩略图；
- 主视频 vs preview；
- 两个候选合集；
- 登录 profile 选择。

## MANUAL_SELECTION

系统能可靠发现并展示候选，但不应代替用户做语义选择。

例如：

- 用户从 18 个候选中勾选 12 个；
- 用户确认“只下载视频和 PDF”。

用户确认可作为强 TargetEvidence / SelectionEvidence。

---

# 11. Browser Observer and Bounded Navigation

Browser Observer 是 Harness Tool。

允许：

```text
observe_page()
observe_network()
observe_player()
observe_frames()
collect_candidate_resources()
scroll_current_page()
follow_collection_continuation()
open_confirmed_member_detail()
```

不提供通用：

```text
crawl(url)
recursive_discover()
follow_arbitrary_links()
```

导航动作必须能追溯到 AcquisitionContract 中的 Collection/member/continuation relation。

---

# 12. Lifecycle Budget

Budget 属于整个 Acquisition 生命周期，而不是某一次 attempt。

以下行为默认继承剩余 Budget：

```text
retry
restart
resume
AI repair
UI/CLI concurrent access
```

不得通过重试、repair 或入口切换隐式刷新预算。

只有用户显式扩大 Scope 或 Budget，才能增加总预算，并记录为 AcquisitionContract 变更。

系统必须识别并停止：

- pagination loop；
- repeated page；
- no-progress traversal；
- repeated identical probe；
- unresolved continuation；
- budget exhaustion。

停止后，已冻结 SelectedTargetSet 中可安全继续的下载可以继续；探索不能无限恢复。

---

# 13. Result Semantics

任务生命周期、选中目标获取状态和 Collection Coverage 是三个不同维度。

## 13.1 AcquisitionStatus

```text
COMPLETE
PARTIAL
FAILED
CANCELLED
NEEDS_USER_ACTION
```

表示 SelectedTargetSet 的获取结果。

## 13.2 CoverageStatus

```text
VERIFIED_COMPLETE
VERIFIED_SUBSET
UNKNOWN
TRUNCATED
```

表示对原目标 Collection 的覆盖认知。

## 13.3 StopReason

至少包括：

```text
NATURAL_COLLECTION_END
USER_SCOPE_REACHED
USER_SELECTION_COMPLETE
BUDGET_EXHAUSTED
NO_PROGRESS
AUTH_REQUIRED
TARGET_CHANGED
COLLECTION_CHANGED
UNSUPPORTED
USER_CANCELLED
```

## 13.4 Example

用户仅选择 5 项且全部完成：

```text
AcquisitionStatus = COMPLETE
CoverageStatus = VERIFIED_SUBSET
```

发现 18 项并全部下载，但全集无法证明：

```text
AcquisitionStatus = COMPLETE
CoverageStatus = UNKNOWN
```

用户要求 pages 1..3，但 Budget 在 page 2 耗尽：

```text
AcquisitionStatus = PARTIAL
CoverageStatus = TRUNCATED
StopReason = BUDGET_EXHAUSTED
```

CLI 不得只返回 `completed` 而省略 CoverageStatus 和 StopReason。

---

# 14. Completeness Contract

“全部完成”必须明确是针对哪个集合。

## 14.1 Selected target completeness

如果且仅如果：

```text
A identity-matches S
```

且所有 SelectedTarget 均成功获取并验证，才能声明 SelectedTargetSet 完成。

## 14.2 Collection completeness

只有存在覆盖**同一个目标 Collection** 的独立证据时，才能声明 `VERIFIED_COMPLETE`。

可接受证据示例：

- 已知明确成员 identity 列表，且全部对应成功；
- declared_total 与唯一 member identity 一致，并且 continuation chain 已被自然终止证据闭合；
- 用户显式定义有限成员集合，且该集合全部完成。

以下不能单独证明全集完整：

- `max_items` 达到；
- max_pages 达到；
- timeout；
- budget exhausted；
- page failed；
- next control 未加载；
- pagination loop；
- 仅 count 相等但 identity 不一致；
- “未发现更多”但缺少自然终点证据。

---

# 15. Evidence Model

至少区分：

```text
DiscoveryEvidence
TargetEvidence
MembershipEvidence
SelectionEvidence
TransferEvidence
FormatEvidence
CoverageEvidence
ValidationProvenance
```

同一个推断不能既生成 Target/Membership assertion，又作为唯一验证依据证明自己正确。

---

# 16. Target and Membership Validation

## 16.1 Independent evidence requirement

语义验证必须依赖独立证据或用户确认，例如：

- explicit resource ID；
- explicit collection member record；
- attachment label 与 target identity；
- thumbnail → declared original href；
- playlist item ID；
- manifest/resource identity；
- user-confirmed candidate；
- independent test oracle / blind-labeled truth。

## 16.2 Insufficient evidence

证据不足时允许：

```text
TARGET_PROBABLE
MEMBERSHIP_PROBABLE
NEEDS_CONFIRMATION
UNKNOWN
```

不得为了追求全自动而升级为已验证成功。

## 16.3 User confirmation

用户明确确认某候选时，该确认可成为 TargetEvidence / SelectionEvidence；随后 deterministic validation 只需要证明实际下载资源与用户确认的 Resource identity 一致。

---

# 17. Validation Layers

Validation 是 P0。

必须分层：

## Transfer Validation

- expected bytes；
- range completeness；
- checksum when available；
- segment completeness。

## Format Validation

- MIME；
- container parseability；
- archive/document validity。

## Media Validation

- expected tracks；
- duration；
- codec；
- audio/video presence；
- manifest consistency。

## Target Validation

确认实际获取资源是用户目标，而不是广告、preview、相邻附件、登录 HTML 或错误画质资源。

## Membership Validation

确认资源属于目标 Collection，而不是推荐项、广告项或同页无关资源。

## Coverage Validation

确认 `VERIFIED_COMPLETE` 是否有独立覆盖证据。

---

# 18. Template and Recipe Model

Recipe 不应是任意网站脚本。

默认：

```text
Recipe
=
Template
+ Matchers
+ Parameters
+ Evidence Rules
+ Validation Rules
+ Applicability Scope
+ Failure Conditions
```

例如：

```text
paginated_collection
playlist_collection
gallery_collection
current_page_attachments
embedded_player
```

Recipe 必须声明：

- 适用范围；
- 已验证 evidence；
- 失效条件；
- fallback 行为。

v0 不允许任意 shell execution 或 unrestricted browser automation。

---

# 19. Knowledge Promotion

当前版本只保证：

```text
L0 Local Candidate
L1 Local Verified
```

L1 Local Verified 必须有：

- declared applicability scope；
- supporting Evidence；
- Target/Membership correctness checks；
- known failure conditions；
- mismatch fallback。

以下暂不作为 Product Freeze 条件：

```text
L2 Shared Candidate
L3 Community Verified
L4 Trusted/Built-in network promotion
```

公共 Registry 与跨用户推广仍是可选增强。

---

# 20. Organization Semantics

自动组织属于 best-effort 增强，不得破坏资源身份与 Collection membership。

要求：

- 区分 byte dedup 与 collection-member position；
- 同一文件属于两个章节时，成员关系不得因去重消失；
- 同名不同内容不得错误合并；
- 保留 source mapping；
- 排序与章节语义不确定时保持保守，不自动宣称“正确课程顺序”；
- 用户可以调整命名/目录；
- 查找、纠错和重新整理成本计入 Collection Increment。

---

# 21. CLI Contract

CLI 必须区分：

```text
accepted
running
needs_user_action
complete
partial
failed
cancelled
```

机器可读结果必须能够表达：

```text
intent summary
selected target count
known expected count (if any)
discovered count
confirmed member count
selected count
validated success count
AcquisitionStatus
CoverageStatus
StopReason
```

Submit mode 与 Wait mode 语义必须分开；退出状态不能把“提交成功”与“最终获取完成”混为一谈。

非交互模式遇到 NEEDS_USER_ACTION 必须有界退出。

---

# 22. UI Contract

UI 必须支持：

```text
Add / Paste / Browser handoff
→ optional Scope confirmation
→ Collection Preview (when needed)
→ AUTO / ASSISTED / MANUAL_SELECTION
→ Acquisition
→ Validation
→ Result with Coverage semantics
→ Open / Organize / Retry failed
```

对于单一明确资源，不应强制复杂 Scope/Preview。

对于小任务，Collection UI 不得造成明显体验退化。

---

# 23. Support Slices

不再以“支持整个协议/整个 Collection 类别”做模糊承诺。

## Release P0 candidates

```text
S1 Direct HTTP/HTTPS file
S2 Browser direct download handoff
S3 Current-page explicit attachment
S4 Direct video/audio
S5 HLS VOD within declared supported rendition slice
```

## Conditional / dependent slices

```text
S6 DASH VOD requiring separate audio/video mux
S7 authenticated resources
S8 multi-audio / subtitle processing
S9 cross-origin collection member acquisition
```

## Collection Product Experiment slices

```text
C-A Current-page attachments
C-B Explicit playlist / gallery
C-C Bounded pagination of an explicit listing
```

Collection Experiment PASS 不自动意味着全部 slice 进入 Release P0。

---

# 24. Explicit Non-goals

- general-purpose crawling；
- arbitrary URL frontier；
- recursive site exploration；
- full website mirroring；
- continuous site monitoring；
- general scraping/indexing；
- DRM circumvention；
- paywall/access-control bypass；
- credential theft；
- authentication cracking；
- protected key extraction；
- arbitrary executable Recipe；
- AI-first execution for ordinary supported downloads。

---

# 25. Product Gates

## G0 — Product Value

验证 xDownload 是否让用户更方便、可靠地完成支持范围内的下载任务。

必须分层报告：

- single vs collection；
- UI vs CLI；
- first use vs repeated use；
- supported vs out-of-scope。

G0 不允许用大合集资源数量淹没普通任务失败，也不允许用范围外任务直接否定已承诺能力。

## G1 — Collection Increment

拆为四个独立能力：

```text
G1a Batch Acquisition Increment
G1b Navigation Increment
G1c Semantic Selection Increment
G1d Organization Increment
```

允许部分 PASS、部分 FAIL/UNKNOWN。

如果只证明当前页批量有价值，就收缩产品结论，不得借此证明 bounded navigation 有价值。

## G2 — AI Increment

在相同 Tools、Context、Budget、Auth 条件下，与 deterministic baseline 比较。

独立真值决定目标正确性；模型自评不能作为成功标签。

## G3 — Local Knowledge Compounding

在适用范围内的新页面/新 session 上验证 Knowledge 复用；控制缓存、已下载输出与会话复用。

模型调用下降不能掩盖正确性下降。

## G4 — Shared Knowledge

可选增强 Gate。

使用独立用户/授权上下文、范围内/范围外任务、负例，验证：

- 不包含私人凭据；
- scope 不越界；
- target/membership 正确；
- coverage 声明正确；
- 不适用时有界失败。

G4 FAIL 不阻塞基础产品和已验证 Local Knowledge。

---

# 26. Collection Increment Metrics

固定正确目标集合后，至少比较：

```text
total task time
active user operation time
waiting time
correction time
failure recovery time
organization time
wrong-target rate
false-success rate
```

不能只使用：

```text
click count
items per action
raw discovered count
```

作为价值证明。

---

# 27. Experiment Design

实验分成两阶段。

## Phase A — Exploratory Experiment

允许用于：

- 建 baseline；
- 估计 variance；
- 发现真实任务分布；
- 确定合理阈值候选；
- 调整支持切片。

不得用 Phase A 同一数据同时冻结阈值并宣称确认 PASS。

## Freeze Confirmation Protocol

在独立确认数据打开前冻结：

- task list / sampling rules；
- supported slices；
- primary metrics；
- denominators；
- truth/oracle；
- baseline tool configuration；
- time/tool/context budgets；
- non-regression conditions；
- PASS / FAIL / INSUFFICIENT_EVIDENCE rules。

## Phase B — Independent Confirmation

只使用冻结协议进行独立确认。

允许结果：

```text
PASS
FAIL
INSUFFICIENT_EVIDENCE
```

样本不足不能被强行映射成 PASS 或 FAIL。

---

# 28. Capability Ablation

G1 至少进行以下能力消融：

```text
A0 single/manual batch
A1 current-page batch
A2 + bounded collection expansion
A3 + semantic filtering/selection
A4 + organization
```

要求区分：

- 无需导航也成功；
- 导航确实必要；
- 小集合不划算；
- 误选需要纠正。

每一层只能为自身增量提供证据。

---

# 29. Counterexample Corpus C01–C22

以下全部进入 Product Counterexample Corpus，当前状态为 **NOT RUN**。

| ID | Required behavior |
|---|---|
| C01 | count 相等但重复替代漏项时不得宣告全集完整 |
| C02 | pages 1..3 共 150 项、max_items=100 时必须暴露目标/预算冲突 |
| C03 | 末页失败、next 未加载、pagination loop 不得作为自然终点 |
| C04 | 无总数但明确有限列表真实到末页时，若有覆盖证据可 VERIFIED_COMPLETE |
| C05 | 仅选 5 项时可 COMPLETE + VERIFIED_SUBSET，不推断原合集完整 |
| C06 | 同域前 1000 页任意 PDF 请求拒绝 Collection admission |
| C07 | 明确列表成员需要详情页/CDN 时允许必要受限获取 |
| C08 | “前 3 页”起点、iframe、load-more 边界必须明确且 UI/CLI 一致 |
| C09 | 原图/缩略图、广告/preview 均有效时，无独立目标证据不得语义 PASS |
| C10 | public count=18、当前账号仅 16 项时说明可访问范围，不探索未授权内容 |
| C11 | Preview 后增删/重排/profile 变化时 SelectionSnapshot 不静默漂移 |
| C12 | retry failed only 不得自动新增或替换原目标 |
| C13 | restart/repair/UI+CLI 并发不得重复领取 LifecycleBudget |
| C14 | 已发现项全成功但探索范围未解析完时 CoverageStatus 不能冒充全集完成 |
| C15 | DASH 分离音视频且 mux 不支持时不得把静音视频算正确完成 |
| C16 | 小任务不得因 Scope/Preview 强制流程明显退化；大任务计入等待与恢复 |
| C17 | 单页批量与必须分页任务分开归因 |
| C18 | 内容相同但属于多个章节、同名不同内容时保持 member/source mapping |
| C19 | AI 与非 AI 使用相同 Tools/Budget/Auth/Context，独立真值评估 |
| C20 | 控制缓存/已有输出后，用范围内新页面/session 和布局变化验证 Local Knowledge |
| C21 | 独立用户/账号与个性化合集验证 Shared Knowledge scope/credential/membership |
| C22 | 样本不足时返回 INSUFFICIENT_EVIDENCE，不使用后验阈值强判 |

每个用例在执行前必须登记：

- expected target；
- allowed scope；
- expected stop；
- expected AcquisitionStatus；
- expected CoverageStatus；
- truth source。

---

# 30. Finding Closure Matrix

本 v0.3 的设计目标是关闭 v0.2 Fresh Review F01–F10，并约束 F11–F12。

| Finding | v0.3 response | Intended status for re-review |
|---|---|---|
| F01 Completeness OR weakness | C/M/S/A sets；AcquisitionStatus 与 CoverageStatus 分离；自然终点/预算截断严格区分 | CLOSE candidate |
| F02 crawler boundary weak | Membership relation + AND admission contract；禁止 arbitrary frontier | CLOSE candidate |
| F03 self-validating semantics | Independent Evidence model；user confirmation；UNKNOWN/NEEDS_CONFIRMATION | CLOSE candidate |
| F04 scope/selection/budget ambiguity | AcquisitionContract；三者分离并定义冲突规则 | CLOSE candidate |
| F05 preview drift | SelectionSnapshot；retry 不扩大选择 | CLOSE candidate |
| F06 budget reset loophole | LifecycleBudget across retries/restart/repair/entrypoints | CLOSE candidate |
| F07 final status ambiguity | AcquisitionStatus + CoverageStatus + StopReason；CLI required fields | CLOSE candidate |
| F08 support breadth | SupportSlice model；Release 与 Experiment slice 分离 | CLOSE candidate |
| F09 collection attribution | G1a–G1d + capability ablation + net cost metrics | CLOSE candidate |
| F10 post-hoc gates | Exploratory → frozen confirmation protocol → independent confirmation | CLOSE candidate |
| F11 organization semantics | 降为 best-effort；保留 member/source mapping；不宣称自动语义绝对正确 | CONSTRAINED / defer allowed |
| F12 recipe promotion scope | Product Freeze 仅要求 Local Verified scope/evidence/failure/fallback；shared promotion 后置 | CONSTRAINED / defer allowed |

实际 `CLOSED / PARTIAL / OPEN` 由下一轮 Fresh Independent Reviewer 判定，本稿不自审。

---

# 31. Product Critical Journeys

## CJ-01 Ordinary Download

```text
Paste/click URL
→ resolve
→ acquire
→ validate
→ complete
```

不依赖模型。

## CJ-02 Current-page Smart Download

```text
Open page
→ observe candidates
→ target evidence sufficient?
   ├─ yes → AUTO
   └─ no  → ASSISTED / MANUAL_SELECTION
→ acquire
→ validate
```

## CJ-03 Current-page Collection

```text
Current page
→ explicit attachment/member set
→ preview if needed
→ SelectionSnapshot
→ batch acquire
→ validate
→ COMPLETE + VERIFIED_SUBSET/VERIFIED_COMPLETE
```

## CJ-04 Explicit Playlist/Gallery

```text
Identify collection
→ prove membership relation
→ enumerate within Scope
→ optional user confirmation
→ SelectionSnapshot
→ acquire
→ coverage validation
```

## CJ-05 Bounded Pagination

```text
Explicit listing
→ confirmed continuation edge
→ Scope pages defined
→ LifecycleBudget
→ enumerate members
→ stop by natural end or user scope
→ acquire
```

任意 link frontier 不允许。

## CJ-06 Retry / Resume

```text
original SelectionSnapshot
→ retry failed original members only
→ no automatic new members
```

## CJ-07 Model Offline

```text
model unavailable
→ known direct/template paths continue
→ ambiguous unknown case → bounded UNKNOWN / NEEDS_USER_ACTION
```

---

# 32. Product Freeze Eligibility

PRD v0.3 只有在新的 Fresh Independent Re-Review 同时满足以下条件时，才可成为 Product Freeze candidate：

1. F01–F10 均为 `CLOSED`，或无 Product Freeze 阻断的等价判定；
2. F11–F12 若未关闭，Reviewer 确认当前承诺已充分收缩且非阻断；
3. 无新增 P0；
4. 新增 P1 不改变核心产品方向或可在 Product Freeze 前明确解决；
5. C01–C22 均有可判定的产品合同预期；
6. G0–G4 confirmation protocol 可冻结；
7. Reviewer 明确给出：

```text
PASS
PRODUCT_FREEZE_ELIGIBLE = YES
```

在此之前：

```text
Product Freeze = NO
Architecture Freeze = NO
L2 = NOT ELIGIBLE
```

---

# 33. Final Product Position

xDownload 对用户不是：

> 一个通用爬虫。

也不是：

> 一个必须全自动的 AI Agent。

也不是：

> 一个 Recipe 平台。

用户看到的是：

> **一个能够理解明确下载目标，用模板化能力完成大部分机械工作，在必要时让用户做少量关键确认，并在知识缺口时有限使用 AI 的智能下载工具。**

Crawler-like 能力只作为 bounded Tool 存在；其合法性来自明确 Collection membership，而不是来自“页数有限”。

Human-in-the-loop 是正常产品能力：机器负责机械发现、下载、验证与整理，人只在系统无法可靠证明目标或范围时解决少量语义歧义。

---

# PRD Terminal

```text
Product: xDownload
Primary value: convenient, correct, reliable targeted resource acquisition
Primary UI: Desktop application
Automation surface: CLI
Browser integration: Core
Task model: SingleResourceIntent + CollectionIntent
Collection admission: explicit target + provable membership + bounded traversal
General-purpose crawling: NON-GOAL
Automation policy: AUTO / ASSISTED / MANUAL_SELECTION
Intelligence policy: Minimum Necessary Intelligence
Interaction policy: Minimum Necessary Interaction
Execution strategy: Template-first
LLM: knowledge-gap / template-adaptation fallback
Validation: independent evidence required for semantic success
Completeness: AcquisitionStatus separated from CoverageStatus
Recipe scope: Local Verified required; shared promotion optional
Counterexample corpus: C01–C22 REQUIRED FOR CONFIRMATION
Product Freeze: NO
Architecture Freeze: NO
Current stage: REVIEW CANDIDATE
Next stage: Fresh Independent Product Re-Review on exact SHA
```
