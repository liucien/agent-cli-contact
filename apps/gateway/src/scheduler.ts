/**
 * Scheduler（PLAN §5.1 的 MVP 切片）：croner 计算 next-fire，触发时经
 * mesh relay 以 'scheduler' 身份注入 prompt（复用排队/记账基建）。
 * blocked 策略 / pane 回收 / 补偿运行留给 M2。
 */
import { Cron } from "croner";
import { randomUUID } from "node:crypto";
import type { ScheduleSnapshot, ScheduleRunSnapshot } from "@agent-cli-contact/contracts";
import type { MeshRelay } from "./mesh.js";

export interface ScheduleDef {
    id: string;
    name: string;
    cronExpr: string;
    enabled: boolean;
    agentId: string;
    promptTemplate: string;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function humanizeCron(expr: string): string {
    // 极简人话化：仅覆盖 "m h * * *" 与 "m h * * d" 两种常见形态
    const parts = expr.trim().split(/\s+/);
    if (parts.length === 5) {
        const [m, h, , , dow] = parts as [string, string, string, string, string];
        if (/^\d+$/.test(m) && /^\d+$/.test(h)) {
            const time = `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
            if (dow === "*") return time;
            if (/^\d$/.test(dow)) return `${WEEKDAYS[Number(dow)]} ${time}`;
        }
    }
    return expr;
}

export class Scheduler {
    private defs: ScheduleDef[] = [];
    private runs: ScheduleRunSnapshot[] = [];
    private jobs = new Map<string, Cron>();

    constructor(
        private mesh: MeshRelay,
        private onDirty: () => void,
    ) {}

    load(defs: ScheduleDef[], runs: ScheduleRunSnapshot[]): void {
        this.defs = defs;
        this.runs = runs;
        for (const d of defs) this.arm(d);
    }

    snapshots(): ScheduleSnapshot[] {
        return this.defs.map((d) => {
            const job = this.jobs.get(d.id);
            const lastRun = [...this.runs].reverse().find((r) => r.scheduleId === d.id);
            return {
                ...d,
                humanized: humanizeCron(d.cronExpr),
                nextFireAt: d.enabled ? (job?.nextRun()?.getTime() ?? null) : null,
                lastRun,
            };
        });
    }

    persistable(): { defs: ScheduleDef[]; runs: ScheduleRunSnapshot[] } {
        return { defs: this.defs, runs: this.runs.slice(-100) };
    }

    async runNow(scheduleId: string): Promise<void> {
        const d = this.defs.find((d) => d.id === scheduleId);
        if (!d) throw new Error(`unknown schedule: ${scheduleId}`);
        await this.fire(d, Date.now());
    }

    toggle(scheduleId: string): void {
        const d = this.defs.find((d) => d.id === scheduleId);
        if (!d) return;
        d.enabled = !d.enabled;
        this.jobs.get(d.id)?.stop();
        this.jobs.delete(d.id);
        if (d.enabled) this.arm(d);
        this.onDirty();
    }

    stop(): void {
        for (const [, job] of this.jobs) job.stop();
        this.jobs.clear();
    }

    private arm(d: ScheduleDef): void {
        if (!d.enabled) return;
        const job = new Cron(d.cronExpr, () => void this.fire(d, Date.now()));
        this.jobs.set(d.id, job);
    }

    private async fire(d: ScheduleDef, plannedAt: number): Promise<void> {
        const run: ScheduleRunSnapshot = {
            id: randomUUID(),
            scheduleId: d.id,
            plannedAt,
            startedAt: Date.now(),
            settledAt: null,
            status: "running",
        };
        this.runs.push(run);
        this.onDirty();
        try {
            const msg = await this.mesh.send(
                "scheduler",
                d.agentId,
                "prompt",
                `[${d.name}] ${d.promptTemplate}`,
            );
            run.status = msg.status === "injected" ? "done" : "pending";
            run.summary =
                msg.status === "injected" ? "已注入目标 agent" : `消息 ${msg.status}，等待注入`;
        } catch (err) {
            run.status = "error";
            run.summary = String(err);
        }
        run.settledAt = Date.now();
        this.onDirty();
    }
}
