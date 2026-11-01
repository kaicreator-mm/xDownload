# xDownload v0.2.1 — T17 结果占位（HUMAN_SESSIONS=NOT_RUN，#266）

- 任务：v021-T17 human effort study（dispatch `xd-v021-T17-final-20261101-01`，claim issuecomment-6556076594）
- 状态日期：2026-11-01
- 写集：`docs/validation/v0.2.1/human/**`（本目录）

## 1. 状态声明

| 项 | 值 |
|---|---|
| **HUMAN_SESSIONS** | **NOT_RUN** |
| G0 三问证据（easier / more reliable / lower-friction） | **NOT_RUN**（零真人会话数据） |
| G1 判定 | **NOT_APPLICABLE_THIS_CANDIDATE**（依据 `PROTOCOL.md` §8；该判定不依赖会话数据） |
| INDEPENDENT_REVIEW | NOT_RUN（无可评审的会话数据；协议与表单本身可随 PR 先行评审） |
| MAIN_MERGE | NO（本工位不推送，由 controller 决定后续） |

任务包原文（TASK_PACKS_R0 T17，Acceptance）：

> privacy-safe protocol, comparable tasks, raw observations and limitations. **Agents cannot manufacture human sessions.**

T17 的会话数据只能由真人产生。截至 2026-11-01 无任何真人会话执行；本文件是占位，**不是结果**。在真人会话完成并回填之前，任何工具、代理或文档不得将本目录表述为"已验证 G0"；后续门禁（T18/T21）与本目录状态必须保持一致。

## 2. owner 执行入口

按 `PROTOCOL.md` 执行；预计每参与者约 **30-45 分钟**（含 arm B 一次性安装）。

准备清单：

1. 终版候选 zip 本地就位：`xdownload-v0.2.1-windows-x64.zip`，sha256 `9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718`（安装前可复算校验）。
2. 夹具：本地受控 HTTP fixture（`PROTOCOL.md` §4 三任务形状：~50MB 一次重定向 / 5 文件清单 / 真实 404 路径 + 正确 URL），动态空闲端口，文件字节确定性并预记录 sha256。
3. 任务原文与 T-C 剧本投屏或打印（`PROTOCOL.md` §4 照抄）；秒表或录屏（录屏只拍夹具页与本地 UI，不入仓）。
4. 参与者 2 名：P1=owner（A→B），P2=非开发参与者（B→A）。

执行：

- 顺序交替（`PROTOCOL.md` §2）：P1 arm A → P1 arm B；P2 arm B → P2 arm A。
- 表单：复制 `sessions/SESSION-TEMPLATE.md` 为 `sessions/P<n>-arm-<A|B>.md`，**执行中实时填写**。
- 排除/中止按 `PROTOCOL.md` §9；timeout 与安装障碍如实入表，不丢弃。

完成后：

- 将本文件替换为 `RESULTS.md`（或新建 `RESULTS.md` 并删除本占位），内容：每任务 A/B 中位数与极差、G0 三问各自证据（引用 sessions 原始表单）、G1 维持 NOT_APPLICABLE_THIS_CANDIDATE、原样引用 `../LIMITATIONS.md`。
- 更新本目录任何状态表时不得回改 `PROTOCOL.md` 口径；口径变更须以协议新版本显式记录。

## 3. 数据回填后 T18/T21 如何升级

- **T18（Candidate Freeze，gate board）**：当前 T17 在 gate board 上为 `NOT_RUN (human-owned, pending owner execution)`——T18 不得引用本目录作为 G0 证据。会话回填且 `RESULTS.md` 产出、独立评审通过后，T17 升级为对应结论：G0 三问有证据支持 → `PASS`（附 RESULTS.md）；出现反例或中止/排除异常 → 按任务包 stop rules 走失败处理，不得静默降级。
- **T21（Release Qualification）**：RQ 决策（READY/CONDITIONAL/BLOCKED/FAIL）必须显式携带 T17 状态。当前状态下 T17=NOT_RUN 是显式条件——**不得凭 T12-T16 的机器证据推断 G0**；如 RQ 在会话回填前出具，只能给 CONDITIONAL/BLOCKED 并把人工研究列为条件或排除项。回填后 RQ 复核 claim set 中的人工证据项后方可解除。
- 唯一合法升级路径：**真人会话 → 表单入仓（脱敏自查）→ RESULTS.md → 独立评审 → T18/T21 复核**。不存在"协议定稿即视为研究完成"的捷径。
