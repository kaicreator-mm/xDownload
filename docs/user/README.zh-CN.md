# xDownload v0.2.1 用户指南（中文）

> **候选文档，不是发布公告。** 源码基线：version/v0.2.1@56f9e16d8d7afb29b2a493c07bdf4f886a0bf445。T12–T17 尚需真实安装/浏览器/桌面/HLS/人工体验验证，源代码任务的合并不等于这些测试通过。

Agent 使用契约：[English](../agent/README.md)。本文以实际构建及 CLI 源码为准，任何最终版本更新后必须重验命令和安装流程。

## 能做什么、不能承诺什么

- **架构**：一个本地 Core 进程，唯一的 DomainHarness Kernel；CLI、浏览器扩展和桌面 UI 只是客户端，不创建第二套执行授权。
- **选定安装目标**：Windows x64 + Node.js 24；仓库当前固定 Node 24.21.0、pnpm 12.8.1。Linux、macOS、自动更新、代码签名、应用商店分发均没有 v0.2.1 发布资格证据。
- **CLI**：保持 legacy v1 路由；仅显式 --route v0.2 使用新 Domain App 路由，失败不会暗中降级到 v1。目前新 K 通路可受理受控 S4 HLS 意图；直接下载/取消等 v0.2 操作可能被 Core 明确拒绝，不能宣传为已支持。
- **浏览器**：Manifest V3 扩展使用用户授权与本地 Native Messaging Host，真实 Chromium 会话/权限负例仍需 T13 验证。无需、也不应复制 Cookie/授权凭据到模型或日志。
- **桌面**：基础下载管理视图、严格 IPC 已实现，打包 Electron 的实际用户旅程和历史任务枚举仍有已知限制。
- **HLS**：只在明确授权和选择清晰度后进行有限点播 HLS 下载，使用现有引擎及 FFmpeg/ffprobe。直播、DRM、模糊播放列表不能绕过授权或假装完成。

## 源码构建候选（不等于安装成功）

在 pnpm monorepo 根目录：

~~~text
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/cli/xdownload-cli.js help
~~~

构建生成经过内容审计的 dist/cli、dist/core、dist/extension、dist/native-host 等目录。仅在 **Windows x64 且原生运行库完备** 的主机组合候选安装包：

~~~text
node installers/compose-installer.ts --version 0.2.1
~~~

安装包组合器对非选定 OS/架构和缺失的原生运行库会拒绝，不生产残缺但宣称合格的 Windows 安装包。

## Windows x64 用户安装

从经过独立 SHA256 校验、与最终候选源码绑定的 ZIP 解压。以包内 INSTALL.txt 为最终细节依据（源码位于 scripts/install-host/INSTALL.txt）。

1. 在解压目录运行 verify.cmd，要求 PASS。失败时不得执行安装。
2. 从 chrome://extensions 获取浏览器实际分配的 32 字母扩展 ID；占位、通配符或猜测的来源一律不得使用。
3. 运行 install.cmd --extension-id <实际ID>，按需加 --install-id xdownload、--user-id <本机用户ID> 或 --launch-core。只进行当前用户 HKCU 注册，不覆盖已有 Native Messaging 注册。
4. 执行 status.cmd 核对注册路径和唯一 Core 命名管道；保证仅启动一个 Core。
5. 在 Chromium 系浏览器加载包中的 payload/extension，确认扩展 ID 和注册来源完全一致。
6. 升级时先停止 Core、运行上版 uninstall.cmd，再安装新版；没有静默覆盖或自动升级保证。

上述步骤是操作说明，本次文档工作未执行真实 Windows 安装。

## CLI 命令及状态

当前真实解析入口：apps/cli/src/args.ts、apps/cli/src/main.ts。示例中的 <...> 都必须替换为真实参数。可以使用合法本地 --port，或者 Windows 上与 install-id 精确对应的 --pipe-name；**Core 连接失败不会从命名管道静默回退到 TCP**。

~~~text
node dist/cli/xdownload-cli.js status --contract <contract-id> --install-id <install-id> --user-id <user-id> --port <core-port>
node dist/cli/xdownload-cli.js --route v0.2 status --lineage <lineage-id> --install-id <install-id> --user-id <user-id> --port <core-port>
node dist/cli/xdownload-cli.js --route v0.2 wait --lineage <lineage-id> --timeout-ms 30000 --poll-ms 200 --install-id <install-id> --user-id <user-id> --port <core-port>
~~~

这些是**对照源代码的候选示例，不是已执行的安装包测试**；T12 必须使用最终候选包运行并记录 EXIT。新路由 --route v0.2 对 download/media/hls/confirm/retry 返回用法错误；不要自动删掉 --route 绕过拒绝。legacy 路由下 HLS/媒体还需要实际可用的 Windows 命名管道和交互式终端确认。

CLI 标准输出只有一个 JSON 文档，进度/交互提示走 stderr。退出码：0 成功或命令被受理；1 用法错误；2 Core 类型化拒绝；3 需用户操作；4 终态非成功；5 传输错误；6 有界等待超时。**提交被受理不等于资源获取完成。** 未知总量、UNKNOWN、失败、已取消不得推导为 0%、100% 或成功。

## 文件安全、隐私及恢复

- 目的地必须在许可输出根目录内。路径穿越、碰撞覆盖、未授权的新目标、未声明的重定向来源应该被拒绝。
- 续传仅在远端强 ETag、HTTP Range 和原始部分文件 lineage 一致时允许；变更远端、流中断、磁盘写入失败、完整性失败不能报告 COMPLETE。
- Core 重启后先查询持久化状态，不可因为 UI 列表缺失就判断历史文件消失；当前桌面 UI 缺少 K-owned 全量历史任务枚举能力。
- 真实浏览器权限、Cookie/令牌、Host 身份、安装包 SHA、输出根权限都应按最小授权处理。拒绝结果应原样显示。
- 出错时先查看 CLI 结构化 code、退出码、status.cmd 与 verify.cmd 结果。保留失败事实，不自动“重试全部”或删除不明部分文件。

## 真实验收状态

T01–T09 与 T11 已在版本分支完成源代码任务；T10 文档属于候选交付。仍需 T12 CLI installed path、T13 Chromium/Host、T14 Desktop、T15 S4 HLS、T16 Windows install/upgrade、T17 human G0/G1 的**精确版本 SHA 实机证据**；随后才是 Candidate Freeze、Hidden Validation、Version Closure、Release Qualification 和 main 集成。不得用旧版本支持矩阵或测试 fake 替代这些门禁。
