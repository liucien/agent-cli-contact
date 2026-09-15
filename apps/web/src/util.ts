import type {
    AgentConfig,
    AgentSnapshot,
    AgentStatus,
    ShellProjection,
} from "@agent-cli-contact/contracts";
import { t } from "./i18n";

export function fmtTime(ts: number | null | undefined): string {
    if (!ts) return "";
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

export function modelLabel(projection: ShellProjection | null, agent: AgentSnapshot): string {
    const cap = projection?.capabilities.find((c) => c.provider === agent.provider);
    const m = cap?.models.find((x) => x.id === agent.config.model);
    return m ? m.label : agent.config.model;
}

export function reasoningLabel(r: AgentConfig["reasoning"]): string {
    return r === "low" ? "Low" : r === "medium" ? "Medium" : "High";
}

export function ctxLabel(c: AgentConfig["contextWindow"]): string {
    return c === "1m" ? "1M" : "200K";
}

export function permLabel(p: AgentConfig["permissionMode"]): string {
    return p === "plan" ? "Plan" : p === "ask" ? "Ask" : "Full access";
}

/** 侧栏配置摘要行，如 "Fable 5 · High · Full access" */
export function configSummary(projection: ShellProjection | null, agent: AgentSnapshot): string {
    return `${modelLabel(projection, agent)} · ${reasoningLabel(agent.config.reasoning)} · ${permLabel(agent.config.permissionMode)}`;
}

/** mesh 消息 from/to 显示名：agent id -> name；user/scheduler 特殊显示 */
export function partyName(projection: ShellProjection | null, id: string): string {
    if (id === "user") return t("party.user");
    if (id === "scheduler") return t("party.scheduler");
    return projection?.agents.find((a) => a.id === id)?.name ?? id;
}

export function statusClass(status: AgentStatus): string {
    switch (status) {
        case "working":
            return "working";
        case "blocked":
            return "blocked";
        case "done":
            return "done";
        default:
            return "idle";
    }
}

/** 终端行着色启发式 */
export function termLineClass(line: string): string {
    const t = line.trimStart();
    if (t.startsWith("❯")) return "tl-p";
    if (t.startsWith("●")) return "tl-g";
    if (line.includes("⏺")) return "tl-tool";
    if (t.startsWith("⇄ mesh:")) return line.includes("待放行") ? "tl-y" : "tl-b";
    return "tl-dim";
}
