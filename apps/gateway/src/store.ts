/**
 * 极简持久化：JSON 文件（~/.agent-cli-contact/state.json）。
 * PLAN 里是 SQLite；MVP 用原子写 JSON 顶位，表结构字段与 PLAN 对齐，
 * 换 SQLite 时只动这一层。目录放 home 下，dev 与打包后（bun 单二进制
 * sidecar，无稳定相对路径）行为一致。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
    MeshMessage,
    MeshRule,
    MeshTimelineEntry,
    ConfigPreset,
    ScheduleSnapshot,
    GatewaySettings,
} from "@agent-cli-contact/contracts";

const DATA_DIR = process.env.WORKBENCH_DATA_DIR ?? path.join(os.homedir(), ".agent-cli-contact");
const DATA_FILE = path.join(DATA_DIR, "state.json");

export interface PersistedState {
    meshMessages: MeshMessage[];
    meshRules: MeshRule[];
    timeline: MeshTimelineEntry[];
    relayApproval: boolean;
    presets: ConfigPreset[];
    schedules: Omit<ScheduleSnapshot, "nextFireAt" | "humanized" | "lastRun">[];
    scheduleRuns: NonNullable<ScheduleSnapshot["lastRun"]>[];
    settings?: GatewaySettings;
    /** gateway 自建对话历史（agentId -> 记录） */
    threads?: Record<string, import("@agent-cli-contact/contracts").ThreadRecord[]>;
    /** agent 配置记账（agentId -> 配置），herdr 不感知，需 gateway 持久化 */
    agentConfigs?: Record<string, import("@agent-cli-contact/contracts").AgentConfig>;
}

export function loadState(): PersistedState | null {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as PersistedState;
    } catch {
        return null;
    }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let firstQueuedAt = 0;

const DEBOUNCE_MS = 300;
/** 高频 onDirty 下纯去抖会饥饿（每次调用重置计时器），设最大等待强制落盘 */
const MAX_WAIT_MS = 1000;

/** 去抖（带最大等待）+ 原子写 */
export function saveState(state: PersistedState): void {
    const now = Date.now();
    if (!saveTimer) firstQueuedAt = now;
    else clearTimeout(saveTimer);
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, firstQueuedAt + MAX_WAIT_MS - now));
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            const tmp = DATA_FILE + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
            fs.renameSync(tmp, DATA_FILE);
        } catch (err) {
            console.error("[gateway] 持久化失败:", err);
        }
    }, delay);
}
