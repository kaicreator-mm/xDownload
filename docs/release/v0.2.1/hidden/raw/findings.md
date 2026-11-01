# T19 Hidden Validation（#268）— 对抗性验证 findings

- 验证对象（冻结候选，只读）：`C:/xDev/kAiCreator/xDownload/xd-v021-finalval/out/installer/xdownload-v0.2.1-windows-x64/payload`（zip 9ea81169…，controller 记录）
- install-id `t19h`，user-id `15549`，管道 `\\.\pipe\xdownload-core-t19h`，fixture 端口 49651/49652，CDP 端口 49661
- 证据：`runs.ndjson`（225 步，含每步命令/exit/输出）、`fixture-requests.jsonl`（23 条 origin 请求）、`env/env-record.json`、`case8/cdp-probes.json`、`drivers/*.mjs`（全部驱动可重放）
- 环境：Windows 10.0.26300 x64，Node v24.21.0，冻结 payload 原样运行，未写仓库
- 攻击面说明：seam 管道为 **4 字节大端长度前缀帧**；普通 `net.createConnection` 客户端被 OS 验证准入**静默拒收**（实证 EPIPE、服务器零响应），故全部伪造用例经 koffi `CreateFileW`（`SECURITY_SQOS_PRESENT|SECURITY_IMPERSONATION`，镜像 `win-ipc.ts openNamedPipeClient`）的原始管道客户端发送——OS 准入层只证明同用户/同登录会话，信封身份字段完全由攻击者控制，符合设计。

## 总判定

9 例全部 **PASS**（无 FAIL-ESCAPED、无崩溃、无假成功、无凭证泄漏）。4 条信息性备注（与冻结语义一致或属加固建议），详见各例。

## 用例1 路径 — PASS

安装版 v0.2 路由为 **S4 HLS VOD 业务道**（`v02IntentDecoder=validateConfirmedS4HlsIntent`）。raw-pipe 全字段可控提交：

| 子例 | 结果 |
|---|---|
| 根含 `..`（反斜杠/正斜杠/混合分隔符，字面量构造） | REJECTED `OUTPUT_ROOT_ESCAPED`（效果前拒绝） |
| 相对根 / UNC 风格根 / 513 字符超长根 | REJECTED `MALFORMED_REQUIRED_FIELD`（绝对路径/长度界） |
| NTFS 保留名（`CON` 段/尾段）、Unicode U+2025 点号、大小写变体、`.` 段、符号链接根 | 语法层放行（本身非遍历），全部被**可信 targetRef 注册表屏障**拦截：路由日志记录 `CLAIM→ATTEMPT→OUTCOME FAILED CONTRACT_BINDING_MISMATCH`，零网络、零文件效果；符号链接目标目录实测空 |
| 意图附加字段 | REJECTED `SCOPE_WIDENING_REFUSED`（no-widening） |
| targetRef 为原始 URL / 绝对路径 | 接缝层按有界不透明令牌放行，但永不解析：`LOCATOR_SUBSTITUTION_REJECTED` / `CONTRACT_BINDING_MISMATCH` |
| 泄漏扫描（证据树，含 `pwned` 特征目录名） | 0 命中 |

legacy 道：制品字节只落在 `core-root/artifacts/final/s1artifact-<派生基>.bin`（`fileSafeName` 编码 + `assertArtifactId` 拒 `..`）。**加固备注**：原始 `SUBMIT_CONTRACT` 接受 `contract-a/../../evil` 形态的合同 id（ID_PATTERN 允许 `/`，接缝无 `..` 过滤）；实测零路径效果（制品 id 由 CLI 派生、与合同 id 无关；journal/sqlite 均为非路径键）。建议未来在接缝 ID 语法中收紧——非逃逸，记录为 hardening note。

## 用例2 身份 — PASS

- 错误 install-id / user-id、空 id、非法字符、129 字符、未知 surface（`SYSTEM`）、小写 `cli`、peer 附加字段 → 全部 REJECTED `PEER_IDENTITY_REJECTED`。
- S3 挑战命令（decode 合法载荷）：CLI 面 → 通过门禁（`AGGREGATE_NOT_FOUND`）；DESKTOP_UI / BROWSER_EXTENSION 冒充 → REJECTED `ADMISSION_REJECTED`（每命令面门禁生效）。
- **信息备注（与冻结语义一致）**：`SUBMIT_CONTRACT` 等无面门禁命令接受 DESKTOP_UI/BROWSER_EXTENSION 身份冒充（`allowedSurfaces` 在该管道含全部三面）。OS 验证只约束同用户/同登录进程，surface 是自声明字段。非绕过——桌面壳与扩展本身就是该管道的合法 peer。
- 单例：同管道名第二个 Core 启动即退（exit 5，`TRANSPORT_REFUSED: CreateNamedPipeW GetLastError=5`），首 Core 健康不受影响。

## 用例3 权限 — PASS

