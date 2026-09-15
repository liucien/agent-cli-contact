import { useEffect, useMemo, useRef, useState } from "react";
import type {
    AgentSnapshot,
    MeshMessage,
    MeshSendParams,
    MeshTimelineEntry,
    ShellProjection,
} from "@agent-cli-contact/contracts";
import { call, selectAgent, setRightTab, type RightTab } from "../store";
import { partyName, termLineClass } from "../util";
import { useI18n, type MsgKey } from "../i18n";
import { MessageCard } from "./MessageCard";
import { RuleForm } from "./RuleForm";

const TRIGGER_KEY: Record<string, MsgKey> = {
    done: "collab.trigger.done",
    blocked: "collab.trigger.blocked",
    idle: "collab.trigger.idle",
};

type FeedItem =
    | { kind: "message"; at: number; message: MeshMessage }
    | { kind: "status"; at: number; entry: MeshTimelineEntry };

function CollabTab({ projection }: { projection: ShellProjection }) {
    const { t } = useI18n();
    const [showRuleForm, setShowRuleForm] = useState(false);
    const feedRef = useRef<HTMLDivElement>(null);

    const { messages, rules, timeline } = projection.mesh;
    const enabledRules = rules.filter((r) => r.enabled);
    const queued = messages.filter((m) => m.status === "queued");
    const blockedAgents = projection.agents.filter((a) => a.status === "blocked");

    const feed = useMemo<FeedItem[]>(() => {
        const items: FeedItem[] = [
            ...messages.map<FeedItem>((m) => ({ kind: "message", at: m.createdAt, message: m })),
            ...timeline
                .filter((e) => e.kind === "status")
                .map<FeedItem>((e) => ({ kind: "status", at: e.at, entry: e })),
        ];
        return items.sort((a, b) => a.at - b.at);
    }, [messages, timeline]);

    useEffect(() => {
        const el = feedRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [feed.length]);

    return (
        <div className="rp-body" ref={feedRef}>
            <div className="sec-h">
                {t("collab.relations")}
                <button className="add-rule" onClick={() => setShowRuleForm((v) => !v)}>
                    {t("collab.addRule")}
                </button>
            </div>
            {showRuleForm && (
                <RuleForm agents={projection.agents} onClose={() => setShowRuleForm(false)} />
            )}
            {enabledRules.map((r) => (
                <div key={r.id} className="rel">
                    <b>{partyName(projection, r.watcherAgent)}</b> <span className="arrow">⌛</span>{" "}
                    <b>{partyName(projection, r.targetAgent)}</b>
                    <span className="why">
                        {TRIGGER_KEY[r.triggerState]
                            ? t(TRIGGER_KEY[r.triggerState] as MsgKey)
                            : r.triggerState}
                    </span>
                    <button
                        className="del"
                        title={t("collab.deleteRule")}
                        onClick={() => void call("mesh.rule.delete", { ruleId: r.id })}
                    >
                        ✕
                    </button>
                </div>
            ))}
            {queued.map((m) => (
                <div key={m.id} className="rel">
                    <b>{partyName(projection, m.from)}</b> <span className="arrow">⇢</span>{" "}
                    <b>{partyName(projection, m.to)}</b>
                    <span className="why">{t("collab.waitingIdle")}</span>
                </div>
            ))}
            {enabledRules.length === 0 && queued.length === 0 && !showRuleForm && (
                <div className="rel" style={{ color: "var(--dim2)" }}>
                    {t("collab.noRelations")}
                </div>
            )}

            <div className="sec-h" style={{ marginTop: 8 }}>
                {t("collab.messages")}
            </div>
            <div className="feed">
                {feed.map((item) =>
                    item.kind === "message" ? (
                        <MessageCard
                            key={item.message.id}
                            message={item.message}
                            projection={projection}
                        />
                    ) : (
                        <div key={item.entry.id} className="sysline">
                            <span className="ln" />
                            {item.entry.text}
                            <span className="ln" />
                        </div>
                    ),
                )}
                {blockedAgents.map((a) => (
                    <div key={a.id} className="msg warn-card">
                        <div className="hd">⚠ {t("collab.blockedTitle", { name: a.name })}</div>
                        <div className="bd">{a.blockedReason ?? t("collab.waitManual")}</div>
                        <div className="actions">
                            <button
                                className="btn pri"
                                onClick={() =>
                                    void call("agent.sendInput", { agentId: a.id, text: "y" })
                                }
                            >
                                {t("btn.approve")}
                            </button>
                            <button
                                className="btn"
                                onClick={() =>
                                    void call("agent.sendInput", { agentId: a.id, text: "n" })
                                }
                            >
                                {t("btn.deny")}
                            </button>
                            <button
                                className="btn"
                                onClick={() => selectAgent(a.id, { toWorkbench: true })}
                            >
                                {t("btn.openPane")}
                            </button>
                        </div>
                    </div>
                ))}
                {feed.length === 0 && blockedAgents.length === 0 && (
                    <div style={{ color: "var(--dim2)", fontSize: 12, padding: "6px 2px" }}>
                        {t("collab.noMessages")}
                    </div>
                )}
            </div>
        </div>
    );
}

function CollabComposer({
    projection,
    selectedAgent,
}: {
    projection: ShellProjection;
    selectedAgent: AgentSnapshot | null;
}) {
    const { t } = useI18n();
    const agents = projection.agents;
    const defaultFrom = selectedAgent?.id ?? agents[0]?.id ?? "user";
    const defaultTo = agents.find((a) => a.id !== defaultFrom)?.id ?? "";
    const [from, setFrom] = useState(defaultFrom);
    const [to, setTo] = useState(defaultTo);
    const [text, setText] = useState("");

    // 选中 agent 变化时同步默认身份
    useEffect(() => {
        if (selectedAgent) {
            setFrom(selectedAgent.id);
            const other = agents.find((a) => a.id !== selectedAgent.id);
            setTo((prev) =>
                prev && prev !== selectedAgent.id && agents.some((a) => a.id === prev)
                    ? prev
                    : (other?.id ?? ""),
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAgent?.id]);

    const send = () => {
        const body = text.trim();
        if (!body || !to) return;
        const params: MeshSendParams = { from, to, kind: "prompt", body };
        void call("mesh.send", params);
        setText("");
    };

    return (
        <div className="rp-composer">
            <select
                className="as"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                title={t("collab.fromTitle")}
            >
                {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                        {t("collab.asAgent", { name: a.name })}
                    </option>
                ))}
                <option value="user">{t("collab.asUser")}</option>
            </select>
            <select
                className="as"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                title={t("collab.toTitle")}
            >
                {agents
                    .filter((a) => a.id !== from)
                    .map((a) => (
                        <option key={a.id} value={a.id}>
                            → {a.name}
                        </option>
                    ))}
            </select>
            <input
                className="rp-input"
                placeholder={t("collab.msgPlaceholder")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") send();
                }}
            />
        </div>
    );
}

