/**
 * 极简持久化：JSON 文件（~/.agent-workbench/state.json）。
 * PLAN 里是 SQLite；MVP 用原子写 JSON 顶位，表结构字段与 PLAN 对齐，
 * 换 SQLite 时只动这一层。目录放 home 下，dev 与打包后（bun 单二进制
 * sidecar，无稳定相对路径）行为一致。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MeshMessage, MeshRule, MeshTimelineEntry, ConfigPreset, ScheduleSnapshot } from '@workbench/contracts';

const DATA_DIR = process.env.WORKBENCH_DATA_DIR ?? path.join(os.homedir(), '.agent-workbench');
const DATA_FILE = path.join(DATA_DIR, 'state.json');

export interface PersistedState {
  meshMessages: MeshMessage[];
  meshRules: MeshRule[];
  timeline: MeshTimelineEntry[];
  relayApproval: boolean;
  presets: ConfigPreset[];
  schedules: Omit<ScheduleSnapshot, 'nextFireAt' | 'humanized' | 'lastRun'>[];
  scheduleRuns: NonNullable<ScheduleSnapshot['lastRun']>[];
}

export function loadState(): PersistedState | null {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as PersistedState;
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 去抖 + 原子写 */
export function saveState(state: PersistedState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error('[gateway] 持久化失败:', err);
    }
  }, 300);
}
