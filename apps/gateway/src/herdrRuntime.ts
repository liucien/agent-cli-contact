/**
 * HerdrRuntime — 真实底座：经 socket API 拥有 pane/agent 生命周期。
 * 两条连接：请求响应连接 + 事件订阅长连接（herdr 不回放订阅前事件，
 * 所以订阅建立后再做一次全量 agent.list 对账）。
 */
import {
    HerdrClient,
    defaultSocketPath,
    type HerdrAgentInfo,
    type HerdrSubscription,
} from "@agent-cli-contact/herdr-client";
import type {
    AgentSnapshot,
    WorkspaceSnapshot,
    AgentConfig,
    AgentStatus,
} from "@agent-cli-contact/contracts";
import type { AgentRuntime } from "./runtime.js";
import { PROVIDER_CAPABILITIES } from "./capabilities.js";

const PROVIDER_DISPLAY: Record<string, string> = {
    claude: "Claude Code",
    "claude-code": "Claude Code",
    codex: "Codex",
    gemini: "Antigravity",
    antigravity: "Antigravity",
};

function defaultConfigFor(provider: string): AgentConfig {
    const cap = PROVIDER_CAPABILITIES.find((c) => c.provider === provider);
    return {
        model: cap?.models[0]?.id ?? "unknown",
        reasoning: "medium",
        contextWindow: "200k",
        permissionMode: "ask",
    };
}

interface TrackedAgent {
    snap: AgentSnapshot;
    terminalId: string;
}

export class HerdrRuntime implements AgentRuntime {
    private rpc: HerdrClient;
    private sub: HerdrSubscription | null = null;
    private stopped = false;
    private agents = new Map<string, TrackedAgent>();
    private workspaces: WorkspaceSnapshot[] = [];
    private changeCbs: (() => void)[] = [];
    private statusCbs: ((agentId: string, from: string, to: string) => void)[] = [];
    /** gateway 侧记账的配置（herdr 不感知模型/权限，配置真身在 pane 内 CLI） */
    private configs = new Map<string, AgentConfig>();
    private turns = new Map<string, number>();

    constructor(socketPath = defaultSocketPath()) {
        this.rpc = new HerdrClient(socketPath);
    }

    async start(): Promise<void> {
        await this.rpc.ping();
        await this.refresh();
        this.resubscribe();
    }

    stop(): void {
        this.stopped = true;
        this.sub?.close();
        this.sub = null;
    }

    /** 换订阅（pane 列表变化时）：开新长连接，断开旧的；异常断开 2s 后重试 */
    private resubscribe(): void {
        if (this.stopped) return;
        const prev = this.sub;
        const paneIds = [...this.agents.values()].map((a) => a.snap.paneId);
        const sub = this.rpc.subscribeAgentEvents(paneIds, (ev) => this.handleEvent(ev.data));
        this.sub = sub;
        prev?.close();
        sub.done.catch(() => {
            if (this.stopped || this.sub !== sub) return;
            console.warn("[gateway] herdr 订阅连接断开，2s 后重连");
            setTimeout(() => {
                if (!this.stopped && this.sub === sub) this.resubscribe();
            }, 2000);
        });
    }

    private static readonly STRUCTURE_EVENTS = new Set([
        "pane_created",
        "pane_closed",
        "pane_agent_detected",
        "workspace_created",
        "workspace_closed",
    ]);

    private handleEvent(data: Record<string, unknown> & { type?: string }): void {
        // pane/workspace 结构变化：全量刷新 + 重订阅
        if (data.type && HerdrRuntime.STRUCTURE_EVENTS.has(data.type)) {
            this.refresh()
                .then(() => this.resubscribe())
                .catch((err) => console.warn("[gateway] refresh 失败:", String(err)));
            return;
        }
        // 状态事件携带 pane_id + agent_status
        const paneId = data.pane_id as string | undefined;
        const status = (data.agent_status ?? data.status) as AgentStatus | undefined;
        if (paneId && status) {
            const tracked = [...this.agents.values()].find((a) => a.snap.paneId === paneId);
            if (tracked && tracked.snap.status !== status) {
                const from = tracked.snap.status;
                tracked.snap.status = status;
                if (status === "working")
                    this.turns.set(tracked.snap.id, (this.turns.get(tracked.snap.id) ?? 0) + 1);
                tracked.snap.turn = this.turns.get(tracked.snap.id) ?? 0;
                this.emitChange();
                for (const cb of this.statusCbs) cb(tracked.snap.id, from, status);
            }
            return;
        }
        // 其它未知事件：保守全量刷新
        this.refresh().catch((err) => console.warn("[gateway] refresh 失败:", String(err)));
    }

