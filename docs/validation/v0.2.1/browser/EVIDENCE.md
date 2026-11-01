# xDownload v0.2.1 T13 终版验证证据（#262）

- 任务：Browser / Native-Host / Core 真实链路安全验证（终版候选复跑）
- 执行日：2026-11-01
- 基线：`52a39451dafd44ff3c2d03b93c95db78c3add126`（与 #262 claim 的 base 一致）
- 执行体工位（只读）：`C:\xDev\kAiCreator\xDownload\xd-v021-finalval`
- 准备趟参考：`C:\xDev\kAiCreator\_tmp\v021\t13\{gaps.md,env.md}`（G1–G7 结论逐条对齐复验）
- 终版运行日志：`C:\xDev\kAiCreator\_tmp\v021\t13final\logs\`（每步原始输出）

## 1. 包哈希绑定

| 项 | 值 |
|---|---|
| 安装包 zip | `out/installer/xdownload-v0.2.1-windows-x64.zip` |
| zip sha256 | `9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718`（与 claim 给定 `9ea81169…a564f6e718` 一致） |
| verify-installer | `PASS 148 files, content sha256-87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9 (v0.2.1)`（exit 0） |
| installer-identity | sourceRevision `52a39451…` dirty=false；toolchain node 24.21.0 / pnpm 12.8.1 / esbuild 0.25.12 |

`verify-installer.mjs` 在安装器目录内执行，日志 `logs/verify-installer.log`。

## 2. 环境与执行体

| 项 | 值 |
|---|---|
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`，**156.0.8078.48**（品牌版，本机实读 VersionInfo） |
| Node | v24.21.0（fnm 默认，符合 INSTALL.txt Node 24 要求） |
| 浏览器实例形态 | 监督进程 `drivers/pipe-install.mjs` spawn：`--remote-debugging-port=38021 --remote-debugging-pipe --enable-unsafe-extension-debugging --headless=new --user-data-dir=<t13final>/chrome-profile`。**pipe 关闭即浏览器退出**，监督进程全程持有（Chrome 137+ 品牌版忽略 `--load-extension`，唯一程序化装载路径 = CDP pipe `Extensions.loadUnpacked`，同 gaps.md G2） |
| CDP 端口 | 38021（任务建议的 47621 段本机被隐藏保留，见 gaps.md G6；开跑前程序化探活 38021/38022/38023 均可绑，取 38021） |
| 专用标识 | install-id **t13f**；Core 管道 `\\.\pipe\xdownload-core-t13f`；CDP 38021；fixture 动态端口 |
| fixture | `drivers/fixture-server.mjs`（PB3 形状：/login→SameSite=None cookie→/s2/page 锚链→鉴权附件）。本次 port **63938**，oracle 81 920 字节 sha256 `9949e8e741ebeca1cd331b2eeb8a542e7fb7a5da2e2c14a4c3f76e20ba3e0b81`（与准备趟确定性一致）。对仓库测试的两处偏差（SameSite=None; Secure + 按 Origin 回显 CORS）同 env.md 记录，源码注释内嵌 |

驱动脚本（复用准备趟、路径与身份适配为 t13final/t13f）：`C:\xDev\kAiCreator\_tmp\v021\t13final\drivers\`（pipe-install / cdp / drive-step / fixture-server / s2-positive / verify-artifact / cli-run / nm-probe / pipe-live）。

## 3. 扩展 ID 推导（浏览器签发，实读）

manifest **无 `key` 字段** ⇒ unpacked ID 由加载路径派生。终版绝对路径与准备趟不同，ID 随之不同——印证 env.md"推导不可靠，必须 `chrome.runtime.id` 实读"的结论：

- `Extensions.loadUnpacked` 管道应答（浏览器签发）：`{"id":"ipjchoddchfoockofeifdmeiookpjgck"}`（`logs/pipe-install.log`）
- 扩展页面内 `chrome.runtime.id` 实读：`ipjchoddchfoockofeifdmeiookpjgck`（`logs/probe-ext.json`，两处一致）
- 准备趟 ID（`jcedakk…`，baseval 路径）在终版路径上不复现——按路径哈希推导不可行，运行时实读是唯一权威来源

## 4. 安装注册与回读（真实 HKCU）

| 步骤 | 命令 | exit | 结果 |
|---|---|---|---|
| 装载 | `node pipe-install.mjs <chrome.exe> <payload\extension> headless` | 0 | DevTools 就绪于 38021；loadUnpacked 签发 ID；Chrome pid 13592 |
| 注册 | `install.cmd --extension-id ipjchoddchfoockofeifdmeiookpjgck --install-id t13f` | 0 | `install bound: origin=chrome-extension://ipjchoddchfoockofeifdmeiookpjgck/ pipe=\\.\pipe\xdownload-core-t13f config=C:\Users\15549\.xdownload\install\broker-config.json` |
| 回读 | `status.cmd` | 0 | `registered=true, configPresent=true, configCore={installId:t13f, userId:15549, pipeName:\\.\pipe\xdownload-core-t13f}, manifestPath=C:\Users\15549\.xdownload\native-host\com.xdownload.broker.json` |
| 注册表 | `reg query HKCU\...\NativeMessagingHosts\com.xdownload.broker /ve` | 0 | 指向上述 manifest（真实 HKCU 键，非探针假注册） |

