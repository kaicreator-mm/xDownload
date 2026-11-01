# T17 会话表单模板（每参与者 × 每 arm 一份）

使用说明：

1. 复制本文件为 `sessions/P<n>-arm-<A|B>.md`（如 `P1-arm-A.md`、`P2-arm-B.md`），逐项填写。
2. **执行中实时填写**，不事后回忆补写；确需补写的在备注注明"事后补记"。
3. 计量口径以 `../PROTOCOL.md` §6 为准；任务原文以 §4 为准，照抄不转述。
4. 落笔（入仓）前对照 `../PROTOCOL.md` §7 完成脱敏自查（模板末有勾选项）。

---

# T17 session — P<n> arm <A|B>

```yaml
participant: P1                       # 匿名代号，不留身份信息
arm: A                                # A=浏览器默认下载基线 | B=xDownload 终版候选
task_order: [T-A, T-B, T-C]           # 实际执行顺序（须与 PROTOCOL §2 交替设计一致：P1 A→B，P2 B→A）
host: <同一台机器：OS/版本、CPU 简述、内存、网络一句话>   # P12 同主机口径
candidate: not-applicable             # arm A 固定填 not-applicable
# arm B 填：zip sha256=9ea811694a2b8638a307266a402dc25f5ec0a8eead371f4b12cb0ba564f6e718；sourceRevision=52a39451dafd44ff3c2d03b93c95db78c3add126
executed_at: 2026-11-XX               # 执行日期
assistant_present: none               # none | <主试角色，如 owner-as-proctor>
arm_baseline_tool: browser-default    # arm A 必填且两参与者一致（PROTOCOL §5 固定为浏览器默认下载）
arm_b_interface: n/a                  # arm B 填 ui|cli（参与者自选后如实记录）
install_duration_sec: n/a             # arm B 填首次 install.cmd 安装耗时（秒）
arm_gap_note: <两 arm 间隔与执行时段，如"同日 14:00 A→B 连续执行">
```

## T-A 直链（~50MB，一次重定向）

- 任务目标原文（照抄）："请把这个文件下载到磁盘：`<重定向 URL>`。完成后告诉我文件在哪里。"
- 时间戳：start=`HH:MM:SS` end=`HH:MM:SS` 净时长=`<s>`
- 步骤流水（逐条勾记，相对秒）：
  - [ ] 1. `<动作>` @ `+<s>`
  - [ ] 2. `<动作>` @ `+<s>`
- 错误与恢复：`<无 | 事件 + 时刻 + 恢复动作>`
- 求助：`<0 次 | 次数 + 内容 + 类别（环境/任务）>`
- Likert：省力度=`<1-5>` 可控度=`<1-5>`
- 自由备注：`<参与者原话摘要 / 主试观察>`

## T-B 批量（5 文件）

- 任务目标原文（照抄）："请把这个清单里的 5 个文件都下载到磁盘：`<manifest URL / 清单>`。"
- 时间戳：start=`HH:MM:SS` end=`HH:MM:SS` 净时长=`<s>`
- 步骤流水：
  - [ ] 1. `<动作>` @ `+<s>`
- 错误与恢复：
- 求助：
- Likert：省力度=`<1-5>` 可控度=`<1-5>`
- 自由备注：

## T-C 失败恢复（404 → 正确 URL）

**T-C1 对失败 URL 的尝试**

- 任务目标原文（照抄）："请下载这个文件：`<404 URL>`"
- 时间戳：start=`HH:MM:SS` end=`HH:MM:SS` 净时长=`<s>`
- 错误如何呈现（参与者实际看到什么，各 arm 真实形态）：`<照实描述>`
- 参与者自发动作流水（诊断/重试/求助/放弃）：
  - [ ] 1. `<动作>` @ `+<s>`
- 求助：
- 转入 T-C2 的时刻与触发（参与者求助/明确放弃 → 主试按剧本给出正确 URL）：`@ +<s>`

**T-C2 拿到正确 URL 后重做**

- 剧本原文（照抄）："正确的地址其实是 `<正确 URL>`，请把它下载完成。"
- 时间戳：start=`HH:MM:SS` end=`HH:MM:SS` 净时长=`<s>`
- 步骤流水：
- 错误与恢复：
- 求助：

**T-C 汇总**：净时长合计=`T-C1 + T-C2 = <s>`；错误事件合计=`<n>`

- Likert：省力度=`<1-5>` 可控度=`<1-5>`
- 自由备注：

## arm 收尾

- arm 总评 Likert：省力度=`<1-5>` 可控度=`<1-5>`
- 参与者一句话总结（原话摘要）：
- 主试观察备注（环境异常 / 偏差声明 / 中止与排除事件，如无写"无"）：
- 脱敏自查（PROTOCOL §7）：[ ] 无真实姓名 [ ] 无个人标识主机名/路径 [ ] 无任务外个人信息 [ ] 录屏（如有）未入仓
