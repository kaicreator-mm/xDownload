# T14 终版验证证据 — xDownload v0.2.1 桌面真实旅程（#263）

- 任务：T14（#263）终版验证 —— 真实打包 exe 对已安装 Core/Host seam 的完整旅程
- 执行：zcode:xdownload-v021-T14-validator（本证据的执行代理）
- 日期：2026-11-01
- 结论速览：**基线 packaged smoke 5/5 PASS；真实旅程 18 PASS / 4 NOT_PROVEN / 0 FAIL。**
  关键发现：本终版候选的 **DESKTOP_UI 面不可达字节获取（acquisition）**——exe 的下载旅程真实推进到 Core 契约准入（lineage ACTIVE / contract CONFIRMED, revision 1）后按设计停留，不会到达 COMPLETE、不会有文件落盘；详见 §6 机制分析与 §8 NOT_PROVEN 清单。

---

## 1. 环境与被测对象

| 项 | 值 |
| --- | --- |
| 平台 | Windows 10.0.26300 x64，Git Bash |
| Node | v24.21.0（fnm 默认） |
| 源 HEAD（终版候选，只读工位） | `52a39451dafd44ff3c2d03b93c95db78c3add126`（= claim expected_base_sha，工作树干净） |
| installerRoot | `xd-v021-finalval/out/installer/xdownload-v0.2.1-windows-x64` |
| zip sha256（实测复核） | `9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718` ✅ 与 claim 一致 |
| exe sha256（实测） | `c579acaab64b1c456bda1693cdf1a2ec7e4de7738b0e2d1b6349d60e8087143c` |
| payload/desktop/xdownload.exe | Electron `45.1.0`（`status.shell.electronVersion=45.1.0` 实测） |
| 打包 exe 内 app 版本 | `@xdownload/desktop-shell 0.2.1`（resources/app/package.json） |
| Core 启动 | `node payload/core/xdownload-core-host.js --root <dir> --install-id t14f --user-id t14fuser --host 127.0.0.1 --port 0`（就绪文档 `xdownload.core-host.ready`） |
| exe→Core 连接 | 环境变量 `XDOWNLOAD_SEAM_LOOPBACK=127.0.0.1:<corePort>` + `XDOWNLOAD_SHELL_INSTALL_ID=t14f` + `XDOWNLOAD_SHELL_USER_ID=t14fuser`（seam-endpoint.ts 的显式 dev/smoke override 通道） |
| 端口偏差说明 | 任务书给的 49699 落在 Windows 排除端口段 49670–49769（Hyper-V 保留，`netsh interface ipv4 show excludedportrange protocol=tcp` 实证），Electron devtools `bind() 0x271D` 被拒；改用 **49650**（CDP）。fixture HTTP 用 49641 不变 |

机器可读证据：`t14-journey-evidence.json`（逐条 JSONL）、`t09r1-baseline-packaged-smoke.json`、截图 `*.png`、可复现驱动 `drivers/t14-journey.mjs` + `drivers/t14-fixture.mjs`。
原始日志目录（本机临时）：`C:/xDev/kAiCreator/_tmp/v021/t14final/`（journey.log / fixture.log / core-*.stdout.log / exe.stdout.log，7 天自动清理，关键内容已固化进本文档与 JSON）。

## 2. Fixture 身份（自建，单文件 + sha256 oracle）

`drivers/t14-fixture.mjs`，监听 `127.0.0.1:49641`：

| endpoint | 行为 |
| --- | --- |
| `GET /file.bin` | 1,000,000 字节确定性负载（xorshift32 种子 0x9e3779b9），带 Content-Length 与 Range(206) 支持 |
| `GET /sha256` | oracle：`{"sha256":"9c39c347fd58008b865be3de3bae668ded80ec2d5a4177ca021883702a0809e7","bytes":1000000}` |
| `GET /hang.bin` | 声明 1MB 后只发 64KB 并挂起（cancel 用） |
| `GET /flaky.bin?id=` | 首次 500，重试成功（retry 用） |

旅程关键事实：**fixture 日志全程只有 `GET /sha256` 一条业务请求**——Core 从未对 `/file.bin` 发起任何请求（§6 机制分析）。

