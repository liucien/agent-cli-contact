/**
 * @workbench/contracts — Gateway <-> 客户端 WebSocket 契约。
 * 纯类型 + 常量，零运行时依赖（参考 T3 contracts 分包原则）。
 */

// ---------- 基础 ----------

export const GATEWAY_PORT = 7433;
export const PROTOCOL_VERSION = 1;

/** herdr 的四态 + unknown（透传） */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type RuntimeMode = 'herdr' | 'mock';

// ---------- 投影（shell projection，侧栏/状态栏全局视图） ----------

export interface WorkspaceSnapshot {
  id: string;
  label: string;
  agentCount: number;
  focused: boolean;
}

export interface AgentConfig {
  model: string;
  reasoning: 'low' | 'medium' | 'high';
  contextWindow: '200k' | '1m';
  permissionMode: 'plan' | 'ask' | 'full';
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
  unread: number;
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

export type ScheduleRunStatus = 'pending' | 'running' | 'blocked' | 'done' | 'error' | 'skipped';

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

export type MeshMessageKind = 'prompt' | 'reply' | 'status' | 'wait';
export type MeshMessageStatus = 'queued' | 'held' | 'injected' | 'denied';

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
  triggerState: 'done' | 'blocked' | 'idle';
  actionPrompt: string;
  enabled: boolean;
  oneShot: boolean;
}

/** 状态迁移分隔线等系统事件，进通信时间线 */
export interface MeshTimelineEntry {
  id: string;
  at: number;
  kind: 'message' | 'status' | 'wait' | 'system';
  from?: string;
  to?: string;
  messageId?: string;
  text: string;
  /** 时间线右侧动作标记，如 待放行/待处理 */
  pendingAction?: 'approve' | 'blocked' | null;
}

// ---------- 配置预设 ----------

export interface ConfigPreset {
  id: string;
  name: string;
  config: AgentConfig;
}

/** per-provider capability：配置项走哪条生效路径 */
export type ConfigApplyPath = 'immediate' | 'restart' | 'unsupported';

export interface ProviderCapabilities {
  provider: string;
  sessionModelSwitch: ConfigApplyPath;
  reasoningSwitch: ConfigApplyPath;
  permissionSwitch: ConfigApplyPath;
  models: { id: string; label: string; note: string }[];
}

// ---------- 全量投影 ----------

export interface ShellProjection {
  protocolVersion: number;
  runtime: { mode: RuntimeMode; herdrVersion?: string; connected: boolean };
  workspaces: WorkspaceSnapshot[];
  agents: AgentSnapshot[];
  schedules: ScheduleSnapshot[];
  mesh: {
    messages: MeshMessage[];
    rules: MeshRule[];
    timeline: MeshTimelineEntry[];
    relayApproval: boolean;
  };
  presets: ConfigPreset[];
  capabilities: ProviderCapabilities[];
  checkpointRef: string;
}

// ---------- RPC（客户端 -> gateway） ----------

export interface RpcRequest {
  id: string;
  method: RpcMethod;
  params?: unknown;
}

export type RpcMethod =
  | 'shell.get'
  | 'agent.prompt'
  | 'agent.sendInput'
  | 'agent.applyConfig'
  | 'thread.subscribe'
  | 'thread.unsubscribe'
  | 'mesh.send'
  | 'mesh.approve'
  | 'mesh.deny'
  | 'mesh.setRelayApproval'
  | 'mesh.rule.create'
  | 'mesh.rule.toggle'
  | 'mesh.rule.delete'
  | 'schedule.runNow'
  | 'schedule.toggle'
  | 'preset.save'
  | 'preset.delete';

export interface AgentPromptParams {
  agentId: string;
  text: string;
}

export interface AgentSendInputParams {
  agentId: string;
  text: string;
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
  triggerState: 'done' | 'blocked' | 'idle';
  actionPrompt: string;
  oneShot: boolean;
}

export interface PresetSaveParams {
  name: string;
  config: AgentConfig;
}

// ---------- 服务端推送（gateway -> 客户端） ----------

export type ServerMessage =
  | { type: 'rpc-result'; id: string; result: unknown }
  | { type: 'rpc-error'; id: string; error: { code: string; message: string } }
  | { type: 'shell'; data: ShellProjection }
  | { type: 'pane'; agentId: string; text: string; revision: number }
  | { type: 'notify'; level: 'info' | 'warn'; text: string };
