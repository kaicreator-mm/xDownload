# xDownload v0.2.1 — T16 平台/安装/升级终版验证证据（#265）

- 任务：v021-T16 final validation（dispatch `xd-v021-T16-final-20261101-01`，claim issuecomment-6555670194）
- 验证日期：2026-11-01
- 写集：`docs/validation/v0.2.1/platform/**`（本目录）
- 结论概览：**两候选 zip 哈希复算逐位一致；终版 verify.cmd PASS；干净安装→HKCU 注册→t16f 管道 Core→CLI 管道冒烟→卸载全链 PASS；#289 G3/G4 如实复现（G3 EPERM 半途态+收敛、G4 manifest 悬空残留）；升级路径（装旧→直接装新 fail-closed 被拒→按文档顺序升级→冒烟 PASS）；目的地权限正例落盘哈希一致、逃逸根类型化拒绝、只读目录如实记录可达围栏。仅声明 win32-x64 + Node 24 实测。**
- 原始日志（临时区，7 天后自动清）：`C:\xDev\kAiCreator\_tmp\v021\t16final\logs\`；驱动脚本同目录 `drivers\`。

## 1. 候选身份与哈希绑定

两候选**均先复制到 `_tmp\v021\t16final\` 再操作**（`inst-final` / `inst-base`），finalval/baseval 工位零改动；复制前后 sha256 逐位一致：

| 项 | 值 |
|---|---|
| 终版 zip（源候选 + 副本） | `9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718`（与 claim `CANDIDATE_ZIP` 一致） |
| 旧候选 zip（升级源，源候选 + 副本） | `2cf2b01b125f1b8a4741cd553b6512a1a114919878481d60211069713aea96b0`（与 #289 记录一致） |
| 终版源修订 | `sourceRevision.sha = 52a39451dafd44ff3c2d03b93c95db78c3add126`，`dirty=false`（installer-identity.json） |
| 终版 contentHash / 文件数 | `87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9` / 全树 150（SHA256SUMS 清单 148 项） |
| 旧候选源修订 / contentHash / 文件数 | `56f9e16d8d7afb29b2a493c07bdf4f886a0bf445` / `606be8a0d41eb63b8dbdbe23ef54ec08a7dd47dc79544717d12475e729ca3d17` / 52 |

完整性门禁（均在本轮副本目录执行）：

```
inst-final> cmd //c verify.cmd
→ verify-installer: PASS 148 files, content sha256-87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9 (v0.2.1)   EXIT=0
inst-base>  cmd //c verify.cmd
→ verify-installer: PASS 50 files, content sha256-606be8a0d41eb63b8dbdbe23ef54ec08a7dd47dc79544717d12475e729ca3d17 (v0.2.1)    EXIT=0
```

终版 payload 五 artifact 身份（installer-identity.json `payloadContentHashes`）：cli `35414eab…`、core `2c057fd4…`、desktop `63752077…`、extension `1257a8cb…`、native-host `631f8926…`。

## 2. 验证环境

| 项 | 值 |
|---|---|
| OS | Windows 11 专业版，build 26300，win32/x64（os.release `10.0.26300`） |
| node | v24.21.0（fnm 默认；install/uninstall/status 脚本与 payload 均以此 node 执行） |
| Chrome（仅扩展 ID 签发用） | `C:\Program Files\Google\Chrome\Application\chrome.exe` 156.0.8078.48 |
| 安装身份 | `--install-id t16f --user-id 15549`（user-id 为 install-host 对 OS 用户名的净化默认）；管道 `\\.\pipe\xdownload-core-t16f` |
| 扩展 ID | `giodgphbdlecmlaalilgamcgclaannca` —— **本轮真实浏览器签发**：CDP `Extensions.loadUnpacked`（`--remote-debugging-pipe` + `--enable-unsafe-extension-debugging`，Chrome 137+ 品牌版忽略 `--load-extension`，同 T13 机制）对**本轮安装副本路径**加载，响应原生返回该 32 位 a-p ID；驱动 `drivers/pipe-install-id.mjs`，签发后 pipe 关闭浏览器退出（pid 21872 已不存在，38033 端口已回收） |
| 预置状态 | 开始前 `HKCU\...\NativeMessagingHosts\com.xdownload.broker` 不存在、`~\.xdownload\install` 不存在、`~\.xdownload\native-host` 为空目录（T13 G4 残留已手清）；`~\.xdownload\core-data` 为 T13 时代共享数据（按设计 uninstall 不触碰） |

## 3. 干净安装全链（终版副本）

每步命令 + exit + 输出摘要（全文见 `logs/` 对应文件）：

1. **安装**：`cmd //c install.cmd --extension-id giodgphbdlecmlaalilgamcgclaannca --install-id t16f` → **EXIT=0**
   `install bound: origin=chrome-extension://giodgphbdlecmlaalilgamcgclaannca/ pipe=\\.\pipe\xdownload-core-t16f config=C:\Users\15549\.xdownload\install\broker-config.json; start the single Core with: ...\xdownload-core-start.cmd`