旅程最终 run 时间线：2026-11-01T08:08:13Z 起，约 100 秒。

## 3. 基线：packaged smoke（finalval 工位，复用 build/desktop-packaged-smoke.ts）

```
cd xd-v021-finalval && node build/desktop-packaged-smoke.ts \
  --installer out/installer/xdownload-v0.2.1-windows-x64 \
  --out <tmp>/baseline-packaged-smoke.json
# exit 0，overall PASS，5/5
```

| check | 结果 |
| --- | --- |
| packaged-desktop-exe-boots-and-renders | PASS（exe exit=0 verdict.ok=true electron=45.1.0 bridge/isolated/csp 全 true） |
| packaged-desktop-exe-reaches-packaged-core | PASS（core.connection=REJECTED_PROJECTION） |
| packaged-desktop-exe-fail-closed-without-core | PASS（exit=1 truthful DISCONNECTED，无崩溃、无伪造成功） |
| packaged-core-refuses-foreign-peer-identity | PASS（foreign→PEER_IDENTITY_REJECTED；matching→非身份类拒绝） |
| packaged-desktop-exe-truthful-against-refusing-core | PASS（REJECTED_PROJECTION，never CONNECTED） |

## 4. 真实旅程（exe 可见窗口 + CDP 驱动 renderer DOM）

驱动方式：`xdownload.exe --remote-debugging-port=49650`（可见窗口，非 smoke 模式）；CDP `Runtime.evaluate` 驱动真实 DOM（填 `#url`、点 `#add-submit`/`#preview-confirm`/行内按钮），`Page.captureScreenshot` 截图；身份/环境变量同 §1。驱动脚本全文：`drivers/t14-journey.mjs`。

### a. Core + exe 启动 — PASS
打包 Core 就绪（`xdownload.core-host.ready`，install-id `t14f`），exe 启动后 CDP `/json/list` 找到 `file://…/renderer/index.html` 页面 target。

### b. renderer 加载（T08 manager UI）— PASS
connection-line=`Core connection: CONNECTED`；preload bridge 存在且 **frozen**，键集恰好为白名单 9 个：`status / managerRefresh / managerPreviewAdd / managerConfirmAdd / managerDiscardPreview / managerCancelJob / managerRetryJob / managerChooseDestination / managerRevealJob`；`status()` 返回完整 status document（seamEndpoint.kind=loopback, source=explicit-override）。截图 `b-renderer-loaded.png`。

### i. 渲染器隔离复核 — PASS
CDP 页内实测：`typeof require/process/Buffer/module/electron` 全部 `undefined`（sandbox + contextIsolation 生效）；CSP meta = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`；origin=`file:`，`location.assign(remote)` 被拒后仍 `file:`；`window.open` 被 deny。Electron 45.1.0。

### c. add URL 旅程 — 状态真实推进 PASS；完成态/落盘 NOT_PROVEN
1. 提交 `http://127.0.0.1:49641/file.bin` → preview 打开：lineage=`contract-desktop-tx1b3ju5-000002`，一条 SCOPE_LEVEL 确认请求（proves SELECTION）。截图 `c-preview.png`。
2. confirm → 行真实出现并按 Core 投影推进，观察序列（300ms 采样 45s）：`lineage ACTIVE (contract CONFIRMED, revision 1)` —— **真实推进到 Core 契约准入后按设计停留**。
3. fixture 日志：`/file.bin` 请求数 = **0**；core-root 无字节产物（`artifacts/{final,materialized,staging}` 全空；≥100KB 文件仅预分配的 `ledger.sqlite`）。
4. `seam-journal.jsonl` 该 lineage 仅有 `SUBMIT_CONTRACT` 一条命令。

