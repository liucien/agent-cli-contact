import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentSnapshot,
  MeshMessage,
  MeshSendParams,
  MeshTimelineEntry,
  ShellProjection,
} from '@workbench/contracts';
import { call, selectAgent, setRightTab, type RightTab } from '../store';
import { partyName, termLineClass } from '../util';
import { MessageCard } from './MessageCard';
import { RuleForm } from './RuleForm';

const TRIGGER_TEXT: Record<string, string> = {
  done: '等待 done 后…',
  blocked: '等待 blocked 后…',
  idle: '等待 idle 后…',
};

type FeedItem =
  | { kind: 'message'; at: number; message: MeshMessage }
  | { kind: 'status'; at: number; entry: MeshTimelineEntry };

function CollabTab({ projection }: { projection: ShellProjection }) {
  const [showRuleForm, setShowRuleForm] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  const { messages, rules, timeline } = projection.mesh;
  const enabledRules = rules.filter((r) => r.enabled);
  const queued = messages.filter((m) => m.status === 'queued');
  const blockedAgents = projection.agents.filter((a) => a.status === 'blocked');

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...messages.map<FeedItem>((m) => ({ kind: 'message', at: m.createdAt, message: m })),
      ...timeline
        .filter((e) => e.kind === 'status')
        .map<FeedItem>((e) => ({ kind: 'status', at: e.at, entry: e })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [messages, timeline]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  return (
    <div className="rp-body" ref={feedRef}>
      <div className="sec-h">
        协作关系
        <button className="add-rule" onClick={() => setShowRuleForm((v) => !v)}>
          + 规则
        </button>
      </div>
      {showRuleForm && (
        <RuleForm agents={projection.agents} onClose={() => setShowRuleForm(false)} />
      )}
      {enabledRules.map((r) => (
        <div key={r.id} className="rel">
          <b>{partyName(projection, r.watcherAgent)}</b> <span className="arrow">⌛</span>{' '}
          <b>{partyName(projection, r.targetAgent)}</b>
          <span className="why">{TRIGGER_TEXT[r.triggerState] ?? r.triggerState}</span>
          <button
            className="del"
            title="删除规则"
            onClick={() => void call('mesh.rule.delete', { ruleId: r.id })}
          >
            ✕
          </button>
        </div>
      ))}
      {queued.map((m) => (
        <div key={m.id} className="rel">
          <b>{partyName(projection, m.from)}</b> <span className="arrow">⇢</span>{' '}
          <b>{partyName(projection, m.to)}</b>
          <span className="why">等待其空闲</span>
        </div>
      ))}
      {enabledRules.length === 0 && queued.length === 0 && !showRuleForm && (
        <div className="rel" style={{ color: 'var(--dim2)' }}>
          暂无协作关系
        </div>
      )}

      <div className="sec-h" style={{ marginTop: 8 }}>
        消息流
      </div>
      <div className="feed">
        {feed.map((item) =>
          item.kind === 'message' ? (
            <MessageCard key={item.message.id} message={item.message} projection={projection} />
          ) : (
            <div key={item.entry.id} className="sysline">
              <span className="ln" />
              {item.entry.text}
              <span className="ln" />
            </div>
          ),
        )}
        {blockedAgents.map((a) => (
          <div key={a.id} className="msg warn-card">
            <div className="hd">
              ⚠ <b>{a.name}</b> 进入 blocked
            </div>
            <div className="bd">{a.blockedReason ?? '等待人工确认'}</div>
            <div className="actions">
              <button
                className="btn pri"
                onClick={() => void call('agent.sendInput', { agentId: a.id, text: 'y' })}
              >
                批准
              </button>
              <button
                className="btn"
                onClick={() => void call('agent.sendInput', { agentId: a.id, text: 'n' })}
              >
                拒绝
              </button>
              <button className="btn" onClick={() => selectAgent(a.id, { toWorkbench: true })}>
                打开 pane
              </button>
            </div>
          </div>
        ))}
        {feed.length === 0 && blockedAgents.length === 0 && (
          <div style={{ color: 'var(--dim2)', fontSize: 12, padding: '6px 2px' }}>
            暂无 agent 间消息
          </div>
        )}
      </div>
    </div>
  );
}

function CollabComposer({
  projection,
  selectedAgent,
}: {
  projection: ShellProjection;
  selectedAgent: AgentSnapshot | null;
}) {
  const agents = projection.agents;
  const defaultFrom = selectedAgent?.id ?? agents[0]?.id ?? 'user';
  const defaultTo = agents.find((a) => a.id !== defaultFrom)?.id ?? '';
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [text, setText] = useState('');

  // 选中 agent 变化时同步默认身份
  useEffect(() => {
    if (selectedAgent) {
      setFrom(selectedAgent.id);
      const other = agents.find((a) => a.id !== selectedAgent.id);
      setTo((prev) =>
        prev && prev !== selectedAgent.id && agents.some((a) => a.id === prev)
          ? prev
          : (other?.id ?? ''),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent?.id]);

  const send = () => {
    const body = text.trim();
    if (!body || !to) return;
    const params: MeshSendParams = { from, to, kind: 'prompt', body };
    void call('mesh.send', params);
    setText('');
  };

  return (
    <div className="rp-composer">
      <select
        className="as"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        title="发送身份"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            以 {a.name}
          </option>
        ))}
        <option value="user">以 用户</option>
      </select>
      <select className="as" value={to} onChange={(e) => setTo(e.target.value)} title="发送目标">
        {agents
          .filter((a) => a.id !== from)
          .map((a) => (
            <option key={a.id} value={a.id}>
              → {a.name}
            </option>
          ))}
      </select>
      <input
        className="rp-input"
        placeholder="发送 agent 间消息…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
      />
    </div>
  );
}

export function RightPanel({
  projection,
  selectedAgent,
  paneText,
  tab,
}: {
  projection: ShellProjection;
  selectedAgent: AgentSnapshot | null;
  paneText: string;
  tab: RightTab;
}) {
  const heldCount = projection.mesh.messages.filter((m) => m.status === 'held').length;
  const blockedCount = projection.agents.filter((a) => a.status === 'blocked').length;
  const badge = heldCount + blockedCount;

  const tabs: { id: RightTab; label: string }[] = [
    { id: 'terminal', label: '终端' },
    { id: 'diff', label: 'Diff' },
    { id: 'computer', label: 'Computer' },
    { id: 'collab', label: '协作' },
  ];

  return (
    <div className="rp">
      <div className="rp-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`rp-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setRightTab(t.id)}
          >
            {t.label}
            {t.id === 'collab' && badge > 0 && <span className="n">{badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'collab' && <CollabTab projection={projection} />}
      {tab === 'terminal' && (
        <div className="rp-term mono">
          {paneText ? (
            paneText.split('\n').map((line, i) => (
              <div key={i} className={termLineClass(line)}>
                {line === '' ? ' ' : line}
              </div>
            ))
          ) : (
            <span style={{ color: 'var(--dim2)' }}>（等待终端输出…）</span>
          )}
        </div>
      )}
      {(tab === 'diff' || tab === 'computer') && (
        <div className="rp-placeholder">此 MVP 暂未启用 · 见 M2/M3</div>
      )}

      {tab === 'collab' && (
        <CollabComposer projection={projection} selectedAgent={selectedAgent} />
      )}
    </div>
  );
}
