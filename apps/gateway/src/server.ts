/**
 * WS 服务：RPC 分发 + shell 投影广播 + pane 内容订阅推送。
 * MVP 简化：投影全量广播（双订阅模型中的 subscribeShell 档）；
 * pane 内容按订阅轮询推送（subscribeThread 档的读屏基础版）。
 */
import { WebSocketServer, WebSocket } from 'ws';
import type {
  RpcRequest,
  ServerMessage,
  ShellProjection,
  AgentPromptParams,
  AgentSendInputParams,
  AgentApplyConfigParams,
  ThreadSubscribeParams,
  MeshSendParams,
  MeshApproveParams,
  MeshRuleCreateParams,
  PresetSaveParams,
  ConfigPreset,
} from '@workbench/contracts';
import { PROTOCOL_VERSION, GATEWAY_PORT } from '@workbench/contracts';
import { randomUUID } from 'node:crypto';
import type { AgentRuntime } from './runtime.js';
import type { MeshRelay } from './mesh.js';
import type { Scheduler } from './scheduler.js';
import type { ConfigService } from './configService.js';
import { PROVIDER_CAPABILITIES } from './capabilities.js';

const PANE_POLL_MS = 1000;

export interface ServerDeps {
  runtime: AgentRuntime;
  mesh: MeshRelay;
  scheduler: Scheduler;
  configService: ConfigService;
  presets: ConfigPreset[];
  onDirty: () => void;
}

export class GatewayServer {
  private wss: WebSocketServer;
  /** ws -> 订阅的 agentId 集合 */
  private paneSubs = new Map<WebSocket, Set<string>>();
  private paneRevisions = new Map<string, number>();
  private pollTimer: ReturnType<typeof setInterval>;

  constructor(private deps: ServerDeps) {
    this.wss = new WebSocketServer({ port: GATEWAY_PORT });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.pollTimer = setInterval(() => void this.pollPanes(), PANE_POLL_MS);
    deps.runtime.onChange(() => this.broadcastShell());
    console.log(`[gateway] ws://localhost:${GATEWAY_PORT} (${deps.runtime.mode} 模式)`);
  }

  close(): void {
    clearInterval(this.pollTimer);
    this.wss.close();
  }

  buildProjection(): ShellProjection {
    const d = this.deps;
    return {
      protocolVersion: PROTOCOL_VERSION,
      runtime: {
        mode: d.runtime.mode,
        herdrVersion: d.runtime.herdrVersion,
        connected: true,
      },
      workspaces: d.runtime.listWorkspaces(),
      agents: d.runtime.listAgents(),
      schedules: d.scheduler.snapshots(),
      mesh: {
        messages: d.mesh.messages.slice(-100),
        rules: d.mesh.rules,
        timeline: d.mesh.timeline.slice(-200),
        relayApproval: d.mesh.relayApproval,
      },
      presets: d.presets,
      capabilities: PROVIDER_CAPABILITIES,
      checkpointRef: 'refs/studio/checkpoints',
    };
  }

  broadcastShell(): void {
    this.broadcast({ type: 'shell', data: this.buildProjection() });
  }

  notify(level: 'info' | 'warn', text: string): void {
    this.broadcast({ type: 'notify', level, text });
  }

  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  private onConnection(ws: WebSocket): void {
    this.paneSubs.set(ws, new Set());
    ws.send(JSON.stringify({ type: 'shell', data: this.buildProjection() } satisfies ServerMessage));
    ws.on('message', (raw) => void this.onMessage(ws, String(raw)));
    ws.on('close', () => this.paneSubs.delete(ws));
  }

