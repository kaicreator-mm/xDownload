# xDownload — Five-stage business/domain preparation R2

> 2026-11-10 · [devkit Issue #5](https://github.com/kaicreator-mm/devkit/issues/5) · **BOUNDED BUSINESS MODEL CANDIDATE / NOT DKE QUALIFIED**. 现有 [R0](PROJECT_DOMAIN_ANALYSIS_R0.md) / [R1](https://github.com/kaicreator-mm/xDownload/blob/06f7665cb0229324953259fe38ed64cf7c635452/docs/dke/PROJECT_DOMAIN_ANALYSIS_R1.md) 保留。清单固定来源 `e904f08c478b15147b1c07fbe53c610d2d81851f`，参见 [SOURCE_PATH_INVENTORY_R2.json](https://github.com/kaicreator-mm/xDownload/blob/c2e10a2de2254d0011cc92e46ad3b45a6998e356/docs/dke/SOURCE_PATH_INVENTORY_R2.json)。**全路径/Blob 枚举 ≠ 全源内容审计 ≠ 运行/语义资格**。

## G1 — 项目目标

为用户提供有边界、可确认的单资源或集合获取：识别资源、锁定范围、按权限继续页码、传输验证与整理；不演化成无限制爬虫。

**参与者与职责**：用户／Browser Extension & Native Host／资源站授权上下文／Acquisition/Validation 业务域／版权与平台条款提供方。

**成功判据候选**：真实用户能在明确目标/适用条件下沿业务闭环获得带来源且不虚报结果的产物；业务实际完成、专业正确性和发布资格仍需独立证据。非目标是替代现有 Product 事实源、任意共享跨产品业务真相、自动生成未经来源审核的行业结论。

## G2 — 完整业务体系候选

### 目标导向业务过程
1. 用户发起 Single 或 Collection Intent 并明确 RequestedScope/目标
2. 识别候选资源/集合成员、歧义由用户确认
3. 用户明确授权的 ContinuationScope/ExplorationPermission 允许有限续页
4. 传输过程中记录 Acquire/Resume/Failure 与来源有效期
5. 下载完成后单独校验内容、命名与文件组织，不能只凭 HTTP 成功
6. 需求 Scope 变化创建 successor contract，保留前一次用户确认与结果追溯

### 业务对象、状态/关系和所有权
- AcquisitionIntent/RequestedScope（确认后不可原位静默扩展）
- AuthorizedContext/ExplorationPermission/ContinuationScope
- Resource/CollectionItem/Candidate/Disambiguation
- Transfer/Validation/Organization 的多维 Outcome
- Recipe/SitePattern/Version 与站点变化后的失效

### 关键异常及恢复路径
- 确认抓两页却不询问而扩展到五十页
- 从一条已授权链接继续任意跨域递归采集
- 仅文件传输结束就宣称内容有效且完成真实浏览器安装链

当来源过期或缺失、用户未批准、外部依赖失败、结果无法确认时，应保留 `UNKNOWN / NEEDS_REVIEW / BLOCKED` 与继续核查/安全恢复的明示动作，而不是自动推进至业务完成。上述模型仅对主要产品旅程的计划覆盖，不声明所有业务源和例外已被逐文件核验。

## G3 — 领域体系候选

**跨域归属纪律**：xDownload 拥有受限采集意图与多维结果；Browser/Host 提供技术权限；资源站、版权方与网站条款决定外部授权；Shun 可以作为显式 Provider 消费但不接管 RequestedScope 真相。

## 一、候选知识领域/子领域/边界

| 领域 Context | 具体知识、关系、过程 | 领域所有者与外部边界 |
| --- | --- | --- |
| 资源/集合身份 | AcquisitionIntent、Single/Collection、目标与成员 | xDownload 任务语义拥有 |
| 采集/续页/授权边界 | RequestedScope、ContinuationScope、ExplorationPermission、AuthorizedContext | 产品自身限定，浏览器认证由 Host 受限提供 |
| 传输与结果 | Acquire/Resume/Validate/Organize、多层结果语义 | 项目处理业务结果，通用网络技术仅外部依赖 |
| 模板知识演化 | Recipe/SitePattern、失效与重新确认 | 用户授权和站点变化限定模板适用性 |

**Element 原则**：上表 Context 是知识范围入口，不自动映射为一个 Element、函数或 Package。全局约束需要明确 owner 与反例；1 个 Claim 不对应 1 个 Element。资料冲突时保存状态及来源，不凭 LLM 置信度抢夺行业权威。

上述 Context 是语义归属候选而非一个 Context = 一个 Element/Package；共享术语/数据引用不转移事实的拥有者；领域关系可有环，实际执行依赖 DAG 必须另行定义。

## G4 — 领域知识范围与具体 Claim 候选

## 三、待抽取的结构化知识候选（不是已晋升知识）

| 编号 | 可验证的具体候选 | 来源类别 | 线索 | 必须能识别的失败/反例 |
| --- | --- | --- | --- | --- |
| XD-01 | 已确认 requested_scope 不可原位改变，改变须创建 successor contract | PROJECT_POLICY | contract.ts/contract-scope.test.ts | 确认集合 1-2 页后静默扩至 1-50 页 |
| XD-02 | 集合成员与续页必须由明确权限边声明，不能作为任意 crawler frontier | PROJECT_POLICY | ExplorationPermission 定义 | 跟随网站外任意链接继续收集 |
| XD-03 | 任务结果不能压缩成单一 success boolean | PROJECT_POLICY | ResultPolicy requireMultidimensionalResult | 仅传输完成却暗称内容可用 |
| XD-04 | main 合并版本 v0.2.2 后仍需区分真实安装 Chrome/Windows 成果 | EVIDENCE_STATUS | Issue #397/#394 | 无真实工具栏交互验证却标记已具备 |

知识候选后续需要 `id`、`source SHA + locator`、`kind`、`predicate/subject/object`、`applicability`、`review status`、`evidence/contradiction`、`scope owner`、`consumer impact`。以上 PROJECT_POLICY / IMPLEMENTATION_BEHAVIOR / EVIDENCE_STATUS / EXTERNAL_DOMAIN_CLAIM_CANDIDATE 是候选性质标签，**不是 DKE 已批准的规范 enum**，避免另造正式 schema。

显式区分 `PROJECT_POLICY` / `IMPLEMENTATION_BEHAVIOR` / `OBSERVED_CASE` / `EXTERNAL_DOMAIN_CLAIM_CANDIDATE` / `LLM_CANDIDATE`。知识记录至少应含 Git SHA/Blob/locator、origin/许可、Scope/Context、owner、适用版本/时间、证据、反例、未知、冲突、独立 reviewer 和下游 invalidation；框架/模型/模拟测试并非行业权威。

## G5 — DKE 抽取准备

### SC01/SC02 权威版本与全路径源清单

- 当前分析 pin：[`e904f08c478b15147b1c07fbe53c610d2d81851f`](https://github.com/kaicreator-mm/xDownload/tree/e904f08c478b15147b1c07fbe53c610d2d81851f)，不是自动证实无后续活跃版本。
- [R2 全 Git 跟踪路径与 Git Blob SHA](https://github.com/kaicreator-mm/xDownload/blob/c2e10a2de2254d0011cc92e46ad3b45a6998e356/docs/dke/SOURCE_PATH_INVENTORY_R2.json) 已生成，分类仅按路径启发式，**尚未逐项筛成专业知识相关来源清单或取得每份内容使用许可**。
- 代表性业务代码、测试/第二见证 exact Blob 见 [R1](https://github.com/kaicreator-mm/xDownload/blob/06f7665cb0229324953259fe38ed64cf7c635452/docs/dke/PROJECT_DOMAIN_ANALYSIS_R1.md)。进一步的现行 Product/分支/PR/Tag 校准及每来源影响分析必须有独立校验记录。

### SC03 文档—代码—测试有界核对

R1 对 contract.ts/contract-scope.test.ts 的 scope successor 和 ResultPolicy 有明确源码/测试定义；真实 Chrome Toolbar+Native Host+Windows 安装验证仍没有可复用的当前资格证明。

当前状态 `BOUNDED_R1_SOURCE_TEST_TEXT`，不是全业务源 `DOC_CODE_TEST_MATRIX`，也不是测试结果。未检查的对应关系必须保持 `DOC_ONLY / CODE_ONLY / UNKNOWN`，冲突则为 `CONFLICT`，需要专业来源则 `EXTERNAL_ORACLE_REQUIRED`。

### SC04 CQ、反例与验证方案

1. 用户确认的 collection scope 应如何调整而不越权？
2. 浏览器登录上下文无法继续时能否自动在其它站点拓展探索？
3. 传输完成但文件校验失败时多维结果如何报告？

对每条 CQ 必须有一条固定源码/权威资料的正例、一条缺源、一条过期或冲突、一条错误归属/非法晋升反例；保留 `ABSTAIN/UNKNOWN`，独立 Reviewer 不能只是同一模型自我重述。候选最小包需 3–5 个 Claim、1 个跨 Context Relation、2–3 个 CQ 和真实 failure case，作为 [domain-forge #209](https://github.com/kaicreator-mm/domain-forge/issues/209) 的受限输入。

### SC05 阶段阻塞和权限界线

需复核活跃 v0.2.2 的 PR #396 代码与 RQ #394 开放状态、站点条款/授权和真实浏览器/下载样本；不能因合并 main 认定产品可用。

**验收判定**：`G1=STRUCTURED_CANDIDATE`；`G2=BUSINESS_MODEL_CANDIDATE`；`G3=CONTEXT_CANDIDATE`；`G4=CLAIMS_AND_CQ_CANDIDATE`；`G5=PATHS_ENUMERATED_ONLY`；`EXTRACTION_READY=NO`；`INDEPENDENT_ORACLE=NOT_RUN`；`SAP_QUALIFIED=NO`；`ELEMENT_FREEZE=NO`；`DIS_PACKAGE=NOT_GENERATED`。

**后续推进**：对全路径机器清单做人工领域源筛选、业务全链 DOC↔CODE↔TEST 核对、真实反例与独立专业资料来源准入；再将本项目源证据包交给 domain-forge #209，且只在 [devkit #5](https://github.com/kaicreator-mm/devkit/issues/5) 更新经过真正验收的 G1..G5 状态。