### d. destination 选择 — 分层证据（调用接入 PASS；键盘选目录 NOT_PROVEN）
- 点 `#choose-destination` 后 renderer busy latch 生效（全部动作按钮禁用）→ **PASS**：`managerChooseDestination` IPC 已跨进 main，原生对话框权威被唤起（renderer-main.ts `chooseDestination()` / main.ts `pickDestinationDirectory()`）。
- EnumWindows 按 exe pid 枚举顶层窗口：`Choose download destination` + `xDownload` → 原生 OpenDialog **确实打开**。键盘自动化在 Win11 对话框上"键入路径+Enter"未形成对目标目录的选定，但两轮中的后一轮实际接受了默认目录并返回（`d-destination.png`：renderer notice 显示 `destination folder: C:\Users\15549\Downloads`）——目标目录未达成记为 NOT_PROVEN；对话框打开、返回值流入 preview、busy 释放均为 PASS。
- 结论：UI 能力存在且接通到 main 进程权威；**目录选定这一步在本环境无法自动化，记 NOT_PROVEN**（非产品缺陷）。截图 `d-dialog-open.png`。

### d2. destination 进入 add preview — PASS
以 renderer 完全相同的调用形态 `managerPreviewAdd({url, destination})` 验证：返回 `xdownload.desktop.manager.preview`，`destination="C:\xDev\kAiCreator\_tmp\v021\t14final\dest-picked"` 原样进入 preview 文档与 pending list。随后 discard。（注：desktop 的 destination 是 shell 会话态，按设计不进入任何 Core payload。）

### e. cancel — PASS
对 ACTIVE 态 lineage（cancel 按钮真实可用，`disabled=false`）点击 Cancel → 投影真实推进：`lineage ACTIVE (CONFIRMED, revision 1)` → **`lineage CANCELLED (CONFIRMED, revision 2)`**；`seam-journal.jsonl` 落 `CANCEL_LINEAGE`（DESKTOP_UI peer）。截图 `e-cancelled.png`。

### f. retry — NOT_PROVEN
Retry 按钮每行都渲染，但 `retryEnabled` 只由投影的 failed-member 事实推导（manager-state.ts `jobActions`）。本候选桌面面不可达 acquisition ⇒ 无失败成员 ⇒ retry 恒 disabled。UI 控件存在性已证；**真实 retry 旅程不可达，记 NOT_PROVEN**（机制见 §6）。

### g. restart recovery — PASS（三项）
1. `taskkill /F /T` 杀 exe 树 → CDP 死透 → 以同身份重启 exe → connection-line 恢复 `CONNECTED`。
2. 列表回读=**0 行**：shell 的 job registry 是会话态（manager.ts 只记本窗口 add 过的 lineage），新窗口如实渲染空列表——这是设计行为，非状态丢失；Core 侧 durable lineage 仍在。
3. Core 持久化跨重启存活：`ledger.sqlite(+shm/wal)`、`seam-journal.jsonl`、`artifacts/`、`domain-app/` 均在。截图 `g-after-restart.png`。

### h. reveal file/folder — PASS（以"拒绝而非伪造"的方式证真）
无 COMPLETE 项可 reveal 时，reveal 权威返回 **typed refusal**：`{"ok":false,"code":"SHELL_IPC_REFUSED","detail":"this job has no destination folder to reveal"}`——IPC 响应层证据完整（Explorer spawn 属 main 进程 `shell.showItemInFolder` 权威；本候选无可达 COMPLETE 场景，故 Explorer 层记为不可断言）。

### j. Host/Core identity mismatch fail-closed — PASS（两项，exe 级再证）
以错误身份（shell 侧 `t14f-shell-mismatch`）对 install-id=`t14fx` 的 Core：
1. `status().core.connection=REJECTED_PROJECTION`，**从未 CONNECTED**——判定依据是 status 文档本身；渲染器连接行文字在空列表时初始硬编码 `CONNECTED`、仅反映行读新鲜度，不反映拒绝态（独立审核指出 `j-mismatch.png` 与空列表截图字节相同，连接行不构成拒绝证据，特此修正表述）。
2. add/confirm 真实跨过 seam，Core 以 typed `PEER_IDENTITY_REJECTED`（"peer is not the expected same-install/same-user identity"）回答；会话行 `present=false` 在**数据层**由 journey-evidence JSON 充分佐证（拒绝 Core 不提供投影，无缓存状态伪造）。渲染层未捕获"无投影"行：`j-mismatch-after-add.png` 摄于 confirm 返回后 68ms，早于 renderer 2s 刷新间隔的首个 tick，DOM 尚未重渲染（该图与空列表截图字节相同）；渲染层 absent-row 语义由源码设计（manager.ts）支撑，非运行时截图实证。