Core 启动：`xdownload-core-start.cmd` → `{"document":"xdownload.core-host.ready","host":"WINDOWS_NAMED_PIPE","pipeName":"\\\\.\\pipe\\xdownload-core-t13f","pid":54660,"installId":"t13f","userId":"15549"}`。

## 5. S2 正例全链（host 级 + 浏览器内 round-trip）

### 5.1 host 级正例（仓库自有 real-path 机制，`drivers/s2-positive.mjs`）

| 步骤 | 输出（`logs/s2-positive.log`） |
|---|---|
| fixture 鉴权 fetch | HTTP 200，81 920 字节，sha256 `9949e8e7…`（cookie 不进任何 NM 帧） |
| S2_ACQUIRE | `S2_ACQUIRE_ACCEPTED` |
| S2_ACQUIRE_CHUNK seq 0 | `S2_CHUNK_ACK` |
| S2_ACQUIRE_END | **`S2_RESULT`**：contract `contract-s2-11949220a3f9d557fca7850a`，`requestFulfillment=COMPLETE / targetResolution=RESOLVED / selectionAcquisition=COMPLETE / validationSummary=ALL_PASSED(1/0) / stopReason=NONE` |

（81 920 B < 786 432 B slab，单 chunk，与机制一致。）

### 5.2 artifact 字节 == oracle

`drivers/verify-artifact.mjs`：`oracleHit=true`；新增 artifact `artifacts\final\artifact%3As2%3A11949220a3f9d557fca7850a.bin` sha256 `9949e8e7…` == fixture oracle。共享 core-data 根中另有他任务/准备趟历史 artifact（共 17 文件），未触碰。

### 5.3 CLI 经命名管道读回终态

`xdownload-cli.js status --pipe-name \\.\pipe\xdownload-core-t13f --install-id t13f --user-id 15549 --contract contract-s2-11949220a3f9d557fca7850a` → exit 0，`lineage_status=TERMINAL / RequestFulfillment=COMPLETE / validated_success_count=1 / needs_user_action=false`（`logs/verify-artifact.log`）。管道名含反斜杠，按 env.md 的 MSYS 坑规避，全部经 Node spawn argv 传递。

### 5.4 浏览器内 round-trip（真实 SW → connectNative → broker → Core → 浏览器）

MV3 SW 闲置休眠后经 popup 页 `S2_JOURNEY_STATUS` 唤醒（env.md 已知行为），随后 SW 内 `connectNative('com.xdownload.broker')` 发 `S5_GROUP_STATUS`（**真实 contract**，规避 G5 的"未知 aggregate 混淆传输故障"问题）：

```json
{"kind":"S5_RESULT","phase":"STATUS","contractId":"contract-s2-11949220a3f9d557fca7850a",
 "facts":{"terminal":{...COMPLETE/ALL_PASSED...},"lineageStatus":"TERMINAL"},"lastError":null}
```

（`logs/sw-roundtrip.log`）——浏览器→host→Core→浏览器全链活，typed 事实原样回浏览器。

另 host 级对照（`logs/nm-control.log`）：独立 broker host 进程 + 真实 origin → 同一 contract 的 typed `S5_RESULT`（TERMINAL 事实），证明配置读回与 Core 只读投影对任意 host 会话一致。