- broker 未授权 origin（形态正确但未列名）/ 无 origin / 畸形 origin → 会话拒绝 exit 2，无回退路径。
- **篡改 `--config`（攻击者可写副本）**：本地 origin 检查按配置放行，但 broker 逐帧校验仍 fail-closed（`TRANSPORT_REJECTED / UNKNOWN_FIELD`）。本地 origin 列表属纵深防御，平台边界是 Chromium manifest `allowed_origins`——与冻结设计一致。
- Core 未启动：CLI status/download/cancel 与 raw-pipe v0.2 查询全部瞬时 `TRANSPORT` 错（exit 5 / CreateFileW err=2），无挂死无崩溃；重启后投影如实重放（先前 FAILED 仍为 FAILED）。

## 用例4 恢复 — PASS（真实断流）

4 MiB `/glacial.bin`（约 4 分钟）传输约 10 秒时 `taskkill` Core（pid 文件精确杀，无模式匹配）：
- CLI 在途等待即时转 exit 5 `TRANSPORT`（无假成功）；适配器在内存累积字节，**无任何部分制品落盘**（staging 快照为空，零半成品文件）。
- 重启后 `status`：`TERMINAL / RequestFulfillmentStatus=UNKNOWN / SelectionAcquisitionStatus=NOT_STARTED / validated_success_count=0`——**无假 COMPLETE**，终止真相不被重写；`wait` exit 4（终止非成功）。
- 同 lineage 再提交语义见用例5（v0.2 生成新 attempt，legacy 拒 `REVISION_MISMATCH`）。

## 用例5 重复/并发 — PASS

legacy 道：同 requestId 精确重放或换载荷 → REJECTED `IDEMPOTENCY_CONFLICT`（注意：重放因 `issuedAt` 不同被判冲突——严格 fail-closed，不二次施加，但非收敛语义）；同 lineage 新 requestId+expectedRevision 0 → `REVISION_MISMATCH`；并发同 id → 一 ACCEPTED 一 CONFLICT。
v0.2 道：同 requestId 重放 → ACCEPTED `converged:true`；同 requestId 换 lineage → 收敛到**原**接受书（无第二效果，投影证实 `lin-c5-vX` 从未存在——冻结代码明示行为，信息备注）；同 lineage 新 requestId → 新 attempt `#2` 如实入投影；并发同 id 有一连接 `ERROR_PIPE_BUSY`（Windows 管道瞬时忙，客户端重试即收敛，fail-closed）。

## 用例6 重定向 — PASS

- 同主机 302 未显式声明 → 跟随并 COMPLETE（冻结语义：locator 主机恒在声明集内）。
- 跨主机 302 未声明 → 拒绝且不跟随（fixture 证实无 49652 请求），truthful FAILED。
- 跨主机 302 声明 `127.0.0.1:49652` → 跟随并 COMPLETE；声明错误主机 → 拒绝。
- 重定向环 → 恰好 5 跳后 `REDIRECT_SCOPE_EXPANSION`（有界跳数）。
- 畸形 `--redirect-host` / 9 个主机 → CLI USAGE exit 1。

## 用例7 凭证形态 — PASS

- seam `PREVIEW_S4_HLS_VOD`：query-token / userinfo / fragment / 显式端口 / 公网 http / IP 字面主机 → 全部 REJECTED `ENVELOPE_MALFORMED`（credential-free 语法）。
- CLI `hls --manifest '?token=…'` → USAGE 拒绝（在任何 TTY 需求之前）。
- v0.2 意图 selection URI 带 query → REJECTED `MALFORMED_REQUIRED_FIELD`。
- 残留扫描：`core-root` 全部持久物（journal/ledger/route-log/k-documents）**零命中**；唯一命中在攻击者自有 `runs.ndjson`（证据日志记录探针本身，非产品数据）。

## 用例8 渲染器 IPC（CDP 实测打包 exe）— PASS

`xdownload.exe --remote-debugging-port=49661`：
- `window.require/process/Buffer/module/global/ffi/koffi` 全 `undefined`（sandbox 生效）；应用唯一全局为 `xdownloadShell`。
- `window.open('https://example.com/')` → 目标数增量 0（deny-all 生效）。
- `location.href='https://example.com/'` → 导航被守卫拦截，URL 不变。
- CSP `default-src 'none'; script-src 'self'; …` 存在且内联脚本探针未执行；页面仅本地 file:// 资源。

## 用例9 lineage-owner — PASS（双向可构造）

- legacy 命令指向 v0.2 K 已 CLAIM 的 lineage（含已 FAILED 终止的）→ REJECTED `LINEAGE_OWNER_CONFLICT`（效果前拒绝）。
- v0.2 send 指向 legacy 已注册且 COMPLETE 的 lineage → REJECTED `LINEAGE_OWNER_CONFLICT`。
- 全新 lineage 双道均正常准入（无交叉污染）。

## 收尾核验

Core（pid 48876）按 pid 文件 `taskkill /T /F` 终止；fixture（49651/49652）与桌面 exe（49661）后台任务停止；`netstat` 无残留监听，`tasklist` 无 xdownload.exe 进程。`runs.ndjson` 225 步全量可重放。
