/**
 * HerdrRuntime — 真实底座：经 socket API 拥有 pane/agent 生命周期。
 * 两条连接：请求响应连接 + 事件订阅长连接（herdr 不回放订阅前事件，
 * 所以订阅建立后再做一次全量 agent.list 对账）。
 */
import {
    HerdrClient,
    defaultSocketPath,
    type HerdrAgentInfo,
    type HerdrAgentSessionInfo,
    type HerdrSubscription,
} from "@agent-cli-contact/herdr-client";
import { detectClaudeModel } from "./modelDetect.js";
import type {
    AgentSnapshot,
    WorkspaceSnapshot,
    AgentConfig,
    AgentStatus,
} from "@agent-cli-contact/contracts";
import type { AgentRuntime } from "./runtime.js";
import { PROVIDER_CAPABILITIES } from "./capabilities.js";

/** herdr agent kind（实测：claude / agy / codex …）→ capability 表的 provider 显示名 */
const PROVIDER_DISPLAY: Record<string, string> = {
    claude: "Claude Code",
    "claude-code": "Claude Code",
    codex: "Codex",
    agy: "Antigravity",
    "antigravity-cli": "Antigravity",
    gemini: "Antigravity",
    antigravity: "Antigravity",
    cursor: "Cursor Agent",
    opencode: "OpenCode",
    pi: "Pi",
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
    /** agent -> herdr session 引用 + cwd（模型检测用） */
    private sessions = new Map<
        string,
        { session: HerdrAgentSessionInfo | null; cwd: string | null }
    >();
    private turns = new Map<string, number>();
    /** herdr workspace.list 不回传 cwd：记住创建时传入的值作兜底 */
    private cwdHints = new Map<string, string>();

    constructor(persistedConfigs?: Record<string, AgentConfig>, socketPath = defaultSocketPath()) {
        this.rpc = new HerdrClient(socketPath);
        if (persistedConfigs) this.configs = new Map(Object.entries(persistedConfigs));
    }

    /** 配置持久化快照（gateway 重启后恢复，避免 Full access 等设置回落默认） */
    configsSnapshot(): Record<string, AgentConfig> {
        return Object.fromEntries(this.configs);
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
        // refresh 也可能承载状态迁移（结构事件路径），需要补发 statusCbs
        const transitions: { id: string; from: string; to: string }[] = [];
        for (const info of list) {
            const id = info.pane_id;
            const providerRaw = (info.agent ?? info.display_agent ?? "unknown").toLowerCase();
            const provider = PROVIDER_DISPLAY[providerRaw] ?? info.display_agent ?? providerRaw;
            const prev = this.agents.get(id);
            const config = this.configs.get(id) ?? defaultConfigFor(provider);
            // provider 检测晚于首次 refresh：缓存里的 unknown 默认值随 provider 就位替换
            if (config.model === "unknown" && PROVIDER_DISPLAY[providerRaw]) {
                config.model = defaultConfigFor(provider).model;
            }
            // Claude Code：从会话文件读实际模型（herdr 不上报模型），检测结果为准
            if (info.agent_session?.source === "herdr:claude" && info.cwd) {
                const detected = detectClaudeModel(info.cwd, info.agent_session.value);
                if (detected) config.model = detected;
            }
            this.configs.set(id, config);
            this.sessions.set(id, { session: info.agent_session ?? null, cwd: info.cwd ?? null });
            next.set(id, {
                snap: {
                    id,
                    name:
                        info.name ??
                        info.display_agent ??
                        (info.agent ? `${info.agent} · ${info.pane_id}` : id),
                    provider,
                    workspaceId: info.workspace_id,
                    paneId: info.pane_id,
                    status: info.agent_status,
                    taskSummary: info.terminal_title_stripped ?? prev?.snap.taskSummary,
                    turn: this.turns.get(id) ?? prev?.snap.turn ?? 0,
                    config,
                },
            });
            if (prev && prev.snap.status !== info.agent_status) {
                transitions.push({ id, from: prev.snap.status, to: info.agent_status });
            }
        }
        this.agents = next;
        for (const tr of transitions) {
            if (tr.to === "working") this.turns.set(tr.id, (this.turns.get(tr.id) ?? 0) + 1);
            for (const cb of this.statusCbs) cb(tr.id, tr.from, tr.to);
        }
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
            // herdr 不回传 workspace cwd：用其中 agent 的 cwd 推断，其次用创建时记录的值
            cwd:
                w.cwd ??
                list.find((a) => a.workspace_id === w.workspace_id && a.cwd)?.cwd ??
                this.cwdHints.get(w.workspace_id),
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
        // 实测（herdr 0.8）：agent target 接受 pane_id，terminal_id 会报 agent_not_found；
        // agent.prompt 只把文本粘贴进输入框（多行尤甚），需补一个 Enter 提交
        await this.rpc.agentPrompt(a.snap.paneId, text);
        await new Promise((r) => setTimeout(r, 200));
        await this.rpc.paneSendKeys(a.snap.paneId, ["Enter"]);
    }

    async sendInput(agentId: string, text: string): Promise<void> {
        const a = this.must(agentId);
        await this.rpc.paneSendInput(a.snap.paneId, text);
    }

    async sendKeys(agentId: string, keys: string[]): Promise<void> {
        const a = this.must(agentId);
        await this.rpc.paneSendKeys(a.snap.paneId, keys);
    }

    /** 读滚动缓冲（recent）而非仅可见屏：对话历史随缓冲保留 */
    async readPane(agentId: string, lines = 500): Promise<{ text: string; revision: number }> {
        const a = this.must(agentId);
        const res = await this.rpc.paneRead(a.snap.paneId, { lines, source: "recent" });
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
        const createdId = res.workspace?.workspace_id;
        if (createdId && cwd) this.cwdHints.set(createdId, cwd);
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

    /** tab.create（继承 workspace cwd，pane 在返回的 root_pane 里）→ agent.start(kind)。
     *  新 pane 的 shell 需要片刻就绪，agent_pane_busy 时按 400ms 间隔重试（最长 ~8s）。 */
    async createAgent(workspaceId: string, name: string, kind?: string): Promise<AgentSnapshot> {
        const ws = this.workspaces.find((w) => w.id === workspaceId);
        const tabRes = (await this.rpc.tabCreate(workspaceId, name, ws?.cwd)) as {
            root_pane?: { pane_id?: string };
        };
        const paneId = tabRes.root_pane?.pane_id;
        if (!paneId) throw new Error("tab.create 未返回 root_pane，无法启动 agent");

        const agentKind = kind || "claude";

        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                await this.rpc.agentStart(name, agentKind, paneId);
                lastErr = null;
                break;
            } catch (err) {
                lastErr = err;
                if (!String(err).includes("agent_pane_busy")) break;
                await new Promise((r) => setTimeout(r, 400));
            }
        }
        if (lastErr) {
            await this.rpc.paneClose(paneId).catch(() => {});
            throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
        }
        // agent.start 后 herdr 的 agent 检测需要片刻；等 provider 就位且首帧输出尝试后再返回（最多 ~4s）
        for (let attempt = 0; attempt < 8; attempt++) {
            await this.refresh();
            const created = [...this.agents.values()].find((a) => a.snap.paneId === paneId);
            if (created && created.snap.provider !== "unknown") {
                try {
                    const { text } = await this.readPane(created.snap.id);
                    if (text && text.trim().length > 0) return created.snap;
                } catch {}
                if (attempt >= 2) return created.snap;
            }
            await new Promise((r) => setTimeout(r, 400));
        }
        const created = [...this.agents.values()].find((a) => a.snap.paneId === paneId);
        if (!created) throw new Error("agent.start 后未在 agent.list 中发现新 agent");
        return created.snap;
    }

    async renameAgent(agentId: string, name: string): Promise<void> {
        const a = this.must(agentId);
        const trimmed = name.trim();
        if (!trimmed) throw new Error("Agent 名称不能为空");
        await this.rpc.agentRename(a.snap.paneId, trimmed);
        await this.refresh();
    }

    /** 按需同步配置（配置弹层打开时调用）：重读 Claude 会话文件里的实际模型 */
    async syncConfig(agentId: string): Promise<void> {
        const a = this.must(agentId);
        const ref = this.sessions.get(agentId);
        if (ref?.session?.source === "herdr:claude" && ref.cwd) {
            const detected = detectClaudeModel(ref.cwd, ref.session.value);
            if (detected && detected !== a.snap.config.model) {
                this.setConfig(agentId, { model: detected });
            }
        }
    }

    async removeAgent(agentId: string): Promise<void> {
        const a = this.must(agentId);
        await this.rpc.paneClose(a.snap.paneId);
        await this.refresh();
    }

    getSessionInfo(agentId: string): { session: { agent?: string; value: string; source?: string } | null; cwd: string | null } | undefined {
        return this.sessions.get(agentId);
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
