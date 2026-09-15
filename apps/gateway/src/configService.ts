/**
 * Agent 配置切换（PLAN §5.4）：按 per-provider capability 表决定每项配置
 * 走「即时注入 slash 命令 / 排队到 turn 结束 / 重启会话」哪条路径。
 * MVP 实现即时路径 + working 排队；重启路径仅记账并如实上报。
 */
import type { AgentConfig, AgentApplyConfigResult } from "@agent-cli-contact/contracts";
import type { AgentRuntime } from "./runtime.js";
import { capabilitiesFor, modelLabel } from "./capabilities.js";

interface QueuedChange {
    agentId: string;
    command: string;
    patch: Partial<AgentConfig>;
    label: string;
}

export class ConfigService {
    private queue: QueuedChange[] = [];

    constructor(
        private runtime: AgentRuntime,
        private notify: (level: "info" | "warn", text: string) => void,
    ) {
        // working 中排队的切换，等 turn 结束（离开 working）后注入
        runtime.onStatusChange((agentId, from, to) => {
            if (from === "working" && to !== "working") void this.flushQueue(agentId);
        });
    }

    async apply(agentId: string, next: AgentConfig): Promise<AgentApplyConfigResult> {
        const agent = this.runtime.getAgent(agentId);
        if (!agent) throw new Error(`unknown agent: ${agentId}`);
        const cap = capabilitiesFor(agent.provider);
        const cur = agent.config;
        const result: AgentApplyConfigResult = { applied: [], queued: [], restartRequired: [] };
        const working = agent.status === "working";

        const handle = async (
            label: string,
            path: "immediate" | "restart" | "unsupported",
            command: string | null,
            patch: Partial<AgentConfig>,
        ) => {
            if (path === "unsupported") return; // UI 已置灰，防御性忽略
            if (path === "restart") {
                // MVP：记账配置，实际 pane 重启 + resume 留给 M2.5
                this.runtime.setConfig(agentId, patch);
                result.restartRequired.push(label);
                return;
            }
            if (working) {
                if (command) this.queue.push({ agentId, command, patch, label });
                result.queued.push(label);
                return;
            }
            if (command) await this.runtime.injectSlashCommand(agentId, command);
            this.runtime.setConfig(agentId, patch);
            result.applied.push(label);
        };

        if (next.model !== cur.model) {
            await handle(
                `模型 → ${modelLabel(next.model)}`,
                cap.sessionModelSwitch,
                `/model ${next.model}`,
                {
                    model: next.model,
                },
            );
        }
        if (next.reasoning !== cur.reasoning) {
            await handle(`推理强度 → ${next.reasoning}`, cap.reasoningSwitch, null, {
                reasoning: next.reasoning,
            });
        }
        if (next.contextWindow !== cur.contextWindow) {
            await handle(`上下文 → ${next.contextWindow}`, cap.reasoningSwitch, null, {
                contextWindow: next.contextWindow,
            });
        }
        if (next.permissionMode !== cur.permissionMode) {
            await handle(`权限模式 → ${next.permissionMode}`, cap.permissionSwitch, null, {
                permissionMode: next.permissionMode,
            });
        }
        return result;
    }

    private async flushQueue(agentId: string): Promise<void> {
        const mine = this.queue.filter((q) => q.agentId === agentId);
        if (!mine.length) return;
        this.queue = this.queue.filter((q) => q.agentId !== agentId);
        for (const q of mine) {
            try {
                await this.runtime.injectSlashCommand(agentId, q.command);
                this.runtime.setConfig(agentId, q.patch);
                this.notify("info", `${agentId}: 排队的配置已生效（${q.label}）`);
            } catch (err) {
                this.notify("warn", `${agentId}: 排队配置注入失败 ${String(err)}`);
            }
        }
    }
}