2. **status 回读**：`cmd //c status.cmd` → **EXIT=0**：`registered=true`，`manifestPath=C:\Users\15549\.xdownload\native-host\com.xdownload.broker.json`，`configCore={installId:"t16f",userId:"15549",pipeName:"\\.\pipe\xdownload-core-t16f"}`（`logs/status-final.txt`）
3. **注册表回读**：`reg query HKCU\Software\Google\Chrome\NativeMessagingHosts\com.xdownload.broker` → 默认值 = manifest 路径（REGEXIT=0）；manifest `allowed_origins=["chrome-extension://giodgphbdlecmlaalilgamcgclaannca/"]`，`path` 指向 install 目录 launcher；broker-config.json 同 origin + 同 core 三元组（三层一致）
4. **启动 payload Core**（从 install 目录启动，真实"双击"形态）：ready 行 `{"document":"xdownload.core-host.ready","host":"WINDOWS_NAMED_PIPE","pipeName":"\\.\pipe\xdownload-core-t16f","pid":44492,"installId":"t16f","userId":"15549"}`
5. **CLI 管道冒烟**（`drivers/pipe-smoke.mjs`；pipe 名走 Node spawn 传参，规避 Git Bash 反斜杠折叠——T13 实证坑）：
   - fixture：127.0.0.1 动态端口 60055，256 KiB 确定性字节，sha256 `31a1f9dea0169551092d05e8bf4a446228c8c3eb4c9b713c66adcb7fd53c89be`；
   - `download --pipe-name \\.\pipe\xdownload-core-t16f --install-id t16f --user-id 15549 --url http://127.0.0.1:60055/file.bin --sha256 <同上> --total-bytes 262144` → **exit 0**，`RequestFulfillmentStatus=COMPLETE`、`target_evidence_basis=PUBLISHED_SHA256`、`certainty=DECISIVE`、`contract_id=contract-s1-64aa3d49-a5d9-47`；origin 侧恰 1 次请求；
   - `status --contract contract-s1-64aa3d49-a5d9-47`（同管道）→ **exit 0**，投影与下载终态一致（COMPLETE/TERMINAL）。
6. **落盘字节核验**：`~\.xdownload\core-data\artifacts\final\s1artifact-64aa3d49-a5d9-47.bin`，sha256 `31a1f9de…`、262144 字节，与 fixture oracle 逐位一致。
7. 卸载见 §4（#289 复现序列内完成）；终态注册表 0 键回读见 §4 末。

## 4. #289 G3/G4 如实复现（P2 已知缺陷，本轮在 52a3945 候选上复核）

- **G3（uninstall 顺序，Core 运行中）— 复现**：Core（pid 44492，cmd 包装进程 CWD=install 目录）未停时执行 `uninstall.cmd` → **EXIT=2**，类型化错误
  `xdownload-install-host: EPERM, Permission denied: \\?\C:\Users\15549\.xdownload\install`
  半途态与 #289/T13 记录完全一致：**注册表键已删**（reg query REGEXIT=1）而 **install 目录文件仍在**（broker-config.json / xdownload-broker-launch.cmd / xdownload-core-start.cmd），Core 仍监听管道——"无注册但有文件"半状态。（期间一次重跑仍 EPERM：彼时杀进程命令因 shell 引号问题未生效，属同一运行态下的重复观察，非新形态。）
  **收敛**：PowerShell `taskkill /PID 44492 /T /F`（成功，进程计数 0）后重跑 `uninstall.cmd` → **EXIT=0**
  `registration='not-registered' (no registration present); install files removed (...); the package dist was never modified`。
  归因与 #289 一致：uninstall 先删注册后删文件，Core 的 cmd 包装进程 CWD 占住 install 目录导致文件删除 EPERM；INSTALL.txt 已明文"先停 Core 再卸载"，属**文档化顺序约束 + 不良失败形态**，非数据损失。
