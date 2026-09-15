/**
 * @agent-cli-contact/herdr-client — herdr socket API 的最小 NDJSON 客户端。
 *
 * 实测 herdr 0.8（protocol 19）连接语义：
 *   - 普通请求：一连接一请求，server 回包后立即关闭连接（与 CLI 行为一致）
 *   - events.subscribe：订阅确认后连接保持，事件按行推送；连接上不得再发请求
 * 因此 request() 每次新建连接，subscribe() 使用专用长连接。
 *
 * herdr 处于 0.x，官方承诺未知字段忽略——本客户端只依赖已验证的方法与字段，
 * 升级只碰这一层（PLAN §8）。
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface HerdrAgentSessionInfo {
    source: string; // 如 "herdr:claude"
    agent: string;
    kind: "id" | "path";
    value: string;
}

export interface HerdrAgentInfo {
    terminal_id: string;
    pane_id: string;
    tab_id: string;
    workspace_id: string;
    agent_status: HerdrAgentStatus;
    agent?: string | null;
    display_agent?: string | null;
    name?: string | null;
    agent_session?: HerdrAgentSessionInfo | null;
    terminal_title?: string | null;
    terminal_title_stripped?: string | null;
    cwd?: string | null;
    focused: boolean;
    revision: number;
}

export interface HerdrWorkspaceInfo {
    workspace_id: string;
    label?: string | null;
    focused?: boolean;
    [k: string]: unknown;
}

export interface HerdrPaneReadResult {
    pane_id: string;
    text: string;
    revision: number;
    truncated: boolean;
}

export interface HerdrEvent {
    event: string;
    data: Record<string, unknown> & { type?: string };
}

export interface HerdrSubscription {
    /** 主动关闭订阅连接 */
    close(): void;
    /** 连接结束（主动关闭 resolve；异常断开 reject） */
    done: Promise<void>;
}

export function defaultSocketPath(): string {
    return path.join(os.homedir(), ".config", "herdr", "herdr.sock");
}

export function socketAvailable(socketPath = defaultSocketPath()): boolean {
    try {
        return fs.statSync(socketPath).isSocket();
    } catch {
        return false;
    }
}

export class HerdrClient {
    constructor(private socketPath = defaultSocketPath()) {}

