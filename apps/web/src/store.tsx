import { useSyncExternalStore } from "react";
import type {
    AgentCreateParams,
    AgentHistoryResult,
    AgentIdParams,
    AgentSnapshot,
    RpcMethod,
    ShellProjection,
    ThreadRecord,
    WorkspaceCreateParams,
    WorkspaceIdParams,
    WorkspaceSnapshot,
} from "@agent-cli-contact/contracts";
import * as wsClient from "./ws";

export type RightTab = "terminal" | "computer" | "collab";
export type Screen = "workbench" | "mesh";

export interface Toast {
    id: number;
    level: "info" | "warn";
    text: string;
}

/** 应用内模态对话框（WKWebView 不支持 window.prompt/confirm） */
export type DialogState =
    | { id: number; kind: "prompt"; title: string; defaultValue?: string; placeholder?: string }
    | { id: number; kind: "confirm"; title: string; body?: string; danger?: boolean };

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
    /** setup.install 实时日志（brew 输出，上限 200 行） */
    setupLog: string[];
    /** compose（一键新建 agent 聊天）进行中的 workspaceId，herdr 启动可达 ~10s */
    composingWorkspaceId: string | null;
    /** 递增信号：compose 成功后主区 composer 自动聚焦 */
    composerFocusSeq: number;
    /** 当前打开的应用内对话框（一次一个） */
    dialog: DialogState | null;
    /** 当前选中 agent 的会话历史（gateway 自录，turn 结束时增量刷新） */
    history: ThreadRecord[];
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
    setupLog: [],
    composingWorkspaceId: null,
    composerFocusSeq: 0,
    dialog: null,
    history: [],
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

// ---------- 应用内对话框（替代 window.prompt/confirm，WKWebView 不支持） ----------

let dialogSeq = 0;
let dialogResolver: ((value: string | boolean | null) => void) | null = null;

function openDialog(dialog: DialogState, resolver: (value: string | boolean | null) => void): void {
    // 若已有对话框，先按取消收掉，避免悬挂的 Promise
    dialogResolver?.(null);
    dialogResolver = resolver;
    set({ dialog });
}

/** 文本输入对话框：确认 → trim 后的值（空 → null）；取消/Esc/点击遮罩 → null */
export function promptDialog(opts: {
    title: string;
    defaultValue?: string;
    placeholder?: string;
}): Promise<string | null> {
    return new Promise((resolve) => {
        openDialog({ id: ++dialogSeq, kind: "prompt", ...opts }, (v) =>
            resolve(typeof v === "string" && v ? v : null),
        );
    });
}

/** 确认对话框：确认 → true；取消/Esc/点击遮罩 → false */
export function confirmDialog(opts: {
    title: string;
    body?: string;
    danger?: boolean;
}): Promise<boolean> {
    return new Promise((resolve) => {
        openDialog({ id: ++dialogSeq, kind: "confirm", ...opts }, (v) => resolve(v === true));
    });
}

/** Dialog 组件回调：prompt 传 trim 后的值或 null，confirm 传 true/null */
export function resolveDialog(value: string | boolean | null): void {
    const resolver = dialogResolver;
    dialogResolver = null;
    set({ dialog: null });
    resolver?.(value);
}

// ---------- RPC 包装：错误统一弹 toast ----------

export function call(method: RpcMethod, params?: unknown): Promise<unknown> {
    return wsClient.rpc(method, params).catch((err: unknown) => {
        toast("warn", err instanceof Error ? err.message : String(err));
        throw err;
    });
}

// ---------- 会话历史 ----------

/** 拉取选中 agent 的会话历史；静默失败（herdr 未就绪等） */
function fetchHistory(agentId: string): void {
    const params: AgentIdParams = { agentId };
    wsClient.rpc("agent.history", params).then(
        (result) => {
            if (state.selectedAgentId !== agentId) return; // 拉取期间已切走
            const r = result as AgentHistoryResult | null;
            set({ history: r?.items ?? [] });
        },
        () => undefined,
    );
}

/** 选中 agent 变化后调用：清空旧历史并重新拉取 */
function onAgentSelectionChanged(agentId: string | null): void {
    set({ history: [] });
    if (agentId) fetchHistory(agentId);
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
    const changed = (next ? next.id : null) !== state.selectedAgentId;
    set({ selectedWorkspaceId: workspaceId, selectedAgentId: next ? next.id : null });
    wsClient.switchPane(next ? next.id : null);
    if (changed) onAgentSelectionChanged(next ? next.id : null);
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

/** Codex 式一键新建 agent 聊天：自动命名 claude-N，成功后选中并聚焦 composer */
export function composeAgent(workspaceId: string): void {
    if (state.composingWorkspaceId) return; // 一次一个
    const count = state.projection?.agents.filter((a) => a.workspaceId === workspaceId).length ?? 0;
    const params: AgentCreateParams = { workspaceId, name: `claude-${count + 1}` };
    set({ composingWorkspaceId: workspaceId });
    call("agent.create", params).then(
        (result) => {
            const agent = result as AgentSnapshot | null;
            set({
                composingWorkspaceId: null,
                composerFocusSeq: state.composerFocusSeq + 1,
            });
            if (agent?.id) selectAgent(agent.id);
        },
        () => set({ composingWorkspaceId: null }),
    );
}

export function removeAgent(agentId: string): void {
    const params: AgentIdParams = { agentId };
    call("agent.remove", params).catch(() => undefined);
}

export function selectAgent(agentId: string, opts?: { toWorkbench?: boolean }): void {
    const changed = agentId !== state.selectedAgentId;
    const agent = state.projection?.agents.find((a) => a.id === agentId);
    set({
        selectedAgentId: agentId,
        selectedWorkspaceId: agent ? agent.workspaceId : state.selectedWorkspaceId,
        ...(opts?.toWorkbench ? { screen: "workbench" as Screen } : {}),
    });
    wsClient.switchPane(agentId);
    if (changed) onAgentSelectionChanged(agentId);
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
        const prevSelectedId = state.selectedAgentId;
        const prevStatus = prevSelectedId
            ? state.projection?.agents.find((a) => a.id === prevSelectedId)?.status
            : undefined;
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
        // 历史刷新：选中变化 → 重拉；同一 agent 从 working 退出 → turn 刚结束，有新记录
        if (selectedAgentId !== prevSelectedId) {
            onAgentSelectionChanged(selectedAgentId);
        } else if (selectedAgentId && prevStatus === "working") {
            const nowStatus = projection.agents.find((a) => a.id === selectedAgentId)?.status;
            if (nowStatus !== "working") fetchHistory(selectedAgentId);
        }
    },
    onPane(agentId, text) {
        if (typeof text !== "string") return; // 防御：异常载荷不覆盖已有 pane 文本
        set({ panes: { ...state.panes, [agentId]: text } });
    },
    onNotify(level, text) {
        toast(level, text);
    },
    onConnected(connected) {
        set({ connected });
    },
    onSetupLog(line) {
        set({ setupLog: [...state.setupLog, line].slice(-200) });
    },
});

export function startClient(): void {
    wsClient.connect();
}
