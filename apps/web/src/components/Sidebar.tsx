import { Fragment, useState, useMemo, useEffect } from "react";
import type {
    AgentSnapshot,
    ShellProjection,
    WorkspaceIdParams,
    WorkspaceRenameParams,
    WorkspaceSnapshot,
} from "@agent-cli-contact/contracts";
import {
    call,
    composeAgent,
    confirmDialog,
    createWorkspace,
    promptDialog,
    renameAgent,
    removeAgent,
    selectAgent,
    selectWorkspace,
    type ComposingAgentInfo,
} from "../store";
import { modelLabel, statusClass } from "../util";
import { useI18n } from "../i18n";

/** hover 时才展开的附加信息行 */
interface MetaRow {
    key: string;
    text: string;
    /** 原生 tooltip，缺省用 text */
    title?: string;
}

/**
 * 项目行的 hover 附加信息。当前只有项目地址；
 * 后续要展示别的（最近活跃时间、远端…）在这里加一条即可。
 */
function workspaceMeta(w: WorkspaceSnapshot): MetaRow[] {
    const rows: MetaRow[] = [];
    if (w.cwd) rows.push({ key: "cwd", text: w.cwd });
    return rows;
}

/** agent 行的 hover 附加信息（同上，预留扩展位） */
function agentMeta(a: AgentSnapshot): MetaRow[] {
    const rows: MetaRow[] = [];
    if (a.branch) rows.push({ key: "branch", text: `⑂ ${a.branch}` });
    return rows;
}

function MetaRows({ rows }: { rows: MetaRow[] }) {
    return (
        <>
            {rows.map((m) => (
                <div key={m.key} className="row-meta" title={m.title ?? m.text}>
                    {m.text}
                </div>
            ))}
        </>
    );
}