- **G4（悬空 manifest 残留）— 复现（两候选一致）**：收敛卸载后 `~\.xdownload\native-host\com.xdownload.broker.json`（433 字节）**残留**，其 `path` 指向已删除的 `~\.xdownload\install\xdownload-broker-launch.cmd`（悬空死链）；`allowed_origins` 无敏感内容（与 §3.3 同值）。旧候选（§5）卸载后同样残留。两轮残留均**记录后手工删除**并核实目录为空。与 #289 处置建议一致：uninstall 应一并删除自己拥有的 manifest 文件（延迟至 v0.2.2 候选，本轮不动产品代码）。
- **终态**：`com.xdownload.broker` 注册表键不存在（REGEXIT=1）；`~\.xdownload\install` 不存在；`~\.xdownload\native-host` 为空；无 xdownload 相关 node 进程存活。

## 5. 升级路径（旧候选 → 终版）

按真实升级场景全序执行（`logs/install-base.txt` 等）：

1. **装旧**：`inst-base> cmd //c install.cmd --extension-id <同 ID> --install-id t16f` → **EXIT=0**（与终版同身份绑定；status 回读同 §3.2 形态）。
2. **旧 Core 运行**：ready 行 `pid=49472, installId=t16f`（4-artifact 时代 core）。
3. **直接覆盖安装新版 — 预期拒绝（复现 PASS）**：`inst-final> install.cmd ...` → **EXIT=2**
   `an existing Native Messaging registration is present (C:\Users\15549\.xdownload\native-host\com.xdownload.broker.json); run 'uninstall' first — this setup never overwrites a registration`
   —— 注册探测先于任何文件写入，fail-closed，无部分状态（`logs/upgrade-direct-refusal.txt`）。
4. **按文档顺序升级**：停旧 Core（taskkill /T /F，49472 消失）→ `inst-base> uninstall.cmd` → **EXIT=0**（`registration='unregistered' (HKCU registration removed); install files removed`）；G4 残留再次出现 → 记录后手清 → `inst-final> install.cmd ...` → **EXIT=0** → `status.cmd` **EXIT=0**（t16f 三元组回读一致）。
5. **升级后冒烟**：新 Core ready `pid=56172, installId=t16f`（5-artifact core）；管道 `download` → **exit 0**，`COMPLETE/PUBLISHED_SHA256/DECISIVE`，`contract-s1-385cc047-b8ee-4a`，恰 1 次 origin 请求；`status` 回读一致；落盘 `s1artifact-385cc047-b8ee-4a.bin` sha256 `31a1f9de…`、262144 字节与 oracle 一致。
6. **旧→新 payload 差异事实**（目录树 diff + installer-identity 对照）：
   - artifact 目录增量：**`desktop` 新增**（唯一目录级差异；4→5 artifact）；
   - `cli`、`extension` 逐字节不变（`35414eab…` / `1257a8cb…` 两候选相同）；
   - `core` `80fd8843…→2c057fd4…`、`native-host` `3a0dd7dd…→631f8926…` 变更；
   - 全树文件数 52→150；源修订 `56f9e16d…→52a39451…`。

## 6. 目的地权限

