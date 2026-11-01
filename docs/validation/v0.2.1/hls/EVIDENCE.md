# T15 终版验证 — HLS 端到端（#264）

- 日期：2026-11-01
- 终版候选（只读工位）：`C:/xDev/kAiCreator/xDownload/xd-v021-finalval`
- 源 HEAD：`52a39451dafd44ff3c2d03b93c95db78c3add126`（与 #264 发布 claim base `52a3945` 一致；验证后工区 `git status` 干净，未改动）
- 安装包 zip SHA-256：`9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718`（与 claim `9ea81169…` 一致）
- 被测物：安装包 payload 的**真实 Core host 与 CLI bundle**（`out/installer/xdownload-v0.2.1-windows-x64/payload/{core,cli}`），非源码入口
- 执行代理环境：Windows 10 (win32 x64)，Node v24.21.0，ffmpeg/ffprobe 9.0.1（`C:\Application\ffmpeg-9.0.1-full_build\bin`，已在 PATH）
- 原始事件流/逐场景 JSON：`C:/xDev/kAiCreator/_tmp/v021/t15final/run-2026-11-01T07-49-26-051Z/`（`events.ndjson` 增量流水、`result.json` 汇总、`cli-*-transcript.log` ConPTY 实录、`cli-*-stdout.json` CLI 原始 stdout 文档、`core-root/` Core 持久层）
- 驱动脚本：`C:/xDev/kAiCreator/_tmp/v021/t15final/t15-final-e2e.cjs`

## 路径判定（任务第 1 步，源码依据）

`packages/download-domain-app/src/integrations/s4-hls-vod-contract.ts` 的
`validateConfirmedS4HlsIntent` 对 `targetRef` 只要求有界不透明标识符；真正的绑定发生在
`media-registry.ts` 的 `InMemoryMediaTargetRegistry.resolve(targetRef)`：未播种的
`targetRef` 一律返回类型化拒绝 `CONTRACT_BINDING_MISMATCH`（"not a handle bound in the
injected media registry"）。不存在"按 manifest URI 自行解析"的回退——URI 白名单
（`canonicalPlaylistUri`）只校验形态，不产生绑定。

安装 Core（payload `xdownload-core-host.js`）以 `domainApp: {}` 组装（源码注释明确：
"Trusted media targetRef seeds are deployment facts, not packaging facts"），即**空受信注册表**。
结论：

- 路径 a（v0.2 submit 真实受理进 K 并完成 HLS 下载）：**不可行**，属部署事实而非缺陷。
- 路径 b（legacy `hls` 命令端到端）：可行。CLI argv 层 `parseS4ManifestUri` 只收
  "canonical credential-free public HTTPS .m3u8 URI"（禁 http/端口/query），因此夹具以
  **真实 HTTPS** 提供：`media.127.0.0.1.sslip.io`（sslip.io 通配 DNS → 127.0.0.1）监听
  127.0.0.1:443，本地 CA（`_tmp/xd-s4-hls-canary/`，2026-11-01 重签 30 天，
  CN=`media.127.0.0.1.sslip.io`）经 `NODE_EXTRA_CA_CERTS` 注入 Core 进程，**标准证书校验保持开启**。
- 交互确认：legacy `hls` 的 `confirmSelection`/`selectRendition` 要求 stdin/stderr 均为
  TTY（piped stdin 返回 unavailable → NEEDS_USER_ACTION）。自动化方式：复用
  `_tmp/xd-s4-hls-canary/node_modules/node-pty`（预编译 ConPTY）在真实伪终端内驱动 payload
  CLI bundle，按提示符逐字键入（`0\r` 选 rendition、`y\r` 确认 tuple）；stdout 重定向到文件
  保留机器可读 JSON，ConPTY 实录留 transcript。Core 走真实 Windows 命名管道
  `\\.\pipe\xdownload-core-t15f`（install-id `t15f`）。

## 夹具身份（复用 T15 预备产物，未重新生成）

来源 `C:/xDev/kAiCreator/_tmp/v021/t15/fixture-media/`（ffmpeg 9.0.1 生成：
testsrc 320x180@25fps h264 baseline + sine 48kHz aac，6s，GOP=50，3×2s 分段；身份见
`fixture-identity.json`）：

