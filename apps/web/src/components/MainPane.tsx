import { useEffect, useRef, useState } from 'react';
import type { AgentPromptParams, AgentSnapshot, ShellProjection } from '@workbench/contracts';
import { call, openConfig, setScreen } from '../store';
import { ctxLabel, modelLabel, permLabel, reasoningLabel, statusClass, termLineClass } from '../util';

function Terminal({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const lines = text.length > 0 ? text.split('\n') : [];
  return (
    <div className="term mono" ref={ref}>
      {lines.length === 0 ? (
        <div className="term-empty">（等待终端输出…）</div>
      ) : (
        lines.map((line, i) => (
          <div key={i} className={termLineClass(line)}>
            {line === '' ? ' ' : line}
          </div>
        ))
      )}
    </div>
  );
}

export function MainPane({
  projection,
  agent,
  paneText,
}: {
  projection: ShellProjection;
  agent: AgentSnapshot | null;
  paneText: string;
}) {
  const [input, setInput] = useState('');

  if (!agent) {
    return (
      <div className="main">
        <div className="rp-placeholder">当前工作区没有 agent</div>
      </div>
    );
  }

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const params: AgentPromptParams = { agentId: agent.id, text };
    void call('agent.prompt', params);
    setInput('');
  };

  const cfg = agent.config;

  return (
    <div className="main">
      <div className="pane-h">
        <b>{agent.name}</b>
        <span className={`pill ${statusClass(agent.status)}`}>● {agent.status}</span>
        {agent.branch && <span className="pill branch">⎇ {agent.branch}</span>}
        <div className="r">
          <span>turn #{agent.turn}</span>
          <span>checkpoint ✓</span>
          <button className="chip" onClick={() => setScreen('mesh')}>
            Mesh 视图
          </button>
        </div>
      </div>

      <Terminal text={paneText} />

      <div className="composer-wrap">
        <div className="cfgbar">
          <button className="cfgseg" onClick={() => openConfig(agent.id)}>
            <span className="ic">✳</span> {modelLabel(projection, agent)}{' '}
            <span className="dn">▾</span>
          </button>
          <button className="cfgseg" onClick={() => openConfig(agent.id)}>
            {reasoningLabel(cfg.reasoning)} · {ctxLabel(cfg.contextWindow)}{' '}
            <span className="dn">▾</span>
          </button>
          <button className="cfgseg" onClick={() => openConfig(agent.id)}>
            <span className="lock">{cfg.permissionMode === 'full' ? '🔓' : '🔒'}</span>{' '}
            {permLabel(cfg.permissionMode)} <span className="dn">▾</span>
          </button>
        </div>
        <div className="composer">
          <input
            placeholder={`向 ${agent.name} 发送指令…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send();
            }}
          />
          <span className="hint">⌘⇧M 切换模型 · ⌘⇧P 切换权限</span>
          <button className="send" onClick={send}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
