import { useEffect } from "react";
import {
    closeConfig,
    closeSettings,
    openConfig,
    resolveDialog,
    selectedAgent,
    setScreen,
    useAppState,
} from "./store";
import { useI18n } from "./i18n";
import { Dialog } from "./components/Dialog";
import { SettingsPopover } from "./components/SettingsPopover";
import { SetupScreen } from "./components/SetupScreen";
import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { RightPanel } from "./components/RightPanel";
import { MeshView } from "./components/MeshView";
import { ConfigPopover } from "./components/ConfigPopover";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";

export function App() {
    const { t } = useI18n();
    const state = useAppState();
    const { projection, connected, screen, configAgentId, settingsOpen, dialog } = state;
    const agent = selectedAgent(state);

    // 全局快捷键
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (dialog) {
                    resolveDialog(null);
                } else if (settingsOpen) {
                    closeSettings();
                } else if (configAgentId) {
                    closeConfig();
                } else if (screen === "mesh") {
                    setScreen("workbench");
                }
                return;
            }
            if (e.metaKey && e.shiftKey && (e.key === "m" || e.key === "M")) {
                e.preventDefault();
                openConfig();
            } else if (e.metaKey && e.shiftKey && (e.key === "p" || e.key === "P")) {
                e.preventDefault();
                openConfig();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [configAgentId, screen, settingsOpen, dialog]);

    const configAgent = configAgentId
        ? (projection?.agents.find((a) => a.id === configAgentId) ?? null)
        : null;

    return (
        <div className="shell">
            <Titlebar
                projection={projection}
                selectedWorkspaceId={state.selectedWorkspaceId}
                screen={screen}
            />

            {projection === null ? (
                <div className="loading">{t("app.loading")}</div>
            ) : projection.herdr.status !== "ready" ? (
                <SetupScreen herdr={projection.herdr} log={state.setupLog} />
            ) : screen === "mesh" ? (
                <MeshView projection={projection} pair={state.meshPair} />
            ) : (
                <div className="app">
                    <Sidebar
                        projection={projection}
                        selectedWorkspaceId={state.selectedWorkspaceId}
                        selectedAgentId={state.selectedAgentId}
                        composingWorkspaceId={state.composingWorkspaceId}
                    />
                    <MainPane
                        projection={projection}
                        agent={agent}
                        paneText={agent ? (state.panes[agent.id] ?? "") : ""}
                        selectedWorkspaceId={state.selectedWorkspaceId}
                        composingWorkspaceId={state.composingWorkspaceId}
                        composerFocusSeq={state.composerFocusSeq}
                    />
                    <RightPanel
                        projection={projection}
                        selectedAgent={agent}
                        paneText={agent ? (state.panes[agent.id] ?? "") : ""}
                        tab={state.rightTab}
                    />
                </div>
            )}

            <StatusBar projection={projection} connected={connected} />

            {projection && configAgent && (
                <ConfigPopover projection={projection} agent={configAgent} />
            )}
            {projection && settingsOpen && <SettingsPopover projection={projection} />}
            {dialog && <Dialog key={dialog.id} dialog={dialog} />}
            <Toasts toasts={state.toasts} />
        </div>
    );
}
