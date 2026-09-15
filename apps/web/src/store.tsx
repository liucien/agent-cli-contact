import { useSyncExternalStore } from "react";
import type {
    AgentSnapshot,
    RpcMethod,
    ShellProjection,
    WorkspaceCreateParams,
    WorkspaceIdParams,
    WorkspaceSnapshot,
} from "@workbench/contracts";
import * as wsClient from "./ws";

export type RightTab = "terminal" | "computer" | "collab";
export type Screen = "workbench" | "mesh";

export interface Toast {
    id: number;
    level: "info" | "warn";
    text: string;
}

export interface AppState {
    projection: ShellProjection | null;
    connected: boolean;
    /** agentId -> 当前终端屏幕文本 */
    panes: Record<string, string>;
    selectedWorkspaceId: string | null;
    selectedAgentId: string | null;
    rightTab: RightTab;
    screen: Screen;
    toasts: Toast[];
    /** 配置弹层：打开时为 agentId */
    configAgentId: string | null;
    /** 设置弹层是否打开 */
    settingsOpen: boolean;
    /** mesh 全屏视图右侧详情选中的一对 agent */
    meshPair: [string, string] | null;
}

let state: AppState = {
    projection: null,
    connected: false,
    panes: {},
    selectedWorkspaceId: null,
    selectedAgentId: null,
    rightTab: "collab",
    screen: "workbench",
    toasts: [],
    configAgentId: null,
    settingsOpen: false,
    meshPair: null,
};

const listeners = new Set<() => void>();

function set(partial: Partial<AppState>): void {
    state = { ...state, ...partial };
    for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getState(): AppState {
    return state;
}

export function useAppState(): AppState {
    return useSyncExternalStore(subscribe, getState);
}

// ---------- toasts ----------

let toastSeq = 0;

export function toast(level: "info" | "warn", text: string): void {
    const id = ++toastSeq;
    set({ toasts: [...state.toasts, { id, level, text }] });
    setTimeout(() => {
        set({ toasts: state.toasts.filter((t) => t.id !== id) });
    }, 4000);
}

// ---------- RPC 包装：错误统一弹 toast ----------

export function call(method: RpcMethod, params?: unknown): Promise<unknown> {
    return wsClient.rpc(method, params).catch((err: unknown) => {
        toast("warn", err instanceof Error ? err.message : String(err));
        throw err;
    });
}

// ---------- actions ----------

export function selectWorkspace(workspaceId: string): void {
    // 无论本地是否已选中，都通知 gateway 聚焦该工作区
    const params: WorkspaceIdParams = { workspaceId };
    call("workspace.focus", params).catch(() => undefined);
    if (workspaceId === state.selectedWorkspaceId) return;
    const agents = state.projection?.agents.filter((a) => a.workspaceId === workspaceId) ?? [];
    const current = agents.find((a) => a.id === state.selectedAgentId);
    const next = current ?? agents[0] ?? null;
    set({ selectedWorkspaceId: workspaceId, selectedAgentId: next ? next.id : null });
    wsClient.switchPane(next ? next.id : null);
}

export function createWorkspace(label: string, cwd?: string): void {
    const params: WorkspaceCreateParams = cwd ? { label, cwd } : { label };
    call("workspace.create", params).then(
        (result) => {
            const ws = result as WorkspaceSnapshot | null;
            if (ws?.id) selectWorkspace(ws.id);
        },
        () => undefined,
    );
}

export function selectAgent(agentId: string, opts?: { toWorkbench?: boolean }): void {
    const agent = state.projection?.agents.find((a) => a.id === agentId);
    set({
        selectedAgentId: agentId,
        selectedWorkspaceId: agent ? agent.workspaceId : state.selectedWorkspaceId,
        ...(opts?.toWorkbench ? { screen: "workbench" as Screen } : {}),
    });
    wsClient.switchPane(agentId);
}

export function setRightTab(tab: RightTab): void {
    set({ rightTab: tab });
}

export function setScreen(screen: Screen): void {
    set({ screen });
}

export function openConfig(agentId?: string): void {
    const id = agentId ?? state.selectedAgentId;
    if (id) set({ configAgentId: id });
}

export function closeConfig(): void {
    set({ configAgentId: null });
}

export function openSettings(): void {
    set({ settingsOpen: true });
}

export function closeSettings(): void {
    set({ settingsOpen: false });
}

export function setMeshPair(pair: [string, string] | null): void {
    set({ meshPair: pair });
}

// ---------- 选取辅助 ----------

export function selectedAgent(s: AppState): AgentSnapshot | null {
    return s.projection?.agents.find((a) => a.id === s.selectedAgentId) ?? null;
}

// ---------- WebSocket 接线 ----------

wsClient.setHandlers({
    onShell(projection) {
        let { selectedWorkspaceId, selectedAgentId } = state;
        // 选中的工作区消失（被别处关闭）→ 回退到 focused / 第一个
        if (
            !selectedWorkspaceId ||
            !projection.workspaces.some((w) => w.id === selectedWorkspaceId)
        ) {
            const focused =
                projection.workspaces.find((w) => w.focused) ?? projection.workspaces[0];
            selectedWorkspaceId = focused ? focused.id : null;
            selectedAgentId = null; // 工作区变了，agent 需在新工作区内重选
        }
        // 选中 agent 必须存在且属于当前工作区；否则选该工作区第一个（可能为空）
        const agentValid =
            selectedAgentId !== null &&
            projection.agents.some(
                (a) => a.id === selectedAgentId && a.workspaceId === selectedWorkspaceId,
            );
        if (!agentValid) {
            const first = projection.agents.find((a) => a.workspaceId === selectedWorkspaceId);
            selectedAgentId = first ? first.id : null;
            wsClient.switchPane(selectedAgentId);
        }
        set({ projection, selectedWorkspaceId, selectedAgentId });
    },
    onPane(agentId, text) {
        set({ panes: { ...state.panes, [agentId]: text } });
    },
    onNotify(level, text) {
        toast(level, text);
    },
    onConnected(connected) {
        set({ connected });
    },
});

export function startClient(): void {
    wsClient.connect();
}