export function Sidebar({
    projection,
    selectedWorkspaceId,
    selectedAgentId,
    composingWorkspaceId,
    composingAgent,
    connectingAgentId,
}: {
    projection: ShellProjection;
    selectedWorkspaceId: string | null;
    selectedAgentId: string | null;
    composingWorkspaceId: string | null;
    composingAgent?: ComposingAgentInfo | null;
    connectingAgentId?: string | null;
}) {
    const { t } = useI18n();

    const onCreate = async () => {
        // 先选目录：Tauri 内用原生目录选择器，纯浏览器回退到 prompt
        let cwd: string | undefined;
        if ("__TAURI_INTERNALS__" in window) {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const picked = await open({ directory: true, title: t("ws.pickDir") });
            if (typeof picked !== "string") return; // 取消
            cwd = picked;
        } else {
            const typed = await promptDialog({
                title: t("ws.promptCwd"),
                placeholder: "/path/to/project",
            });
            if (typed === null) return; // 取消/留空
            cwd = typed;
        }
        // 再输入名称，默认取目录 basename
        const base = cwd
            ? (cwd
                  .replace(/[\\/]+$/, "")
                  .split(/[\\/]/)
                  .pop() ?? "")
            : "";
        const name = await promptDialog({ title: t("ws.promptName"), defaultValue: base });
        if (!name) return;
        createWorkspace(name, cwd);
    };

    const onRename = async (w: WorkspaceSnapshot) => {
        const name = await promptDialog({ title: t("ws.promptRename"), defaultValue: w.label });
        if (!name || name === w.label) return;
        const params: WorkspaceRenameParams = { workspaceId: w.id, label: name };
        call("workspace.rename", params).catch(() => undefined);
    };

    const onCloseWs = async (w: WorkspaceSnapshot) => {
        const okay = await confirmDialog({
            title: t("side.closeWorkspace"),
            body: t("ws.confirmClose", { label: w.label }),
            danger: true,
        });
        if (!okay) return;
        const params: WorkspaceIdParams = { workspaceId: w.id };
        call("workspace.close", params).catch(() => undefined);
    };

    const [pickerWorkspaceId, setPickerWorkspaceId] = useState<string | null>(null);

    const availableAgents = useMemo(() => {
        const list = (projection.availableAgents ?? []).filter((a) => a.installed);
        if (list.length > 0) return list;
        return [
            { kind: "claude", label: "Claude Code", defaultPrefix: "claude", installed: true },
            { kind: "agy", label: "Antigravity (agy)", defaultPrefix: "agy", installed: true },
            { kind: "codex", label: "Codex", defaultPrefix: "codex", installed: true },
        ];
    }, [projection.availableAgents]);

    const onRenameAgent = async (a: AgentSnapshot) => {
        const name = await promptDialog({ title: t("agent.promptRename"), defaultValue: a.name });
        if (!name || name === a.name) return;
        await renameAgent(a.id, name.trim());
    };

    const onOpenEditor = (w: WorkspaceSnapshot) => {
        const params: WorkspaceIdParams = { workspaceId: w.id };
        call("editor.open", params).catch(() => undefined);
    };

    return (
        <div className="sidebar">
            <div className="side-h">
                {t("side.workspaces")}
                <button className="add-rule" onClick={() => void onCreate()}>
                    {t("side.newWorkspace")}
                </button>
            </div>
            {projection.workspaces.length === 0 && (
                <div className="side-empty">{t("side.noWorkspaces")}</div>
            )}
            {projection.workspaces.map((w) => {
                const wsAgents = projection.agents.filter((a) => a.workspaceId === w.id);
                const composing = composingWorkspaceId === w.id;
                return (
                    <Fragment key={w.id}>
                        <div
                            className={`item stack ws-item${w.id === selectedWorkspaceId ? " active" : ""}${pickerWorkspaceId === w.id ? " has-picker" : ""}`}
                            onClick={() => selectWorkspace(w.id)}
                            onDoubleClick={() => void onRename(w)}
                        >
                            <div className="row-main">
                                <span className="ws-label" title={t("side.renameWorkspace")}>
                                    ▸ {w.label}
                                </span>
                                <span className="row-right">
                                    <span className="sub">{w.agentCount}</span>
                                    <span
                                        className={`ws-actions${composing || pickerWorkspaceId === w.id ? " show" : ""}`}
                                    >
                                        <button
                                            className="ws-act compose"
                                            title={t("agent.compose")}
                                            disabled={composing}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setPickerWorkspaceId((prev) =>
                                                    prev === w.id ? null : w.id,
                                                );
                                            }}
                                        >
                                            {composing ? "…" : "+"}
                                        </button>
                                        {pickerWorkspaceId === w.id && (
                                            <>
                                                <div
                                                    className="menu-scrim"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPickerWorkspaceId(null);
                                                    }}
                                                />
                                                <div
                                                    className="agent-picker-menu"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <div className="agent-picker-header">
                                                        {t("agent.selectAgent")}
                                                    </div>
                                                    {availableAgents.map((ag) => (
                                                        <button
                                                            key={ag.kind}
                                                            className="agent-picker-item"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setPickerWorkspaceId(null);
                                                                composeAgent(
                                                                    w.id,
                                                                    ag.kind,
                                                                    ag.defaultPrefix,
                                                                );
                                                            }}
                                                        >
                                                            <span className="agent-picker-kind">
                                                                {ag.kind}
                                                            </span>
                                                            <span className="agent-picker-label">
                                                                {ag.label}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                        {w.cwd && (
                                            <button
                                                className="ws-act"
                                                title={t("main.openEditor")}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onOpenEditor(w);
                                                }}
                                            >
                                                ⧉
                                            </button>
                                        )}
                                        {projection.workspaces.length > 1 && (
                                            <button
                                                className="ws-act"
                                                title={t("side.closeWorkspace")}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void onCloseWs(w);
                                                }}
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </span>
                                </span>
                            </div>
                            <MetaRows rows={workspaceMeta(w)} />
                        </div>
                        {wsAgents.length === 0 && !(composingAgent && composingAgent.workspaceId === w.id) && (
                            <div className="agent-empty">{t("side.noAgents")}</div>
                        )}
                        {composingAgent && composingAgent.workspaceId === w.id && (
                            <div className="item stack ws-item agent-row composing-row active">
                                <div className="row-main">
                                    <span className="pulse-spin" style={{ margin: "0 2px" }} />
                                    <span className="agent-name composing-name">
                                        {composingAgent.name}
                                    </span>
                                    <span className="row-right">
                                        <span className="badge loading-badge">
                                            {t("agent.connectingStatus")}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        )}
                        {wsAgents.map((a) => (
                            <div
                                key={a.id}
                                className={`item stack ws-item agent-row${a.id === selectedAgentId ? " active" : ""}`}
                                onClick={() => selectAgent(a.id)}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    void onRenameAgent(a);
                                }}
                            >
                                <div className="row-main">
                                    {connectingAgentId === a.id ? (
                                        <span className="pulse-spin" style={{ margin: "0 2px" }} />
                                    ) : (
                                        <span className={`st ${statusClass(a.status)}`} />
                                    )}
                                    <span className="agent-name" title={t("agent.promptRename")}>
                                        {a.name}
                                    </span>
                                    <span className="row-right">
                                        {connectingAgentId === a.id ? (
                                            <span className="badge loading-badge">
                                                {t("agent.connectingStatus")}
                                            </span>
                                        ) : a.status === "blocked" &&
                                          a.config.permissionMode !== "full" ? (
                                            <span className="badge">{t("side.needsConfirm")}</span>
                                        ) : a.status === "done" ? (
                                            <span className="sub prov">✓ done</span>
                                        ) : null}
                                        <span className="ws-actions">
                                            <button
                                                className="ws-act"
                                                title={t("agent.rename")}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void onRenameAgent(a);
                                                }}
                                            >
                                                ✎
                                            </button>
                                            <button
                                                className="ws-act"
                                                title={t("side.closeAgent")}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void confirmDialog({
                                                        title: t("side.closeAgent"),
                                                        body: t("agent.confirmClose", {
                                                            name: a.name,
                                                        }),
                                                        danger: true,
                                                    }).then((okay) => {
                                                        if (okay) removeAgent(a.id);
                                                    });
                                                }}
                                            >
                                                ✕
                                            </button>
                                        </span>
                                    </span>
                                </div>
                                {/* 模型单独一行：provider + 实际在用的 LLM 版本 */}
                                <div className="row-model" title={a.config.model}>
                                    {a.provider} · {modelLabel(projection, a)}
                                </div>
                                <MetaRows rows={agentMeta(a)} />
                            </div>
                        ))}
                    </Fragment>
                );
            })}

            <div className="side-h">{t("side.schedules")}</div>
            {projection.schedules.map((s) => (
                <div key={s.id} className="item" style={{ cursor: "default" }}>
                    ◷ {s.name}
                    <button
                        className="run-now"
                        title={t("side.runNow")}
                        onClick={(e) => {
                            e.stopPropagation();
                            void call("schedule.runNow", { scheduleId: s.id });
                        }}
                    >
                        ▶
                    </button>
                    <span className="sub">{s.humanized}</span>
                </div>
            ))}
        </div>
    );
}