export function RightPanel({
    projection,
    selectedAgent,
    paneText,
    tab,
}: {
    projection: ShellProjection;
    selectedAgent: AgentSnapshot | null;
    paneText: string;
    tab: RightTab;
}) {
    const { t } = useI18n();
    const heldCount = projection.mesh.messages.filter((m) => m.status === "held").length;
    const blockedCount = projection.agents.filter((a) => a.status === "blocked").length;
    const badge = heldCount + blockedCount;

    const tabs: { id: RightTab; label: string }[] = [
        { id: "terminal", label: t("tab.terminal") },
        { id: "computer", label: t("tab.computer") },
        { id: "collab", label: t("tab.collab") },
    ];

    return (
        <div className="rp">
            <div className="rp-tabs">
                {tabs.map((tb) => (
                    <button
                        key={tb.id}
                        className={`rp-tab${tab === tb.id ? " active" : ""}`}
                        onClick={() => setRightTab(tb.id)}
                    >
                        {tb.label}
                        {tb.id === "collab" && badge > 0 && <span className="n">{badge}</span>}
                    </button>
                ))}
            </div>

            {tab === "collab" && <CollabTab projection={projection} />}
            {tab === "terminal" && (
                <div className="rp-term mono">
                    {paneText ? (
                        paneText.split("\n").map((line, i) => (
                            <div key={i} className={termLineClass(line)}>
                                {line === "" ? " " : line}
                            </div>
                        ))
                    ) : (
                        <span style={{ color: "var(--dim2)" }}>{t("main.termEmpty")}</span>
                    )}
                </div>
            )}
            {tab === "computer" && <div className="rp-placeholder">{t("rp.placeholder")}</div>}

            {tab === "collab" && (
                <CollabComposer projection={projection} selectedAgent={selectedAgent} />
            )}
        </div>
    );
}
