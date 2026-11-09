# xDownload — 项目与 DKE 领域范围分析 R0

> 日期：2026-11-10；状态：**SCOPE_CANDIDATE / DOCUMENTATION_AND_SOURCE_SAMPLE / NOT_KNOWLEDGE_QUALIFIED**。  
> 分支：`dke/domain-scope-r0`；从 `main@e904f08c478b15147b1c07fbe53c610d2d81851f` 创建。业务/产品版本权威不因本研究分支改变。
>
> 本文用于建立后续知识抽取准备清单。已核对主要产品资料及一份代表性真实业务源码，不构成全仓逐行审计、完整源清单、独立领域专家认证、Element Freeze 或 DIS Package 资格声明。项目文档里的“应当”与源码中的“当前实现”必须区别。

## 一、项目定位与核心任务

- **产品/领域主题**：受限网络数字资源获取与结果真实性验证。
- **主要使用者**：普通桌面/浏览器用户、需要明确下载目标与机器可读结果的自动化调用者。
- **用户任务闭环**：用户想保存的资源/显式集合 → 目标发现 → 候选确认与权限 → 有界获取 → 独立校验 → 组织结果。
- **版本/事实注意事项**：main 代码已通过 PR #396 集成 v0.2.2，但 main README 的 Stage-1 v0.4.1 PRD/初版 v0.1 信息陈旧。正式范围应对照 #337/#393/#394/#397 和 v0.2.2 版本源码；主线集成≠公开分发 RQ。
- **相关代码和模块**：
- packages/domain-contracts/src/{contract,scope,evidence,ledger,result}.ts
- packages/{direct-acquisition,discovery-recipe,hls-vod-adapter,browser-observation}/
- packages/{core-scheduler,persistence-ledger,converged-runtime}/
- apps/{browser-extension,desktop}/（用户界面/宿主）

## 二、涉及领域与候选子领域

### 1. 下载意图与目标识别

单项/集合 AcquisitionIntent、逻辑目标、媒体资源/附件、候选消歧。

DKE 暂定为一个候选职责 Context；要用独立 CQ、所有权、来源和反例决定后续是否拆成 Element 或仅保留 Graph Record。

### 2. 有界集合/发现与授权

RequestedScope、ContinuationScope、CollectionMembership、UserSelection、ExplorationPermission。

DKE 暂定为一个候选职责 Context；要用独立 CQ、所有权、来源和反例决定后续是否拆成 Element 或仅保留 Graph Record。

### 3. 可靠获取与校验

链路、分块/续传、校验层、完整性、来源改变、重试停止及结果状态。

DKE 暂定为一个候选职责 Context；要用独立 CQ、所有权、来源和反例决定后续是否拆成 Element 或仅保留 Graph Record。

### 4. 下载知识与模板复用

站点/页面下载模式、Recipe、版本/适用条件、失败与经验，不扩为无界抓取。

DKE 暂定为一个候选职责 Context；要用独立 CQ、所有权、来源和反例决定后续是否拆成 Element 或仅保留 Graph Record。

## 三、应纳入知识固化范围

- Concept：AcquisitionIntent、Target、CollectionMember、RequestedScope、AuthorizationContext、Recipe、ValidationRecord。
- Rule：冻结的任务范围和授权不可擅自放宽；网页导航只沿声明的集合/续页边；错误不可伪装下载成功。
- Practice：确定性 Direct→已知模板→人工选择→受限 LLM；异常恢复与文件组织。
- Case：签名 URL 过期、会员资源/权限不匹配、集合成员变更、下载成功但校验失败。

来源状态要区分 `PROJECT_POLICY`（产品规范）、`IMPLEMENTATION_BEHAVIOR`（已实现代码行为）、`EXTERNAL_DOMAIN_CLAIM`（外部资料提出的主张）、`OBSERVED_CASE`（真实案例）、`LLM_DERIVED_CANDIDATE`（待审推论）。不能将内部规则或合成测试直接转成广泛领域事实。每个知识候选至少记录：ID、Scope、Source SHA/Locator、适用对象/版本/地区、断言、证据、反例、冲突、UNKNOWN、审查决定及变更失效关系。

## 四、排除或外部权威