  private async onMessage(ws: WebSocket, raw: string): Promise<void> {
    let req: RpcRequest;
    try {
      req = JSON.parse(raw) as RpcRequest;
    } catch {
      return;
    }
    try {
      const result = await this.dispatch(ws, req);
      ws.send(JSON.stringify({ type: 'rpc-result', id: req.id, result: result ?? null } satisfies ServerMessage));
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: 'rpc-error',
          id: req.id,
          error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
        } satisfies ServerMessage),
      );
    }
  }

  private async dispatch(ws: WebSocket, req: RpcRequest): Promise<unknown> {
    const d = this.deps;
    const p = req.params;
    switch (req.method) {
      case 'shell.get':
        return this.buildProjection();

      case 'agent.prompt': {
        const { agentId, text } = p as AgentPromptParams;
        await d.runtime.prompt(agentId, text);
        return null;
      }
      case 'agent.sendInput': {
        const { agentId, text } = p as AgentSendInputParams;
        await d.runtime.sendInput(agentId, text);
        return null;
      }
      case 'agent.applyConfig': {
        const { agentId, config } = p as AgentApplyConfigParams;
        const result = await d.configService.apply(agentId, config);
        this.broadcastShell();
        return result;
      }

      case 'thread.subscribe': {
        const { agentId } = p as ThreadSubscribeParams;
        this.paneSubs.get(ws)?.add(agentId);
        await this.pushPane(ws, agentId, true);
        return null;
      }
      case 'thread.unsubscribe': {
        const { agentId } = p as ThreadSubscribeParams;
        this.paneSubs.get(ws)?.delete(agentId);
        return null;
      }

      case 'mesh.send': {
        const { from, to, kind, body } = p as MeshSendParams;
        const msg = await d.mesh.send(from, to, kind, body);
        this.broadcastShell();
        return msg;
      }
      case 'mesh.approve': {
        const { messageId, editedBody } = p as MeshApproveParams;
        await d.mesh.approve(messageId, editedBody);
        this.broadcastShell();
        return null;
      }
      case 'mesh.deny': {
        d.mesh.deny((p as MeshApproveParams).messageId);
        this.broadcastShell();
        return null;
      }
      case 'mesh.setRelayApproval': {
        d.mesh.setRelayApproval((p as { enabled: boolean }).enabled);
        this.broadcastShell();
        return null;
      }
      case 'mesh.rule.create': {
        const rule = d.mesh.createRule(p as MeshRuleCreateParams);
        this.broadcastShell();
        return rule;
      }
      case 'mesh.rule.toggle': {
        d.mesh.toggleRule((p as { ruleId: string }).ruleId);
        this.broadcastShell();
        return null;
      }
      case 'mesh.rule.delete': {
        d.mesh.deleteRule((p as { ruleId: string }).ruleId);
        this.broadcastShell();
        return null;
      }

      case 'schedule.runNow': {
        await d.scheduler.runNow((p as { scheduleId: string }).scheduleId);
        this.broadcastShell();
        return null;
      }
      case 'schedule.toggle': {
        d.scheduler.toggle((p as { scheduleId: string }).scheduleId);
        this.broadcastShell();
        return null;
      }

      case 'preset.save': {
        const { name, config } = p as PresetSaveParams;
        const preset: ConfigPreset = { id: randomUUID(), name, config };
        d.presets.push(preset);
        d.onDirty();
        this.broadcastShell();
        return preset;
      }
      case 'preset.delete': {
        const { presetId } = p as { presetId: string };
        const idx = d.presets.findIndex((pr) => pr.id === presetId);
        if (idx >= 0) d.presets.splice(idx, 1);
        d.onDirty();
        this.broadcastShell();
        return null;
      }

      default:
        throw new Error(`unknown method: ${req.method}`);
    }
  }

  private async pollPanes(): Promise<void> {
    const wanted = new Set<string>();
    for (const [, subs] of this.paneSubs) for (const id of subs) wanted.add(id);
    for (const agentId of wanted) {
      try {
        const { text, revision } = await this.deps.runtime.readPane(agentId);
        if (this.paneRevisions.get(agentId) === revision) continue;
        this.paneRevisions.set(agentId, revision);
        const msg = JSON.stringify({ type: 'pane', agentId, text, revision } satisfies ServerMessage);
        for (const [ws, subs] of this.paneSubs) {
          if (subs.has(agentId) && ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      } catch {
        // agent 可能已消失，跳过本轮
      }
    }
  }

  private async pushPane(ws: WebSocket, agentId: string, force = false): Promise<void> {
    try {
      const { text, revision } = await this.deps.runtime.readPane(agentId);
      if (force) this.paneRevisions.set(agentId, revision);
      ws.send(JSON.stringify({ type: 'pane', agentId, text, revision } satisfies ServerMessage));
    } catch {
      /* ignore */
    }
  }
}