    /** 一连接一请求：连接 → 写一行 → 读响应行 → server 关连接 */
    request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const sock = net.createConnection(this.socketPath);
            let buf = "";
            let settled = false;
            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                fn();
                sock.destroy();
            };
            sock.setEncoding("utf8");
            sock.on("connect", () => {
                sock.write(JSON.stringify({ id: "1", method, params: params ?? {} }) + "\n");
            });
            sock.on("data", (chunk: string) => {
                buf += chunk;
                const idx = buf.indexOf("\n");
                if (idx < 0) return;
                const line = buf.slice(0, idx);
                try {
                    const msg = JSON.parse(line) as {
                        result?: unknown;
                        error?: { code?: string; message?: string };
                    };
                    if (msg.error)
                        settle(() =>
                            reject(
                                new Error(
                                    `herdr ${msg.error!.code ?? "unknown"}: ${msg.error!.message ?? ""}`,
                                ),
                            ),
                        );
                    else settle(() => resolve(msg.result as T));
                } catch (err) {
                    settle(() => reject(err as Error));
                }
            });
            sock.on("error", (err) => settle(() => reject(err)));
            sock.on("close", () =>
                settle(() => reject(new Error(`herdr 连接在响应前关闭 (${method})`))),
            );
        });
    }

    /** 专用长连接订阅：确认后持续接收事件行；连接上不再写任何数据 */
    subscribe(
        subscriptions: Record<string, unknown>[],
        onEvent: (ev: HerdrEvent) => void,
    ): HerdrSubscription {
        const sock = net.createConnection(this.socketPath);
        let buf = "";
        let closedByUs = false;
        const done = new Promise<void>((resolve, reject) => {
            sock.setEncoding("utf8");
            sock.on("connect", () => {
                sock.write(
                    JSON.stringify({ id: "sub", method: "events.subscribe", params: { subscriptions } }) +
                        "\n",
                );
            });
            sock.on("data", (chunk: string) => {
                buf += chunk;
                let idx: number;
                while ((idx = buf.indexOf("\n")) >= 0) {
                    const line = buf.slice(0, idx).trim();
                    buf = buf.slice(idx + 1);
                    if (!line) continue;
                    let msg: Record<string, unknown>;
                    try {
                        msg = JSON.parse(line);
                    } catch {
                        continue;
                    }
                    // 首行为 {"id":"sub","result":{type:"subscription_started"}}，其后均为事件
                    if (typeof msg.event === "string") onEvent(msg as unknown as HerdrEvent);
                    else if (msg.error)
                        reject(new Error(`订阅失败: ${JSON.stringify(msg.error)}`));
                }
            });
            sock.on("error", (err) => (closedByUs ? resolve() : reject(err)));
            sock.on("close", () =>
                closedByUs ? resolve() : reject(new Error("herdr 订阅连接断开")),
            );
        });
        return {
            close: () => {
                closedByUs = true;
                sock.destroy();
            },
            done,
        };
    }

    // ---- 便捷方法（仅覆盖 Gateway 用到的子集） ----

    ping(): Promise<unknown> {
        return this.request("ping");
    }

    agentList(): Promise<{ agents: HerdrAgentInfo[] }> {
        return this.request("agent.list");
    }

    workspaceList(): Promise<{ workspaces: HerdrWorkspaceInfo[] }> {
        return this.request("workspace.list");
    }

    workspaceCreate(label: string, cwd?: string): Promise<{ workspace: HerdrWorkspaceInfo }> {
        return this.request("workspace.create", {
            label,
            cwd: cwd ?? null,
            focus: false,
        });
    }

    workspaceRename(workspaceId: string, label: string): Promise<unknown> {
        return this.request("workspace.rename", {
            workspace_id: workspaceId,
            label,
        });
    }

    workspaceClose(workspaceId: string): Promise<unknown> {
        return this.request("workspace.close", { workspace_id: workspaceId });
    }

    workspaceFocus(workspaceId: string): Promise<unknown> {
        return this.request("workspace.focus", { workspace_id: workspaceId });
    }

    agentPrompt(target: string, text: string): Promise<unknown> {
        return this.request("agent.prompt", { target, text });
    }

    paneRead(
        paneId: string,
        opts: {
            lines?: number;
            source?: "visible" | "recent";
            stripAnsi?: boolean;
        } = {},
    ): Promise<HerdrPaneReadResult> {
        return this.request("pane.read", {
            pane_id: paneId,
            source: opts.source ?? "visible",
            lines: opts.lines,
            strip_ansi: opts.stripAnsi ?? true,
            format: "text",
        });
    }

    paneSendInput(paneId: string, text: string): Promise<unknown> {
        return this.request("pane.send_input", { pane_id: paneId, text });
    }

    paneSendKeys(paneId: string, keys: string[]): Promise<unknown> {
        return this.request("pane.send_input", { pane_id: paneId, keys });
    }

    paneSendText(paneId: string, text: string): Promise<unknown> {
        return this.request("pane.send_text", { pane_id: paneId, text });
    }

    paneClose(paneId: string): Promise<unknown> {
        return this.request("pane.close", { pane_id: paneId });
    }

    paneList(workspaceId?: string): Promise<{ panes: { pane_id: string; tab_id: string }[] }> {
        return this.request("pane.list", { workspace_id: workspaceId ?? null });
    }

    tabCreate(workspaceId: string, label?: string, cwd?: string | null): Promise<unknown> {
        return this.request("tab.create", {
            workspace_id: workspaceId,
            label: label ?? null,
            cwd: cwd ?? null,
            focus: false,
        });
    }

    agentStart(name: string, kind: string, paneId: string): Promise<unknown> {
        return this.request("agent.start", { name, kind, pane_id: paneId });
    }

    /** 订阅 agent 状态与 pane 生命周期事件（专用长连接） */
    subscribeAgentEvents(
        paneIds: string[],
        onEvent: (ev: HerdrEvent) => void,
    ): HerdrSubscription {
        return this.subscribe(
            [
                { type: "pane.created" },
                { type: "pane.closed" },
                { type: "pane.agent_detected" },
                { type: "workspace.created" },
                { type: "workspace.closed" },
                ...paneIds.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
            ],
            onEvent,
        );
    }
}
