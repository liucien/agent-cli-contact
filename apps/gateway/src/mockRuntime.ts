/**
 * MockRuntime — 无 herdr 时的降级模式（PLAN「DirectCliRunner 备胎」的 MVP 形态）。
 * 用脚本化的假 agent 复刻设计稿场景：claude-backend working / codex-review
 * blocked / agy-docs idle / claude-e2e done，prompt 注入后模拟一轮 turn。
 */
import type { AgentSnapshot, WorkspaceSnapshot, AgentConfig } from "@workbench/contracts";
import type { AgentRuntime } from "./runtime.js";

interface MockAgent {
    snap: AgentSnapshot;
    screen: string[];
    revision: number;
}

const defaultConfig = (model: string, overrides: Partial<AgentConfig> = {}): AgentConfig => ({
    model,
    reasoning: "high",
    contextWindow: "1m",
    permissionMode: "full",
    ...overrides,
});

interface MockWorkspace {
    id: string;
    label: string;
    focused: boolean;
    cwd?: string;
}

export class MockRuntime implements AgentRuntime {
    readonly mode = "mock" as const;
    private agents = new Map<string, MockAgent>();
    private workspaces: MockWorkspace[] = [
        { id: "ws-acme", label: "acme-api", focused: true, cwd: "~/work/acme-api" },
        { id: "ws-mkt", label: "marketing-site", focused: false, cwd: "~/work/marketing-site" },
    ];
    private changeCbs: (() => void)[] = [];
    private statusCbs: ((agentId: string, from: string, to: string) => void)[] = [];

    async start(): Promise<void> {
        this.seed();
    }

    private seed(): void {
        this.addAgent(
            {
                id: "claude-backend",
                name: "claude-backend",
                provider: "Claude Code",
                workspaceId: "ws-acme",
                paneId: "pane-1",
                status: "working",
                taskSummary: "重构 src/auth token 刷新逻辑，等待 review 意见回传",
                turn: 12,
                branch: "feat/auth-refresh",
                config: defaultConfig("claude-fable-5"),
            },
            [
                "❯ 重构 src/auth 的 token 刷新逻辑，完成后交给 codex-review 复查",
                "● 我将分三步进行：提取刷新逻辑、加互斥锁、更新调用方。",
                "  ⏺ Edit(src/auth/refresh.ts) +48 -21",
                "  ⏺ Edit(src/auth/session.ts) +9 -3",
                "  ⏺ Bash(vp test run src/auth) 12 passed",
                "● 重构完成，测试通过。正在通过 mesh 将 diff 发给 codex-review…",
                "  ⇄ mesh: 已送达 codex-review（等待其空闲后注入）",
                "  ⇄ mesh: codex-review 回传 2 条 review 意见（待放行）",
                "● 收到 review 后我会继续修复竞态问题。",
            ],
        );
        this.addAgent(
            {
                id: "codex-review",
                name: "codex-review",
                provider: "Codex",
                workspaceId: "ws-acme",
                paneId: "pane-2",
                status: "blocked",
                blockedReason: "等待 shell 权限确认：npm audit fix",
                taskSummary: "review auth diff · 卡在 shell 权限确认 (npm audit fix)",
                turn: 3,
                config: defaultConfig("gpt-5.3-codex", {
                    permissionMode: "ask",
                    reasoning: "medium",
                }),
            },
            [
                "❯ review claude-backend 的 turn #12 diff（src/auth）",
                "● 开始 review。先跑一遍 auth 相关测试确认基线。",
                "  ⏺ Bash(npm test -- src/auth) 12 passed",
                "● 发现 2 处问题：refresh() 双请求竞态、缺少过期边界测试。已回传意见。",
                "  ⏺ Bash(npm audit fix)",
                "⚠ 等待 shell 权限确认：npm audit fix [y/N]",
            ],
        );
        this.addAgent(
            {
                id: "agy-docs",
                name: "agy-docs",
                provider: "Antigravity",
                workspaceId: "ws-acme",
                paneId: "pane-3",
                status: "idle",
                taskSummary: "收到指令队列 1 条：更新 auth 模块文档",
                turn: 1,
                config: defaultConfig("gemini-3-pro", {
                    permissionMode: "plan",
                    reasoning: "medium",
                    contextWindow: "200k",
                }),
            },
            ["❯ (空闲) 等待指令…"],
        );
        this.addAgent(
            {
                id: "claude-e2e",
                name: "claude-e2e",
                provider: "Claude Code",
                workspaceId: "ws-acme",
                paneId: "pane-4",
                status: "done",
                taskSummary: "等待 claude-backend done 后运行 e2e 套件",
                turn: 5,
                config: defaultConfig("claude-sonnet-5", { permissionMode: "plan" }),
            },
            ["❯ 运行 smoke e2e", "● e2e 套件通过（18/18）。", "✓ done — 等待下一轮触发"],
        );
        this.addAgent(
            {
                id: "mkt-landing",
                name: "mkt-landing",
                provider: "Claude Code",
                workspaceId: "ws-mkt",
                paneId: "pane-5",
                status: "idle",
                turn: 0,
                config: defaultConfig("claude-haiku-4-5", {
                    reasoning: "low",
                    contextWindow: "200k",
                    permissionMode: "ask",
                }),
            },
            ["❯ (空闲) 等待指令…"],
        );
    }

    private addAgent(snap: AgentSnapshot, screen: string[]): void {
        this.agents.set(snap.id, { snap, screen, revision: 1 });
    }

