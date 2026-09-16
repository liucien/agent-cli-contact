/**
 * ThreadLog — gateway 自建对话历史。
 *
 * 全屏 TUI（Claude Code 等）走 alternate screen，终端缓冲只有当前帧，
 * 读屏拿不到历史；而所有 prompt 注入（用户/mesh/定时任务）都经 gateway，
 * turn 边界也由状态订阅掌握。因此在两个时机记账：
 *   - prompt 注入 → user 条目
 *   - working → done/idle/blocked → 读当前屏幕帧存 assistant 条目
 * 每 agent 保留最近 MAX_RECORDS 条，随 state.json 持久化。
 */
import type { ThreadRecord } from "@agent-cli-contact/contracts";
import type { AgentRuntime } from "./runtime.js";
import { readAgentTranscript, sanitizePaneText } from "./transcript.js";

const MAX_RECORDS = 60;

export class ThreadLog {
    /** agentId -> 记录（时间升序） */
    private threads: Map<string, ThreadRecord[]>;

    constructor(
        private runtime: AgentRuntime,
        persisted: Record<string, ThreadRecord[]> | undefined,
        private onDirty: () => void,
    ) {
        this.threads = new Map(Object.entries(persisted ?? {}));
        runtime.onStatusChange((agentId, from, to) => {
            if (from === "working" && to !== "working") void this.captureFrame(agentId);
        });
    }

    /** prompt 注入时记 user 条目（text 已含 mesh/定时任务前缀） */
    user(agentId: string, text: string): void {
        this.push(agentId, { role: "user", text, at: Date.now() });
    }

    get(agentId: string): ThreadRecord[] {
        try {
            const sessionInfo = this.runtime.getSessionInfo(agentId);
            const agent = this.runtime.getAgent(agentId);
            if (agent && sessionInfo?.session?.value) {
                const parsed = readAgentTranscript(agent.provider, sessionInfo.session.value, sessionInfo.cwd);
                if (parsed && parsed.length > 0) {
                    const memRecords = this.threads.get(agentId) ?? [];
                    const pendingUserMsgs = memRecords.filter(
                        (r) => r.role === "user" && !parsed.some((p) => p.text.trim() === r.text.trim()),
                    );
                    if (pendingUserMsgs.length > 0) {
                        return [...parsed, ...pendingUserMsgs];
                    }
                    return parsed;
                }
            }
        } catch {
            // 降级使用内部缓存
        }
        return this.threads.get(agentId) ?? [];
    }

    remove(agentId: string): void {
        if (this.threads.delete(agentId)) this.onDirty();
    }

    persistable(): Record<string, ThreadRecord[]> {
        return Object.fromEntries(this.threads);
    }

    /** turn 结束：优先从结构化 transcript 取，fallback 读当前屏幕并降噪 */
    private async captureFrame(agentId: string): Promise<void> {
        try {
            const sessionInfo = this.runtime.getSessionInfo(agentId);
            const agent = this.runtime.getAgent(agentId);
            if (agent && sessionInfo?.session?.value) {
                const parsed = readAgentTranscript(agent.provider, sessionInfo.session.value, sessionInfo.cwd);
                if (parsed && parsed.length > 0) {
                    this.threads.set(agentId, parsed);
                    this.onDirty();
                    return;
                }
            }

            const { text } = await this.runtime.readPane(agentId);
            const cleaned = sanitizePaneText(text);
            if (!cleaned.trim()) return;
            const items = this.threads.get(agentId) ?? [];
            const lastAssistant = [...items].reverse().find((r) => r.role === "assistant");
            if (lastAssistant?.text === cleaned) return;
            this.push(agentId, { role: "assistant", text: cleaned, at: Date.now() });
        } catch {
            // agent 可能已消失
        }
    }

    private push(agentId: string, record: ThreadRecord): void {
        const items = this.threads.get(agentId) ?? [];
        items.push(record);
        if (items.length > MAX_RECORDS) items.splice(0, items.length - MAX_RECORDS);
        this.threads.set(agentId, items);
        this.onDirty();
    }
}