安装面的真实形态（先于用例，如实陈述）：legacy S1 直链路由（CLI `download`）的授权输出区 = **Core 数据根 `--root` 下的 `artifacts/`**（本轮即 `~\.xdownload\core-data\artifacts\final\`），该路由无用户自选目的地参数；用户侧"目的地选择"是 desktop shell 会话态（T14 已证按设计不进入任何 Core payload）；v0.2 域路由的授权根 = intent `outputRootScope`，是 Core 侧唯一的目的地权限面。

1. **正例（授权输出区内，成功）**：§3.5-3.6 的 t16f 管道直链下载——COMPLETE、字节持久化于授权区、sha256/字节数与 oracle 逐位一致（升级后 §5.5 复验一次）。升级冒烟产生的第二个 artifact 同样核验一致。
2. **根外逃逸（fail-closed 拒绝）**：v0.2 intent `outputRootScope` 带 `..` 逃逸段（其余形状与正例相同）→ `submit --route v0.2`（管道）→ **exit 2**，类型化拒绝文档
   `{"document":"xdownload.cli.domain-app.error","code":"OUTPUT_ROOT_ESCAPED","message":"output root must not contain '..' segments","coded":true}`（`logs/dest-negatives.log`）。零物化。
   代码面围栏（52a3945 谱系一致）：`validateOutputRoot` 拒绝 `..` 段；artifact 路径按 `join(授权根, 单段文件名)` 构造 + `validateArtifactPath`（`OUTPUT_ROOT_ESCAPED`）+ 物化后 `validateMaterializedEvidence` 复核——根外写在构造上不可表达。
3. **Windows 只读目录（拒绝形态如实记录）**：`dest-ro` 以 icacls 收敛为 `Everyone:(R)` 仅读（探针 `touch` → Permission denied 实证）后作为 `outputRootScope` 提交 v0.2 → submit **exit 0 被受理（RUNNING/ACCEPTED）**（admission 只做 grammar 校验，文件系统权限在物化层才触及）→ `wait/status` 终态 **FAILED `CONTRACT_BINDING_MISMATCH`（"opaque targetRef did not resolve"）exit 4**。同形状、可写根的对照 lineage 收敛于**同一**绑定拒绝——证明拒绝由受信注册表绑定驱动而非输出根。**只读目录全程未被触碰**（事后 ls 为空；验证后已恢复写权限）。
   如实结论：安装面上文件系统级拒绝形态（`MEDIA_MATERIALIZATION_FAILED`，打包 core 内物化失败处理）**不可达**——受信 targetRef 种子是部署事实而非打包事实（空受信注册表，T15 证据既定），正向物化链需 S2/S4 种子（T13 范围）。此项记 **NOT_PROVEN（安装面）**，见 §8。

## 7. 平台矩阵（未测平台不声明）

| 平台 / 表面 | 状态 | 依据 |
|---|---|---|
| **win32-x64 + Node 24.21.0**（CLI+Core+native-host 安装面：安装/注册/管道/卸载/升级） | **TESTED（本轮）** | §3-§6 全部用例 |
| win32-x64 浏览器扩展真实链路 | 本轮未重复（T13 #262 已证，ID 签发机制本轮仅复用） | T13 EVIDENCE |
| win32-x64 desktop 打包 shell | 本轮未驱动（T14 #263 已证；desktop 目的地为 shell 会话态） | T14 EVIDENCE |
| Linux x64（cli+core） | **NOT_TESTED** | payload `support-matrix.json` `cli-linux-x64: NOT_PROVEN`（"No Linux Build Host was exercised…"）；本轮零 Linux 触碰 |
| macOS arm64（cli+core） | **NOT_TESTED** | 同上 `cli-macos-arm64: NOT_PROVEN` |
| Firefox / Safari 扩展、Linux/macOS native-host 注册、updater/signing | **NOT_TESTED** | support-matrix.json 对应 NOT_PROVEN 条目；本轮零触碰 |

安装器自身声明一致：INSTALL.txt 明文 "The only supported tuple of this package is Windows x64 with Node.js 24"；installer-identity.json `hostTuple=win32-x64`。**本文件不声明任何未实测平台。**

## 8. NOT_PROVEN 项（如实边界）

1. **只读目的地的文件系统级拒绝形态**（§6.3）：安装面不可达（绑定围栏先于物化；物化层需受信 targetRef 种子）。in-repo 域路由代码面存在 `MEDIA_MATERIALIZATION_FAILED` 语义，但非本轮实测。
2. **无 Core 监听时的管道传输失败**、**Core 重启再投影**、S5/S3/S4 各业务面：属 T12/T15 已证范围，本轮未重复（不在 T16 验收清单）。
3. **Edge 浏览器注册**：install.cmd 仅写 Chrome 键（T13 已记录），本轮未触碰 Edge。
4. **updater / 代码签名**：无机制，零声明（support-matrix 既定）。
5. **扩展 ID 的"本安装路径"含义边界**：ID 为 Chrome 对**本轮验证副本路径**签发；若终端用户把包解压到其他路径，unpacked ID 随路径变化（T13 已证路径派生不可靠、须以 `chrome.runtime.id` 实读为准）。T16 无浏览器驱动步骤，绑定语义（allowed_origins 三层一致）已证，浏览器握手本身不在本轮重复。

## 9. 遗留状态与收尾核查（验证结束时）

- 注册表 `com.xdownload.broker` 键：不存在（0 键）；`~\.xdownload\install`：不存在；`~\.xdownload\native-host`：空；xdownload 相关 node 进程：0。
- 共享 `~\.xdownload\core-data`：两枚冒烟 artifact（`s1artifact-64aa3d49…` / `s1artifact-385cc047…`，均无敏感内容）与对应 ledger 行按产品语义留存（手工剥离会制造 ledger 悬空引用，不做）；其余为 T13 时代既有数据，未清理。
- finalval / baseval 工位：零改动（仅读取与复制）；两 zip 原件 sha256 复算前后一致。
- `_tmp\v021\t16final\` 内：两候选副本、驱动脚本、logs/、fixture 字节、dest-ro（权限已恢复可写）、chrome-profile（ID 签发残留，可随 tmp-clean 回收）。
