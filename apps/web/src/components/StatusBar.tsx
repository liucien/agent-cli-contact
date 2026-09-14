import type { ShellProjection } from '@workbench/contracts';

export function StatusBar({
  projection,
  connected,
}: {
  projection: ShellProjection | null;
  connected: boolean;
}) {
  const agents = projection?.agents ?? [];
  const blocked = agents.filter((a) => a.status === 'blocked').length;
  const runtime = projection?.runtime;
  return (
    <div className="statusbar">
      {connected ? (
        <span className="g">● gateway 已连接</span>
      ) : (
        <span className="r">○ gateway 未连接</span>
      )}
      <span>
        {runtime
          ? runtime.mode === 'herdr'
            ? `herdr v${runtime.herdrVersion ?? '?'} · unix socket`
            : 'mock 模式'
          : '…'}
      </span>
      <span>
        {agents.length} agents · {blocked} blocked
      </span>
      <span className="ml">mesh 中继审批：{projection?.mesh.relayApproval ? '开' : '关'}</span>
      <span>{projection?.checkpointRef ?? 'refs/studio/checkpoints'} ✓</span>
    </div>
  );
}
