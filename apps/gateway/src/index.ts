/**
 * Gateway 入口：选底座（herdr socket 可用则用 herdr，否则 mock 降级）、
 * 装配 mesh / scheduler / config、恢复持久化状态、起 WS 服务。
 */
import { socketAvailable } from '@workbench/herdr-client';
import type { ConfigPreset } from '@workbench/contracts';
import { HerdrRuntime } from './herdrRuntime.js';
import { MockRuntime } from './mockRuntime.js';
import { MeshRelay } from './mesh.js';
import { Scheduler, type ScheduleDef } from './scheduler.js';
import { ConfigService } from './configService.js';
import { GatewayServer } from './server.js';
import { loadState, saveState, type PersistedState } from './store.js';
import type { AgentRuntime } from './runtime.js';

async function pickRuntime(): Promise<AgentRuntime> {
  const forced = process.env.WORKBENCH_RUNTIME; // 'herdr' | 'mock'
  if (forced !== 'mock' && socketAvailable()) {
    try {
      const rt = new HerdrRuntime();
      await rt.start();
      console.log('[gateway] 已连接 herdr socket');
      return rt;
    } catch (err) {
      console.warn('[gateway] herdr 连接失败，降级 mock 模式:', err instanceof Error ? err.message : err);
    }
  } else if (forced !== 'mock') {
    console.log('[gateway] 未发现 herdr socket，使用 mock 模式（启动 herdr 后重启 gateway 即接管真实 pane）');
  }
  const rt = new MockRuntime();
  await rt.start();
  return rt;
}

async function main(): Promise<void> {
  const runtime = await pickRuntime();
  const persisted = loadState();

  let server: GatewayServer | null = null;
  const presets: ConfigPreset[] = persisted?.presets ?? [
    {
      id: 'preset-default',
      name: '默认开发',
      config: { model: 'claude-fable-5', reasoning: 'high', contextWindow: '1m', permissionMode: 'full' },
    },
    {
      id: 'preset-review',
      name: '安全评审 · Sonnet · Ask',
      config: { model: 'claude-sonnet-5', reasoning: 'medium', contextWindow: '200k', permissionMode: 'ask' },
    },
    {
      id: 'preset-night',
      name: '夜间无人值守 · Plan · 限速',
      config: { model: 'claude-sonnet-5', reasoning: 'medium', contextWindow: '200k', permissionMode: 'plan' },
    },
  ];

  const persist = () => {
    const sched = scheduler.persistable();
    const state: PersistedState = {
      meshMessages: mesh.messages.slice(-200),
      meshRules: mesh.rules,
      timeline: mesh.timeline.slice(-500),
      relayApproval: mesh.relayApproval,
      presets,
      schedules: sched.defs,
      scheduleRuns: sched.runs,
    };
    saveState(state);
  };

  const onDirty = () => {
    persist();
    server?.broadcastShell();
  };
  const notify = (level: 'info' | 'warn', text: string) => server?.notify(level, text);

  const mesh = new MeshRelay(runtime, { onDirty, notify });
  const scheduler = new Scheduler(mesh, onDirty);
  const configService = new ConfigService(runtime, notify);

  // 恢复持久化状态
  if (persisted) {
    mesh.messages = persisted.meshMessages ?? [];
    mesh.rules = persisted.meshRules ?? [];
    mesh.timeline = persisted.timeline ?? [];
    mesh.relayApproval = persisted.relayApproval ?? true;
    scheduler.load((persisted.schedules as ScheduleDef[]) ?? [], persisted.scheduleRuns ?? []);
  }

  // mock 模式首启：种子出与设计稿一致的演示数据
  if (runtime.mode === 'mock' && !persisted) {
    seedDemo(mesh);
    scheduler.seedDefaults({ nightly: 'claude-backend', weekly: 'agy-docs' });
    persist();
  } else if (!persisted) {
    scheduler.load([], []);
  }

  server = new GatewayServer({ runtime, mesh, scheduler, configService, presets, onDirty });

  process.on('SIGINT', () => {
    scheduler.stop();
    server?.close();
    process.exit(0);
  });
}

function seedDemo(mesh: MeshRelay): void {
  const t = Date.now();
  mesh.messages.push(
    {
      id: 'seed-1',
      from: 'claude-backend',
      to: 'codex-review',
      kind: 'prompt',
      body: 'src/auth 重构完成，请 review 本轮 diff，重点看 token 刷新的并发安全。',
      status: 'injected',
      attachment: { label: 'turn #12 diff', diffStat: '+57 −24' },
      createdAt: t - 9 * 60 * 1000,
      injectedAt: t - 9 * 60 * 1000,
    },
    {
      id: 'seed-2',
      from: 'codex-review',
      to: 'claude-backend',
      kind: 'reply',
      body: '发现 2 处问题：① refresh() 双请求竞态未覆盖多标签场景；② 缺少 token 过期边界测试。建议先修 ①。',
      status: 'held',
      heldReason: '中继审批：reply 方向需人工放行',
      createdAt: t - 4 * 60 * 1000,
      injectedAt: null,
    },
    {
      id: 'seed-3',
      from: 'claude-backend',
      to: 'agy-docs',
      kind: 'prompt',
      body: '更新 auth 模块文档，说明新的 token 刷新流程。',
      status: 'queued',
      createdAt: t - 2 * 60 * 1000,
      injectedAt: null,
    },
  );
  mesh.rules.push({
    id: 'seed-rule-1',
    watcherAgent: 'claude-backend',
    targetAgent: 'claude-e2e',
    triggerState: 'done',
    actionPrompt: 'claude-backend 已完成本轮改动，运行完整 e2e 套件并回报结果。',
    enabled: true,
    oneShot: false,
  });
  mesh.timeline.push(
    { id: 'seed-t0', at: t - 11 * 60 * 1000, kind: 'wait', from: 'claude-e2e', to: 'claude-backend', text: '注册 wait-for-state: done → 自动运行 e2e 套件', pendingAction: null },
    { id: 'seed-t1', at: t - 9 * 60 * 1000, kind: 'message', from: 'claude-backend', to: 'codex-review', messageId: 'seed-1', text: 'src/auth 重构完成，请 review 本轮 diff…', pendingAction: null },
    { id: 'seed-t2', at: t - 8 * 60 * 1000, kind: 'status', from: 'codex-review', text: 'idle → working', pendingAction: null },
    { id: 'seed-t3', at: t - 4 * 60 * 1000, kind: 'message', from: 'codex-review', to: 'claude-backend', messageId: 'seed-2', text: '回传 2 条 review 意见（竞态 / 缺测试）', pendingAction: 'approve' },
    { id: 'seed-t4', at: t - 60 * 1000, kind: 'status', from: 'codex-review', text: 'working → blocked（shell 权限确认：npm audit fix）', pendingAction: 'blocked' },
  );
}

void main();
