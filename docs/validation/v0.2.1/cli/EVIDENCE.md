# xDownload v0.2.1 — T12 CLI 无头安装路径终版验证证据（#261）

- 任务：v021-T12 final validation（dispatch `xd-v021-T12-final-20261101-01`，claim issuecomment-6554834976）
- 验证日期：2026-11-01
- 写集：`docs/validation/v0.2.1/cli/**`（本目录）
- 结论概览：**矩阵 31 用例全部执行、零环境性失败；退出码 0-6 各至少一例实证；v0.2 活路由正向链路（submit ACCEPTED → RUNNING → 真实 new-k 投影 → 契约绑定失配诚实终态）首次在安装版上打通；CF-1 EXIT=0。**限制项见 §8。

## 1. 终版候选身份

| 项 | 值 | 独立复核 |
|---|---|---|
| 源 HEAD | `52a39451dafd44ff3c2d03b93c95db78c3add126`（工位 `xd-v021-finalval` git log 一致，工作区干净） | 通过 |
| installer zip | `out/installer/xdownload-v0.2.1-windows-x64.zip` | sha256 `9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718`（本轮 sha256sum 复算一致） |
| content hash | `87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9`（installer-identity.json `contentHash`） | verify.cmd PASS 复算一致 |
| 文件数 | 全树 150；SHA256SUMS 清单 148 项（不含 sums 文件与 identity.json 自身） | 自洽 |
| payload cli | `35414eab3b8369a21f16ff45fea402543349f60187e9c517e0498f42730ca5d7` | installer-identity.json `payloadContentHashes.cli` |
| payload core | `2c057fd49ab1f806433ea3fc2ed0b7e607750091206dda73f06f54408c711da8` | 同上 `.core` |
| payload desktop | `63752077f98bee2170cc0ee53492f16d4298f06310537c6463901bb447be6a74` | 同上 `.desktop` |
| payload extension | `1257a8cb18fd189d7a5eff63520f873bb97ed03d14ab6d654ce9a090f9bbee86` | 同上 `.extension` |
| payload native-host | `631f8926784cae04f4aae85d782fcd591f933337efac86533704cede640d3389` | 同上 `.native-host` |
| identity 源修订 | `sourceRevision.sha = 52a3945…`，`dirty=false`，node 24.21.0 / pnpm 12.8.1 / esbuild 0.25.12（declared） | installer-identity.json |

安装器完整性门禁（先于矩阵执行）：

```
cmd //c verify.cmd
→ verify-installer: PASS 148 files, content sha256-87a257f5b0d1727b8ebdcf1a27b3b76b8672a1031d2855df616fbdbc098360e9 (v0.2.1)
→ EXIT=0
```

## 2. 验证环境

| 项 | 值 |
|---|---|
| OS | Windows 11（win32/x64，os.release `10.0.26300`） |
| node（驱动进程） | v24.21.0 |
| 被测形态 | **安装组合产物 payload**（`payload/cli/xdownload-cli.js` + `payload/core/xdownload-core-host.js`，esbuild 打包，非源码直跑） |
| 驱动 | `C:\xDev\kAiCreator\_tmp\v021\t12final\run-matrix-final.mjs`（纯 node 内建，零仓库写入；派生自 T12 干跑驱动 `_tmp/v021/t12/run-matrix.mjs`） |
| 原始证据流 | 本目录 `matrix.ndjson`（每用例 cmd 全量/stdout 全文/stderr/exit/duration/JSON 可解析性），43 条记录（5 条 `_meta`/派生 + 31 用例 + 收尾） |
| 矩阵耗时 | 2026-11-01T07:24:06.900Z → 07:24:14.081Z（约 7.2 s，含双 Core 启动与 hang/cancel 段） |
| Core 生命周期 | 两个 Core（TCP seam + 命名管道）由驱动持有，测试后 SIGTERM 收敛；两次 8s 未退出走了 `taskkill /F /T` 兜底（NDJSON `_core-kill-fallback`），复核 PID 53536 / 48076 已不存在、无 `xdownload-core-host` 孤儿进程、49611/49620 端口已回收 |