## 5. 基线与旅程汇总

- 基线：`overall=PASS`，5/5（t09r1-baseline-packaged-smoke.json）。
- 旅程终版 run：`{"PASS":18,"INFO":15,"NOT_PROVEN":4,"FAIL":0}`（t14-journey-evidence.json，逐条含时间戳/命令/响应原文）。

## 6. 关键发现：DESKTOP_UI 面不可达 acquisition（机制分析）

exe 旅程真实停在契约准入，根因链（全部在终版候选字节内核实）：

1. 打包 Core host 以 `domainApp: {}` 组成运行时——**可信媒体 registry 刻意为空**（`build/core-host.ts` 注释原话："Trusted media targetRef seeds are deployment facts, not packaging facts; an unseeded targetRef settles as the K's own typed CONTRACT_BINDING_MISMATCH refusal"）。
2. K v0.2 活路由（T02-R1）只接 `DOMAIN_APP_SEND` 的 confirmDownload intent，且其 `targetRef` 必须命中已播种的可信媒体目标；桌面 adapter（`apps/desktop/src/adapter.ts`）的 `confirmScope()` **只路由 `SUBMIT_CONTRACT`，从不发送 DOMAIN_APP_SEND**。
3. 裸 URL 直取执行器 `EXECUTE_S1_DIRECT_ACQUISITION` 在 Core 侧**仅限 CLI 面**（"admissible only from the CLI surface"）。
4. 实证闭环：fixture 零请求；journal 仅 `SUBMIT_CONTRACT`/`CANCEL_LINEAGE`；artifacts 目录空；45s+ 投影稳定于 ACTIVE rev 1。

即：本候选的桌面管理器是一个**如实的事务准入/控制面**（add 准入、cancel、目的地选择、reveal 门控、fail-closed），桌面端到端字节下载不在 v0.2.1 该候选的可达面内。这是产品边界，不是验证失败——所有相关断言以 NOT_PROVEN 如实记录。

## 7. 旅程各项清单

| 项 | 结果 |
| --- | --- |
| a Core+exe 启动 | PASS |
| b renderer 加载（bridge 白名单/frozen/status document） | PASS |
| c 状态真实推进（准入+停留，fixture 零请求） | PASS |
| c 完成态 + 文件落盘 sha256 校验 | NOT_PROVEN（§6） |
| d destination UI 能力（busy latch + 原生对话框打开） | PASS |
| d 目录选定（键盘自动化） | NOT_PROVEN（环境限制，非产品缺陷） |
| d2 destination 流入 preview | PASS |
| e cancel（ACTIVE→CANCELLED rev 2，journal 落证） | PASS |
| f retry 真实旅程 | NOT_PROVEN（§6，控件本身已渲染） |
| g restart recovery（连接恢复/列表会话语义/Core 持久化） | PASS ×3 |
| h reveal（typed refusal，IPC 响应层） | PASS |
| i 隔离+CSP+导航守卫复核 | PASS |
| j mismatch fail-closed（REJECTED_PROJECTION + Core 端 typed 拒绝） | PASS ×2 |

## 8. NOT_PROVEN 项与边界声明

1. **c 完成态/落盘**：桌面面不可达 acquisition（§6）。
2. **d 目录选定**：Win11 原生 OpenDialog 不接受键入路径即选定；本环境无法用键盘自动化完成选定。对话框打开与 IPC 接通已证。
3. **f retry**：无失败成员投影可达，按钮按设计 disabled。
4. **h Explorer spawn**：无可达 COMPLETE 场景；reveal 的 Explorer 触发属 main 进程权威，本候选无法在真实旅程中断言到 Explorer 层。

另注：任务书端口 49699 被 OS 排除段占用，实际用 49650（§1）；exe 进程树各阶段结束后均以 `taskkill /PID <pid> /F /T` 清净，fixture/Core 子进程随驱动退出回收。
