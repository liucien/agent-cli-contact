import type { ShellProjection } from '@workbench/contracts';
import type { Screen } from '../store';

export function Titlebar({
  projection,
  selectedWorkspaceId,
  screen,
}: {
  projection: ShellProjection | null;
  selectedWorkspaceId: string | null;
  screen: Screen;
}) {
  const ws = projection?.workspaces.find((w) => w.id === selectedWorkspaceId);
  const label = ws ? ws.label : '…';
  return (
    <div className="titlebar">
      <div className="dots">
        <div className="dot" style={{ background: '#ff5f57' }} />
        <div className="dot" style={{ background: '#febc2e' }} />
        <div className="dot" style={{ background: '#28c840' }} />
      </div>
      <div className="title">
        Workbench — {label}
        {screen === 'mesh' ? ' · Agent Mesh' : ''}
      </div>
      <div className="right">
        <span className="chip">⌘K 命令</span>
        <span className="chip">⚙︎</span>
      </div>
    </div>
  );
}