fixture 身份（本验证自建，不属于仓库）：

- 安装身份：`--install-id t12f --user-id t12f-user`；管道 `\\.\pipe\xdownload-core-t12f`
- TCP seam Core：`--root …\t12f-core-data --port 49611`；管道 Core：`--root …\t12f-core-data-pipe --pipe-name …t12f`（同一安装身份、独立持久根）
- fixture origin：`http://127.0.0.1:49620`（驱动进程内 http server）
  - `/file.bin`：256 KiB 确定性字节（`i%251`），sha256 `31a1f9dea0169551092d05e8bf4a446228c8c3eb4c9b713c66adcb7fd53c89be`
  - `/missing.bin`：恒 404；`/hang.bin`：响应头 100 字节但永不发体（真实悬挂）；`/master.m3u8`+`/media.m3u8`：最小 HLS VOD
- v0.2 intent：以 T02-R1 smoke 模板 `intent-t02r1-smoke.json` 重建（形状与 displayedTupleDigest 字面量一致，confirmedAt/expiresAt 刷新为新鲜确认窗，lineage 换新 `lineage-t12f-v02-001`，outputRootScope 指向验证输出根）
- 端口区事实：本机 47611..486xx 为 winnat/Hyper-V 隐式保留段（bind 报 EADDRINUSE/EACCES 且无监听者，T12 干跑已实证）；本轮按 49611（seam）/49620（origin）/42619（负例死口）执行，全部一次绑定成功，无 `_meta-port-conflict`

## 3. 矩阵总表（31 用例）

stdout JSON 关键字段摘录（全文见 `matrix.ndjson`；`diag=` 为 rejection 文档 `diagnostics[0].code`，`error.code` 为 domain-app 错误文档字段）：