- `master.m3u8`：`#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=320x180` → `media.m3u8`
- `media.m3u8`：`#EXT-X-PLAYLIST-TYPE:VOD`，3 分段，`#EXT-X-ENDLIST` 收尾
- 分段（name / bytes / sha256）：
  - `segment000.ts` / 61664 / `1ff3a779070b4b9aa5afa795eb2c3a0e0da906ead9e6fbf3d21659ecba4102e0`
  - `segment001.ts` / 62228 / `91821bbcc12a25281a6358357ccefa09e07c42b1bf5ac476565ef45f060eb6af`
  - `segment002.ts` / 61476 / `fbe01cb56c7abdde8bb32695fa8f67cde2395cc43d74084c9f3425a7f1e8491f`
- 拼接期望 SHA-256：`39f81d4bd540e5cfdd40164614ed56dc026c41602190522dd20e8720c20064bd`（185368 bytes）
- 负例清单：`media-event.m3u8`（`PLAYLIST-TYPE:EVENT`）、`media-unclosed.m3u8`（无 TYPE 无 ENDLIST）、`media-aes.m3u8`（`EXT-X-KEY METHOD=AES-128`）、`media-404.m3u8`（中段 `segment-missing.ts` 不存在 → 源站 404）

## 结果矩阵（全部 7 项通过）

| 场景 | 命令面 | exit | 终态/文档 | 持久层证据 | 结论 |
|---|---|---|---|---|---|
| V02-BINDING | `submit --route v0.2`（shape-valid HLS intent，`targetRef=ref:t15f-target-pos`，expiresAt 已重建） | 0 | `xdownload.cli.domain-app.sent` status=RUNNING/raw=ACCEPTED（非终态） | `wait`/`status` → `xdownload.cli.domain-app.status` status=FAILED terminal=true `error.code=CONTRACT_BINDING_MISMATCH`（"opaque targetRef did not resolve"） | v0.2 活路由对 HLS intent 的真实响应落证：受理进 K 后以 K 自身类型化拒绝 settle |
| S1-POSITIVE | legacy `hls`（ConPTY 键入 `0\r`、`y\r`） | 0 | `xdownload.cli.status`：lineage TERMINAL，RequestFulfillmentStatus=**COMPLETE**，StopReason=NONE，target_evidence_basis=REQUESTED_LOCATOR_PROVENANCE（certainty=PROBATIVE），failed_member_count=0 | `TARGET_EVIDENCE` 收据 artifactSha256=`39f81d4b…`；制品唯一存在于 `core-root/artifacts/final/` | 端到端真实下载成功 |
| S2-EVENT | legacy `hls`（master-event） | 4 | status：TERMINAL / **UNSATISFIED** / SelectionAcquisitionStatus=FAILED / StopReason=VALIDATION_FAILED | ledger `TERMINAL_FAILURE {"reason":"HLS_MANIFEST_ADMISSION_FAILED"}`；夹具侧仅 master×2+media，**0 个分段请求**；无新制品 | EVENT 清单真实拒绝，拒绝发生在任何分段传输之前 |
| S3-UNCLOSED | legacy `hls`（master-unclosed） | 4 | 同 S2 结构 | 同上：`HLS_MANIFEST_ADMISSION_FAILED`，0 分段请求，无新制品 | 无 ENDLIST 清单真实拒绝（诚实不完整，非伪 COMPLETE） |
| S4-AES | legacy `hls`（master-aes） | 4 | 同 S2 结构 | 同上：`HLS_MANIFEST_ADMISSION_FAILED`，0 分段请求，无新制品 | EXT-X-KEY 加密清单真实拒绝（未发起密钥/分段获取） |
| S5-404 | legacy `hls`（master-404） | 4 | status：TERMINAL / UNSATISFIED / FAILED | ledger `TERMINAL_FAILURE {"reason":"VALIDATION_FAILED"}`；夹具侧真实请求 `segment000.ts` 成功、`segment-missing.ts` **源站 404**；无新制品 | 断段→真实失败终态（非 COMPLETE） |
| V02-NEGATIVES | `submit --route v0.2` ×4（event/unclosed/aes/404 intent 样例，expiresAt 重建） | 0/4 | 四例 wait 全部 FAILED terminal `CONTRACT_BINDING_MISMATCH` | — | v0.2 负例语义在安装 Core 上统一塌缩为同一绑定拒绝（预期行为，记录备查） |

