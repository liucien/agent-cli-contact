import {
  GATEWAY_PORT,
  type RpcMethod,
  type RpcRequest,
  type ServerMessage,
  type ShellProjection,
} from '@workbench/contracts';

const WS_URL = `ws://localhost:${GATEWAY_PORT}`;
const RECONNECT_MS = 1000;

export interface WsHandlers {
  onShell(projection: ShellProjection): void;
  onPane(agentId: string, text: string, revision: number): void;
  onNotify(level: 'info' | 'warn', text: string): void;
  onConnected(connected: boolean): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
}

let handlers: WsHandlers | null = null;
let ws: WebSocket | null = null;
let started = false;
const pending = new Map<string, Pending>();
/** 当前订阅 pane 的 agent（重连时自动恢复订阅） */
let subscribedAgentId: string | null = null;

export function setHandlers(h: WsHandlers): void {
  handlers = h;
}

export function connect(): void {
  if (started) return;
  started = true;
  open();
}

function open(): void {
  const socket = new WebSocket(WS_URL);
  ws = socket;

  socket.onopen = () => {
    handlers?.onConnected(true);
    // 主动拉一次全量投影
    rpc('shell.get')
      .then((result) => {
        if (result) handlers?.onShell(result as ShellProjection);
      })
      .catch(() => undefined);
    // 恢复 pane 订阅
    if (subscribedAgentId) {
      rpc('thread.subscribe', { agentId: subscribedAgentId }).catch(() => undefined);
    }
  };

  socket.onmessage = (ev: MessageEvent) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'rpc-result': {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.resolve(msg.result);
        }
        break;
      }
      case 'rpc-error': {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.reject(new Error(msg.error.message));
        }
        break;
      }
      case 'shell':
        handlers?.onShell(msg.data);
        break;
      case 'pane':
        handlers?.onPane(msg.agentId, msg.text, msg.revision);
        break;
      case 'notify':
        handlers?.onNotify(msg.level, msg.text);
        break;
    }
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    handlers?.onConnected(false);
    for (const p of pending.values()) p.reject(new Error('gateway 连接已断开'));
    pending.clear();
    setTimeout(open, RECONNECT_MS);
  };

  socket.onerror = () => {
    socket.close();
  };
}

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function rpc(method: RpcMethod, params?: unknown): Promise<unknown> {
  if (!isConnected() || !ws) {
    return Promise.reject(new Error('gateway 未连接'));
  }
  const req: RpcRequest = { id: crypto.randomUUID(), method, params };
  ws.send(JSON.stringify(req));
  return new Promise((resolve, reject) => {
    pending.set(req.id, { resolve, reject });
  });
}

/** 切换 pane 订阅：退订旧 agent，订阅新 agent */
export function switchPane(agentId: string | null): void {
  if (agentId === subscribedAgentId) return;
  const prev = subscribedAgentId;
  subscribedAgentId = agentId;
  if (prev && isConnected()) {
    rpc('thread.unsubscribe', { agentId: prev }).catch(() => undefined);
  }
  if (agentId && isConnected()) {
    rpc('thread.subscribe', { agentId }).catch(() => undefined);
  }
}
