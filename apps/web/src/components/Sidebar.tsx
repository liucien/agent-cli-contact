import type { ShellProjection } from '@workbench/contracts';
import { call, selectAgent, selectWorkspace } from '../store';
import { configSummary, statusClass } from '../util';

export function Sidebar({
  projection,
  selectedWorkspaceId,
  selectedAgentId,
}: {
  projection: ShellProjection;
  selectedWorkspaceId: string | null;
  selectedAgentId: string | null;
}) {
  const agents = projection.agents.filter(
    (a) => !selectedWorkspaceId || a.workspaceId === selectedWorkspaceId,
  );

  return (
    <div className="sidebar">
      <div className="side-h">工作区</div>
      {projection.workspaces.map((w) => (
        <button
          key={w.id}
          className={`item${w.id === selectedWorkspaceId ? ' active' : ''}`}
          onClick={() => selectWorkspace(w.id)}
        >
          ▸ {w.label} <span className="sub">{w.agentCount}</span>
        </button>
      ))}

      <div className="side-h">AGENTS</div>
      {agents.map((a) => (
        <button
          key={a.id}
          className={`item${a.id === selectedAgentId ? ' active' : ''}`}
          onClick={() => selectAgent(a.id)}
        >
          <span className={`st ${statusClass(a.status)}`} /> {a.name}
          {a.status === 'blocked' ? (
            <span className="badge">待确认</span>
          ) : a.status === 'done' ? (
            <span className="sub prov">✓ done</span>
          ) : (
            <span className="sub prov">{a.provider}</span>
          )}
          <span className="cfg">{configSummary(projection, a)}</span>
        </button>
      ))}

      <div className="side-h">定时任务</div>
      {projection.schedules.map((s) => (
        <div key={s.id} className="item" style={{ cursor: 'default' }}>
          ◷ {s.name}
          <button
            className="run-now"
            title="立即运行"
            onClick={(e) => {
              e.stopPropagation();
              void call('schedule.runNow', { scheduleId: s.id });
            }}
          >
            ▶
          </button>
          <span className="sub">{s.humanized}</span>
        </div>
      ))}
    </div>
  );
}