| 用例 | exit | stdout JSON 关键字段 |
|---|---|---|
| a-help | 0 | (usage text, non-JSON) |
| b1-legacy-submit-file | 0 | document=xdownload.cli.acceptance outcome=ACCEPTED contract_id=contract-t12f-sub-001 revision=1 needs_user_action=false |
| b1b-submit-needs-user-action | 3 | document=xdownload.cli.acceptance outcome=ACCEPTED contract_id=contract-t12f-nua-001 revision=1 needs_user_action=true |
| b2-s1-download-digest | 0 | document=xdownload.cli.status contract_id=contract-s1-512ece7f-5d2d-46 RequestFulfillmentStatus=COMPLETE target_evidence_basis=PUBLISHED_SHA256 certainty=DECISIVE StopReason=NONE failed_member_count=0 lineage_status=TERMINAL |
| b2b-s1-download-nodigest | 0 | document=xdownload.cli.status contract_id=contract-s1-e60f3e8d-82ed-48 RequestFulfillmentStatus=COMPLETE target_evidence_basis=REQUESTED_LOCATOR_PROVENANCE certainty=PROBATIVE lineage_status=TERMINAL |
| b3-s1-download-404 | 4 | document=xdownload.cli.status contract_id=contract-s1-8faea90d-f2ea-47 RequestFulfillmentStatus=UNSATISFIED StopReason=VALIDATION_FAILED failed_member_count=1 lineage_status=TERMINAL |
| c1-status-completed | 0 | document=xdownload.cli.status（与 b2 投影一致，COMPLETE/TERMINAL） |
| c2-wait-completed | 0 | document=xdownload.cli.status（已终态，wait 立即返回 exit 0） |
| c3-wait-bounded-timeout | 6 | document=xdownload.cli.wait-timeout state=BOUNDED_WAIT_TIMEOUT note="bounded wait elapsed without a projected terminal result; no status was invented" |
| c5-cancel-hang-mid-wait | 0 | document=xdownload.cli.acceptance outcome=ACCEPTED contract_id=contract-s1-23c939e4-388a-4b revision=3 |
| c4-hang-download-background | 4 | document=xdownload.cli.status StopReason=USER_CANCELLED RequestFulfillmentStatus=UNSATISFIED lineage_status=TERMINAL（origin 侧 `_origin-event hang-socket-closed` 证明悬挂 socket 被真实拆除） |
| c6-retry-terminal-failed | 2 | document=xdownload.cli.rejection diag=LATE_COMMAND invariant=L2-§11 "lineage is TERMINAL; late retry command is recorded and rejected, terminal truth unchanged" |
| c7-batch-two-contracts | 0 | document=xdownload.cli.batch-result accepted_count=2 rejected_count=0 input_error_count=0 |
| d1-v02-status-unknown-lineage | 2 | document=xdownload.cli.domain-app.error code=JOB_PROJECTION_UNAVAILABLE message="no v0.2 job projection exists for this lineage" |
| d2-v02-wait-unknown-lineage | 2 | 同上（立即拒绝，76-95ms，无预算消耗） |
| d3-v02-cancel-unknown-lineage | 2 | code=SCOPE_WIDENING_REFUSED |
| d4-v02-submit-live-route | 0 | document=xdownload.cli.domain-app.sent status=RUNNING raw_status=ACCEPTED terminal=false（活路由正向提交成功） |
| d4b-v02-status-immediate | 4 | document=xdownload.cli.domain-app.status status=FAILED terminal=true error.code=CONTRACT_BINDING_MISMATCH |
| d4c-v02-wait-terminal | 4 | status=FAILED terminal=true error.code=CONTRACT_BINDING_MISMATCH（message="opaque targetRef did not resolve"） |
| d4d-v02-status-terminal | 4 | status=FAILED terminal=true error.code=CONTRACT_BINDING_MISMATCH（收敛后投影稳定） |
| d4e-v02-cancel-terminal-lineage | 2 | code=SCOPE_WIDENING_REFUSED（终态 lineage 上 cancel 被类型化拒绝） |
| d5-v02-submit-missing-selection | 2 | code=MISSING_REQUIRED_FIELD（Core 权威再校验） |
| d6-v02-submit-wrong-operation | 2 | code=CONTRACT_BINDING_MISMATCH（S4 仅接受 media.acquire） |
| f1-missing-install-id | 1 | document=xdownload.cli.error error=USAGE |
| f2-bad-url-schema | 1 | error=USAGE（ftp:// 非绝对 http(s)） |
| f3-port-and-pipe-together | 1 | error=USAGE（--pipe-name 与 --port 互斥） |
| f4-unknown-verb | 1 | error=USAGE（未知动词 frobnicate） |
| f5-v02-download-refused | 1 | error=USAGE（download 不准入 --route v0.2） |
| f6-core-not-running | 5 | error=TRANSPORT（127.0.0.1:42619 连接拒绝） |
| g1-pipe-submit-success | 0 | document=xdownload.cli.acceptance outcome=ACCEPTED contract_id=contract-t12f-pipe-001（经命名管道 `\\.\pipe\xdownload-core-t12f`） |
| g2-pipe-identity-mismatch | 2 | document=xdownload.cli.rejection diag=PEER_IDENTITY_REJECTED invariant=L2-§12 "peer is not the expected same-install/same-user identity"（--user-id t12f-other-user 被拒） |

### 3.1 退出码 0-6 全覆盖实证

| 码 | 语义（`apps/cli/src/render.ts` EXIT 表） | 本轮实证用例 |
|---|---|---|
| 0 | SUCCESS | a-help、b1、b2、b2b、c1、c2、c5、c7、d4、g1 |
| 1 | USAGE | f1、f2、f3、f4、f5 |
| 2 | REJECTED（seam 类型化拒绝，诊断逐字投影） | c6、d1、d2、d3、d4e、d5、d6、g2 |
| 3 | NEEDS_USER_ACTION | b1b（selectionPolicy.basis=EXPLICIT_USER_SELECTION → needs_user_action=true） |
| 4 | TERMINAL_NON_SUCCESS | b3（VALIDATION_FAILED）、c4（USER_CANCELLED）、d4b/d4c/d4d（CONTRACT_BINDING_MISMATCH） |
| 5 | TRANSPORT | f6（ECONNREFUSED 死口） |
| 6 | WAIT_TIMEOUT | c3（BOUNDED_WAIT_TIMEOUT，不发明状态） |

