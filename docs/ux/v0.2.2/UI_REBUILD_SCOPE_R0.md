# xDownload UI 重构 R0 — 范围与验收基线（WIP，未冻结）

Parent: [Issue #305](https://github.com/kaicreator-mm/xDownload/issues/305)

本草案属于**后继 UI 版本**，不自动改变 v0.2.1 的冻结候选（源码 52a39451dafd…，RQ=CONDITIONAL）；`version/v0.2.1` / `main` 均不得从本文件推导合并许可。草案以 `version/v0.2.1@e42a10cfaa6f393791261edaaf66488b71b76d5b` 为源对照。

## 决策目标

**像下载管理器，而不是 Core 调试控制台。** 核心日常流程（粘贴链接、选位置、确认、查看列表、筛选、失败恢复）应遵循 Windows 常规操作、可键盘使用，默认中文；英文对照在独立多语言任务里完成。视觉参考 AB Download Manager / Motrix 的信息架构，但不把这些软件支持的功能默认为 xDownload 已实现。

**不制造进度和能力。** 现有桌面 Core 只向会话返回 lineage 投影，不能展示持久历史、文件名、字节百分比、速度或 ETA；T14 记录桌面侧不能完成实际字节下载。初步重构必须明确展示“本次会话”“已提交/处理中”“暂无可靠字节进度”，而不是显示假的“正在下载 62%”。持久历史、Desktop 正向 acquisition、任务文件名和下载类型能力需要另行 Product/L2/Host 接口明确授权。

**动态表单先于大段固定配置。** 表单使用可信、版本化 descriptor 渲染受支持字段；至少包括 URL / Host 路径选择，预览显示 Core 实际返回的确认请求；UI 不能修改 Core 的字段验证或授权，不能把业务未知类型变为有效提交。目前 `url-preview` 的本地 descriptor 仅是表示层，*不是*可扩展的远端执行授权；`hls` 和 `batch` 不可假装能从桌面直接发起。

## 主要页面与流程

### Desktop

- 默认视图：侧边 All / In progress / Completed / Unfinished，顶部明确的“新建下载”，输入搜索，具有名称/状态/结果/保存位置/操作的任务列表；仅对可信的 Core 投影决定筛选和按钮可用性。
- 新建：侧边抽屉 → Schema 生成的 URL 输入/原生目录按钮 → 预览 Core 返回的 scope → 二次确认 → 仅显示被 Core 承认的结果；在不具备 Core 连接/权限时必须解释阻塞。
- 详情：用户友好的状态和结果，技术 ID、revision、stopReason 收纳到“技术详情”；来源不明的进度为空，不推断成功、速度或 ETA。
- 状态：启动/加载、空列表、筛选无结果、Core 断连、拒绝、部分完成、可重试/不可重试；用户可明确返回或结束。

### Browser extension

- 当前页面默认，显示网页观察到的合法候选，用户显式点选才开始；按当前页权威进行授权。
- 另设“批量”“合集”入口，按工作流渐进展示条件输入、成员选择和确认；高级 v0.2 Host 句柄入口隔离在高级面板。切换视图只改变 UI，不触发额外许可或网络。
- Popup 始终保留真实状态、Host 拒绝码和错误详情；不得自动请求整站/通配权限或把网页提供的字符串视为可信 targetRef。

## 工程实施

- 保留 Electron main/preload 9 个 type-checked 方法、单 Core、`sandbox`/`contextIsolation`/`nodeIntegration:false`、本地 asset + 严格 CSP；renderer 不得触碰 Node/进程/文件/任意网络。
- 不引入远端 UI、外部字体或任意动态解释器；dynamic form kind/schemaVersion 均固定 allowlist，未知版本拒绝，主进程与 Core 独立验真。
- Monorepo 不另起多个仓库。仅当桌面/浏览器形成实际复用和测试证据时，再考虑新增 `packages/ui-forms` 公共包，避免为当前一张表单过早共享化。
- 先做源级合同和现有单元测试；本地 Windows Node ≥24 Prettier / TS syntax / typecheck / unit 绿后再触发 Woodpecker；之后实装 Electron / Chrome 可见窗口截图 UX 审核并手动验证焦点、Tab、Escape、浏览器允许权限。
- 未完成独立 Exact-SHA 审查和验证前，Draft PR 不允许合并到 WIP 集成分支，更不能修改 version/main。

## 已执行（WIP，非发布证据）

- #306 / PR #307：桌面界面、可信本地表单、会话筛选/搜索/详情、UI contract tests；源静态检查通过，Node24/实机尚未验证。
- #308 / PR #309：浏览器 Popup 模式重排及键盘切换，不扩大 service worker 权限；HTML 结构/ID 静态检查通过，Node24/Chromium 尚未验证。

## 明确验收

1. 每个高频任务至少有成功、失败、未知和权限拒绝四类路径截图/视频证据；不能只凭源码做视觉 PASS。
2. 添加任务操作数不超过同类常见客户端的必要步骤，同时保留 Core 的必要确认；不把“一键”当作跳过授权的理由。
3. UI 无假进度、假历史、假下载、假能力、无私有数据从渲染器外泄；所有负面条件明确可见。
4. 覆盖中文和英文、Windows 100%-200% DPI、键盘/读屏焦点及高对比度；其余平台单列 NOT_TESTED。
5. 保护 v0.2.1 的已冻结候选；UI 后继的变更必须独立 Product/L2 Amendment + Task DAG 批准、验收和发布裁定。