    // ---- runtime 接口 ----

    listWorkspaces(): WorkspaceSnapshot[] {
        const count = (ws: string) =>
            [...this.agents.values()].filter((a) => a.snap.workspaceId === ws).length;
        return this.workspaces.map((w) => ({ ...w, agentCount: count(w.id) }));
    }

    async createWorkspace(label: string, cwd?: string): Promise<WorkspaceSnapshot> {
        const ws: MockWorkspace = {
            id: `ws-${Math.random().toString(36).slice(2, 8)}`,
            label,
            focused: false,
            cwd,
        };
        this.workspaces.push(ws);
        this.emitChange();
        return { ...ws, agentCount: 0 };
    }

    async renameWorkspace(workspaceId: string, label: string): Promise<void> {
        const ws = this.workspaces.find((w) => w.id === workspaceId);
        if (!ws) throw new Error(`unknown workspace: ${workspaceId}`);
        ws.label = label;
        this.emitChange();
    }

    async closeWorkspace(workspaceId: string): Promise<void> {
        if (this.workspaces.length <= 1) throw new Error("不能关闭最后一个项目");
        const idx = this.workspaces.findIndex((w) => w.id === workspaceId);
        if (idx < 0) throw new Error(`unknown workspace: ${workspaceId}`);
        const wasFocused = this.workspaces[idx]!.focused;
        this.workspaces.splice(idx, 1);
        for (const [id, a] of [...this.agents]) {
            if (a.snap.workspaceId === workspaceId) this.agents.delete(id);
        }
        if (wasFocused && this.workspaces[0]) this.workspaces[0].focused = true;
        this.emitChange();
    }

    async focusWorkspace(workspaceId: string): Promise<void> {
        for (const w of this.workspaces) w.focused = w.id === workspaceId;
        this.emitChange();
    }

    listAgents(): AgentSnapshot[] {
        return [...this.agents.values()].map((a) => a.snap);
    }

    getAgent(agentId: string): AgentSnapshot | undefined {
        return this.agents.get(agentId)?.snap;
    }

    async prompt(agentId: string, text: string): Promise<void> {
        const a = this.must(agentId);
        this.append(a, `❯ ${text}`);
        this.setStatus(a, "working");
        a.snap.turn += 1;
        a.snap.taskSummary = text.slice(0, 40);
        // 模拟一轮 turn：思考 -> 工具调用 -> 完成
        this.after(1500, () => this.append(a, `● 收到。开始处理：${text.slice(0, 30)}…`));
        this.after(3500, () => this.append(a, "  ⏺ Edit(src/…) +12 -4"));
        this.after(5000, () => this.append(a, "  ⏺ Bash(pnpm test) passed"));
        this.after(6500, () => {
            this.append(a, "● 本轮完成。");
            this.setStatus(a, "done");
            this.after(2500, () => this.setStatus(a, "idle"));
        });
    }

    async sendInput(agentId: string, text: string): Promise<void> {
        const a = this.must(agentId);
        this.append(a, `❯ ${text}`);
        if (a.snap.status === "blocked") {
            if (/^y/i.test(text.trim())) {
                this.append(a, "● 已确认，继续执行…");
                a.snap.blockedReason = undefined;
                this.setStatus(a, "working");
                this.after(3000, () => {
                    this.append(a, "  ⏺ Bash(npm audit fix) 完成，0 vulnerabilities");
                    this.append(a, "● review 收尾完成。");
                    this.setStatus(a, "done");
                    this.after(2000, () => this.setStatus(a, "idle"));
                });
            } else {
                this.append(a, "● 已拒绝该操作，跳过。");
                a.snap.blockedReason = undefined;
                this.setStatus(a, "idle");
            }
        }
    }

    async readPane(agentId: string): Promise<{ text: string; revision: number }> {
        const a = this.must(agentId);
        return { text: a.screen.join("\n"), revision: a.revision };
    }

    async injectSlashCommand(agentId: string, command: string): Promise<void> {
        const a = this.must(agentId);
        this.append(a, `❯ ${command}`);
        this.append(a, `⚙ gateway: 已注入 ${command}（即时生效）`);
    }

    setConfig(agentId: string, patch: Partial<AgentConfig>): void {
        const a = this.must(agentId);
        a.snap.config = { ...a.snap.config, ...patch };
        this.emitChange();
    }

    onChange(cb: () => void): void {
        this.changeCbs.push(cb);
    }

    onStatusChange(cb: (agentId: string, from: string, to: string) => void): void {
        this.statusCbs.push(cb);
    }

    // ---- 内部 ----

    private must(agentId: string): MockAgent {
        const a = this.agents.get(agentId);
        if (!a) throw new Error(`unknown agent: ${agentId}`);
        return a;
    }

    private append(a: MockAgent, line: string): void {
        a.screen.push(line);
        if (a.screen.length > 200) a.screen.splice(0, a.screen.length - 200);
        a.revision += 1;
        this.emitChange();
    }

    private setStatus(a: MockAgent, to: AgentSnapshot["status"]): void {
        const from = a.snap.status;
        if (from === to) return;
        a.snap.status = to;
        a.revision += 1;
        this.emitChange();
        for (const cb of this.statusCbs) cb(a.snap.id, from, to);
    }

    private after(ms: number, fn: () => void): void {
        setTimeout(fn, ms);
    }

    private emitChange(): void {
        for (const cb of this.changeCbs) cb();
    }
}