### 3.2 JSON 恒可解析

31 用例中除 a-help（usage 文本，属文档化形态）外 30/30 的 stdout 首行 JSON 全部 `JSON.parse` 通过（`stdoutJsonParseOk=true`）；进度/模式行与诊断说明均在 stderr。无一例 stdout 不可解析。

## 4. legacy S1 全链要点

- **fixture 下载 + sha256 复算**：b2 对 `/file.bin` 带 `--sha256` 声明下载 → exit 0 COMPLETE，`PUBLISHED_SHA256/DECISIVE`；证据侧独立读回落盘产物 `t12f-core-data\artifacts\final\s1artifact-512ece7f-5d2d-46.bin`（262144 字节）复算 sha256 = `31a1f9de…` 与源字节一致（NDJSON `_derived-b2-artifact sha256VerifiedOnDisk=true`）。
- **证据基区分**：b2b 无声明摘要下载 → `REQUESTED_LOCATOR_PROVENANCE/PROBATIVE`（与 b2 的 `PUBLISHED_SHA256/DECISIVE` 正确区分，C34 证据基承诺成立）。
- **诚实失败**：b3 origin 404 → exit 4 UNSATISFIED/VALIDATION_FAILED，`failed_member_count=1`（真实失败成员，非掩盖）。
- **中途取消**：c5 在 hang 悬挂中 cancel（--expected-revision 2）→ exit 0 ACCEPTED revision 3；后台 wait 立即 exit 4 `USER_CANCELLED`；origin 侧记录 hang socket close 事件（真实拆除，非客户端假关闭）。取消锚点纪律：origin 计数与 journal 顶均取 hang 前基线、严格前移才采样（T12 干跑 D 节教训的固化，本轮一次命中）。
- **终态不可变**：c6 对 b3 终态合同 retry → exit 2 LATE_COMMAND（L2-§11），terminal truth 不变。
- **批量**：c7 batch 两合同 → accepted_count=2。
- **status/wait**：c1/c2 对已终态合同 exit 0 立即投影；c3 有界等待未终态合同 → exit 6 不发明状态。

## 5. v0.2 活路由（#287 修复后的安装版行为）

T12 干跑（旧基线）曾判 v0.2 路由 fail-closed 不可用（`provider is not installed`）；**本终版候选已含 #287/T02-R1 修复，活路由行为首次在安装版上实证**：

1. `d4 submit --route v0.2`（合法 S4 intent，新鲜确认窗）→ exit 0，`xdownload.cli.domain-app.sent`，workflow `RUNNING`；
2. `d4b/d4c/d4d status/wait` → 真实 new-k 投影：`status=FAILED terminal=true`，`error.code=CONTRACT_BINDING_MISMATCH`，message `opaque targetRef did not resolve`——这是**无种子 targetRef 下的诚实终态**（intent 的 `ref:t12f-unseeded-target` 未在 Core 播种 mediaTargetRefs，绑定校验在任何网络活动前失败；d4b 84ms 即已 FAILED），按任务口径如实记录为**预期行为**；
3. `d4e cancel`（终态 lineage）→ exit 2 `SCOPE_WIDENING_REFUSED`；
4. 未知 lineage 的 status/wait → exit 2 `JOB_PROJECTION_UNAVAILABLE`，但 message 为 **"no v0.2 job projection exists for this lineage"**（逐 lineage 无投影），与干跑 fail-closed 形态的 "no v0.2 job projection provider is installed"（provider 缺失）是同码不同义——本轮属活路由下的类型化拒绝，不是路由缺失；
5. 形态校验在 Core 侧权威执行：缺 selection → `MISSING_REQUIRED_FIELD`；operation 非媒体获取 → `CONTRACT_BINDING_MISMATCH`；
6. `download` 在 v0.2 路由准入控制正确：f5 exit 1 USAGE。

## 6. 管道传输

