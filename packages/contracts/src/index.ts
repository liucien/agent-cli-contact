/**
 * @agent-cli-contact/contracts — Gateway <-> 客户端 WebSocket 契约。
 * 纯类型 + 常量，零运行时依赖（参考 T3 contracts 分包原则）。
 */

// ---------- 基础 ----------

export const GATEWAY_PORT = 7433;

/** herdr 的四态 + unknown（透传） */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** herdr 环境状态：未安装 → 已安装未运行 → 启动中 → 就绪（gateway 已接管） */
export type HerdrEnvStatus = "not-installed" | "not-running" | "starting" | "ready";

export interface HerdrEnv {
    status: HerdrEnvStatus;
    /** herdr --version 输出的版本号，如 "0.8.0"（已安装时） */
    version?: string;
    /** 二进制绝对路径（已安装时） */
    path?: string;
    /** 本机是否有 Homebrew（决定引导页能否一键安装） */
    brewAvailable: boolean;
}

// ---------- 投影（shell projection，侧栏/状态栏全局视图） ----------

export interface WorkspaceSnapshot {
    id: string;
    label: string;
    agentCount: number;
    focused: boolean;
    cwd?: string;
}

export interface AgentConfig {
    model: string;
    reasoning: "low" | "medium" | "high";
    contextWindow: "200k" | "1m";
    permissionMode: "plan" | "ask" | "full";
}

export interface AgentSnapshot {
    id: string;
    name: string;
    /** provider 显示名，如 Claude Code / Codex / Antigravity */
    provider: string;
    workspaceId: string;
    paneId: string;
    status: AgentStatus;
    /** blocked 时的原因摘要（读屏/事件推断） */
    blockedReason?: string;
    /** 当前任务一句话摘要（读屏尾部推断，可为空） */
    taskSummary?: string;
    turn: number;
    config: AgentConfig;
    /** 当前 git 分支（可为空） */
    branch?: string;
}

export interface ScheduleSnapshot {
    id: string;
    name: string;
    cronExpr: string;
    /** 自然语言描述，如 "02:00" / "周五 18:00"，gateway 生成 */
    humanized: string;
    enabled: boolean;
    nextFireAt: number | null;
    agentId: string;
    promptTemplate: string;
    lastRun?: ScheduleRunSnapshot;
}

export type ScheduleRunStatus = "pending" | "running" | "blocked" | "done" | "error" | "skipped";

export interface ScheduleRunSnapshot {
    id: string;
    scheduleId: string;
    plannedAt: number;
    startedAt: number | null;
    settledAt: number | null;
    status: ScheduleRunStatus;
    summary?: string;
}

// ---------- Mesh ----------

export type MeshMessageKind = "prompt" | "reply" | "status" | "wait";
export type MeshMessageStatus = "queued" | "held" | "injected" | "denied";

export interface MeshMessage {
    id: string;
    from: string; // agent id，或 'user'（代发）/ 'scheduler'
    to: string;
    kind: MeshMessageKind;
    body: string;
    status: MeshMessageStatus;
    heldReason?: string;
    attachment?: { label: string; diffStat?: string };
    createdAt: number;
    injectedAt: number | null;
}

export interface MeshRule {
    id: string;
    watcherAgent: string; // 触发方（被观察者）
    targetAgent: string; // 动作注入到谁
    triggerState: "done" | "blocked" | "idle";
    actionPrompt: string;
    enabled: boolean;
    oneShot: boolean;
}

/** 状态迁移分隔线等系统事件，进通信时间线 */
export interface MeshTimelineEntry {
    id: string;
    at: number;
    kind: "message" | "status" | "wait" | "system";
    from?: string;
    to?: string;
    messageId?: string;
    text: string;
    /** 时间线右侧动作标记，如 待放行/待处理 */
    pendingAction?: "approve" | "blocked" | null;
}

// ---------- 配置预设 ----------

export interface ConfigPreset {
    id: string;
    name: string;
    config: AgentConfig;
}

/** per-provider capability：配置项走哪条生效路径 */
export type ConfigApplyPath = "immediate" | "restart" | "unsupported";

export interface ProviderCapabilities {
    provider: string;
    sessionModelSwitch: ConfigApplyPath;
    reasoningSwitch: ConfigApplyPath;
    permissionSwitch: ConfigApplyPath;
    models: { id: string; label: string; note: string }[];
}

// ---------- 可选 Agent 类型 ----------

export interface AvailableAgent {
    kind: string;
    label: string;
    defaultPrefix: string;
    installed: boolean;
}

// ---------- 全量投影 ----------

export interface ShellProjection {
    herdr: HerdrEnv;
    workspaces: WorkspaceSnapshot[];
    agents: AgentSnapshot[];
    availableAgents: AvailableAgent[];
    schedules: ScheduleSnapshot[];
    mesh: {
        messages: MeshMessage[];
        rules: MeshRule[];
        timeline: MeshTimelineEntry[];
        relayApproval: boolean;
    };
    presets: ConfigPreset[];
    capabilities: ProviderCapabilities[];
    settings: GatewaySettings;
}

