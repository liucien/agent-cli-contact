import { useEffect, useRef, useState } from "react";
import type {
    AgentSnapshot,
    AgentTextParams,
    ShellProjection,
    WorkspaceIdParams,
} from "@workbench/contracts";
import { call, openConfig, setScreen } from "../store";
import {
    ctxLabel,
    modelLabel,
    permLabel,
    reasoningLabel,
    statusClass,
    termLineClass,
} from "../util";
import { useI18n } from "../i18n";

function Terminal({ text }: { text: string }) {
    const { t } = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [text]);

    const lines = text.length > 0 ? text.split("\n") : [];
    return (
        <div className="term mono" ref={ref}>
            {lines.length === 0 ? (
                <div className="term-empty">{t("main.termEmpty")}</div>
            ) : (
                lines.map((line, i) => (
                    <div key={i} className={termLineClass(line)}>
                        {line === "" ? " " : line}
                    </div>
                ))
            )}
        </div>
    );
}

export function MainPane({
    projection,
    agent,
    paneText,
}: {
    projection: ShellProjection;
    agent: AgentSnapshot | null;
    paneText: string;
}) {
    const { t } = useI18n();
    const [input, setInput] = useState("");

    if (!agent) {
        return (
            <div className="main">
                <div className="rp-placeholder">{t("main.emptyAgent")}</div>
            </div>
        );
    }

    const send = () => {
        const text = input.trim();
        if (!text) return;
        const params: AgentTextParams = { agentId: agent.id, text };
        void call("agent.prompt", params);
        setInput("");
    };

    const cfg = agent.config;
    const workspace = projection.workspaces.find((w) => w.id === agent.workspaceId);
    const openEditor = () => {
        if (!workspace) return;
        const params: WorkspaceIdParams = { workspaceId: workspace.id };
        call("editor.open", params).catch(() => undefined);
    };

    return (
        <div className="main">
            <div className="pane-h">
                <b>{agent.name}</b>
                <span className={`pill ${statusClass(agent.status)}`}>● {agent.status}</span>
                {agent.branch && <span className="pill branch">⎇ {agent.branch}</span>}
                <div className="r">
                    <span>turn #{agent.turn}</span>
                    <span>checkpoint ✓</span>
                    {workspace?.cwd && (
                        <button className="chip" title={workspace.cwd} onClick={openEditor}>
                            ⧉ {t("main.openEditor")}
                        </button>
                    )}
                    <button className="chip" onClick={() => setScreen("mesh")}>
                        {t("main.meshView")}
                    </button>
                </div>
            </div>

            <Terminal text={paneText} />

            <div className="composer-wrap">
                <div className="cfgbar">
                    <button className="cfgseg" onClick={() => openConfig(agent.id)}>
                        <span className="ic">✳</span> {modelLabel(projection, agent)}{" "}
                        <span className="dn">▾</span>
                    </button>
                    <button className="cfgseg" onClick={() => openConfig(agent.id)}>
                        {reasoningLabel(cfg.reasoning)} · {ctxLabel(cfg.contextWindow)}{" "}
                        <span className="dn">▾</span>
                    </button>
                    <button className="cfgseg" onClick={() => openConfig(agent.id)}>
                        <span className="lock">{cfg.permissionMode === "full" ? "🔓" : "🔒"}</span>{" "}
                        {permLabel(cfg.permissionMode)} <span className="dn">▾</span>
                    </button>
                </div>
                <div className="composer">
                    <input
                        placeholder={t("main.inputPlaceholder", { name: agent.name })}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) send();
                        }}
                    />
                    <span className="hint">{t("main.kbdHint")}</span>
                    <button className="send" onClick={send}>
                        {t("main.send")}
                    </button>
                </div>
            </div>
        </div>
    );
}