- g1：`--pipe-name \\.\pipe\xdownload-core-t12f` 提交 → exit 0 ACCEPTED（Windows 命名管道正向）。
- g2：同管道、同 install-id 但 `--user-id t12f-other-user` → exit 2 `PEER_IDENTITY_REJECTED`（L2-§12，same-install/same-user 身份约束）。
- f3：`--pipe-name` 与 `--port` 互斥 → exit 1 USAGE。

## 7. CF-1 — 无头权威测试（finalval 工位）

```
cd C:\xDev\kAiCreator\xDownload\xd-v021-finalval
corepack pnpm exec vitest run apps/cli/test/headless-authority.test.ts
→ ✓ apps/cli/test/headless-authority.test.ts (6 tests) 56ms
→ Test Files 1 passed (1); Tests 6 passed (6); Duration 1.03s
→ EXIT=0
```

全量输出：本目录 `cf1-headless-authority.log`。工位 git 状态保持干净（测试零仓库写入）。

## 8. NOT_PROVEN / 限制项（诚实列出）

1. **retry 的成功投影在装机路径不可达**（NOT_PROVEN，口径与 T12 干跑 A2 一致）：真实 Core 上失败成员只在执行后产生，而执行即闭合 lineage 为 TERMINAL，故 CLI 只能命中 LATE_COMMAND 拒绝；单测里的 `seam.server.recordFailedMembers`（非终态+已录失败成员）是测试专用 API，安装组合根无对应入口。本轮实证的是 retry 的**终态不可变拒绝语义**（c6），不声称覆盖 retry 成功重试投影。
2. **v0.2 正向 COMPLETE 获取未证**：受控 intent 的 targetRef 无种子，绑定失配是诚实终态；"submit → RUNNING → 传输 → COMPLETE" 的完整正向获取需给 Core 播 mediaTargetRefs 种子，本轮矩阵不含该形态（本条仅限 targetRef 绑定链路为 PROVEN）。
3. **d4e 与 T02-R1 smoke 的终态 cancel 拒绝码不同**：本轮传 `--reason` 得 `SCOPE_WIDENING_REFUSED`；T02-R1 smoke 未传 `--reason` 得 `MISSING_REQUIRED_FIELD`。两者均为 exit 2 类型化拒绝，本轮如实记录实际观察，不对差异根因下断言。
4. **desktop / extension / native-host payload 仅覆盖完整性维度**（verify.cmd PASS + SHA256SUMS 全量复算），未做功能性验证——T12 范围为 CLI/Core 无头车道。
5. **confirm 动词未驱动**：b1b 已证 NEEDS_USER_ACTION 状态的机器可读上报（exit 3），但确认闭环（confirm 命令执行）不在本轮矩阵。
6. **HLS 拉流路径未在本矩阵激活**：v0.2 intent 的 manifest/rendition URI 指向模板原值（media.example.com），绑定失配先于任何网络活动，S4 HLS 实际拉流仅由 fixture origin 的 m3u8 端点存在性佐证服务形态，未做端到端 HLS 下载验证。
7. **端口区为单机事实**：47611..486xx winnat 保留段与 49611/49620/42619 可用性是本机观察，其他主机需重测（驱动内置 bind 失败自动换候选环）。
8. **单次运行**：矩阵为单轮执行证据（驱动幂等可重跑；Core 持久根每轮清空以保证 clean-run 语义）。未做多次重复统计。

## 9. 证据文件清单

| 文件 | 内容 |
|---|---|
| `EVIDENCE.md` | 本文档 |
| `matrix.ndjson` | 原始证据流（43 条 NDJSON：_meta×6 + 31 用例 + 收尾/事件） |
| `cf1-headless-authority.log` | CF-1 vitest 全量输出（EXIT=0） |
| `verify-installer.log` | verify.cmd PASS 输出（EXIT=0） |

驱动与本矩阵的实际执行副本在 `C:\xDev\kAiCreator\_tmp\v021\t12final\`（`run-matrix-final.mjs`、`matrix-run.log`；`_tmp` 为临时区，不随仓库流转，本文档已内联全部结论性数据）。