    private async refresh(): Promise<void> {
        const [agentsRes, wsRes] = await Promise.all([
            this.rpc.agentList(),
            this.rpc.workspaceList(),
        ]);
        const list: HerdrAgentInfo[] = agentsRes.agents ?? [];
        const next = new Map<string, TrackedAgent>();
        for (const info of list) {
            const id = info.pane_id;
            const providerRaw = (info.agent ?? info.display_agent ?? "unknown").toLowerCase();
            const provider = PROVIDER_DISPLAY[providerRaw] ?? info.display_agent ?? providerRaw;
            const prev = this.agents.get(id);
            const config = this.configs.get(id) ?? defaultConfigFor(provider);
            this.configs.set(id, config);
            next.set(id, {
                terminalId: info.terminal_id,
                snap: {
                    id,
                    name: info.name ?? info.display_agent ?? info.title ?? id,
                    provider,
                    workspaceId: info.workspace_id,
                    paneId: info.pane_id,
                    status: info.agent_status,
                    taskSummary: info.title ?? prev?.snap.taskSummary,
                    turn: this.turns.get(id) ?? prev?.snap.turn ?? 0,
                    config,
                },
            });
        }
        this.agents = next;
        const wsList = (wsRes.workspaces ?? []) as {
            workspace_id: string;
            label?: string | null;
            focused?: boolean;
            cwd?: string | null;
        }[];
        this.workspaces = wsList.map((w) => ({
            id: w.workspace_id,
            label: w.label ?? w.workspace_id,
            focused: w.focused ?? false,
            cwd: w.cwd ?? undefined,
            agentCount: list.filter((a) => a.workspace_id === w.workspace_id).length,
        }));
        this.emitChange();
    }

    listWorkspaces(): WorkspaceSnapshot[] {
        return this.workspaces;
    }

    listAgents(): AgentSnapshot[] {
        return [...this.agents.values()].map((a) => a.snap);
    }

    getAgent(agentId: string): AgentSnapshot | undefined {
        return this.agents.get(agentId)?.snap;
    }

    async prompt(agentId: string, text: string): Promise<void> {
        const a = this.must(agentId);
        await this.rpc.agentPrompt(a.terminalId, text);
    }

    async sendInput(agentId: string, text: string): Promise<void> {
        const a = this.must(agentId);
        await this.rpc.paneSendInput(a.snap.paneId, text);
    }

    async readPane(agentId: string, lines = 200): Promise<{ text: string; revision: number }> {
        const a = this.must(agentId);
        const res = await this.rpc.paneRead(a.snap.paneId, { lines, source: "visible" });
        return { text: res.text, revision: res.revision };
    }

    async injectSlashCommand(agentId: string, command: string): Promise<void> {
        const a = this.must(agentId);
        // send_text 写入命令文本，再回车提交（终端留 ⚙ gateway: 审计行靠 CLI 自身回显）
        await this.rpc.paneSendText(a.snap.paneId, command + "\r");
    }

    setConfig(agentId: string, patch: Partial<AgentConfig>): void {
        const a = this.must(agentId);
        const merged = { ...a.snap.config, ...patch };
        a.snap.config = merged;
        this.configs.set(agentId, merged);
        this.emitChange();
    }

    async createWorkspace(label: string, cwd?: string): Promise<WorkspaceSnapshot> {
        const res = await this.rpc.workspaceCreate(label, cwd);
        await this.refresh();
        const created = this.workspaces.find((w) => w.id === res.workspace?.workspace_id);
        return (
            created ?? {
                id: res.workspace?.workspace_id ?? label,
                label,
                agentCount: 0,
                focused: false,
                cwd,
            }
        );
    }

    async renameWorkspace(workspaceId: string, label: string): Promise<void> {
        await this.rpc.workspaceRename(workspaceId, label);
        await this.refresh();
    }

    async closeWorkspace(workspaceId: string): Promise<void> {
        await this.rpc.workspaceClose(workspaceId);
        await this.refresh();
    }

    async focusWorkspace(workspaceId: string): Promise<void> {
        await this.rpc.workspaceFocus(workspaceId);
        await this.refresh();
    }

    /** tab.create（继承 workspace cwd）→ agent.start(kind=claude)。TabInfo 的 pane 字段
     *  在 0.x 未定稿，做宽松提取 + pane.list 兜底。 */
    async createAgent(workspaceId: string, name: string): Promise<AgentSnapshot> {
        const ws = this.workspaces.find((w) => w.id === workspaceId);
        const tabRes = (await this.rpc.tabCreate(workspaceId, name, ws?.cwd)) as Record<
            string,
            unknown
        >;
        const tab = (tabRes.tab ?? tabRes) as Record<string, unknown>;
        let paneId =
            (tab.pane_id as string | undefined) ??
            (Array.isArray(tab.panes) ? (tab.panes[0] as { pane_id?: string })?.pane_id : undefined);
        if (!paneId) {
            const panes = await this.rpc.paneList(workspaceId);
            paneId = panes.panes.find((p) => p.tab_id === tab.tab_id)?.pane_id;
        }
        if (!paneId) throw new Error("tab.create 未返回 pane，无法启动 agent");
        await this.rpc.agentStart(name, "claude", paneId);
        await this.refresh();
        const created = [...this.agents.values()].find((a) => a.snap.paneId === paneId);
        if (!created) throw new Error("agent.start 后未在 agent.list 中发现新 agent");
        return created.snap;
    }

    async removeAgent(agentId: string): Promise<void> {
        const a = this.must(agentId);
        await this.rpc.paneClose(a.snap.paneId);
        await this.refresh();
    }

    onChange(cb: () => void): void {
        this.changeCbs.push(cb);
    }

    onStatusChange(cb: (agentId: string, from: string, to: string) => void): void {
        this.statusCbs.push(cb);
    }

    private must(agentId: string): TrackedAgent {
        const a = this.agents.get(agentId);
        if (!a) throw new Error(`unknown agent: ${agentId}`);
        return a;
    }

    private emitChange(): void {
        for (const cb of this.changeCbs) cb();
    }
}
