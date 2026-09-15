import { Fragment } from "react";
import type {
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
    removeAgent,
    selectAgent,
    selectWorkspace,
} from "../store";
import { statusClass } from "../util";
import { useI18n } from "../i18n";

export function Sidebar({
    projection,
    selectedWorkspaceId,
    selectedAgentId,
    composingWorkspaceId,
}: {
    projection: ShellProjection;
    selectedWorkspaceId: string | null;
    selectedAgentId: string | null;
    composingWorkspaceId: string | null;
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
                            className={`item ws-item${w.id === selectedWorkspaceId ? " active" : ""}`}
                            onClick={() => selectWorkspace(w.id)}
                            onDoubleClick={() => void onRename(w)}
                        >
                            <span className="ws-label" title={t("side.renameWorkspace")}>
                                ▸ {w.label}
                            </span>
                            <span className={`ws-actions${composing ? " show" : ""}`}>
                                <button
                                    className="ws-act compose"
                                    title={t("agent.compose")}
                                    disabled={composing}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        composeAgent(w.id);
                                    }}
                                >
                                    {composing ? "…" : "✎"}
                                </button>
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
                            <span className="sub">{w.agentCount}</span>
                            {w.cwd && (
                                <span className="cwd" title={w.cwd}>
                                    {w.cwd}
                                </span>
                            )}
                        </div>
                        {wsAgents.length === 0 && (
                            <div className="agent-empty">{t("side.noAgents")}</div>
                        )}
                        {wsAgents.map((a) => (
                            <div
                                key={a.id}
                                className={`item ws-item agent-row${a.id === selectedAgentId ? " active" : ""}`}
                                onClick={() => selectAgent(a.id)}
                            >
                                <span className={`st ${statusClass(a.status)}`} /> {a.name}
                                <span className="ws-actions">
                                    <button
                                        className="ws-act"
                                        title={t("side.closeAgent")}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void confirmDialog({
                                                title: t("side.closeAgent"),
                                                body: t("agent.confirmClose", { name: a.name }),
                                                danger: true,
                                            }).then((okay) => {
                                                if (okay) removeAgent(a.id);
                                            });
                                        }}
                                    >
                                        ✕
                                    </button>
                                </span>
                                {a.status === "blocked" ? (
                                    <span className="badge">{t("side.needsConfirm")}</span>
                                ) : a.status === "done" ? (
                                    <span className="sub prov">✓ done</span>
                                ) : (
                                    <span className="sub prov">{a.provider}</span>
                                )}
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