## 正例输出制品校验

- 制品路径（Core 内容寻址库内）：`core-root/artifacts/final/s4artifact%3Acontract-s4-7a077bed-…​.bin`
- bytes=185368，sha256=`39f81d4bd540e5cfdd40164614ed56dc026c41602190522dd20e8720c20064bd` —— 与夹具三分段拼接期望 **完全一致**
- `ffprobe -show_entries format=format_name,duration:stream=index,codec_name,codec_type,width,height`（exit 0）：`format=mpegts, duration=6.021333`；stream0=`h264` video 320x180；stream1=`aac` audio
- 全量夹具请求账目：20 次请求 / 5 次分段（S1 三次 + S5 两次），与场景时序逐项吻合（preview 一次 master，execute 复验 master+media）

## 每步命令（驱动内等价命令，全部真实执行）

1. `node t15-final-e2e.cjs`（驱动；内部：openssl 重签 CA/server 证书 → https.createServer(127.0.0.1:443) → `node xdownload-core-host.js --root <run>/core-root --install-id t15f --user-id t15f-user --pipe-name \\.\pipe\xdownload-core-t15f` → 各场景）
2. v0.2：`node xdownload-cli.js submit|wait|status --route v0.2 --file|--lineage … --pipe-name \\.\pipe\xdownload-core-t15f --install-id t15f --user-id t15f-user`
3. legacy：ConPTY 内 `node xdownload-cli.js hls --manifest https://media.127.0.0.1.sslip.io/hls/<master>.m3u8 --pipe-name … --install-id t15f --user-id t15f-user --timeout-ms 90000|120000`
4. 校验：`ffprobe <artifact>`、`sha256sum`、sqlite `ledger.sqlite` transition_facts 读取、`core-root/seam-journal.jsonl` 读取

每步 exit code 与原始 stdout JSON 见 `events.ndjson` / `result.json` / `cli-*-stdout.json`。

## 选择与原因

- 未走路径 a：契约与安装事实双重确认空注册表即拒（见上）。v0.2 路由响应已按要求落证。
- legacy 自动化如实记录：node-pty 提供真实 TTY（已验证子进程 `stdin.isTTY && stderr.isTTY` 均为 true），交互手势为按提示符键入，非 `--yes`、非预判输入流绕过；管道、Core、夹具、TLS 校验全部真实。

## NOT_PROVEN / 边界

- EVENT/UNCLOSED/AES 的**细分拓扑码**（EVENT_PLAYLIST_TYPE / UNCLOSED_PLAYLIST / ENCRYPTED_SEGMENTS）由 Core 内部 preflight 诊断携带，安装 Core 持久层只落 `HLS_MANIFEST_ADMISSION_FAILED` 类别，CLI 状态文档 diagnostics 为空；本验证以持久层类别 + "0 分段请求"传输痕迹证明拒绝真实发生，细分码未在安装 payload 面单独落证（源码级细分行为由 T15 预备轮 in-process 运行时已覆盖）。
- v0.2 路由在安装 Core 上**无 HLS 语义端到端**（任何 HLS intent 均止于绑定拒绝）——这是部署事实，已如实记录；受信种子注入属部署动作，不在本终版候选的验证范围。
- 未测试 `--rendition` 预选与拒绝路径（canary 轮次已覆盖 S2/S3 类手势分支，本轮聚焦终版 payload 的下载/负例真相）。

## 清理确认

Core 以 `taskkill /PID /F /T` 树杀；443 端口与 49631 起无监听残留（netstat 复核）；fixture 服务器随驱动退出关闭；`_tmp/v021/t15final/` 之外的任何工作区/仓库文件未被修改。
