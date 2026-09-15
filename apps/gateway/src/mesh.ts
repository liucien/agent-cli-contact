/**
 * Mesh Relay（PLAN §5.3）：agent 间通信一律走 Gateway 记账后再注入，
 * 换来可观测 / 中继审批 / 排队语义。防失控三道闸默认全开：
 *   1. 中继审批（agent 发起的 reply 方向默认需人工放行）
 *   2. 每对 agent 限速 10 条/小时，超限 hold
 *   3. 循环检测：A→B→A 链路深度 >3 强制 hold
 */
import { randomUUID } from "node:crypto";
import type {
    MeshMessage,
    MeshMessageKind,
    MeshRule,
    MeshTimelineEntry,
} from "@agent-cli-contact/contracts";
import type { AgentRuntime } from "./runtime.js";

const RATE_LIMIT_PER_HOUR = 10;
const LOOP_DEPTH_LIMIT = 3;
const LOOP_WINDOW_MS = 30 * 60 * 1000;

export class MeshRelay {
    messages: MeshMessage[] = [];
    rules: MeshRule[] = [];
    timeline: MeshTimelineEntry[] = [];
    relayApproval = true;

    private onDirty: () => void;
    private notify: (level: "info" | "warn", text: string) => void;

    constructor(
        private runtime: AgentRuntime,
        opts: { onDirty: () => void; notify: (level: "info" | "warn", text: string) => void },
    ) {
        this.onDirty = opts.onDirty;
        this.notify = opts.notify;
        runtime.onStatusChange((agentId, from, to) => this.handleStatusChange(agentId, from, to));
    }

    /** 发送一条 agent 间消息（from 可为 'user' 代发 / 'scheduler'） */
    async send(
        from: string,
        to: string,
        kind: MeshMessageKind,
        body: string,
    ): Promise<MeshMessage> {
        const msg: MeshMessage = {
            id: randomUUID(),
            from,
            to,
            kind,
            body,
            status: "queued",
            createdAt: Date.now(),
            injectedAt: null,
        };
        const isHumanOrSystem = from === "user" || from === "scheduler";

        // 三道闸（仅对 agent 发起的消息）
        if (!isHumanOrSystem) {
            if (this.recentPairCount(from, to) >= RATE_LIMIT_PER_HOUR) {
                msg.status = "held";
                msg.heldReason = `超限：${from}→${to} 每小时 ${RATE_LIMIT_PER_HOUR} 条`;
                this.notify("warn", `mesh 限速触发：${from} → ${to} 已 hold`);
            } else if (this.loopDepth(from, to) > LOOP_DEPTH_LIMIT) {
                msg.status = "held";
                msg.heldReason = `循环检测：${from}⇄${to} 链路深度 > ${LOOP_DEPTH_LIMIT}`;
                this.notify("warn", `mesh 循环检测触发：${from} ⇄ ${to} 已强制 hold`);
            } else if (this.relayApproval && kind === "reply") {
                msg.status = "held";
                msg.heldReason = "中继审批：reply 方向需人工放行";
            }
        }

        this.messages.push(msg);
        this.pushTimeline({
            kind: "message",
            from,
            to,
            messageId: msg.id,
            text: body.length > 60 ? body.slice(0, 60) + "…" : body,
            pendingAction: msg.status === "held" ? "approve" : null,
        });

        if (msg.status === "queued") await this.tryInject(msg);
        this.onDirty();
        return msg;
    }

    /** 放行 held 消息（可编辑后放行） */
    async approve(messageId: string, editedBody?: string): Promise<void> {
        const msg = this.mustMessage(messageId);
        if (msg.status !== "held") throw new Error(`消息不在待放行状态: ${msg.status}`);
        if (editedBody) msg.body = editedBody;
        msg.status = "queued";
        msg.heldReason = undefined;
        this.clearPending(messageId);
        await this.tryInject(msg);
        this.onDirty();
    }

    deny(messageId: string): void {
        const msg = this.mustMessage(messageId);
        msg.status = "denied";
        this.clearPending(messageId);
        this.pushTimeline({ kind: "system", text: `已驳回 ${msg.from} → ${msg.to} 的消息` });
        this.onDirty();
    }

    setRelayApproval(enabled: boolean): void {
        this.relayApproval = enabled;
        this.pushTimeline({ kind: "system", text: `中继审批已${enabled ? "开启" : "关闭"}` });
        this.onDirty();
    }

