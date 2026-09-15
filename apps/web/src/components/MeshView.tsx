import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
    AgentSnapshot,
    MeshMessage,
    MeshTimelineEntry,
    ShellProjection,
} from "@workbench/contracts";
import { call, selectAgent, setMeshPair, setScreen } from "../store";
import { fmtTime, partyName, statusClass } from "../util";
import { t, useI18n, type MsgKey } from "../i18n";
import { HeldActions } from "./MessageCard";
import { RuleForm } from "./RuleForm";

const NODE_W = 218;
const NODE_H = 100;

interface Pt {
    x: number;
    y: number;
}

interface EdgeSpec {
    key: string;
    from: string;
    to: string;
    style: "solid" | "dashed" | "wait";
    label: string;
    /** 同向多条边的错位序号 */
    lane: number;
}

function useSize(ref: React.RefObject<HTMLDivElement>): { w: number; h: number } {
    const [size, setSize] = useState({ w: 900, h: 500 });
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref]);
    return size;
}

function layoutNodes(agents: AgentSnapshot[], w: number, h: number): Map<string, Pt> {
    const map = new Map<string, Pt>();
    const n = agents.length;
    const cx = w / 2;
    const cy = h / 2;
    if (n === 1) {
        const only = agents[0];
        if (only) map.set(only.id, { x: cx, y: cy });
        return map;
    }
    const rx = Math.max(160, w / 2 - NODE_W / 2 - 70);
    const ry = Math.max(110, h / 2 - NODE_H / 2 - 50);
    agents.forEach((a, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n + (n === 2 ? Math.PI / 2 : 0);
        map.set(a.id, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
    });
    return map;
}

function edgeGeometry(a: Pt, b: Pt, lane: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;
    // 端点缩进到节点边缘附近
    const inset = Math.min(dist * 0.38, 125);
    const p0 = { x: a.x + ux * inset, y: a.y + uy * inset };
    const p1 = { x: b.x - ux * inset, y: b.y - uy * inset };
    // 控制点：沿行进方向左侧弯曲，lane 叠加错位
    const px = uy;
    const py = -ux;
    const bow = 34 + lane * 30;
    const mid = { x: (p0.x + p1.x) / 2 + px * bow, y: (p0.y + p1.y) / 2 + py * bow };
    const labelPt = {
        x: 0.25 * p0.x + 0.5 * mid.x + 0.25 * p1.x,
        y: 0.25 * p0.y + 0.5 * mid.y + 0.25 * p1.y,
    };
    return { d: `M ${p0.x} ${p0.y} Q ${mid.x} ${mid.y} ${p1.x} ${p1.y}`, labelPt };
}

function buildEdges(projection: ShellProjection, agents: AgentSnapshot[]): EdgeSpec[] {
    const ids = new Set(agents.map((a) => a.id));
    const edges: EdgeSpec[] = [];
    const lanes = new Map<string, number>();
    const nextLane = (from: string, to: string): number => {
        const k = `${from}->${to}`;
        const lane = lanes.get(k) ?? 0;
        lanes.set(k, lane + 1);
        return lane;
    };

    // 消息聚合（按 from->to）
    const groups = new Map<string, MeshMessage[]>();
    for (const m of projection.mesh.messages) {
        if (!ids.has(m.from) || !ids.has(m.to)) continue;
        const k = `${m.from}->${m.to}`;
        const arr = groups.get(k);
        if (arr) arr.push(m);
        else groups.set(k, [m]);
    }
    for (const [k, msgs] of groups) {
        const [from = "", to = ""] = k.split("->");
        const held = msgs.filter((m) => m.status === "held");
        const normal = msgs.filter((m) => m.status !== "held");
        if (normal.length > 0) {
            const injected = normal.filter((m) => m.status === "injected");
            const latest = normal.reduce((acc, m) => Math.max(acc, m.createdAt), 0);
            const label =
                injected.length > 0
                    ? t("mesh.edgePrompt", { n: normal.length, time: fmtTime(latest) })
                    : t("mesh.edgeQueued", { n: normal.length });
            edges.push({
                key: `m-${k}`,
                from,
                to,
                style: "solid",
                label,
                lane: nextLane(from, to),
            });
        }
        if (held.length > 0) {
            edges.push({
                key: `h-${k}`,
                from,
                to,
                style: "dashed",
                label: t("mesh.edgeHeld", { n: held.length }),
                lane: nextLane(from, to),
            });
        }
    }

    // 等待规则（虚点黄线：target → watcher，即"谁在等谁"）
    for (const r of projection.mesh.rules) {
        if (!r.enabled || !ids.has(r.watcherAgent) || !ids.has(r.targetAgent)) continue;
        edges.push({
            key: `r-${r.id}`,
            from: r.targetAgent,
            to: r.watcherAgent,
            style: "wait",
            label: `wait: ${r.triggerState}`,
            lane: nextLane(r.targetAgent, r.watcherAgent),
        });
    }
    return edges;
}

function nodeExtraChips(projection: ShellProjection, agent: AgentSnapshot) {
    const chips: { cls: string; text: string }[] = [];
    if (agent.status === "working") chips.push({ cls: "d", text: `turn #${agent.turn}` });
    const queuedTo = projection.mesh.messages.filter(
        (m) => m.to === agent.id && m.status === "queued",
    ).length;
    if (queuedTo > 0) chips.push({ cls: "d", text: t("mesh.chipQueue", { n: queuedTo }) });
    const heldFrom = projection.mesh.messages.filter(
        (m) => m.from === agent.id && m.status === "held",
    ).length;
    if (heldFrom > 0) chips.push({ cls: "d", text: t("mesh.chipHeld", { n: heldFrom }) });
    const waiting = projection.mesh.rules.some((r) => r.enabled && r.targetAgent === agent.id);
    if (waiting) chips.push({ cls: "b", text: t("mesh.chipWaiting") });
    return chips;
}

const STATUS_PILL: Record<string, string> = {
    working: "w",
    blocked: "b",
    idle: "i",
    done: "d",
    unknown: "i",
};

// ---------- 拓扑图 ----------

function Graph({
    projection,
    pair,
}: {
    projection: ShellProjection;
    pair: [string, string] | null;
}) {
    const { locale } = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    const { w, h } = useSize(ref);
    const agents = projection.agents;
    const positions = useMemo(() => layoutNodes(agents, w, h), [agents, w, h]);
    // locale 变化需要重建带翻译文案的边标签
    const edges = useMemo(() => buildEdges(projection, agents), [projection, agents, locale]);

    const pickPeer = (agentId: string): string | null => {
        let best: string | null = null;
        let bestCount = -1;
        for (const other of agents) {
            if (other.id === agentId) continue;
            const count =
                projection.mesh.messages.filter(
                    (m) =>
                        (m.from === agentId && m.to === other.id) ||
                        (m.from === other.id && m.to === agentId),
                ).length +
                (projection.mesh.rules.some(
                    (r) =>
                        r.enabled &&
                        ((r.watcherAgent === agentId && r.targetAgent === other.id) ||
                            (r.targetAgent === agentId && r.watcherAgent === other.id)),
                )
                    ? 1
                    : 0);
            if (count > bestCount) {
                bestCount = count;
                best = other.id;
            }
        }
        return best;
    };

    const onNodeClick = (agentId: string) => {
        const peer = pickPeer(agentId);
        setMeshPair(peer ? [agentId, peer] : null);
    };

    const inPair = (id: string) => pair !== null && (pair[0] === id || pair[1] === id);

    return (
        <div className="graph" ref={ref}>
            {agents.length === 0 && <div className="graph-empty">{t("mesh.noAgents")}</div>}
            <svg>
                <defs>
                    <marker
                        id="arrow-b"
                        markerWidth="9"
                        markerHeight="9"
                        refX="7"
                        refY="3.5"
                        orient="auto"
                    >
                        <path d="M0,0 L7,3.5 L0,7 z" fill="#7aa2f7" />
                    </marker>
                    <marker
                        id="arrow-y"
                        markerWidth="9"
                        markerHeight="9"
                        refX="7"
                        refY="3.5"
                        orient="auto"
                    >
                        <path d="M0,0 L7,3.5 L0,7 z" fill="#d29922" />
                    </marker>
                </defs>
                {edges.map((e) => {
                    const a = positions.get(e.from);
                    const b = positions.get(e.to);
                    if (!a || !b) return null;
                    const { d } = edgeGeometry(a, b, e.lane);
                    const stroke = e.style === "wait" ? "#d29922" : "#7aa2f7";
                    const dash =
                        e.style === "dashed" ? "5 4" : e.style === "wait" ? "3 5" : undefined;
                    return (
                        <g key={e.key}>
                            <path
                                d={d}
                                stroke={stroke}
                                strokeWidth={1.6}
                                fill="none"
                                strokeDasharray={dash}
                                markerEnd={e.style === "wait" ? "url(#arrow-y)" : "url(#arrow-b)"}
                            />
                            <path
                                className="hit"
                                d={d}
                                stroke="transparent"
                                strokeWidth={14}
                                fill="none"
                                onClick={() => setMeshPair([e.from, e.to])}
                            />
                        </g>
                    );
                })}
            </svg>

            {edges.map((e) => {
                const a = positions.get(e.from);
                const b = positions.get(e.to);
                if (!a || !b) return null;
                const { labelPt } = edgeGeometry(a, b, e.lane);
                return (
                    <button
                        key={`lb-${e.key}`}
                        className={`elabel${e.style === "wait" ? " wait" : ""}`}
                        style={{ left: labelPt.x, top: labelPt.y }}
                        onClick={() => setMeshPair([e.from, e.to])}
                    >
                        {e.label}
                    </button>
                );
            })}

            {agents.map((a) => {
                const p = positions.get(a.id);
                if (!p) return null;
                const chips = nodeExtraChips(projection, a);
                return (
                    <button
                        key={a.id}
                        className={`node ${statusClass(a.status)}${inPair(a.id) ? " sel" : ""}`}
                        style={{ left: p.x - NODE_W / 2, top: p.y - NODE_H / 2 }}
                        onClick={() => onNodeClick(a.id)}
                    >
                        <div className="nm">
                            <span className={`st ${statusClass(a.status)}`} /> {a.name}
                            <span className="prov">{a.provider}</span>
                        </div>
                        <div className="task">{a.taskSummary ?? "—"}</div>
                        <div className="meta">
                            <span className={`pill ${STATUS_PILL[a.status] ?? "i"}`}>
                                {a.status}
                            </span>
                            {chips.map((c, i) => (
                                <span key={i} className={`pill ${c.cls}`}>
                                    {c.text}
                                </span>
                            ))}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// ---------- 右侧详情 ----------

function DetailPanel({
    projection,
    pair,
}: {
    projection: ShellProjection;
    pair: [string, string] | null;
}) {
    const { t } = useI18n();
    if (!pair) {
        return (
            <div className="detail">
                <div className="thread-empty">{t("mesh.detailHint")}</div>
            </div>
        );
    }
    const [a, b] = pair;
    const msgs = projection.mesh.messages
        .filter((m) => (m.from === a && m.to === b) || (m.from === b && m.to === a))
        .sort((x, y) => x.createdAt - y.createdAt);

    return (
        <div className="detail">
            <div className="hd">
                <b>
                    {partyName(projection, a)} ⇄ {partyName(projection, b)}
                </b>
                <div className="sub">
                    {projection.mesh.relayApproval
                        ? t("mesh.detailSubOn", { n: msgs.length })
                        : t("mesh.detailSubOff", { n: msgs.length })}
                </div>
            </div>
            <div className="thread">
                {msgs.length === 0 && (
                    <div className="thread-empty">{t("mesh.noMessagesBetween")}</div>
                )}
                {msgs.map((m) =>
                    m.status === "held" ? (
                        <div key={m.id} className="hold">
                            <div className="hh">
                                {t("status.held")} · {partyName(projection, m.from)} →{" "}
                                {partyName(projection, m.to)}
                            </div>
                            <div className="bd">{m.body}</div>
                            <HeldActions message={m} />
                        </div>
                    ) : (
                        <div key={m.id} className={`bub${m.from === a ? " rt" : ""}`}>
                            <div className="who">{partyName(projection, m.from)}</div>
                            {m.body}
                            {m.attachment && (
                                <span className="attach">
                                    ⎘ {m.attachment.label}
                                    {m.attachment.diffStat ? ` · ${m.attachment.diffStat}` : ""}
                                </span>
                            )}
                            <span className="t">
                                {fmtTime(m.createdAt)}
                                {m.status === "injected"
                                    ? ` · ${t("status.injectedShort")}`
                                    : m.status === "queued"
                                      ? ` · ${t("status.queued")}`
                                      : m.status === "denied"
                                        ? ` · ${t("status.denied")}`
                                        : ""}
                            </span>
                        </div>
                    ),
                )}
            </div>
        </div>
    );
}

// ---------- 底部时间线 ----------

type TopFilter = "all" | "blocked" | "hour" | "sched";
type KindFilter = "all" | "message" | "status" | "wait";

function kindTag(entry: MeshTimelineEntry): { cls: string; key: MsgKey } {
    if (entry.kind === "wait") return { cls: "w", key: "kind.wait" };
    if (entry.kind === "message") return { cls: "p", key: "kind.prompt" };
    return { cls: "s", key: "kind.status" };
}

function Timeline({
    projection,
    topFilter,
}: {
    projection: ShellProjection;
    topFilter: TopFilter;
}) {
    const { t } = useI18n();
    const [kindFilter, setKindFilter] = useState<KindFilter>("all");

    const entries = useMemo(() => {
        let list = [...projection.mesh.timeline].sort((x, y) => y.at - x.at);
        if (topFilter === "blocked") {
            list = list.filter((e) => e.pendingAction === "blocked" || e.text.includes("blocked"));
        } else if (topFilter === "hour") {
            const cutoff = Date.now() - 3600_000;
            list = list.filter((e) => e.at >= cutoff);
        } else if (topFilter === "sched") {
            list = list.filter((e) => e.from === "scheduler");
        }
        if (kindFilter === "message") list = list.filter((e) => e.kind === "message");
        else if (kindFilter === "status")
            list = list.filter((e) => e.kind === "status" || e.kind === "system");
        else if (kindFilter === "wait") list = list.filter((e) => e.kind === "wait");
        return list;
    }, [projection.mesh.timeline, topFilter, kindFilter]);

    const findMessage = (id: string | undefined) =>
        id ? projection.mesh.messages.find((m) => m.id === id) : undefined;

    const kindFilters: { id: KindFilter; label: string }[] = [
        { id: "all", label: t("filter.all") },
        { id: "message", label: t("kind.prompt") },
        { id: "status", label: t("kind.status") },
        { id: "wait", label: t("kind.wait") },
    ];

    return (
        <div className="timeline">
            <div className="tl-h">
                {t("mesh.timeline")}
                <span className="fs">
                    {kindFilters.map((f) => (
                        <button
                            key={f.id}
                            className={`f${kindFilter === f.id ? " on" : ""}`}
                            onClick={() => setKindFilter(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </span>
            </div>
            <div className="tl-rows">
                {entries.length === 0 && <div className="tl-empty">{t("mesh.noRecords")}</div>}
                {entries.map((e) => {
                    const tag = kindTag(e);
                    const msg = findMessage(e.messageId);
                    let action: JSX.Element | null = null;
                    if (e.pendingAction === "approve" && e.messageId) {
                        const mid = e.messageId;
                        action = (
                            <button
                                className="stt hold"
                                onClick={() => void call("mesh.approve", { messageId: mid })}
                            >
                                {t("status.held")}
                            </button>
                        );
                    } else if (e.pendingAction === "blocked") {
                        const agentId = e.from;
                        action = (
                            <button
                                className="stt hold"
                                onClick={() =>
                                    agentId && selectAgent(agentId, { toWorkbench: true })
                                }
                            >
                                {t("status.pending")}
                            </button>
                        );
                    } else if (e.kind === "wait") {
                        action = <span className="stt dim">{t("status.listening")}</span>;
                    } else if (msg) {
                        action =
                            msg.status === "injected" ? (
                                <span className="stt ok">{t("status.injectedShort")}</span>
                            ) : msg.status === "queued" ? (
                                <span className="stt dim">{t("status.queued")}</span>
                            ) : msg.status === "denied" ? (
                                <span className="stt dim">{t("status.denied")}</span>
                            ) : (
                                <span className="stt hold">{t("status.held")}</span>
                            );
                    }
                    return (
                        <div key={e.id} className="row">
                            <span className="time mono">{fmtTime(e.at)}</span>
                            <span className="dir">
                                {e.kind === "status" || e.kind === "system" ? (
                                    <>
                                        <b>{partyName(projection, e.from ?? "")}</b>{" "}
                                        {t("mesh.system")}
                                    </>
                                ) : e.kind === "wait" ? (
                                    <>
                                        <b>{partyName(projection, e.from ?? "")}</b> ⌛{" "}
                                        <b>{partyName(projection, e.to ?? "")}</b>
                                    </>
                                ) : (
                                    <>
                                        <b>{partyName(projection, e.from ?? "")}</b> →{" "}
                                        <b>{partyName(projection, e.to ?? "")}</b>
                                    </>
                                )}
                            </span>
                            <span className={`kind ${tag.cls}`}>{t(tag.key)}</span>
                            <span className="sum">{e.text}</span>
                            {action ?? <span className="stt dim" />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---------- 整屏 ----------

export function MeshView({
    projection,
    pair,
}: {
    projection: ShellProjection;
    pair: [string, string] | null;
}) {
    const { t } = useI18n();
    const [topFilter, setTopFilter] = useState<TopFilter>("all");
    const [showRuleForm, setShowRuleForm] = useState(false);

    const topFilters: { id: TopFilter; label: string }[] = [
        { id: "all", label: t("filter.all") },
        { id: "blocked", label: t("filter.blockedOnly") },
        { id: "hour", label: t("filter.lastHour") },
        { id: "sched", label: t("filter.fromSchedule") },
    ];

    return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="toolbar">
                <button className="chip" onClick={() => setScreen("workbench")}>
                    {t("mesh.back")}
                </button>
                <b>Agent Mesh</b>
                {topFilters.map((f) => (
                    <button
                        key={f.id}
                        className={`f${topFilter === f.id ? " on" : ""}`}
                        onClick={() => setTopFilter(f.id)}
                    >
                        {f.label}
                    </button>
                ))}
                <div className="r">
                    <span>{t("mesh.relayApproval")}</span>
                    <button
                        className={`switch${projection.mesh.relayApproval ? " on" : ""}`}
                        title={t("mesh.relayToggle")}
                        onClick={() =>
                            void call("mesh.setRelayApproval", {
                                enabled: !projection.mesh.relayApproval,
                            })
                        }
                    />
                    <button className="chip" onClick={() => setShowRuleForm((v) => !v)}>
                        {t("mesh.newRule")}
                    </button>
                </div>
            </div>

            {showRuleForm && (
                <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)" }}>
                    <RuleForm agents={projection.agents} onClose={() => setShowRuleForm(false)} />
                </div>
            )}

            <div className="mesh-content">
                <Graph projection={projection} pair={pair} />
                <DetailPanel projection={projection} pair={pair} />
            </div>

            <Timeline projection={projection} topFilter={topFilter} />
        </div>
    );
}
