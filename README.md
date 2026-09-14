# Agent Workbench (MVP)

轻量级 AI Coding 工作台 —— 基于 [herdr](https://herdr.dev/)（终端原生 agent runtime）+ 自建 Gateway + React UI。
对应设计文档 `design-mockups/PLAN.md` 的 **M1 里程碑切片**，并提前实现了 Mesh 面板 / Mesh 全屏视图 / Agent 配置切换三张设计稿对应的功能骨架。

```
apps/web        React + Vite 客户端（三屏：Workbench / Agent Mesh / 配置弹层）
apps/gateway    Node 常驻服务：herdr 客户端 + mesh relay + scheduler + 配置切换 + WS 投影
apps/desktop    Tauri 2 桌面壳（仅窗口 + Gateway sidecar 生命周期，PLAN §4 红线）
packages/contracts      WS 契约（纯类型，零运行时依赖）
packages/herdr-client   herdr socket API 的 NDJSON 客户端（协议 19）
```

## 运行

```bash
pnpm install
pnpm dev          # 同时起 gateway (ws://localhost:7433) 与 web (http://localhost:5173)
```

## 打包 macOS 应用

```bash
pnpm --filter @workbench/desktop build
# 产物：
#   apps/desktop/src-tauri/target/release/bundle/macos/Agent Workbench.app
#   apps/desktop/src-tauri/target/release/bundle/dmg/Agent Workbench_0.1.0_aarch64.dmg
```

Gateway 经 `bun build --compile` 编成单二进制 sidecar 捆绑进 .app（Contents/MacOS/gateway），
应用启动时自动拉起、退出时回收；数据落 `~/.agent-workbench/state.json`。
未做代码签名/公证——分发给他人首次打开需右键 →「打开」绕过 Gatekeeper。

- **herdr 模式**：本机 `~/.config/herdr/herdr.sock` 存在（herdr server 运行中）时，Gateway 自动接管真实 pane/agent：状态订阅、`agent.prompt` 注入、`pane.read` 读屏、`pane.send_input` 回答 blocked。
- **mock 模式**（降级备胎，PLAN §3）：无 herdr 时自动启用，用脚本化假 agent 复刻设计稿场景（working / blocked / idle / done 四态、mesh 消息流、定时任务），UI 全功能可演示。`WORKBENCH_RUNTIME=mock` 可强制。

## MVP 已实现

| 功能 | 说明 |
|---|---|
| 多 agent 总览 | 侧栏四色状态点（working 绿 / blocked 黄 / idle 灰 / done 蓝）、工作区分组、未读/待确认角标 |
| 终端优先主视图 | `pane.read` 读屏轮询推送（herdr 模式即真实终端内容），composer 经 `agent.prompt` 注入 |
| blocked 一等公民 | 协作面板出确认卡：批准 / 拒绝 经 `pane.send_input` 直接回答 |
| Agent Mesh | Gateway 中继记账（queued/held/injected/denied）、目标非 idle 排队、**三道闸**：中继审批（reply 默认 hold）、每对 10 条/小时限速、A⇄B 循环深度 >3 强制 hold |
| 协作规则 | wait-for-state：watcher 到达指定状态 → 向 target 注入 actionPrompt（可 one-shot） |
| Mesh 全屏视图 | 静态拓扑（无持续动画，守 GPU 红线）+ 边详情消息线程 + 通信时间线 + 中继审批开关 |
| 定时任务 | croner 触发 + run 记录，经 mesh 以 `scheduler` 身份注入（复用排队基建）；侧栏显示下次触发、支持 run-now |
| 配置切换 | 三段式配置条 + 三列弹层；per-provider capability 表决定路径：即时（注入 `/model` slash 命令）/ working 中排队到 turn 结束 / 重启会话（MVP 仅记账上报）；配置预设存 Gateway |

## 尚未实现（按 PLAN 里程碑）

- pairing 鉴权与远程访问（M1 后半 / M4）
- 隐藏 ref Git checkpoint 与 diff 面板（M1，右侧 Diff tab 现为占位）
- 定时任务 blocked 策略 / 补偿运行 / 专属 workspace spawn（M2）
- 权限切换的真实重启路径（`pane.close` → `agent.start --resume`，M2.5）
- Computer use（M3，右侧 Computer tab 为占位）
- Tauri 壳（M4；当前为纯 web 客户端）

## 与 PLAN 的偏差

- 持久化用原子写 JSON（`apps/gateway/data/state.json`）顶位 SQLite，字段结构与 PLAN 的表设计对齐，换 SQLite 只动 `store.ts`。
- 终端渲染 MVP 用 strip-ansi 文本 + 行级着色，未引入 xterm.js（xterm/WebGL 压测属 M0 spike）。