## 6. 负例矩阵（全部 fail-closed 实证）

| # | 负例 | 层 | 输入 | 实测（exit / lastError / 响应） | 证据 |
|---|---|---|---|---|---|
| A1 | 错误 origin（host 边界） | host | broker host 以未列入 allowed_origins 的 origin 启动 | exit 2，`session refused: extension origin 'chrome-extension://aaaa…/' is not exactly listed in allowed_origins; there is no fallback path` | `logs/nm-wrong-origin.log` |
| A2 | 错误 origin（浏览器 enforced） | 浏览器 | HKCU 注册绑定错误 ID `bcedakk…` 后，真实 SW connectNative | `lastError="Access to the specified native messaging host is forbidden."`，零帧到达 host | `logs/negA-wrongid2.log` |
| A0 | 占位扩展 ID 输入校验 | installer | `install.cmd --extension-id aaaa…` | exit 2，`refusing to bind the packaging placeholder extension id` | `logs/install-wrongid.log` |
| B | host 未注册 | 浏览器 | uninstall 后真实 SW connectNative | `lastError="Specified native messaging host not found."` | `logs/negB-unregistered.log` |
| C | Core 未启动 | 浏览器 | Core（pid 54660）停止、管道实测 ENOENT 后，SW connectNative S5_GROUP_STATUS | typed **`S5_REJECTED`**，`stage=CORE_PROJECTION`，`no Core projection exists for this contract id`（不静默、不挂死） | `logs/negC-core-down.log` |
| D1 | 无 url 授权 · S2 lane | 浏览器（popup 页） | `S2_SELECT_ATTACHMENT`（tab 无 activeTab 授权，url 不可见） | journey `status=FAILED`，`failure.stage=ORIGIN_AUTHORITY`（"the active tab exposes no trustworthy http(s) origin"），未发出任何东西 | `logs/s2-select-neg.log` |
| D2 | 无 url 授权 · V02 lane | 浏览器（popup 页） | `V02_ADD_DOWNLOAD` | `outcome=REFUSED`，`code=V02_ORIGIN_UNAVAILABLE`（"cancelled before anything was sent"） | `logs/v02-submit-neg.log` |

辅助证据：管道存活用真实 `net.connect` 探测（`drivers/pipe-live.mjs`；`fs.statSync/readdirSync` 对命名管道不可靠：isFIFO 假阴、readdir ENOTDIR）。Core 停止前 `connectable=true`，`taskkill /PID 54660 /F /T` 后 `ENOENT`。

## 7. 隐私扫描（cookie 零命中）

