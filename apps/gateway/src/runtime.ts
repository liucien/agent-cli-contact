/**
 * AgentRuntime — herdr 底座的接口抽象。
 * Gateway 其余模块（mesh/scheduler/server）只依赖此接口，隔离 herdr 0.x 协议演进。
 */
import type { AgentSnapshot, WorkspaceSnapshot } from "@agent-cli-contact/contracts";

export interface AgentRuntime {
    /** 任意 agent/workspace 快照变化（含状态迁移） */
    onChange(cb: () => void): void;
    /** 状态迁移专用（mesh 规则 / 时间线用） */
    onStatusChange(cb: (agentId: string, from: string, to: string) => void): void;
    start(): Promise<void>;
    /** 关闭事件订阅等长连接资源 */
    stop(): void;
    listWorkspaces(): WorkspaceSnapshot[];
    listAgents(): AgentSnapshot[];
    getAgent(agentId: string): AgentSnapshot | undefined;
    /** 用户/调度器/mesh 注入 prompt（等价 herdr agent.prompt） */
    prompt(agentId: string, text: string): Promise<void>;
    /** 对 blocked 确认等场景直接向 pane 写输入（等价 pane.send_input） */
    sendInput(agentId: string, text: string): Promise<void>;
    /** 读取 pane 屏幕文本（strip_ansi） */
    readPane(agentId: string, lines?: number): Promise<{ text: string; revision: number }>;
    /** 配置切换的「即时生效」路径：注入 slash 命令并留审计行 */
    injectSlashCommand(agentId: string, command: string): Promise<void>;
    /** 更新 gateway 侧持有的 agent 配置摘要（重启路径 MVP 仅记账） */
    setConfig(agentId: string, patch: Partial<AgentSnapshot["config"]>): void;

    // ---- 多项目（workspace）管理 ----
    createWorkspace(label: string, cwd?: string): Promise<WorkspaceSnapshot>;
    renameWorkspace(workspaceId: string, label: string): Promise<void>;
    closeWorkspace(workspaceId: string): Promise<void>;
    focusWorkspace(workspaceId: string): Promise<void>;

    // ---- agent 生命周期 ----
    createAgent(workspaceId: string, name: string): Promise<AgentSnapshot>;
    removeAgent(agentId: string): Promise<void>;
}
