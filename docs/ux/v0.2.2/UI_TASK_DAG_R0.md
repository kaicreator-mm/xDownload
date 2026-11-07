# xDownload 后继 UI R0 — 最小 Task DAG（候选，未冻结）

所有节点属于 #305，当前不是已经批准的 ADS 原生 blocked_by 图。每一节点须独立 Task Pack + CAS Claim + 写集唯一所有者；当前 PR #307/#309 属 WIP 草稿，无生产放行资格。

| 节点 | 内容 | 写集（候选） | 前置 | 并行 |
|---|---|---|---|---|
| U00 | 当前界面截图/真实任务流程 UX 基线，外部行业操作对照 | docs/ux/** | 无 | 可与 U01/U02 并行 |
| U01 | Desktop Renderer 主界面、表单、筛选、详情 | apps/desktop-shell/src/renderer/** + 独立测试 | 无（现有 #306） | Lane A |
| U02 | Browser Popup 当前页/批量/合集/高级分层交互 | apps/browser-extension/src/popup/** + 独立测试 | 无（现有 #308） | Lane B |
| U03 | 可信动态表单/能力描述文档和双端合同测试 | 新增形式层，仅在 U01/U02 冻结后裁定独占写集 | U01、U02 | Lane C（先分析） |
| U04 | Desktop 实际文件获取、任务持久历史等产品能力缺口单独验收与 L2 修订 | Core/adapter/Host 精确白名单，未获准前不可写 | U00、Product scoped authorization | Lane D（独立） |
| U05 | Desktop/Browser 回归、截图、无障碍与安装包实测 | docs/validation/**；必要测试有独占写集 | U01、U02、U03；产品能力修复（若纳入） | Gate |
| U06 | 独立审查、候选冻结、发布资格与版本限定合并 | docs/release/** | U05 | Gate |

当前 WIP：U01 和 U02 源码草稿已经提交且同属一个不可自动合并的后继集成目标，未运行 Node24 / Woodpecker / 真实 Electron / Chrome，可见 UI 审核 NOT_RUN。未经 Owner 审核/批准冻结，不得将草稿表当成已批准 DAG。
