/**
 * @workbench/herdr-client — herdr socket API 的最小 NDJSON 客户端。
 *
 * 协议：unix socket，newline-delimited JSON，请求 {"id","method","params"}，
 * 响应 {"id","result"} 或 {"id","error":{code,message}}；事件经 events.subscribe
 * 长连接推送（无 id 的 {"event","data"} 包）。
 *
 * herdr 处于 0.x，官方承诺未知字段忽略 / 未知方法报错不断连——本客户端只
 * 依赖 protocol 19 中已验证的方法与字段，升级只碰这一层（PLAN §8）。
 */
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export type HerdrAgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export interface HerdrAgentInfo {
  terminal_id: string;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  agent_status: HerdrAgentStatus;
  agent?: string | null;
  display_agent?: string | null;
  name?: string | null;
  title?: string | null;
  cwd?: string | null;
  focused: boolean;
  revision: number;
}

export interface HerdrWorkspaceInfo {
  workspace_id: string;
  label?: string | null;
  focused?: boolean;
  [k: string]: unknown;
}

export interface HerdrPaneReadResult {
  pane_id: string;
  text: string;
  revision: number;
  truncated: boolean;
}

export interface HerdrEvent {
  event: string;
  data: Record<string, unknown> & { type?: string };
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class HerdrError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function defaultSocketPath(): string {
  return path.join(os.homedir(), '.config', 'herdr', 'herdr.sock');
}

export function socketAvailable(socketPath = defaultSocketPath()): boolean {
  try {
    return fs.statSync(socketPath).isSocket();
  } catch {
    return false;
  }
}

export class HerdrClient {
  private socket: net.Socket | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private eventHandlers = new Set<(ev: HerdrEvent) => void>();
  private closeHandlers = new Set<(err?: Error) => void>();

  constructor(private socketPath = defaultSocketPath()) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      sock.setEncoding('utf8');
      sock.once('connect', () => {
        this.socket = sock;
        resolve();
      });
      sock.once('error', (err) => {
        if (!this.socket) reject(err);
        else this.teardown(err);
      });
      sock.on('data', (chunk: string) => this.onData(chunk));
      sock.on('close', () => this.teardown());
    });
  }

  onEvent(handler: (ev: HerdrEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onClose(handler: (err?: Error) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    this.socket?.destroy();
    this.teardown();
  }

  private teardown(err?: Error): void {
    if (!this.socket) return;
    this.socket = null;
    for (const [, p] of this.pending) p.reject(err ?? new Error('herdr connection closed'));
    this.pending.clear();
    for (const h of this.closeHandlers) h(err);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // 容忍无法解析的行
      }
      if (typeof msg.id === 'string' && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        const err = msg.error as { code?: string; message?: string } | undefined;
        if (err) p.reject(new HerdrError(err.code ?? 'unknown', err.message ?? 'herdr error'));
        else p.resolve(msg.result);
      } else if (typeof msg.event === 'string') {
        const ev = msg as unknown as HerdrEvent;
        for (const h of this.eventHandlers) h(ev);
      }
    }
  }

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket) throw new Error('not connected');
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, method, params: params ?? {} }) + '\n';
    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket!.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  // ---- 便捷方法（仅覆盖 Gateway 用到的子集） ----

  ping(): Promise<unknown> {
    return this.request('ping');
  }

  agentList(): Promise<{ agents: HerdrAgentInfo[] }> {
    return this.request('agent.list');
  }

  workspaceList(): Promise<{ workspaces: HerdrWorkspaceInfo[] }> {
    return this.request('workspace.list');
  }

  agentPrompt(target: string, text: string): Promise<unknown> {
    return this.request('agent.prompt', { target, text });
  }

  paneRead(
    paneId: string,
    opts: { lines?: number; source?: 'visible' | 'recent'; stripAnsi?: boolean } = {},
  ): Promise<HerdrPaneReadResult> {
    return this.request('pane.read', {
      pane_id: paneId,
      source: opts.source ?? 'visible',
      lines: opts.lines,
      strip_ansi: opts.stripAnsi ?? true,
      format: 'text',
    });
  }

  paneSendInput(paneId: string, text: string): Promise<unknown> {
    return this.request('pane.send_input', { pane_id: paneId, text });
  }

  paneSendText(paneId: string, text: string): Promise<unknown> {
    return this.request('pane.send_text', { pane_id: paneId, text });
  }

  /** 订阅 agent 状态与 pane 生命周期事件（长连接）。 */
  subscribeAgentEvents(paneIds: string[]): Promise<unknown> {
    const subscriptions: Record<string, unknown>[] = [
      { type: 'pane.created' },
      { type: 'pane.closed' },
      { type: 'pane.agent_detected' },
      { type: 'workspace.created' },
      { type: 'workspace.closed' },
      ...paneIds.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id })),
    ];
    return this.request('events.subscribe', { subscriptions });
  }
}