- Chromium/Native Host 注册、Electron、内部 SDK、网络线程池是实现，不构成数字资源知识本体。
- 不归入全网爬虫、DRM/访问控制绕过或未经授权的内容采集。
- 未经实时访问/许可证据的站点规则不能固化为永久可用知识；不收集用户 Cookie/凭据。

## 五、原始证据入口（同一个 main 精确提交）

- [`README.md`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/README.md)
- [`docs/product/PRD-v0.4.1-review-candidate.md`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/docs/product/PRD-v0.4.1-review-candidate.md)
- [`packages/domain-contracts/src/contract.ts`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/packages/domain-contracts/src/contract.ts)
- [`packages/domain-contracts/src/scope.ts`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/packages/domain-contracts/src/scope.ts)
- [`packages/domain-contracts/src/evidence.ts`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/packages/domain-contracts/src/evidence.ts)
- [`packages/discovery-recipe/`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/packages/discovery-recipe/)
- [外部记录](https://github.com/kaicreator-mm/xDownload/issues/397)
- [外部记录](https://github.com/kaicreator-mm/xDownload/issues/394)

**真正直接检查的源码锚点**：[`packages/domain-contracts/src/contract.ts`](https://github.com/kaicreator-mm/xDownload/blob/e904f08c478b15147b1c07fbe53c610d2d81851f/packages/domain-contracts/src/contract.ts)；Git Blob `eb49defb40557ca9189daee20f6b3e1f475226b2`。其余入口需要后续逐个核查及建立证据清单；并未声称所有源码文件已检查。

### 跨项目知识权威边界

- Shun Assistant 可以调用下载能力，但不得绕过 xDownload 对目标、集合及验证的业务门禁。
- DomainHarness 的 Package/Function 是后续消费工具，不应替代 xDownload 自己的授权/目标事实。

## 六、候选 Competency Questions（不是已通过测试）

1. **CQ1** 明确的下载意图下，哪些 URL/成员真正处于用户确认范围？
2. **CQ2** 来源网页/令牌/集合变化时哪些下载计划必须废弃并请求重确认？
3. **CQ3** 何种下载结果可以被断言为完整、可用，何种只能视为传输完成？
4. **CQ4** 什么情况下模板不适用，必须回退人工选择或 UNKNOWN？

每题需准备正例、错误来源、过期/冲突版本、漏掉横向关系或不当归属的反例。只有定位来源并验证实际结论后，才能从 candidate 晋升；结构检查绿灯不能替代语义审查。

## 七、待调查事实与执行顺序

- 需对 #394 的真实浏览器/Native Host 负例和缺失门禁做来源标记，不能将仓内模拟测试当作真实浏览器权限证据。
- 对网站模式与第三方内容的来源、服务条款和更新周期必须单独分类。

- **SC01 — 版本校准**：绑定当前有效 Product/L1、实际业务开发分支和 exact SHA，区分历史 README。
- **SC02 — 全源清单**：枚举领域模型、规则、核心算法、外部资料、业务案例、相应测试；按可访问/可传播权限分类。
- **SC03 — 规则对齐**：PRD↔源码↔测试标记 MATCH / DOC_ONLY / CODE_ONLY / CONFLICT。
- **SC04 — 独立语义审查**：复查词汇、Source/Claim、例外、反例和不确定范围。
- **SC05 — DKE 建模**：再选择合适的 Context/Global/Recursive Element 拆分策略，检查组合和增量变化。
- **SC06 — 消费准入**：仅将已资格化、具体消费者需要的子图映射到 DIS/DomainHarness，不急于生成 Package。

`FULL_CODE_REVIEW=NOT_RUN` / `INDEPENDENT_DOMAIN_ORACLE=NOT_RUN` / `KNOWLEDGE_GRAPH=NOT_BUILT` / `SAP_QUALIFIED=NO` / `ELEMENT_FREEZE=NO` / `PACKAGE=NOT_GENERATED`。

研究归档留在该项目 Git 分支；DKE 方法与 Demo 单一进度源仍由 [domain-forge #209](https://github.com/kaicreator-mm/domain-forge/issues/209)、Product 范围候选 [#207](https://github.com/kaicreator-mm/domain-forge/issues/207) 维护，不建立新的竞争性知识真相。
