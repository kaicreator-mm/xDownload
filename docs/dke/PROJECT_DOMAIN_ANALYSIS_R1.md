# xDownload — DKE 项目与领域分析 R1：证据化深化

> **SCOPE_CANDIDATE_R1 / NOT_KNOWLEDGE_QUALIFIED**；日期 2026-11-10。研究分支 `dke/domain-scope-r0` 从 `main@e904f08c478b15147b1c07fbe53c610d2d81851f` 创建。保留 [R0](PROJECT_DOMAIN_ANALYSIS_R0.md) 原始领域范围；本文是**可复核的增量细化**，不是独立创建一份同名领域真相。已读真实代码/现有测试文本，但未运行测试或逐行完成整个代码库的扫描。
>
> 主题：**有界数字资源识别、收集、传输和结果验证**。此处说的是项目含有哪些 DKE 知识候选，而非产品是否已交付成功，更不是所有专业知识的真实性证明。

## 一、候选知识领域/子领域/边界

| 领域 Context | 具体知识、关系、过程 | 领域所有者与外部边界 |
| --- | --- | --- |
| 资源/集合身份 | AcquisitionIntent、Single/Collection、目标与成员 | xDownload 任务语义拥有 |
| 采集/续页/授权边界 | RequestedScope、ContinuationScope、ExplorationPermission、AuthorizedContext | 产品自身限定，浏览器认证由 Host 受限提供 |
| 传输与结果 | Acquire/Resume/Validate/Organize、多层结果语义 | 项目处理业务结果，通用网络技术仅外部依赖 |
| 模板知识演化 | Recipe/SitePattern、失效与重新确认 | 用户授权和站点变化限定模板适用性 |

**Element 原则**：上表 Context 是知识范围入口，不自动映射为一个 Element、函数或 Package。全局约束需要明确 owner 与反例；1 个 Claim 不对应 1 个 Element。资料冲突时保存状态及来源，不凭 LLM 置信度抢夺行业权威。

## 二、证据来源（精确输入与阅读边界）

| 类别 | 来源 | Blob / 状态 | 当前能证明 |
| --- | --- | --- | --- |
| 主要代码 | [`packages/domain-contracts/src/contract.ts`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/packages/domain-contracts/src/contract.ts) | `eb49defb40557ca9189daee20f6b3e1f475226b2` | 该提交的实现/业务契约 |
| 对应测试 | [`packages/domain-contracts/test/contract-scope.test.ts`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/packages/domain-contracts/test/contract-scope.test.ts) | `6e263c7520f0123f4daf9ee585d1530d47e2b026` | 已定义的断言、负例；**未在本轮执行** |
| 产品文档 | [`docs/product/PRD-v0.4.1-review-candidate.md`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/docs/product/PRD-v0.4.1-review-candidate.md) | 完整 Blob 待 SC01 对齐 | 项目规定的期望，不等于外部专业事实 |

本分支 R1 中只引用源数据，不复制凭据、用户信息或受限制的第三方内容。一个引用来源的文件路径若将来变化，必须重新绑定新的精确 Git Blob 并记录原来的历史结论。

## 三、待抽取的结构化知识候选（不是已晋升知识）

| 编号 | 可验证的具体候选 | 来源类别 | 线索 | 必须能识别的失败/反例 |
| --- | --- | --- | --- | --- |
| XD-01 | 已确认 requested_scope 不可原位改变，改变须创建 successor contract | PROJECT_POLICY | contract.ts/contract-scope.test.ts | 确认集合 1-2 页后静默扩至 1-50 页 |
| XD-02 | 集合成员与续页必须由明确权限边声明，不能作为任意 crawler frontier | PROJECT_POLICY | ExplorationPermission 定义 | 跟随网站外任意链接继续收集 |
| XD-03 | 任务结果不能压缩成单一 success boolean | PROJECT_POLICY | ResultPolicy requireMultidimensionalResult | 仅传输完成却暗称内容可用 |
| XD-04 | main 合并版本 v0.2.2 后仍需区分真实安装 Chrome/Windows 成果 | EVIDENCE_STATUS | Issue #397/#394 | 无真实工具栏交互验证却标记已具备 |

知识候选后续需要 `id`、`source SHA + locator`、`kind`、`predicate/subject/object`、`applicability`、`review status`、`evidence/contradiction`、`scope owner`、`consumer impact`。以上 PROJECT_POLICY / IMPLEMENTATION_BEHAVIOR / EVIDENCE_STATUS / EXTERNAL_DOMAIN_CLAIM_CANDIDATE 是候选性质标签，**不是 DKE 已批准的规范 enum**，避免另造正式 schema。

## 四、Competency Questions 与负面测试

| CQ | 需要回答 | 核心反例/拒绝条件 |
| --- | --- | --- |
| CQ1 | 当前 URL/资源是否在已确认授权与集合范围内？ | 用户确认的是一页却抓取全站 |
| CQ2 | 文件传输完成但校验失败，是否为真正完成？ | 结果维度不能合并 |
| CQ3 | 网站页面变化后 Recipe 可继续使用吗？ | 匹配规则漂移造成错误目标 |

每个 CQ 应在产生图谱后逐个证明它由正确 Scope 中的 source/claim/relation 回答；全局聚合引用完备不等于本 Scope 的 CQ 真正可答。来源缺失、修订、适用范围不符必须 UNKNOWN 或 STALE，不给虚假的 SUCCEEDED。

## 五、可并行继续做的两个实事

1. 枚举 domain-contracts/test 下集合范围、证据、结果状态的测试并固定真实代码路径。
2. 以有权访问的单文件+显式集合+签名 URL 过期三类样本验证适用边界；不得执行未经授权的真实下载。

本轮的深度边界：**单条代表性源码 + 一条真实测试源码 + 相关 PRD/README 入口**；尚未完成所有核心模块目录逐文件抽取、外部可靠性调查、模型/人工独立审核、知识冲突裁决、跨版本消费者归因。不能因文件读回成功宣称 DKE Conformance PASS。

`DOMAIN_SCOPE_CANDIDATE=YES`；`FULL_CORPUS=NOT_BUILT`；`SCHEMA_ADOPTED=NO`；`ELEMENT_FREEZE=NO`；`SAP_QUALIFIED=NO`；`DIS_PACKAGE=NOT_GENERATED`。

## 六、统一协调入口

DKE 证据/验证方法仍以 [domain-forge #209](https://github.com/kaicreator-mm/domain-forge/issues/209) 作为唯一主索引。未来正式知识生产需先建立源有效期、外部权威映射、知识候选资格及失效反例；不得与原项目的业务 Product/L1 决策混并。