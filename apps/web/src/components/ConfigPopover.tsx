import { useMemo, useState } from 'react';
import type {
  AgentApplyConfigParams,
  AgentApplyConfigResult,
  AgentConfig,
  AgentSnapshot,
  PresetSaveParams,
  ShellProjection,
} from '@workbench/contracts';
import { call, closeConfig, toast } from '../store';

function sameConfig(a: AgentConfig, b: AgentConfig): boolean {
  return (
    a.model === b.model &&
    a.reasoning === b.reasoning &&
    a.contextWindow === b.contextWindow &&
    a.permissionMode === b.permissionMode
  );
}

const PERM_OPTIONS: { id: AgentConfig['permissionMode']; name: string; note: string }[] = [
  { id: 'plan', name: 'Plan', note: '只读 · 仅产出计划' },
  { id: 'ask', name: 'Ask', note: '写操作逐次确认' },
  { id: 'full', name: 'Full access', note: '自动批准' },
];

export function ConfigPopover({
  projection,
  agent,
}: {
  projection: ShellProjection;
  agent: AgentSnapshot;
}) {
  const [config, setConfig] = useState<AgentConfig>({ ...agent.config });

  const cap = useMemo(
    () => projection.capabilities.find((c) => c.provider === agent.provider),
    [projection.capabilities, agent.provider],
  );
  const models =
    cap && cap.models.length > 0
      ? cap.models
      : [{ id: agent.config.model, label: agent.config.model, note: '' }];

  const patch = (p: Partial<AgentConfig>) => setConfig((c) => ({ ...c, ...p }));

  const savePreset = () => {
    const name = window.prompt('预设名称：');
    if (!name || !name.trim()) return;
    const params: PresetSaveParams = { name: name.trim(), config };
    void call('preset.save', params).then(
      () => toast('info', `预设「${name.trim()}」已保存`),
      () => undefined,
    );
  };

  const apply = () => {
    const params: AgentApplyConfigParams = { agentId: agent.id, config };
    void call('agent.applyConfig', params).then(
      (result) => {
        const r = result as AgentApplyConfigResult;
        const parts: string[] = [];
        if (r.applied.length > 0) parts.push(`即时生效：${r.applied.join('、')}`);
        if (r.queued.length > 0) parts.push(`排队至 turn 结束：${r.queued.join('、')}`);
        if (r.restartRequired.length > 0) parts.push(`需重启会话：${r.restartRequired.join('、')}`);
        toast('info', parts.length > 0 ? parts.join('；') : '配置未变化');
        closeConfig();
      },
      () => undefined,
    );
  };

  return (
    <>
      <div className="scrim" onClick={closeConfig} />
      <div className="pop" role="dialog" aria-modal="true">
        <div className="hd">
          <b>Agent 配置</b>
          <span className="who">
            {agent.name} · {agent.provider}
          </span>
          <button className="save" onClick={savePreset}>
            存为预设
          </button>
        </div>

        <div className="cols">
          <div>
            <div className="col-h">模型</div>
            {models.map((m) => (
              <button
                key={m.id}
                className={`opt${config.model === m.id ? ' sel' : ''}`}
                onClick={() => patch({ model: m.id })}
              >
                <span className="radio" />
                <span className="nm">
                  {m.label} {m.note && <i>{m.note}</i>}
                </span>
                {agent.config.model === m.id && <span className="tag2">当前</span>}
              </button>
            ))}
          </div>

          <div>
            <div className="col-h">推理强度</div>
            <div className="seg">
              {(['low', 'medium', 'high'] as const).map((r) => (
                <button
                  key={r}
                  className={config.reasoning === r ? 'sel' : ''}
                  onClick={() => patch({ reasoning: r })}
                >
                  {r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}
                </button>
              ))}
            </div>
            <div className="col-h" style={{ marginTop: 12 }}>
              上下文窗口
            </div>
            <div className="seg">
              {(['200k', '1m'] as const).map((c) => (
                <button
                  key={c}
                  className={config.contextWindow === c ? 'sel' : ''}
                  onClick={() => patch({ contextWindow: c })}
                >
                  {c === '200k' ? '200K' : '1M'}
                </button>
              ))}
            </div>
            <div className="note">强度与上下文即时生效，作用于下一个 turn。</div>
          </div>

          <div>
            <div className="col-h">权限模式</div>
            {PERM_OPTIONS.map((p) => (
              <button
                key={p.id}
                className={`opt${config.permissionMode === p.id ? ' sel' : ''}`}
                onClick={() => patch({ permissionMode: p.id })}
              >
                <span className="radio" />
                <span className="nm">
                  {p.name} <i>{p.note}</i>
                </span>
                {p.id === 'full' && <span className="tag2">🔓</span>}
              </button>
            ))}
            {config.permissionMode === 'full' && (
              <div className="note">
                <span className="warn">
                  ⚠ Full access 下 mesh 消息与 computer use 仍需人工放行；
                </span>
                定时任务运行中禁止切换到 Full access。
              </div>
            )}
          </div>
        </div>

        <div className="presets">
          <span className="lb">预设</span>
          {projection.presets.map((p) => (
            <button
              key={p.id}
              className={`preset${sameConfig(p.config, config) ? ' sel' : ''}`}
              onClick={() => setConfig({ ...p.config })}
            >
              {p.name}
            </button>
          ))}
          <button className="preset add" onClick={savePreset}>
            ＋ 新建
          </button>
        </div>

        <div className="ft">
          <div className="how">
            <b>生效方式：</b>模型 / 推理强度 → 注入 slash 命令即时生效；权限模式 → 重启 herdr
            会话（自动 resume 上下文，约 3s，working 中将排队到 turn 结束）。
          </div>
          <button className="apply" onClick={apply}>
            应用
          </button>
        </div>
      </div>
    </>
  );
}