// ---------- RPC（客户端 -> gateway） ----------

export interface RpcRequest {
    id: string;
    method: RpcMethod;
    params?: unknown;
}

export type RpcMethod =
    | "shell.get"
    | "agent.prompt"
    | "agent.sendInput"
    | "agent.applyConfig"
    | "thread.subscribe"
    | "thread.unsubscribe"
    | "workspace.create"
    | "workspace.rename"
    | "workspace.close"
    | "workspace.focus"
    | "agent.create"
    | "agent.rename"
    | "agent.remove"
    | "agent.syncConfig"
    | "agent.sendKeys"
    | "agent.history"
    | "editor.open"
    | "settings.update"
    | "setup.install"
    | "setup.start"
    | "setup.recheck"
    | "mesh.send"
    | "mesh.approve"
    | "mesh.deny"
    | "mesh.setRelayApproval"
    | "mesh.rule.create"
    | "mesh.rule.toggle"
    | "mesh.rule.delete"
    | "schedule.runNow"
    | "schedule.toggle"
    | "preset.save"
    | "preset.delete";

/** 随 prompt 发送的图片（gateway 落盘后把路径附进 prompt，CLI 按路径读图） */
export interface PromptImage {
    name: string;
    /** base64 编码的文件内容（不含 data: 前缀），单张 ≤10MB */
    dataBase64: string;
}

/** agent.prompt 与 agent.sendInput 共用；images 仅 agent.prompt 生效 */
export interface AgentTextParams {
    agentId: string;
    text: string;
    images?: PromptImage[];
}

/** 在指定工作区新建 agent（local 模式直跑 claude CLI；herdr 模式 tab.create + agent.start） */
export interface AgentCreateParams {
    workspaceId: string;
    name: string;
    kind?: string;
}

export interface AgentRenameParams {
    agentId: string;
    name: string;
}

export interface AgentIdParams {
    agentId: string;
}

/** 向 agent pane 发送按键序列（TUI 菜单导航：'Down'/'Up'/'Enter'/'Esc' 等） */
export interface AgentSendKeysParams {
    agentId: string;
    keys: string[];
}

export interface ToolCallItem {
    name: string;
    summary?: string;
    status?: "running" | "done" | "error";
}

/**
 * 对话历史记录（gateway 自建 / 结构化日志提取）。
 * 支持提取到的 thinking 思考链、toolCalls 工具执行和 mesh 协作源。
 */
export interface ThreadRecord {
    id?: string;
    role: "user" | "assistant" | "system";
    text: string;
    at: number;
    thinking?: string;
    toolCalls?: ToolCallItem[];
    meshInfo?: { from: string; to: string; kind?: string };
}

export interface AgentHistoryResult {
    items: ThreadRecord[];
}

export interface AgentApplyConfigParams {
    agentId: string;
    config: AgentConfig;
}

export interface AgentApplyConfigResult {
    /** 已即时注入的项（slash 命令路径） */
    applied: string[];
    /** working 中排队到 turn 结束的项 */
    queued: string[];
    /** 需重启会话生效的项 */
    restartRequired: string[];
}

export interface ThreadSubscribeParams {
    agentId: string;
}

export interface WorkspaceCreateParams {
    label: string;
    cwd?: string;
}

export interface WorkspaceRenameParams {
    workspaceId: string;
    label: string;
}

/** workspace.close / workspace.focus / editor.open 共用 */
export interface WorkspaceIdParams {
    workspaceId: string;
}

export interface GatewaySettings {
    /** 编辑器启动命令，目录路径作为最后一个参数追加，如 "code" / "cursor" / "open -a \"WebStorm\"" */
    editorCommand: string;
}

export interface SettingsUpdateParams {
    editorCommand: string;
}

export interface MeshSendParams {
    from: string;
    to: string;
    kind: MeshMessageKind;
    body: string;
}

export interface MeshApproveParams {
    messageId: string;
    editedBody?: string;
}

export interface MeshRuleCreateParams {
    watcherAgent: string;
    targetAgent: string;
    triggerState: "done" | "blocked" | "idle";
    actionPrompt: string;
    oneShot: boolean;
}

export interface PresetSaveParams {
    name: string;
    config: AgentConfig;
}

// ---------- 服务端推送（gateway -> 客户端） ----------

export type ServerMessage =
    | { type: "rpc-result"; id: string; result: unknown }
    | { type: "rpc-error"; id: string; error: { code: string; message: string } }
    | { type: "shell"; data: ShellProjection }
    | { type: "pane"; agentId: string; text: string; revision: number }
    | { type: "notify"; level: "info" | "warn"; text: string }
    /** setup.install 的实时输出行（brew 安装日志） */
    | { type: "setup-log"; line: string };
