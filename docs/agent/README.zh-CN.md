# xDownload v0.2.1 — Agent 执行契约（中文）

> **候选文档，不代表正式发布合格。** 版本分支基线：56f9e16d8d7afb29b2a493c07bdf4f886a0bf445。详细英文 Agent 契约：[README.md](README.md)。中文用户手册：[README.zh-CN.md](../user/README.zh-CN.md)。

## ADS 与软件工程边界

GitHub 是 ADS v4.18 的 Issue、Task、Claim、Review 事实源。冻结 DAG 共 22 Task / 63 原生依赖；在每次写源码前读取原生 blocked_by、精确基线、冻结 Task Pack、已接受 JIT Claim 及唯一写集，必须由独立 Reviewer 按精确 HEAD/Tree 审核。不要以 Builder 自检替代独立审核，不得修改冻结 Product/L2/DAG，不得未经 Release Qualification 合并 main。

一个本地 Core 只能拥有一个 DomainHarness K 和唯一 lineage 授权。CLI、Electron、Browser 都不应另起 Core/K；S4 独立测试工厂不能成为生产第二 K。网络/文件操作只允许通过 Kernel effect permit + 可信 Host 目标注册表执行。浏览器 URL、Cookie、人类选择或模型推断本身都不是 Host 授权；原目标、目的地、预算、同一 lineage 及隐私边界不应被扩张。

DomainHarness v0.10.3 是 Git 源码标签，不代表 npm 已发布 v0.10.3；依赖更新需要核对 vendored tarball SHA 和实际冻结来源。

## CLI、状态与兼容规则

以 apps/cli/src/args.ts / main.ts / domain-app-commands.ts / render.ts 为准。在仓库根目录使用固定 Node 24.21.0、pnpm 12.8.1：

~~~text
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/cli/xdownload-cli.js help
~~~

下面是源码参数核对后的候选示例，**尚未获得最终安装包实际执行的 T12 EXIT 证据**：

~~~text
node dist/cli/xdownload-cli.js --route v0.2 status --lineage <lineage-id> --install-id <install-id> --user-id <user-id> --port <core-port>
node dist/cli/xdownload-cli.js --route v0.2 wait --lineage <lineage-id> --timeout-ms 30000 --poll-ms 200 --install-id <install-id> --user-id <user-id> --port <core-port>
~~~

仅显式 --route v0.2 使用新 K 路由：语法允许 submit/status/wait/cancel/batch；download/media/hls/confirm/retry 在此路由返回 USAGE。合法 argv 的对应 Core 意图仍可能拒绝（当前 direct/cancel 不是完整生产功能），不得悄悄改走 v1 以伪装成功。Windows 使用准确的 --pipe-name 时，不得在失败后降级 TCP。

stdout 是一份机器可读 JSON；stderr 是人类提示。退出码：0 受理/成功、1 用法、2 类型化拒绝、3 需人确认、4 终态非成功、5 传输异常、6 等待超时。**受理不等于下载成功，UNKNOWN 不等于完成**；禁止合成进度、ETA、总量或文件路径。

## Windows 安装与真实验证

只选择 Windows x64 + Node 24，组合候选安装器前需要通过 pnpm build；Windows 组合命令为 node installers/compose-installer.ts --version 0.2.1。打包缺少所需原生运行库时应拒绝。用户解压后首先运行 verify.cmd 对照 SHA256SUMS 校验，通过后使用真实 chrome://extensions 分配的扩展 ID 运行 install.cmd --extension-id <real-id>，再由 status.cmd 回读 HKCU Native Messaging 注册与唯一 Core pipe。已有安装先卸载，不覆盖。无 Linux/macOS、签名、商店或自动升级承诺。

严格区分测试来源：
- **T12 #261**：实际安装 CLI/CF-1（必须记录 apps/cli/test/headless-authority.test.ts 退出码及安装包 SHA）。
- **T13 #262**：真实 Chromium、Native Host 与权限/泄露负例。
- **T14 #263**：真正打包的 Electron Desktop/IPC/下载旅程。
- **T15 #264**：真实授权 HLS VOD、明确 variant、FFmpeg 校验与输出回读。
- **T16 #265**：Windows 安装/升级/卸载、OS 文件权限和完整性。
- **T17 #266**：真实 G0/G1 人工效率数据，不得虚构人次或用时。

这些证据须绑定**最终候选 Exact SHA**、环境、命令、EXIT、实际日志和本地 Docker Woodpecker Build。GitHub Actions 不作为项目准入，旧 SHA 的 PASS 不可继承。T18 Freeze、T19 Hidden、T20 Closure、T21 Release Qualification、T22 main 集成按冻结 DAG 顺序推进；若证据缺失，明确 NOT_PROVEN / BLOCK。
