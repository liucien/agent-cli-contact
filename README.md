# agent-cli-contact (MVP)

轻量级 AI Coding 工作台 —— 基于 [herdr](https://herdr.dev/)（终端原生 agent runtime）+ 自建 Gateway + React UI。
对应设计文档 `design-mockups/PLAN.md` 的 **M1 里程碑切片**，并提前实现了 Mesh 面板 / Mesh 全屏视图 / Agent 配置切换三张设计稿对应的功能骨架。

```
apps/web        @agent-cli-contact/web        React + Vite 客户端（Workbench / Agent Mesh / 配置弹层 / herdr 引导页）
apps/gateway    @agent-cli-contact/gateway    Node 常驻服务：herdr 客户端 + mesh relay + scheduler + 配置切换 + WS 投影
apps/desktop    @agent-cli-contact/desktop    Tauri 2 桌面壳（仅窗口 + Gateway sidecar 生命周期，PLAN §4 红线）
packages/contracts      @agent-cli-contact/contracts      WS 契约（纯类型，零运行时依赖）
packages/herdr-client   @agent-cli-contact/herdr-client   herdr socket API 的 NDJSON 客户端（协议 19）
```

## 运行

```bash
pnpm install
pnpm dev          # 同时起 gateway (ws://localhost:7433) 与 web (http://localhost:5173)
```

## 打包 macOS 应用

```bash
pnpm build:mac    # sidecar 编译 → tauri build → DMG，产物汇总到仓库根 release/
# release/agent-cli-contact.app
# release/agent-cli-contact_0.1.0_aarch64.dmg
```

> `pnpm build` 只做代码构建（各包 typecheck + web dist），不触发桌面打包。
> Tauri 原始输出在 `apps/desktop/src-tauri/target/release/bundle/{macos,dmg}/`。

Gateway 经 `bun build --compile` 编成单二进制 sidecar 捆绑进 .app（Contents/MacOS/gateway），
应用启动时自动拉起、退出时回收；数据落 `~/.agent-cli-contact/state.json`。
未做代码签名/公证——分发给他人首次打开需右键 →「打开」绕过 Gatekeeper。

定位：**herdr 的 GUI 层**——Gateway 只是一层薄数据中间层（投影/中继/调度记账），agent 运行时全部归 herdr 所有。

**启动即做 herdr 环境检测**（每 2s 轮询，检测经登录 shell + socket ping）：

- **未安装** → 全屏引导页：`brew install herdr` 命令 + 复制按钮 + 一键自动安装（brew 日志实时回传）；无 Homebrew 时给出 brew.sh / herdr.dev 指引
- **已安装未运行** → 引导页「启动 herdr server」按钮（gateway detached spawn `herdr server` 无头常驻；停止：`herdr server stop`）
- **就绪** → 自动进入工作台，接管真实 pane/agent：状态订阅、`agent.prompt` 注入、`pane.read` 读屏、blocked 应答；新建 agent = `tab.create` + `agent.start`。herdr 中途退出会自动回到引导页，重启后自动恢复。

herdr 0.8 socket 实测语义（herdr-client 依此实现）：普通请求**一连接一请求**（响应后 server 即关连接），`events.subscribe` 为专用长连接。

桌面端新建项目经原生目录选择对话框（tauri-plugin-dialog）导入；浏览器端回退为路径输入。

## MVP 已实现

| 功能             | 说明                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| herdr 环境引导   | 启动检测 herdr 安装/运行状态，全屏引导页：一键 brew 安装（日志实时回传）、一键无头启动 `herdr server`、就绪自动进入工作台                                                                                                   |
| 多 agent 总览    | 侧栏四色状态点（working 绿 / blocked 黄 / idle 灰 / done 蓝）、工作区分组、待确认角标；agent 新建（`tab.create`+`agent.start`）/ 关闭                                                                                       |
| 终端优先主视图   | `pane.read` 读屏轮询推送（herdr 模式即真实终端内容），composer 经 `agent.prompt` 注入                                                                                                                                       |
| blocked 一等公民 | 协作面板出确认卡：批准 / 拒绝 经 `pane.send_input` 直接回答                                                                                                                                                                 |
| Agent Mesh       | Gateway 中继记账（queued/held/injected/denied）、目标非 idle 排队、**三道闸**：中继审批（reply 默认 hold）、每对 10 条/小时限速、A⇄B 循环深度 >3 强制 hold                                                                  |
| 协作规则         | wait-for-state：watcher 到达指定状态 → 向 target 注入 actionPrompt（可 one-shot）                                                                                                                                           |
| Mesh 全屏视图    | 静态拓扑（无持续动画，守 GPU 红线）+ 边详情消息线程 + 通信时间线 + 中继审批开关                                                                                                                                             |
| 定时任务         | croner 触发 + run 记录，经 mesh 以 `scheduler` 身份注入（复用排队基建）；侧栏显示下次触发、支持 run-now                                                                                                                     |
| 配置切换         | 三段式配置条 + 三列弹层；per-provider capability 表决定路径：即时（注入 `/model` slash 命令）/ working 中排队到 turn 结束 / 重启会话（MVP 仅记账上报）；配置预设存 Gateway                                                  |
| 多项目管理       | 侧栏工作区：新建（含 cwd）/ 重命名 / 关闭（最后一个项目保护、焦点回落）/ 切换聚焦；herdr 模式映射 `workspace.create/rename/close/focus`，agent 列表按项目过滤                                                               |
| 编辑器打开       | pane 头部与项目行 ⧉ 按钮，在 gateway 宿主机用外部编辑器打开项目目录；默认 `code`（VS Code），标题栏 ⚙︎ 设置弹层可自定义命令（cursor / subl / `open -a "WebStorm"` 等）；经 `/bin/sh -lc` 执行，打包 sidecar 下 PATH 亦可解析 |
| i18n 多语言      | 中/英双语（151 key 对齐），标题栏一键切换，localStorage 持久化；自研轻量 context 实现（零依赖）；服务端产生的数据（消息体/时间线/摘要）按原文透传不翻译                                                                     |

## 尚未实现（按 PLAN 里程碑）

- pairing 鉴权与远程访问（M1 后半 / M4）
- 隐藏 ref Git checkpoint（M1；git diff 面板已按需求移除）
- 定时任务 blocked 策略 / 补偿运行 / 专属 workspace spawn（M2）
- 权限切换的真实重启路径（`pane.close` → `agent.start --resume`，M2.5）
- Computer use（M3，右侧 Computer tab 为占位）
- 远程访问 / pairing（M4；Tauri 壳与 macOS 打包已完成）

## 与 PLAN 的偏差

- 持久化用原子写 JSON（`~/.agent-cli-contact/state.json`）顶位 SQLite，字段结构与 PLAN 的表设计对齐，换 SQLite 只动 `store.ts`。
- 终端渲染 MVP 用 strip-ansi 文本 + 行级着色，未引入 xterm.js（xterm/WebGL 压测属 M0 spike）。