    createRule(rule: Omit<MeshRule, "id" | "enabled">): MeshRule {
        const r: MeshRule = { ...rule, id: randomUUID(), enabled: true };
        this.rules.push(r);
        this.pushTimeline({
            kind: "wait",
            from: r.targetAgent,
            to: r.watcherAgent,
            text: `注册 wait-for-state: ${r.triggerState} → ${r.actionPrompt.slice(0, 40)}`,
        });
        this.onDirty();
        return r;
    }

    toggleRule(ruleId: string): void {
        const r = this.rules.find((r) => r.id === ruleId);
        if (r) {
            r.enabled = !r.enabled;
            this.onDirty();
        }
    }

    deleteRule(ruleId: string): void {
        this.rules = this.rules.filter((r) => r.id !== ruleId);
        this.onDirty();
    }

    // ---- 内部 ----

    /** 目标 idle 才注入，否则留队列（herdr 裸 prompt 会直接打断对方） */
    private async tryInject(msg: MeshMessage): Promise<void> {
        const target = this.runtime.getAgent(msg.to);
        if (!target) {
            msg.status = "held";
            msg.heldReason = `目标 agent 不存在: ${msg.to}`;
            return;
        }
        if (target.status !== "idle" && target.status !== "done") return; // 保持 queued
        await this.inject(msg);
    }

    private async inject(msg: MeshMessage): Promise<void> {
        const label =
            msg.from === "user"
                ? "用户代发"
                : msg.from === "scheduler"
                  ? "定时任务"
                  : `来自 ${msg.from}`;
        await this.runtime.prompt(msg.to, `[mesh · ${label}] ${msg.body}`);
        msg.status = "injected";
        msg.injectedAt = Date.now();
        this.pushTimeline({ kind: "system", text: `已注入 ${msg.from} → ${msg.to}` });
    }

    /** 状态迁移：入时间线 + 触发排队消息注入 + 触发协作规则 */
    private handleStatusChange(agentId: string, from: string, to: string): void {
        this.pushTimeline({
            kind: "status",
            from: agentId,
            text: `${from} → ${to}`,
            pendingAction: to === "blocked" ? "blocked" : null,
        });

        if (to === "idle" || to === "done") {
            const queued = this.messages.filter((m) => m.to === agentId && m.status === "queued");
            for (const m of queued)
                this.inject(m)
                    .then(() => this.onDirty())
                    .catch((err) => this.notify("warn", `mesh 注入失败: ${String(err)}`));
        }

        for (const rule of this.rules) {
            if (!rule.enabled || rule.watcherAgent !== agentId || rule.triggerState !== to)
                continue;
            if (rule.oneShot) rule.enabled = false;
            this.send(rule.watcherAgent, rule.targetAgent, "prompt", rule.actionPrompt).catch(
                (err) => this.notify("warn", `协作规则执行失败: ${String(err)}`),
            );
            this.notify("info", `协作规则触发：${rule.watcherAgent} ${to} → ${rule.targetAgent}`);
        }
        this.onDirty();
    }

    private recentPairCount(from: string, to: string): number {
        const cutoff = Date.now() - 60 * 60 * 1000;
        return this.messages.filter(
            (m) => m.from === from && m.to === to && m.createdAt > cutoff && m.status !== "denied",
        ).length;
    }

    /** A→B→A 交替链深度（近 30 分钟） */
    private loopDepth(from: string, to: string): number {
        const cutoff = Date.now() - LOOP_WINDOW_MS;
        const recent = this.messages
            .filter(
                (m) =>
                    m.createdAt > cutoff &&
                    ((m.from === from && m.to === to) || (m.from === to && m.to === from)),
            )
            .sort((a, b) => b.createdAt - a.createdAt);
        let depth = 1; // 当前这条
        let expectFrom = to; // 上一条应是对方发来的
        for (const m of recent) {
            if (m.from === expectFrom) {
                depth += 1;
                expectFrom = expectFrom === from ? to : from;
            } else break;
        }
        return depth;
    }

    private pushTimeline(entry: Omit<MeshTimelineEntry, "id" | "at">): void {
        this.timeline.push({ ...entry, id: randomUUID(), at: Date.now() });
        if (this.timeline.length > 500) this.timeline.splice(0, this.timeline.length - 500);
    }

    private clearPending(messageId: string): void {
        for (const t of this.timeline) if (t.messageId === messageId) t.pendingAction = null;
    }

    private mustMessage(id: string): MeshMessage {
        const m = this.messages.find((m) => m.id === id);
        if (!m) throw new Error(`unknown message: ${id}`);
        return m;
    }
}
