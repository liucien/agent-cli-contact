import type {
    ShellProjection,
    WorkspaceIdParams,
    WorkspaceRenameParams,
    WorkspaceSnapshot,
} from "@workbench/contracts";
import { call, createWorkspace, selectAgent, selectWorkspace } from "../store";
import { configSummary, statusClass } from "../util";
import { useI18n } from "../i18n";

export function Sidebar({
    projection,
    selectedWorkspaceId,
    selectedAgentId,
}: {
    projection: ShellProjection;
    selectedWorkspaceId: string | null;
    selectedAgentId: string | null;
}) {
    const { t } = useI18n();
    const agents = projection.agents.filter(
        (a) => !selectedWorkspaceId || a.workspaceId === selectedWorkspaceId,
    );

    const onCreate = () => {
        const name = window.prompt(t("ws.promptName"));
        if (!name || !name.trim()) return;
        const cwd = window.prompt(t("ws.promptCwd")) ?? "";
        createWorkspace(name.trim(), cwd.trim() ? cwd.trim() : undefined);
    };

    const onRename = (w: WorkspaceSnapshot) => {
        const name = window.prompt(t("ws.promptRename"), w.label);
        if (!name || !name.trim() || name.trim() === w.label) return;
        const params: WorkspaceRenameParams = { workspaceId: w.id, label: name.trim() };
        call("workspace.rename", params).catch(() => undefined);
    };

    const onCloseWs = (w: WorkspaceSnapshot) => {
        if (!window.confirm(t("ws.confirmClose", { label: w.label }))) return;
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
                <button className="add-rule" onClick={onCreate}>
                    {t("side.newWorkspace")}
                </button>
            </div>
            {projection.workspaces.map((w) => (
                <div
                    key={w.id}
                    className={`item ws-item${w.id === selectedWorkspaceId ? " active" : ""}`}
                    onClick={() => selectWorkspace(w.id)}
                >
                    ▸ {w.label}
                    <span className="ws-actions">
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
                        <button
                            className="ws-act"
                            title={t("side.renameWorkspace")}
                            onClick={(e) => {
                                e.stopPropagation();
                                onRename(w);
                            }}
                        >
                            ✎
                        </button>
                        {projection.workspaces.length > 1 && (
                            <button
                                className="ws-act"
                                title={t("side.closeWorkspace")}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onCloseWs(w);
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
            ))}

            <div className="side-h">{t("side.agents")}</div>
            {agents.map((a) => (
                <button
                    key={a.id}
                    className={`item${a.id === selectedAgentId ? " active" : ""}`}
                    onClick={() => selectAgent(a.id)}
                >
                    <span className={`st ${statusClass(a.status)}`} /> {a.name}
                    {a.status === "blocked" ? (
                        <span className="badge">{t("side.needsConfirm")}</span>
                    ) : a.status === "done" ? (
                        <span className="sub prov">✓ done</span>
                    ) : (
                        <span className="sub prov">{a.provider}</span>
                    )}
                    <span className="cfg">{configSummary(projection, a)}</span>
                </button>
            ))}

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