| 扫描面 | 方法 | 结果 |
|---|---|---|
| durable 根 `%USERPROFILE%\.xdownload\core-data`（全 21+ 文件含 sqlite/wal/journal/artifacts，二进制安全原始字节） | `pb3_session=full` 值 + `pb3_session=|set-cookie|sessionid=` 形状正则 | **零命中**（`cookieSecretHitFiles=[]`，`cookieShapedHitFiles=[]`） |
| 本次全部运行日志 `…\t13final\logs\` | grep -ri `pb3_session|set-cookie|sessionid` | 源码常量例外：命中仅在 drivers/fixture **源码**（测试形状本身，同 gaps.md 已记录例外）；logs/ 目录 `pb3_session=full` 原始值 **grep 零命中**（exit 1） |

本次 fixture 会话 cookie 为测试常量 `pb3_session=full`（非真实凭证）；扫描证明该值未进入任何持久存储或日志。

## 8. 卸载还原与已知行为记录

执行顺序按 G3 教训：**先停 Core（pid 54660 已停）→ uninstall.cmd**。

| 步骤 | 结果 |
|---|---|
| `uninstall.cmd`（终态卸载） | exit 0：HKCU 注册删除、`%USERPROFILE%\.xdownload\install\` 删除、包目录未动 |
| `status.cmd` 回读 | `registered=false, configPresent=false, manifestPath=null` |
| G4 残留（已知 P2 #289 行为，如实记录） | `%USERPROFILE%\.xdownload\native-host\com.xdownload.broker.json` 卸载后**残留且悬空**（`path` 指向已删除的 `install\xdownload-broker-launch.cmd`）。**本次已手工删除并核实**（目录现空）。注：本次 install 前该路径已存在一份他任务（i179，10-28/11-01 Temp 目录）的悬空残留，install 无提示覆盖（G4 建议的"覆盖提示"缺失点再次复现） |
| 共享 core-data | 保留（uninstall 设计如此）；本次新增 1 个 S2 artifact（contract-s2-11949220a3f9d557fca7850a）留在共享根，未清理他任务文件 |
| 浏览器/进程清理 | 监督进程停止 → pipe 关闭 → Chrome（pid 13592）自动退出（tasklist 确认 gone）；fixture（63938）停止；CDP 38021 关闭；finalval 相关 node 进程 0 |
| 机器终态核查 | HKCU NativeMessagingHosts xdownload 键 = 0；`.xdownload\native-host\` 空；core-data 为共享根按设计保留 |

## 9. NOT_PROVEN 项

### 9.1 弹窗级（action 点击 → popup 锚定）S2/V02 旅程正例 — **NOT_PROVEN_HUMAN_REQUIRED**

gaps.md G1 结论在终版候选上**复验成立**：

- `chrome.action.openPopup()` 实测 `OPENED` 但不授予 activeTab（`logs/open-popup-probe.log`：调用前后 tab url 可见性无变化，`afterUrls` 仍无 http(s) origin）——CDP 无法合成 action 点击；
- `chrome.permissions.request` 需要真实浏览器对话框确认；本机为用户正在使用的活跃共享桌面，盲发 OS 按键不可接受（准备趟已主动停止该路线，本次同样不自动伪造）。

**人工复跑手顺（约 15 分钟，全部其余环节已自动化就绪）**：

1. `node C:\xDev\kAiCreator\_tmp\v021\t13final\drivers\pipe-install.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe" "C:\xDev\kAiCreator\xDownload\xd-v021-finalval\out\installer\xdownload-v0.2.1-windows-x64\payload\extension"`（去掉 `headless` 参数即有头；进程须全程存活）；
2. 从 loadUnpacked 应答实读扩展 ID（路径变则 ID 变，勿沿用本文档的 `ipjchodd…`）；
3. `install.cmd --extension-id <实读ID> --install-id t13f`（先停旧 Core、`uninstall.cmd` 清旧注册，install 拒覆盖）；
4. 启 `%USERPROFILE%\.xdownload\install\xdownload-core-start.cmd` 与 `drivers/fixture-server.mjs`（均后台）；
5. 打开 fixture `/login`（自动登录跳 `/s2/page`）；
6. **真人点击工具栏 xDownload 图标**（授予 activeTab 并锚定 popup；仅需这一次真点击）；
7. 之后全 CDP：对锚定 popup 目标 `drive-step.mjs page-eval s2-select-neg.js`（把其中 63938 端口换成本次 fixture 实际端口）→ 轮询 `S2_JOURNEY_STATUS` 至 COMPLETE；V02 lane 同理（注意：打包 Core 的 `acquisition.acquire` 命中 T04 sealed stub，预期 truthful 失败终态，见 G7，非缺陷）；
8. 收尾：先停 Core，再 `uninstall.cmd`（G3 顺序约束），手清 G4 残留。

### 9.2 其余继承记录（非本次缺陷，未复验扩大范围）

- G4：`performUninstall` 不清理 `windowsUserManifestDir()` 下自身 manifest——本次**复现并如实记录**（见 §8），产品修复建议维持 gaps.md 原案。
- G5：S5 typed 拒绝不区分"聚合不存在"与"Core 不可达"——本次以**真实 contract** round-trip（§5.4）+ Core 停止负例（§6-C）两侧夹住，未扩测未知 aggregate 语义。
- G7：打包 Core 无 acquisition Host bridge（T04 sealed stub）——未复验，维持记录。

## 10. 结论

终版候选（zip `9ea81169…a564f6e718`）上：安装注册/回读、S2 全链正例（host 级 + 浏览器 round-trip + artifact==oracle + CLI 管道读回）、负例全组（A0/A1/A2/B/C/D1/D2，全部 typed fail-closed）、隐私零命中——**全部复验通过**。唯一缺口为弹窗级真点击旅程（9.1），受真人交互约束标记 NOT_PROVEN_HUMAN_REQUIRED，手顺已备。机器状态已全部还原。
